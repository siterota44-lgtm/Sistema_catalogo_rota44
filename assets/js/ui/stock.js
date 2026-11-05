/**
 * Estoque: o saldo nunca é editado, só muda por movimentação. Aqui ficam a posição,
 * a curva de grade, reposição, parados, o kardex de cada SKU e a contagem física.
 */

import * as Data from '../core/data.js';
import { esc, money, parseMoney, moneyInputValue, formatDateTime, formatDate, todayISO, addDays, debounce } from '../core/utils.js';
import { MOVEMENT_TYPES } from '../core/constants.js';
import { friendlyError } from '../core/errors.js';
import { icon } from './icons.js';
import { toast, toastError, openModal, withLoading, confirmDialog } from './kit.js';
import { $, $$, moneyHTML, badge, table, head, field, categoryOptions, paged, dot, matches, exportCSV, emptyBox, optionsMap } from './common.js';
import { openScanner } from './scanner.js';
import { openLabels } from './labels.js';

const TABS = { posicao: 'Posição', repor: 'Repor', parados: 'Parados', contagem: 'Contagem' };

export function mount(host) {
  let tab = 'posicao';
  let q = '';
  let cat = '';
  let limit = 60;
  const canCost = Data.canCost();

  function rowsFiltered() {
    const tree = cat ? Data.categoryTree(cat) : null;
    return Data.variants().filter((v) => {
      if (!v.active) return false;
      const p = Data.product(v.product_id);
      if (!p) return false;
      if (tree && !tree.has(p.category_id)) return false;
      return matches(q, p.name, v.sku, v.barcode, Data.color(v.color_id)?.name, Data.size(v.size_id)?.label);
    });
  }

  function render() {
    const value = canCost ? Data.stockValue() : null;
    host.innerHTML = `
      <div class="view">
        ${head('Estoque', '', `<button class="btn" data-export>${icon('download')} CSV</button>${canCost ? `<button class="btn btn-primary" data-entry>${icon('plus')} Entrada de estoque</button>` : ''}`)}
        ${value ? `<div class="grid grid-kpi">
          <div class="kpi"><span class="kpi-label">Peças</span><span class="kpi-value sm">${value.units}</span></div>
          <div class="kpi"><span class="kpi-label">Valor a custo</span><span class="kpi-value sm money-sensitive">${esc(money(value.cost))}</span></div>
          <div class="kpi"><span class="kpi-label">Valor de venda</span><span class="kpi-value sm money-sensitive">${esc(money(value.sale))}</span></div>
          <div class="kpi"><span class="kpi-label">Abaixo do mínimo</span><span class="kpi-value sm">${Data.lowStock().length}</span></div>
        </div>` : ''}
        <div class="tabs" role="tablist">
          ${Object.entries(TABS).filter(([k]) => k !== 'contagem' || canCost).map(([k, v]) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${esc(v)}</button>`).join('')}
        </div>
        <div data-body></div>
      </div>`;
    drawBody();
  }

  function drawBody() {
    const box = $('[data-body]', host);
    if (!box) return;
    if (tab === 'contagem') { drawInventory(box); return; }
    const toolbar = `<div class="toolbar" style="margin-bottom:12px"><select class="select" data-cat aria-label="Categoria">${categoryOptions(cat, { empty: 'Todas as categorias' })}</select></div>`;
    if (tab === 'posicao') {
      const { shown, more } = paged(rowsFiltered(), limit);
      box.innerHTML = toolbar + table([
        { label: 'Peça', main: true, cell: (v) => `<div><span class="cell-primary">${esc(Data.product(v.product_id).name)}</span><span class="cell-sub with-dot">${dot(Data.color(v.color_id)?.hex)} ${esc(Data.variantLabel(v))} · <span class="sku">${esc(v.sku)}</span></span></div>` },
        { label: 'Físico', right: true, cell: (v) => `<span class="num">${v.on_hand}</span>` },
        { label: 'Reservado', right: true, cell: (v) => `<span class="num ${v.reserved ? 'tone-amber' : 'dim'}">${v.reserved}</span>` },
        { label: 'Disponível', right: true, cell: (v) => levelBadge(v) },
        { label: 'Mínimo', right: true, cell: (v) => `<span class="num dim">${v.stock_min}</span>` },
        ...(v2Damaged() ? [{ label: 'Avaria', right: true, cell: (v) => (v.damaged ? `<span class="num tone-danger">${v.damaged}</span>` : '<span class="dim">-</span>') }] : []),
        ...(canCost ? [{ label: 'Custo médio', right: true, cell: (v) => moneyHTML(Data.cost(v.id)?.avg_cost || 0) }] : []),
      ], shown, { rowAttr: (v) => `data-variant="${esc(v.id)}"`, empty: 'Nenhuma peça.' }) + more;
    } else if (tab === 'repor') {
      const list = Data.lowStock().filter((v) => rowsFiltered().includes(v)).sort((a, b) => a.available - b.available);
      box.innerHTML = toolbar + table([
        { label: 'Peça', main: true, cell: (v) => `<div><span class="cell-primary">${esc(Data.product(v.product_id).name)}</span><span class="cell-sub">${esc(Data.variantLabel(v))}</span></div>` },
        { label: 'Disponível', right: true, cell: (v) => levelBadge(v) },
        { label: 'Mínimo', right: true, cell: (v) => `<span class="num">${v.stock_min}</span>` },
        { label: 'Vendeu em 60 dias', right: true, cell: (v) => `<span class="num">${soldQty(v.id, 60)}</span>` },
      ], list, { rowAttr: (v) => `data-variant="${esc(v.id)}"`, empty: 'Nada abaixo do mínimo. Tudo certo!' });
    } else {
      const days = 60;
      const list = rowsFiltered().filter((v) => v.on_hand > 0 && soldQty(v.id, days) === 0);
      const { shown, more } = paged(list, limit);
      box.innerHTML = `${toolbar}<p class="small muted" style="margin-bottom:10px">Sem venda há mais de ${days} dias: candidatos a promoção.</p>` + table([
        { label: 'Peça', main: true, cell: (v) => `<div><span class="cell-primary">${esc(Data.product(v.product_id).name)}</span><span class="cell-sub">${esc(Data.variantLabel(v))}</span></div>` },
        { label: 'Em estoque', right: true, cell: (v) => `<span class="num">${v.on_hand}</span>` },
        ...(canCost ? [{ label: 'Valor parado', right: true, cell: (v) => moneyHTML(v.on_hand * Number(Data.cost(v.id)?.avg_cost || 0)) }] : []),
      ], shown, { rowAttr: (v) => `data-variant="${esc(v.id)}"`, empty: 'Nenhuma peça parada.' }) + more;
    }
  }

  const v2Damaged = () => Data.variants().some((v) => v.damaged > 0);

  function drawInventory(box) {
    const open = Data.inventories().find((i) => i.status === 'aberto');
    box.innerHTML = `
      <div class="card card-pad col gap-4">
        ${open ? `
          <div class="row-between" style="flex-wrap:wrap"><div><b>Contagem #${open.number} aberta</b>
            <div class="small dim">${esc(open.category_id ? Data.category(open.category_id)?.name : 'Loja toda')} · ${esc(formatDateTime(open.created_at))}</div></div>
            <button class="btn btn-primary" data-count="${esc(open.id)}">${icon('box')} Continuar contando</button></div>`
        : `
          <p class="small muted">Conte as peças de verdade e compare com o sistema. Só o que divergir vira ajuste, com motivo e quem aprovou. Dica: uma categoria por semana (inventário rotativo).</p>
          <div class="toolbar">
            <select class="select" data-inv-cat aria-label="O que contar">${categoryOptions('', { empty: 'Loja toda' })}</select>
            <button class="btn btn-primary" data-start>${icon('plus')} Começar contagem</button>
          </div>`}
      </div>
      ${Data.inventories().filter((i) => i.status !== 'aberto').length ? `<div style="margin-top:12px">${table([
        { label: 'Contagem', main: true, cell: (i) => `<div><span class="cell-primary">#${i.number} · ${esc(i.category_id ? Data.category(i.category_id)?.name : 'Loja toda')}</span><span class="cell-sub">${esc(formatDateTime(i.created_at))}</span></div>` },
        { label: 'Situação', cell: (i) => (i.status === 'aplicado' ? badge('Aplicada', 'green') : badge('Cancelada', 'gray')) },
      ], Data.inventories().filter((i) => i.status !== 'aberto').slice(0, 10))}</div>` : ''}`;
  }

  host.addEventListener('change', (e) => {
    if (e.target.matches('[data-cat]')) { cat = e.target.value; limit = 60; drawBody(); }
  });
  host.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; render(); return; }
    if (e.target.closest('[data-more]')) { limit += 60; drawBody(); return; }
    if (e.target.closest('[data-entry]')) { openStockEntry(null, drawBody); return; }
    if (e.target.closest('[data-export]')) {
      exportCSV(`estoque-rota44-${todayISO()}.csv`, rowsFiltered().map((v) => ({
        produto: Data.product(v.product_id).name, cor: Data.color(v.color_id)?.name, tamanho: Data.size(v.size_id)?.label, sku: v.sku, codigo_barras: v.barcode,
        fisico: v.on_hand, reservado: v.reserved, disponivel: v.available, minimo: v.stock_min, avaria: v.damaged,
        ...(canCost ? { custo_medio: Number(Data.cost(v.id)?.avg_cost || 0), valor: v.on_hand * Number(Data.cost(v.id)?.avg_cost || 0) } : {}),
      })));
      return;
    }
    if (e.target.closest('[data-start]')) {
      try {
        const r = await Data.startInventory({ category_id: $('[data-inv-cat]', host).value || null });
        toast(`Contagem #${r.number} aberta`);
        openCount(r.id, drawBody);
      } catch (err) { toastError('Não consegui começar', friendlyError(err)); }
      return;
    }
    const c = e.target.closest('[data-count]');
    if (c) { openCount(c.dataset.count, drawBody); return; }
    const row = e.target.closest('[data-variant]');
    if (row) openVariantStock(row.dataset.variant, drawBody);
  });

  render();
  return { onSearch(v) { q = v; limit = 60; drawBody(); }, onData: drawBody };
}

function levelBadge(v) {
  const l = Data.level(v);
  return `<span class="badge no-dot" data-tone="${l === 'ok' ? 'green' : l === 'baixo' ? 'amber' : 'red'}">${v.available}</span>`;
}

function soldQty(variantId, days) {
  const from = todayISO(addDays(new Date(), -days));
  const canceled = new Set(Data.sales().filter((s) => s.status === 'cancelado').map((s) => s.id));
  return Data.allSaleItems().filter((i) => i.variant_id === variantId && i.sale_date >= from && !canceled.has(i.sale_id)).reduce((s, i) => s + i.qty, 0);
}

/** Matriz cor × tamanho: quais tamanhos estão acabando, de relance. */
export function stockGridHTML(productId) {
  const vs = Data.variantsOf(productId).filter((v) => v.active);
  if (!vs.length) return emptyBox('Sem variações');
  const colorIds = [...new Set(vs.map((v) => v.color_id))];
  const sizeIds = [...new Set(vs.map((v) => v.size_id))].sort((a, b) => (Data.size(a)?.sort || 0) - (Data.size(b)?.sort || 0));
  return `
    <div class="grid-matrix"><table>
      <thead><tr><th></th>${sizeIds.map((s) => `<th>${esc(Data.size(s)?.label)}</th>`).join('')}</tr></thead>
      <tbody>${colorIds.map((c) => `<tr>
        <th><span class="with-dot">${dot(Data.color(c)?.hex)} ${esc(Data.color(c)?.name)}</span></th>
        ${sizeIds.map((s) => {
          const v = vs.find((x) => x.color_id === c && x.size_id === s);
          if (!v) return '<td></td>';
          const l = Data.level(v);
          return `<td><button class="grid-cell ${l === 'zerado' ? 'is-out' : l === 'baixo' ? 'is-low' : 'is-ok'}" data-variant="${esc(v.id)}" aria-label="${esc(Data.variantLabel(v))}: ${v.available} disponíveis">${v.available}${v.reserved ? `<small>${v.reserved} res.</small>` : ''}</button></td>`;
        }).join('')}
      </tr>`).join('')}</tbody>
    </table></div>`;
}

/* ------------------------------------------------- entrada rápida ------ */

/**
 * Chegou peça: escolhe o produto, digita quantas de cada na grade e pronto.
 * Sem pedido de compra. Soma ao que já tem e atualiza o custo médio.
 */
export function openStockEntry(productId, done) {
  let current = productId;
  const m = openModal({
    title: 'Entrada de estoque',
    subtitle: 'Soma ao que já tem. Fica no histórico.',
    size: 'lg',
    body: '<div data-b></div>',
    footer: '<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-go>Dar entrada</button>',
  });
  const box = $('[data-b]', m.panel);

  function drawSearch() {
    m.foot.querySelector('[data-go]').hidden = true;
    box.innerHTML = `
      <div class="col gap-3">
        <input class="input" data-q placeholder="Produto, SKU ou código de barras" autocomplete="off" data-autofocus aria-label="Buscar produto">
        <div data-found></div>
      </div>`;
    const list = (q) => {
      const rows = (q ? Data.searchProducts(q) : Data.products().filter((p) => p.status === 'ativo')).slice(0, 12);
      $('[data-found]', box).innerHTML = rows.length ? `<div class="mobile-list">${rows.map((p) => `
        <button type="button" class="m-row link-like" data-pick="${esc(p.id)}" style="width:100%">
          <span class="m-main"><span class="m-title">${esc(p.name)}</span><span class="m-sub">${Data.productStock(p.id)} disponíveis</span></span>
          ${icon('chevronRight')}
        </button>`).join('')}</div>` : emptyBox('Nada encontrado');
    };
    $('[data-q]', box).addEventListener('input', (e) => list(e.target.value));
    $('[data-q]', box).focus();
    list('');
  }

  function drawGrid_() {
    const p = Data.product(current);
    const vs = Data.variantsOf(current).filter((v) => v.active);
    const colorIds = [...new Set(vs.map((v) => v.color_id))];
    const sizeIds = [...new Set(vs.map((v) => v.size_id))].sort((a, b) => (Data.size(a)?.sort || 0) - (Data.size(b)?.sort || 0));
    const last = vs.map((v) => Number(Data.cost(v.id)?.last_cost || 0)).find(Boolean) || 0;
    m.foot.querySelector('[data-go]').hidden = false;
    box.innerHTML = `
      <div class="col gap-3">
        <div class="row-between" style="flex-wrap:wrap"><b>${esc(p.name)}</b>${productId ? '' : '<button type="button" class="btn btn-ghost btn-sm" data-change>Trocar produto</button>'}</div>
        <div class="grid-matrix"><table>
          <thead><tr><th>Quantas chegaram</th>${sizeIds.map((s) => `<th>${esc(Data.size(s)?.label)}</th>`).join('')}</tr></thead>
          <tbody>${colorIds.map((c) => `<tr>
            <th><span class="with-dot">${dot(Data.color(c)?.hex)} ${esc(Data.color(c)?.name)}</span></th>
            ${sizeIds.map((s) => {
              const v = vs.find((x) => x.color_id === c && x.size_id === s);
              return `<td>${v ? `<input class="input" type="number" inputmode="numeric" min="0" data-qty="${esc(v.id)}" placeholder="${v.on_hand}" aria-label="${esc(Data.variantLabel(v))}, tem ${v.on_hand}">` : ''}</td>`;
            }).join('')}
          </tr>`).join('')}</tbody>
        </table></div>
        <p class="xs dim">O número apagado é o que já tem.</p>
        <div class="form-grid">
          ${field('Custo de cada peça', `<div class="money-input"><input class="input" data-cost inputmode="numeric" value="${last ? esc(moneyInputValue(last)) : ''}"></div>`, 6, 'Deixe vazio se não souber: o custo médio não muda.')}
          ${field('De onde veio (opcional)', '<input class="input" data-reason placeholder="Confecção da Rua">', 6)}
        </div>
      </div>`;
  }

  const draw = () => (current ? drawGrid_() : drawSearch());
  m.panel.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-pick]');
    if (pick) { current = pick.dataset.pick; draw(); return; }
    if (e.target.closest('[data-change]')) { current = null; draw(); return; }
    const go = e.target.closest('[data-go]');
    if (!go) return;
    withLoading(go, async () => {
      const cost = parseMoney($('[data-cost]', m.panel).value);
      const items = $$('[data-qty]', m.panel).map((el) => ({ variant_id: el.dataset.qty, qty: Number(el.value) || 0, unit_cost: cost || null })).filter((x) => x.qty > 0);
      if (!items.length) { toast('Digite a quantidade em ao menos um tamanho', { kind: 'warn' }); return; }
      try {
        const r = await Data.quickStockEntry({ items, reason: $('[data-reason]', m.panel).value });
        m.close();
        toast('Entrada lançada', { text: `${r.pieces} peça${r.pieces === 1 ? '' : 's'}` });
        done?.();
        if (await confirmDialog({ title: 'Imprimir as etiquetas agora?', confirmText: 'Imprimir', cancelText: 'Agora não' })) {
          openLabels(items.map(({ variant_id, qty }) => ({ variant_id, qty })));
        }
      } catch (err) { toastError('Não consegui lançar', friendlyError(err)); }
    });
  });
  draw();
}

/* ------------------------------------------------- ficha da variação --- */

export function openVariantStock(variantId, done) {
  const canSeeHistory = Data.canCost();
  const m = openModal({ title: 'Peça', size: 'lg', body: '<div data-b></div>', footer: '<div data-a class="row gap-2" style="flex-wrap:wrap;justify-content:flex-end;width:100%"></div>' });
  const draw = async () => {
    const v = Data.variant(variantId);
    if (!v) { m.close(); return; }
    m.panel.querySelector('.modal-head h2').textContent = Data.variantTitle(v);
    const c = Data.cost(v.id);
    $('[data-b]', m.panel).innerHTML = `
      <div class="col gap-4">
        <dl class="kv">
          <div><dt>Físico</dt><dd class="num strong">${v.on_hand}</dd></div>
          <div><dt>Reservado</dt><dd class="num">${v.reserved}</dd></div>
          <div><dt>Disponível</dt><dd>${levelBadge(v)}</dd></div>
          <div><dt>Mínimo</dt><dd class="num">${v.stock_min}</dd></div>
          ${v.damaged ? `<div><dt>Avaria</dt><dd class="num tone-danger">${v.damaged}</dd></div>` : ''}
          ${c ? `<div><dt>Custo médio</dt><dd>${moneyHTML(c.avg_cost)}</dd></div><div><dt>Última compra</dt><dd>${moneyHTML(c.last_cost)}</dd></div>` : ''}
          <div><dt>SKU</dt><dd class="sku">${esc(v.sku)}</dd></div>
          <div><dt>Código de barras</dt><dd class="sku">${esc(v.barcode)}</dd></div>
        </dl>
        ${canSeeHistory ? '<div><div class="fieldset-title" style="margin-bottom:6px">Histórico (kardex)</div><div data-kardex><div class="spinner"></div></div></div>' : ''}
      </div>`;
    $('[data-a]', m.foot).innerHTML = canSeeHistory ? `
      <button class="btn" data-move="entrada_producao">${icon('plus')} Entrada</button>
      <button class="btn" data-move="saida">${icon('minus')} Saída</button>
      <button class="btn btn-primary" data-move="ajuste">${icon('edit')} Ajustar saldo</button>` : '';
    if (canSeeHistory) {
      try {
        const rows = await Data.movements(variantId);
        if (!m.el.isConnected) return;
        $('[data-kardex]', m.panel).innerHTML = rows.length ? table([
          { label: 'Movimento', main: true, cell: (r) => `<div><span class="cell-primary">${esc(MOVEMENT_TYPES[r.type] || r.type)}</span><span class="cell-sub">${esc(formatDateTime(r.created_at))} · ${esc(Data.memberName(r.created_by))}${r.reason ? ` · ${esc(r.reason)}` : ''}</span></div>` },
          { label: 'Qtd', right: true, cell: (r) => (r.qty ? `<b class="num ${r.qty > 0 ? 'tone-ok' : 'tone-danger'}">${r.qty > 0 ? '+' : ''}${r.qty}</b>` : r.reserved_delta ? `<span class="num dim">res. ${r.reserved_delta > 0 ? '+' : ''}${r.reserved_delta}</span>` : '<span class="dim">0</span>') },
          { label: 'Saldo', right: true, cell: (r) => `<span class="num">${r.balance_after}</span>` },
        ], rows) : '<p class="small dim">Sem movimentos ainda.</p>';
      } catch (err) {
        $('[data-kardex]', m.panel).innerHTML = `<p class="small tone-danger">${esc(friendlyError(err))}</p>`;
      }
    }
  };
  m.panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-move]');
    if (b) openMove(variantId, b.dataset.move, () => { draw(); done?.(); });
  });
  draw();
}

function openMove(variantId, kind, done) {
  const v = Data.variant(variantId);
  const isAdjust = kind === 'ajuste';
  const isOut = kind === 'saida';
  const outTypes = Data.canMargin()
    ? { brinde: 'Brinde / uso interno / mostruário', perda: 'Perda / avaria / furto', devolucao_fornecedor: 'Devolução ao fornecedor' }
    : { brinde: 'Brinde / uso interno / mostruário', devolucao_fornecedor: 'Devolução ao fornecedor' };
  const m = openModal({
    title: isAdjust ? 'Ajustar saldo' : isOut ? 'Saída' : 'Entrada',
    subtitle: `${Data.variantTitle(v)} · físico: ${v.on_hand}`,
    body: `
      <form class="form-grid" data-f>
        ${isAdjust ? field('Saldo contado', `<input class="input" type="number" inputmode="numeric" min="0" name="new_on_hand" value="${v.on_hand}" data-autofocus>`, 12) : field('Quantidade', '<input class="input" type="number" inputmode="numeric" min="1" name="qty" data-autofocus>', 6)}
        ${isOut ? field('Tipo', `<select class="select" name="type">${optionsMap(outTypes, 'brinde')}</select>`, 6) : ''}
        ${!isAdjust && !isOut ? field('Custo unitário', '<input class="input" name="unit_cost" inputmode="decimal" placeholder="Peça vinda da produção">', 6) : ''}
        ${field('Motivo (obrigatório)', '<input class="input" name="reason">', 12)}
      </form>`,
    footer: '<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Confirmar</button>',
  });
  const ok = m.foot.querySelector('[data-ok]');
  ok.addEventListener('click', () => withLoading(ok, async () => {
    const q = (n) => m.panel.querySelector(`[name=${n}]`)?.value;
    const reason = (q('reason') || '').trim();
    if (!reason) { toast('Informe o motivo', { kind: 'warn' }); return; }
    const p = { variant_id: variantId, reason };
    if (isAdjust) { p.type = 'ajuste'; p.new_on_hand = Number(q('new_on_hand')); }
    else {
      p.type = isOut ? q('type') : 'entrada_producao';
      p.qty = Number(q('qty'));
      if (!p.qty) { toast('Informe a quantidade', { kind: 'warn' }); return; }
      if (q('unit_cost')) p.unit_cost = String(q('unit_cost')).replace(',', '.');
    }
    try {
      await Data.adjustStock(p);
      m.close();
      toast('Estoque atualizado');
      done();
    } catch (err) { toastError('Não consegui lançar', friendlyError(err)); }
  }));
}

/* ------------------------------------------------- contagem física ----- */

function openCount(inventoryId, done) {
  const LS = `rota44.count.${inventoryId}`;
  let items = [];
  let filter = '';
  let draft = {};
  try { draft = JSON.parse(localStorage.getItem(LS)) || {}; } catch { /* sem armazenamento */ }

  const canApprove = Data.canMargin();
  const m = openModal({
    title: 'Contagem de estoque',
    subtitle: 'Bipe ou digite o que tem de verdade. O rascunho fica salvo neste aparelho.',
    size: 'xl',
    body: `
      <div class="col gap-3">
        <div class="pos-scan">
          <input class="input" data-q placeholder="Bipe o código ou busque" autocomplete="off" data-autofocus>
          <button class="btn" data-camera>${icon('camera')}<span class="hide-mobile">Câmera</span></button>
        </div>
        <div class="small muted" data-progress></div>
        <div data-list><div class="spinner"></div></div>
      </div>`,
    footer: `
      <button class="btn btn-ghost" data-cancel style="margin-right:auto">Cancelar contagem</button>
      <button class="btn" data-save>Salvar</button>
      ${canApprove ? '<button class="btn btn-primary" data-apply>Aplicar ajustes</button>' : ''}`,
  });

  const counted = (it) => (draft[it.variant_id] !== undefined ? draft[it.variant_id] : it.counted);
  const persist = debounce(() => { try { localStorage.setItem(LS, JSON.stringify(draft)); } catch { /* */ } }, 300);

  function drawList() {
    const list = items.filter((it) => {
      const v = Data.variant(it.variant_id);
      return v && matches(filter, Data.product(v.product_id)?.name, v.sku, v.barcode, Data.variantLabel(v));
    });
    const done_ = items.filter((it) => counted(it) != null && counted(it) !== '').length;
    const diffs = items.filter((it) => { const c = counted(it); return c != null && c !== '' && Number(c) !== Data.variant(it.variant_id)?.on_hand; }).length;
    $('[data-progress]', m.panel).textContent = `${done_} de ${items.length} contadas · ${diffs} com diferença`;
    $('[data-list]', m.panel).innerHTML = table([
      { label: 'Peça', main: true, cell: (it) => { const v = Data.variant(it.variant_id); return `<div><span class="cell-primary">${esc(Data.product(v.product_id)?.name)}</span><span class="cell-sub">${esc(Data.variantLabel(v))} · <span class="sku">${esc(v.sku)}</span></span></div>`; } },
      { label: 'Sistema', right: true, cell: (it) => `<span class="num">${Data.variant(it.variant_id).on_hand}</span>` },
      { label: 'Contado', right: true, cell: (it) => { const c = counted(it); const v = Data.variant(it.variant_id); const diff = c != null && c !== '' && Number(c) !== v.on_hand; return `<input class="input" style="width:82px;text-align:center;${diff ? 'border-color:var(--warning)' : ''}" type="number" inputmode="numeric" min="0" data-count="${esc(it.variant_id)}" value="${c ?? ''}" aria-label="Quantidade contada">`; } },
    ], list.slice(0, 200), { empty: 'Nada nessa busca.' });
  }

  m.panel.addEventListener('input', (e) => {
    if (e.target.matches('[data-q]')) { filter = e.target.value; drawList(); return; }
    if (e.target.matches('[data-count]')) {
      draft[e.target.dataset.count] = e.target.value === '' ? '' : Number(e.target.value);
      persist();
      const done_ = items.filter((it) => counted(it) != null && counted(it) !== '').length;
      $('[data-progress]', m.panel).textContent = `${done_} de ${items.length} contadas`;
    }
  });
  const bump = (code) => {
    const v = Data.findByCode(code);
    if (!v || !items.some((i) => i.variant_id === v.id)) { toast('Código fora desta contagem', { kind: 'warn', text: code }); return; }
    const it = items.find((i) => i.variant_id === v.id);
    draft[v.id] = (Number(counted(it)) || 0) + 1;
    persist();
    toast(`${Data.variantTitle(v)}: ${draft[v.id]}`, { duration: 1200 });
    drawList();
    return `${Data.variantTitle(v)}: ${draft[v.id]}`;
  };
  m.panel.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-q]')) {
      e.preventDefault();
      e.stopPropagation();
      const code = e.target.value.trim();
      // código que não existe também sai do campo: o próximo bipe colaria nele
      if (Data.findByCode(code) || /^\d{6,}$/.test(code)) { bump(code); e.target.value = ''; filter = ''; drawList(); }
    }
  });

  const saveCounts = async () => {
    const counts = Object.entries(draft).map(([variant_id, c]) => ({ variant_id, counted: c === '' ? null : c }));
    if (counts.length) await Data.saveInventoryCounts(inventoryId, counts);
    items = await Data.inventoryItems(inventoryId);
    draft = {};
    try { localStorage.removeItem(LS); } catch { /* */ }
  };

  m.panel.addEventListener('click', async (e) => {
    if (e.target.closest('[data-camera]')) { openScanner({ title: 'Contar peças', keepOpen: true, onCode: bump }); return; }
    if (e.target.closest('[data-save]')) {
      withLoading(e.target.closest('[data-save]'), async () => {
        try { await saveCounts(); drawList(); toast('Contagem salva'); } catch (err) { toastError('Não consegui salvar', friendlyError(err)); }
      });
      return;
    }
    if (e.target.closest('[data-apply]')) {
      const btn = e.target.closest('[data-apply]');
      withLoading(btn, async () => {
        try {
          await saveCounts();
          const diffs = items.filter((i) => i.counted != null && i.counted !== Data.variant(i.variant_id)?.on_hand).length;
          const yes = await confirmDialog({
            title: `Aplicar ${diffs} ajuste${diffs === 1 ? '' : 's'}?`,
            message: 'O saldo dessas peças passa a ser o contado. Cada ajuste fica no histórico. O que não foi contado não muda.',
            confirmText: 'Aplicar',
          });
          if (!yes) return;
          const r = await Data.applyInventory(inventoryId, 'Contagem física');
          m.close();
          toast('Contagem aplicada', { text: `${r.adjusted} ajuste${r.adjusted === 1 ? '' : 's'}` });
          done?.();
        } catch (err) { toastError('Não consegui aplicar', friendlyError(err)); }
      });
      return;
    }
    if (e.target.closest('[data-cancel]')) {
      if (await confirmDialog({ title: 'Cancelar esta contagem?', message: 'O estoque não muda.', confirmText: 'Cancelar contagem', cancelText: 'Voltar', danger: true })) {
        try {
          await Data.cancelInventory(inventoryId);
          try { localStorage.removeItem(LS); } catch { /* */ }
          m.close();
          done?.();
        } catch (err) { toastError('Não consegui cancelar', friendlyError(err)); }
      }
    }
  });

  Data.inventoryItems(inventoryId).then((rows) => { items = rows; drawList(); })
    .catch((err) => toastError('Não consegui abrir a contagem', friendlyError(err)));
}
