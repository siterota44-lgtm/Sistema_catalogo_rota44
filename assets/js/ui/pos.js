/**
 * PDV: a venda de balcão e o pedido online saem daqui.
 *  - leitor de código de barras (USB ou câmera) adiciona direto;
 *  - a grade cor × tamanho mostra o que tem;
 *  - o carrinho é um rascunho no aparelho: fechar a tela não perde a venda;
 *  - o preço e o total de verdade quem calcula é o banco (save_sale).
 */

import * as Data from '../core/data.js';
import { esc, money, parseMoney, uid, todayISO, addDays, maskPhone, debounce } from '../core/utils.js';
import { cartTotals, round2 } from '../core/calc.js';
import { CHANNELS, DELIVERY, PAYMENT_METHODS } from '../core/constants.js';
import { friendlyError, needsApproval } from '../core/errors.js';
import { icon } from './icons.js';
import { toast, toastError, openModal, confirmDialog, withLoading } from './kit.js';
import { $, $$, moneyHTML, photo, options, optionsMap, field, moneyInput, categoryOptions, emptyBox, dot } from './common.js';
import { openScanner } from './scanner.js';
import { pickCustomer } from './customers.js';
import { openReceipt } from './receipt.js';
import { openCashOpen } from './cash.js';

const KEY = 'rota44.cart';

const emptyCart = () => ({
  items: [], customer_id: '', customer_name: '', customer_phone: '',
  discount_value: 0, coupon_code: '', coupon_discount: 0, use_pix: false,
  mode: 'balcao', channel: 'balcao', delivery_method: 'balcao', shipping_fee: 0, address: '', notes: '',
  request_id: '', seller_id: '', client_ref: uid(),
});

let cart = readCart();

function readCart() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY));
    if (c && Array.isArray(c.items)) return { ...emptyCart(), ...c };
  } catch { /* armazenamento bloqueado */ }
  return emptyCart();
}
function saveCart() {
  try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch { /* modo privado */ }
}

/** Outras telas mandam um carrinho pronto (ex.: pedido do catálogo vira venda). */
export function prefillCart(partial) {
  cart = { ...emptyCart(), ...partial };
  saveCart();
}

export function mount(host) {
  let category = '';
  let query = '';
  let limit = 60;
  let showCart = false;

  host.innerHTML = `
    <div class="view pdv" data-pos>
      <section class="pos-left">
        <div class="pos-scan">
          <input class="input" data-scan placeholder="Bipe o código, digite SKU ou nome…" autocomplete="off" enterkeyhint="search" aria-label="Buscar produto">
          <button class="btn" data-camera title="Ler código com a câmera">${icon('camera')}<span class="hide-mobile">Câmera</span></button>
        </div>
        <div class="toolbar">
          <select class="select" data-cat aria-label="Categoria">${categoryOptions('', { empty: 'Todas as categorias' })}</select>
          <span class="spacer"></span>
          <span class="small dim" data-found></span>
        </div>
        <div class="pos-grid" data-grid></div>
        <div data-more-host></div>
      </section>
      <aside class="pos-right" data-cart></aside>
      <div class="pos-mobilebar" data-mobilebar></div>
    </div>`;

  const root = $('[data-pos]', host);
  const scan = $('[data-scan]', host);

  function rankedProducts() {
    const rank = Data.salesRank();
    let list = Data.searchProducts(query).filter((p) => p.status === 'ativo' && Data.variantsOf(p.id).some((v) => v.active));
    if (category) {
      const tree = Data.categoryTree(category);
      list = list.filter((p) => tree.has(p.category_id));
    }
    return [...list].sort((a, b) => (rank.get(b.id) || 0) - (rank.get(a.id) || 0) || a.name.localeCompare(b.name));
  }

  function renderGrid() {
    const list = rankedProducts();
    $('[data-found]', host).textContent = `${list.length} produto${list.length === 1 ? '' : 's'}`;
    const grid = $('[data-grid]', host);
    if (!list.length) {
      grid.innerHTML = `<div style="grid-column:1/-1">${emptyBox('Nenhum produto', 'Cadastre em Produtos ou troque a busca.')}</div>`;
      $('[data-more-host]', host).innerHTML = '';
      return;
    }
    grid.innerHTML = list.slice(0, limit).map((p) => {
      const stock = Data.productStock(p.id);
      const { min } = Data.priceRange(p.id);
      return `
        <button class="pos-card" data-product="${esc(p.id)}">
          <span class="pos-photo">${photo(Data.coverOf(p), p.name)}</span>
          <span class="pos-info">
            <span class="pos-name">${esc(p.name)}</span>
            <span class="pos-price money-sensitive">${esc(money(min))}</span>
            <span class="pos-stock ${stock <= 0 ? 'tone-danger' : ''}">${stock <= 0 ? 'Sem estoque' : `${stock} disponíve${stock === 1 ? 'l' : 'is'}`}</span>
          </span>
        </button>`;
    }).join('');
    $('[data-more-host]', host).innerHTML = list.length > limit
      ? `<div class="more-row"><button class="btn" data-more>Mostrar mais (${list.length - limit})</button></div>` : '';
  }

  /* --------------------------------------------------------- carrinho -- */

  /* Só gerente e admin lançam em nome de outro; o banco confere de novo. */
  function sellers() {
    if (!Data.hasRole('admin', 'gerente')) return [];
    return Data.members().filter((m) => m.active && ['admin', 'gerente', 'vendedor'].includes(m.role));
  }

  function openSeller() {
    const m = openModal({
      title: 'Vendedor da venda',
      subtitle: 'A comissão vai para quem está aqui',
      sheet: true,
      body: `<div class="form-grid">${field('Vendedor', `<select class="select" name="seller">${options(sellers(), cart.seller_id || Data.who().user_id, { empty: false, label: (x) => x.nome, val: (x) => x.user_id })}</select>`)}</div>`,
      footer: '<button class="btn btn-primary" data-ok>Usar</button>',
    });
    m.foot.querySelector('[data-ok]').addEventListener('click', () => {
      cart.seller_id = m.panel.querySelector('[name=seller]').value;
      m.close();
      renderCart();
    });
  }

  function linePrice(it) {
    const v = Data.variant(it.variant_id);
    return v ? Data.priceFor(v).price : 0;
  }
  function totals() {
    return cartTotals({
      items: cart.items.map((i) => ({ qty: i.qty, unit_price: linePrice(i), discount_value: i.discount_value })),
      discount: cart.discount_value,
      coupon: cart.coupon_discount,
      usePix: cart.use_pix,
      pixPct: Data.settings().pix_discount_pct,
      shipping: cart.shipping_fee,
    });
  }

  function renderCart() {
    const box = $('[data-cart]', host);
    const t = totals();
    const pieces = cart.items.reduce((s, i) => s + i.qty, 0);
    box.innerHTML = `
      <div class="cart-head">
        <h3>${cart.mode === 'pedido' ? 'Pedido online' : 'Venda'} ${pieces ? `· ${pieces} ${pieces === 1 ? 'peça' : 'peças'}` : ''}</h3>
        <div class="row gap-1">
          <button class="btn btn-ghost btn-sm only-mobile-cart" data-back-products>${icon('chevronLeft')} Produtos</button>
          ${cart.items.length ? `<button class="icon-btn sm" data-clear aria-label="Limpar venda" title="Limpar venda">${icon('trash')}</button>` : ''}
        </div>
      </div>
      <div class="cart-items">
        ${cart.items.length ? cart.items.map((it, i) => {
          const v = Data.variant(it.variant_id);
          if (!v) return '';
          const p = Data.product(v.product_id);
          const c = Data.color(v.color_id);
          const unit = linePrice(it);
          const total = it.qty * unit - (Number(it.discount_value) || 0);
          return `
            <div class="cart-item" data-line="${i}">
              ${v ? `<img class="cart-thumb" src="${esc(Data.photoOf(v) || 'assets/brand/escudo.svg')}" alt="" loading="lazy">` : ''}
              <div class="grow" style="min-width:0">
                <div class="cart-name">${esc(p?.name || '-')}</div>
                <div class="cart-meta">${dot(c?.hex)} ${esc(c?.name || '')} · <b>${esc(Data.size(v.size_id)?.label || '')}</b></div>
                <div class="cart-qty">
                  <button class="icon-btn sm" data-dec aria-label="Tirar uma">${icon('minus')}</button>
                  <b>${it.qty}</b>
                  <button class="icon-btn sm" data-inc aria-label="Mais uma">${icon('plus')}</button>
                </div>
              </div>
              <div class="cart-side">
                <span class="strong money-sensitive">${esc(money(total))}</span>
                ${Number(it.discount_value) > 0 ? `<span class="xs tone-danger">−${esc(money(it.discount_value))}</span>` : ''}
                <button class="btn btn-ghost btn-sm" data-line-edit>Desconto</button>
              </div>
            </div>`;
        }).join('') : `<div class="empty compact"><h3>Carrinho vazio</h3><p>Bipe uma peça ou escolha ao lado.</p></div>`}
      </div>
      <div class="cart-foot">
        <div class="cart-tools">
          <button class="chip sm" data-customer>${icon('users')} ${cart.customer_name ? esc(cart.customer_name) : 'Cliente'}</button>
          ${sellers().length > 1 ? `<button class="chip sm" data-seller>${icon('tag')} ${esc(Data.memberName(cart.seller_id || Data.who().user_id))}</button>` : ''}
          <button class="chip sm" data-discount>${icon('tag')} ${t.manual > 0 ? `−${esc(money(t.manual))}` : 'Desconto'}</button>
          <button class="chip sm" data-coupon>${cart.coupon_code ? esc(cart.coupon_code) : 'Cupom'}</button>
          <button class="chip sm ${cart.mode === 'pedido' ? 'is-on' : ''}" data-mode>${icon('truck')} ${cart.mode === 'pedido' ? 'Pedido online' : 'É pedido online?'}</button>
        </div>
        ${t.itemsDiscount || t.manual || t.coupon || t.shipping || t.pix ? `
          <div class="cart-row"><span>Produtos</span><span class="num money-sensitive">${esc(money(t.gross))}</span></div>
          ${t.itemsDiscount + t.manual > 0 ? `<div class="cart-row"><span>Descontos (${t.manualPct}%)</span><span class="num money-sensitive">−${esc(money(t.itemsDiscount + t.manual))}</span></div>` : ''}
          ${t.coupon > 0 ? `<div class="cart-row"><span>Cupom ${esc(cart.coupon_code)}</span><span class="num money-sensitive">−${esc(money(t.coupon))}</span></div>` : ''}
          ${t.pix > 0 ? `<div class="cart-row"><span>Desconto Pix</span><span class="num money-sensitive">−${esc(money(t.pix))}</span></div>` : ''}
          ${t.shipping > 0 ? `<div class="cart-row"><span>Frete</span><span class="num money-sensitive">${esc(money(t.shipping))}</span></div>` : ''}` : ''}
        <div class="cart-row total"><span>Total</span><span class="money-sensitive">${esc(money(t.total))}</span></div>
        <button class="btn btn-primary btn-lg btn-block" data-checkout ${cart.items.length ? '' : 'disabled'}>
          ${cart.mode === 'pedido' ? 'Salvar pedido' : 'Receber'}
        </button>
      </div>`;

    const bar = $('[data-mobilebar]', host);
    bar.innerHTML = `
      <div class="col"><span class="xs dim">${pieces} ${pieces === 1 ? 'peça' : 'peças'}</span><b class="money-sensitive" style="font-size:1.25rem">${esc(money(t.total))}</b></div>
      <button class="btn btn-primary" data-toggle-cart ${pieces ? '' : 'disabled'}>Ver venda</button>`;
    bar.style.display = showCart ? 'none' : '';
    root.classList.toggle('show-cart', showCart);
    saveCart();
  }

  function addVariant(v, qty = 1) {
    const line = cart.items.find((i) => i.variant_id === v.id);
    const have = (line?.qty || 0) + qty;
    if (v.available < have && Data.settings().block_negative_stock) {
      toast('Sem estoque disso', { kind: 'warn', text: `${Data.variantTitle(v)}: disponível ${Math.max(v.available, 0)}.` });
      return false;
    }
    if (line) line.qty = have;
    else cart.items.push({ variant_id: v.id, qty, discount_value: 0 });
    // desconto de cupom muda com o total: confere de novo ao fechar
    renderCart();
    return true;
  }

  function openVariantPicker(p) {
    const vs = Data.variantsOf(p.id).filter((v) => v.active);
    if (vs.length === 1) {
      if (addVariant(vs[0])) toast('Adicionado', { duration: 1200 });
      return;
    }
    const colorIds = [...new Set(vs.map((v) => v.color_id))];
    const sizeIds = [...new Set(vs.map((v) => v.size_id))].sort((a, b) => (Data.size(a)?.sort || 0) - (Data.size(b)?.sort || 0));
    const m = openModal({
      title: p.name,
      subtitle: `${money(Data.priceRange(p.id).min)} · toque no tamanho para adicionar`,
      size: 'lg',
      sheet: true,
      body: `
        <div class="grid-matrix"><table>
          <thead><tr><th></th>${sizeIds.map((s) => `<th>${esc(Data.size(s)?.label)}</th>`).join('')}</tr></thead>
          <tbody>
            ${colorIds.map((c) => `<tr>
              <th><span class="with-dot">${dot(Data.color(c)?.hex)} ${esc(Data.color(c)?.name)}</span></th>
              ${sizeIds.map((s) => {
                const v = vs.find((x) => x.color_id === c && x.size_id === s);
                if (!v) return '<td></td>';
                const lvl = Data.level(v);
                return `<td><button class="grid-cell ${lvl === 'zerado' ? 'is-out' : lvl === 'baixo' ? 'is-low' : 'is-ok'}" data-v="${esc(v.id)}"
                   ${v.available <= 0 && Data.settings().block_negative_stock ? 'disabled' : ''} aria-label="${esc(Data.color(c)?.name)} ${esc(Data.size(s)?.label)}: ${v.available} disponíveis">${v.available}</button></td>`;
              }).join('')}
            </tr>`).join('')}
          </tbody>
        </table></div>
        <p class="xs dim" style="margin-top:8px">O número é o disponível (físico − reservado).</p>`,
      footer: '<button class="btn btn-primary" data-close>Pronto</button>',
    });
    m.panel.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      if (addVariant(Data.variant(b.dataset.v))) toast('Adicionado', { duration: 1000 });
    });
  }

  function handleCode(raw) {
    const code = String(raw || '').trim();
    if (!code) return false;
    const v = Data.findByCode(code);
    if (v) {
      if (addVariant(v)) toast(Data.variantTitle(v), { duration: 1400 });
      return true;
    }
    return false;
  }

  /* ----------------------------------------------------------- ações --- */

  function openLineEdit(i) {
    const it = cart.items[i];
    const unit = linePrice(it);
    const m = openModal({
      title: 'Desconto no item',
      subtitle: Data.variantTitle(Data.variant(it.variant_id)),
      body: `
        <p class="small muted" style="margin-bottom:10px">${it.qty} × ${esc(money(unit))} = ${esc(money(it.qty * unit))}</p>
        <div class="form-grid">
          ${field('Desconto em R$', moneyInput('value', it.discount_value, 'data-autofocus'), 6)}
          ${field('ou em %', '<input class="input" name="pct" type="number" inputmode="decimal" min="0" max="100" step="1">', 6)}
        </div>`,
      footer: '<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Aplicar</button>',
    });
    m.foot.querySelector('[data-ok]').addEventListener('click', () => {
      const pct = Number(m.panel.querySelector('[name=pct]').value) || 0;
      const val = pct > 0 ? round2(it.qty * unit * pct / 100) : parseMoney(m.panel.querySelector('[name=value]').value);
      it.discount_value = Math.min(val, it.qty * unit);
      m.close();
      renderCart();
    });
  }

  function openDiscount() {
    const t = totals();
    const m = openModal({
      title: 'Desconto na venda',
      subtitle: `Seu limite: ${Data.who().discount_limit ?? 0}%. Acima disso, pede a senha do gerente.`,
      body: `
        <div class="form-grid">
          ${field('Em R$', moneyInput('value', cart.discount_value, 'data-autofocus'), 6)}
          ${field('ou em %', '<input class="input" name="pct" type="number" inputmode="decimal" min="0" max="100" step="1">', 6)}
        </div>`,
      footer: '<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Aplicar</button>',
    });
    m.foot.querySelector('[data-ok]').addEventListener('click', () => {
      const pct = Number(m.panel.querySelector('[name=pct]').value) || 0;
      const base = t.gross - t.itemsDiscount;
      cart.discount_value = pct > 0 ? round2(base * pct / 100) : Math.min(parseMoney(m.panel.querySelector('[name=value]').value), base);
      cart.coupon_discount = 0;
      if (cart.coupon_code) { cart.coupon_code = ''; toast('Cupom retirado', { kind: 'info', text: 'Aplique de novo depois do desconto.' }); }
      m.close();
      renderCart();
    });
  }

  function openCoupon() {
    const t = totals();
    const m = openModal({
      title: 'Cupom',
      body: `
        <div class="form-grid">${field('Código', `<input class="input" name="code" autocapitalize="characters" value="${esc(cart.coupon_code)}" data-autofocus>`)}</div>`,
      footer: `<button class="btn" data-remove>Tirar cupom</button><button class="btn btn-primary" data-ok>Aplicar</button>`,
    });
    m.foot.querySelector('[data-remove]').addEventListener('click', () => {
      cart.coupon_code = ''; cart.coupon_discount = 0; m.close(); renderCart();
    });
    const ok = m.foot.querySelector('[data-ok]');
    ok.addEventListener('click', () => withLoading(ok, async () => {
      const code = m.panel.querySelector('[name=code]').value.trim().toUpperCase();
      if (!code) return;
      try {
        const r = await Data.checkCoupon(code, t.gross - t.itemsDiscount - t.manual, cart.customer_id || null);
        cart.coupon_code = code;
        cart.coupon_discount = Number(r.discount);
        m.close();
        renderCart();
      } catch (err) {
        toastError('Cupom não aplicado', friendlyError(err));
      }
    }));
  }

  function openOnlineMode() {
    const m = openModal({
      title: 'Pedido online',
      subtitle: 'A peça fica reservada até o pagamento. A reserva expira sozinha.',
      body: `
        <div class="form-grid">
          ${field('Canal', `<select class="select" name="channel">${optionsMap({ whatsapp: CHANNELS.whatsapp, instagram: CHANNELS.instagram, site: CHANNELS.site, marketplace: CHANNELS.marketplace, outro: CHANNELS.outro }, cart.channel === 'balcao' ? 'whatsapp' : cart.channel)}</select>`, 6)}
          ${field('Entrega', `<select class="select" name="delivery">${optionsMap({ retirada: DELIVERY.retirada, motoboy: DELIVERY.motoboy, correios: DELIVERY.correios, transportadora: DELIVERY.transportadora }, cart.delivery_method === 'balcao' ? 'retirada' : cart.delivery_method)}</select>`, 6)}
          ${field('Frete cobrado', moneyInput('shipping', cart.shipping_fee), 6)}
          ${field('Endereço', `<input class="input" name="address" value="${esc(cart.address)}">`, 12)}
          ${field('Observação', `<input class="input" name="notes" value="${esc(cart.notes)}">`, 12)}
        </div>`,
      footer: `
        ${cart.mode === 'pedido' ? '<button class="btn" data-off>Voltar para balcão</button>' : '<button class="btn" data-close>Cancelar</button>'}
        <button class="btn btn-primary" data-ok>Usar pedido online</button>`,
    });
    m.foot.querySelector('[data-off]')?.addEventListener('click', () => {
      Object.assign(cart, { mode: 'balcao', channel: 'balcao', delivery_method: 'balcao', shipping_fee: 0, address: '' });
      m.close();
      renderCart();
    });
    m.foot.querySelector('[data-ok]').addEventListener('click', () => {
      const q = (n) => m.panel.querySelector(`[name=${n}]`).value;
      Object.assign(cart, { mode: 'pedido', channel: q('channel'), delivery_method: q('delivery'), shipping_fee: parseMoney(q('shipping')), address: q('address').trim(), notes: q('notes').trim() });
      m.close();
      renderCart();
    });
  }

  /* -------------------------------------------------------- finalizar --- */

  function basePayload() {
    return {
      client_ref: cart.client_ref,
      sale_date: todayISO(),
      channel: cart.channel,
      customer_id: cart.customer_id || null,
      customer_name: cart.customer_name,
      customer_phone: cart.customer_phone,
      seller_id: cart.seller_id || null,
      items: cart.items.map((i) => ({ variant_id: i.variant_id, qty: i.qty, discount_value: i.discount_value })),
      discount_value: cart.discount_value,
      coupon_code: cart.coupon_code,
      shipping_fee: cart.shipping_fee,
      delivery_method: cart.delivery_method,
      address: cart.address,
      notes: cart.notes,
      request_id: cart.request_id || null,
    };
  }

  async function submit(payload, modal) {
    try {
      const r = await Data.saveSale(payload);
      modal?.close();
      const number = r.number;
      cart = emptyCart();
      saveCart();
      showCart = false;
      renderCart();
      renderGrid();
      toast(`Venda #${number} gravada`);
      openReceipt(r.id);
      return true;
    } catch (err) {
      if (needsApproval(err)) {
        const approval = await askManagerPin(totals().manualPct);
        if (approval) return submit({ ...payload, approval_id: approval }, modal);
        return false;
      }
      if (/Abra o caixa/.test(err.message)) {
        toast('Caixa fechado', { kind: 'warn', text: 'Abra o caixa e confirme de novo.' });
        openCashOpen();
        return false;
      }
      toastError('Não consegui gravar a venda', friendlyError(err));
      return false;
    }
  }

  async function checkout() {
    if (cart.mode === 'pedido') {
      const btn = $('[data-checkout]', host);
      await withLoading(btn, () => submit({ ...basePayload(), status: 'aguardando_pagamento' }));
      return;
    }
    openPayment();
  }

  function openPayment() {
    const s = Data.settings();
    let lines = [];
    let method = 'pix';
    let pixOn = cart.use_pix;
    let cred = null;

    const total = () => {
      cart.use_pix = pixOn;
      return totals().total;
    };
    const paid = () => round2(lines.reduce((sum, l) => sum + l.amount, 0));
    const rest = () => round2(total() - paid());

    const m = openModal({
      title: 'Receber',
      size: 'lg',
      body: '<div data-pay></div>',
      footer: '<button class="btn" data-close>Voltar</button><button class="btn btn-primary btn-lg" data-finish>Finalizar venda</button>',
      onClose: () => { cart.use_pix = pixOn; renderCart(); },
    });
    const body = $('[data-pay]', m.panel);

    function draw() {
      const r = rest();
      const creditOk = !!cart.customer_id;
      body.innerHTML = `
        <div class="col gap-4">
          <div class="pay-big money-sensitive">${esc(money(total()))}</div>
          ${s.pix_discount_pct > 0 ? `<label class="check" style="justify-content:center"><input type="checkbox" data-pix ${pixOn ? 'checked' : ''}><span class="box"></span><span>${s.pix_discount_pct}% de desconto no Pix (tudo no Pix)</span></label>` : ''}
          ${lines.length ? `<div class="pay-list">
            ${lines.map((l, i) => `<div class="pay-line">
              <span>${esc(PAYMENT_METHODS[l.method].label)}${l.installments > 1 ? ` ${l.installments}×` : ''}${l.credit_code ? ` <span class="sku">${esc(l.credit_code)}</span>` : ''}${l.change_given ? ` <span class="xs dim">troco ${esc(money(l.change_given))}</span>` : ''}</span>
              <span class="row gap-2"><b class="num money-sensitive">${esc(money(l.amount))}</b><button class="icon-btn sm" data-rm-line="${i}" aria-label="Tirar">${icon('x')}</button></span>
            </div>`).join('')}
          </div>` : ''}
          ${cred ? `<div class="alert" data-kind="info">${icon('calendar')}<div>Crediário: ${cred.installments}× a partir de ${esc(cred.first_due.split('-').reverse().join('/'))}. <button class="link-btn" data-rm-cred>Tirar</button></div></div>` : ''}
          ${r > 0.005 && !cred ? `
            <div class="fieldset">
              <div class="method-grid">
                ${['pix', 'dinheiro', 'debito', 'credito', 'vale_troca', 'crediario'].map((k) => `
                  <button type="button" data-method="${k}" aria-pressed="${method === k}">${icon(PAYMENT_METHODS[k].icon)}${esc(PAYMENT_METHODS[k].label)}</button>`).join('')}
              </div>
              <div class="form-grid" data-method-form></div>
            </div>` : ''}
          <div class="cart-row" style="font-size:var(--fs-base)"><b>${r > 0.005 ? 'Falta receber' : 'Tudo recebido'}</b><b class="num money-sensitive ${r > 0.005 ? 'tone-danger' : 'tone-ok'}">${esc(money(Math.max(r, 0)))}</b></div>
        </div>`;
      const form = $('[data-method-form]', body);
      if (!form) return;
      if (method === 'crediario') {
        form.innerHTML = creditOk ? `
          ${field('Parcelas', `<select class="select" name="inst">${[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => `<option value="${n}">${n}×</option>`).join('')}</select>`, 6)}
          ${field('1º vencimento', `<input class="input" type="date" name="due" value="${todayISO(addDays(new Date(), 30))}">`, 6)}
          <div class="span-12"><button type="button" class="btn btn-block" data-add>Parcelar ${esc(money(r))}</button></div>`
          : `<div class="span-12 alert" data-kind="warn">${icon('alert')}<div>Crediário precisa de cliente. Escolha o cliente na venda.</div></div>`;
      } else {
        form.innerHTML = `
          ${field(method === 'dinheiro' ? 'Valor recebido' : 'Valor', moneyInput('amount', r, 'data-autofocus'), method === 'credito' || method === 'vale_troca' ? 6 : 12)}
          ${method === 'credito' ? field('Parcelas', `<select class="select" name="inst">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}×</option>`).join('')}</select>`, 6) : ''}
          ${method === 'vale_troca' ? field('Código do vale', '<input class="input" name="code" autocapitalize="characters">', 6) : ''}
          <div class="span-12 small muted" data-change></div>
          <div class="span-12"><button type="button" class="btn btn-block" data-add>Lançar</button></div>`;
        if (method === 'dinheiro') {
          const updateChange = () => {
            const v = parseMoney($('[name=amount]', form).value);
            $('[data-change]', form).innerHTML = v > r ? `Troco: <b class="num">${esc(money(v - r))}</b>` : '';
          };
          $('[name=amount]', form).addEventListener('input', updateChange);
        }
      }
    }

    body.addEventListener('change', (e) => {
      if (e.target.matches('[data-pix]')) {
        pixOn = e.target.checked;
        if (pixOn) { lines = []; cred = null; method = 'pix'; }
        draw();
      }
    });
    body.addEventListener('click', async (e) => {
      const mb = e.target.closest('[data-method]');
      if (mb) {
        method = mb.dataset.method;
        if (method !== 'pix' && pixOn) pixOn = false;
        draw();
        return;
      }
      const rm = e.target.closest('[data-rm-line]');
      if (rm) { lines.splice(Number(rm.dataset.rmLine), 1); draw(); return; }
      if (e.target.closest('[data-rm-cred]')) { cred = null; draw(); return; }
      const add = e.target.closest('[data-add]');
      if (!add) return;
      const form = $('[data-method-form]', body);
      const r = rest();
      if (method === 'crediario') {
        cred = { installments: Number($('[name=inst]', form).value), first_due: $('[name=due]', form).value };
        draw();
        return;
      }
      const typed = parseMoney($('[name=amount]', form).value);
      if (typed <= 0) { toast('Informe o valor', { kind: 'warn' }); return; }
      const line = { id: uid(), method, amount: Math.min(typed, r), installments: 1 };
      if (method === 'dinheiro') {
        line.tendered = typed;
        line.change_given = typed > r ? round2(typed - r) : null;
      } else if (typed > r + 0.005) {
        toast('Valor maior do que falta', { kind: 'warn' });
        return;
      }
      if (method === 'credito') line.installments = Number($('[name=inst]', form).value);
      if (method === 'vale_troca') {
        const code = $('[name=code]', form).value.trim().toUpperCase();
        try {
          const c = await Data.findCredit(code);
          if (!c) { toast('Vale não encontrado', { kind: 'warn' }); return; }
          if (Number(c.balance) < line.amount) { toast(`Saldo do vale: ${money(c.balance)}`, { kind: 'warn' }); return; }
          line.credit_code = code;
        } catch (err) { toastError('Não consegui conferir o vale', friendlyError(err)); return; }
      }
      lines.push(line);
      method = 'pix';
      draw();
    });

    const finish = $('[data-finish]', m.foot);
    finish.addEventListener('click', () => withLoading(finish, async () => {
      const r = rest();
      if (r > 0.005 && !cred) {
        // valor digitado e não lançado é o caso comum: lança sozinho
        const form = $('[data-method-form]', body);
        const auto = form && $('[data-add]', form) && method !== 'crediario' && method !== 'vale_troca';
        if (auto) {
          const typed = parseMoney($('[name=amount]', form).value);
          if (typed >= r - 0.005) {
            const l = { id: uid(), method, amount: r, installments: method === 'credito' ? Number($('[name=inst]', form).value) : 1 };
            if (method === 'dinheiro') { l.tendered = typed; l.change_given = typed > r ? round2(typed - r) : null; }
            lines.push(l);
          }
        }
      }
      if (rest() > 0.005 && !cred) { toast('Falta receber', { kind: 'warn', text: money(rest()) }); draw(); return; }
      const payload = {
        ...basePayload(),
        status: 'entregue',
        use_pix_discount: pixOn,
        payments: lines.map((l) => ({ ...l })),
        crediario: cred,
      };
      await submit(payload, m);
    }));

    draw();
  }

  async function askManagerPin(pct) {
    return new Promise((resolve) => {
      let answered = false;
      const m = openModal({
        title: 'Senha do gerente',
        subtitle: `Desconto de ${pct}% passa do seu limite`,
        body: `<div class="form-grid">${field('Senha de liberação', '<input class="input" name="pin" type="password" inputmode="numeric" autocomplete="off" data-autofocus>')}</div>`,
        footer: '<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Liberar</button>',
        onClose: () => { if (!answered) resolve(null); },
      });
      const ok = m.foot.querySelector('[data-ok]');
      ok.addEventListener('click', () => withLoading(ok, async () => {
        try {
          const r = await Data.checkManagerPin(m.panel.querySelector('[name=pin]').value, pct);
          if (!r.ok) { toast(r.error || 'Senha incorreta', { kind: 'warn' }); return; }
          toast(`Liberado por ${r.manager}`);
          answered = true;
          m.close();
          resolve(r.approval_id);
        } catch (err) {
          toastError('Não consegui conferir', friendlyError(err));
        }
      }));
    });
  }

  /* -------------------------------------------------------- ouvintes --- */

  scan.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (handleCode(scan.value)) {
      scan.value = '';
      query = '';
      renderGrid();
      return;
    }
    const list = rankedProducts();
    if (list.length === 1) { openVariantPicker(list[0]); }
  });
  scan.addEventListener('input', debounce(() => { query = scan.value; limit = 60; renderGrid(); }, 120));

  host.addEventListener('change', (e) => {
    if (e.target.matches('[data-cat]')) { category = e.target.value; limit = 60; renderGrid(); }
  });

  host.addEventListener('click', async (e) => {
    const card = e.target.closest('[data-product]');
    if (card) { openVariantPicker(Data.product(card.dataset.product)); return; }
    if (e.target.closest('[data-more]')) { limit += 60; renderGrid(); return; }
    if (e.target.closest('[data-camera]')) {
      openScanner({ onCode: (c) => { if (!handleCode(c)) toast('Código não encontrado', { kind: 'warn', text: c }); } });
      return;
    }
    const line = e.target.closest('[data-line]');
    if (line) {
      const i = Number(line.dataset.line);
      const it = cart.items[i];
      if (e.target.closest('[data-inc]')) {
        const v = Data.variant(it.variant_id);
        if (v.available <= it.qty && Data.settings().block_negative_stock) { toast('Sem mais estoque disso', { kind: 'warn' }); return; }
        it.qty += 1; renderCart(); return;
      }
      if (e.target.closest('[data-dec]')) {
        it.qty -= 1;
        if (it.qty <= 0) cart.items.splice(i, 1);
        renderCart();
        return;
      }
      if (e.target.closest('[data-line-edit]')) { openLineEdit(i); return; }
    }
    if (e.target.closest('[data-clear]')) {
      if (await confirmDialog({ title: 'Limpar esta venda?', confirmText: 'Limpar', danger: true })) {
        cart = emptyCart();
        showCart = false;
        renderCart();
      }
      return;
    }
    if (e.target.closest('[data-customer]')) {
      pickCustomer((c) => {
        cart.customer_id = c?.id || '';
        cart.customer_name = c?.name || '';
        cart.customer_phone = c?.phone || '';
        renderCart();
      });
      return;
    }
    if (e.target.closest('[data-seller]')) { openSeller(); return; }
    if (e.target.closest('[data-discount]')) { openDiscount(); return; }
    if (e.target.closest('[data-coupon]')) { openCoupon(); return; }
    if (e.target.closest('[data-mode]')) { openOnlineMode(); return; }
    if (e.target.closest('[data-checkout]')) { checkout(); return; }
    if (e.target.closest('[data-toggle-cart]')) { showCart = true; renderCart(); window.scrollTo({ top: 0 }); return; }
    if (e.target.closest('[data-back-products]')) { showCart = false; renderCart(); }
  });

  renderGrid();
  renderCart();
  if (!matchMedia('(hover: none)').matches) scan.focus();

  return {
    onData() {
      if (document.activeElement !== scan || !scan.value) renderGrid();
      renderCart();
    },
  };
}
