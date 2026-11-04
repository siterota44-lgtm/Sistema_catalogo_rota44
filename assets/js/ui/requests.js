/**
 * Pedidos que chegaram pelo catálogo + "avise-me". O pedido não reserva nada
 * sozinho: a reserva nasce quando o atendente transforma em venda (assim ninguém
 * segura o estoque da loja mandando pedido falso pelo site).
 */

import * as Data from '../core/data.js';
import { esc, money, formatDateTime, whatsappLink, maskPhone } from '../core/utils.js';
import { icon } from './icons.js';
import { toast, toastError, confirmDialog } from './kit.js';
import { $, $$, moneyHTML, badge, emptyBox, head, onError, code } from './common.js';
import { friendlyError } from '../core/errors.js';
import { prefillCart } from './pos.js';
import { openSale } from './sales.js';

const STATUS = { novo: ['Novo', 'amber'], convertido: ['Virou venda', 'green'], descartado: ['Descartado', 'gray'] };

export function mount(host, ctx) {
  let tab = 'pedidos';

  function render() {
    const reqs = Data.catalogRequests();
    const novos = reqs.filter((r) => r.status === 'novo');
    const alerts = Data.stockAlerts().filter((a) => !a.notified_at);
    host.innerHTML = `
      <div class="view">
        ${head('Pedidos do catálogo', 'O cliente escolhe no site e a mensagem chega no WhatsApp da loja. Aqui fica o registro.')}
        <div class="tabs" role="tablist">
          <button role="tab" data-tab="pedidos" aria-selected="${tab === 'pedidos'}">Pedidos ${novos.length ? `(${novos.length})` : ''}</button>
          <button role="tab" data-tab="avise" aria-selected="${tab === 'avise'}">Avise-me ${alerts.length ? `(${alerts.length})` : ''}</button>
        </div>
        ${tab === 'pedidos' ? renderRequests(reqs) : renderAlerts(alerts)}
      </div>`;
  }

  function renderRequests(reqs) {
    if (!reqs.length) return `<div class="card">${emptyBox('Nenhum pedido ainda', 'Divulgue o link do catálogo em Catálogo online.')}</div>`;
    return `<div class="col gap-3">${reqs.slice(0, 100).map((r) => {
      const [label, tone] = STATUS[r.status] || [r.status, 'gray'];
      const wa = whatsappLink(r.customer_phone, `Fala, ${r.customer_name.split(' ')[0]}! Aqui é da Rota 44, sobre o seu pedido C${r.number}.`);
      return `
        <article class="card card-pad" data-id="${esc(r.id)}">
          <div class="row-between" style="flex-wrap:wrap">
            <div><b>C${r.number} · ${esc(r.customer_name)}</b>
              <div class="xs dim">${esc(formatDateTime(r.created_at))}${r.customer_phone ? ` · ${esc(maskPhone(r.customer_phone))}` : ''}${r.delivery_pref ? ` · ${esc(r.delivery_pref)}` : ''}</div></div>
            <div class="row gap-2">${badge(label, tone)}<b class="num money-sensitive">${esc(money(r.total))}</b></div>
          </div>
          <ul class="small" style="margin:10px 0">
            ${(r.items || []).map((i) => `<li>• ${i.qty}× ${esc(i.name)} <span class="dim">${esc(i.color)} ${esc(i.size)}</span> · <span class="money-sensitive">${esc(money(i.unit_price))}</span>
              ${i.available === false ? ' <span class="tone-danger xs">esgotou: confirmar</span>' : ''}</li>`).join('')}
          </ul>
          ${r.notes ? `<p class="small muted">"${esc(r.notes)}"</p>` : ''}
          ${r.coupon_code ? `<p class="small muted">Cupom ${esc(r.coupon_code)}: −${esc(money(r.discount))}</p>` : ''}
          <div class="row gap-2" style="flex-wrap:wrap;margin-top:8px">
            ${r.status === 'novo' ? `<button class="btn btn-primary btn-sm" data-convert>${icon('orders')} Criar venda</button>` : ''}
            ${wa ? `<a class="btn btn-sm" href="${esc(wa)}" target="_blank" rel="noopener">${icon('whatsapp')} WhatsApp</a>` : ''}
            ${r.sale_id ? `<button class="btn btn-sm" data-sale="${esc(r.sale_id)}">Ver venda</button>` : ''}
            ${r.status === 'novo' ? '<button class="btn btn-ghost btn-sm" data-discard>Descartar</button>' : ''}
          </div>
        </article>`;
    }).join('')}</div>`;
  }

  function renderAlerts(alerts) {
    if (!alerts.length) return `<div class="card">${emptyBox('Ninguém esperando', 'Quando alguém pedir aviso de uma peça esgotada, aparece aqui.')}</div>`;
    const sorted = [...alerts].sort((a, b) => (Data.variant(b.variant_id)?.available > 0) - (Data.variant(a.variant_id)?.available > 0));
    return `<div class="card"><div class="mobile-list">${sorted.map((a) => {
      const v = Data.variant(a.variant_id);
      const has = v && v.available > 0;
      const title = v ? Data.variantTitle(v) : 'Peça removida';
      const wa = whatsappLink(a.phone, `Fala, ${a.customer_name.split(' ')[0]}! Chegou a peça que você pediu pra avisar na Rota 44: ${title}. Quer garantir?`);
      return `
        <div class="m-row" data-alert="${esc(a.id)}">
          <div class="m-main"><span class="m-title">${esc(title)}</span>
            <span class="m-sub">${esc(a.customer_name)} · ${esc(maskPhone(a.phone))} · ${esc(formatDateTime(a.created_at))}</span></div>
          <div class="row gap-2">
            ${has ? badge('Chegou', 'green') : badge('Aguardando', 'gray')}
            ${wa ? `<a class="btn btn-sm" href="${esc(wa)}" target="_blank" rel="noopener" data-notify>${icon('whatsapp')} Avisar</a>` : ''}
            <button class="icon-btn sm" data-done aria-label="Marcar como avisado">${icon('check')}</button>
          </div>
        </div>`;
    }).join('')}</div></div>`;
  }

  host.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; render(); return; }
    const saleBtn = e.target.closest('[data-sale]');
    if (saleBtn) { openSale(saleBtn.dataset.sale); return; }
    const notify = e.target.closest('[data-notify], [data-done]');
    if (notify) {
      const id = notify.closest('[data-alert]').dataset.alert;
      Data.markAlert(id).catch(onError('Não consegui marcar'));
      return;
    }
    const card = e.target.closest('[data-id]');
    if (!card) return;
    const r = Data.catalogRequests().find((x) => x.id === card.dataset.id);
    if (e.target.closest('[data-discard]')) {
      if (await confirmDialog({ title: `Descartar o pedido C${r.number}?`, confirmText: 'Descartar', danger: true })) {
        Data.setRequest(r.id, { status: 'descartado' }).catch(onError('Não consegui descartar'));
      }
      return;
    }
    if (e.target.closest('[data-convert]')) {
      const items = (r.items || []).filter((i) => Data.variant(i.variant_id)).map((i) => ({ variant_id: i.variant_id, qty: i.qty, discount_value: 0 }));
      if (!items.length) { toast('As peças deste pedido não existem mais', { kind: 'warn' }); return; }
      const known = Data.customers().find((c) => r.customer_phone && c.phone.replace(/\D/g, '') === r.customer_phone);
      prefillCart({
        items,
        customer_id: known?.id || '',
        customer_name: known?.name || r.customer_name,
        customer_phone: known?.phone || r.customer_phone || '',
        mode: 'pedido', channel: 'site', delivery_method: 'retirada',
        notes: r.notes || '', request_id: r.id, coupon_code: r.coupon_code || '', coupon_discount: Number(r.discount) || 0,
      });
      ctx.go('pdv');
    }
  });

  render();
  return { onData: render };
}
