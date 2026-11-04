/** Pedaços de tela usados em vários módulos. */

import { esc, money, thumbUrl, downloadFile, toCSV, formatDate } from '../core/utils.js';
import { fold } from '../core/calc.js';
import { icon } from './icons.js';
import { toast, toastError } from './kit.js';
import * as Data from '../core/data.js';
import { friendlyError } from '../core/errors.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const moneyHTML = (v, cls = '') => `<span class="num money-sensitive ${cls}">${esc(money(v))}</span>`;
export const code = (n) => (n == null ? '-' : `#${String(n).padStart(4, '0')}`);
export const badge = (label, tone = 'gray') => `<span class="badge" data-tone="${esc(tone)}">${esc(label)}</span>`;
export const dot = (hex) => `<span class="color-dot" style="background:${esc(hex || '#888')}"></span>`;

export function matches(query, ...fields) {
  const q = fold(query);
  if (!q) return true;
  const hay = fold(fields.filter(Boolean).join(' '));
  return q.split(/\s+/).every((w) => hay.includes(w));
}

/** <img> com a miniatura; se ela não existir, installThumbFallback cai na grande. */
export function photo(url, alt = '', cls = '') {
  if (!url) return `<span class="ph ${esc(cls)}">${icon('image')}</span>`;
  return `<img class="${esc(cls)}" src="${esc(thumbUrl(url))}" data-full="${esc(url)}" alt="${esc(alt)}" loading="lazy" decoding="async">`;
}

export function options(list, value, { empty = '', label = (x) => x.name, val = (x) => x.id } = {}) {
  const first = empty !== false && empty !== null ? `<option value="">${esc(empty)}</option>` : '';
  return first + list.map((x) => {
    const v = val(x);
    return `<option value="${esc(v)}"${String(v) === String(value ?? '') ? ' selected' : ''}>${esc(label(x))}</option>`;
  }).join('');
}

/** Opções de um objeto { chave: 'Rótulo' } ou { chave: { label } }. */
export function optionsMap(map, value, { empty = false } = {}) {
  const list = Object.entries(map).map(([k, v]) => ({ id: k, name: typeof v === 'string' ? v : v.label }));
  return options(list, value, { empty });
}

export function categoryOptions(value, { empty = 'Sem categoria' } = {}) {
  return options(Data.categoryList(), value, {
    empty,
    label: (c) => `${'— '.repeat(c.depth)}${c.name}`,
  });
}

/** Cabeçalho de seção da tela. */
export function head(title, sub = '', actions = '') {
  return `
    <div class="section-head">
      <div><h2>${esc(title)}</h2>${sub ? `<div class="small dim">${esc(sub)}</div>` : ''}</div>
      ${actions ? `<div class="page-actions">${actions}</div>` : ''}
    </div>`;
}

export const field = (label, control, span = 12, hint = '') => `
  <div class="field span-${span}">
    <label class="label">${esc(label)}</label>
    ${control}
    ${hint ? `<span class="hint">${esc(hint)}</span>` : ''}
  </div>`;

export const moneyInput = (name, value = '', attrs = '') => {
  const n = Number(value);
  const shown = value === '' || value == null || !n ? '' : new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  return `<div class="money-input"><input class="input" name="${esc(name)}" inputmode="numeric" autocomplete="off" value="${esc(shown)}" ${attrs}></div>`;
};

export const checkbox = (name, label, on = false) => `
  <label class="check"><input type="checkbox" name="${esc(name)}"${on ? ' checked' : ''}><span class="box"></span><span>${esc(label)}</span></label>`;

export const switchField = (name, label, on = false) => `
  <label class="switch"><input type="checkbox" name="${esc(name)}"${on ? ' checked' : ''}><span class="track"><span class="thumb" style="display:block"></span></span><span>${esc(label)}</span></label>`;

/** Lista que vira cartões no celular. cols: [{ label, cell(row), right?, main? }] */
export function table(cols, rows, { rowAttr = () => '', empty = 'Nada por aqui.' } = {}) {
  if (!rows.length) return `<div class="card">${emptyBox(empty)}</div>`;
  return `
    <div class="table-wrap">
      <table class="data stack">
        <thead><tr>${cols.map((c) => `<th class="${c.right ? 'right' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
        <tbody>
          ${rows.map((r) => `<tr ${rowAttr(r)}>${cols.map((c) => `<td data-label="${esc(c.label)}" class="${c.right ? 'right ' : ''}${c.main ? 'main-cell' : ''}">${c.cell(r)}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

export const emptyBox = (title, text = '') => `
  <div class="empty"><div class="emoji">🛹</div><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}</div>`;

/** Corta listas longas em páginas ("Mostrar mais"). */
export function paged(rows, limit) {
  const shown = rows.slice(0, limit);
  const more = rows.length > limit
    ? `<div class="more-row"><button class="btn" data-more>Mostrar mais (${rows.length - limit})</button></div>` : '';
  return { shown, more };
}

export function exportCSV(filename, rows, headers) {
  downloadFile(filename, toCSV(rows, headers), 'text/csv;charset=utf-8');
}

/** Lê um formulário: checkbox vira boolean; o resto, texto sem espaço nas pontas. */
export function readForm(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else out[el.name] = typeof el.value === 'string' ? el.value.trim() : el.value;
  }
  return out;
}

export const onError = (title) => (err) => {
  console.error(err);
  toastError(title, friendlyError(err));
};

/* ---------------------------------------------------------- fotos -- */

const TOUCH = window.matchMedia('(hover: none) and (pointer: coarse)');

/**
 * Galeria do produto: várias fotos, cada uma com a sua cor (ou "todas"), ordem
 * por setas e a primeira é a capa. Sobe na hora; o formulário guarda as URLs.
 */
export const MAX_PHOTOS = 4;

export function mountGallery(box, { images = [], colors = () => [], onChange } = {}) {
  let list = images.map((i) => ({ url: i.url, color_id: i.color_id || '' }));
  let busy = 0;

  const render = () => {
    const cols = colors();
    box.innerHTML = `
      <div class="gallery">
        ${list.map((im, i) => `
          <div class="gallery-item" data-i="${i}">
            <div class="gallery-photo">
              <img src="${esc(thumbUrl(im.url))}" data-full="${esc(im.url)}" alt="Foto ${i + 1}">
              ${i === 0 ? '<span class="gallery-cover">Capa</span>' : ''}
              <button type="button" class="gallery-rm" data-rm aria-label="Remover foto">${icon('x')}</button>
              <span class="gallery-move">
                ${i > 0 ? `<button type="button" data-left aria-label="Mover para antes">${icon('chevronLeft')}</button>` : ''}
                ${i < list.length - 1 ? `<button type="button" data-right aria-label="Mover para depois">${icon('chevronRight')}</button>` : ''}
              </span>
            </div>
            <select class="select" data-color aria-label="Cor da foto">
              <option value="">Todas as cores</option>
              ${cols.map((c) => `<option value="${esc(c.id)}"${c.id === im.color_id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select>
          </div>`).join('')}
        ${list.length + busy < MAX_PHOTOS || busy ? `<label class="gallery-add">
          ${busy ? '<span class="spinner"></span><span>Enviando…</span>' : `${icon('camera')}<span>Adicionar fotos</span>`}
          <input type="file" accept="image/*" multiple data-file hidden>
        </label>` : ''}
      </div>
      <span class="xs dim">Até ${MAX_PHOTOS} fotos: ${list.length} de ${MAX_PHOTOS}. A primeira é a capa.${TOUCH.matches ? '' : ' Dá para selecionar várias, arrastar para cá ou colar com Ctrl+V.'}</span>`;
  };

  const emit = () => onChange?.(list);

  async function take(files) {
    const images_ = [...files].filter((f) => /^image\//.test(f.type || 'image/'));
    const room = Math.max(MAX_PHOTOS - list.length - busy, 0);
    const only = images_.slice(0, room);
    if (images_.length > room) toast(`Cada peça tem até ${MAX_PHOTOS} fotos. ${room ? `Entraram só ${room}.` : 'Tire uma para colocar outra.'}`, { kind: 'warn' });
    if (!only.length) return;
    busy += only.length;
    render();
    for (const f of only) {
      try {
        const url = await Data.uploadImage(f);
        list.push({ url, color_id: '' });
        emit();
      } catch (err) {
        toastError('Não consegui enviar a foto', friendlyError(err));
      } finally {
        busy -= 1;
        render();
      }
    }
  }

  box.addEventListener('change', (e) => {
    const file = e.target.closest('[data-file]');
    if (file?.files?.length) { take(file.files); return; }
    const sel = e.target.closest('[data-color]');
    if (sel) { list[Number(sel.closest('[data-i]').dataset.i)].color_id = sel.value; emit(); }
  });
  box.addEventListener('click', (e) => {
    const item = e.target.closest('[data-i]');
    if (!item) return;
    const i = Number(item.dataset.i);
    if (e.target.closest('[data-rm]')) { list.splice(i, 1); emit(); render(); return; }
    if (e.target.closest('[data-left]')) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; emit(); render(); return; }
    if (e.target.closest('[data-right]')) { [list[i + 1], list[i]] = [list[i], list[i + 1]]; emit(); render(); }
  });
  // computador: arrastar a foto para o campo ou colar com Ctrl+V
  box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('is-over'); });
  box.addEventListener('dragleave', () => box.classList.remove('is-over'));
  box.addEventListener('drop', (e) => {
    e.preventDefault();
    box.classList.remove('is-over');
    if (e.dataTransfer?.files?.length) take(e.dataTransfer.files);
  });
  const onPaste = (e) => {
    if (!box.isConnected) { document.removeEventListener('paste', onPaste); return; }
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); take(files); }
  };
  if (!TOUCH.matches) document.addEventListener('paste', onPaste);

  render();
  return { get value() { return list; }, get busy() { return busy > 0; }, refresh: render };
}

/** Uma foto só (categoria, banner do drop): câmera ou galeria no celular; arrastar ou colar no computador. */
export function mountPhoto(box, { value = '', label = 'Foto', onChange } = {}) {
  let url = value;
  let busy = false;
  const render = () => {
    box.innerHTML = `
      <div class="photo-one">
        <div class="gallery-photo${busy ? ' is-busy' : ''}" data-drop>
          ${url ? `<img src="${esc(url)}" alt="${esc(label)}">` : `<span class="ph photo-empty">${icon('camera')}<span>Sem foto</span></span>`}
          ${busy ? '<span class="photo-busy"><span class="spinner"></span></span>' : ''}
        </div>
        <div class="col gap-2 photo-actions">
          ${TOUCH.matches ? `
            <label class="btn btn-sm${busy ? ' is-disabled' : ''}">${icon('camera')} Câmera<input type="file" accept="image/*" capture="environment" data-file hidden ${busy ? 'disabled' : ''}></label>
            <label class="btn btn-sm${busy ? ' is-disabled' : ''}">${icon('image')} Galeria<input type="file" accept="image/*" data-file hidden ${busy ? 'disabled' : ''}></label>`
          : `<label class="btn btn-sm${busy ? ' is-disabled' : ''}">${icon('image')} ${busy ? 'Enviando…' : url ? 'Trocar foto' : 'Escolher foto'}<input type="file" accept="image/*" data-file hidden ${busy ? 'disabled' : ''}></label>`}
          ${url && !busy ? `<button type="button" class="btn btn-ghost btn-sm" data-rm>${icon('trash')} Remover</button>` : ''}
          ${TOUCH.matches ? '' : '<span class="xs dim">ou arraste / cole a imagem (Ctrl+V)</span>'}
        </div>
      </div>`;
  };
  async function take(f) {
    if (!f || busy) return;
    if (!/^image\//.test(f.type || 'image/')) { toastError('Isso não é uma imagem', 'Escolha uma foto JPG, PNG ou HEIC.'); return; }
    busy = true; render();
    try { url = await Data.uploadImage(f); onChange?.(url); }
    catch (err) { toastError('Não consegui enviar a foto', friendlyError(err)); }
    finally { busy = false; render(); }
  }
  box.addEventListener('change', (e) => { take(e.target.closest('[data-file]')?.files?.[0]); });
  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-rm]')) { url = ''; onChange?.(url); render(); }
  });
  box.addEventListener('dragover', (e) => { e.preventDefault(); });
  box.addEventListener('drop', (e) => { e.preventDefault(); take(e.dataTransfer?.files?.[0]); });
  const onPaste = (e) => {
    if (!box.isConnected) { document.removeEventListener('paste', onPaste); return; }
    const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); take(f); }
  };
  if (!TOUCH.matches) document.addEventListener('paste', onPaste);
  render();
  return { get value() { return url; }, get busy() { return busy; } };
}

/* ------------------------------------------------------- catálogo --- */

/** Endereço do catálogo: a página inicial do mesmo site. */
export function catalogUrl(hash = '') {
  return `${location.origin}/${hash ? `#${hash}` : ''}`;
}

/* ------------------------------------------------ imprimir sem sair -- */

export function printHTML(html, bodyClass) {
  let root = document.getElementById('print-root');
  if (!root) { root = document.createElement('div'); root.id = 'print-root'; document.body.appendChild(root); }
  root.innerHTML = html;
  document.body.classList.add(bodyClass);
  const done = () => {
    document.body.classList.remove(bodyClass);
    root.innerHTML = '';
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}

export const dateOr = (v, fallback = '-') => (v ? formatDate(v) : fallback);
