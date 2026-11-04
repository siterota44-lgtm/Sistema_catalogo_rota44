/** Vendas: lista com filtros, ficha, funil, pagamentos, cancelamento. */

import * as Data from '../core/data.js';
import { esc, money, parseMoney, uid, todayISO, addDays, startOfMonth, formatDate, relativeDate, whatsappLink, maskPhone } from '../core/utils.js';
import { SALE_STATUS, FLOW, CHANNELS, PAYMENT_METHODS, DELIVERY } from '../core/constants.js';
import { friendlyError } from '../core/errors.js';
import { icon } from './icons.js';
import { toast, toastError, openModal, withLoading } from './kit.js';
import { $, $$, moneyHTML, badge, table, paged, matches, options, optionsMap, field, moneyInput, code, exportCSV, head } from './common.js';
import { openReceipt, receiptMessage } from './receipt.js';
import { openReturnForm } from './returns.js';
import { round2 } from '../core/calc.js';

export const statusBadge = (s) => badge(SALE_STATUS[s]?.label || s, SALE_STATUS[s]?.tone);

/** O que falta fazer nesta venda: o botão da lista anda com ela sem abrir a ficha. */
function nextStep(s) {
  if (s.status === 'aguardando_pagamento') return { label: 'Receber', pay: true };
  if (s.status === 'pago') return { label: 'Separar', to: 'em_separacao' };
  if (s.status === 'em_separacao') return ['retirada', 'balcao'].includes(s.delivery_method) ? { label: 'Pronto p/ retirar', to: 'pronto_retirada' } : { label: 'Enviar', track: true };
  if (s.status === 'enviado' || s.status === 'pronto_retirada') return { label: 'Entregue', to: 'entregue' };
  return null;
}

const PERIODS = { hoje: 'Hoje', '7d': '7 dias', mes: 'Este mês', '30d': '30 dias', tudo: 'Tudo carregado' };

function periodRange(p) {
  const t = todayISO();
  if (p === 'hoje') return [t, t];
  if (p === '7d') return [todayISO(addDays(new Date(), -6)), t];
  if (p === '30d') return [todayISO(addDays(new Date(), -29)), t];
  if (p === 'mes') return [todayISO(startOfMonth()), t];
  return ['', ''];
}

export function mount(host, ctx) {
  let q = '';
  let period = '30d';
  let status = '';
  let channel = '';
  let seller = '';
  let limit = 50;

  host.innerHTML = `
    <div class="view">
      ${head('Vendas', '', `<button class="btn" data-export>${icon('download')} CSV</button><button class="btn btn-primary" data-new>${icon('plus')} Nova venda</button>`)}
      <div class="toolbar">
        <select class="select" data-f="period" aria-label="Período">${optionsMap(PERIODS, period)}</select>
        <select class="select" data-f="status" aria-label="Situação">${optionsMap(SALE_STATUS, '', { empty: 'Todas as situações' })}</select>
        <select class="select" data-f="channel" aria-label="Canal">${optionsMap(CHANNELS, '', { empty: 'Todos os canais' })}</select>
        ${Data.hasRole('admin', 'gerente') ? `<select class="select" data-f="seller" aria-label="Vendedor">${options(Data.members(), '', { empty: 'Toda a equipe', label: (m) => m.nome, val: (m) => m.user_id })}</select>` : ''}
      </div>
      <div class="grid grid-kpi" data-kpis></div>
      <div data-list></div>
    </div>`;

  function filtered() {
    const [from, to] = periodRange(period);
    return Data.sales().filter((s) => {
      if (from && (s.sale_date < from || s.sale_date > to)) return false;
      if (status && s.status !== status) return false;
      if (channel && s.channel !== channel) return false;
      if (seller && s.seller_id !== seller) return false;
      if (q) {
        const items = Data.saleItems(s.id).map((i) => `${i.product_name} ${i.sku}`).join(' ');
        if (!matches(q, String(s.number), s.customer_name, s.customer_phone, s.tracking_code, items)) return false;
      }
      return true;
    });
  }

  function render() {
    const rows = filtered();
    const valid = rows.filter((s) => s.status !== 'cancelado');
    const total = valid.reduce((sum, s) => sum + Number(s.total) - Number(s.returned_total), 0);
    const pieces = valid.reduce((sum, s) => sum + Data.saleItems(s.id).reduce((a, i) => a + i.qty, 0), 0);
    const open = valid.filter((s) => Number(s.balance) > 0.005).reduce((sum, s) => sum + Number(s.balance), 0);
    $('[data-kpis]', host).innerHTML = `
      <div class="kpi"><span class="kpi-label">Vendido</span><span class="kpi-value sm money-sensitive">${esc(money(total))}</span></div>
      <div class="kpi"><span class="kpi-label">Vendas</span><span class="kpi-value sm">${valid.length}</span></div>
      <div class="kpi"><span class="kpi-label">Ticket médio</span><span class="kpi-value sm money-sensitive">${esc(money(valid.length ? total / valid.length : 0))}</span></div>
      <div class="kpi"><span class="kpi-label">Peças</span><span class="kpi-value sm">${pieces}</span></div>
      <div class="kpi"><span class="kpi-label">A receber</span><span class="kpi-value sm money-sensitive">${esc(money(open))}</span></div>`;
    const { shown, more } = paged(rows, limit);
    $('[data-list]', host).innerHTML = table([
      { label: 'Venda', main: true, cell: (s) => `<div><span class="cell-primary">${esc(code(s.number))} ${esc(s.customer_name || 'Sem cadastro')}</span><span class="cell-sub">${esc(relativeDate(s.sale_date))} · ${esc(CHANNELS[s.channel] || s.channel)}</span></div>` },
      { label: 'Vendedor', cell: (s) => esc(Data.memberName(s.seller_id)) },
      { label: 'Situação', cell: (s) => statusBadge(s.status) },
      { label: 'Total', right: true, cell: (s) => moneyHTML(s.total, s.status === 'cancelado' ? 'dim' : 'strong') },
      { label: 'Falta', right: true, cell: (s) => (Number(s.balance) > 0.005 && s.status !== 'cancelado' ? moneyHTML(s.balance, 'tone-danger') : '<span class="dim">-</span>') },
      { label: '', cell: (s) => { const n = nextStep(s); return n ? `<div class="row-actions"><button class="btn btn-sm" data-next="${esc(s.id)}">${esc(n.label)} ${icon('chevronRight')}</button></div>` : ''; } },
    ], shown, {
      rowAttr: (s) => `data-open="${esc(s.id)}"`,
      empty: 'Nenhuma venda nesse filtro.',
    }) + more;
  }

  host.addEventListener('change', (e) => {
    const f = e.target.dataset?.f;
    if (!f) return;
    if (f === 'period') period = e.target.value;
    if (f === 'status') status = e.target.value;
    if (f === 'channel') channel = e.target.value;
    if (f === 'seller') seller = e.target.value;
    limit = 50;
    render();
  });
  host.addEventListener('click', (e) => {
    if (e.target.closest('[data-new]')) { ctx.go('pdv'); return; }
    if (e.target.closest('[data-more]')) { limit += 50; render(); return; }
    if (e.target.closest('[data-export]')) {
      exportCSV(`vendas-rota44-${todayISO()}.csv`, filtered().map((s) => ({
        venda: s.number, data: s.sale_date, situacao: SALE_STATUS[s.status]?.label, canal: CHANNELS[s.channel], cliente: s.customer_name,
        telefone: s.customer_phone, vendedor: Data.memberName(s.seller_id), produtos: Number(s.items_total), descontos: Number(s.items_discount) + Number(s.discount_value) + Number(s.coupon_discount) + Number(s.pix_discount),
        frete: Number(s.shipping_fee), total: Number(s.total), pago: Number(s.paid_total), devolvido: Number(s.returned_total),
      })));
      return;
    }
    const nx = e.target.closest('[data-next]');
    if (nx) {
      const s = Data.sale(nx.dataset.next);
      const n = nextStep(s);
      // crediário se recebe parcela por parcela, na ficha
      if (n.pay && Data.bills().some((b) => b.sale_id === s.id && b.status === 'aberta')) openSale(s.id);
      else if (n.pay) openPayment(s.id, () => {});
      else if (n.track) openTracking(s.id, () => {});
      else Data.setSaleStatus({ sale_id: s.id, status: n.to }).then(() => toast(SALE_STATUS[n.to].label)).catch((err) => toastError('Não deu para mudar', friendlyError(err)));
      return;
    }
    const row = e.target.closest('[data-open]');
    if (row) openSale(row.dataset.open);
  });

  render();
  return { onSearch(v) { q = v; limit = 50; render(); }, onData: render };
}

/* ------------------------------------------------------- ficha da venda */

function openParcel(b, done) {
  const m = openModal({
    title: 'Receber parcela',
    subtitle: `${b.description} · ${money(b.amount)}`,
    body: `<div class="form-grid">
      ${field('Data', `<input class="input" type="date" name="paid_on" value="${todayISO()}">`, 6)}
      ${field('Forma', `<select class="select" name="method">${optionsMap({ pix: 'Pix', dinheiro: 'Dinheiro', debito: 'Débito', credito: 'Crédito' }, 'pix')}</select>`, 6)}
    </div>`,
    footer: '<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Confirmar</button>',
  });
  const ok = m.foot.querySelector('[data-ok]');
  ok.addEventListener('click', () => withLoading(ok, async () => {
    try {
      await Data.payBill({ bill_id: b.id, paid_on: m.panel.querySelector('[name=paid_on]').value, method: m.panel.querySelector('[name=method]').value });
      m.close();
      toast('Parcela recebida');
      done();
    } catch (err) { toastError('Não consegui receber', friendlyError(err)); }
  }));
}

export function openSale(id) {
  const m = openModal({ title: 'Venda', size: 'lg', body: '<div data-sale></div>', footer: '<div class="row gap-2" data-actions style="flex-wrap:wrap;justify-content:flex-end;width:100%"></div>' });
  const body = $('[data-sale]', m.panel);
  const foot = $('[data-actions]', m.foot);

  async function draw() {
    const s = Data.sale(id);
    if (!s) { m.close(); return; }
    const items = Data.saleItems(id);
    const pays = Data.salePayments(id);
    const isManager = Data.canMargin();
    const canceled = s.status === 'cancelado';
    const parcels = Data.bills().filter((b) => b.sale_id === id && b.kind === 'receber' && b.status !== 'cancelada').sort((a, b) => (a.installment_no || 0) - (b.installment_no || 0));
    const hasOpenParcel = parcels.some((b) => b.status === 'aberta');
    m.panel.querySelector('.modal-head h2').textContent = `Venda ${code(s.number)}`;

    const cost = isManager ? items.reduce((sum, i) => sum + (i.qty - i.returned_qty) * Data.saleItemCost(i.id), 0) : 0;
    const profit = Number(s.total) - Number(s.returned_total) - Number(s.shipping_fee) - cost - pays.reduce((sum, p) => sum + Number(p.fee_amount), 0);

    body.innerHTML = `
      <div class="col gap-5">
        <div class="status-steps">
          ${canceled ? badge('Cancelada', 'red') : FLOW.filter((st) => st !== (s.delivery_method === 'retirada' || s.delivery_method === 'balcao' ? 'enviado' : 'pronto_retirada')).map((st) => {
            const curr = FLOW.indexOf(s.status);
            const i = FLOW.indexOf(st);
            return `<button class="step ${i < curr ? 'done' : ''} ${i === curr ? 'current' : ''}" data-step="${st}" ${st === 'aguardando_pagamento' ? 'disabled' : ''}>${esc(SALE_STATUS[st].label)}</button>`;
          }).join('')}
        </div>
        ${canceled ? `<div class="alert" data-kind="error">${icon('xCircle')}<div><b>Motivo:</b> ${esc(s.cancel_reason || '-')}</div></div>` : ''}
        ${s.status === 'aguardando_pagamento' && s.reserved_until ? `<div class="alert" data-kind="warn">${icon('clock')}<div>Peças reservadas até ${esc(new Date(s.reserved_until).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }))}. Sem pagamento até lá, a reserva cai sozinha.</div></div>` : ''}
        <dl class="kv">
          <div><dt>Cliente</dt><dd>${esc(s.customer_name || 'Sem cadastro')}${s.customer_phone ? `<br><span class="small dim">${esc(maskPhone(s.customer_phone))}</span>` : ''}</dd></div>
          <div><dt>Data</dt><dd>${esc(formatDate(s.sale_date))}</dd></div>
          <div><dt>Canal</dt><dd>${esc(CHANNELS[s.channel] || s.channel)}</dd></div>
          <div><dt>Vendedor</dt><dd>${esc(Data.memberName(s.seller_id))}${s.approved_by ? `<br><span class="small dim">Desconto liberado por ${esc(Data.memberName(s.approved_by))}</span>` : ''}</dd></div>
          <div><dt>Entrega</dt><dd>${esc(DELIVERY[s.delivery_method] || s.delivery_method)}${s.address ? `<br><span class="small dim">${esc(s.address)}</span>` : ''}</dd></div>
          ${s.tracking_code ? `<div><dt>Rastreio</dt><dd>${esc(s.tracking_code)}</dd></div>` : ''}
          ${s.notes ? `<div><dt>Observação</dt><dd>${esc(s.notes)}</dd></div>` : ''}
        </dl>
        <div>
          <div class="fieldset-title" style="margin-bottom:6px">Itens</div>
          ${table([
            { label: 'Peça', main: true, cell: (i) => `<div><span class="cell-primary">${esc(i.product_name)}</span><span class="cell-sub">${esc(i.color_name)} · ${esc(i.size_label)} · <span class="sku">${esc(i.sku)}</span></span>${i.returned_qty ? `<span class="cell-sub tone-danger">${i.returned_qty} devolvida${i.returned_qty > 1 ? 's' : ''}</span>` : ''}</div>` },
            { label: 'Qtd', right: true, cell: (i) => `<span class="num">${i.qty}</span>` },
            { label: 'Unitário', right: true, cell: (i) => `${Number(i.list_price) > Number(i.unit_price) ? `<s class="dim num xs">${esc(money(i.list_price))}</s> ` : ''}${moneyHTML(i.unit_price)}` },
            { label: 'Total', right: true, cell: (i) => moneyHTML(i.total, 'strong') },
          ], items)}
        </div>
        <div class="totals">
          <div class="totals-row"><span>Produtos</span><span class="num money-sensitive">${esc(money(s.items_total))}</span></div>
          ${Number(s.items_discount) + Number(s.discount_value) > 0 ? `<div class="totals-row"><span>Descontos</span><span class="num money-sensitive">−${esc(money(Number(s.items_discount) + Number(s.discount_value)))}</span></div>` : ''}
          ${Number(s.coupon_discount) > 0 ? `<div class="totals-row"><span>Cupom</span><span class="num money-sensitive">−${esc(money(s.coupon_discount))}</span></div>` : ''}
          ${Number(s.pix_discount) > 0 ? `<div class="totals-row"><span>Desconto Pix</span><span class="num money-sensitive">−${esc(money(s.pix_discount))}</span></div>` : ''}
          ${Number(s.shipping_fee) > 0 ? `<div class="totals-row"><span>Frete</span><span class="num money-sensitive">${esc(money(s.shipping_fee))}</span></div>` : ''}
          <div class="totals-row grand"><span>Total</span><span class="num money-sensitive">${esc(money(s.total))}</span></div>
          ${Number(s.returned_total) > 0 ? `<div class="totals-row"><span>Devolvido</span><span class="num money-sensitive">−${esc(money(s.returned_total))}</span></div>` : ''}
          ${isManager ? `<div class="totals-row"><span>Custo das peças</span><span class="num money-sensitive">${esc(money(cost))}</span></div>
            <div class="totals-row"><span>Lucro bruto (após taxas)</span><span class="num money-sensitive strong">${esc(money(profit))}</span></div>` : ''}
        </div>
        <div>
          <div class="fieldset-title" style="margin-bottom:6px">Pagamentos</div>
          ${pays.length ? `<div class="pay-list">${pays.map((p) => `
            <div class="pay-line">
              <span><b>${esc(PAYMENT_METHODS[p.method]?.label || p.method)}</b>${p.installments > 1 ? ` ${p.installments}×` : ''}
                <span class="xs dim">${esc(formatDate(p.paid_on))}${p.notes ? ` · ${esc(p.notes)}` : ''}</span></span>
              <span class="row gap-2"><b class="num money-sensitive ${Number(p.amount) < 0 ? 'tone-danger' : ''}">${esc(money(p.amount))}</b>
                ${Data.canMargin() && Number(p.amount) > 0 && !canceled && !pays.some((x) => x.reverses_id === p.id) ? `<button class="btn btn-ghost btn-sm" data-reverse="${esc(p.id)}">Estornar</button>` : ''}</span>
            </div>`).join('')}</div>` : '<p class="small dim">Nada lançado ainda.</p>'}
          ${parcels.length ? `
            <div class="fieldset-title" style="margin:14px 0 6px">Parcelas do crediário</div>
            <div class="pay-list">${parcels.map((b) => `
              <div class="pay-line">
                <span><b>${b.installment_no ? `${b.installment_no}/${b.installments}` : 'Parcela'}</b>
                  <span class="xs dim">${b.status === 'paga' ? `paga em ${esc(formatDate(b.paid_on))}` : `vence ${esc(formatDate(b.due_date))}`}</span></span>
                <span class="row gap-2"><b class="num money-sensitive">${esc(money(b.amount))}</b>
                  ${b.status === 'aberta' && !canceled ? `<button class="btn btn-sm" data-bill="${esc(b.id)}">Receber</button>` : badge('Paga', 'green')}</span>
              </div>`).join('')}</div>` : ''}
          ${Number(s.balance) > 0.005 && !canceled ? `<p class="small" style="margin-top:8px">Falta receber: <b class="num tone-danger money-sensitive">${esc(money(s.balance))}</b></p>` : ''}
        </div>
      </div>`;

    const wa = whatsappLink(s.customer_phone, receiptMessage(s));
    foot.innerHTML = `
      ${!canceled && Number(s.balance) > 0.005 && !hasOpenParcel ? `<button class="btn btn-primary" data-pay>${icon('cash')} Receber</button>` : ''}
      <button class="btn" data-receipt>${icon('print')} Comprovante</button>
      ${wa ? `<a class="btn" href="${esc(wa)}" target="_blank" rel="noopener">${icon('whatsapp')} WhatsApp</a>` : ''}
      ${!canceled && s.status !== 'aguardando_pagamento' ? `<button class="btn" data-tracking>${icon('truck')} Rastreio</button>` : ''}
      ${!canceled && Data.canMargin() && s.stock_state === 'out' ? `<button class="btn" data-return>${icon('refresh')} Troca / devolução</button>` : ''}
      ${!canceled && (Data.canMargin() || s.status === 'aguardando_pagamento') ? `<button class="btn btn-danger" data-cancel>${icon('xCircle')} Cancelar</button>` : ''}`;
  }

  m.panel.addEventListener('click', async (e) => {
    const step = e.target.closest('[data-step]');
    if (step) {
      try {
        await Data.setSaleStatus({ sale_id: id, status: step.dataset.step });
        toast('Situação atualizada');
        draw();
      } catch (err) { toastError('Não deu para mudar', friendlyError(err)); }
      return;
    }
    if (e.target.closest('[data-receipt]')) { openReceipt(id); return; }
    if (e.target.closest('[data-pay]')) { openPayment(id, draw); return; }
    const bill = e.target.closest('[data-bill]');
    if (bill) { openParcel(Data.bills().find((b) => b.id === bill.dataset.bill), draw); return; }
    if (e.target.closest('[data-tracking]')) { openTracking(id, draw); return; }
    if (e.target.closest('[data-cancel]')) { openCancel(id, draw); return; }
    if (e.target.closest('[data-return]')) { openReturnForm(id, draw); return; }
    const rev = e.target.closest('[data-reverse]');
    if (rev) {
      const payId = rev.dataset.reverse;
      const c = openModal({
        title: 'Estornar pagamento?',
        body: `<div class="form-grid">${field('Motivo', '<input class="input" name="reason" data-autofocus>')}</div>`,
        footer: '<button class="btn" data-close>Voltar</button><button class="btn btn-danger" data-ok>Estornar</button>',
      });
      const ok = c.foot.querySelector('[data-ok]');
      ok.addEventListener('click', () => withLoading(ok, async () => {
        try {
          await Data.reversePayment({ payment_id: payId, date: todayISO(), reason: c.panel.querySelector('[name=reason]').value || 'Estorno' });
          c.close();
          toast('Estornado');
          draw();
        } catch (err) { toastError('Não consegui estornar', friendlyError(err)); }
      }));
    }
  });

  draw();
  return m;
}

function openPayment(saleId, done) {
  const s = Data.sale(saleId);
  const payId = uid();
  const m = openModal({
    title: 'Registrar pagamento',
    subtitle: `Falta ${money(s.balance)}`,
    body: `
      <div class="form-grid">
        ${field('Forma', `<select class="select" name="method">${optionsMap({ pix: 'Pix', dinheiro: 'Dinheiro', debito: 'Débito', credito: 'Crédito', vale_troca: 'Vale-troca', outro: 'Outro' }, 'pix')}</select>`, 6)}
        ${field('Valor', moneyInput('amount', s.balance, 'data-autofocus'), 6)}
        ${field('Data', `<input class="input" type="date" name="paid_on" value="${todayISO()}">`, 6)}
        ${field('Parcelas', `<select class="select" name="inst">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}×</option>`).join('')}</select>`, 6)}
        ${field('Código do vale (se for vale-troca)', '<input class="input" name="code" autocapitalize="characters">', 12)}
      </div>`,
    footer: '<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Registrar</button>',
  });
  const ok = m.foot.querySelector('[data-ok]');
  ok.addEventListener('click', () => withLoading(ok, async () => {
    const q = (n) => m.panel.querySelector(`[name=${n}]`).value;
    try {
      const r = await Data.addPayment({
        id: payId, sale_id: saleId, method: q('method'), amount: round2(parseMoney(q('amount'))), paid_on: q('paid_on'),
        installments: Number(q('inst')), credit_code: q('code'),
      });
      m.close();
      toast(r.status === 'pago' ? 'Pago por completo' : 'Pagamento registrado');
      done();
    } catch (err) {
      toastError('Não consegui registrar', friendlyError(err));
    }
  }));
}

function openTracking(saleId, done) {
  const s = Data.sale(saleId);
  const m = openModal({
    title: 'Código de rastreio',
    body: `<div class="form-grid">${field('Código', `<input class="input" name="code" value="${esc(s.tracking_code)}" data-autofocus>`)}</div>`,
    footer: '<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Salvar e marcar como enviado</button>',
  });
  const ok = m.foot.querySelector('[data-ok]');
  ok.addEventListener('click', () => withLoading(ok, async () => {
    try {
      await Data.setSaleStatus({ sale_id: saleId, status: 'enviado', tracking_code: m.panel.querySelector('[name=code]').value.trim() });
      m.close();
      toast('Rastreio salvo');
      done();
    } catch (err) { toastError('Não consegui salvar', friendlyError(err)); }
  }));
}

function openCancel(saleId, done) {
  const s = Data.sale(saleId);
  const hasPaid = Number(s.paid_total) > 0;
  const m = openModal({
    title: `Cancelar venda ${code(s.number)}?`,
    subtitle: 'A peça volta para o estoque. A venda fica no histórico como cancelada.',
    body: `
      <div class="form-grid">
        ${field('Motivo (obrigatório)', '<input class="input" name="reason" data-autofocus>')}
        ${hasPaid ? `<div class="span-12"><label class="check"><input type="checkbox" name="refund" checked><span class="box"></span><span>Devolvi o dinheiro: estornar ${esc(money(s.paid_total))} hoje</span></label></div>` : ''}
      </div>`,
    footer: '<button class="btn" data-close>Voltar</button><button class="btn btn-danger" data-ok>Cancelar venda</button>',
  });
  const ok = m.foot.querySelector('[data-ok]');
  ok.addEventListener('click', () => withLoading(ok, async () => {
    const reason = m.panel.querySelector('[name=reason]').value.trim();
    if (!reason) { toast('Informe o motivo', { kind: 'warn' }); return; }
    try {
      await Data.cancelSale({ sale_id: saleId, reason, refund: !!m.panel.querySelector('[name=refund]')?.checked, date: todayISO() });
      m.close();
      toast('Venda cancelada');
      done();
    } catch (err) { toastError('Não consegui cancelar', friendlyError(err)); }
  }));
}
