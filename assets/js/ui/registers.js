/**
 * Cadastros que dão forma ao catálogo: categorias (árvore), drops, marcas, cores,
 * grades e tabelas de medidas. Nada disso fica fixo no código.
 */

import * as Data from '../core/data.js';
import { esc, formatDateTime } from '../core/utils.js';
import { fold } from '../core/calc.js';
import { friendlyError } from '../core/errors.js';
import { icon } from './icons.js';
import { toast, toastError, openModal, withLoading, confirmDialog } from './kit.js';
import { $, $$, table, head, field, options, readForm, checkbox, switchField, badge, mountPhoto, dot, emptyBox, photo } from './common.js';

const slugify = (s) => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const TABS = { categorias: 'Categorias', drops: 'Drops', marcas: 'Marcas', cores: 'Cores', grades: 'Grades', medidas: 'Medidas' };

export function mount(host) {
  let tab = 'categorias';

  function render() {
    host.innerHTML = `
      <div class="view">
        ${head('Categorias e drops', '', `<button class="btn btn-primary" data-new>${icon('plus')} Novo</button>`)}
        <div class="tabs" role="tablist">
          ${Object.entries(TABS).map(([k, v]) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${esc(v)}</button>`).join('')}
        </div>
        <div data-body>${body()}</div>
      </div>`;
  }

  function body() {
    if (tab === 'categorias') {
      return table([
        { label: 'Categoria', main: true, cell: (c) => `<div class="cat-cell tree-indent-${Math.min(c.depth, 3)}"><span class="cat-thumb">${photo(c.image_url, c.name)}</span><span><span class="cell-primary">${esc(c.name)}</span><span class="cell-sub sku">SKU: ${esc(c.code)} · ${esc(c.slug)}</span></span></div>` },
        { label: 'Grade padrão', cell: (c) => esc(Data.grid(c.default_grid_id)?.name || '-') },
        { label: 'Produtos', right: true, cell: (c) => `<span class="num">${Data.products().filter((p) => p.category_id === c.id).length}</span>` },
        { label: 'Catálogo', cell: (c) => (c.visible ? badge('Visível', 'green') : badge('Oculta', 'gray')) },
      ], Data.categoryList(), { rowAttr: (c) => `data-edit="${esc(c.id)}"`, empty: 'Nenhuma categoria. Rode o seed_base.sql ou crie aqui.' });
    }
    if (tab === 'drops') {
      return table([
        { label: 'Drop', main: true, cell: (c) => `<div><span class="cell-primary">${esc(c.name)}</span><span class="cell-sub">${esc(c.collab ? `Collab: ${c.collab}` : c.slug)}</span></div>` },
        { label: 'Lançamento', cell: (c) => (c.launch_at ? esc(formatDateTime(c.launch_at)) : '-') },
        { label: 'Peças', right: true, cell: (c) => `<span class="num">${Data.products().filter((p) => p.collection_id === c.id).length}</span>` },
        { label: 'Limite', cell: (c) => (c.limit_per_customer ? `${c.limit_per_customer} por cliente` : '-') },
        { label: 'Catálogo', cell: (c) => (!c.visible ? badge('Oculto', 'gray') : c.launch_at && new Date(c.launch_at) > new Date() ? badge('Em breve', 'amber') : badge('No ar', 'green')) },
      ], Data.collections(), { rowAttr: (c) => `data-edit="${esc(c.id)}"`, empty: 'Nenhum drop. Crie o primeiro: data de lançamento, limite por cliente, lookbook.' });
    }
    if (tab === 'marcas') {
      return table([
        { label: 'Marca', main: true, cell: (b) => `<span class="cell-primary">${esc(b.name)}</span>` },
        { label: 'Tipo', cell: (b) => (b.is_own ? badge('Marca própria', 'blue') : badge('Terceiros', 'gray')) },
        { label: 'Produtos', right: true, cell: (b) => `<span class="num">${Data.products().filter((p) => p.brand_id === b.id).length}</span>` },
      ], Data.brands(), { rowAttr: (b) => `data-edit="${esc(b.id)}"` });
    }
    if (tab === 'cores') {
      return table([
        { label: 'Cor', main: true, cell: (c) => `<span class="with-dot">${dot(c.hex)} <span class="cell-primary">${esc(c.name)}</span></span>` },
        { label: 'Código no SKU', cell: (c) => `<span class="sku">${esc(c.code)}</span>` },
        { label: 'Situação', cell: (c) => (c.active ? badge('Ativa', 'green') : badge('Inativa', 'gray')) },
      ], Data.colors(), { rowAttr: (c) => `data-edit="${esc(c.id)}"` });
    }
    if (tab === 'grades') {
      return table([
        { label: 'Grade', main: true, cell: (g) => `<span class="cell-primary">${esc(g.name)}</span>` },
        { label: 'Tamanhos', cell: (g) => esc(Data.sizesOf(g.id).map((s) => s.label).join(', ')) },
      ], Data.grids(), { rowAttr: (g) => `data-edit="${esc(g.id)}"` });
    }
    return table([
      { label: 'Tabela', main: true, cell: (t) => `<span class="cell-primary">${esc(t.name)}</span>` },
      { label: 'Medidas', cell: (t) => esc((t.columns || []).join(', ')) },
      { label: 'Tamanhos', cell: (t) => esc((t.rows || []).map((r) => r.size).join(', ')) },
    ], Data.sizeCharts(), { rowAttr: (t) => `data-edit="${esc(t.id)}"`, empty: 'Nenhuma tabela de medidas.' });
  }

  const forms = { categorias: categoryForm, drops: dropForm, marcas: brandForm, cores: colorForm, grades: gridForm, medidas: chartForm };
  const finders = {
    categorias: Data.category, drops: Data.collection, marcas: Data.brand, cores: Data.color, grades: Data.grid,
    medidas: (id) => Data.sizeCharts().find((t) => t.id === id),
  };

  host.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; render(); return; }
    if (e.target.closest('[data-new]')) { forms[tab](null); return; }
    const row = e.target.closest('[data-edit]');
    if (row) forms[tab](finders[tab](row.dataset.edit));
  });

  render();
  return {
    onData() {
      const b = $('[data-body]', host);
      if (b) b.innerHTML = body();
    },
  };
}

/** Modal padrão de cadastro: salvar e, se já existe, excluir. */
function rowModal({ title, body, onSave, onDelete, size, deleteMessage, deleteFlow }) {
  const m = openModal({
    title, size,
    body: `<form class="form-grid" data-f novalidate>${body}</form>`,
    footer: `${onDelete ? '<button class="btn btn-ghost" data-del style="margin-right:auto">Excluir</button>' : ''}
      <button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Salvar</button>`,
  });
  const ok = m.foot.querySelector('[data-ok]');
  ok.addEventListener('click', () => withLoading(ok, async () => {
    try {
      if (m.busy?.()) { toast('Espere a foto terminar de enviar', { kind: 'warn' }); return; }
      const done = await onSave(readForm($('[data-f]', m.panel)), m);
      if (done !== false) { m.close(); toast('Salvo'); }
    } catch (err) {
      toastError('Não consegui salvar', friendlyError(err));
    }
  }));
  m.foot.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (deleteFlow) { deleteFlow(m); return; }
    if (!(await confirmDialog({ title: 'Excluir este cadastro?', message: deleteMessage || 'Se estiver em uso, o sistema recusa. Em vez de excluir, dá para desativar.', confirmText: 'Excluir', danger: true }))) return;
    try { await onDelete(); m.close(); toast('Excluído'); }
    catch (err) { toastError('Não deu para excluir', friendlyError(err)); }
  });
  return m;
}

function categoryForm(c) {
  let img;
  const excluded = c ? Data.categoryTree(c.id) : new Set();
  const parents = Data.categoryList().filter((x) => !excluded.has(x.id));
  const m = rowModal({
    title: c ? 'Editar categoria' : 'Nova categoria',
    size: 'lg',
    body: `
      ${field('Nome', `<input class="input" name="name" value="${esc(c?.name)}" required data-autofocus>`, 8)}
      ${field('Código no SKU', `<input class="input" name="code" value="${esc(c?.code || 'GER')}" maxlength="4" autocapitalize="characters">`, 4, 'Ex.: CAM, MOL, CAL')}
      ${field('Fica dentro de', `<select class="select" name="parent_id">${options(parents, c?.parent_id, { empty: 'Nenhuma (categoria principal)', label: (x) => `${'— '.repeat(x.depth)}${x.name}` })}</select>`, 6)}
      ${field('Ordem', `<input class="input" name="sort" type="number" inputmode="numeric" value="${esc(c?.sort ?? 0)}">`, 6)}
      ${field('Grade padrão', `<select class="select" name="default_grid_id">${options(Data.grids(), c?.default_grid_id, { empty: 'Nenhuma' })}</select>`, 6)}
      ${field('Tabela de medidas', `<select class="select" name="size_chart_id">${options(Data.sizeCharts(), c?.size_chart_id, { empty: 'Nenhuma' })}</select>`, 6)}
      ${field('Descrição', `<input class="input" name="description" value="${esc(c?.description)}">`, 12)}
      <div class="field span-12"><label class="label">Foto da categoria</label><div data-photo></div>
        <span class="xs dim">Aparece no botão da categoria, no topo do catálogo. Sem foto, usa a de uma peça dela.</span></div>
      <div class="span-12">${switchField('visible', 'Mostrar no catálogo', c ? c.visible : true)}</div>`,
    onDelete: c ? () => {} : null,
    deleteFlow: c ? (modal) => removeCategory(c, modal) : null,
    onSave: (v) => Data.saveRow('categories', {
      id: c?.id, name: v.name, slug: c?.slug || slugify(v.name), code: (v.code || 'GER').toUpperCase(),
      parent_id: v.parent_id || null, sort: Number(v.sort) || 0, default_grid_id: v.default_grid_id || null, size_chart_id: v.size_chart_id || null,
      description: v.description, image_url: img.value, visible: v.visible,
    }),
  });
  img = mountPhoto($('[data-photo]', m.panel), { value: c?.image_url, label: 'Categoria' });
  m.busy = () => img.busy;
}

/** Peça nunca fica sem categoria por engano: pergunta para onde ela vai. */
async function removeCategory(c, modal) {
  if (Data.categoryList().some((x) => x.parent_id === c.id)) {
    toast('Esta categoria tem subcategorias: mova ou exclua elas antes', { kind: 'warn' });
    return;
  }
  const n = Data.products().filter((p) => p.category_id === c.id).length;
  if (!n) {
    if (!(await confirmDialog({ title: `Excluir ${c.name}?`, confirmText: 'Excluir', danger: true }))) return;
    try { await Data.deleteCategory(c.id); modal.close(); toast('Categoria excluída'); }
    catch (err) { toastError('Não deu para excluir', friendlyError(err)); }
    return;
  }
  const others = Data.categoryList().filter((x) => x.id !== c.id);
  const d = openModal({
    title: `Excluir ${c.name}?`,
    body: `<p class="muted" style="margin-bottom:12px">${n} ${n === 1 ? 'peça está' : 'peças estão'} nesta categoria. Para onde ${n === 1 ? 'ela vai' : 'elas vão'}?</p>
      <select class="select" data-dest aria-label="Mover para">${options(others, '', { empty: 'Escolha a categoria', label: (x) => `${'— '.repeat(x.depth)}${x.name}` })}</select>`,
    footer: '<button class="btn" data-close>Cancelar</button><button class="btn btn-danger" data-ok>Mover e excluir</button>',
  });
  const ok = d.foot.querySelector('[data-ok]');
  ok.addEventListener('click', () => withLoading(ok, async () => {
    const to = d.panel.querySelector('[data-dest]').value;
    if (!to) { toast('Escolha a categoria', { kind: 'warn' }); return; }
    try { await Data.deleteCategory(c.id, to); d.close(); modal.close(); toast('Categoria excluída'); }
    catch (err) { toastError('Não deu para excluir', friendlyError(err)); }
  }));
}

const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function dropForm(c) {
  let img;
  const m = rowModal({
    title: c ? 'Editar drop' : 'Novo drop',
    size: 'lg',
    body: `
      ${field('Nome', `<input class="input" name="name" value="${esc(c?.name)}" required data-autofocus placeholder="Drop 07 - Night Run">`, 12)}
      ${field('Lançamento (data e hora)', `<input class="input" type="datetime-local" name="launch_at" value="${esc(toLocalInput(c?.launch_at))}">`, 6, 'Antes disso, as peças aparecem como "em breve", com contagem regressiva.')}
      ${field('Encerramento', `<input class="input" type="datetime-local" name="ends_at" value="${esc(toLocalInput(c?.ends_at))}">`, 6)}
      ${field('Limite por cliente', `<input class="input" type="number" inputmode="numeric" min="1" name="limit_per_customer" value="${esc(c?.limit_per_customer)}" placeholder="Sem limite">`, 6)}
      ${field('Quantidade produzida', `<input class="input" type="number" inputmode="numeric" min="0" name="total_qty" value="${esc(c?.total_qty)}">`, 6)}
      ${field('Collab com', `<input class="input" name="collab" value="${esc(c?.collab)}" placeholder="Artista / parceiro">`, 12)}
      ${field('Descrição', `<textarea class="textarea" name="description" rows="2">${esc(c?.description)}</textarea>`, 12)}
      <div class="field span-12"><label class="label">Banner</label><div data-photo></div></div>
      <div class="span-12 col gap-2">
        ${switchField('limited', 'Edição limitada', c?.limited)}
        ${switchField('visible', 'Mostrar no catálogo', c ? c.visible : true)}
      </div>`,
    onDelete: c ? () => Data.deleteRow('collections', c.id) : null,
    onSave: (v) => Data.saveRow('collections', {
      id: c?.id, name: v.name, slug: c?.slug || slugify(v.name),
      launch_at: v.launch_at ? new Date(v.launch_at).toISOString() : null,
      ends_at: v.ends_at ? new Date(v.ends_at).toISOString() : null,
      limit_per_customer: Number(v.limit_per_customer) || null, total_qty: Number(v.total_qty) || null,
      collab: v.collab, description: v.description, banner_url: img.value, limited: v.limited, visible: v.visible,
    }),
  });
  img = mountPhoto($('[data-photo]', m.panel), { value: c?.banner_url, label: 'Banner' });
  m.busy = () => img.busy;
}

function brandForm(b) {
  rowModal({
    title: b ? 'Editar marca' : 'Nova marca',
    body: `
      ${field('Nome', `<input class="input" name="name" value="${esc(b?.name)}" required data-autofocus>`, 12)}
      <div class="span-12 col gap-2">${switchField('is_own', 'Marca própria', b?.is_own)}${switchField('active', 'Ativa', b ? b.active : true)}</div>`,
    onDelete: b ? () => Data.deleteRow('brands', b.id) : null,
    onSave: (v) => Data.saveRow('brands', { id: b?.id, name: v.name, is_own: v.is_own, active: v.active }),
  });
}

function colorForm(c) {
  rowModal({
    title: c ? 'Editar cor' : 'Nova cor',
    body: `
      ${field('Nome', `<input class="input" name="name" value="${esc(c?.name)}" required data-autofocus>`, 12)}
      ${field('Cor', `<input class="input" type="color" name="hex" value="${esc(c?.hex || '#111111')}" style="padding:4px;height:42px">`, 6)}
      ${field('Código no SKU', `<input class="input" name="code" value="${esc(c?.code)}" maxlength="4" autocapitalize="characters" placeholder="PRT">`, 6)}
      <div class="span-12">${switchField('active', 'Ativa', c ? c.active : true)}</div>`,
    onDelete: c ? () => Data.deleteRow('colors', c.id) : null,
    onSave: (v) => {
      const code = (v.code || fold(v.name).slice(0, 3)).toUpperCase().replace(/[^A-Z0-9]/g, '');
      return Data.saveRow('colors', { id: c?.id, name: v.name, hex: v.hex, code, active: v.active });
    },
  });
}

function gridForm(g) {
  rowModal({
    title: g ? 'Editar grade' : 'Nova grade',
    body: `
      ${field('Nome', `<input class="input" name="name" value="${esc(g?.name)}" required data-autofocus>`, 12)}
      ${field('Tamanhos, em ordem, separados por vírgula', `<input class="input" name="labels" value="${esc(g ? Data.sizesOf(g.id).map((s) => s.label).join(', ') : '')}" placeholder="PP, P, M, G, GG">`, 12, 'Tirar um tamanho só funciona se ele não estiver em uso em nenhum produto.')}`,
    onDelete: g ? () => Data.deleteRow('size_grids', g.id) : null,
    onSave: (v) => {
      const labels = [...new Set(v.labels.split(',').map((x) => x.trim()).filter(Boolean))];
      if (!labels.length) { toast('Informe os tamanhos', { kind: 'warn' }); return false; }
      return Data.saveGrid({ id: g?.id, name: v.name, labels });
    },
  });
}

function chartForm(t) {
  const m = openModal({
    title: t ? 'Editar tabela de medidas' : 'Nova tabela de medidas',
    size: 'lg',
    body: `
      <form class="form-grid" data-f>
        ${field('Nome', `<input class="input" name="name" value="${esc(t?.name)}" required data-autofocus placeholder="Camiseta oversized">`, 12)}
        ${field('Medidas (colunas), separadas por vírgula', `<input class="input" name="columns" value="${esc((t?.columns || ['Largura (cm)', 'Comprimento (cm)']).join(', '))}">`, 12)}
        ${field('Uma linha por tamanho: TAMANHO: valor, valor', `<textarea class="textarea" name="rows" rows="6" placeholder="P: 56, 66&#10;M: 58, 68">${esc((t?.rows || []).map((r) => `${r.size}: ${(r.values || []).join(', ')}`).join('\n'))}</textarea>`, 12)}
        ${field('Observação', `<input class="input" name="notes" value="${esc(t?.notes)}">`, 12)}
      </form>`,
    footer: `${t ? '<button class="btn btn-ghost" data-del style="margin-right:auto">Excluir</button>' : ''}<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Salvar</button>`,
  });
  const ok = m.foot.querySelector('[data-ok]');
  ok.addEventListener('click', () => withLoading(ok, async () => {
    const v = readForm($('[data-f]', m.panel));
    const rows = v.rows.split('\n').map((l) => {
      const [size, vals = ''] = l.split(':');
      return { size: (size || '').trim(), values: vals.split(',').map((x) => x.trim()).filter(Boolean) };
    }).filter((r) => r.size);
    try {
      await Data.saveRow('size_charts', { id: t?.id, name: v.name, columns: v.columns.split(',').map((x) => x.trim()).filter(Boolean), rows, notes: v.notes });
      m.close();
      toast('Salvo');
    } catch (err) { toastError('Não consegui salvar', friendlyError(err)); }
  }));
  m.foot.querySelector('[data-del]')?.addEventListener('click', async () => {
    try { await Data.deleteRow('size_charts', t.id); m.close(); toast('Excluído'); }
    catch (err) { toastError('Não deu para excluir', friendlyError(err)); }
  });
}
