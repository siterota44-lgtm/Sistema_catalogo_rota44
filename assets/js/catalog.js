/**
 * Catálogo público da Rota 44 (sem login).
 *
 * Nunca lê tabela: só chama public_catalog(), catalog_request(), public_coupon()
 * e notify_me() por fetch simples, sem supabase-js (mais leve no 4G). O preço do
 * pedido vem do banco; esta tela só mostra e monta a mensagem do WhatsApp.
 *
 * Endereços (hash): #/ · #/loja · #/c/slug · #/p/slug · #/drop/slug · #/sobre ·
 * #/trocas · #/frete · #/contato · #/privacidade
 */

import { getConfig, APP } from './config.js';
import { esc, money, thumbUrl, installThumbFallback, whatsappLink, maskPhone, onlyDigits, uid } from './core/utils.js';
import { fold, fuzzyIncludes, round2 } from './core/calc.js';
import { icon } from './ui/icons.js';
import { initTelemetry, setSender, capture } from './core/telemetry.js';

const CFG = getConfig();
const ROOT = document.getElementById('catalog');
const BAG_KEY = 'rota44.bag';
const THEME_KEY = 'rota44.catalog.theme';
const CUST_KEY = 'rota44.customer';
const PAGE = 24;

let cat = null;               // resposta do banco
let idx = {};                 // índices
let bag = readBag();
let timers = [];
let filters = emptyFilters();

function emptyFilters() {
  return { cat: '', sizes: new Set(), colors: new Set(), fit: '', brand: '', drop: '', promo: false, available: false, min: '', max: '', sort: 'novos', q: '', limit: PAGE };
}

/* ------------------------------------------------------------- banco --- */

const REST = `${CFG.url}/rest/v1/rpc`;
const headers = { apikey: CFG.anonKey, 'Content-Type': 'application/json' };

async function rpc(fn, body) {
  const r = await fetch(`${REST}/${fn}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const err = new Error(data?.message || 'Não foi possível concluir. Tente de novo.');
    err.code = data?.code;
    throw err;
  }
  return data;
}

async function loadCatalog() {
  // mesma URL do <link rel="preload">: a resposta já pode estar pronta
  const r = await fetch(`${REST}/public_catalog?apikey=${encodeURIComponent(CFG.anonKey)}`, { mode: 'cors', credentials: 'omit' });
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
    sizes: by(cat.sizes), charts: by(cat.size_charts), products: by(cat.products),
    variants: new Map((cat.products || []).flatMap((p) => (p.variants || []).map((v) => [v.id, { ...v, product: p }]))),
  };
}

const store = () => cat?.store || {};
const productPrice = (p) => {
  const vs = p.variants || [];
  if (!vs.length) return { price: Number(p.from_price || 0), list: Number(p.from_price || 0) };
  const best = vs.reduce((a, b) => (Number(b.price) < Number(a.price) ? b : a));
  return { price: Number(best.price), list: Number(best.list_price) };
};
const hasStock = (p) => (p.variants || []).some((v) => v.available);
const colorsOf = (p) => [...new Set((p.variants || []).map((v) => v.color_id))].map((id) => idx.colors.get(id)).filter(Boolean);
const sizesOf = (p) => [...new Set((p.variants || []).map((v) => v.size_id))].map((id) => idx.sizes.get(id)).filter(Boolean).sort((a, b) => a.sort - b.sort);
const categoryIds = (id) => {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of cat.categories) if (c.parent_id && out.has(c.parent_id) && !out.has(c.id)) { out.add(c.id); grew = true; }
  }
  return out;
};
const inCategory = (p, tree) => tree.has(p.category_id) || (p.category_ids || []).some((c) => tree.has(c));

/* ------------------------------------------------------------ sacola --- */

function readBag() {
  try { const b = JSON.parse(localStorage.getItem(BAG_KEY)); return Array.isArray(b) ? b : []; } catch { return []; }
}
function saveBag() {
  try { localStorage.setItem(BAG_KEY, JSON.stringify(bag)); } catch { /* modo privado */ }
  const n = bagCount();
  ROOT.querySelectorAll('[data-bag-count]').forEach((el) => { el.textContent = String(n); el.hidden = n === 0; });
}
const bagCount = () => bag.reduce((s, i) => s + i.qty, 0);
const bagLines = () => bag.map((i) => ({ ...i, v: idx.variants.get(i.variant_id) })).filter((i) => i.v);
const bagTotal = () => round2(bagLines().reduce((s, i) => s + i.qty * Number(i.v.price), 0));
function addToBag(variantId, qty = 1) {
  const line = bag.find((i) => i.variant_id === variantId);
  if (line) line.qty = Math.min(line.qty + qty, 20);
  else bag.push({ variant_id: variantId, qty });
  saveBag();
}

/* ------------------------------------------------------------ pedaços --- */

const shield = (cls = '') => `<img class="${cls}" src="assets/brand/escudo.svg" alt="Rota 44" decoding="async">`;
const route = () => location.hash.replace(/^#\/?/, '') || '';
const go = (h) => { location.hash = h; };

function toast(text, kind = 'ok') {
  let host = document.querySelector('dialog[open] .c-toasts') || document.querySelector('.c-toasts');
  if (!host) { host = document.createElement('div'); host.className = 'c-toasts'; document.body.appendChild(host); }
  const t = document.createElement('div');
  t.className = `c-toast ${kind}`;
  t.setAttribute('role', 'status');
  t.textContent = text;
  host.appendChild(t);
  setTimeout(() => t.remove(), 3600);
}

function photoTag(url, alt, { eager = false } = {}) {
  if (!url) return `<span class="c-noimg">${shield()}</span>`;
  return `<img src="${esc(thumbUrl(url))}" data-full="${esc(url)}" alt="${esc(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
}

function priceHTML(p) {
  const { price, list } = productPrice(p);
  const s = store();
  const onSale = price < list;
  return `
    <div class="c-price">
      ${onSale ? `<s>${esc(money(list))}</s>` : ''}
      <b>${esc(money(price))}</b>
      ${s.max_installments > 1 ? `<small>${s.max_installments}× de ${esc(money(price / s.max_installments))}</small>` : ''}
    </div>`;
}

function cardBadges(p) {
  const out = [];
  if (p.coming_soon) out.push(['Em breve', 'soon']);
  else if (!hasStock(p)) out.push(['Esgotado', 'out']);
  else {
    const { price, list } = productPrice(p);
    if (price < list) out.push([`-${Math.round((1 - price / list) * 100)}%`, 'sale']);
    if (p.is_new) out.push(['Novo', 'new']);
    if (p.collection_id && idx.collections.get(p.collection_id)?.limited) out.push(['Edição limitada', 'ltd']);
    if ((p.variants || []).some((v) => v.available && v.low) && !(p.variants || []).some((v) => v.available && !v.low)) out.push(['Últimas', 'low']);
  }
  return out.map(([t, k]) => `<span class="c-tag ${k}">${esc(t)}</span>`).join('');
}

function cardHTML(p) {
  const imgs = p.images || [];
  const first = p.cover_url || imgs[0]?.url;
  const second = imgs.find((i) => i.url !== first)?.url;
  const colors = colorsOf(p);
  return `
    <a class="c-card" href="#/p/${esc(p.slug)}">
      <span class="c-photo">
        ${photoTag(first, p.name)}
        ${second ? `<img class="c-photo-2" src="${esc(thumbUrl(second))}" data-full="${esc(second)}" alt="" loading="lazy" decoding="async">` : ''}
        <span class="c-tags">${cardBadges(p)}</span>
      </span>
      <span class="c-info">
        <span class="c-name">${esc(p.name)}</span>
        ${p.coming_soon ? '<span class="c-soon-text">Em breve</span>' : priceHTML(p)}
        ${colors.length > 1 ? `<span class="c-dots">${colors.slice(0, 6).map((c) => `<i style="background:${esc(c.hex)}" title="${esc(c.name)}"></i>`).join('')}${colors.length > 6 ? `<small>+${colors.length - 6}</small>` : ''}</span>` : ''}
      </span>
    </a>`;
}

const gridHTML = (list) => `<div class="c-grid">${list.map(cardHTML).join('')}</div>`;

/** Faixa de tinta vermelha escorrendo por baixo do herói. Desenhada aqui, sem imagem. */
const DRIP = (() => {
  let seed = 4444;
  const R = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const n = (v) => +v.toFixed(1);
  let x = 1200;
  let d = 'M0 0H1200V7';
  while (x > 0) {
    const gap = 22 + R() * 70;
    const w = 7 + R() * 11;
    const h = 7 + R() * R() * 48;
    x -= gap;
    if (x <= w) break;
    d += `L${n(x)} 7`;
    // gota: desce fina, arredonda no fim e sobe de volta
    d += `C${n(x - 1)} ${n(7 + h * 0.6)} ${n(x + 1)} ${n(7 + h)} ${n(x - w / 2)} ${n(7 + h)}S${n(x - w - 1)} ${n(7 + h * 0.6)} ${n(x - w)} 7`;
    x -= w;
  }
  return `<svg class="c-drip" viewBox="0 0 1200 62" preserveAspectRatio="none" aria-hidden="true"><path d="${d}L0 7Z"/></svg>`;
})();

/* ---------------------------------------------------------- estrutura --- */

function shell() {
  const s = store();
  const tops = (cat.categories || []).filter((c) => !c.parent_id);
  const subs = (id) => cat.categories.filter((c) => c.parent_id === id && (cat.products || []).some((p) => inCategory(p, categoryIds(c.id))));
  const wa = whatsappLink(s.whatsapp, 'Fala, Rota 44! Vim pelo catálogo.');
  ROOT.innerHTML = `
    ${s.announcement ? `<div class="c-announce"><span>${esc(s.announcement)}</span></div>` : ''}
    <header class="c-head">
      <div class="c-head-in">
        <button class="c-icon only-m" data-menu aria-label="Abrir menu">${icon('menu')}</button>
        <a class="c-logo" href="#/" aria-label="Rota 44, página inicial">${shield()}<span>ROTA <b>44</b></span></a>
        <nav class="c-nav" aria-label="Categorias">
          <a href="#/loja">Tudo</a>
          ${(cat.collections || []).length ? '<a href="#/drops">Drops</a>' : ''}
          ${tops.flatMap((t) => { const l = subs(t.id); return l.length ? l : []; }).slice(0, 6).map((c) => `<a href="#/c/${esc(c.slug)}">${esc(c.name)}</a>`).join('')}
        </nav>
        <form class="c-search" data-search role="search">
          ${icon('search')}
          <input type="search" name="q" placeholder="Buscar peça…" aria-label="Buscar" autocomplete="off" enterkeyhint="search">
        </form>
        <button class="c-icon" data-theme aria-label="Trocar tema">${icon(isDark() ? 'sun' : 'moon')}</button>
        <button class="c-icon c-bag-btn" data-bag aria-label="Abrir sacola">${icon('box')}<span class="c-count" data-bag-count hidden>0</span></button>
      </div>
    </header>
    <main class="c-main" id="c-view"></main>
    <footer class="c-foot">
      <div class="c-foot-in">
        <div class="c-foot-brand">${shield()}<p>${esc(s.tagline || '')}</p></div>
        <nav aria-label="Institucional">
          <h4>A loja</h4>
          <a href="#/sobre">Sobre</a><a href="#/trocas">Trocas e devoluções</a><a href="#/frete">Frete e entrega</a><a href="#/contato">Contato</a><a href="#/privacidade">Privacidade</a>
        </nav>
        <nav aria-label="Compre">
          <h4>Compre</h4>
          <a href="#/loja">Todas as peças</a>
          ${(cat.collections || []).length ? '<a href="#/drops">Drops</a>' : ''}
          ${tops.map((t) => `<a href="#/c/${esc(t.slug)}">${esc(t.name)}</a>`).join('')}
        </nav>
        <div>
          <h4>Fala com a gente</h4>
          ${wa ? `<a href="${esc(wa)}" target="_blank" rel="noopener">${icon('whatsapp')} WhatsApp</a>` : ''}
          ${s.instagram ? `<a href="https://instagram.com/${esc(s.instagram.replace('@', ''))}" target="_blank" rel="noopener">${esc(s.instagram)}</a>` : ''}
          ${s.address ? `<p>${esc(s.address)}</p>` : ''}
          ${s.hours ? `<p>${esc(s.hours)}</p>` : ''}
        </div>
      </div>
      <div class="c-foot-end"><span>© ${new Date().getFullYear()} ${esc(s.store_name || 'Rota 44')}</span><a href="sistema">Área da loja</a></div>
    </footer>
    ${wa ? `<a class="c-wa" href="${esc(wa)}" target="_blank" rel="noopener" aria-label="Falar no WhatsApp">${icon('whatsapp')}</a>` : ''}
    <div class="c-toasts" role="status" aria-live="polite"></div>`;
  saveBag();
}

function isDark() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t) return t === 'dark';
  return matchMedia('(prefers-color-scheme: dark)').matches;
}
function toggleTheme() {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem(THEME_KEY, next); } catch { /* */ }
  ROOT.querySelector('[data-theme]').innerHTML = icon(next === 'dark' ? 'sun' : 'moon');
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', next === 'dark' ? '#0b0b0c' : '#eeece7');
}

/* ------------------------------------------------------------- telas ---- */

function clearTimers() { timers.forEach(clearInterval); timers = []; }

function setMeta(title, desc) {
  document.title = title ? `${title} · Rota 44` : 'Rota 44 · Streetwear';
  if (desc) document.querySelector('meta[name=description]')?.setAttribute('content', desc.slice(0, 160));
  document.getElementById('ld')?.remove();
}

function countdownHTML(at) {
  return `<div class="c-count-box" data-countdown="${esc(at)}" role="timer" aria-label="Contagem regressiva">
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
      if (left <= 0) { clearTimers(); boot(); }
    };
    tick();
    timers.push(setInterval(tick, 1000));
  });
}

function viewHome() {
  const s = store();
  setMeta('', s.tagline);
  const products = cat.products || [];
  const next = (cat.collections || []).filter((d) => d.launch_at && new Date(d.launch_at) > new Date()).sort((a, b) => new Date(a.launch_at) - new Date(b.launch_at))[0];
  const live = (cat.collections || []).filter((d) => !d.launch_at || new Date(d.launch_at) <= new Date());
  const buyable = products.filter((p) => !p.coming_soon);
  const fresh = [...buyable].filter((p) => hasStock(p)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 8);
  const best = [...buyable].filter((p) => p.sold_rank > 0 && hasStock(p)).sort((a, b) => b.sold_rank - a.sold_rank).slice(0, 8);
  const featured = buyable.filter((p) => p.featured && hasStock(p)).slice(0, 8);
  const promos = buyable.filter((p) => { const x = productPrice(p); return x.price < x.list && hasStock(p); }).slice(0, 8);
  const catsWithStuff = (cat.categories || []).filter((c) => c.parent_id && !idx.categories.get(c.parent_id)?.parent_id && products.some((p) => inCategory(p, categoryIds(c.id))));
  const tiles = catsWithStuff.slice(0, 6);
  const heroImg = s.hero_image;
  return `
    <section class="c-hero ${heroImg ? 'has-img' : ''}" ${heroImg ? `style="--hero:url('${esc(heroImg)}')"` : ''}>
      <div class="c-hero-in">
        <img class="c-hero-shield" src="assets/brand/escudo.svg" alt="Escudo Rota 44" width="280" height="329" fetchpriority="high">
        <div class="c-hero-text">
          <h1>${esc(s.hero_title || 'Direto das ruas')}</h1>
          <p>${esc(s.hero_subtitle || s.tagline || '')}</p>
          <div class="c-hero-cta">
            <a class="c-btn" href="#/loja">Ver as peças</a>
            ${next ? `<a class="c-btn ghost" href="#/drop/${esc(next.slug)}">Próximo drop</a>` : live[0] ? `<a class="c-btn ghost" href="#/drop/${esc(live[0].slug)}">${esc(live[0].name)}</a>` : ''}
          </div>
        </div>
      </div>
      ${DRIP}
    </section>
    <div class="c-wrap">
      ${next ? `
        <section class="c-next-drop" ${next.banner_url ? `style="--banner:url('${esc(next.banner_url)}')"` : ''}>
          <div><span class="c-eyebrow">Próximo drop</span><h2>${esc(next.name)}</h2>${next.collab ? `<p>Collab com ${esc(next.collab)}</p>` : ''}</div>
          ${countdownHTML(next.launch_at)}
          <a class="c-btn" href="#/drop/${esc(next.slug)}">Ver o drop</a>
        </section>` : ''}
      ${tiles.length ? `
        <section class="c-sec">
          <div class="c-chips">
            ${tiles.map((c) => `<a class="c-chip" href="#/c/${esc(c.slug)}">${esc(c.name)}</a>`).join('')}
            <a class="c-chip" href="#/loja">Ver tudo</a>
          </div>
        </section>` : ''}
      ${featured.length ? section('Destaques', featured, '#/loja') : ''}
      ${fresh.length ? section('Lançamentos', fresh, '#/loja') : ''}
      ${promos.length ? section('Promoção', promos, '#/loja?promo') : ''}
      ${best.length ? section('Mais vendidos', best, '#/loja') : ''}
      ${!products.length ? `<div class="c-empty">${shield()}<h2>O catálogo está sendo montado</h2><p>Em breve as peças aparecem aqui. Enquanto isso, chama no WhatsApp!</p></div>` : ''}
    </div>`;
}

const section = (title, list, more) => `
  <section class="c-sec">
    <div class="c-sec-head"><h2>${esc(title)}</h2><a href="${esc(more)}">Ver tudo ${icon('arrowRight')}</a></div>
    ${gridHTML(list)}
  </section>`;

function applyFilters(base) {
  const f = filters;
  let list = base;
  if (f.q) {
    const q = fold(f.q);
    list = list.filter((p) => {
      const hay = fold(`${p.name} ${idx.brands.get(p.brand_id)?.name || ''} ${idx.categories.get(p.category_id)?.name || ''} ${(p.tags || []).join(' ')} ${p.fit || ''}`);
      return q.split(/\s+/).every((w) => fuzzyIncludes(hay, w));
    });
  }
  if (f.cat) { const t = categoryIds(f.cat); list = list.filter((p) => inCategory(p, t)); }
  if (f.brand) list = list.filter((p) => p.brand_id === f.brand);
  if (f.drop) list = list.filter((p) => p.collection_id === f.drop);
  if (f.fit) list = list.filter((p) => p.fit === f.fit);
  if (f.colors.size) list = list.filter((p) => (p.variants || []).some((v) => f.colors.has(v.color_id) && (!f.available || v.available)));
  if (f.sizes.size) {
    const labels = new Set([...f.sizes]);
    list = list.filter((p) => (p.variants || []).some((v) => labels.has(idx.sizes.get(v.size_id)?.label) && (!f.available || v.available)));
  }
  if (f.promo) list = list.filter((p) => { const x = productPrice(p); return x.price < x.list; });
  if (f.available) list = list.filter(hasStock);
  if (f.min !== '') list = list.filter((p) => productPrice(p).price >= Number(f.min));
  if (f.max !== '') list = list.filter((p) => productPrice(p).price <= Number(f.max));
  const sorted = [...list];
  const soldOutLast = (a, b) => Number(hasStock(b)) - Number(hasStock(a));
  if (f.sort === 'menor') sorted.sort((a, b) => soldOutLast(a, b) || productPrice(a).price - productPrice(b).price);
  else if (f.sort === 'maior') sorted.sort((a, b) => soldOutLast(a, b) || productPrice(b).price - productPrice(a).price);
  else if (f.sort === 'vendidos') sorted.sort((a, b) => soldOutLast(a, b) || b.sold_rank - a.sold_rank);
  else sorted.sort((a, b) => soldOutLast(a, b) || String(b.created_at).localeCompare(String(a.created_at)));
  return sorted;
}

function filterPanel(base) {
  const f = filters;
  const sizes = [...new Set(base.flatMap((p) => sizesOf(p).map((s) => s.label)))];
  const order = new Map((cat.sizes || []).map((s) => [s.label, s.sort]));
  sizes.sort((a, b) => (order.get(a) || 0) - (order.get(b) || 0) || String(a).localeCompare(String(b), 'pt', { numeric: true }));
  const colors = [...new Map(base.flatMap((p) => colorsOf(p)).map((c) => [c.id, c])).values()];
  const fits = [...new Set(base.map((p) => p.fit).filter(Boolean))].sort();
  const brands = [...new Set(base.map((p) => p.brand_id).filter(Boolean))].map((id) => idx.brands.get(id)).filter(Boolean);
  const drops = (cat.collections || []).filter((d) => base.some((p) => p.collection_id === d.id));
  const tops = (cat.categories || []).filter((c) => (cat.products || []).some((p) => inCategory(p, categoryIds(c.id))));
  return `
    <div class="c-filters">
      <label class="c-check"><input type="checkbox" data-fl="available" ${f.available ? 'checked' : ''}><span>Só o que tem disponível</span></label>
      <label class="c-check"><input type="checkbox" data-fl="promo" ${f.promo ? 'checked' : ''}><span>Em promoção</span></label>
      ${tops.length ? `<div class="c-fgroup"><h4>Categoria</h4><select class="c-select" data-fl="cat" aria-label="Categoria"><option value="">Todas</option>
        ${treeOptions(tops, f.cat)}</select></div>` : ''}
      ${sizes.length ? `<div class="c-fgroup"><h4>Tamanho</h4><div class="c-sizes">${sizes.map((s) => `<button type="button" class="c-size" data-fsize="${esc(s)}" aria-pressed="${f.sizes.has(s)}">${esc(s)}</button>`).join('')}</div></div>` : ''}
      ${colors.length > 1 ? `<div class="c-fgroup"><h4>Cor</h4><div class="c-swatches">${colors.map((c) => `<button type="button" class="c-swatch" data-fcolor="${esc(c.id)}" aria-pressed="${f.colors.has(c.id)}" title="${esc(c.name)}" aria-label="${esc(c.name)}"><i style="background:${esc(c.hex)}"></i></button>`).join('')}</div></div>` : ''}
      <div class="c-fgroup"><h4>Preço</h4><div class="c-range">
        <input class="c-input" type="number" inputmode="numeric" min="0" placeholder="De" data-fl="min" value="${esc(f.min)}" aria-label="Preço mínimo">
        <input class="c-input" type="number" inputmode="numeric" min="0" placeholder="Até" data-fl="max" value="${esc(f.max)}" aria-label="Preço máximo">
      </div></div>
      ${fits.length > 1 ? `<div class="c-fgroup"><h4>Modelagem</h4><select class="c-select" data-fl="fit" aria-label="Modelagem"><option value="">Todas</option>${fits.map((x) => `<option${x === f.fit ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></div>` : ''}
      ${brands.length > 1 ? `<div class="c-fgroup"><h4>Marca</h4><select class="c-select" data-fl="brand" aria-label="Marca"><option value="">Todas</option>${brands.map((b) => `<option value="${esc(b.id)}"${b.id === f.brand ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div>` : ''}
      ${drops.length ? `<div class="c-fgroup"><h4>Coleção</h4><select class="c-select" data-fl="drop" aria-label="Coleção"><option value="">Todas</option>${drops.map((b) => `<option value="${esc(b.id)}"${b.id === f.drop ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div>` : ''}
      <button type="button" class="c-btn ghost small" data-clear-filters>Limpar filtros</button>
    </div>`;
}

function treeOptions(list, value) {
  const set = new Set(list.map((c) => c.id));
  const out = [];
  const walk = (parent, depth) => {
    list.filter((c) => (c.parent_id || null) === parent).forEach((c) => {
      out.push(`<option value="${esc(c.id)}"${c.id === value ? ' selected' : ''}>${'— '.repeat(depth)}${esc(c.name)}</option>`);
      walk(c.id, depth + 1);
    });
  };
  walk(null, 0);
  list.filter((c) => c.parent_id && !set.has(c.parent_id)).forEach((c) => {
    out.push(`<option value="${esc(c.id)}"${c.id === value ? ' selected' : ''}>${esc(c.name)}</option>`);
  });
  return out.join('');
}

function viewList(title, base, intro = '') {
  setMeta(title, intro || store().tagline);
  return `
    <div class="c-wrap c-list-page">
      <div class="c-page-head"><h1>${esc(title)}</h1>${intro ? `<p>${esc(intro)}</p>` : ''}</div>
      <div class="c-list">
        <aside class="c-side" aria-label="Filtros">${filterPanel(base)}</aside>
        <div class="c-list-main" data-list-main></div>
      </div>
    </div>`;
}

function drawListMain(base) {
  const box = document.querySelector('[data-list-main]');
  if (!box) return;
  const list = applyFilters(base);
  const active = filters.sizes.size + filters.colors.size + (filters.promo ? 1 : 0) + (filters.available ? 1 : 0) + (filters.fit ? 1 : 0) + (filters.brand ? 1 : 0) + (filters.drop ? 1 : 0) + (filters.min !== '' ? 1 : 0) + (filters.max !== '' ? 1 : 0);
  box.innerHTML = `
    <div class="c-list-bar">
      <button class="c-btn ghost small only-m" data-open-filters>${icon('filter')} Filtrar${active ? ` (${active})` : ''}</button>
      <span class="c-found">${list.length} peça${list.length === 1 ? '' : 's'}${filters.q ? ` para "${esc(filters.q)}"` : ''}</span>
      <select class="c-select" data-fl="sort" aria-label="Ordenar">
        ${[['novos', 'Lançamentos'], ['vendidos', 'Mais vendidos'], ['menor', 'Menor preço'], ['maior', 'Maior preço']].map(([k, v]) => `<option value="${k}"${filters.sort === k ? ' selected' : ''}>${v}</option>`).join('')}
      </select>
    </div>
    ${list.length ? gridHTML(list.slice(0, filters.limit)) : `<div class="c-empty small"><h3>Nada com esses filtros</h3><p>Tente tirar algum.</p><button class="c-btn ghost small" data-clear-filters>Limpar filtros</button></div>`}
    ${list.length > filters.limit ? `<div class="c-more"><button class="c-btn ghost" data-more>Ver mais (${list.length - filters.limit})</button></div>` : ''}`;
}

function viewDrops() {
  setMeta('Drops', 'Lançamentos da Rota 44');
  const list = cat.collections || [];
  return `
    <div class="c-wrap">
      <div class="c-page-head"><h1>Drops</h1><p>Lançamentos e edições limitadas.</p></div>
      <div class="c-drops">
        ${list.map((d) => {
          const soon = d.launch_at && new Date(d.launch_at) > new Date();
          return `<a class="c-drop-card" href="#/drop/${esc(d.slug)}" ${d.banner_url ? `style="--banner:url('${esc(d.banner_url)}')"` : ''}>
            <span class="c-eyebrow">${soon ? 'Em breve' : d.limited ? 'Edição limitada' : 'No ar'}</span>
            <h2>${esc(d.name)}</h2>
            ${d.collab ? `<p>Collab com ${esc(d.collab)}</p>` : ''}
          </a>`;
        }).join('') || '<div class="c-empty small"><h3>Nenhum drop no momento</h3></div>'}
      </div>
    </div>`;
}

function viewDrop(slug) {
  const d = (cat.collections || []).find((x) => x.slug === slug);
  if (!d) return viewNotFound();
  setMeta(d.name, d.description);
  const products = (cat.products || []).filter((p) => p.collection_id === d.id);
  const soon = d.launch_at && new Date(d.launch_at) > new Date();
  return `
    <section class="c-drop-hero" ${d.banner_url ? `style="--banner:url('${esc(d.banner_url)}')"` : ''}>
      <div class="c-wrap">
        <span class="c-eyebrow">${soon ? 'Em breve' : d.limited ? 'Edição limitada' : 'Drop'}</span>
        <h1>${esc(d.name)}</h1>
        ${d.collab ? `<p class="c-collab">Collab com ${esc(d.collab)}</p>` : ''}
        ${d.description ? `<p>${esc(d.description)}</p>` : ''}
        ${soon ? countdownHTML(d.launch_at) : ''}
        ${d.limit_per_customer ? `<p class="c-note">Limite de ${d.limit_per_customer} por cliente.</p>` : ''}
      </div>
      ${DRIP}
    </section>
    <div class="c-wrap">
      ${(d.lookbook || []).length ? `<section class="c-sec"><div class="c-sec-head"><h2>Lookbook</h2></div><div class="c-look">${d.lookbook.map((u) => `<img src="${esc(u)}" alt="Lookbook ${esc(d.name)}" loading="lazy">`).join('')}</div></section>` : ''}
      <section class="c-sec">${products.length ? gridHTML(products) : '<div class="c-empty small"><h3>As peças aparecem aqui</h3></div>'}</section>
    </div>`;
}

function viewProduct(slug) {
  const p = (cat.products || []).find((x) => x.slug === slug);
  if (!p) return viewNotFound();
  setMeta(p.seo_title || p.name, p.seo_desc || p.short_desc || p.description);
  const s = store();
  const colors = colorsOf(p);
  const brand = idx.brands.get(p.brand_id);
  const chart = idx.charts.get(p.size_chart_id);
  const tree = p.category_id ? categoryIds(p.category_id) : null;
  const related = (cat.products || []).filter((x) => x.id !== p.id && !x.coming_soon && hasStock(x)
    && (x.collection_id && x.collection_id === p.collection_id || (tree && inCategory(x, tree)))).slice(0, 4);
  const crumb = p.category_id ? idx.categories.get(p.category_id) : null;
  const details = [
    ['Modelagem', p.fit], ['Tecido', p.fabric], ['Gramatura', p.gsm ? `${p.gsm} g/m²` : ''], ['Estampa / acabamento', p.print_type],
    ['Marca', brand?.name], ['Coleção', idx.collections.get(p.collection_id)?.name],
  ].filter(([, v]) => v);
  const { price, list } = productPrice(p);
  addLD(p, price);
  return `
    <div class="c-wrap c-pdp" data-pdp="${esc(p.id)}">
      <nav class="c-crumb" aria-label="Caminho"><a href="#/">Início</a>${crumb ? ` / <a href="#/c/${esc(crumb.slug)}">${esc(crumb.name)}</a>` : ''} / <span>${esc(p.name)}</span></nav>
      <div class="c-pdp-grid">
        <div class="c-gallery" data-gallery></div>
        <div class="c-buy">
          <div class="c-tags static">${cardBadges(p)}</div>
          <h1>${esc(p.name)}</h1>
          ${p.short_desc ? `<p class="c-short">${esc(p.short_desc)}</p>` : ''}
          ${p.coming_soon ? `
            <div class="c-soon-box"><b>Lança em</b>${countdownHTML(p.launch_at)}<p class="c-note">Antes da hora, a peça não pode ser pedida.</p></div>` : `
            <div class="c-pdp-price" data-price>
              ${price < list ? `<s>${esc(money(list))}</s>` : ''}
              <b>${esc(money(price))}</b>
              ${s.pix_discount_pct > 0 ? `<span>${esc(money(price * (1 - s.pix_discount_pct / 100)))} no Pix (${Number(s.pix_discount_pct)}% off)</span>` : ''}
              ${s.max_installments > 1 ? `<span>ou ${s.max_installments}× de ${esc(money(price / s.max_installments))}</span>` : ''}
            </div>
            ${colors.length ? `<div class="c-opt"><h4>Cor: <span data-color-name></span></h4><div class="c-swatches" data-colors></div></div>` : ''}
            <div class="c-opt">
              <div class="c-opt-head"><h4>Tamanho</h4>${chart ? '<button type="button" class="c-link" data-chart>Tabela de medidas</button>' : ''}</div>
              <div class="c-sizes big" data-sizes></div>
              <div class="c-stock-note" data-stock-note></div>
            </div>
            <div data-notify-box></div>
            <div class="c-actions">
              <button class="c-btn big" data-add>Colocar na sacola</button>
              <button class="c-btn wa big" data-buy-now>${icon('whatsapp')} Pedir no WhatsApp</button>
            </div>`}
          ${details.length ? `<dl class="c-specs">${details.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
          ${p.description ? `<details class="c-acc" open><summary>Descrição</summary><p>${esc(p.description)}</p></details>` : ''}
          ${p.wash_care ? `<details class="c-acc"><summary>Como lavar</summary><p>${esc(p.wash_care)}</p></details>` : ''}
          <details class="c-acc"><summary>Trocas</summary><p>${esc(s.exchange_policy || 'Fale com a loja.')}</p></details>
        </div>
      </div>
      ${related.length ? section('Compre o look', related, crumb ? `#/c/${crumb.slug}` : '#/loja') : ''}
    </div>`;
}

function addLD(p, price) {
  const el = document.createElement('script');
  el.type = 'application/ld+json';
  el.id = 'ld';
  el.textContent = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Product', name: p.name, description: p.short_desc || p.description || p.name,
    image: (p.images || []).map((i) => new URL(i.url, location.href).href),
    brand: idx.brands.get(p.brand_id)?.name,
    offers: { '@type': 'Offer', priceCurrency: 'BRL', price: Number(price).toFixed(2), availability: hasStock(p) ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock', url: location.href },
  });
  document.head.appendChild(el);
}

/** Interações da ficha: galeria por cor, cor e tamanho, sacola, avise-me. */
function wireProduct(view, p) {
  const colors = colorsOf(p);
  let colorId = colors.find((c) => (p.variants || []).some((v) => v.color_id === c.id && v.available))?.id || colors[0]?.id || null;
  let sizeId = null;
  let shot = 0;

  const imagesFor = () => {
    const all = p.images || [];
    const mine = all.filter((i) => i.color_id === colorId);
    const shared = all.filter((i) => !i.color_id);
    const list = [...mine, ...shared];
    return list.length ? list : all;
  };
  const gallery = view.querySelector('[data-gallery]');
  function drawGallery() {
    const list = imagesFor();
    const cur = list[Math.min(shot, list.length - 1)];
    gallery.innerHTML = `
      <div class="c-gal-main">${cur ? `<img src="${esc(cur.url)}" alt="${esc(p.name)}" fetchpriority="high">` : `<span class="c-noimg">${shield()}</span>`}
        <span class="c-tags">${cardBadges(p)}</span></div>
      ${list.length > 1 ? `<div class="c-gal-thumbs">${list.map((i, n) => `<button type="button" data-shot="${n}" aria-label="Foto ${n + 1}" aria-pressed="${n === shot}"><img src="${esc(thumbUrl(i.url))}" data-full="${esc(i.url)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}`;
  }
  const current = () => (p.variants || []).find((v) => v.color_id === colorId && v.size_id === sizeId) || null;
  function drawOptions() {
    const cBox = view.querySelector('[data-colors]');
    if (cBox) {
      cBox.innerHTML = colors.map((c) => {
        const any = (p.variants || []).some((v) => v.color_id === c.id && v.available);
        return `<button type="button" class="c-swatch ${any ? '' : 'off'}" data-color="${esc(c.id)}" aria-pressed="${c.id === colorId}" aria-label="${esc(c.name)}${any ? '' : ' (esgotada)'}" title="${esc(c.name)}"><i style="background:${esc(c.hex)}"></i></button>`;
      }).join('');
      view.querySelector('[data-color-name]').textContent = idx.colors.get(colorId)?.name || '';
    }
    const sBox = view.querySelector('[data-sizes]');
    if (sBox) {
      const vs = (p.variants || []).filter((v) => v.color_id === colorId);
      const ordered = vs.map((v) => ({ v, z: idx.sizes.get(v.size_id) })).sort((a, b) => (a.z?.sort || 0) - (b.z?.sort || 0));
      // tamanho sem estoque aparece riscado: o cliente precisa ver a grade inteira
      sBox.innerHTML = ordered.map(({ v, z }) => `<button type="button" class="c-size ${v.available ? '' : 'off'}" data-size="${esc(v.size_id)}" aria-pressed="${v.size_id === sizeId}" aria-label="Tamanho ${esc(z?.label)}${v.available ? '' : ' (esgotado)'}">${esc(z?.label)}</button>`).join('');
    }
    const v = current();
    const note = view.querySelector('[data-stock-note]');
    if (note) {
      note.textContent = !v ? '' : !v.available ? 'Esgotado neste tamanho.' : v.left ? `Restam ${v.left}!` : v.low ? 'Últimas unidades.' : '';
      note.className = `c-stock-note ${v && (!v.available || v.low) ? 'warn' : ''}`;
    }
    const box = view.querySelector('[data-notify-box]');
    if (box) {
      box.innerHTML = v && !v.available ? `
        <form class="c-notify" data-notify>
          <b>Avise-me quando chegar</b>
          <div class="c-range">
            <input class="c-input" name="name" placeholder="Seu nome" autocomplete="given-name" required aria-label="Seu nome">
            <input class="c-input" name="phone" inputmode="tel" placeholder="WhatsApp com DDD" autocomplete="tel" required aria-label="WhatsApp">
          </div>
          <button class="c-btn ghost small" type="submit">Quero ser avisado</button>
        </form>` : '';
    }
    const add = view.querySelector('[data-add]');
    const buy = view.querySelector('[data-buy-now]');
    if (add) { add.disabled = !!(v && !v.available); buy.disabled = add.disabled; }
  }

  function needSize() {
    const v = current();
    if (!v) { toast('Escolha o tamanho', 'warn'); view.querySelector('[data-sizes]')?.classList.add('shake'); setTimeout(() => view.querySelector('[data-sizes]')?.classList.remove('shake'), 500); return null; }
    if (!v.available) { toast('Esse tamanho esgotou', 'warn'); return null; }
    return v;
  }

  view.addEventListener('click', (e) => {
    const c = e.target.closest('[data-color]');
    if (c) { colorId = c.dataset.color; shot = 0; sizeId = null; drawGallery(); drawOptions(); return; }
    const z = e.target.closest('[data-size]');
    if (z) { sizeId = z.dataset.size; drawOptions(); return; }
    const t = e.target.closest('[data-shot]');
    if (t) { shot = Number(t.dataset.shot); drawGallery(); return; }
    if (e.target.closest('[data-chart]')) { openChart(idx.charts.get(p.size_chart_id)); return; }
    if (e.target.closest('[data-add]')) {
      const v = needSize();
      if (v) { addToBag(v.id); openBag(); }
      return;
    }
    if (e.target.closest('[data-buy-now]')) {
      const v = needSize();
      if (v) { addToBag(v.id); openBag({ checkout: true }); }
    }
  });
  view.addEventListener('submit', async (e) => {
    if (!e.target.matches('[data-notify]')) return;
    e.preventDefault();
    const form = e.target;
    const v = current();
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await rpc('notify_me', { p: { variant_id: v.id, name: form.name.value, phone: form.phone.value } });
      form.innerHTML = '<b>Fechou! A gente te avisa no WhatsApp.</b>';
    } catch (err) {
      toast(err.message, 'warn');
      btn.disabled = false;
    }
  });
  drawGallery();
  drawOptions();
}

function viewText(title, text, extra = '') {
  setMeta(title, text);
  return `
    <div class="c-wrap c-text">
      <div class="c-page-head"><h1>${esc(title)}</h1></div>
      <div class="c-prose">${String(text || 'Em breve.').split('\n').filter(Boolean).map((l) => `<p>${esc(l)}</p>`).join('')}${extra}</div>
    </div>`;
}

function viewContact() {
  const s = store();
  const wa = whatsappLink(s.whatsapp, 'Fala, Rota 44!');
  return viewText('Contato', s.tagline, `
    <ul class="c-contact">
      ${wa ? `<li><a class="c-btn wa" href="${esc(wa)}" target="_blank" rel="noopener">${icon('whatsapp')} Chamar no WhatsApp</a></li>` : ''}
      ${s.instagram ? `<li><b>Instagram:</b> <a href="https://instagram.com/${esc(s.instagram.replace('@', ''))}" target="_blank" rel="noopener">${esc(s.instagram)}</a></li>` : ''}
      ${s.email ? `<li><b>E-mail:</b> <a href="mailto:${esc(s.email)}">${esc(s.email)}</a></li>` : ''}
      ${s.address ? `<li><b>Endereço:</b> ${esc(s.address)}</li>` : ''}
      ${s.hours ? `<li><b>Horário:</b> ${esc(s.hours)}</li>` : ''}
    </ul>`);
}

const viewNotFound = () => {
  setMeta('Página não encontrada');
  return `<div class="c-wrap"><div class="c-empty">${shield()}<h2>Essa peça saiu de rota</h2><p>Ela pode ter esgotado ou mudado de endereço.</p><a class="c-btn" href="#/loja">Ver todas as peças</a></div></div>`;
};

/* -------------------------------------------------------------- modais -- */

function dialog(cls, html) {
  const d = document.createElement('dialog');
  d.className = `c-dialog ${cls}`;
  d.innerHTML = `${html}<div class="c-toasts" role="status" aria-live="polite"></div>`;
  document.body.appendChild(d);
  d.showModal();
  document.body.classList.add('c-locked');
  const close = () => { d.close(); d.remove(); if (!document.querySelector('dialog[open]')) document.body.classList.remove('c-locked'); };
  d.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-x]')) close(); });
  return { el: d, close };
}

function openChart(chart) {
  if (!chart) return;
  dialog('center', `
    <div class="c-sheet">
      <header><h2>${esc(chart.name)}</h2><button class="c-icon" data-x aria-label="Fechar">${icon('x')}</button></header>
      <div class="c-sheet-body">
        <div class="c-table"><table>
          <thead><tr><th>Tam.</th>${(chart.columns || []).map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
          <tbody>${(chart.rows || []).map((r) => `<tr><th>${esc(r.size)}</th>${(r.values || []).map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>
        ${chart.notes ? `<p class="c-note">${esc(chart.notes)}</p>` : ''}
      </div>
    </div>`);
}

function openFilters(base) {
  const m = dialog('left', `
    <div class="c-sheet">
      <header><h2>Filtrar</h2><button class="c-icon" data-x aria-label="Fechar">${icon('x')}</button></header>
      <div class="c-sheet-body">${filterPanel(base)}</div>
      <footer><button class="c-btn" data-x>Ver peças</button></footer>
    </div>`);
  wireFilters(m.el, base, () => { m.el.querySelector('.c-sheet-body').innerHTML = filterPanel(base); });
}

function wireFilters(scope, base, redrawPanel) {
  const after = () => { filters.limit = PAGE; drawListMain(base); };
  scope.addEventListener('change', (e) => {
    const k = e.target.dataset?.fl;
    if (!k) return;
    filters[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    after();
  });
  scope.addEventListener('click', (e) => {
    const z = e.target.closest('[data-fsize]');
    if (z) {
      const s = z.dataset.fsize;
      if (filters.sizes.has(s)) filters.sizes.delete(s); else filters.sizes.add(s);
      z.setAttribute('aria-pressed', String(filters.sizes.has(s)));
      after();
      return;
    }
    const c = e.target.closest('[data-fcolor]');
    if (c) {
      const id = c.dataset.fcolor;
      if (filters.colors.has(id)) filters.colors.delete(id); else filters.colors.add(id);
      c.setAttribute('aria-pressed', String(filters.colors.has(id)));
      after();
      return;
    }
    if (e.target.closest('[data-clear-filters]')) {
      const { q, cat: keepCat } = filters;
      filters = emptyFilters();
      filters.q = q;
      filters.cat = route().startsWith('c/') ? keepCat : '';
      redrawPanel();
      drawListMain(base);
    }
  });
}

function openMenu() {
  const tops = (cat.categories || []).filter((c) => !c.parent_id);
  const has = (c) => (cat.products || []).some((p) => inCategory(p, categoryIds(c.id)));
  const m = dialog('left', `
    <div class="c-sheet">
      <header><span class="c-logo">${shield()}<span>ROTA <b>44</b></span></span><button class="c-icon" data-x aria-label="Fechar">${icon('x')}</button></header>
      <nav class="c-sheet-body c-menu">
        <a href="#/loja" data-x>Todas as peças</a>
        ${(cat.collections || []).length ? '<a href="#/drops" data-x>Drops</a>' : ''}
        ${tops.filter(has).map((t) => `
          <details open><summary>${esc(t.name)}</summary>
            ${cat.categories.filter((c) => c.parent_id === t.id && has(c)).map((c) => `<a href="#/c/${esc(c.slug)}" data-x>${esc(c.name)}</a>`).join('')}
          </details>`).join('')}
        <hr><a href="#/sobre" data-x>Sobre</a><a href="#/trocas" data-x>Trocas</a><a href="#/contato" data-x>Contato</a>
      </nav>
    </div>`);
  return m;
}

/* -------------------------------------------------------------- sacola -- */

function openBag({ checkout = false } = {}) {
  let customer = {};
  try { customer = JSON.parse(localStorage.getItem(CUST_KEY)) || {}; } catch { /* */ }
  let coupon = null;
  let step = checkout ? 'form' : 'bag';
  const m = dialog('right', '<div class="c-sheet" data-sheet></div>');
  const sheet = m.el.querySelector('[data-sheet]');
  const s = store();

  function draw() {
    const lines = bagLines();
    const subtotal = bagTotal();
    const discount = coupon ? Number(coupon.discount) : 0;
    const total = round2(subtotal - discount);
    const freeShip = Number(s.free_shipping_over) > 0 ? Number(s.free_shipping_over) - total : null;
    if (!lines.length) step = 'bag';
    if (step === 'bag') {
      sheet.innerHTML = `
        <header><h2>Sacola ${lines.length ? `(${bagCount()})` : ''}</h2><button class="c-icon" data-x aria-label="Fechar">${icon('x')}</button></header>
        <div class="c-sheet-body">
          ${lines.length ? lines.map((l) => {
            const p = l.v.product;
            const c = idx.colors.get(l.v.color_id);
            const img = (p.images || []).find((i) => i.color_id === l.v.color_id)?.url || p.cover_url || p.images?.[0]?.url;
            return `
              <div class="c-line" data-line="${esc(l.variant_id)}">
                <a href="#/p/${esc(p.slug)}" data-x class="c-line-img">${photoTag(img, p.name)}</a>
                <div class="c-line-main">
                  <a href="#/p/${esc(p.slug)}" data-x class="c-line-name">${esc(p.name)}</a>
                  <span class="c-line-meta">${esc(c?.name)} · ${esc(idx.sizes.get(l.v.size_id)?.label)}</span>
                  ${!l.v.available ? '<span class="c-line-meta warn">Esgotou: a loja confirma</span>' : ''}
                  <div class="c-qty">
                    <button type="button" data-dec aria-label="Tirar uma">${icon('minus')}</button><b>${l.qty}</b><button type="button" data-inc aria-label="Mais uma">${icon('plus')}</button>
                  </div>
                </div>
                <div class="c-line-side"><b>${esc(money(l.qty * l.v.price))}</b><button type="button" class="c-link" data-rm>Tirar</button></div>
              </div>`;
          }).join('') : `<div class="c-empty small">${shield()}<h3>Sacola vazia</h3><p>Bora escolher umas peças?</p><a class="c-btn" href="#/loja" data-x>Ver as peças</a></div>`}
          ${lines.length ? `
            <form class="c-coupon" data-coupon>
              <input class="c-input" name="code" placeholder="Cupom" autocapitalize="characters" value="${esc(coupon?.code || '')}" aria-label="Cupom">
              <button class="c-btn ghost small" type="submit">Aplicar</button>
            </form>` : ''}
        </div>
        ${lines.length ? `
          <footer>
            ${discount ? `<div class="c-row"><span>Cupom ${esc(coupon.code)}</span><span>−${esc(money(discount))}</span></div>` : ''}
            ${freeShip !== null && freeShip > 0 ? `<div class="c-row small"><span>Faltam ${esc(money(freeShip))} para o frete grátis</span></div>` : ''}
            ${freeShip !== null && freeShip <= 0 ? '<div class="c-row small"><span>Frete grátis garantido!</span></div>' : ''}
            <div class="c-row total"><span>Total</span><b>${esc(money(total))}</b></div>
            <button class="c-btn wa big" data-next>${icon('whatsapp')} Pedir no WhatsApp</button>
          </footer>` : ''}`;
    } else {
      sheet.innerHTML = `
        <header><button class="c-icon" data-back aria-label="Voltar">${icon('chevronLeft')}</button><h2>Quase lá</h2><button class="c-icon" data-x aria-label="Fechar">${icon('x')}</button></header>
        <form class="c-sheet-body c-form" data-send id="c-send">
          <p class="c-note">Vamos abrir o WhatsApp com o seu pedido pronto. Lá você combina pagamento e entrega com a loja.</p>
          <label>Seu nome<input class="c-input" name="name" required autocomplete="name" value="${esc(customer.name || '')}"></label>
          <label>Seu WhatsApp (opcional)<input class="c-input" name="phone" inputmode="tel" autocomplete="tel" value="${esc(maskPhone(customer.phone || ''))}"></label>
          <label>Como quer receber
            <select class="c-select" name="delivery"><option>Retirar na loja</option><option>Motoboy</option><option>Correios</option><option>Combinar no WhatsApp</option></select></label>
          <label>Observação (opcional)<textarea class="c-input" name="notes" rows="2" maxlength="400"></textarea></label>
          <p class="c-note">Usamos seus dados só para atender este pedido. <a href="#/privacidade" data-x>Privacidade</a></p>
        </form>
        <footer>
          <div class="c-row total"><span>Total</span><b>${esc(money(total))}</b></div>
          <button class="c-btn wa big" type="submit" form="c-send">${icon('whatsapp')} Enviar pedido</button>
        </footer>`;
      const f = sheet.querySelector('[data-send]');
      f.phone.addEventListener('input', () => { f.phone.value = maskPhone(f.phone.value); });
    }
  }

  function message(res, form, lines) {
    const out = [`*Pedido${res?.number ? ` C${res.number}` : ''} - ${s.store_name || 'Rota 44'}*`, '', `Nome: ${form.name}`];
    const items = res?.items || lines.map((l) => ({
      name: l.v.product.name, color: idx.colors.get(l.v.color_id)?.name, size: idx.sizes.get(l.v.size_id)?.label, qty: l.qty, unit_price: l.v.price, available: l.v.available,
    }));
    out.push('');
    for (const i of items) {
      out.push(`• ${i.qty}× ${i.name} (${i.color}, ${i.size}): ${money(i.qty * i.unit_price)}${i.available === false ? ' ⚠ esgotou agora, confirmar' : ''}`);
    }
    out.push('');
    if (res?.discount > 0) out.push(`Cupom ${res.coupon_code}: −${money(res.discount)}`);
    out.push(`*Total: ${money(res?.total ?? bagTotal())}*`);
    out.push(`Entrega: ${form.delivery}`);
    if (form.notes) out.push(`Obs.: ${form.notes}`);
    return out.join('\n');
  }

  m.el.addEventListener('click', (e) => {
    const line = e.target.closest('[data-line]');
    if (line) {
      const it = bag.find((b) => b.variant_id === line.dataset.line);
      if (e.target.closest('[data-inc]')) { it.qty = Math.min(it.qty + 1, 20); saveBag(); draw(); return; }
      if (e.target.closest('[data-dec]')) { it.qty -= 1; if (it.qty <= 0) bag = bag.filter((b) => b !== it); saveBag(); draw(); return; }
      if (e.target.closest('[data-rm]')) { bag = bag.filter((b) => b !== it); saveBag(); draw(); return; }
    }
    if (e.target.closest('[data-next]')) { step = 'form'; draw(); return; }
    if (e.target.closest('[data-back]')) { step = 'bag'; draw(); }
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
        if (r.ok) { coupon = { code: r.code, discount: Number(r.discount) }; toast('Cupom aplicado'); draw(); }
        else { toast(r.error || 'Cupom inválido', 'warn'); btn.disabled = false; }
      } catch (err) { toast(err.message, 'warn'); btn.disabled = false; }
      return;
    }
    if (e.target.matches('[data-send]')) {
      const f = e.target;
      const form = { name: f.name.value.trim(), phone: onlyDigits(f.phone.value), delivery: f.delivery.value, notes: f.notes.value.trim() };
      if (!form.name) { toast('Informe seu nome', 'warn'); return; }
      if (!s.whatsapp) { toast('A loja ainda não configurou o WhatsApp. Tente mais tarde.', 'warn'); return; }
      const lines = bagLines();
      const btn = sheet.querySelector('[form="c-send"]');
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
      try { localStorage.setItem(CUST_KEY, JSON.stringify({ name: form.name, phone: form.phone })); } catch { /* */ }
      const url = whatsappLink(s.whatsapp, message(res, form, lines));
      if (tab) tab.location.href = url; else location.href = url;
      bag = [];
      saveBag();
      sheet.innerHTML = `
        <header><h2>Pedido enviado</h2><button class="c-icon" data-x aria-label="Fechar">${icon('x')}</button></header>
        <div class="c-sheet-body"><div class="c-empty small">${shield()}<h3>Valeu, ${esc(form.name.split(' ')[0])}!</h3>
          <p>Se o WhatsApp não abriu, toque no botão abaixo.</p>
          <a class="c-btn wa" href="${esc(url)}" target="_blank" rel="noopener">${icon('whatsapp')} Abrir o WhatsApp</a></div></div>`;
    }
  });
  draw();
}

/* -------------------------------------------------------------- rotas --- */

function renderRoute() {
  clearTimers();
  document.querySelectorAll('dialog.c-dialog').forEach((d) => { d.close(); d.remove(); });
  document.body.classList.remove('c-locked');
  const view = document.getElementById('c-view');
  if (!view) return;
  const fresh = view.cloneNode(false);
  view.replaceWith(fresh);

  const r = route();
  const [path, query] = r.split('?');
  const parts = path.split('/').filter(Boolean);
  const head = parts[0] || '';
  const products = cat.products || [];

  const list = (title, base, intro) => {
    fresh.innerHTML = viewList(title, base, intro);
    wireFilters(fresh.querySelector('.c-side'), base, () => { fresh.querySelector('.c-side').innerHTML = filterPanel(base); });
    drawListMain(base);
    fresh.addEventListener('change', (e) => {
      if (e.target.dataset?.fl === 'sort') { filters.sort = e.target.value; drawListMain(base); }
    });
    fresh.addEventListener('click', (e) => {
      if (e.target.closest('[data-more]')) { filters.limit += PAGE; drawListMain(base); return; }
      if (e.target.closest('[data-open-filters]')) { openFilters(base); return; }
      if (e.target.closest('[data-clear-filters]') && e.target.closest('[data-list-main]')) {
        const q = filters.q; const c = filters.cat;
        filters = emptyFilters(); filters.q = q; filters.cat = head === 'c' ? c : '';
        fresh.querySelector('.c-side').innerHTML = filterPanel(base);
        drawListMain(base);
      }
    });
  };

  if (head === 'loja' || head === 'busca') {
    const q = head === 'busca' ? decodeURIComponent(parts[1] || '') : '';
    filters = emptyFilters();
    filters.q = q;
    if (query === 'promo') filters.promo = true;
    list(q ? 'Busca' : 'Todas as peças', products.filter((p) => !p.coming_soon));
  } else if (head === 'c') {
    const c = (cat.categories || []).find((x) => x.slug === parts[1]);
    if (!c) { fresh.innerHTML = viewNotFound(); } else {
      filters = emptyFilters();
      filters.cat = c.id;
      const tree = categoryIds(c.id);
      list(c.name, products.filter((p) => !p.coming_soon && inCategory(p, tree)), c.description);
    }
  } else if (head === 'p') {
    fresh.innerHTML = viewProduct(parts[1]);
    const p = products.find((x) => x.slug === parts[1]);
    if (p && !p.coming_soon) wireProduct(fresh, p);
    else if (p) {
      const g = fresh.querySelector('[data-gallery]');
      const img = p.cover_url || p.images?.[0]?.url;
      g.innerHTML = `<div class="c-gal-main">${img ? `<img src="${esc(img)}" alt="${esc(p.name)}">` : `<span class="c-noimg">${shield()}</span>`}</div>`;
    }
  } else if (head === 'drops') fresh.innerHTML = viewDrops();
  else if (head === 'drop') fresh.innerHTML = viewDrop(parts[1]);
  else if (head === 'sobre') fresh.innerHTML = viewText('Sobre a Rota 44', store().about);
  else if (head === 'trocas') fresh.innerHTML = viewText('Trocas e devoluções', store().exchange_policy);
  else if (head === 'frete') fresh.innerHTML = viewText('Frete e entrega', store().shipping_info);
  else if (head === 'privacidade') fresh.innerHTML = viewText('Política de privacidade', store().privacy_policy);
  else if (head === 'contato') fresh.innerHTML = viewContact();
  else if (!head) fresh.innerHTML = viewHome();
  else fresh.innerHTML = viewNotFound();

  startCountdowns(fresh);
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function wireShell() {
  ROOT.addEventListener('click', (e) => {
    if (e.target.closest('[data-theme]')) { toggleTheme(); return; }
    if (e.target.closest('[data-bag]')) { openBag(); return; }
    if (e.target.closest('[data-menu]')) openMenu();
  });
  ROOT.addEventListener('submit', (e) => {
    if (!e.target.matches('[data-search]')) return;
    e.preventDefault();
    const q = e.target.q.value.trim();
    if (q) go(`#/busca/${encodeURIComponent(q)}`);
  });
  window.addEventListener('hashchange', renderRoute);
}

function viewClosed() {
  const s = store();
  const wa = whatsappLink(s.whatsapp, 'Fala, Rota 44!');
  ROOT.innerHTML = `
    <section class="c-hero full"><div class="c-hero-in column">
      <img class="c-hero-shield" src="assets/brand/escudo.svg" alt="Rota 44" width="220" height="258">
      <div class="c-hero-text center"><h1>Volta já</h1><p>O catálogo está fechado por enquanto.</p>
        ${wa ? `<a class="c-btn wa" href="${esc(wa)}" target="_blank" rel="noopener">${icon('whatsapp')} Falar com a loja</a>` : ''}</div>
    </div></section>`;
}

async function boot() {
  try {
    cat = await loadCatalog();
  } catch (err) {
    console.error(err);
    if (['PGRST202', 'PGRST205', '42883'].includes(err.code)) {
      ROOT.innerHTML = `<div class="c-empty">${shield()}<h2>Loja em preparação</h2><p>O catálogo entra no ar em breve.</p></div>`;
    } else {
      capture(err, { where: 'catalog:boot' });
      ROOT.innerHTML = `<div class="c-empty">${shield()}<h2>Sem conexão</h2><p>Não consegui carregar as peças. Confira a internet.</p><button class="c-btn" onclick="location.reload()" data-reload>Tentar de novo</button></div>`;
      ROOT.querySelector('[data-reload]')?.removeAttribute('onclick');
      ROOT.querySelector('[data-reload]')?.addEventListener('click', () => location.reload());
    }
    return;
  }
  if (!cat.open) { viewClosed(); return; }
  indexCatalog();
  // peça que sumiu do catálogo não fica na sacola
  bag = bag.filter((i) => idx.variants.has(i.variant_id));
  shell();
  renderRoute();
}

initTelemetry();
setSender((rows) => rpc('log_client_error', { p: rows }));
installThumbFallback();
wireShell();
boot();
