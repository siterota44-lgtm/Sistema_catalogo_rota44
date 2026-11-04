/**
 * Relatórios por período: vendas, produtos (giro, margem, sell-through por drop),
 * estoque (curva ABC, ruptura por tamanho), trocas, clientes e equipe (comissões).
 * Tudo com CSV. Os números vêm da cópia em memória, então a troca de período é
 * imediata; período antes da janela de 12 meses busca o que falta no banco.
 */

import * as Data from '../core/data.js';
import { esc, money, formatDate, todayISO, addDays, startOfMonth, toDate } from '../core/utils.js';
import { CHANNELS, PAYMENT_METHODS, RETURN_REASONS } from '../core/constants.js';
import { abcCurve, marginPct } from '../core/calc.js';
import { icon } from './icons.js';
import { $, moneyHTML, table, head, exportCSV, badge, onError } from './common.js';
import { lineChart, rankBarsHTML, chartTableHTML } from './charts.js';

const TABS = { vendas: 'Vendas', produtos: 'Produtos', estoque: 'Estoque', trocas: 'Trocas', clientes: 'Clientes', equipe: 'Equipe' };

export function mount(host) {
  let tab = 'vendas';
  let from = todayISO(startOfMonth());
  let to = todayISO();
  let lastCsv = null;
  let chart = null;

  host.innerHTML = `
    <div class="view">
      ${head('Relatórios', '', `<button class="btn" data-csv>${icon('download')} CSV</button>`)}
      <div class="toolbar">
        <div class="segmented" style="flex-wrap:wrap">
          <button data-range="7">7 dias</button><button data-range="30">30 dias</button><button data-range="mes" aria-pressed="true">Este mês</button><button data-range="90">90 dias</button><button data-range="365">12 meses</button>
        </div>
        <input class="input" type="date" data-from value="${from}" aria-label="De">
        <input class="input" type="date" data-to value="${to}" aria-label="Até">
      </div>
      <div class="tabs" role="tablist">
        ${Object.entries(TABS).map(([k, v]) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${esc(v)}</button>`).join('')}
      </div>
      <div data-body class="col gap-4"></div>
    </div>`;

  const inPeriod = () => Data.sales().filter((s) => s.status !== 'cancelado' && s.sale_date >= from && s.sale_date <= to);
  const net = (s) => Number(s.total) - Number(s.returned_total);
  const card = (title, body) => `<div class="card"><div class="card-head"><h3>${esc(title)}</h3></div><div class="card-body">${body}</div></div>`;
  const bars = (map, fmt = money, limit = 10) => rankBarsHTML(
    [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, limit),
    { format: fmt },
  );
  const bump = (map, key, v) => map.set(key, (map.get(key) || 0) + v);

  function draw() {
    chart?.destroy?.();
    chart = null;
    const box = $('[data-body]', host);
    ({ vendas: drawSales, produtos: drawProducts, estoque: drawStock, trocas: drawReturns, clientes: drawCustomers, equipe: drawTeam })[tab](box);
  }

  function drawSales(box) {
    const sales = inPeriod();
    const ids = new Set(sales.map((s) => s.id));
    const items = Data.allSaleItems().filter((i) => ids.has(i.sale_id));
    const total = sales.reduce((a, s) => a + net(s), 0);
    const pieces = items.reduce((a, i) => a + i.qty, 0);
    const byChannel = new Map(); const bySeller = new Map(); const byCat = new Map(); const byDrop = new Map(); const byHour = new Map(); const byPay = new Map();
    for (const s of sales) {
      bump(byChannel, CHANNELS[s.channel] || s.channel, net(s));
      bump(bySeller, Data.memberName(s.seller_id), net(s));
      bump(byHour, `${String(new Date(s.created_at).getHours()).padStart(2, '0')}h`, net(s));
    }
    for (const p of Data.allSalePayments()) {
      if (ids.has(p.sale_id)) bump(byPay, PAYMENT_METHODS[p.method]?.label || p.method, Number(p.amount));
    }
    for (const i of items) {
      const prod = Data.product(i.product_id);
      bump(byCat, Data.category(prod?.category_id)?.name || 'Sem categoria', Number(i.total));
      if (prod?.collection_id) bump(byDrop, Data.collection(prod.collection_id)?.name || 'Drop', Number(i.total));
    }
    // por dia
    const days = [];
    for (let d = toDate(from); todayISO(d) <= to; d = addDays(d, 1)) days.push(todayISO(d));
    const perDay = new Map(days.map((d) => [d, 0]));
    for (const s of sales) perDay.set(s.sale_date, (perDay.get(s.sale_date) || 0) + net(s));
    const labels = days.map((d) => d.slice(8, 10) + '/' + d.slice(5, 7));
    const values = days.map((d) => perDay.get(d));

    lastCsv = { name: `vendas-${from}-a-${to}`, rows: sales.map((s) => ({ venda: s.number, data: s.sale_date, canal: CHANNELS[s.channel], vendedor: Data.memberName(s.seller_id), cliente: s.customer_name, total: Number(s.total), devolvido: Number(s.returned_total), liquido: net(s) })) };

    box.innerHTML = `
      <div class="grid grid-kpi">
        <div class="kpi"><span class="kpi-label">Vendido</span><span class="kpi-value sm money-sensitive">${esc(money(total))}</span></div>
        <div class="kpi"><span class="kpi-label">Vendas</span><span class="kpi-value sm">${sales.length}</span></div>
        <div class="kpi"><span class="kpi-label">Ticket médio</span><span class="kpi-value sm money-sensitive">${esc(money(sales.length ? total / sales.length : 0))}</span></div>
        <div class="kpi"><span class="kpi-label">Peças por atendimento</span><span class="kpi-value sm">${sales.length ? (pieces / sales.length).toFixed(1).replace('.', ',') : 0}</span></div>
      </div>
      <div class="card"><div class="card-head"><h3>Vendido por dia</h3></div><div class="card-body"><div data-chart></div>
        <details class="chart-table-toggle" style="margin-top:8px"><summary class="xs dim">Ver em tabela</summary>${chartTableHTML(labels, [{ name: 'Vendido', values }])}</details></div></div>
      <div class="grid grid-2">
        ${card('Por canal', bars(byChannel))}
        ${card('Por forma de pagamento', bars(byPay))}
        ${card('Por categoria', bars(byCat))}
        ${card('Por vendedor', bars(bySeller))}
        ${card('Por drop', bars(byDrop))}
        ${card('Por hora do dia', bars(byHour, money, 8))}
      </div>`;
    chart = lineChart($('[data-chart]', box), { labels, series: [{ name: 'Vendido', values }], format: money, height: 240 });
  }

  function productRows() {
    const sales = inPeriod();
    const ids = new Set(sales.map((s) => s.id));
    const map = new Map();
    for (const i of Data.allSaleItems()) {
      if (!ids.has(i.sale_id)) continue;
      const r = map.get(i.product_id) || { id: i.product_id, name: i.product_name, qty: 0, revenue: 0, cost: 0 };
      const q = i.qty - i.returned_qty;
      r.qty += q;
      r.revenue += q * (Number(i.total) / i.qty);
      r.cost += q * Data.saleItemCost(i.id);
      map.set(i.product_id, r);
    }
    return map;
  }

  function drawProducts(box) {
    const sold = productRows();
    const canM = Data.canMargin();
    const rows = Data.products().map((p) => {
      const r = sold.get(p.id) || { qty: 0, revenue: 0, cost: 0 };
      const stock = Data.variantsOf(p.id).reduce((a, v) => a + Math.max(v.on_hand, 0), 0);
      return {
        id: p.id, name: p.name, qty: r.qty, revenue: r.revenue, cost: r.cost, stock,
        // giro: quanto do que passou pela loja no período já saiu
        giro: r.qty + stock > 0 ? Math.round((r.qty / (r.qty + stock)) * 100) : 0,
        margin: r.revenue > 0 ? marginPct(r.revenue, r.cost) : 0,
      };
    });
    const top = [...rows].filter((r) => r.qty > 0).sort((a, b) => b.qty - a.qty);
    const bottom = [...rows].filter((r) => r.stock > 0).sort((a, b) => a.qty - b.qty).slice(0, 15);

    // sell-through por drop: % do lote já vendido
    const drops = Data.collections().map((c) => {
      const ps = Data.products().filter((p) => p.collection_id === c.id);
      const pids = new Set(ps.map((p) => p.id));
      const canceled = new Set(Data.sales().filter((s) => s.status === 'cancelado').map((s) => s.id));
      const qtySold = Data.allSaleItems().filter((i) => pids.has(i.product_id) && !canceled.has(i.sale_id)).reduce((a, i) => a + i.qty - i.returned_qty, 0);
      const left = ps.reduce((a, p) => a + Data.variantsOf(p.id).reduce((b, v) => b + Math.max(v.on_hand, 0), 0), 0);
      const lot = c.total_qty || qtySold + left;
      return { name: c.name, sold: qtySold, left, lot, pct: lot ? Math.round((qtySold / lot) * 100) : 0 };
    }).filter((d) => d.lot > 0);

    lastCsv = { name: `produtos-${from}-a-${to}`, rows: top.map((r) => ({ produto: r.name, pecas: r.qty, receita: r.revenue, ...(canM ? { custo: r.cost, margem_pct: r.margin } : {}), estoque: r.stock, giro_pct: r.giro })) };

    box.innerHTML = `
      ${card('Mais vendidos', table([
        { label: 'Produto', main: true, cell: (r) => `<span class="cell-primary">${esc(r.name)}</span>` },
        { label: 'Peças', right: true, cell: (r) => `<span class="num">${r.qty}</span>` },
        { label: 'Receita', right: true, cell: (r) => moneyHTML(r.revenue) },
        ...(canM ? [{ label: 'Margem', right: true, cell: (r) => `<span class="num money-sensitive">${r.margin}%</span>` }] : []),
        { label: 'Giro', right: true, cell: (r) => `<span class="num">${r.giro}%</span>` },
        { label: 'Estoque', right: true, cell: (r) => `<span class="num">${r.stock}</span>` },
      ], top.slice(0, 20), { empty: 'Sem vendas no período.' }))}
      ${drops.length ? card('Sell-through por drop', table([
        { label: 'Drop', main: true, cell: (d) => `<span class="cell-primary">${esc(d.name)}</span>` },
        { label: 'Vendidas', right: true, cell: (d) => `<span class="num">${d.sold}</span>` },
        { label: 'Lote', right: true, cell: (d) => `<span class="num">${d.lot}</span>` },
        { label: 'Vendido', right: true, cell: (d) => `<b class="num">${d.pct}%</b>` },
      ], drops)) : ''}
      ${card('Menos vendidos (com estoque)', table([
        { label: 'Produto', main: true, cell: (r) => `<span class="cell-primary">${esc(r.name)}</span>` },
        { label: 'Peças', right: true, cell: (r) => `<span class="num">${r.qty}</span>` },
        { label: 'Estoque', right: true, cell: (r) => `<span class="num">${r.stock}</span>` },
      ], bottom, { empty: 'Nada aqui.' }))}`;
  }

  function drawStock(box) {
    const v = Data.stockValue();
    const sold = productRows();
    const abc = abcCurve(Data.products().map((p) => ({ name: p.name, value: sold.get(p.id)?.revenue || 0 })));
    const counts = { A: 0, B: 0, C: 0 };
    abc.forEach((r) => { counts[r.abc] += 1; });
    // ruptura: quantos SKUs ativos estão zerados, por tamanho
    const rupture = new Map(); const totalBySize = new Map();
    for (const x of Data.variants()) {
      if (!x.active || !Data.product(x.product_id)) continue;
      const label = Data.size(x.size_id)?.label || '-';
      bump(totalBySize, label, 1);
      if (x.available <= 0) bump(rupture, label, 1);
    }
    lastCsv = { name: `curva-abc-${from}-a-${to}`, rows: abc.map((r) => ({ produto: r.name, receita: r.value, curva: r.abc })) };
    box.innerHTML = `
      <div class="grid grid-kpi">
        ${Data.canCost() ? `<div class="kpi"><span class="kpi-label">Valor a custo</span><span class="kpi-value sm money-sensitive">${esc(money(v.cost))}</span></div>` : ''}
        <div class="kpi"><span class="kpi-label">Valor de venda</span><span class="kpi-value sm money-sensitive">${esc(money(v.sale))}</span></div>
        <div class="kpi"><span class="kpi-label">Peças</span><span class="kpi-value sm">${v.units}</span></div>
        <div class="kpi"><span class="kpi-label">Abaixo do mínimo</span><span class="kpi-value sm">${Data.lowStock().length}</span></div>
      </div>
      <div class="grid grid-2">
        ${card('Ruptura por tamanho (SKUs zerados)', bars(rupture, (n) => `${n} SKU${n === 1 ? '' : 's'}`, 12))}
        ${card('Curva ABC por receita do período', `<p class="small muted" style="margin-bottom:10px">A: ${counts.A} produtos (80% da receita) · B: ${counts.B} · C: ${counts.C}</p>` + table([
          { label: 'Produto', main: true, cell: (r) => `<span class="cell-primary">${esc(r.name)}</span>` },
          { label: 'Receita', right: true, cell: (r) => moneyHTML(r.value) },
          { label: 'Curva', cell: (r) => badge(r.abc, r.abc === 'A' ? 'green' : r.abc === 'B' ? 'amber' : 'gray') },
        ], abc.slice(0, 15)))}
      </div>`;
  }

  function drawReturns(box) {
    const rets = Data.returns().filter((r) => r.created_at.slice(0, 10) >= from && r.created_at.slice(0, 10) <= to);
    const byReason = new Map(); const byProduct = new Map();
    for (const r of rets) {
      bump(byReason, RETURN_REASONS[r.reason] || r.reason, 1);
      for (const it of Data.returnItems(r.id)) {
        const si = Data.allSaleItems().find((x) => x.id === it.sale_item_id);
        if (si) bump(byProduct, si.product_id, it.qty);
      }
    }
    const sold = productRows();
    const rows = [...byProduct.entries()].map(([id, qty]) => {
      const name = Data.product(id)?.name || sold.get(id)?.name || '-';
      const base = (sold.get(id)?.qty || 0) + qty;
      return { name, qty, rate: base ? Math.round((qty / base) * 100) : 0 };
    }).sort((a, b) => b.rate - a.rate);
    lastCsv = { name: `trocas-${from}-a-${to}`, rows };
    const n = (x) => `${x}`;
    box.innerHTML = `
      <div class="grid grid-kpi">
        <div class="kpi"><span class="kpi-label">Trocas e devoluções</span><span class="kpi-value sm">${rets.length}</span></div>
        <div class="kpi"><span class="kpi-label">Valor</span><span class="kpi-value sm money-sensitive">${esc(money(rets.reduce((a, r) => a + Number(r.amount), 0)))}</span></div>
      </div>
      <div class="grid grid-2">
        ${card('Por motivo', bars(byReason, n))}
        ${card('Taxa de troca por produto', table([
          { label: 'Produto', main: true, cell: (r) => `<span class="cell-primary">${esc(r.name)}</span>` },
          { label: 'Peças', right: true, cell: (r) => `<span class="num">${r.qty}</span>` },
          { label: 'Taxa', right: true, cell: (r) => `<b class="num">${r.rate}%</b>` },
        ], rows, { empty: 'Nenhuma troca no período.' }))}
      </div>`;
  }

  function drawCustomers(box) {
    const sales = inPeriod().filter((s) => s.customer_id);
    const firstBuy = new Map();
    for (const s of [...Data.sales()].sort((a, b) => a.sale_date.localeCompare(b.sale_date))) {
      if (s.customer_id && s.status !== 'cancelado' && !firstBuy.has(s.customer_id)) firstBuy.set(s.customer_id, s.sale_date);
    }
    const buyers = new Set(sales.map((s) => s.customer_id));
    const fresh = [...buyers].filter((id) => firstBuy.get(id) >= from).length;
    const totals = new Map();
    for (const s of sales) bump(totals, s.customer_id, net(s));
    const rank = [...totals.entries()].map(([id, total]) => ({ name: Data.customer(id)?.name || '-', total })).sort((a, b) => b.total - a.total);
    const stats = Data.customerStats();
    const inactive = todayISO(addDays(new Date(), -90));
    const gone = Data.customers().filter((c) => stats.get(c.id) && stats.get(c.id).last < inactive);
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const bdays = Data.customers().filter((c) => c.birthday?.slice(5, 7) === month);
    lastCsv = { name: `clientes-${from}-a-${to}`, rows: rank };
    box.innerHTML = `
      <div class="grid grid-kpi">
        <div class="kpi"><span class="kpi-label">Compraram</span><span class="kpi-value sm">${buyers.size}</span></div>
        <div class="kpi"><span class="kpi-label">Novos</span><span class="kpi-value sm">${fresh}</span></div>
        <div class="kpi"><span class="kpi-label">Recorrentes</span><span class="kpi-value sm">${buyers.size - fresh}</span></div>
        <div class="kpi"><span class="kpi-label">Inativos há 90 dias</span><span class="kpi-value sm">${gone.length}</span></div>
      </div>
      <div class="grid grid-2">
        ${card('Quem mais comprou', table([
          { label: 'Cliente', main: true, cell: (r) => `<span class="cell-primary">${esc(r.name)}</span>` },
          { label: 'Total', right: true, cell: (r) => moneyHTML(r.total, 'strong') },
        ], rank.slice(0, 15), { empty: 'Nenhuma venda com cliente no período.' }))}
        ${card('Aniversariantes do mês', table([
          { label: 'Cliente', main: true, cell: (c) => `<span class="cell-primary">${esc(c.name)}</span>` },
          { label: 'Dia', cell: (c) => esc(c.birthday.slice(8, 10)) },
          { label: 'Tamanho', cell: (c) => esc(c.size_top || '-') },
        ], bdays.sort((a, b) => a.birthday.slice(8).localeCompare(b.birthday.slice(8))), { empty: 'Ninguém este mês.' }))}
      </div>`;
  }

  function drawTeam(box) {
    const sales = inPeriod();
    const rows = Data.members().map((m) => {
      const mine = sales.filter((s) => s.seller_id === m.user_id);
      const total = mine.reduce((a, s) => a + net(s) - Number(s.shipping_fee), 0);
      const ids = new Set(mine.map((s) => s.id));
      const pieces = Data.allSaleItems().filter((i) => ids.has(i.sale_id)).reduce((a, i) => a + i.qty - i.returned_qty, 0);
      return { name: m.nome, count: mine.length, pieces, total, pct: Number(m.commission_pct), commission: (total * Number(m.commission_pct)) / 100 };
    }).filter((r) => r.count > 0 || r.pct > 0).sort((a, b) => b.total - a.total);
    lastCsv = { name: `comissoes-${from}-a-${to}`, rows };
    box.innerHTML = card('Vendas e comissões', table([
      { label: 'Vendedor', main: true, cell: (r) => `<span class="cell-primary">${esc(r.name)}</span>` },
      { label: 'Vendas', right: true, cell: (r) => `<span class="num">${r.count}</span>` },
      { label: 'Peças', right: true, cell: (r) => `<span class="num">${r.pieces}</span>` },
      { label: 'Líquido', right: true, cell: (r) => moneyHTML(r.total) },
      { label: '%', right: true, cell: (r) => `<span class="num">${r.pct}%</span>` },
      { label: 'Comissão', right: true, cell: (r) => moneyHTML(r.commission, 'strong') },
    ], rows, { empty: 'Sem vendas no período.' }) + '<p class="xs dim" style="margin-top:8px">Comissão sobre o líquido: depois de descontos e devoluções, sem o frete.</p>');
  }

  async function setRange(from_, to_) {
    from = from_;
    to = to_;
    $('[data-from]', host).value = from;
    $('[data-to]', host).value = to;
    await Data.ensureSalesFrom(from).catch(onError('Não consegui buscar o período'));
    draw();
  }

  host.addEventListener('change', (e) => {
    if (e.target.matches('[data-from]')) setRange(e.target.value, to);
    if (e.target.matches('[data-to]')) setRange(from, e.target.value);
  });
  host.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) {
      tab = t.dataset.tab;
      host.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b === t)));
      draw();
      return;
    }
    const r = e.target.closest('[data-range]');
    if (r) {
      host.querySelectorAll('[data-range]').forEach((b) => b.setAttribute('aria-pressed', String(b === r)));
      const k = r.dataset.range;
      setRange(k === 'mes' ? todayISO(startOfMonth()) : todayISO(addDays(new Date(), -(Number(k) - 1))), todayISO());
      return;
    }
    if (e.target.closest('[data-csv]') && lastCsv) exportCSV(`${lastCsv.name}.csv`, lastCsv.rows);
  });

  draw();
  return { onData: draw, destroy() { chart?.destroy?.(); } };
}
