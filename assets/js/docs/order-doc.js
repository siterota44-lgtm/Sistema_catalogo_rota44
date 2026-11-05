/**
 * O "retrato" de um pedido pronto para virar PDF. Só entra aqui o que o cliente
 * pode ver: número interno, SKU, código de barras, custo e margem ficam de fora.
 */

import * as Data from '../core/data.js';
import { todayISO } from '../core/utils.js';
import { PAYMENT_METHODS, SALE_STATUS, DELIVERY } from '../core/constants.js';

function storeDoc() {
  const s = Data.settings();
  return {
    name: s.store_name || 'Rota 44',
    tagline: s.tagline || '',
    phone: phoneOf(s.whatsapp),
    instagram: s.instagram || '',
    address: s.address || '',
    hours: s.hours || '',
    pixKey: s.pix_key || '',
    pixName: s.pix_name || '',
    footer: s.receipt_footer || '',
    exchangeDays: Number(s.exchange_days) || 0,
  };
}

/** A máscara do telefone trabalha com DDD + número, sem o 55 do país. */
function phoneOf(v) {
  const d = String(v || '').replace(/\D/g, '');
  return d.length > 11 && d.startsWith('55') ? d.slice(2) : d;
}

const pieceDetail = (color, size) => [color, size ? `Tam. ${size}` : ''].filter(Boolean).join(' · ');

/** Venda do sistema. */
export function saleDoc(id) {
  const s = Data.sale(id);
  const items = Data.saleItems(id).map((i) => {
    const v = i.variant_id ? Data.variant(i.variant_id) : null;
    return {
      name: i.product_name,
      details: [pieceDetail(i.color_name, i.size_label), i.returned_qty ? `${i.returned_qty} devolvida${i.returned_qty > 1 ? 's' : ''}` : ''],
      qty: i.qty,
      unit: Number(i.unit_price),
      photo: v ? Data.photoOf(v) : '',
    };
  });
  const payments = Data.salePayments(id).filter((p) => Number(p.amount) > 0 && !Data.salePayments(id).some((x) => x.reverses_id === p.id));
  const parcels = Data.bills().filter((b) => b.sale_id === id && b.kind === 'receber' && b.status !== 'cancelada')
    .sort((a, b) => (a.installment_no || 0) - (b.installment_no || 0));
  const late = parcels.length > 0;
  return {
    date: s.sale_date,
    status: SALE_STATUS[s.status]?.label || '',
    store: storeDoc(),
    customer: { name: s.customer_name, phone: phoneOf(s.customer_phone), address: s.address },
    items,
    totals: {
      subtotal: Number(s.items_total),
      discount: Number(s.items_discount) + Number(s.discount_value),
      coupon: Number(s.coupon_discount),
      pix: Number(s.pix_discount),
      shipping: Number(s.shipping_fee),
      total: Number(s.total),
      returned: Number(s.returned_total),
      paid: Number(s.paid_total),
      balance: Math.max(Number(s.balance), 0),
    },
    // parcela paga já aparece na lista de parcelas: não repete nos pagamentos
    payments: payments.filter((p) => !late || !parcels.some((b) => b.description === p.notes))
      .map((p) => ({ date: p.paid_on, method: PAYMENT_METHODS[p.method]?.label || 'Pagamento', installments: p.installments, amount: Number(p.amount) })),
    parcels: parcels.map((b) => ({ label: `${b.installment_no || 1}/${b.installments || 1}`, due: b.due_date, paid: b.status === 'paga' ? b.paid_on : '', amount: Number(b.amount) })),
    delivery: DELIVERY[s.delivery_method] || '',
    tracking: s.tracking_code || '',
  };
}

/** Pedido do catálogo que ainda não virou venda. */
export function requestDoc(r) {
  const items = (r.items || []).map((i) => {
    const v = i.variant_id ? Data.variant(i.variant_id) : null;
    return { name: i.name, details: [pieceDetail(i.color, i.size)], qty: Number(i.qty), unit: Number(i.unit_price), photo: v ? Data.photoOf(v) : '' };
  });
  const subtotal = items.reduce((a, i) => a + i.qty * i.unit, 0);
  return {
    date: String(r.created_at || todayISO()).slice(0, 10),
    status: 'Aguardando confirmação',
    store: storeDoc(),
    customer: { name: r.customer_name, phone: phoneOf(r.customer_phone), address: '' },
    items,
    totals: { subtotal, discount: 0, coupon: Number(r.discount) || 0, pix: 0, shipping: 0, total: Number(r.total), returned: 0, paid: 0, balance: Number(r.total) },
    payments: [],
    parcels: [],
    delivery: r.delivery_pref || '',
    tracking: '',
    notes: r.notes || '',
  };
}
