/** Painel: como está o dia, o que precisa de atenção e o que está vendendo. */

import * as Data from '../core/data.js';
import { esc, money, todayISO, addDays, startOfMonth, toDate } from '../core/utils.js';
import { icon } from './icons.js';
import { $, head, moneyHTML, emptyBox, catalogUrl } from './common.js';
import { toast } from './kit.js';
import { openProductForm } from './products.js';
import { openStockEntry } from './stock.js';
import { lineChart, rankBarsHTML, chartTableHTML } from './charts.js';
import { openSale } from './sales.js';

const net = (s) => Number(s.total) - Number(s.returned_total);

function summary(from, to) {
  const list = Data.sales().filter((s) => s.status !== 'cancelado' && s.sale_date >= from && s.sale_date <= to);
  const ids = new Set(list.map((s) => s.id));
  const pieces = Data.allSaleItems().filter((i) => ids.has(i.sale_id)).reduce((a, i) => a + i.qty, 0);
  const total = list.reduce((a, s) => a + net(s), 0);
  return { total, count: list.length, ticket: list.length ? total / list.length : 0, pieces, perSale: list.length ? pieces / list.length : 0 };
}

/** "4 vendas · ▲ 12% vs. anterior": sem base de comparação, fica só a primeira parte. */
function foot(text, curr, prev) {
  const d = delta(curr, prev);
  return d ? `${text} · ${d}` : text;
}

function delta(curr, prev) {
  if (!prev) return '';
  const pct = Math.round(((curr - prev) / prev) * 100);
  if (!pct) return '<span class="dim">igual ao período anterior</span>';
  return `<span class="${pct > 0 ? 'delta-up' : 'delta-down'}">${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}%</span> <span class="dim">vs. anterior</span>`;
}

const DONE_KEY = 'rota44.onboarding.ok';

/** O que falta para a loja estar pronta. Some sozinho quando termina. */
function firstSteps() {
  if (!Data.hasRole('admin')) return null;
  try { if (localStorage.getItem(DONE_KEY)) return null; } catch { /* */ }
  const s = Data.settings();
  const real = Data.products().filter((p) => !String(p.cover_url || '').startsWith('assets/demo/'));
  const steps = [
    { ok: !!s.whatsapp, text: 'Colocar o WhatsApp da loja', hint: 'É para ele que os pedidos do catálogo vão', go: 'ajustes' },
    { ok: real.length > 0, text: 'Cadastrar a primeira peça de verdade', hint: 'Foto, preço, cores e tamanhos', action: 'product' },
    { ok: !!(Number(s.fee_debit_pct) || Number(s.fee_credit_pct)), text: 'Informar as taxas da maquininha', hint: 'Para o lucro sair certo', go: 'ajustes' },
    { ok: !!(s.instagram && s.address), text: 'Preencher Instagram e endereço', hint: 'Aparecem no catálogo e no comprovante', go: 'ajustes' },
    { ok: Data.sales().length > 0, text: 'Fazer a primeira venda', hint: 'No PDV: bipe a peça e receba', go: 'pdv' },
  ];
  const left = steps.filter((x) => !x.ok).length;
  if (!left) {
    try { localStorage.setItem(DONE_KEY, '1'); } catch { /* */ }
    return null;
  }
  return { steps, left };
}

export function mount(host, ctx) {
  let chart = null;
  const seesSales = Data.hasRole('admin', 'gerente', 'vendedor');

  function alerts() {
    const out = [];
    const reqs = Data.catalogRequests().filter((r) => r.status === 'novo').length;
    if (reqs) out.push({ icon: 'whatsapp', text: `${reqs} pedido${reqs === 1 ? '' : 's'} novo${reqs === 1 ? '' : 's'} pelo catálogo`, route: 'pedidos' });
    const sep = Data.sales().filter((s) => s.status === 'pago').length;
    if (sep) out.push({ icon: 'box', text: `${sep} venda${sep === 1 ? '' : 's'} paga${sep === 1 ? '' : 's'} para separar`, route: 'vendas' });
    const soon = new Date(Date.now() + 3 * 3600 * 1000);
    const exp = Data.sales().filter((s) => s.status === 'aguardando_pagamento' && s.reserved_until && new Date(s.reserved_until) < soon).length;
    if (exp) out.push({ icon: 'clock', text: `${exp} reserva${exp === 1 ? '' : 's'} vencendo em até 3 horas`, route: 'vendas' });
    const wait = Data.sales().filter((s) => s.status === 'aguardando_pagamento').length;
    if (wait && !exp) out.push({ icon: 'clock', text: `${wait} pedido${wait === 1 ? '' : 's'} aguardando pagamento`, route: 'vendas' });
    const low = Data.lowStock().length;
    if (low) out.push({ icon: 'layers', text: `${low} peça${low === 1 ? '' : 's'} abaixo do mínimo`, route: 'estoque' });
    const back = Data.stockAlerts().filter((a) => !a.notified_at && Data.variant(a.variant_id)?.available > 0).length;
    if (back) out.push({ icon: 'phone', text: `${back} cliente${back === 1 ? '' : 's'} esperando aviso: a peça chegou`, route: 'pedidos' });
    const limit = todayISO(addDays(new Date(), 3));
    const due = Data.bills().filter((b) => b.status === 'aberta' && b.due_date <= limit);
    if (due.length) out.push({ icon: 'receipt', text: `${due.length} conta${due.length === 1 ? '' : 's'} vencendo ou vencida${due.length === 1 ? '' : 's'}`, route: 'financeiro' });
    if (seesSales && !Data.myOpenCash()) out.push({ icon: 'wallet', text: 'Seu caixa está fechado', route: 'caixa', quiet: true });
    return out;
  }

  function render() {
    chart?.destroy?.();
    chart = null;
    const today = todayISO();
    const d = new Date();
    const weekStart = todayISO(addDays(d, -6));
    const monthStart = todayISO(startOfMonth());
    const prevMonthEnd = todayISO(addDays(startOfMonth(), -1));
    const prevMonthStart = todayISO(startOfMonth(toDate(prevMonthEnd)));
    const sToday = summary(today, today);
    const sYest = summary(todayISO(addDays(d, -1)), todayISO(addDays(d, -1)));
    const sWeek = summary(weekStart, today);
    const sPrevW = summary(todayISO(addDays(d, -13)), todayISO(addDays(d, -7)));
    const sMonth = summary(monthStart, today);
    const sPrevM = summary(prevMonthStart, prevMonthEnd);

    // últimos 30 dias
    const days = Array.from({ length: 30 }, (_, i) => todayISO(addDays(d, i - 29)));
    const perDay = new Map(days.map((x) => [x, 0]));
    for (const s of Data.sales()) if (s.status !== 'cancelado' && perDay.has(s.sale_date)) perDay.set(s.sale_date, perDay.get(s.sale_date) + net(s));
    const labels = days.map((x) => `${x.slice(8, 10)}/${x.slice(5, 7)}`);
    const values = days.map((x) => perDay.get(x));

    // top do mês
    const ids = new Set(Data.sales().filter((s) => s.status !== 'cancelado' && s.sale_date >= monthStart).map((s) => s.id));
    const prod = new Map(); const cats = new Map();
    for (const i of Data.allSaleItems()) {
      if (!ids.has(i.sale_id)) continue;
      prod.set(i.product_name, (prod.get(i.product_name) || 0) + i.qty - i.returned_qty);
      const c = Data.category(Data.product(i.product_id)?.category_id)?.name || 'Sem categoria';
      cats.set(c, (cats.get(c) || 0) + Number(i.total));
    }
    const top = (map, n = 10) => [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, n);
    const list = alerts();
    const steps = firstSteps();
    const canEdit = Data.hasRole('admin', 'gerente');
    const canStock = Data.canCost();

    host.innerHTML = `
      <div class="view">
        ${head(`Fala, ${(Data.who().name || '').split(' ')[0] || 'time'}`, new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }), seesSales ? `<button class="btn btn-primary" data-go="pdv">${icon('plus')} Nova venda</button>` : '')}
        ${seesSales ? `
        <div class="grid grid-kpi">
          <div class="kpi"><span class="kpi-label">Hoje</span><span class="kpi-value money-sensitive">${esc(money(sToday.total))}</span>
            <span class="kpi-foot">${foot(`${sToday.count} venda${sToday.count === 1 ? '' : 's'}`, sToday.total, sYest.total)}</span></div>
          <div class="kpi"><span class="kpi-label">7 dias</span><span class="kpi-value money-sensitive">${esc(money(sWeek.total))}</span>
            <span class="kpi-foot">${foot(`${sWeek.count} vendas`, sWeek.total, sPrevW.total)}</span></div>
          <div class="kpi"><span class="kpi-label">Este mês</span><span class="kpi-value money-sensitive">${esc(money(sMonth.total))}</span>
            <span class="kpi-foot">${foot(`${sMonth.count} vendas`, sMonth.total, sPrevM.total)}</span></div>
          <div class="kpi"><span class="kpi-label">Ticket médio (mês)</span><span class="kpi-value money-sensitive">${esc(money(sMonth.ticket))}</span>
            <span class="kpi-foot">${sMonth.perSale.toFixed(1).replace('.', ',')} peças por atendimento</span></div>
        </div>` : ''}
        <div class="quick-row">
          ${seesSales ? `<button class="quick" data-go="pdv">${icon('cash')}<span>Nova venda</span></button>` : ''}
          ${canEdit ? `<button class="quick" data-quick="product">${icon('box')}<span>Nova peça</span></button>` : ''}
          ${canStock ? `<button class="quick" data-quick="entry">${icon('truck')}<span>Chegou peça</span></button>` : ''}
          ${canStock ? `<button class="quick" data-go="etiquetas">${icon('print')}<span>Etiquetas</span></button>` : ''}
          ${seesSales ? `<button class="quick" data-quick="link">${icon('share')}<span>Link do catálogo</span></button>` : ''}
        </div>
        ${steps ? `<div class="card"><div class="card-head"><h3>Primeiros passos</h3><span class="small dim">falta${steps.left === 1 ? '' : 'm'} ${steps.left}</span></div>
          <div class="card-body" style="padding:6px 16px"><div class="alert-list">
            ${steps.steps.map((x) => `<button class="alert-row step-row ${x.ok ? 'is-ok' : ''}" ${x.ok ? 'disabled' : x.action ? `data-quick="${x.action}"` : `data-go="${x.go}"`}>
              <span class="step-mark">${x.ok ? icon('check') : ''}</span>
              <span class="grow"><b>${esc(x.text)}</b><br><span class="small dim">${esc(x.hint)}</span></span>${x.ok ? '' : icon('chevronRight')}</button>`).join('')}
          </div></div></div>` : ''}
        ${list.length ? `<div class="card"><div class="card-head"><h3>Precisa de atenção</h3></div>
          <div class="card-body" style="padding:6px 16px"><div class="alert-list">
            ${list.map((a) => `<button class="alert-row" data-go="${a.route}">${icon(a.icon)}<span class="grow ${a.quiet ? 'muted' : ''}">${esc(a.text)}</span>${icon('chevronRight')}</button>`).join('')}
          </div></div></div>` : ''}
        ${seesSales ? `
        <div class="card"><div class="card-head"><h3>Vendido nos últimos 30 dias</h3></div>
          <div class="card-body"><div data-chart></div>
            <details style="margin-top:8px"><summary class="xs dim" style="cursor:pointer">Ver em tabela</summary>${chartTableHTML(labels, [{ name: 'Vendido', values }])}</details>
          </div></div>
        <div class="grid grid-2">
          <div class="card"><div class="card-head"><h3>Mais vendidos do mês (peças)</h3></div><div class="card-body">${rankBarsHTML(top(prod), { format: (n) => `${n}`, emptyText: 'Nenhuma venda este mês ainda.' })}</div></div>
          <div class="card"><div class="card-head"><h3>Categorias do mês</h3></div><div class="card-body">${rankBarsHTML(top(cats), { emptyText: 'Nenhuma venda este mês ainda.' })}</div></div>
        </div>` : `<div class="card">${emptyBox('Bom trabalho', 'Use o menu para Estoque, Compras e Etiquetas.')}</div>`}
      </div>`;
    if (seesSales) chart = lineChart($('[data-chart]', host), { labels, series: [{ name: 'Vendido', values }], format: money, height: 220 });
  }

  host.addEventListener('click', (e) => {
    const q = e.target.closest('[data-quick]');
    if (q) {
      if (q.dataset.quick === 'product') openProductForm(null);
      if (q.dataset.quick === 'entry') openStockEntry(null);
      if (q.dataset.quick === 'link') {
        navigator.clipboard?.writeText(catalogUrl()).then(() => toast('Link do catálogo copiado', { text: 'É só colar no WhatsApp ou na bio.' })).catch(() => ctx.go('catalogo'));
      }
      return;
    }
    const g = e.target.closest('[data-go]');
    if (g) ctx.go(g.dataset.go);
  });

  render();
  return {
    onData() { if (!document.querySelector('dialog.modal[open]')) render(); },
    destroy() { chart?.destroy?.(); },
  };
}
