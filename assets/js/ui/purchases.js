/**
 * Pedidos de compra com lançamento em grade (cores nas linhas, tamanhos nas
 * colunas), recebimento parcial e custo médio. Receber dá entrada no estoque e
 * cria a conta a pagar, tudo numa transação do banco.
 */

import * as Data from '../core/data.js';
import { esc, money, parseMoney, formatDate, todayISO, addDays, moneyInputValue } from '../core/utils.js';
import { PURCHASE_STATUS } from '../core/constants.js';
import { friendlyError } from '../core/errors.js';
import { icon } from './icons.js';
import { toast, toastError, openModal, withLoading, confirmDialog } from './kit.js';
import { $, $$, moneyHTML, badge, table, head, field, options, moneyInput, paged, dot, readForm, matches, code } from './common.js';
import { openLabels } from './labels.js';
import { openSupplierForm } from './suppliers.js';

export function mount(host) {
  let limit = 40;
  host.innerHTML = `
    <div class="view">
      ${head('Compras', 'Pedido ao fornecedor → conferência → entrada no estoque', `<button class="btn btn-primary" data-new>${icon('plus')} Novo pedido</button>`)}
      <div data-list></div>
    </div>`;
  function render() {
    const { shown, more } = paged(Data.purchases(), limit);
    $('[data-list]', host).innerHTML = table([
      { label: 'Pedido', main: true, cell: (p) => `<div><span class="cell-primary">${esc(code(p.number))} ${esc(Data.supplier(p.supplier_id)?.name || 'Sem fornecedor')}</span><span class="cell-sub">${esc(formatDate(p.created_at))}${p.kind === 'producao' ? ' · Produção própria' : ''}</span></div>` },
      { label: 'Peças', right: true, cell: (p) => { const it = Data.purchaseItems(p.id); return `<span class="num">${it.reduce((a, i) => a + i.qty_received, 0)}/${it.reduce((a, i) => a + i.qty_ordered, 0)}</span>`; } },
      { label: 'Previsão', cell: (p) => (p.expected_on ? esc(formatDate(p.expected_on)) : '-') },
      { label: 'Situação', cell: (p) => badge(PURCHASE_STATUS[p.status]?.label, PURCHASE_STATUS[p.status]?.tone) },
      { label: 'Total', right: true, cell: (p) => moneyHTML(p.total, 'strong') },
    ], shown, { rowAttr: (p) => `data-open="${esc(p.id)}"`, empty: 'Nenhum pedido de compra ainda.' }) + more;
  }
  host.addEventListener('click', (e) => {
    if (e.target.closest('[data-new]')) { openPurchaseForm(null); return; }
    if (e.target.closest('[data-more]')) { limit += 40; render(); return; }
    const row = e.target.closest('[data-open]');
    if (row) openPurchase(row.dataset.open);
  });
  render();
  return { onData: render };
}

function openPurchase(id) {
  const m = openModal({ title: 'Pedido de compra', size: 'lg', body: '<div data-b></div>', footer: '<div data-a class="row gap-2" style="flex-wrap:wrap;justify-content:flex-end;width:100%"></div>' });
  const draw = () => {
    const p = Data.purchase(id);
    if (!p) { m.close(); return; }
    const items = Data.purchaseItems(id);
    m.panel.querySelector('.modal-head h2').textContent = `Pedido ${code(p.number)}`;
    $('[data-b]', m.panel).innerHTML = `
      <div class="col gap-4">
        <dl class="kv">
          <div><dt>Fornecedor</dt><dd>${esc(Data.supplier(p.supplier_id)?.name || '-')}</dd></div>
          <div><dt>Situação</dt><dd>${badge(PURCHASE_STATUS[p.status]?.label, PURCHASE_STATUS[p.status]?.tone)}</dd></div>
          <div><dt>Previsão</dt><dd>${p.expected_on ? esc(formatDate(p.expected_on)) : '-'}</dd></div>
          <div><dt>Frete</dt><dd>${moneyHTML(p.freight)}</dd></div>
          <div><dt>Total</dt><dd>${moneyHTML(p.total, 'strong')}</dd></div>
          ${p.notes ? `<div><dt>Observação</dt><dd>${esc(p.notes)}</dd></div>` : ''}
        </dl>
        ${table([
          { label: 'Peça', main: true, cell: (i) => { const v = Data.variant(i.variant_id); return `<div><span class="cell-primary">${esc(Data.product(v?.product_id)?.name)}</span><span class="cell-sub">${esc(v ? Data.variantLabel(v) : '')}</span></div>`; } },
          { label: 'Pedido', right: true, cell: (i) => `<span class="num">${i.qty_ordered}</span>` },
          { label: 'Recebido', right: true, cell: (i) => `<span class="num ${i.qty_received >= i.qty_ordered ? 'tone-ok' : ''}">${i.qty_received}</span>` },
          { label: 'Custo', right: true, cell: (i) => moneyHTML(i.unit_cost) },
        ], items)}
      </div>`;
    const open = !['recebido', 'cancelado'].includes(p.status);
    $('[data-a]', m.foot).innerHTML = `
      ${items.some((i) => i.qty_received > 0) ? `<button class="btn" data-labels>${icon('print')} Etiquetas</button>` : ''}
      ${p.status === 'rascunho' || p.status === 'enviado' ? `<button class="btn" data-edit>${icon('edit')} Editar</button>` : ''}
      ${['rascunho', 'enviado'].includes(p.status) && Data.canMargin() ? '<button class="btn btn-danger" data-cancel>Cancelar pedido</button>' : ''}
      ${p.status === 'parcial' && Data.canMargin() ? '<button class="btn" data-close-rest>Encerrar sem o restante</button>' : ''}
      ${open ? `<button class="btn btn-primary" data-receive>${icon('truck')} Receber</button>` : ''}`;
  };
  m.panel.addEventListener('click', async (e) => {
    if (e.target.closest('[data-edit]')) { openPurchaseForm(Data.purchase(id), draw); return; }
    if (e.target.closest('[data-receive]')) { openReceive(id, draw); return; }
    if (e.target.closest('[data-close-rest]')) {
      if (await confirmDialog({ title: 'Encerrar este pedido?', message: 'O que falta não vem mais. O que já chegou continua no estoque.', confirmText: 'Encerrar', cancelText: 'Voltar' })) {
        try { await Data.closePurchase(id); toast('Pedido encerrado'); draw(); } catch (err) { toastError('Não deu', friendlyError(err)); }
      }
      return;
    }
    if (e.target.closest('[data-labels]')) {
      openLabels(Data.purchaseItems(id).filter((i) => i.qty_received > 0).map((i) => ({ variant_id: i.variant_id, qty: i.qty_received })));
      return;
    }
    if (e.target.closest('[data-cancel]')) {
      if (await confirmDialog({ title: 'Cancelar este pedido?', confirmText: 'Cancelar pedido', cancelText: 'Voltar', danger: true })) {
        try { await Data.cancelPurchase(id); toast('Pedido cancelado'); draw(); } catch (err) { toastError('Não deu', friendlyError(err)); }
      }
    }
  });
  draw();
}

function openReceive(id, done) {
  const p = Data.purchase(id);
  const items = Data.purchaseItems(id).filter((i) => i.qty_ordered > i.qty_received);
  const m = openModal({
    title: `Receber pedido ${code(p.number)}`,
    subtitle: 'Confira item a item. Pode receber só uma parte.',
    size: 'lg',
    body: `
      <div class="col gap-4">
        ${table([
          { label: 'Peça', main: true, cell: (i) => { const v = Data.variant(i.variant_id); return `<div><span class="cell-primary">${esc(Data.product(v?.product_id)?.name)}</span><span class="cell-sub">${esc(v ? Data.variantLabel(v) : '')}</span></div>`; } },
          { label: 'Falta', right: true, cell: (i) => `<span class="num">${i.qty_ordered - i.qty_received}</span>` },
          { label: 'Chegou', right: true, cell: (i) => `<input class="input" style="width:82px;text-align:center" type="number" inputmode="numeric" min="0" max="${i.qty_ordered - i.qty_received}" data-qty="${esc(i.id)}" value="${i.qty_ordered - i.qty_received}" aria-label="Quantidade recebida">` },
        ], items)}
        <div class="form-grid">
          ${field('1º vencimento', `<input class="input" type="date" name="due" value="${todayISO(addDays(new Date(), 30))}">`, 6)}
          ${field('Parcelas', `<select class="select" name="inst">${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}">${n}×</option>`).join('')}</select>`, 6)}
          <div class="span-12"><label class="check"><input type="checkbox" name="bill" checked><span class="box"></span><span>Criar conta a pagar</span></label></div>
        </div>
      </div>`,
    footer: '<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Dar entrada no estoque</button>',
  });
  const ok = m.foot.querySelector('[data-ok]');
  ok.addEventListener('click', () => withLoading(ok, async () => {
    const list = $$('[data-qty]', m.panel).map((el) => ({ item_id: el.dataset.qty, qty: Number(el.value) || 0 })).filter((x) => x.qty > 0);
    if (!list.length) { toast('Informe o que chegou', { kind: 'warn' }); return; }
    try {
      const r = await Data.receivePurchase({
        purchase_id: id, items: list, create_bill: m.panel.querySelector('[name=bill]').checked,
        due_date: m.panel.querySelector('[name=due]').value, installments: Number(m.panel.querySelector('[name=inst]').value),
      });
      m.close();
      toast(r.status === 'recebido' ? 'Pedido recebido' : 'Recebimento parcial', { text: `Entrada de ${money(r.value)} a custo` });
      done?.();
      if (await confirmDialog({ title: 'Imprimir as etiquetas agora?', confirmText: 'Imprimir', cancelText: 'Agora não' })) {
        openLabels(list.map((x) => {
          const it = Data.purchaseItems(id).find((i) => i.id === x.item_id);
          return { variant_id: it.variant_id, qty: x.qty };
        }));
      }
    } catch (err) { toastError('Não consegui dar entrada', friendlyError(err)); }
  }));
}

export function openPurchaseForm(p, done) {
  // lines: variant_id → { qty, cost }
  const lines = new Map();
  if (p) for (const i of Data.purchaseItems(p.id)) lines.set(i.variant_id, { qty: i.qty_ordered, cost: Number(i.unit_cost) });

  const m = openModal({
    title: p ? `Editar pedido ${code(p.number)}` : 'Novo pedido de compra',
    size: 'xl',
    body: `
      <div class="col gap-5">
        <form class="form-grid" data-f>
          <div class="field span-5"><label class="label">Fornecedor</label>
            <div class="row gap-2"><select class="select grow" name="supplier_id">${options(Data.suppliers().filter((s) => s.active), p?.supplier_id, { empty: 'Escolha' })}</select>
            <button type="button" class="btn" data-new-supplier aria-label="Novo fornecedor">${icon('plus')}</button></div></div>
          ${field('Tipo', `<select class="select" name="kind"><option value="compra"${p?.kind !== 'producao' ? ' selected' : ''}>Compra</option><option value="producao"${p?.kind === 'producao' ? ' selected' : ''}>Produção própria</option></select>`, 3)}
          ${field('Previsão de chegada', `<input class="input" type="date" name="expected_on" value="${esc(p?.expected_on)}">`, 2)}
          ${field('Frete', moneyInput('freight', p?.freight), 2)}
          ${field('Observação', `<input class="input" name="notes" value="${esc(p?.notes)}">`, 12)}
        </form>
        <div class="fieldset">
          <div class="fieldset-title">Adicionar peças</div>
          <input class="input" data-search placeholder="Busque o produto para lançar em grade" autocomplete="off">
          <div data-found></div>
          <div data-grid-host></div>
        </div>
        <div>
          <div class="fieldset-title" style="margin-bottom:6px">No pedido</div>
          <div data-lines></div>
        </div>
      </div>`,
    footer: `
      <span class="grow" data-sum style="font-weight:700"></span>
      <button class="btn" data-close>Cancelar</button>
      <button class="btn" data-save="rascunho">Salvar rascunho</button>
      <button class="btn btn-primary" data-save="enviado">Marcar como enviado</button>`,
  });

  const form = $('[data-f]', m.panel);

  function drawLines() {
    const rows = [...lines.entries()].map(([variant_id, x]) => ({ variant_id, ...x }));
    $('[data-lines]', m.panel).innerHTML = table([
      { label: 'Peça', main: true, cell: (r) => { const v = Data.variant(r.variant_id); return `<div><span class="cell-primary">${esc(Data.product(v?.product_id)?.name)}</span><span class="cell-sub">${esc(v ? Data.variantLabel(v) : '')}</span></div>`; } },
      { label: 'Qtd', right: true, cell: (r) => `<span class="num">${r.qty}</span>` },
      { label: 'Custo', right: true, cell: (r) => moneyHTML(r.cost) },
      { label: 'Total', right: true, cell: (r) => moneyHTML(r.qty * r.cost, 'strong') },
      { label: '', cell: (r) => `<div class="row-actions"><button type="button" class="icon-btn sm" data-rm="${esc(r.variant_id)}" aria-label="Tirar">${icon('x')}</button></div>` },
    ], rows, { empty: 'Busque um produto acima e digite as quantidades.' });
    const sum = rows.reduce((a, r) => a + r.qty * r.cost, 0) + parseMoney(form.freight.value);
    $('[data-sum]', m.foot).textContent = `Total: ${money(sum)}`;
  }

  function showGrid(productId) {
    const prod = Data.product(productId);
    const vs = Data.variantsOf(productId).filter((v) => v.active);
    const colorIds = [...new Set(vs.map((v) => v.color_id))];
    const sizeIds = [...new Set(vs.map((v) => v.size_id))].sort((a, b) => (Data.size(a)?.sort || 0) - (Data.size(b)?.sort || 0));
    const lastCost = vs.map((v) => Number(Data.cost(v.id)?.last_cost || 0)).find(Boolean) || 0;
    $('[data-found]', m.panel).innerHTML = '';
    $('[data-search]', m.panel).value = '';
    $('[data-grid-host]', m.panel).innerHTML = `
      <div class="card card-pad col gap-3">
        <div class="row-between" style="flex-wrap:wrap"><b>${esc(prod.name)}</b>
          <div class="row gap-2"><label class="label" style="margin:0">Custo por peça</label><div class="money-input" style="width:130px"><input class="input" data-unit inputmode="numeric" value="${lastCost ? esc(moneyInputValue(lastCost)) : ''}"></div></div></div>
        <div class="grid-matrix"><table>
          <thead><tr><th></th>${sizeIds.map((s) => `<th>${esc(Data.size(s)?.label)}</th>`).join('')}</tr></thead>
          <tbody>${colorIds.map((c) => `<tr>
            <th><span class="with-dot">${dot(Data.color(c)?.hex)} ${esc(Data.color(c)?.name)}</span></th>
            ${sizeIds.map((s) => {
              const v = vs.find((x) => x.color_id === c && x.size_id === s);
              return `<td>${v ? `<input class="input" type="number" inputmode="numeric" min="0" data-gridqty="${esc(v.id)}" value="${lines.get(v.id)?.qty || ''}" placeholder="0" aria-label="${esc(Data.variantLabel(v))}">` : ''}</td>`;
            }).join('')}
          </tr>`).join('')}</tbody>
        </table></div>
        <button type="button" class="btn btn-primary" data-grid-add style="align-self:flex-end">Colocar no pedido</button>
      </div>`;
  }

  m.panel.addEventListener('input', (e) => {
    if (e.target.matches('[data-search]')) {
      const q = e.target.value;
      const list = q ? Data.products().filter((p2) => matches(q, p2.name)).slice(0, 8) : [];
      $('[data-found]', m.panel).innerHTML = list.length ? `<div class="mobile-list">${list.map((x) => `<button type="button" class="m-row link-like" data-pick="${esc(x.id)}" style="width:100%"><span class="m-main"><span class="m-title">${esc(x.name)}</span></span></button>`).join('')}</div>` : '';
      return;
    }
    if (e.target.name === 'freight') drawLines();
  });
  m.panel.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-search]')) { e.preventDefault(); e.stopPropagation(); }
  });
  m.panel.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-pick]');
    if (pick) { showGrid(pick.dataset.pick); return; }
    if (e.target.closest('[data-new-supplier]')) {
      openSupplierForm(null, (s) => {
        form.supplier_id.innerHTML = options(Data.suppliers().filter((x) => x.active), s.id, { empty: 'Escolha' });
      });
      return;
    }
    if (e.target.closest('[data-grid-add]')) {
      const unit = parseMoney($('[data-unit]', m.panel).value);
      let added = 0;
      $$('[data-gridqty]', m.panel).forEach((el) => {
        const q = Number(el.value) || 0;
        if (q > 0) { lines.set(el.dataset.gridqty, { qty: q, cost: unit }); added += q; }
        else lines.delete(el.dataset.gridqty);
      });
      $('[data-grid-host]', m.panel).innerHTML = '';
      toast(`${added} peças no pedido`, { duration: 1500 });
      drawLines();
      return;
    }
    const rm = e.target.closest('[data-rm]');
    if (rm) { lines.delete(rm.dataset.rm); drawLines(); return; }
    const save = e.target.closest('[data-save]');
    if (!save) return;
    withLoading(save, async () => {
      const v = readForm(form);
      if (!lines.size) { toast('Coloque ao menos uma peça', { kind: 'warn' }); return; }
      try {
        const r = await Data.savePurchase({
          id: p?.id, supplier_id: v.supplier_id, kind: v.kind, status: save.dataset.save, ordered_on: todayISO(), expected_on: v.expected_on,
          freight: parseMoney(v.freight), notes: v.notes,
          items: [...lines.entries()].map(([variant_id, x]) => ({ variant_id, qty_ordered: x.qty, unit_cost: x.cost })),
        });
        m.close();
        toast(`Pedido ${code(r.number)} salvo`);
        done?.();
      } catch (err) { toastError('Não consegui salvar', friendlyError(err)); }
    });
  });
  // os botões de salvar ficam no rodapé, fora do painel de corpo: mesmo ouvinte
  drawLines();
}
