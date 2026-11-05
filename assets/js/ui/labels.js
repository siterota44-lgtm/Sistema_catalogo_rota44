/**
 * Etiquetas: nome curto, cor, tamanho, preço, SKU e código de barras (Code 128).
 * Rolo térmico (Zebra, Elgin, Argox): uma etiqueta por página, do tamanho exato do
 * papel. Folha A4: várias por página. Em promoção, mostra o "de / por".
 */

import * as Data from '../core/data.js';
import { esc, money } from '../core/utils.js';
import { code128SVG } from '../core/barcode.js';
import { icon } from './icons.js';
import { toast, openModal } from './kit.js';
import { $, $$, head, categoryOptions, matches, printHTML, dot, emptyBox } from './common.js';

const FORMAT_KEY = 'rota44.labelFormat';
const FORMATS = {
  '50x30': { name: 'Rolo 50×30 mm', roll: true, page: 'size: 50mm 30mm; margin: 0', tip: 'Na impressora: papel 50×30 mm, margens "Nenhuma" e escala 100%.' },
  '40x25': { name: 'Rolo 40×25 mm', roll: true, page: 'size: 40mm 25mm; margin: 0', tip: 'Na impressora: papel 40×25 mm, margens "Nenhuma" e escala 100%.' },
  '60x40': { name: 'Rolo 60×40 mm', roll: true, page: 'size: 60mm 40mm; margin: 0', tip: 'Na impressora: papel 60×40 mm, margens "Nenhuma" e escala 100%.' },
  a4: { name: 'Folha A4 (etiquetas de 50×30 mm)', roll: false, page: 'size: A4; margin: 6mm', tip: 'Na impressora: papel A4 e escala 100%.' },
};
function savedFormat() {
  try { const f = localStorage.getItem(FORMAT_KEY); if (FORMATS[f]) return f; } catch { /* modo privado */ }
  return '50x30';
}

function labelHTML(v) {
  const p = Data.product(v.product_id);
  const pr = Data.priceFor(v);
  return `
    <div class="label-tag">
      <div class="lt-name">${esc(p?.name)}</div>
      <div class="lt-row"><span>${esc(Data.color(v.color_id)?.name)} · <b>${esc(Data.size(v.size_id)?.label)}</b></span>
        <span>${pr.onSale ? `<span class="lt-old">${esc(money(pr.list))}</span>` : ''}<span class="lt-price">${esc(money(pr.price))}</span></span></div>
      ${code128SVG(v.barcode)}
      <div class="lt-code">${esc(v.barcode)}<span class="lt-sku"> · ${esc(v.sku)}</span></div>
    </div>`;
}

function sheetHTML(picked, format) {
  const tags = [];
  for (const { variant_id, qty } of picked) {
    const v = Data.variant(variant_id);
    if (!v) continue;
    for (let i = 0; i < qty; i++) tags.push(labelHTML(v));
  }
  return `<div class="label-sheet fmt-${format} ${FORMATS[format].roll ? 'is-roll' : ''}">${tags.join('')}</div>`;
}

export function openLabels(picked) {
  const list = picked.filter((x) => x.qty > 0);
  if (!list.length) { toast('Nada para imprimir', { kind: 'warn' }); return; }
  const total = list.reduce((a, x) => a + x.qty, 0);
  let format = savedFormat();
  const preview = () => sheetHTML(list.map((x) => ({ ...x, qty: Math.min(x.qty, 2) })).slice(0, 12), format);
  const m = openModal({
    title: `${total} etiqueta${total === 1 ? '' : 's'}`,
    subtitle: 'Prévia das etiquetas',
    size: 'lg',
    body: `
      <div class="field" style="max-width:320px;margin-bottom:6px">
        <label class="label" for="label-format">Papel</label>
        <select class="select" id="label-format" data-format>${Object.entries(FORMATS).map(([k, f]) => `<option value="${k}"${k === format ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}</select>
      </div>
      <p class="xs dim" data-tip style="margin-bottom:12px">${esc(FORMATS[format].tip)}</p>
      <div data-preview>${preview()}</div>`,
    footer: `<button class="btn" data-close>Fechar</button><button class="btn btn-primary" data-print>${icon('print')} Imprimir</button>`,
  });
  m.panel.querySelector('[data-format]').addEventListener('change', (e) => {
    format = e.target.value;
    try { localStorage.setItem(FORMAT_KEY, format); } catch { /* modo privado */ }
    m.panel.querySelector('[data-preview]').innerHTML = preview();
    m.panel.querySelector('[data-tip]').textContent = FORMATS[format].tip;
  });
  m.foot.querySelector('[data-print]').addEventListener('click', () => printHTML(sheetHTML(list, format), 'printing-labels', FORMATS[format].page));
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
