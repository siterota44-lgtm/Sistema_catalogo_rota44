/**
 * Catálogo público da Rota 44: o link que a loja manda no WhatsApp e põe na bio.
 * É um app de uma tela só (como o da Sua Sesh): marca compacta, busca e categorias
 * sempre à mão, as peças em primeiro plano e a sacola fixa embaixo. Nada de páginas.
 *
 * Nunca lê tabela: só chama public_catalog(), catalog_request(), public_coupon() e
 * notify_me() por fetch simples, sem supabase-js (leve no 4G). Custo e saldo exato
 * não saem do banco, e o preço do pedido é o que o banco confere.
 *
 * Links diretos: #p=<peça> abre a peça · #c=<categoria> · #d=<drop> · #i=trocas
 */

import { getConfig } from './config.js';
import { esc, money, thumbUrl, installThumbFallback, whatsappLink, maskPhone, onlyDigits } from './core/utils.js';
import { fold, fuzzyIncludes, round2 } from './core/calc.js';
import { icon } from './ui/icons.js';
import { initTelemetry, setSender, capture } from './core/telemetry.js';

const CFG = getConfig();
const ROOT = document.getElementById('catalog');
const BAG_KEY = 'rota44.bag';
const THEME_KEY = 'rota44.catalog.theme';
const ME_KEY = 'rota44.customer';
const SORTS = { destaque: 'Destaques', novos: 'Lançamentos', vendidos: 'Mais vendidos', menor: 'Menor preço', maior: 'Maior preço' };
const INFO = { sobre: ['Sobre a loja', 'about'], trocas: ['Trocas e devoluções', 'exchange_policy'], frete: ['Frete e entrega', 'shipping_info'], privacidade: ['Privacidade', 'privacy_policy'] };

let cat = null;
let idx = {};
let bag = readBag();
let timers = [];
const st = freshFilters();
let sheet = null;       // janela aberta da peça

function freshFilters() {
  return { q: '', cat: '', drop: '', promo: false, sizes: new Set(), colors: new Set(), fit: '', brand: '', min: '', max: '', onlyAvail: false, sort: 'destaque' };
}

/* ------------------------------------------------------------- banco --- */

const REST = `${CFG.url}/rest/v1/rpc`;

async function rpc(fn, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(`${REST}/${fn}`, {
      method: 'POST', signal: ctrl.signal,
      headers: { apikey: CFG.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      const err = new Error(data?.message || 'Não foi possível concluir. Tente de novo.');
      err.code = data?.code;
      throw err;
    }
    return data;
  } finally { clearTimeout(timer); }
}

let loadedAt = Date.now();

async function loadCatalog() {
  loadedAt = Date.now();
  // no-store: estoque e preço precisam vir novos a cada abertura
  const r = await fetch(`${REST}/public_catalog?apikey=${encodeURIComponent(CFG.anonKey)}`, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    const err = new Error(e.message || `HTTP ${r.status}`);
    err.code = e.code;
    throw err;
  }
  return r.json();
}

function indexCatalog() {
  const by = (l) => new Map((l || []).map((x) => [x.id, x]));
  idx = {
    categories: by(cat.categories), collections: by(cat.collections), brands: by(cat.brands), colors: by(cat.colors),
    sizes: by(cat.sizes), charts: by(cat.size_charts),
    variants: new Map((cat.products || []).flatMap((p) => (p.variants || []).map((v) => [v.id, { ...v, product: p }]))),
  };
}

/* ------------------------------------------------------------ helpers --- */

const store = () => cat?.store || {};
const products = () => cat?.products || [];
const bySlug = (slug) => products().find((p) => p.slug === slug);
const bestPrice = (p) => {
  const vs = p.variants || [];
  if (!vs.length) return { price: Number(p.from_price || 0), list: Number(p.from_price || 0) };
  const best = vs.reduce((a, b) => (Number(b.price) < Number(a.price) ? b : a));
  return { price: Number(best.price), list: Number(best.list_price) };
};
const hasStock = (p) => (p.variants || []).some((v) => v.available);
const colorsOf = (p) => [...new Set((p.variants || []).map((v) => v.color_id))].map((id) => idx.colors.get(id)).filter(Boolean);
const sizesOf = (p) => [...new Set((p.variants || []).map((v) => v.size_id))].map((id) => idx.sizes.get(id)).filter(Boolean).sort((a, b) => a.sort - b.sort);
const coverOf = (p) => p.cover_url || p.images?.[0]?.url || '';
const shield = (cls = '') => `<img class="${cls}" src="assets/brand/escudo.svg" alt="Rota 44" decoding="async">`;

/** Categoria e todas as filhas. */
function categoryIds(id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of cat.categories) if (c.parent_id && out.has(c.parent_id) && !out.has(c.id)) { out.add(c.id); grew = true; }
  }
  return out;
}
const inCategory = (p, tree) => tree.has(p.category_id) || (p.category_ids || []).some((c) => tree.has(c));

/** A categoria "de vitrine" da peça: o nível logo abaixo do topo (Camisetas, Calças...). */
function shelfOf(p) {
  let c = idx.categories.get(p.category_id);
  while (c?.parent_id && idx.categories.get(c.parent_id)?.parent_id) c = idx.categories.get(c.parent_id);
  return c || null;
}

function shelves() {
  const list = new Map();
  for (const p of products()) {
    if (p.coming_soon) continue;
    const c = shelfOf(p);
    if (c) list.set(c.id, c);
  }
  // mantém a ordem definida pela loja
  return (cat.categories || []).filter((c) => list.has(c.id));
}

function flash(text, kind = 'ok') {
  const host = document.querySelector('dialog[open] .k-toasts') || ROOT.querySelector('.k-toasts');
  if (!host) return;
  const t = document.createElement('div');
  t.className = `k-toast ${kind}`;
  t.textContent = text;
  host.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function img(url, alt, { eager = false, cls = '' } = {}) {
  if (!url) return `<span class="k-noimg">${shield()}</span>`;
  return `<img class="${cls}" src="${esc(thumbUrl(url))}" data-full="${esc(url)}" alt="${esc(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
}

function tagsOf(p) {
  const out = [];
  if (p.coming_soon) out.push(['Em breve', 'soon']);
  else if (!hasStock(p)) out.push(['Esgotado', 'out']);
  else {
    const { price, list } = bestPrice(p);
    if (price < list) out.push([`-${Math.round((1 - price / list) * 100)}%`, 'sale']);
    if (p.is_new) out.push(['Novo', 'new']);
    if (p.collection_id && idx.collections.get(p.collection_id)?.limited) out.push(['Edição limitada', 'ltd']);
    const live = (p.variants || []).filter((v) => v.available);
    if (live.length && live.every((v) => v.low)) out.push(['Últimas', 'low']);
  }
  return out.map(([t, k]) => `<span class="k-tag ${k}">${esc(t)}</span>`).join('');
}

/** Mostra a grade na hora: o tamanho sem estoque aparece riscado, não some. */
function sizeLine(p) {
  const zs = sizesOf(p);
  if (!zs.length || zs.length > 8) return '';
  return `<span class="k-size-line">${zs.map((z) => {
    const on = (p.variants || []).some((v) => v.size_id === z.id && v.available);
    return `<i class="${on ? '' : 'off'}">${esc(z.label)}</i>`;
  }).join('')}</span>`;
}

function inBag(p) {
  const ids = new Set((p.variants || []).map((v) => v.id));
  return bag.filter((i) => ids.has(i.variant_id)).reduce((s, i) => s + i.qty, 0);
}

function cardHTML(p) {
  const { price, list } = bestPrice(p);
  const n = inBag(p);
  const first = coverOf(p);
  const second = (p.images || []).find((i) => i.url !== first)?.url;
  return `
    <article class="k-card ${hasStock(p) || p.coming_soon ? '' : 'is-out'}">
      <a class="k-card-main" href="#p=${esc(p.slug)}" data-open="${esc(p.slug)}">
        <span class="k-photo">${img(first, p.name)}
          ${second ? `<img class="k-photo-2" src="${esc(thumbUrl(second))}" data-full="${esc(second)}" alt="" loading="lazy" decoding="async">` : ''}
          <span class="k-tags">${tagsOf(p)}</span></span>
        <span class="k-name">${esc(p.name)}</span>
        ${p.coming_soon ? '' : sizeLine(p)}
      </a>
      <div class="k-foot">
        ${p.coming_soon ? '<span class="k-soon">Em breve</span>' : `
          <span class="k-price">${price < list ? `<s>${esc(money(list))}</s>` : ''}<b>${esc(money(price))}</b></span>
          ${hasStock(p)
            ? `<button class="k-add ${n ? 'has' : ''}" data-quick="${esc(p.slug)}" aria-label="Escolher tamanho de ${esc(p.name)}">${n ? `<b>${n}</b>` : icon('plus')}</button>`
            : `<button class="k-notify" data-open="${esc(p.slug)}" aria-label="Avise quando chegar ${esc(p.name)}">Avise-me</button>`}`}
      </div>
    </article>`;
}

/** Vitrine grande: a peça é o assunto. */
function highlightHTML(p, i) {
  const { price, list } = bestPrice(p);
  return `
    <a class="k-hl" href="#p=${esc(p.slug)}" data-open="${esc(p.slug)}">
      <span class="k-hl-photo">${img(coverOf(p), p.name, { eager: i < 2 })}<span class="k-tags">${tagsOf(p)}</span>
        <span class="k-hl-price">${price < list ? `<s>${esc(money(list))}</s>` : ''}${esc(money(price))}</span></span>
      <span class="k-hl-name">${esc(p.name)}</span>
    </a>`;
}

/* ------------------------------------------------------------ sacola --- */

function readBag() {
  try { const b = JSON.parse(localStorage.getItem(BAG_KEY)); return Array.isArray(b) ? b : []; } catch { return []; }
}
function saveBag() {
  try { localStorage.setItem(BAG_KEY, JSON.stringify(bag)); } catch { /* modo privado */ }
  drawBagBar();
}
const bagCount = () => bag.reduce((s, i) => s + i.qty, 0);
const bagLines = () => bag.map((i) => ({ ...i, v: idx.variants.get(i.variant_id) })).filter((i) => i.v);
const bagTotal = () => round2(bagLines().reduce((s, i) => s + i.qty * Number(i.v.price), 0));

function addToBag(variantId) {
  const line = bag.find((i) => i.variant_id === variantId);
  if (line) line.qty = Math.min(line.qty + 1, 20);
  else bag.push({ variant_id: variantId, qty: 1 });
  saveBag();
  drawGrid();
}

function drawBagBar() {
  const bar = ROOT.querySelector('[data-bag-bar]');
  if (!bar) return;
  const n = bagCount();
  bar.hidden = n === 0;
  if (n) {
    bar.querySelector('[data-n]').textContent = n;
    bar.querySelector('[data-t]').textContent = money(bagTotal());
    bar.classList.remove('pulse');
    void bar.offsetWidth;   // reinicia a animação a cada peça
    bar.classList.add('pulse');
  }
}

/* --------------------------------------------------------- filtragem --- */

const hasFilters = () => st.q || st.cat || st.drop || st.promo || st.sizes.size || st.colors.size || st.fit || st.brand || st.min !== '' || st.max !== '' || st.onlyAvail || st.sort !== 'destaque';
const panelCount = () => st.sizes.size + st.colors.size + (st.fit ? 1 : 0) + (st.brand ? 1 : 0) + (st.min !== '' ? 1 : 0) + (st.max !== '' ? 1 : 0);

function filtered() {
  // drop fechado só aparece quando a pessoa entra no drop
  let list = products().filter((p) => !p.coming_soon || st.drop === p.collection_id);
  if (st.q) {
    const q = fold(st.q);
    list = list.filter((p) => {
      const hay = fold(`${p.name} ${idx.brands.get(p.brand_id)?.name || ''} ${idx.categories.get(p.category_id)?.name || ''} ${(p.tags || []).join(' ')} ${p.fit || ''}`);
      return q.split(/\s+/).every((w) => fuzzyIncludes(hay, w));
    });
  }
  if (st.cat) { const t = categoryIds(st.cat); list = list.filter((p) => inCategory(p, t)); }
  if (st.drop) list = list.filter((p) => p.collection_id === st.drop);
  if (st.promo) list = list.filter((p) => { const x = bestPrice(p); return x.price < x.list; });
  if (st.fit) list = list.filter((p) => p.fit === st.fit);
  if (st.brand) list = list.filter((p) => p.brand_id === st.brand);
  if (st.colors.size) list = list.filter((p) => (p.variants || []).some((v) => st.colors.has(v.color_id) && (!st.onlyAvail || v.available)));
  if (st.sizes.size) list = list.filter((p) => (p.variants || []).some((v) => st.sizes.has(idx.sizes.get(v.size_id)?.label) && (!st.onlyAvail || v.available)));
  if (st.onlyAvail) list = list.filter(hasStock);
  if (st.min !== '') list = list.filter((p) => bestPrice(p).price >= Number(st.min));
  if (st.max !== '') list = list.filter((p) => bestPrice(p).price <= Number(st.max));
  // o que tem vem sempre antes do esgotado
  const avail = (a, b) => Number(hasStock(b)) - Number(hasStock(a));
  const by = {
    destaque: (a, b) => Number(!!b.featured) - Number(!!a.featured) || b.sold_rank - a.sold_rank,
    novos: (a, b) => String(b.created_at).localeCompare(String(a.created_at)),
    vendidos: (a, b) => b.sold_rank - a.sold_rank,
    menor: (a, b) => bestPrice(a).price - bestPrice(b).price,
    maior: (a, b) => bestPrice(b).price - bestPrice(a).price,
  }[st.sort];
  return [...list].sort((a, b) => avail(a, b) || by(a, b) || a.name.localeCompare(b.name, 'pt-BR'));
}

/* ------------------------------------------------------------- telas --- */

function shell() {
  const s = store();
  const wa = whatsappLink(s.whatsapp, 'Fala, Rota 44! Vim pelo catálogo.');
  ROOT.innerHTML = `
    <header class="k-top">
      <div class="k-top-in">
        ${shield('k-shield')}
        <div class="k-brand">
          <h1>ROTA <b>44</b></h1>
          <p>${esc(s.tagline || 'Streetwear pra quem vive a rua.')}</p>
        </div>
        <div class="k-top-actions">
          ${wa ? `<a class="k-wa" href="${esc(wa)}" target="_blank" rel="noopener">${icon('whatsapp')}<span>Falar</span></a>` : ''}
          <button class="k-icon" data-toggle-theme aria-label="Trocar tema">${icon(isDark() ? 'sun' : 'moon')}</button>
        </div>
      </div>
      ${s.announcement ? `<div class="k-announce">${esc(s.announcement)}</div>` : '<div class="k-stripe"></div>'}
      ${DRIP}
    </header>
    <nav class="k-cats" data-cats aria-label="Categorias"></nav>
    <div class="k-sticky">
      <div class="k-bar">
        <label class="k-search">${icon('search')}<input type="search" data-q placeholder="Buscar camiseta, baggy, moletom…" aria-label="Buscar peça" autocomplete="off" enterkeyhint="search"></label>
        <button class="k-filter" data-filters aria-label="Filtrar por tamanho, cor e preço">${icon('filter')}<span class="k-filter-t">Filtrar</span><b data-fcount hidden></b></button>
      </div>
      <div class="k-chips" data-chips aria-label="Categorias"></div>
    </div>
    <main class="k-main" id="k-main"></main>
    ${footerHTML()}
    <button class="k-bag-bar" data-bag data-bag-bar hidden>
      ${icon('box')}<b data-n class="k-bag-n">0</b><span>Ver sacola</span><b data-t class="k-bag-t"></b>
    </button>
    <div class="k-toasts" role="status" aria-live="polite"></div>`;
  drawChips();
  watchCats();
}

/** @rota44, rota44 ou o link inteiro: guarda só o nome. */
const handleOf = (v) => String(v || '').trim().replace(/^https?:\/\/(www\.)?[^/]+\/@?/i, '').replace(/^@/, '').replace(/[/?#].*$/, '');

/** Rodapé com os dados que a loja cadastrou em Ajustes. Campo vazio não aparece. */
function footerHTML() {
  const s = store();
  const name = s.store_name || 'Rota 44';
  const wa = whatsappLink(s.whatsapp, 'Fala, Rota 44! Vim pelo catálogo.');
  const digits = onlyDigits(s.whatsapp);
  const ig = handleOf(s.instagram);
  const tk = handleOf(s.tiktok);
  const trust = [
    s.exchange_days > 0 ? ['refresh', `Troca em até ${s.exchange_days} dias`] : null,
    s.max_installments > 1 ? ['card', `Parcelamos em até ${s.max_installments}x`] : ['card', 'Pix e cartão'],
    s.pix_discount_pct > 0 ? ['cash', `${Number(s.pix_discount_pct)}% de desconto no Pix`] : null,
    s.free_shipping_over > 0 ? ['truck', `Frete grátis acima de ${money(s.free_shipping_over)}`] : ['truck', 'Retirada ou envio'],
  ].filter(Boolean);
  const contact = [
    wa ? `<a href="${esc(wa)}" target="_blank" rel="noopener">${icon('whatsapp')} ${esc(maskPhone(digits.length > 11 && digits.startsWith('55') ? digits.slice(2) : digits))}</a>` : '',
    ig ? `<a href="https://instagram.com/${esc(encodeURIComponent(ig))}" target="_blank" rel="noopener">${icon('instagram')} @${esc(ig)}</a>` : '',
    tk ? `<a href="https://www.tiktok.com/@${esc(encodeURIComponent(tk))}" target="_blank" rel="noopener">${icon('tiktok')} @${esc(tk)}</a>` : '',
    s.email ? `<a href="mailto:${esc(s.email)}">${icon('mail')} ${esc(s.email)}</a>` : '',
  ].filter(Boolean).join('');
  const where = [
    s.address ? `<a href="https://www.google.com/maps/search/?api=1&query=${esc(encodeURIComponent(s.address))}" target="_blank" rel="noopener">${icon('pin')} ${esc(s.address)}</a>` : '',
    s.hours ? `<span>${icon('clock')} ${esc(s.hours)}</span>` : '',
  ].filter(Boolean).join('');
  const when = new Date(cat.now || Date.now());
  const today = new Date().toDateString() === when.toDateString();
  const updated = today ? `hoje às ${when.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : `em ${when.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`;
  return `
    <footer class="k-end">
      <div class="k-end-in">
        <div class="k-end-brand">
          ${shield()}
          <div><b>${esc(name)}</b><p>${esc(s.about || s.tagline || '')}</p></div>
        </div>
        <div class="k-end-trust">${trust.map(([ic, t]) => `<span>${icon(ic)} ${esc(t)}</span>`).join('')}</div>
        <div class="k-end-cols">
          ${contact ? `<div><h4>Atendimento</h4>${contact}</div>` : ''}
          ${where ? `<div><h4>Onde estamos</h4>${where}</div>` : ''}
          ${s.shipping_info ? `<div><h4>Entrega</h4><p>${esc(s.shipping_info)}</p></div>` : ''}
          <div><h4>Como comprar</h4><p>Escolha a peça, monte a sacola e envie pelo WhatsApp: a loja confirma tudo com você.</p></div>
        </div>
        <div class="k-end-bottom">
          <span>© ${new Date().getFullYear()} ${esc(name)}</span>
          <span>Catálogo atualizado ${esc(updated)}</span>
        </div>
      </div>
    </footer>`;
}

/** Tinta vermelha escorrendo por baixo da faixa da marca. Desenhada aqui, sem imagem. */
const DRIP = (() => {
  let seed = 4444;
  const R = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const n = (v) => +v.toFixed(1);
  let x = 1200;
  let d = 'M0 0H1200V4';
  while (x > 0) {
    const gap = 26 + R() * 90;
    const w = 6 + R() * 9;
    const h = 5 + R() * R() * 30;
    x -= gap;
    if (x <= w) break;
    d += `L${n(x)} 4C${n(x - 1)} ${n(4 + h * 0.6)} ${n(x + 1)} ${n(4 + h)} ${n(x - w / 2)} ${n(4 + h)}S${n(x - w - 1)} ${n(4 + h * 0.6)} ${n(x - w)} 4`;
    x -= w;
  }
  return `<svg class="k-drip" viewBox="0 0 1200 40" preserveAspectRatio="none" aria-hidden="true"><path d="${d}L0 4Z"/></svg>`;
})();

/** Foto do botão da categoria: a que a loja escolheu; sem ela, a de uma filha ou a de uma peça. */
function categoryCover(c) {
  const tree = categoryIds(c.id);
  const own = (cat.categories || []).find((x) => tree.has(x.id) && x.image_url);
  if (c.image_url || own) return c.image_url || own.image_url;
  const items = products().filter((p) => inCategory(p, tree) && coverOf(p));
  return coverOf(items.find(hasStock) || items[0] || {});
}

function dropCover(d) {
  return d.banner_url || coverOf(products().find((p) => p.collection_id === d.id && coverOf(p)) || {});
}

function drawChips() {
  const promos = products().some((p) => !p.coming_soon && (() => { const x = bestPrice(p); return x.price < x.list; })());
  const cats_ = shelves();
  // link direto para uma subcategoria: o botão dela aparece junto
  const picked = st.cat && !cats_.some((c) => c.id === st.cat) ? idx.categories.get(st.cat) : null;
  const opts = [
    { key: '', name: 'Tudo', on: !st.cat && !st.drop && !st.promo, ic: 'grid' },
    ...(promos ? [{ key: 'promo', name: 'Promoção', on: st.promo, ic: 'tag', hot: true }] : []),
    ...(cat.collections || []).map((d) => ({ key: `d:${d.id}`, name: d.name, on: st.drop === d.id, url: dropCover(d), hot: true })),
    ...[...(picked ? [picked] : []), ...cats_].map((c) => ({ key: `c:${c.id}`, name: c.name, on: st.cat === c.id, url: categoryCover(c) })),
  ];
  const tiles = ROOT.querySelector('[data-cats]');
  const box = ROOT.querySelector('[data-chips]');
  const keep = [tiles.scrollLeft, box.scrollLeft];
  // com uma categoria só não há o que escolher
  tiles.hidden = box.hidden = opts.length < 3;
  tiles.innerHTML = opts.map((o) => `
    <button class="k-cat ${o.hot ? 'hot' : ''}" data-chip="${esc(o.key)}" aria-pressed="${o.on}">
      <span class="k-cat-img">${o.url ? img(o.url, '') : icon(o.ic || 'grid')}</span>
      <span class="k-cat-name">${esc(o.name)}</span>
    </button>`).join('');
  box.innerHTML = opts.map((o) => `<button class="k-chip ${o.hot ? 'hot' : ''}" data-chip="${esc(o.key)}" aria-pressed="${o.on}" tabindex="-1">${esc(o.name)}</button>`).join('');
  [tiles.scrollLeft, box.scrollLeft] = keep;
  const n = panelCount();
  const b = ROOT.querySelector('[data-fcount]');
  b.hidden = !n;
  b.textContent = n;
}

/** Rolou e as fotos das categorias saíram da tela: entram os nomes, na barra fixa. */
function watchCats() {
  const tiles = ROOT.querySelector('[data-cats]');
  const bar = ROOT.querySelector('.k-sticky');
  if (!('IntersectionObserver' in window)) return;
  new IntersectionObserver(([e]) => {
    bar.classList.toggle('stuck', !e.isIntersecting);
    ROOT.querySelectorAll('.k-chip[data-chip]').forEach((b) => (e.isIntersecting ? b.setAttribute('tabindex', '-1') : b.removeAttribute('tabindex')));
  }, { rootMargin: '-64px 0px 0px 0px' }).observe(tiles);
}

function countdownHTML(at) {
  return `<div class="k-count" data-countdown="${esc(at)}" role="timer" aria-label="Contagem regressiva">
    ${[['d', 'dias'], ['h', 'horas'], ['m', 'min'], ['s', 'seg']].map(([k, l]) => `<div><b data-${k}>--</b><small>${l}</small></div>`).join('')}
  </div>`;
}
function startCountdowns(host) {
  host.querySelectorAll('[data-countdown]').forEach((box) => {
    const end = new Date(box.dataset.countdown).getTime();
    const tick = () => {
      const left = Math.max(end - Date.now(), 0);
      const set = (k, v) => { const el = box.querySelector(`[data-${k}]`); if (el) el.textContent = String(v).padStart(2, '0'); };
      set('d', Math.floor(left / 86400000));
      set('h', Math.floor(left / 3600000) % 24);
      set('m', Math.floor(left / 60000) % 60);
      set('s', Math.floor(left / 1000) % 60);
      if (left <= 0) location.reload();
    };
    tick();
    timers.push(setInterval(tick, 1000));
  });
}

function dropBanner() {
  const now = new Date();
  const drops = cat.collections || [];
  const next = drops.filter((d) => d.launch_at && new Date(d.launch_at) > now).sort((a, b) => new Date(a.launch_at) - new Date(b.launch_at))[0];
  if (!next) return '';
  return `
    <button class="k-drop" data-chip="d:${esc(next.id)}" ${next.banner_url ? `style="--banner:url('${esc(next.banner_url)}')"` : ''}>
      <span class="k-drop-t"><small>Próximo drop</small><b>${esc(next.name)}</b>${next.collab ? `<em>Collab com ${esc(next.collab)}</em>` : ''}</span>
      ${countdownHTML(next.launch_at)}
    </button>`;
}

function drawGrid() {
  const main = document.getElementById('k-main');
  if (!main) return;
  timers.forEach(clearInterval);
  timers = [];
  const list = filtered();
  const browsing = !hasFilters();
  document.title = st.cat ? `${idx.categories.get(st.cat)?.name} · Rota 44` : 'Rota 44 · Streetwear';

  let body = '';
  if (browsing) {
    // de cara, as peças em destaque; depois, uma prateleira por categoria
    const buyable = products().filter((p) => !p.coming_soon && hasStock(p));
    // poucas peças: todas em destaque, grandes, sem repetir nas prateleiras
    const few = buyable.length <= 4;
    let top = few ? buyable : buyable.filter((p) => p.featured);
    if (top.length < 3) top = [...top, ...[...buyable].filter((p) => !p.featured).sort((a, b) => b.sold_rank - a.sold_rank || String(b.created_at).localeCompare(String(a.created_at)))].slice(0, 8);
    const hl = top.slice(0, 10);
    const shown = new Set(few ? hl.map((p) => p.id) : []);
    const rest = list.filter((p) => !shown.has(p.id));
    const groups = shelves().map((c) => ({ c, items: rest.filter((p) => shelfOf(p)?.id === c.id) })).filter((g) => g.items.length);
    const loose = rest.filter((p) => !shelfOf(p));
    body = `
      ${dropBanner()}
      ${hl.length ? `<section class="k-hls" aria-label="Destaques"><h2 class="k-title">${few ? 'As peças' : 'Destaques'}</h2><div class="k-hl-row ${few ? 'few' : ''}">${hl.map(highlightHTML).join('')}</div></section>` : ''}
      ${groups.map((g) => `
        <section class="k-shelf">
          <h2 class="k-title">${esc(g.c.name)} <small>${g.items.length}</small></h2>
          <div class="k-grid">${g.items.map(cardHTML).join('')}</div>
        </section>`).join('')}
      ${loose.length ? `<section class="k-shelf"><h2 class="k-title">Outras peças</h2><div class="k-grid">${loose.map(cardHTML).join('')}</div></section>` : ''}`;
  } else if (list.length) {
    const d = st.drop ? idx.collections.get(st.drop) : null;
    const c = st.cat ? idx.categories.get(st.cat) : null;
    const soon = d?.launch_at && new Date(d.launch_at) > new Date();
    body = `
      ${d ? `<section class="k-drop-head"><small>${soon ? 'Em breve' : d.limited ? 'Edição limitada' : 'Drop'}</small><h2>${esc(d.name)}</h2>${d.collab ? `<em>Collab com ${esc(d.collab)}</em>` : ''}${d.description ? `<p>${esc(d.description)}</p>` : ''}${soon ? countdownHTML(d.launch_at) : ''}${d.limit_per_customer ? `<p class="k-note">Limite de ${d.limit_per_customer} por cliente.</p>` : ''}</section>` : ''}
      ${c?.description ? `<p class="k-note">${esc(c.description)}</p>` : ''}
      <div class="k-grid">${list.map(cardHTML).join('')}</div>`;
  } else {
    const wa = whatsappLink(store().whatsapp, `Fala! Vocês têm ${st.q || 'essa peça'}?`);
    body = `<div class="k-empty"><h3>Nada encontrado${st.q ? ` para "${esc(st.q)}"` : ''}</h3>
      <button class="k-btn ghost" data-clear>Ver todas as peças</button>
      ${wa ? `<a class="k-btn wa" href="${esc(wa)}" target="_blank" rel="noopener">${icon('whatsapp')} Perguntar no WhatsApp</a>` : ''}</div>`;
  }
  main.innerHTML = `
    <div class="k-results">
      <span class="k-found">${list.length} peça${list.length === 1 ? '' : 's'}</span>
      <button class="k-chip small" data-only aria-pressed="${st.onlyAvail}">Só disponíveis</button>
      <select class="k-sort" data-sort aria-label="Ordenar">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}"${st.sort === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
    </div>
    ${body}
    ${!products().length ? `<div class="k-empty">${shield()}<h3>As peças estão chegando</h3><p>Enquanto isso, chama no WhatsApp!</p></div>` : ''}`;
  startCountdowns(main);
}

/* -------------------------------------------------------------- janelas -- */

function dialog(cls, html, { onClose } = {}) {
  const d = document.createElement('dialog');
  d.className = `k-dialog ${cls}`;
  d.innerHTML = `${html}<div class="k-toasts" role="status" aria-live="polite"></div>`;
  document.body.appendChild(d);
  d.showModal();
  document.body.classList.add('k-locked');
  const close = () => {
    if (!d.isConnected) return;
    d.close();
    d.remove();
    if (!document.querySelector('dialog[open]')) document.body.classList.remove('k-locked');
    onClose?.();
  };
  d.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-x]')) close(); });
  return { el: d, close };
}

/* ----------------------------------------------------------- ficha ------ */

function setProductMeta(p, price) {
  document.title = `${p.seo_title || p.name} · Rota 44`;
  document.querySelector('meta[name=description]')?.setAttribute('content', (p.seo_desc || p.short_desc || p.description || p.name).slice(0, 160));
  document.getElementById('ld')?.remove();
  const el = document.createElement('script');
  el.type = 'application/ld+json';
  el.id = 'ld';
  el.textContent = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Product', name: p.name, description: p.short_desc || p.description || p.name,
    image: (p.images || []).map((i) => new URL(i.url, location.href).href), brand: idx.brands.get(p.brand_id)?.name,
    offers: { '@type': 'Offer', priceCurrency: 'BRL', price: Number(price).toFixed(2), availability: hasStock(p) ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock', url: location.href },
  });
  document.head.appendChild(el);
}

function openProduct(p) {
  sheet?.close();
  const s = store();
  const colors = colorsOf(p);
  const chart = idx.charts.get(p.size_chart_id);
  const { price, list } = bestPrice(p);
  const details = [['Modelagem', p.fit], ['Tecido', p.fabric], ['Gramatura', p.gsm ? `${p.gsm} g/m²` : ''], ['Estampa', p.print_type], ['Marca', idx.brands.get(p.brand_id)?.name]].filter(([, v]) => v);
  setProductMeta(p, price);

  const tree = p.category_id ? categoryIds(shelfOf(p)?.id || p.category_id) : null;
  const related = products().filter((x) => x.id !== p.id && !x.coming_soon && hasStock(x) && ((x.collection_id && x.collection_id === p.collection_id) || (tree && inCategory(x, tree)))).slice(0, 6);

  const m = dialog('sheet', `
    <div class="k-sheet k-pdp">
      <button class="k-x" data-x aria-label="Fechar">${icon('x')}</button>
      <div class="k-pdp-scroll">
        <div class="k-gal" data-gal></div>
        <div class="k-buy">
          <div class="k-tags static">${tagsOf(p)}</div>
          <h2>${esc(p.name)}</h2>
          ${p.short_desc ? `<p class="k-note">${esc(p.short_desc)}</p>` : ''}
          ${p.coming_soon ? `<div class="k-soon-box"><b>Lança em</b>${countdownHTML(p.launch_at)}</div>` : `
            <div class="k-pdp-price">
              ${price < list ? `<s>${esc(money(list))}</s>` : ''}<b>${esc(money(price))}</b>
              ${s.pix_discount_pct > 0 ? `<span>${esc(money(price * (1 - s.pix_discount_pct / 100)))} no Pix</span>` : ''}
              ${s.max_installments > 1 ? `<span>ou ${s.max_installments}× de ${esc(money(price / s.max_installments))}</span>` : ''}
            </div>
            ${colors.length > 1 ? `<div class="k-opt"><h4>Cor: <span data-color-name></span></h4><div class="k-swatches" data-colors></div></div>` : ''}
            <div class="k-opt">
              <div class="k-opt-head"><h4>Tamanho</h4>${chart ? '<button type="button" class="k-link" data-chart>Tabela de medidas</button>' : ''}</div>
              <div class="k-sizes" data-sizes></div>
              <div class="k-stock" data-stock></div>
            </div>
            <div data-notify-box></div>`}
          ${details.length ? `<dl class="k-specs">${details.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
          ${p.description ? `<p class="k-desc">${esc(p.description)}</p>` : ''}
          ${p.wash_care ? `<details class="k-acc"><summary>Como lavar</summary><p>${esc(p.wash_care)}</p></details>` : ''}
          ${s.exchange_policy ? `<details class="k-acc"><summary>Trocas</summary><p>${esc(s.exchange_policy)}</p></details>` : ''}
          ${related.length ? `<div class="k-related"><h4>Combina com</h4><div class="k-hl-row small">${related.map(highlightHTML).join('')}</div></div>` : ''}
        </div>
      </div>
      ${p.coming_soon ? '' : `<div class="k-pdp-foot">
        <button class="k-btn big" data-add>Colocar na sacola</button>
      </div>`}
    </div>`, { onClose: () => { sheet = null; clearHash('p'); document.getElementById('ld')?.remove(); document.title = 'Rota 44 · Streetwear'; } });
  sheet = m;

  let colorId = colors.find((c) => (p.variants || []).some((v) => v.color_id === c.id && v.available))?.id || colors[0]?.id || null;
  let sizeId = null;
  // uma variação só com estoque: já vem escolhida, é um toque a menos
  const liveAll = (p.variants || []).filter((v) => v.color_id === colorId);
  if (liveAll.length === 1) sizeId = liveAll[0].size_id;

  const el = m.el;
  const current = () => (p.variants || []).find((v) => v.color_id === colorId && v.size_id === sizeId) || null;
  const photos = () => {
    const all = p.images || [];
    const mine = all.filter((i) => i.color_id === colorId);
    const shared = all.filter((i) => !i.color_id);
    const out = [...mine, ...shared];
    return out.length ? out : all;
  };
  function drawGallery() {
    const g = el.querySelector('[data-gal]');
    const list_ = photos();
    g.innerHTML = list_.length ? `
      <div class="k-gal-track" data-track>${list_.map((i, n) => `<div class="k-gal-slide"><img src="${esc(i.url)}" alt="${esc(p.name)}" ${n ? 'loading="lazy"' : 'fetchpriority="high"'}></div>`).join('')}</div>
      ${list_.length > 1 ? `<div class="k-gal-dots">${list_.map((_, n) => `<button type="button" data-dot="${n}" aria-label="Foto ${n + 1}" aria-pressed="${n === 0}"></button>`).join('')}</div>` : ''}`
      : `<div class="k-gal-slide"><span class="k-noimg">${shield()}</span></div>`;
    const track = g.querySelector('[data-track]');
    track?.addEventListener('scroll', () => {
      const n = Math.round(track.scrollLeft / track.clientWidth);
      g.querySelectorAll('[data-dot]').forEach((b, i) => b.setAttribute('aria-pressed', String(i === n)));
    }, { passive: true });
  }
  function drawOptions() {
    const cBox = el.querySelector('[data-colors]');
    if (cBox) {
      cBox.innerHTML = colors.map((c) => {
        const any = (p.variants || []).some((v) => v.color_id === c.id && v.available);
        return `<button type="button" class="k-swatch ${any ? '' : 'off'}" data-color="${esc(c.id)}" aria-pressed="${c.id === colorId}" aria-label="${esc(c.name)}${any ? '' : ' (esgotada)'}" title="${esc(c.name)}"><i style="background:${esc(c.hex)}"></i></button>`;
      }).join('');
      el.querySelector('[data-color-name]').textContent = idx.colors.get(colorId)?.name || '';
    }
    const sBox = el.querySelector('[data-sizes]');
    if (sBox) {
      const vs = (p.variants || []).filter((v) => v.color_id === colorId).map((v) => ({ v, z: idx.sizes.get(v.size_id) })).sort((a, b) => (a.z?.sort || 0) - (b.z?.sort || 0));
      sBox.innerHTML = vs.map(({ v, z }) => `<button type="button" class="k-size ${v.available ? '' : 'off'}" data-size="${esc(v.size_id)}" aria-pressed="${v.size_id === sizeId}" aria-label="Tamanho ${esc(z?.label)}${v.available ? '' : ' (esgotado)'}">${esc(z?.label)}</button>`).join('');
    }
    const v = current();
    const note = el.querySelector('[data-stock]');
    if (note) {
      note.textContent = !v ? '' : !v.available ? 'Esgotado neste tamanho.' : v.left ? `Restam ${v.left}!` : v.low ? 'Últimas unidades.' : '';
      note.className = `k-stock ${v && (!v.available || v.low) ? 'warn' : ''}`;
    }
    const box = el.querySelector('[data-notify-box]');
    if (box) {
      box.innerHTML = v && !v.available ? `
        <form class="k-avise" data-avise>
          <b>Avise-me quando chegar</b>
          <div class="k-two">
            <input class="k-input" name="name" placeholder="Seu nome" autocomplete="given-name" required aria-label="Seu nome">
            <input class="k-input" name="phone" inputmode="tel" placeholder="WhatsApp com DDD" autocomplete="tel" required aria-label="WhatsApp">
          </div>
          <button class="k-btn ghost" type="submit">Quero ser avisado</button>
          <p class="k-note">Usamos seu WhatsApp só para este aviso.</p>
        </form>` : '';
    }
    const add = el.querySelector('[data-add]');
    if (add) {
      const inCart = v ? (bag.find((b) => b.variant_id === v.id)?.qty || 0) : 0;
      add.disabled = !!(v && !v.available);
      add.textContent = v && !v.available ? 'Esgotado' : inCart ? `Colocar mais uma (${inCart} na sacola)` : 'Colocar na sacola';
    }
  }

  el.addEventListener('click', (e) => {
    const c = e.target.closest('[data-color]');
    if (c) { colorId = c.dataset.color; sizeId = null; drawGallery(); drawOptions(); return; }
    const z = e.target.closest('[data-size]');
    if (z) { sizeId = z.dataset.size; drawOptions(); return; }
    const dot = e.target.closest('[data-dot]');
    if (dot) { const t = el.querySelector('[data-track]'); t.scrollTo({ left: t.clientWidth * Number(dot.dataset.dot), behavior: 'smooth' }); return; }
    if (e.target.closest('[data-chart]')) { openChart(chart); return; }
    const rel = e.target.closest('[data-open]');
    if (rel) { e.preventDefault(); e.stopPropagation(); m.close(); location.hash = `p=${rel.dataset.open}`; return; }
    if (e.target.closest('[data-add]')) {
      const v = current();
      if (!v) {
        flash('Escolha o tamanho', 'warn');
        const box = el.querySelector('[data-sizes]');
        box?.classList.add('shake');
        box?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setTimeout(() => box?.classList.remove('shake'), 500);
        return;
      }
      if (!v.available) return;
      addToBag(v.id);
      m.close();
      flash(`${p.name} na sacola`);
    }
  });
  el.addEventListener('submit', async (e) => {
    if (!e.target.matches('[data-avise]')) return;
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await rpc('notify_me', { p: { variant_id: current().id, name: form.name.value, phone: form.phone.value } });
      form.innerHTML = '<b>Fechou! A gente te avisa no WhatsApp.</b>';
    } catch (err) {
      flash(err.message, 'warn');
      btn.disabled = false;
    }
  });
  drawGallery();
  if (!p.coming_soon) drawOptions();
  else startCountdowns(el);
}

function openChart(chart) {
  dialog('sheet small', `
    <div class="k-sheet">
      <header class="k-sheet-head"><h2>${esc(chart.name)}</h2><button class="k-icon" data-x aria-label="Fechar">${icon('x')}</button></header>
      <div class="k-sheet-body">
        <div class="k-table"><table>
          <thead><tr><th>Tam.</th>${(chart.columns || []).map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
          <tbody>${(chart.rows || []).map((r) => `<tr><th>${esc(r.size)}</th>${(r.values || []).map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>
        ${chart.notes ? `<p class="k-note" style="margin-top:10px">${esc(chart.notes)}</p>` : ''}
      </div>
    </div>`);
}

function openInfo(key) {
  const [title, field] = INFO[key] || [];
  if (!title) return;
  const s = store();
  const wa = whatsappLink(s.whatsapp, 'Fala, Rota 44!');
  sheet = dialog('sheet small', `
    <div class="k-sheet">
      <header class="k-sheet-head"><h2>${esc(title)}</h2><button class="k-icon" data-x aria-label="Fechar">${icon('x')}</button></header>
      <div class="k-sheet-body k-prose">
        ${String(s[field] || 'Fale com a loja.').split('\n').filter(Boolean).map((l) => `<p>${esc(l)}</p>`).join('')}
        ${wa ? `<a class="k-btn wa" href="${esc(wa)}" target="_blank" rel="noopener">${icon('whatsapp')} Falar com a loja</a>` : ''}
      </div>
    </div>`, { onClose: () => { sheet = null; clearHash('i'); } });
}

function openFilters() {
  const pool = products().filter((p) => !p.coming_soon);
  const order = new Map((cat.sizes || []).map((s) => [s.label, s.sort]));
  const sizes = [...new Set(pool.flatMap((p) => sizesOf(p).map((s) => s.label)))].sort((a, b) => (order.get(a) || 0) - (order.get(b) || 0) || String(a).localeCompare(String(b), 'pt', { numeric: true }));
  const colors = [...new Map(pool.flatMap(colorsOf).map((c) => [c.id, c])).values()];
  const fits = [...new Set(pool.map((p) => p.fit).filter(Boolean))].sort();
  const brands = [...new Set(pool.map((p) => p.brand_id).filter(Boolean))].map((id) => idx.brands.get(id)).filter(Boolean);
  const m = dialog('sheet small', `
    <div class="k-sheet">
      <header class="k-sheet-head"><h2>Filtrar</h2><button class="k-icon" data-x aria-label="Fechar">${icon('x')}</button></header>
      <div class="k-sheet-body k-fpanel">
        ${sizes.length ? `<div><h4>Tamanho</h4><div class="k-sizes small">${sizes.map((z) => `<button type="button" class="k-size" data-fsize="${esc(z)}" aria-pressed="${st.sizes.has(z)}">${esc(z)}</button>`).join('')}</div></div>` : ''}
        ${colors.length > 1 ? `<div><h4>Cor</h4><div class="k-swatches">${colors.map((c) => `<button type="button" class="k-swatch" data-fcolor="${esc(c.id)}" aria-pressed="${st.colors.has(c.id)}" title="${esc(c.name)}" aria-label="${esc(c.name)}"><i style="background:${esc(c.hex)}"></i></button>`).join('')}</div></div>` : ''}
        <div><h4>Preço</h4><div class="k-two">
          <input class="k-input" type="number" inputmode="numeric" min="0" placeholder="De" name="min" value="${esc(st.min)}" aria-label="Preço mínimo">
          <input class="k-input" type="number" inputmode="numeric" min="0" placeholder="Até" name="max" value="${esc(st.max)}" aria-label="Preço máximo">
        </div></div>
        ${fits.length > 1 ? `<div><h4>Modelagem</h4><select class="k-input" name="fit" aria-label="Modelagem"><option value="">Todas</option>${fits.map((x) => `<option${x === st.fit ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></div>` : ''}
        ${brands.length > 1 ? `<div><h4>Marca</h4><select class="k-input" name="brand" aria-label="Marca"><option value="">Todas</option>${brands.map((b) => `<option value="${esc(b.id)}"${b.id === st.brand ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div>` : ''}
      </div>
      <footer class="k-sheet-foot row">
        <button class="k-btn ghost" data-clear-panel>Limpar</button>
        <button class="k-btn" data-x data-see>Ver peças</button>
      </footer>
    </div>`, { onClose: () => { drawChips(); drawGrid(); } });
  const see = () => { m.el.querySelector('[data-see]').textContent = `Ver ${filtered().length} peça${filtered().length === 1 ? '' : 's'}`; };
  m.el.addEventListener('click', (e) => {
    const z = e.target.closest('[data-fsize]');
    if (z) {
      const v = z.dataset.fsize;
      if (st.sizes.has(v)) st.sizes.delete(v); else st.sizes.add(v);
      z.setAttribute('aria-pressed', String(st.sizes.has(v)));
      see();
      return;
    }
    const c = e.target.closest('[data-fcolor]');
    if (c) {
      const v = c.dataset.fcolor;
      if (st.colors.has(v)) st.colors.delete(v); else st.colors.add(v);
      c.setAttribute('aria-pressed', String(st.colors.has(v)));
      see();
      return;
    }
    if (e.target.closest('[data-clear-panel]')) {
      st.sizes.clear(); st.colors.clear(); st.fit = ''; st.brand = ''; st.min = ''; st.max = '';
      m.close();
    }
  });
  m.el.addEventListener('input', (e) => {
    if (['min', 'max', 'fit', 'brand'].includes(e.target.name)) { st[e.target.name] = e.target.value; see(); }
  });
  see();
}

/* -------------------------------------------------------- sacola (janela) */

function openBag() {
  let me = {};
  try { me = JSON.parse(localStorage.getItem(ME_KEY)) || {}; } catch { /* */ }
  let coupon = null;
  const s = store();
  const m = dialog('sheet', '<div class="k-sheet" data-body></div>', { onClose: () => drawGrid() });
  const body = m.el.querySelector('[data-body]');

  function draw() {
    const keep = body.querySelector('[data-send]');
    if (keep) me = { name: keep.name.value, phone: keep.phone.value, delivery: keep.delivery.value, notes: keep.notes.value };
    const lines = bagLines();
    const subtotal = bagTotal();
    const discount = coupon ? Math.min(Number(coupon.discount), subtotal) : 0;
    const total = round2(subtotal - discount);
    const free = Number(s.free_shipping_over) > 0 ? Number(s.free_shipping_over) - total : null;
    body.innerHTML = `
      <header class="k-sheet-head"><h2>Sacola ${lines.length ? `<small>${bagCount()}</small>` : ''}</h2><button class="k-icon" data-x aria-label="Fechar">${icon('x')}</button></header>
      <div class="k-sheet-body">
        ${lines.length ? lines.map((l) => {
          const p = l.v.product;
          const c = idx.colors.get(l.v.color_id);
          const pic = (p.images || []).find((i) => i.color_id === l.v.color_id)?.url || coverOf(p);
          return `
            <div class="k-line" data-line="${esc(l.variant_id)}">
              <span class="k-line-img">${img(pic, p.name)}</span>
              <div class="k-line-main">
                <b>${esc(p.name)}</b>
                <span>${esc(c?.name)} · ${esc(idx.sizes.get(l.v.size_id)?.label)}</span>
                ${!l.v.available ? '<span class="warn">Esgotou: a loja confirma</span>' : ''}
                <div class="k-qty"><button type="button" data-dec aria-label="Tirar uma">${icon('minus')}</button><b>${l.qty}</b><button type="button" data-inc aria-label="Mais uma">${icon('plus')}</button></div>
              </div>
              <b class="k-line-t">${esc(money(l.qty * l.v.price))}</b>
            </div>`;
        }).join('') : `<div class="k-empty">${shield()}<h3>Sacola vazia</h3><button class="k-btn" data-x>Ver as peças</button></div>`}
        ${lines.length ? `
          <form class="k-coupon" data-coupon>
            <input class="k-input" name="code" placeholder="Tem cupom?" autocapitalize="characters" value="${esc(coupon?.code || '')}" aria-label="Cupom">
            <button class="k-btn ghost" type="submit">Aplicar</button>
          </form>
          <form class="k-form" data-send id="k-send">
            <label>Seu nome<input class="k-input" name="name" required autocomplete="name" value="${esc(me.name || '')}"></label>
            <label>Seu WhatsApp (opcional)<input class="k-input" name="phone" inputmode="tel" autocomplete="tel" value="${esc(maskPhone(me.phone || ''))}"></label>
            <label>Como quer receber
              <select class="k-input" name="delivery">${['Retirar na loja', 'Motoboy', 'Correios', 'Combinar no WhatsApp'].map((o) => `<option${o === me.delivery ? ' selected' : ''}>${o}</option>`).join('')}</select></label>
            <label>Observação (opcional)<input class="k-input" name="notes" maxlength="400" value="${esc(me.notes || '')}"></label>
            <p class="k-note">Usamos seus dados só para atender este pedido. <a href="#i=privacidade" data-x>Privacidade</a></p>
          </form>` : ''}
      </div>
      ${lines.length ? `
        <footer class="k-sheet-foot">
          ${discount ? `<div class="k-row"><span>Cupom ${esc(coupon.code)}</span><span>−${esc(money(discount))}</span></div>` : ''}
          ${free !== null ? `<div class="k-row small"><span>${free > 0 ? `Faltam ${esc(money(free))} para o frete grátis` : 'Frete grátis garantido!'}</span></div>` : ''}
          <div class="k-row total"><span>Total</span><b>${esc(money(total))}</b></div>
          <button class="k-btn wa big" type="submit" form="k-send">${icon('whatsapp')} Enviar pedido no WhatsApp</button>
        </footer>` : ''}`;
    const f = body.querySelector('[data-send]');
    f?.phone.addEventListener('input', () => { f.phone.value = maskPhone(f.phone.value); });
  }

  function message(res, form, lines) {
    const out = [`*Pedido${res?.number ? ` C${res.number}` : ''} - ${s.store_name || 'Rota 44'}*`, '', `Nome: ${form.name}`, ''];
    const items = res?.items || lines.map((l) => ({ name: l.v.product.name, color: idx.colors.get(l.v.color_id)?.name, size: idx.sizes.get(l.v.size_id)?.label, qty: l.qty, unit_price: l.v.price, available: l.v.available }));
    for (const i of items) out.push(`• ${i.qty}× ${i.name} (${i.color}, ${i.size}): ${money(i.qty * i.unit_price)}${i.available === false ? ' ⚠ esgotou agora, confirmar' : ''}`);
    out.push('');
    if (res?.discount > 0) out.push(`Cupom ${res.coupon_code}: −${money(res.discount)}`);
    out.push(`*Total: ${money(res?.total ?? bagTotal())}*`, `Entrega: ${form.delivery}`);
    if (form.notes) out.push(`Obs.: ${form.notes}`);
    return out.join('\n');
  }

  m.el.addEventListener('click', (e) => {
    const line = e.target.closest('[data-line]');
    if (!line) return;
    const it = bag.find((b) => b.variant_id === line.dataset.line);
    if (e.target.closest('[data-inc]')) { it.qty = Math.min(it.qty + 1, 20); saveBag(); draw(); return; }
    if (e.target.closest('[data-dec]')) { it.qty -= 1; if (it.qty <= 0) bag = bag.filter((b) => b !== it); saveBag(); draw(); }
  });
  m.el.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (e.target.matches('[data-coupon]')) {
      const code = e.target.code.value.trim().toUpperCase();
      if (!code) { coupon = null; draw(); return; }
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      try {
        const r = await rpc('public_coupon', { p_code: code, p_total: bagTotal() });
        if (r.ok) { coupon = { code: r.code, discount: Number(r.discount) }; flash('Cupom aplicado'); draw(); }
        else { flash(r.error || 'Cupom inválido', 'warn'); btn.disabled = false; }
      } catch (err) { flash(err.message, 'warn'); btn.disabled = false; }
      return;
    }
    if (!e.target.matches('[data-send]')) return;
    const f = e.target;
    const form = { name: f.name.value.trim(), phone: onlyDigits(f.phone.value), delivery: f.delivery.value, notes: f.notes.value.trim() };
    if (!form.name) { flash('Informe seu nome', 'warn'); f.name.focus(); return; }
    if (!s.whatsapp) { flash('A loja ainda não configurou o WhatsApp. Tente mais tarde.', 'warn'); return; }
    const lines = bagLines();
    const btn = body.querySelector('[form="k-send"]');
    btn.disabled = true;
    btn.textContent = 'Enviando…';
    // abre a aba antes do await: depois dele o iPhone bloqueia como pop-up
    const tab = window.open('', '_blank');
    let res = null;
    try {
      res = await rpc('catalog_request', { p: {
        customer_name: form.name, customer_phone: form.phone, delivery_pref: form.delivery, notes: form.notes, coupon_code: coupon?.code || '',
        items: lines.map((l) => ({ variant_id: l.variant_id, qty: l.qty })),
      } });
    } catch (err) {
      // o pedido não pode se perder: a mensagem vai do mesmo jeito, só sem o registro no sistema
      capture(err, { where: 'catalog_request' });
    }
    try { localStorage.setItem(ME_KEY, JSON.stringify({ name: form.name, phone: form.phone })); } catch { /* */ }
    const url = whatsappLink(s.whatsapp, message(res, form, lines));
    if (tab) tab.location.href = url; else location.href = url;
    bag = [];
    saveBag();
    body.innerHTML = `
      <header class="k-sheet-head"><h2>Pedido enviado</h2><button class="k-icon" data-x aria-label="Fechar">${icon('x')}</button></header>
      <div class="k-sheet-body"><div class="k-empty">${shield()}<h3>Valeu, ${esc(form.name.split(' ')[0])}!</h3>
        <p>Se o WhatsApp não abriu, toque no botão abaixo.</p>
        <a class="k-btn wa" href="${esc(url)}" target="_blank" rel="noopener">${icon('whatsapp')} Abrir o WhatsApp</a></div></div>`;
  });
  draw();
}

/* --------------------------------------------------------------- tema --- */

function isDark() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t) return t === 'dark';
  return matchMedia('(prefers-color-scheme: dark)').matches;
}
function toggleTheme() {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem(THEME_KEY, next); } catch { /* */ }
  ROOT.querySelector("[data-toggle-theme]").innerHTML = icon(next === 'dark' ? 'sun' : 'moon');
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', next === 'dark' ? '#070708' : '#e6e3dd');
}

/* -------------------------------------------------------------- links --- */

function clearHash(prefix) {
  if (location.hash.startsWith(`#${prefix}=`)) history.replaceState(null, '', location.pathname + location.search);
}

function handleHash() {
  const h = location.hash.slice(1);
  const [k, v] = h.split('=');
  const value = v ? decodeURIComponent(v) : '';
  if (k === 'p') {
    const p = bySlug(value);
    if (p) openProduct(p);
    else { flash('Essa peça saiu do catálogo', 'warn'); clearHash('p'); }
    return;
  }
  if (sheet) sheet.close();
  if (!h) return;
  if (k === 'i') { openInfo(value); return; }
  if (k === 'c' || k === 'd') {
    const found = k === 'c' ? (cat.categories || []).find((c) => c.slug === value) : (cat.collections || []).find((d) => d.slug === value);
    if (found) {
      st.cat = k === 'c' ? found.id : '';
      st.drop = k === 'd' ? found.id : '';
      st.promo = false;
      drawChips();
      drawGrid();
    }
  }
}

function wire() {
  ROOT.addEventListener('click', (e) => {
    if (e.target.closest("[data-toggle-theme]")) { toggleTheme(); return; }
    if (e.target.closest('[data-bag]')) { openBag(); return; }
    if (e.target.closest('[data-filters]')) { openFilters(); return; }
    const quick = e.target.closest('[data-quick]');
    if (quick) {
      const p = bySlug(quick.dataset.quick);
      // sem nada para escolher, o + já coloca na sacola
      const vs = (p.variants || []).filter((v) => v.available);
      if ((p.variants || []).length === 1 && vs.length === 1) { addToBag(vs[0].id); flash(`${p.name} na sacola`); return; }
      location.hash = `p=${p.slug}`;
      return;
    }
    const open = e.target.closest('[data-open]');
    if (open) { e.preventDefault(); location.hash = `p=${open.dataset.open}`; return; }
    const chip = e.target.closest('[data-chip]');
    if (chip) {
      const v = chip.dataset.chip;
      st.cat = v.startsWith('c:') ? v.slice(2) : '';
      st.drop = v.startsWith('d:') ? v.slice(2) : '';
      st.promo = v === 'promo';
      drawChips();
      drawGrid();
      const tiles = ROOT.querySelector('[data-cats]');
      window.scrollTo({ top: Math.min(window.scrollY, tiles.hidden ? ROOT.querySelector('.k-top').offsetHeight : tiles.offsetTop + tiles.offsetHeight), behavior: 'instant' });
      return;
    }
    if (e.target.closest('[data-only]')) { st.onlyAvail = !st.onlyAvail; drawGrid(); return; }
    if (e.target.closest('[data-clear]')) {
      Object.assign(st, freshFilters());
      ROOT.querySelector('[data-q]').value = '';
      drawChips();
      drawGrid();
    }
  });
  ROOT.addEventListener('change', (e) => {
    if (e.target.matches('[data-sort]')) { st.sort = e.target.value; drawGrid(); }
  });
  let t;
  ROOT.addEventListener('input', (e) => {
    if (!e.target.matches('[data-q]')) return;
    clearTimeout(t);
    t = setTimeout(() => { st.q = e.target.value.trim(); drawGrid(); }, 160);
  });
  window.addEventListener('hashchange', handleHash);
}

function viewClosed() {
  const s = store();
  const wa = whatsappLink(s.whatsapp, 'Fala, Rota 44!');
  ROOT.innerHTML = `<div class="k-empty full">${shield()}<h3>Volta já</h3><p>O catálogo está fechado por enquanto.</p>
    ${wa ? `<a class="k-btn wa" href="${esc(wa)}" target="_blank" rel="noopener">${icon('whatsapp')} Falar com a loja</a>` : ''}</div>`;
}

async function boot() {
  try {
    cat = await loadCatalog();
  } catch (err) {
    console.error(err);
    if (['PGRST202', 'PGRST205', '42883'].includes(err.code)) {
      ROOT.innerHTML = `<div class="k-empty full">${shield()}<h3>Loja em preparação</h3><p>O catálogo entra no ar em breve.</p></div>`;
    } else {
      capture(err, { where: 'catalog:boot' });
      ROOT.innerHTML = `<div class="k-empty full">${shield()}<h3>Sem conexão</h3><p>Não consegui carregar as peças. Confira a internet.</p><button class="k-btn" data-reload>Tentar de novo</button></div>`;
      ROOT.querySelector('[data-reload]').addEventListener('click', () => location.reload());
    }
    return;
  }
  if (!cat.open) { viewClosed(); return; }
  indexCatalog();
  // peça que saiu do catálogo não fica na sacola
  bag = bag.filter((i) => idx.variants.has(i.variant_id));
  shell();
  wire();
  drawGrid();
  saveBag();
  handleHash();
}

/**
 * Voltou para a aba depois de um tempo (no iPhone ela fica parada em segundo
 * plano): busca de novo, para não vender peça que acabou nem esconder a que chegou.
 */
async function refreshIfStale() {
  if (!cat?.open || document.visibilityState !== 'visible' || Date.now() - loadedAt < 60000 || document.querySelector('dialog[open]')) return;
  try {
    const fresh = await loadCatalog();
    if (!fresh.open) { location.reload(); return; }
    cat = fresh;
    indexCatalog();
    bag = bag.filter((i) => idx.variants.has(i.variant_id));
    drawChips();
    drawGrid();
    saveBag();
  } catch { /* sem internet agora: fica com o que já tem na tela */ }
}
document.addEventListener('visibilitychange', refreshIfStale);
window.addEventListener('pageshow', (e) => { if (e.persisted) refreshIfStale(); });

initTelemetry();
setSender((rows) => rpc('log_client_error', { p: rows }));
installThumbFallback();
boot();
