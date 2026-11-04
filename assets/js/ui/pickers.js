/**
 * Seletores com a cara do sistema, ligados uma vez para o app inteiro.
 *
 *  - <select class="select">: no computador, a lista do navegador (a do
 *    Windows parecia de outro sistema) vira uma lista do app, com teclado.
 *  - <input type="date">: no computador, um calendário do app com "Hoje".
 *  - <input list="…"> (sugestões: modelo, cliente, fornecedor…): em qualquer
 *    aparelho, uma lista da largura do campo que filtra ao digitar, sem
 *    ligar para acento.
 *
 * O campo de verdade continua lá e é ele que guarda o valor: escolher algo
 * só muda o value e dispara "input"/"change", como se a pessoa tivesse
 * digitado. Nada nas telas precisa saber disto. No celular, select e data
 * continuam nativos (a "rodinha" do iPhone é melhor para o dedo).
 */

import { esc } from '../core/utils.js';

const FINE = window.matchMedia('(hover: hover) and (pointer: fine)');
const MONTH = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
const WEEK = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

let wired = false;
let pop = null;          // a lista/calendário aberto
let anchor = null;       // o campo dono dele
let onKey = null;        // teclado enquanto aberto

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function emit(el) {
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/* ------------------------------------------------------- popover base -- */

function close() {
  if (!pop) return;
  pop.remove();
  anchor?.removeAttribute('aria-expanded');
  pop = null;
  anchor = null;
  onKey = null;
}

function place() {
  if (!pop || !anchor) return;
  const r = anchor.getBoundingClientRect();
  const w = Math.max(r.width, Number(pop.dataset.min) || 0);
  pop.style.width = `${Math.min(w, window.innerWidth - 16)}px`;
  pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8))}px`;
  const below = window.innerHeight - r.bottom - 8;
  const h = pop.offsetHeight;
  pop.style.top = `${h > below && r.top > below ? Math.max(8, r.top - h - 6) : r.bottom + 6}px`;
}

/** Abre um popover preso ao campo. Dentro de modal mora no modal (camada do topo). */
function openPop(el, cls, html, { min = 0 } = {}) {
  close();
  pop = document.createElement('div');
  pop.className = `picker-pop ${cls}`;
  pop.dataset.min = String(min);
  pop.innerHTML = html;
  (el.closest('dialog[open]') || document.body).appendChild(pop);
  anchor = el;
  el.setAttribute('aria-expanded', 'true');
  // clicar dentro não tira o foco do campo
  pop.addEventListener('mousedown', (e) => e.preventDefault());
  place();
  return pop;
}

/* ------------------------------------------------------------ select -- */

function openSelect(sel) {
  const opts = [...sel.options];
  const html = `<div class="pp-list" role="listbox">${opts.map((o, i) => o.hidden ? '' : `
    <button type="button" class="pp-opt" role="option" data-i="${i}" ${o.disabled ? 'disabled' : ''}
      aria-selected="${i === sel.selectedIndex}">${esc(o.textContent.trim() || '-')}</button>`).join('')}</div>`;
  const p = openPop(sel, 'pp-select', html, { min: 160 });
  let cur = sel.selectedIndex;
  const btns = () => [...p.querySelectorAll('.pp-opt:not([disabled])')];
  const mark = (i) => {
    cur = i;
    p.querySelectorAll('.pp-opt').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.i) === i));
    p.querySelector(`.pp-opt[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest' });
  };
  const pick = (i) => {
    close();
    sel.focus();
    if (i !== sel.selectedIndex) { sel.selectedIndex = i; emit(sel); }
  };
  mark(cur);
  p.addEventListener('click', (e) => {
    const b = e.target.closest('.pp-opt');
    if (b && !b.disabled) pick(Number(b.dataset.i));
  });
  let typed = '';
  let typedAt = 0;
  onKey = (e) => {
    const list = btns().map((b) => Number(b.dataset.i));
    const at = list.indexOf(cur);
    if (e.key === 'ArrowDown') mark(list[Math.min(at + 1, list.length - 1)] ?? list[0]);
    else if (e.key === 'ArrowUp') mark(list[Math.max(at - 1, 0)] ?? list[0]);
    else if (e.key === 'Home') mark(list[0]);
    else if (e.key === 'End') mark(list[list.length - 1]);
    else if (e.key === 'Enter' || e.key === ' ') { if (cur >= 0) pick(cur); }
    else if (e.key === 'Escape' || e.key === 'Tab') { close(); if (e.key === 'Tab') return; }
    else if (e.key.length === 1) {
      // digitar a primeira letra pula para a opção
      typed = Date.now() - typedAt > 700 ? e.key : typed + e.key;
      typedAt = Date.now();
      const hit = list.find((i) => fold(opts[i].textContent).startsWith(fold(typed)));
      if (hit != null) mark(hit);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };
}

/* -------------------------------------------------------------- data -- */

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseIso = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? new Date(`${s}T12:00:00`) : null);

function openDate(input) {
  const chosen = parseIso(input.value);
  let view = new Date((chosen || new Date()).getFullYear(), (chosen || new Date()).getMonth(), 1, 12);
  let focusDay = chosen || new Date();
  const p = openPop(input, 'pp-date', '', { min: 280 });

  const render = () => {
    const first = new Date(view);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    const today = iso(new Date());
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const v = iso(d);
      const out = (input.min && v < input.min) || (input.max && v > input.max);
      cells.push(`<button type="button" class="pp-day${d.getMonth() !== view.getMonth() ? ' is-other' : ''}${v === today ? ' is-today' : ''}${v === input.value ? ' is-on' : ''}${v === iso(focusDay) ? ' is-active' : ''}"
        data-d="${v}" ${out ? 'disabled' : ''} aria-label="${d.toLocaleDateString('pt-BR')}">${d.getDate()}</button>`);
    }
    p.innerHTML = `
      <div class="pp-head">
        <button type="button" class="pp-nav" data-m="-1" aria-label="Mês anterior">‹</button>
        <span class="pp-month">${esc(MONTH.format(view).replace(/^./, (c) => c.toUpperCase()))}</span>
        <button type="button" class="pp-nav" data-m="1" aria-label="Próximo mês">›</button>
      </div>
      <div class="pp-week">${WEEK.map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="pp-days">${cells.join('')}</div>
      <div class="pp-foot">
        ${input.required ? '<span></span>' : '<button type="button" class="link-btn xs" data-clear>Limpar</button>'}
        <button type="button" class="link-btn xs" data-today>Hoje</button>
      </div>`;
    place();
  };
  const pick = (v) => {
    close();
    input.focus();
    if (v !== input.value) { input.value = v; emit(input); }
  };
  const move = (days) => {
    focusDay = new Date(focusDay);
    focusDay.setDate(focusDay.getDate() + days);
    if (focusDay.getMonth() !== view.getMonth() || focusDay.getFullYear() !== view.getFullYear()) {
      view = new Date(focusDay.getFullYear(), focusDay.getMonth(), 1, 12);
    }
    render();
  };
  render();
  p.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-m]');
    if (nav) { view.setMonth(view.getMonth() + Number(nav.dataset.m)); render(); return; }
    const day = e.target.closest('[data-d]');
    if (day && !day.disabled) { pick(day.dataset.d); return; }
    if (e.target.closest('[data-today]')) { pick(iso(new Date())); return; }
    if (e.target.closest('[data-clear]')) pick('');
  });
  onKey = (e) => {
    if (e.key === 'ArrowLeft') move(-1);
    else if (e.key === 'ArrowRight') move(1);
    else if (e.key === 'ArrowUp') move(-7);
    else if (e.key === 'ArrowDown') move(7);
    else if (e.key === 'PageUp') move(-30);
    else if (e.key === 'PageDown') move(30);
    else if (e.key === 'Enter') pick(iso(focusDay));
    else if (e.key === 'Escape') close();
    else return;   // digitar a data continua no campo
    e.preventDefault();
    e.stopPropagation();
  };
}

/* ------------------------------------------------------- sugestões -- */

/** Troca o datalist nativo pela lista do app (o id fica guardado). */
function adoptList(input) {
  if (!input.hasAttribute('list')) return;
  input.dataset.comboList = input.getAttribute('list');
  input.removeAttribute('list');
  input.classList.add('has-combo');
  input.setAttribute('autocomplete', 'off');
}

function openCombo(input, { all = false } = {}) {
  const dl = document.getElementById(input.dataset.comboList);
  if (!dl) return;
  const q = all ? '' : fold(input.value);
  const seen = new Set();
  const items = [...dl.options].map((o) => ({ value: o.value, note: o.textContent.trim() !== o.value ? o.textContent.trim() : '' }))
    .filter((o) => o.value && !seen.has(fold(o.value)) && seen.add(fold(o.value)))
    .filter((o) => !q || fold(o.value).includes(q))
    .sort((a, b) => (q ? Number(!fold(a.value).startsWith(q)) - Number(!fold(b.value).startsWith(q)) : 0))
    .slice(0, 60);
  // nada a sugerir, ou a única sugestão é exatamente o que já está escrito
  if (!items.length || (items.length === 1 && fold(items[0].value) === fold(input.value))) { if (anchor === input) close(); return; }
  const html = `<div class="pp-list" role="listbox">${items.map((o, i) => `
    <button type="button" class="pp-opt" role="option" data-i="${i}"><span>${esc(o.value)}</span>${o.note ? `<span class="pp-note">${esc(o.note)}</span>` : ''}</button>`).join('')}</div>`;
  const p = openPop(input, 'pp-combo', html);
  let cur = -1;
  const mark = (i) => {
    cur = i;
    p.querySelectorAll('.pp-opt').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.i) === i));
    p.querySelector(`.pp-opt[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest' });
  };
  const pick = (i) => {
    close();
    input.value = items[i].value;
    emit(input);
  };
  p.addEventListener('click', (e) => {
    const b = e.target.closest('.pp-opt');
    if (b) pick(Number(b.dataset.i));
  });
  onKey = (e) => {
    if (e.key === 'ArrowDown') mark(Math.min(cur + 1, items.length - 1));
    else if (e.key === 'ArrowUp') mark(Math.max(cur - 1, 0));
    else if (e.key === 'Enter' && cur >= 0) pick(cur);
    else if (e.key === 'Escape') close();
    else return;   // o resto é digitação normal
    e.preventDefault();
    e.stopPropagation();   // Enter com sugestão marcada não confirma o modal
  };
}

/* ------------------------------------------------------------ ligação -- */

export function initPickers() {
  if (wired) return;
  wired = true;

  // Antes do navegador: troca o datalist e segura a lista/calendário nativos.
  document.addEventListener('pointerdown', (e) => {
    const el = e.target;
    if (pop && !pop.contains(el) && el !== anchor) close();
    if (el.matches?.('input[list]')) adoptList(el);
  }, true);

  document.addEventListener('mousedown', (e) => {
    const el = e.target;
    if (!FINE.matches || e.button !== 0) return;
    if (el.matches?.('select.select') && !el.disabled && !el.multiple) {
      e.preventDefault();
      el.focus();
      if (anchor === el) close(); else openSelect(el);
    } else if (el.matches?.('input[type="date"]') && !el.disabled && !el.readOnly) {
      // o ícone do calendário mora na direita; no resto do campo dá para digitar
      const r = el.getBoundingClientRect();
      if (e.clientX >= r.right - 40) {
        e.preventDefault();
        el.focus();
        if (anchor === el) close(); else openDate(el);
      }
    }
  }, true);

  document.addEventListener('focusin', (e) => {
    if (e.target.matches?.('input[list]')) adoptList(e.target);
  }, true);

  document.addEventListener('click', (e) => {
    const el = e.target;
    if (el.matches?.('input.has-combo') && anchor !== el) openCombo(el, { all: true });
  });

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.matches?.('input.has-combo') && e.isTrusted) openCombo(el);
  });

  document.addEventListener('keydown', (e) => {
    const el = e.target;
    if (pop && onKey && el === anchor) { onKey(e); return; }
    if (!FINE.matches) return;
    const opener = e.key === ' ' || e.key === 'Enter' || e.key === 'F4' || (e.altKey && e.key === 'ArrowDown');
    if (el.matches?.('select.select') && opener && !el.disabled) {
      e.preventDefault();
      e.stopPropagation();
      openSelect(el);
    } else if (el.matches?.('input[type="date"]') && (e.key === 'F4' || (e.altKey && e.key === 'ArrowDown'))) {
      e.preventDefault();
      openDate(el);
    } else if (el.matches?.('input.has-combo') && e.key === 'ArrowDown') {
      e.preventDefault();
      openCombo(el, { all: !el.value });
    }
  }, true);

  document.addEventListener('focusout', (e) => {
    if (e.target === anchor) close();
  }, true);

  // reposiciona (no Android o teclado abrindo muda o tamanho da janela)
  window.addEventListener('resize', () => { if (anchor && !anchor.isConnected) close(); else place(); });
  window.addEventListener('scroll', (e) => {
    if (pop && !pop.contains(e.target)) place();
  }, { capture: true, passive: true });
}
