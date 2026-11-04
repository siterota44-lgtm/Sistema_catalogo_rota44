/**
 * Produtos. O produto é o modelo; a variação é cor × tamanho. Escolhendo a grade
 * e as cores, o sistema monta todas as combinações, e dá para tirar as que não
 * existem. SKU e código de barras saem sozinhos; custo e margem só aparecem para
 * quem tem permissão (e o banco confere de novo).
 */

import * as Data from '../core/data.js';
import { esc, money, parseMoney, formatDateTime, todayISO, moneyInputValue } from '../core/utils.js';
import { GENDERS, FITS, PRINT_TYPES, PRODUCT_STATUS } from '../core/constants.js';
import { marginPct, suggestedPrice, round2 } from '../core/calc.js';
import { friendlyError } from '../core/errors.js';
import { icon } from './icons.js';
import { toast, toastError, openModal, withLoading, confirmDialog, openMenu } from './kit.js';
import {
  $, $$, moneyHTML, badge, table, head, field, options, optionsMap, categoryOptions, moneyInput, paged, photo, dot,
  readForm, checkbox, switchField, mountGallery, exportCSV,
} from './common.js';
import { openVariantStock, stockGridHTML } from './stock.js';
import { openLabels } from './labels.js';

export function mount(host) {
  let q = '';
  let cat = '';
  let brand = '';
  let drop = '';
  let status = 'ativo';
  let limit = 50;
  const canEdit = Data.hasRole('admin', 'gerente');

  host.innerHTML = `
    <div class="view">
      ${head('Produtos', '', canEdit ? `
        <button class="btn" data-adjust>${icon('trend')} Reajustar preços</button>
        <button class="btn" data-export>${icon('download')} CSV</button>
        <button class="btn btn-primary" data-new>${icon('plus')} Novo produto</button>` : '')}
      <div class="toolbar">
        <select class="select" data-f="cat" aria-label="Categoria">${categoryOptions('', { empty: 'Todas as categorias' })}</select>
        <select class="select" data-f="brand" aria-label="Marca">${options(Data.brands(), '', { empty: 'Todas as marcas' })}</select>
        <select class="select" data-f="drop" aria-label="Drop">${options(Data.collections(), '', { empty: 'Todos os drops' })}</select>
        <select class="select" data-f="status" aria-label="Situação">${optionsMap(PRODUCT_STATUS, 'ativo', { empty: 'Todas as situações' })}</select>
      </div>
      <div data-list></div>
    </div>`;

  function filtered() {
    const tree = cat ? Data.categoryTree(cat) : null;
    return Data.searchProducts(q).filter((p) => {
      if (tree && !tree.has(p.category_id)) return false;
      if (brand && p.brand_id !== brand) return false;
      if (drop && p.collection_id !== drop) return false;
      if (status && p.status !== status) return false;
      return true;
    });
  }

  function render() {
    const { shown, more } = paged(filtered(), limit);
    $('[data-list]', host).innerHTML = table([
      { label: 'Produto', main: true, cell: (p) => `
        <div class="row gap-3" style="min-width:0">
          <span class="thumb thumb-sm" style="overflow:hidden;position:relative;background:#fff;flex:none">${photo(Data.coverOf(p), p.name)}</span>
          <div style="min-width:0"><span class="cell-primary">${esc(p.name)}</span>
            <span class="cell-sub">${esc(Data.categoryPath(p.category_id) || 'Sem categoria')}${p.collection_id ? ` · ${esc(Data.collection(p.collection_id)?.name)}` : ''}</span></div>
        </div>` },
      { label: 'Situação', cell: (p) => `${badge(PRODUCT_STATUS[p.status]?.label, PRODUCT_STATUS[p.status]?.tone)}${p.catalog_visible ? '' : ' <span class="xs dim">fora do catálogo</span>'}` },
      { label: 'Preço', right: true, cell: (p) => moneyHTML(Data.priceRange(p.id).min) },
      { label: 'Disponível', right: true, cell: (p) => { const n = Data.productStock(p.id); return `<span class="num ${n <= 0 ? 'tone-danger' : ''}">${n}</span>`; } },
      ...(canEdit ? [{ label: '', cell: (p) => `<div class="row-actions"><button class="icon-btn sm" data-menu="${esc(p.id)}" aria-label="Mais ações">${icon('more')}</button></div>` }] : []),
    ], shown, { rowAttr: (p) => `data-open="${esc(p.id)}"`, empty: 'Nenhum produto. Cadastre o primeiro em Novo produto.' }) + more;
  }

  host.addEventListener('change', (e) => {
    const f = e.target.dataset?.f;
    if (!f) return;
    if (f === 'cat') cat = e.target.value;
    if (f === 'brand') brand = e.target.value;
    if (f === 'drop') drop = e.target.value;
    if (f === 'status') status = e.target.value;
    limit = 50;
    render();
  });

  host.addEventListener('click', (e) => {
    if (e.target.closest('[data-new]')) { openProductForm(null); return; }
    if (e.target.closest('[data-more]')) { limit += 50; render(); return; }
    if (e.target.closest('[data-adjust]')) { openPriceAdjust(filtered()); return; }
    if (e.target.closest('[data-export]')) {
      exportCSV(`produtos-rota44-${todayISO()}.csv`, Data.variants().map((v) => {
        const p = Data.product(v.product_id);
        if (!p) return null;
        return {
          produto: p.name, cor: Data.color(v.color_id)?.name, tamanho: Data.size(v.size_id)?.label, sku: v.sku, codigo_barras: v.barcode,
          preco: Data.priceFor(v).price, fisico: v.on_hand, reservado: v.reserved, disponivel: v.available, categoria: Data.categoryPath(p.category_id),
          ...(Data.canCost() ? { custo_medio: Number(Data.cost(v.id)?.avg_cost || 0) } : {}),
        };
      }).filter(Boolean));
      return;
    }
    const mb = e.target.closest('[data-menu]');
    if (mb) {
      e.stopPropagation();
      const p = Data.product(mb.dataset.menu);
      openMenu(mb, [
        { label: 'Editar', icon: 'edit', onSelect: () => openProductForm(p) },
        { label: 'Duplicar', icon: 'copy', onSelect: () => openProductForm({ ...p, id: null, name: `${p.name} (cópia)`, slug: '' }, { from: p.id }) },
        { label: 'Etiquetas', icon: 'print', onSelect: () => openLabels(Data.variantsOf(p.id).filter((v) => v.active).map((v) => ({ variant_id: v.id, qty: Math.max(v.on_hand, 1) }))) },
        { label: p.catalog_visible ? 'Tirar do catálogo' : 'Mostrar no catálogo', icon: p.catalog_visible ? 'eyeOff' : 'eye', onSelect: () => Data.patchProduct(p.id, { catalog_visible: !p.catalog_visible }).catch((err) => toastError('Não deu', friendlyError(err))) },
        {
          label: 'Excluir', icon: 'trash', danger: true, separatorBefore: true,
          onSelect: async () => {
            const yes = await confirmDialog({
              title: `Excluir "${p.name}"?`,
              message: 'Sai das listas e do catálogo. As vendas antigas continuam nos relatórios.',
              confirmText: 'Excluir', danger: true,
            });
            if (yes) Data.deleteProduct(p.id).then(() => toast('Produto excluído')).catch((err) => toastError('Não consegui excluir', friendlyError(err)));
          },
        },
      ]);
      return;
    }
    const row = e.target.closest('[data-open]');
    if (row) openProductView(row.dataset.open);
  });

  render();
  return { onSearch(v) { q = v; limit = 50; render(); }, onData: render };
}

/* ------------------------------------------------------- ficha do produto */

export function openProductView(id) {
  const m = openModal({ title: 'Produto', size: 'xl', body: '<div data-b></div>', footer: '<div data-a class="row gap-2" style="flex-wrap:wrap;justify-content:flex-end;width:100%"></div>' });
  const canEdit = Data.hasRole('admin', 'gerente');
  const draw = async () => {
    const p = Data.product(id);
    if (!p) { m.close(); return; }
    const vs = Data.variantsOf(id);
    const first = vs.find((v) => v.active) || vs[0];
    const pr = first ? Data.priceFor(first) : { list: Number(p.base_price), price: Number(p.base_price) };
    const c = first && Data.canCost() ? Number(Data.cost(first.id)?.avg_cost || 0) : null;
    m.panel.querySelector('.modal-head h2').textContent = p.name;
    $('[data-b]', m.panel).innerHTML = `
      <div class="col gap-5">
        <div class="row gap-4" style="align-items:flex-start;flex-wrap:wrap">
          <div class="gallery-photo" style="width:150px;flex:none">${Data.coverOf(p) ? `<img src="${esc(Data.coverOf(p))}" alt="${esc(p.name)}">` : ''}</div>
          <div class="grow col gap-3" style="min-width:220px">
            <dl class="kv">
              <div><dt>Preço</dt><dd>${pr.price < pr.list ? `<s class="dim">${esc(money(pr.list))}</s> ` : ''}${moneyHTML(pr.price, 'strong')}</dd></div>
              ${c !== null ? `<div><dt>Custo médio</dt><dd>${moneyHTML(c)}</dd></div>` : ''}
              ${Data.canMargin() && c !== null ? `<div><dt>Margem</dt><dd><span class="num strong money-sensitive">${marginPct(pr.price, c)}%</span> <span class="small dim money-sensitive">(${esc(money(pr.price - c))})</span></dd></div>` : ''}
              <div><dt>Categoria</dt><dd>${esc(Data.categoryPath(p.category_id) || '-')}</dd></div>
              <div><dt>Marca</dt><dd>${esc(Data.brand(p.brand_id)?.name || '-')}</dd></div>
              <div><dt>Drop</dt><dd>${esc(Data.collection(p.collection_id)?.name || '-')}</dd></div>
              <div><dt>Modelagem</dt><dd>${esc(p.fit || '-')}</dd></div>
              <div><dt>Tecido</dt><dd>${esc(p.fabric || '-')}${p.gsm ? ` · ${p.gsm} g/m²` : ''}</dd></div>
              <div><dt>Estampa</dt><dd>${esc(p.print_type || '-')}</dd></div>
              <div><dt>Situação</dt><dd>${badge(PRODUCT_STATUS[p.status]?.label, PRODUCT_STATUS[p.status]?.tone)}</dd></div>
            </dl>
          </div>
        </div>
        <div>
          <div class="fieldset-title" style="margin-bottom:6px">Curva de grade: disponível por cor × tamanho</div>
          ${stockGridHTML(id)}
          <p class="xs dim" style="margin-top:6px">Toque num número para ver o histórico${Data.canCost() ? ' e ajustar' : ''}.</p>
        </div>
        <div data-history></div>
      </div>`;
    $('[data-a]', m.foot).innerHTML = canEdit ? `<button class="btn btn-primary" data-edit>${icon('edit')} Editar</button>` : '';
    if (canEdit) {
      try {
        const hist = await Data.priceHistory(id, 10);
        if (hist.length && m.el.isConnected) {
          $('[data-history]', m.panel).innerHTML = `
            <details class="fieldset"><summary>Histórico de preço (${hist.length})</summary>
              <div class="mobile-list">${hist.map((h) => `<div class="m-row"><span class="m-main"><span class="m-title">${esc({ base_price: 'Preço', promo_price: 'Promocional', price: 'Preço da variação' }[h.field] || h.field)}</span><span class="m-sub">${esc(formatDateTime(h.changed_at))} · ${esc(Data.memberName(h.changed_by))}</span></span>
                <span class="m-side num money-sensitive">${h.old_value == null ? '-' : esc(money(h.old_value))} → ${h.new_value == null ? '-' : esc(money(h.new_value))}</span></div>`).join('')}</div>
            </details>`;
        }
      } catch { /* histórico é extra: não atrapalha a ficha */ }
    }
  };
  m.panel.addEventListener('click', (e) => {
    const cell = e.target.closest('[data-variant]');
    if (cell) { openVariantStock(cell.dataset.variant, draw); return; }
    if (e.target.closest('[data-edit]')) openProductForm(Data.product(id), { onSaved: draw });
  });
  draw();
  return m;
}

/* ---------------------------------------------------- formulário ------- */

export function openProductForm(prod, { from = null, onSaved } = {}) {
  const editing = !!prod?.id;
  const sourceId = from || prod?.id || null;
  const baseVariants = sourceId ? Data.variantsOf(sourceId) : [];
  const canCost = Data.canCost();
  const s = Data.settings();

  // estado da grade: "cor|tamanho" → variação
  const combos = new Map();
  for (const v of baseVariants) {
    if (!v.active && !editing) continue;
    combos.set(`${v.color_id}|${v.size_id}`, {
      id: editing ? v.id : null, on: v.active, initial: 0, on_hand: editing ? v.on_hand : 0,
      sku: editing ? v.sku : '', barcode: editing ? v.barcode : '',
      price: v.price, stock_min: v.stock_min,
    });
  }
  let selectedColors = [...new Set(baseVariants.filter((v) => v.active || editing).map((v) => v.color_id))];
  let gridId = prod?.grid_id || (baseVariants[0] ? Data.size(baseVariants[0].size_id)?.grid_id : '') || '';
  // combinação que foi desmarcada ao cadastrar continua desmarcada ao editar
  for (const c of selectedColors) for (const z of Data.sizesOf(gridId)) {
    const k = `${c}|${z.id}`;
    if (!combos.has(k)) combos.set(k, { id: null, on: false, initial: 0, on_hand: 0, sku: '', barcode: '', price: null, stock_min: 1 });
  }
  const images = sourceId ? Data.productImages(sourceId).map((i) => ({ url: i.url, color_id: i.color_id })) : [];

  const m = openModal({
    title: editing ? 'Editar produto' : 'Novo produto',
    size: 'xl',
    beforeClose: async () => {
      if (!dirty) return true;
      return confirmDialog({ title: 'Sair sem salvar?', message: 'O que você preencheu será perdido.', confirmText: 'Sair sem salvar', cancelText: 'Continuar editando', danger: true });
    },
    body: `
      <form class="col gap-5" data-f novalidate>
        <div class="fieldset">
          <div class="fieldset-title">O básico</div>
          <div class="form-grid">
            ${field('Nome', `<input class="input" name="name" value="${esc(prod?.name)}" required data-autofocus placeholder="Moletom Canguru Heavy">`, 12)}
            ${field('Categoria', `<select class="select" name="category_id">${categoryOptions(prod?.category_id)}</select>`, 6)}
            ${field('Marca', `<select class="select" name="brand_id">${options(Data.brands().filter((b) => b.active), prod?.brand_id ?? Data.brands().find((b) => b.is_own)?.id, { empty: 'Sem marca' })}</select>`, 6)}
            ${field('Drop / coleção', `<select class="select" name="collection_id">${options(Data.collections().filter((c) => c.active), prod?.collection_id, { empty: 'Nenhum' })}</select>`, 6)}
            ${field('Gênero', `<select class="select" name="gender">${optionsMap(GENDERS, prod?.gender || 'unissex')}</select>`, 6)}
          </div>
        </div>

        <div class="fieldset">
          <div class="fieldset-title">Grade: cor × tamanho</div>
          <div class="form-grid">
            ${field('Grade de tamanhos', `<select class="select" name="grid_id">${options(Data.grids().filter((g) => g.active), gridId, { empty: 'Escolha a grade' })}</select>`, 6)}
          </div>
          <div class="field"><label class="label">Cores</label>
            <div class="chips" data-colors></div>
          </div>
          <div data-matrix></div>
        </div>

        <div class="fieldset">
          <div class="fieldset-title">Preço</div>
          <div class="form-grid">
            ${field('Preço de venda', moneyInput('base_price', prod?.base_price ?? ''), canCost ? 4 : 6)}
            ${canCost ? field('Custo (para as peças novas)', moneyInput('cost', sourceId && baseVariants[0] ? Data.cost(baseVariants[0].id)?.avg_cost : ''), 4) : ''}
            ${canCost ? `<div class="field span-4"><label class="label">Margem</label><div class="input" style="background:var(--surface-2)" data-margin>-</div></div>` : ''}
            ${field('Preço promocional', moneyInput('promo_price', prod?.promo_price ?? ''), 4)}
            ${field('Promoção começa', `<input class="input" type="date" name="promo_from" value="${esc(prod?.promo_from?.slice(0, 10))}">`, 4)}
            ${field('Promoção termina', `<input class="input" type="date" name="promo_to" value="${esc(prod?.promo_to?.slice(0, 10))}">`, 4)}
          </div>
          ${canCost ? '<button type="button" class="link-btn" data-suggest style="align-self:flex-start"></button>' : ''}
        </div>

        <div class="fieldset">
          <div class="fieldset-title">Fotos</div>
          <div data-gallery></div>
        </div>

        <div class="fieldset">
          <div class="fieldset-title">Ficha da peça</div>
          <div class="form-grid">
            ${field('Modelagem', `<input class="input" name="fit" list="fits" value="${esc(prod?.fit)}"><datalist id="fits">${FITS.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>`, 4)}
            ${field('Tecido / composição', `<input class="input" name="fabric" value="${esc(prod?.fabric)}" placeholder="100% algodão">`, 4)}
            ${field('Gramatura (g/m²)', `<input class="input" name="gsm" type="number" inputmode="numeric" value="${esc(prod?.gsm)}">`, 4)}
            ${field('Estampa / acabamento', `<input class="input" name="print_type" list="prints" value="${esc(prod?.print_type)}"><datalist id="prints">${PRINT_TYPES.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>`, 4)}
            ${field('Tabela de medidas', `<select class="select" name="size_chart_id">${options(Data.sizeCharts(), prod?.size_chart_id, { empty: 'Da categoria' })}</select>`, 4)}
            ${field('Tags', `<input class="input" name="tags" value="${esc((prod?.tags || []).join(', '))}" placeholder="lançamento, collab">`, 4)}
            ${field('Descrição curta', `<input class="input" name="short_desc" maxlength="300" value="${esc(prod?.short_desc)}">`, 12)}
            ${field('Descrição completa', `<textarea class="textarea" name="description" rows="3">${esc(prod?.description)}</textarea>`, 12)}
            ${field('Como lavar', `<input class="input" name="wash_care" value="${esc(prod?.wash_care)}">`, 12)}
          </div>
        </div>

        <div class="fieldset">
          <div class="fieldset-title">Catálogo</div>
          <div class="form-grid">
            ${field('Situação', `<select class="select" name="status">${optionsMap(PRODUCT_STATUS, prod?.status || 'ativo')}</select>`, 6)}
            <div class="span-6 col gap-2" style="justify-content:flex-end">
              ${switchField('catalog_visible', 'Mostrar no catálogo', prod ? prod.catalog_visible : true)}
              ${switchField('featured', 'Destaque na página inicial', prod?.featured)}
            </div>
          </div>
        </div>

        <details class="fieldset">
          <summary>Fiscal, frete e SEO</summary>
          <div class="form-grid" style="margin-top:12px">
            ${field('NCM', `<input class="input" name="ncm" maxlength="12" value="${esc(prod?.ncm)}">`, 4)}
            ${field('Origem', `<input class="input" name="origin" maxlength="2" value="${esc(prod?.origin ?? '0')}">`, 4)}
            ${field('CEST', `<input class="input" name="cest" maxlength="12" value="${esc(prod?.cest)}">`, 4)}
            ${field('Peso (g)', `<input class="input" name="weight_g" type="number" inputmode="numeric" value="${esc(prod?.weight_g)}">`, 4)}
            ${field('Embalagem', `<input class="input" name="dimensions" maxlength="40" value="${esc(prod?.dimensions)}" placeholder="30×25×5 cm">`, 8)}
            ${field('Título para o Google', `<input class="input" name="seo_title" maxlength="120" value="${esc(prod?.seo_title)}">`, 12)}
            ${field('Descrição para o Google', `<input class="input" name="seo_desc" maxlength="300" value="${esc(prod?.seo_desc)}">`, 12)}
          </div>
        </details>

        <details class="fieldset" data-var-details>
          <summary>Ajustes por variação (SKU, código, preço próprio, mínimo)</summary>
          <div data-var-rows style="margin-top:10px"></div>
        </details>
      </form>`,
    footer: `<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${editing ? 'Salvar' : 'Criar produto'}</button>`,
  });

  let dirty = false;
  const form = $('[data-f]', m.panel);
  form.addEventListener('input', () => { dirty = true; });

  const gallery = mountGallery($('[data-gallery]', m.panel), {
    images,
    colors: () => selectedColors.map((id) => Data.color(id)).filter(Boolean),
    onChange: () => { dirty = true; },
  });

  function drawColors() {
    $('[data-colors]', m.panel).innerHTML = Data.colors().filter((c) => c.active).map((c) => `
      <button type="button" class="chip sm" data-color="${esc(c.id)}" aria-pressed="${selectedColors.includes(c.id)}">${dot(c.hex)} ${esc(c.name)}</button>`).join('');
  }

  function drawMatrix() {
    const box = $('[data-matrix]', m.panel);
    const sizes = gridId ? Data.sizesOf(gridId) : [];
    if (!gridId || !selectedColors.length || !sizes.length) {
      box.innerHTML = `<p class="small dim">Escolha a grade e ao menos uma cor: as combinações aparecem aqui.</p>`;
      $('[data-var-rows]', m.panel).innerHTML = '<p class="small dim">Aparece depois de escolher grade e cor.</p>';
      return;
    }
    // novas combinações nascem ligadas
    for (const c of selectedColors) for (const z of sizes) {
      const k = `${c}|${z.id}`;
      if (!combos.has(k)) combos.set(k, { id: null, on: true, initial: 0, on_hand: 0, sku: '', barcode: '', price: null, stock_min: 1 });
    }
    box.innerHTML = `
      <div class="grid-matrix"><table>
        <thead><tr><th>${canCost ? 'Estoque inicial' : 'Variações'}</th>${sizes.map((z) => `<th>${esc(z.label)}</th>`).join('')}</tr></thead>
        <tbody>
          ${selectedColors.map((cid) => `<tr>
            <th><span class="with-dot">${dot(Data.color(cid)?.hex)} ${esc(Data.color(cid)?.name)}</span></th>
            ${sizes.map((z) => {
              const k = `${cid}|${z.id}`;
              const x = combos.get(k);
              return `<td data-combo="${esc(k)}">
                <div class="col gap-1" style="align-items:center">
                  <input type="checkbox" class="grid-toggle" data-on ${x.on ? 'checked' : ''} aria-label="${esc(Data.color(cid)?.name)} ${esc(z.label)} existe">
                  ${x.id ? `<span class="xs dim num" title="Em estoque">${x.on_hand}</span>`
                    : canCost ? `<input class="input" type="number" inputmode="numeric" min="0" data-initial value="${x.initial || ''}" placeholder="0" ${x.on ? '' : 'disabled'} aria-label="Quantidade inicial">` : ''}
                </div>
              </td>`;
            }).join('')}
          </tr>`).join('')}
        </tbody>
      </table></div>
      <p class="xs dim" style="margin-top:6px">Desmarque a combinação que não existe. ${combosCount()} variações.${editing ? ' O saldo das peças que já existem muda pelo Estoque ou por Compras.' : ''}</p>`;
    drawVarRows();
  }
  const activeCombos = () => [...combos.entries()].filter(([k, x]) => {
    const [c, z] = k.split('|');
    return x.on && selectedColors.includes(c) && Data.size(z)?.grid_id === gridId;
  });
  const combosCount = () => activeCombos().length;

  function drawVarRows() {
    const rows = activeCombos();
    $('[data-var-rows]', m.panel).innerHTML = rows.length ? `
      <div class="grid-matrix"><table>
        <thead><tr><th>Variação</th><th>SKU</th><th>Código de barras</th><th>Preço próprio</th><th>Mínimo</th></tr></thead>
        <tbody>${rows.map(([k, x]) => {
          const [c, z] = k.split('|');
          return `<tr data-var="${esc(k)}">
            <th>${esc(Data.color(c)?.name)} · ${esc(Data.size(z)?.label)}</th>
            <td><input class="input" style="width:190px" data-sku value="${esc(x.sku)}" placeholder="automático"></td>
            <td><input class="input" style="width:150px" data-barcode value="${esc(x.barcode)}" placeholder="automático"></td>
            <td><div class="money-input" style="width:120px"><input class="input" data-price inputmode="numeric" value="${x.price ? esc(moneyInputValue(x.price)) : ''}" placeholder="igual"></div></td>
            <td><input class="input" data-min type="number" inputmode="numeric" min="0" value="${x.stock_min ?? 1}"></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>` : '<p class="small dim">Nenhuma variação marcada.</p>';
  }

  function updateMargin() {
    if (!canCost) return;
    const price = parseMoney(form.promo_price.value) || parseMoney(form.base_price.value);
    const c = parseMoney(form.cost.value);
    $('[data-margin]', m.panel).innerHTML = price && c ? `<b class="num">${marginPct(price, c)}%</b> <span class="small dim">lucro ${esc(money(price - c))}</span>` : '-';
    const sug = c ? suggestedPrice(c, s.default_markup_pct, Number(s.round_prices_to)) : 0;
    const link = $('[data-suggest]', m.panel);
    link.textContent = sug ? `Usar preço sugerido: ${money(sug)} (markup de ${s.default_markup_pct}%)` : '';
    link.dataset.value = sug;
    link.hidden = !sug;
  }

  m.panel.addEventListener('change', (e) => {
    if (e.target.name === 'grid_id') {
      gridId = e.target.value;
      dirty = true;
      drawMatrix();
      return;
    }
    if (e.target.name === 'category_id') {
      // grade padrão e tabela da categoria (subindo a árvore) para adiantar
      let c = Data.category(e.target.value);
      while (c && !c.default_grid_id && c.parent_id) c = Data.category(c.parent_id);
      if (c?.default_grid_id && !gridId) {
        gridId = c.default_grid_id;
        form.grid_id.value = gridId;
        drawMatrix();
      }
      return;
    }
    const combo = e.target.closest('[data-combo]');
    if (combo && e.target.matches('[data-on]')) {
      combos.get(combo.dataset.combo).on = e.target.checked;
      dirty = true;
      drawMatrix();
    }
  });
  m.panel.addEventListener('input', (e) => {
    if (e.target.name === 'base_price' || e.target.name === 'cost' || e.target.name === 'promo_price') updateMargin();
    const combo = e.target.closest('[data-combo]');
    if (combo && e.target.matches('[data-initial]')) combos.get(combo.dataset.combo).initial = Number(e.target.value) || 0;
    const v = e.target.closest('[data-var]');
    if (v) {
      const x = combos.get(v.dataset.var);
      if (e.target.matches('[data-sku]')) x.sku = e.target.value.trim();
      if (e.target.matches('[data-barcode]')) x.barcode = e.target.value.trim();
      if (e.target.matches('[data-price]')) x.price = parseMoney(e.target.value) || null;
      if (e.target.matches('[data-min]')) x.stock_min = Number(e.target.value) || 0;
    }
  });
  m.panel.addEventListener('click', (e) => {
    const cb = e.target.closest('[data-color]');
    if (cb) {
      const id = cb.dataset.color;
      selectedColors = selectedColors.includes(id) ? selectedColors.filter((x) => x !== id) : [...selectedColors, id];
      cb.setAttribute('aria-pressed', String(selectedColors.includes(id)));
      dirty = true;
      drawMatrix();
      gallery.refresh();
      return;
    }
    const sg = e.target.closest('[data-suggest]');
    if (sg) {
      form.base_price.value = moneyInputValue(Number(sg.dataset.value));
      dirty = true;
      updateMargin();
    }
  });

  const ok = m.foot.querySelector('[data-ok]');
  ok.addEventListener('click', () => withLoading(ok, async () => {
    const v = readForm(form);
    if (!v.name) { toast('Informe o nome do produto', { kind: 'warn' }); form.name.focus(); return; }
    if (gallery.busy) { toast('Espere as fotos terminarem de subir', { kind: 'warn' }); return; }
    const list = activeCombos();
    if (!list.length) { toast('Escolha a grade e ao menos uma cor', { kind: 'warn' }); return; }
    if (!parseMoney(v.base_price)) { toast('Informe o preço de venda', { kind: 'warn' }); form.base_price.focus(); return; }
    const costVal = canCost ? parseMoney(v.cost) : null;
    const payload = {
      id: editing ? prod.id : null,
      name: v.name, slug: editing ? prod.slug : '', short_desc: v.short_desc, description: v.description,
      category_id: v.category_id, brand_id: v.brand_id, collection_id: v.collection_id, grid_id: gridId, size_chart_id: v.size_chart_id,
      gender: v.gender, fit: v.fit, fabric: v.fabric, gsm: v.gsm, print_type: v.print_type, wash_care: v.wash_care,
      tags: v.tags.split(',').map((x) => x.trim()).filter(Boolean),
      status: v.status, catalog_visible: v.catalog_visible, featured: v.featured,
      base_price: parseMoney(v.base_price), promo_price: parseMoney(v.promo_price) || null,
      promo_from: v.promo_from ? `${v.promo_from}T00:00:00` : null,
      promo_to: v.promo_to ? `${v.promo_to}T23:59:59` : null,
      ncm: v.ncm, origin: v.origin, cest: v.cest, weight_g: v.weight_g, dimensions: v.dimensions,
      seo_title: v.seo_title, seo_desc: v.seo_desc,
      images: gallery.value,
      variants: list.map(([k, x]) => {
        const [color_id, size_id] = k.split('|');
        return {
          id: x.id, color_id, size_id, sku: x.sku, barcode: x.barcode, price: x.price, stock_min: x.stock_min, active: true,
          initial_stock: x.id ? 0 : x.initial, cost: costVal || null,
        };
      }),
    };
    try {
      await Data.saveProduct(payload);
      dirty = false;
      m.close();
      toast(editing ? 'Produto salvo' : 'Produto criado', { text: `${list.length} variações` });
      onSaved?.();
    } catch (err) {
      toastError('Não consegui salvar', friendlyError(err));
    }
  }));

  drawColors();
  drawMatrix();
  updateMargin();
}

/* ---------------------------------------------------- reajuste em lote -- */

function openPriceAdjust(list) {
  const m = openModal({
    title: 'Reajustar preços',
    subtitle: `Vale para os ${list.length} produtos do filtro atual. Fica no histórico.`,
    body: `
      <div class="form-grid">
        ${field('Aumentar / baixar (%)', '<input class="input" name="pct" type="number" inputmode="decimal" step="0.5" placeholder="10 ou -5" data-autofocus>', 6)}
        ${field('Terminar em', `<select class="select" name="round"><option value="">Não arredondar</option><option value=".90" selected>,90</option><option value=".99">,99</option><option value=".00">,00</option></select>`, 6)}
      </div>
      <div data-preview class="small muted" style="margin-top:12px"></div>`,
    footer: '<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Aplicar</button>',
  });
  const compute = () => {
    const pct = Number($('[name=pct]', m.panel).value) || 0;
    const r = $('[name=round]', m.panel).value;
    return list.map((p) => {
      let next = Number(p.base_price) * (1 + pct / 100);
      if (r) next = Math.floor(next) + Number(r);
      return { product_id: p.id, name: p.name, old: Number(p.base_price), base_price: round2(next) };
    });
  };
  m.panel.addEventListener('input', () => {
    const items = compute().slice(0, 4);
    $('[data-preview]', m.panel).innerHTML = items.map((i) => `${esc(i.name)}: ${esc(money(i.old))} → <b>${esc(money(i.base_price))}</b>`).join('<br>');
  });
  const ok = m.foot.querySelector('[data-ok]');
  ok.addEventListener('click', () => withLoading(ok, async () => {
    if (!Number($('[name=pct]', m.panel).value)) { toast('Informe a porcentagem', { kind: 'warn' }); return; }
    try {
      const items = compute().map(({ product_id, base_price }) => ({ product_id, base_price }));
      await Data.setPrices(items);
      m.close();
      toast('Preços atualizados', { text: `${items.length} produtos` });
    } catch (err) { toastError('Não consegui reajustar', friendlyError(err)); }
  }));
}
