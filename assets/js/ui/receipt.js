/** Comprovante da venda: impressora térmica (80 mm) e mensagem de WhatsApp. */

import * as Data from '../core/data.js';
import { esc, money, formatDate, whatsappLink } from '../core/utils.js';
import { PAYMENT_METHODS, SALE_STATUS, CHANNELS } from '../core/constants.js';
import { openModal, toast } from './kit.js';
import { icon } from './icons.js';
import { printHTML, code } from './common.js';
import { saleDoc } from '../docs/order-doc.js';
import { openOrderPdf } from './doc-preview.js';

export function receiptHTML(sale) {
  const s = Data.settings();
  const items = Data.saleItems(sale.id);
  const pays = Data.salePayments(sale.id);
  return `
    <div class="receipt">
      <img src="assets/brand/escudo.svg" alt="">
      <h4>${esc(s.store_name || 'Rota 44')}</h4>
      ${s.address ? `<div class="r-center">${esc(s.address)}</div>` : ''}
      ${s.instagram ? `<div class="r-center">${esc(s.instagram)}</div>` : ''}
      <hr>
      <div class="r-row"><span>Venda ${esc(code(sale.number))}</span><span>${esc(formatDate(sale.sale_date))}</span></div>
      ${sale.customer_name ? `<div>Cliente: ${esc(sale.customer_name)}</div>` : ''}
      <div>Vendedor: ${esc(Data.memberName(sale.seller_id))}</div>
      <hr>
      ${items.map((i) => `
        <div>${esc(i.product_name)}</div>
        <div class="r-row"><span>${esc(i.color_name)} ${esc(i.size_label)} · ${i.qty} × ${esc(money(i.unit_price))}</span><span>${esc(money(i.total))}</span></div>
        ${Number(i.discount_value) > 0 ? `<div class="r-row"><span>desconto</span><span>−${esc(money(i.discount_value))}</span></div>` : ''}`).join('')}
      <hr>
      <div class="r-row"><span>Produtos</span><span>${esc(money(Number(sale.items_total) - Number(sale.items_discount)))}</span></div>
      ${Number(sale.discount_value) > 0 ? `<div class="r-row"><span>Desconto</span><span>−${esc(money(sale.discount_value))}</span></div>` : ''}
      ${Number(sale.coupon_discount) > 0 ? `<div class="r-row"><span>Cupom</span><span>−${esc(money(sale.coupon_discount))}</span></div>` : ''}
      ${Number(sale.pix_discount) > 0 ? `<div class="r-row"><span>Desconto Pix</span><span>−${esc(money(sale.pix_discount))}</span></div>` : ''}
      ${Number(sale.shipping_fee) > 0 ? `<div class="r-row"><span>Frete</span><span>${esc(money(sale.shipping_fee))}</span></div>` : ''}
      <div class="r-row r-total"><span>TOTAL</span><span>${esc(money(sale.total))}</span></div>
      ${pays.length ? '<hr>' : ''}
      ${pays.map((p) => `<div class="r-row"><span>${esc(PAYMENT_METHODS[p.method]?.label || p.method)}${p.installments > 1 ? ` ${p.installments}×` : ''}</span><span>${esc(money(p.amount))}</span></div>
        ${Number(p.change_given) > 0 ? `<div class="r-row"><span>Troco</span><span>${esc(money(p.change_given))}</span></div>` : ''}`).join('')}
      ${Number(sale.balance) > 0.005 ? `<div class="r-row"><b>A receber</b><b>${esc(money(sale.balance))}</b></div>` : ''}
      <hr>
      <div class="r-center">${esc(s.receipt_footer || '')}</div>
      ${s.exchange_days ? `<div class="r-center">Trocas em até ${esc(s.exchange_days)} dias com a etiqueta.</div>` : ''}
      <div class="r-center" style="margin-top:6px">Este comprovante não é documento fiscal.</div>
    </div>`;
}

/** Mensagem do WhatsApp: *negrito* funciona lá. */
export function receiptMessage(sale) {
  const s = Data.settings();
  const items = Data.saleItems(sale.id);
  const lines = [
    `*Seu pedido - ${s.store_name || 'Rota 44'}*`,
    '',
    ...items.map((i) => `• ${i.qty}× ${i.product_name} (${i.color_name} ${i.size_label}): ${money(i.total)}`),
    '',
    `*Total: ${money(sale.total)}*`,
  ];
  if (Number(sale.balance) > 0.005) {
    lines.push(`Falta pagar: ${money(sale.balance)}`);
    if (s.pix_key) lines.push(`Pix: ${s.pix_key}${s.pix_name ? ` (${s.pix_name})` : ''}`);
  }
  if (sale.tracking_code) lines.push(`Rastreio: ${sale.tracking_code}`);
  if (sale.status !== 'entregue') lines.push(`Situação: ${SALE_STATUS[sale.status]?.label || sale.status}`);
  lines.push('', s.receipt_footer || 'Tamo junto!');
  return lines.join('\n');
}

export function openReceipt(saleId) {
  const sale = Data.sale(saleId);
  if (!sale) return null;
  const wa = whatsappLink(sale.customer_phone, receiptMessage(sale));
  const m = openModal({
    title: `Venda ${code(sale.number)}`,
    subtitle: `${CHANNELS[sale.channel] || ''} · ${money(sale.total)}`,
    body: receiptHTML(sale),
    footer: `
      ${wa ? `<a class="btn" href="${esc(wa)}" target="_blank" rel="noopener">${icon('whatsapp')} WhatsApp</a>` : `<button class="btn" data-copy>${icon('copy')} Copiar texto</button>`}
      <button class="btn" data-pdf>${icon('download')} PDF</button>
      <button class="btn" data-print>${icon('print')} Imprimir</button>
      <button class="btn btn-primary" data-close>Pronto</button>`,
  });
  m.foot.querySelector('[data-print]').addEventListener('click', () => printHTML(receiptHTML(sale), 'printing-receipt', 'margin: 2mm'));
  m.foot.querySelector('[data-pdf]').addEventListener('click', () => openOrderPdf(saleDoc(sale.id)));
  m.foot.querySelector('[data-copy]')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(receiptMessage(sale)); toast('Texto copiado'); }
    catch { toast('Não consegui copiar', { kind: 'warn' }); }
  });
  return m;
}
