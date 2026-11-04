/**
 * Etiquetas: nome curto, cor, tamanho, preço, SKU e código de barras (Code 128).
 * Folha padrão 50×30 mm; a impressora térmica (Zebra, Elgin, Argox) imprime pelo
 * navegador. Em promoção, mostra o "de / por".
 */

import * as Data from '../core/data.js';
import { esc, money } from '../core/utils.js';
import { code128SVG } from '../core/barcode.js';
import { icon } from './icons.js';
import { toast, openModal } from './kit.js';
import { $, $$, head, categoryOptions, matches, printHTML, dot, emptyBox } from './common.js';

function labelHTML(v) {
  const p = Data.product(v.product_id);
  const pr = Data.priceFor(v);
  return `
    <div class="label-tag">
      <div class="lt-name">${esc(p?.name)}</div>
      <div class="lt-row"><span>${esc(Data.color(v.color_id)?.name)} · <b>${esc(Data.size(v.size_id)?.label)}</b></span>
        <span>${pr.onSale ? `<span class="lt-old">${esc(money(pr.list))}</span>` : ''}<span class="lt-price">${esc(money(pr.price))}</span></span></div>
      ${code128SVG(v.barcode)}
      <div class="lt-code">${esc(v.barcode)} · ${esc(v.sku)}</div>
    </div>`;
}

function sheetHTML(picked) {
  const tags = [];
  for (const { variant_id, qty } of picked) {
    const v = Data.variant(variant_id);
    if (!v) continue;
    for (let i = 0; i < qty; i++) tags.push(labelHTML(v));
  }
  return `<div class="label-sheet">${tags.join('')}</div>`;
}

export function openLabels(picked) {
  const list = picked.filter((x) => x.qty > 0);
  if (!list.length) { toast('Nada para imprimir', { kind: 'warn' }); return; }
  const total = list.reduce((a, x) => a + x.qty, 0);
  const preview = sheetHTML(list.map((x) => ({ ...x, qty: Math.min(x.qty, 2) })).slice(0, 12));
  const m = openModal({
    title: `${total} etiqueta${total === 1 ? '' : 's'}`,
    subtitle: 'Prévia. Na impressora, escolha o papel de 50×30 mm.',
    size: 'lg',
    body: preview,
    footer: `<button class="btn" data-close>Fechar</button><button class="btn btn-primary" data-print>${icon('print')} Imprimir</button>`,
  });
  m.foot.querySelector('[data-print]').addEventListener('click', () => printHTML(sheetHTML(list), 'printing-labels'));
}

export function mount(host) {
  let q = '';
  let cat = '';
  const qty = new Map();

  host.innerHTML = `
    <div class="view">
      ${head('Etiquetas', 'Escolha as peças e quantas de cada', `<button class="btn btn-primary" data-print>${icon('print')} Gerar etiquetas</button>`)}
      <div class="toolbar">
        <input class="input grow-input" data-q placeholder="Buscar produto ou SKU" autocomplete="off">
        <select class="select" data-cat aria-label="Categoria">${categoryOptions('', { empty: 'Todas as categorias' })}</select>
        <button class="btn" data-fill>Quantidade = estoque</button>
        <button class="btn btn-ghost" data-clear>Limpar</button>
      </div>
      <div data-list></div>
    </div>`;

  function variantsShown() {
    const tree = cat ? Data.categoryTree(cat) : null;
    return Data.variants().filter((v) => {
      if (!v.active) return false;
      const p = Data.product(v.product_id);
      if (!p) return false;
      if (tree && !tree.has(p.category_id)) return false;
      return matches(q, p.name, v.sku, v.barcode, Data.variantLabel(v));
    });
  }

  function render() {
    const rows = variantsShown().slice(0, 150);
    $('[data-list]', host).innerHTML = rows.length ? `
      <div class="table-wrap"><table class="data stack">
        <thead><tr><th>Peça</th><th>Estoque</th><th class="right">Etiquetas</th></tr></thead>
        <tbody>${rows.map((v) => `
          <tr>
            <td class="main-cell" data-label="Peça"><div><span class="cell-primary">${esc(Data.product(v.product_id).name)}</span>
              <span class="cell-sub with-dot">${dot(Data.color(v.color_id)?.hex)} ${esc(Data.variantLabel(v))} · <span class="sku">${esc(v.sku)}</span></span></div></td>
            <td data-label="Estoque"><span class="num">${v.on_hand}</span></td>
            <td class="right" data-label="Etiquetas"><input class="input" style="width:82px;text-align:center;margin-left:auto" type="number" inputmode="numeric" min="0" data-qty="${esc(v.id)}" value="${qty.get(v.id) || ''}" placeholder="0" aria-label="Quantidade de etiquetas"></td>
          </tr>`).join('')}</tbody>
      </table></div>` : `<div class="card">${emptyBox('Nada encontrado')}</div>`;
  }

  host.addEventListener('input', (e) => {
    if (e.target.matches('[data-q]')) { q = e.target.value; render(); return; }
    if (e.target.matches('[data-qty]')) qty.set(e.target.dataset.qty, Number(e.target.value) || 0);
  });
  host.addEventListener('change', (e) => {
    if (e.target.matches('[data-cat]')) { cat = e.target.value; render(); }
  });
  host.addEventListener('click', (e) => {
    if (e.target.closest('[data-fill]')) {
      variantsShown().forEach((v) => qty.set(v.id, Math.max(v.on_hand, 0)));
      render();
      return;
    }
    if (e.target.closest('[data-clear]')) { qty.clear(); render(); return; }
    if (e.target.closest('[data-print]')) {
      openLabels([...qty.entries()].map(([variant_id, n]) => ({ variant_id, qty: n })));
    }
  });
  render();
  return { onData: render };
}
