/**
 * Financeiro (só admin): resultado do período (DRE simples), fluxo de caixa com
 * o previsto, contas a pagar e a receber. Compra de mercadoria não é despesa no
 * resultado: ela vira estoque, e entra como CMV quando a peça é vendida.
 */

import * as Data from '../core/data.js';
import { esc, money, parseMoney, formatDate, todayISO, addDays, startOfMonth, relativeDate } from '../core/utils.js';
import { friendlyError } from '../core/errors.js';
import { icon } from './icons.js';
import { toast, toastError, openModal, withLoading, confirmDialog } from './kit.js';
import { $, moneyHTML, badge, table, head, field, options, optionsMap, moneyInput, readForm, exportCSV } from './common.js';

const TABS = { resultado: 'Resultado', fluxo: 'Fluxo de caixa', pagar: 'A pagar', receber: 'A receber', contas: 'Categorias' };
const METHODS = { pix: 'Pix', dinheiro: 'Dinheiro', debito: 'Débito', credito: 'Crédito', outro: 'Outro' };

export function monthResult(from, to) {
  const sales = Data.sales().filter((s) => s.status !== 'cancelado' && s.sale_date >= from && s.sale_date <= to);
  const ids = new Set(sales.map((s) => s.id));
  const items = Data.allSaleItems().filter((i) => ids.has(i.sale_id));
  const gross = sales.reduce((a, s) => a + Number(s.total), 0);
  const returns = sales.reduce((a, s) => a + Number(s.returned_total), 0);
  const fees = Data.allSalePayments().filter((p) => p.paid_on >= from && p.paid_on <= to).reduce((a, p) => a + Number(p.fee_amount), 0);
  const cogs = items.reduce((a, i) => a + (i.qty - i.returned_qty) * Data.saleItemCost(i.id), 0);
  const paidBills = Data.bills().filter((b) => b.kind === 'pagar' && b.status === 'paga' && b.paid_on >= from && b.paid_on <= to && !b.purchase_id);
  const expenses = paidBills.reduce((a, b) => a + Number(b.amount), 0);
  const byCat = new Map();
  for (const b of paidBills) {
    const name = Data.financeCategory(b.category_id)?.name || 'Sem categoria';
    byCat.set(name, (byCat.get(name) || 0) + Number(b.amount));
  }
  return { gross, returns, fees, cogs, expenses, byCat, count: sales.length, profit: gross - returns - fees - cogs - expenses, grossProfit: gross - returns - fees - cogs };
}

export function mount(host) {
  let tab = 'resultado';
  let from = todayISO(startOfMonth());
  let to = todayISO();

  function render() {
    host.innerHTML = `
      <div class="view">
        ${head('Financeiro', '', tab === 'pagar' || tab === 'receber' ? `<button class="btn btn-primary" data-new-bill>${icon('plus')} Nova conta</button>` : tab === 'contas' ? `<button class="btn btn-primary" data-new-cat>${icon('plus')} Nova categoria</button>` : '')}
        <div class="tabs" role="tablist">
          ${Object.entries(TABS).map(([k, v]) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${esc(v)}</button>`).join('')}
        </div>
        <div data-body></div>
      </div>`;
    drawBody();
  }

  function periodBar() {
    return `
      <div class="toolbar" style="margin-bottom:12px">
        <label class="label" style="margin:0">De</label><input class="input" type="date" data-from value="${from}">
        <label class="label" style="margin:0">até</label><input class="input" type="date" data-to value="${to}">
      </div>`;
  }

  function drawBody() {
    const box = $('[data-body]', host);
    if (!box) return;
    if (tab === 'resultado') {
      const r = monthResult(from, to);
      const line = (label, val, cls = '', sign = '') => `<div class="totals-row ${cls}"><span>${esc(label)}</span><span class="num money-sensitive">${sign}${esc(money(val))}</span></div>`;
      box.innerHTML = `
        ${periodBar()}
        <div class="grid grid-kpi" style="margin-bottom:16px">
          <div class="kpi"><span class="kpi-label">Vendas</span><span class="kpi-value sm money-sensitive">${esc(money(r.gross))}</span></div>
          <div class="kpi"><span class="kpi-label">Lucro bruto</span><span class="kpi-value sm money-sensitive">${esc(money(r.grossProfit))}</span></div>
          <div class="kpi"><span class="kpi-label">Lucro líquido</span><span class="kpi-value sm money-sensitive ${r.profit < 0 ? 'tone-danger' : ''}">${esc(money(r.profit))}</span></div>
          <div class="kpi"><span class="kpi-label">Margem líquida</span><span class="kpi-value sm">${r.gross ? Math.round((r.profit / r.gross) * 100) : 0}%</span></div>
        </div>
        <div class="card card-pad">
          <div class="fieldset-title" style="margin-bottom:10px">DRE simplificado</div>
          <div class="totals">
            ${line('Receita bruta', r.gross)}
            ${line('(−) Devoluções', r.returns, '', '−')}
            ${line('(−) Taxas de cartão', r.fees, '', '−')}
            ${line('(−) Custo das peças vendidas (CMV)', r.cogs, '', '−')}
            ${line('= Lucro bruto', r.gross - r.returns - r.fees - r.cogs, 'grand')}
            ${[...r.byCat.entries()].map(([k, v]) => line(`(−) ${k}`, v, '', '−')).join('')}
            ${r.byCat.size ? '' : line('(−) Despesas', 0, '', '−')}
            ${line('= Lucro líquido', r.profit, 'grand')}
          </div>
          <p class="xs dim" style="margin-top:10px">Impostos entram como despesa (categoria Impostos). Confira com o contador da loja.</p>
        </div>`;
    } else if (tab === 'fluxo') {
      drawFlow(box);
    } else if (tab === 'pagar' || tab === 'receber') {
      drawBills(box, tab);
    } else {
      box.innerHTML = table([
        { label: 'Categoria', main: true, cell: (c) => `<span class="cell-primary">${esc(c.name)}</span>` },
        { label: 'Tipo', cell: (c) => (c.kind === 'despesa' ? badge('Despesa', 'amber') : badge('Receita', 'green')) },
      ], Data.financeCategories(), { rowAttr: (c) => `data-cat="${esc(c.id)}"` });
    }
  }

  function drawFlow(box) {
    const today = todayISO();
    const until = todayISO(addDays(new Date(), 45));
    const start = todayISO(addDays(new Date(), -30));
    const days = new Map();
    const add = (d, kind, v, previsto) => {
      if (d < start || d > until) return;
      const row = days.get(d) || { date: d, in: 0, out: 0, previsto };
      row[kind] += v;
      row.previsto = previsto;
      days.set(d, row);
    };
    // recebimentos: cartão cai depois (expected_on), já sem a taxa
    for (const p of Data.allSalePayments()) {
      if (p.method === 'vale_troca') continue;
      const net = Number(p.amount) - Number(p.fee_amount);
      const d = p.expected_on || p.paid_on;
      add(d, net >= 0 ? 'in' : 'out', Math.abs(net), d > today);
    }
    for (const b of Data.bills()) {
      if (b.status === 'cancelada') continue;
      if (b.status === 'paga') {
        // crediário pago já entrou como pagamento da venda
        if (b.kind === 'pagar') add(b.paid_on, 'out', Number(b.amount), false);
      } else {
        add(b.due_date < today ? today : b.due_date, b.kind === 'pagar' ? 'out' : 'in', Number(b.amount), true);
      }
    }
    const rows = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
    const real = rows.filter((r) => !r.previsto);
    const prev = rows.filter((r) => r.previsto);
    const sum = (l, k) => l.reduce((a, r) => a + r[k], 0);
    let bal = 0;
    const withBal = rows.map((r) => { bal += r.in - r.out; return { ...r, bal }; });
    box.innerHTML = `
      <div class="grid grid-kpi" style="margin-bottom:16px">
        <div class="kpi"><span class="kpi-label">Entrou (30 dias)</span><span class="kpi-value sm money-sensitive">${esc(money(sum(real, 'in')))}</span></div>
        <div class="kpi"><span class="kpi-label">Saiu (30 dias)</span><span class="kpi-value sm money-sensitive">${esc(money(sum(real, 'out')))}</span></div>
        <div class="kpi"><span class="kpi-label">Vai entrar (45 dias)</span><span class="kpi-value sm money-sensitive">${esc(money(sum(prev, 'in')))}</span></div>
        <div class="kpi"><span class="kpi-label">Vai sair (45 dias)</span><span class="kpi-value sm money-sensitive">${esc(money(sum(prev, 'out')))}</span></div>
      </div>
      ${table([
        { label: 'Dia', main: true, cell: (r) => `<div><span class="cell-primary">${esc(formatDate(r.date))}</span>${r.previsto ? '<span class="cell-sub">Previsto</span>' : ''}</div>` },
        { label: 'Entradas', right: true, cell: (r) => moneyHTML(r.in, 'tone-ok') },
        { label: 'Saídas', right: true, cell: (r) => moneyHTML(r.out, 'tone-danger') },
        { label: 'Acumulado', right: true, cell: (r) => moneyHTML(r.bal, r.bal < 0 ? 'tone-danger strong' : 'strong') },
      ], withBal, { empty: 'Sem movimento no período.' })}`;
  }

  function drawBills(box, kind) {
    const today = todayISO();
    const list = Data.bills().filter((b) => b.kind === kind && b.status !== 'cancelada')
      .sort((a, b) => (a.status === 'aberta' ? 0 : 1) - (b.status === 'aberta' ? 0 : 1) || a.due_date.localeCompare(b.due_date));
    const open = list.filter((b) => b.status === 'aberta');
    const late = open.filter((b) => b.due_date < today);
    box.innerHTML = `
      <div class="grid grid-kpi" style="margin-bottom:16px">
        <div class="kpi"><span class="kpi-label">Em aberto</span><span class="kpi-value sm money-sensitive">${esc(money(open.reduce((a, b) => a + Number(b.amount), 0)))}</span></div>
        <div class="kpi"><span class="kpi-label">Vencidas</span><span class="kpi-value sm money-sensitive ${late.length ? 'tone-danger' : ''}">${esc(money(late.reduce((a, b) => a + Number(b.amount), 0)))}</span></div>
        <div class="kpi"><span class="kpi-label">Contas</span><span class="kpi-value sm">${open.length}</span></div>
      </div>
      ${table([
        { label: 'Conta', main: true, cell: (b) => `<div><span class="cell-primary">${esc(b.description)}</span><span class="cell-sub">${esc(Data.supplier(b.supplier_id)?.name || Data.customer(b.customer_id)?.name || Data.financeCategory(b.category_id)?.name || '')}${b.recurring === 'mensal' ? ' · todo mês' : ''}</span></div>` },
        { label: 'Vencimento', cell: (b) => `<span class="${b.status === 'aberta' && b.due_date < today ? 'tone-danger strong' : ''}">${esc(relativeDate(b.due_date) === formatDate(b.due_date) ? formatDate(b.due_date) : formatDate(b.due_date))}</span>` },
        { label: 'Situação', cell: (b) => (b.status === 'paga' ? badge(`Paga ${formatDate(b.paid_on)}`, 'green') : b.due_date < today ? badge('Vencida', 'red') : badge('Aberta', 'amber')) },
        { label: 'Valor', right: true, cell: (b) => moneyHTML(b.amount, 'strong') },
        { label: '', cell: (b) => (b.status === 'aberta' ? `<div class="row-actions"><button class="btn btn-sm" data-pay="${esc(b.id)}">${kind === 'pagar' ? 'Pagar' : 'Receber'}</button></div>` : '') },
      ], list.slice(0, 200), { rowAttr: (b) => `data-bill="${esc(b.id)}"`, empty: 'Nenhuma conta aqui.' })}`;
  }

  host.addEventListener('change', (e) => {
    if (e.target.matches('[data-from]')) { from = e.target.value; Data.ensureSalesFrom(from).then(drawBody); }
    if (e.target.matches('[data-to]')) { to = e.target.value; drawBody(); }
  });
  host.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; render(); return; }
    if (e.target.closest('[data-new-bill]')) { openBillForm(null, tab); return; }
    if (e.target.closest('[data-new-cat]')) { openCategory(null); return; }
    const pay = e.target.closest('[data-pay]');
    if (pay) { e.stopPropagation(); openPay(Data.bills().find((b) => b.id === pay.dataset.pay)); return; }
    const c = e.target.closest('[data-cat]');
    if (c) { openCategory(Data.financeCategory(c.dataset.cat)); return; }
    const b = e.target.closest('[data-bill]');
    if (b) {
      const bill = Data.bills().find((x) => x.id === b.dataset.bill);
      if (bill.status === 'aberta' && !bill.sale_id && !bill.purchase_id) openBillForm(bill, bill.kind);
    }
  });

  render();
  return { onData: drawBody };
}

function openPay(b) {
  const m = openModal({
    title: b.kind === 'pagar' ? 'Baixar conta' : 'Receber conta',
    subtitle: `${b.description} · ${money(b.amount)}`,
    body: `<div class="form-grid">
      ${field('Data', `<input class="input" type="date" name="paid_on" value="${todayISO()}">`, 6)}
      ${field('Forma', `<select class="select" name="method">${optionsMap(METHODS, 'pix')}</select>`, 6)}
    </div>`,
    footer: '<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Confirmar</button>',
  });
  const ok = m.foot.querySelector('[data-ok]');
  ok.addEventListener('click', () => withLoading(ok, async () => {
    try {
      await Data.payBill({ bill_id: b.id, paid_on: m.panel.querySelector('[name=paid_on]').value, method: m.panel.querySelector('[name=method]').value });
      m.close();
      toast('Conta baixada');
    } catch (err) { toastError('Não consegui baixar', friendlyError(err)); }
  }));
}

function openBillForm(b, kind) {
  const m = openModal({
    title: b ? 'Editar conta' : kind === 'pagar' ? 'Nova conta a pagar' : 'Nova conta a receber',
    size: 'lg',
    body: `
      <form class="form-grid" data-f>
        ${field('Descrição', `<input class="input" name="description" value="${esc(b?.description)}" required data-autofocus placeholder="Aluguel da loja">`, 12)}
        ${field('Valor', moneyInput('amount', b?.amount), 6)}
        ${field('Vencimento', `<input class="input" type="date" name="due_date" value="${esc(b?.due_date || todayISO())}">`, 6)}
        ${field('Categoria', `<select class="select" name="category_id">${options(Data.financeCategories().filter((c) => c.active && (kind === 'pagar' ? c.kind === 'despesa' : c.kind === 'receita')), b?.category_id, { empty: 'Sem categoria' })}</select>`, 6)}
        ${kind === 'pagar' ? field('Fornecedor', `<select class="select" name="supplier_id">${options(Data.suppliers(), b?.supplier_id, { empty: 'Nenhum' })}</select>`, 6)
          : field('Cliente', `<select class="select" name="customer_id">${options(Data.customers(), b?.customer_id, { empty: 'Nenhum' })}</select>`, 6)}
        ${field('Repete', `<select class="select" name="recurring">${optionsMap({ nao: 'Não repete', mensal: 'Todo mês' }, b?.recurring || 'nao')}</select>`, 6)}
        ${field('Observação', `<input class="input" name="notes" value="${esc(b?.notes)}">`, 6)}
      </form>`,
    footer: `${b ? '<button class="btn btn-ghost" data-del style="margin-right:auto">Cancelar conta</button>' : ''}<button class="btn" data-close>Voltar</button><button class="btn btn-primary" data-ok>Salvar</button>`,
  });
  const ok = m.foot.querySelector('[data-ok]');
  ok.addEventListener('click', () => withLoading(ok, async () => {
    const v = readForm($('[data-f]', m.panel));
    const amount = parseMoney(v.amount);
    if (!v.description || !amount) { toast('Preencha descrição e valor', { kind: 'warn' }); return; }
    try {
      await Data.saveRow('bills', {
        id: b?.id, kind, description: v.description, amount, due_date: v.due_date, category_id: v.category_id || null,
        supplier_id: v.supplier_id || null, customer_id: v.customer_id || null, recurring: v.recurring, notes: v.notes,
      });
      m.close();
      toast('Conta salva');
    } catch (err) { toastError('Não consegui salvar', friendlyError(err)); }
  }));
  m.foot.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'Cancelar esta conta?', confirmText: 'Cancelar conta', cancelText: 'Voltar', danger: true }))) return;
    try { await Data.saveRow('bills', { id: b.id, status: 'cancelada' }); m.close(); toast('Conta cancelada'); }
    catch (err) { toastError('Não deu', friendlyError(err)); }
  });
}

function openCategory(c) {
  const m = openModal({
    title: c ? 'Editar categoria' : 'Nova categoria',
    body: `<form class="form-grid" data-f>
      ${field('Nome', `<input class="input" name="name" value="${esc(c?.name)}" required data-autofocus>`, 12)}
      ${field('Tipo', `<select class="select" name="kind">${optionsMap({ despesa: 'Despesa', receita: 'Receita' }, c?.kind || 'despesa')}</select>`, 12)}
    </form>`,
    footer: `${c ? '<button class="btn btn-ghost" data-del style="margin-right:auto">Excluir</button>' : ''}<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Salvar</button>`,
  });
  const ok = m.foot.querySelector('[data-ok]');
  ok.addEventListener('click', () => withLoading(ok, async () => {
    const v = readForm($('[data-f]', m.panel));
    if (!v.name) return;
    try { await Data.saveRow('finance_categories', { id: c?.id, name: v.name, kind: v.kind }); m.close(); toast('Salvo'); }
    catch (err) { toastError('Não consegui salvar', friendlyError(err)); }
  }));
  m.foot.querySelector('[data-del]')?.addEventListener('click', async () => {
    try { await Data.deleteRow('finance_categories', c.id); m.close(); toast('Excluído'); }
    catch (err) { toastError('Não deu', friendlyError(err)); }
  });
}
