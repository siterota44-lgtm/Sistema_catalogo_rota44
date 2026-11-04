/** Peças de interação reaproveitadas: toasts, modais, confirmação, menus. */

import { icon } from './icons.js';
import { esc } from '../core/utils.js';

/* ------------------------------------------------------------ toasts -- */

let toastHost = null;

/** O modal aberto mais recente (o que está na frente), ou null. */
function topDialog() {
  const open = document.querySelectorAll('dialog.modal[open]');
  return open.length ? open[open.length - 1] : null;
}

/**
 * Um <dialog> aberto vive na "camada de cima" do navegador, acima de
 * qualquer z-index. Com o aviso preso no <body>, todo erro e validação
 * mostrados com um modal aberto ficavam escondidos atrás dele - no celular,
 * onde o modal ocupa a tela toda, o botão "Criar pedido" parecia não fazer
 * nada. Por isso a pilha de avisos mora dentro do modal da frente.
 */
function ensureToastHost(exclude = null) {
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.className = 'toasts';
    toastHost.setAttribute('role', 'status');
    toastHost.setAttribute('aria-live', 'polite');
  }
  let parent = topDialog();
  if (parent === exclude) {
    const open = [...document.querySelectorAll('dialog.modal[open]')].filter((d) => d !== exclude);
    parent = open.at(-1) || null;
  }
  parent = parent || document.body;
  if (toastHost.parentElement !== parent) parent.appendChild(toastHost);
  return toastHost;
}

const TOAST_ICONS = { success: 'checkCircle', error: 'xCircle', info: 'info', warn: 'alert' };

export function toast(title, { text = '', kind = 'success', duration = 3600 } = {}) {
  const host = ensureToastHost();
  const el = document.createElement('div');
  el.className = 'toast';
  el.dataset.kind = kind;
  el.innerHTML = `
    ${icon(TOAST_ICONS[kind] || 'info')}
    <div class="grow">
      <div class="toast-title">${esc(title)}</div>
      ${text ? `<div class="toast-text">${esc(text)}</div>` : ''}
    </div>`;
  host.appendChild(el);

  const remove = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 180);
  };
  const timer = setTimeout(remove, duration);
  el.addEventListener('click', () => { clearTimeout(timer); remove(); });
  return remove;
}

export const toastError = (title, text) => toast(title, { text, kind: 'error', duration: 6000 });
export const toastInfo = (title, text) => toast(title, { text, kind: 'info' });

/* ------------------------------------------------------------- modal -- */

let openModals = 0;
const TOUCH = window.matchMedia('(hover: none) and (pointer: coarse)');

/**
 * @param {{title: string, subtitle?: string, body: string, footer?: string,
 *          size?: 'sm'|'lg'|'xl', sheet?: boolean,
 *          onMount?: (panel: HTMLElement, api: object) => void,
 *          beforeClose?: () => boolean | Promise<boolean>,
 *          onClose?: () => void}} spec
 *   sheet: no celular abre como folha que sobe de baixo (sem cobrir a tela
 *          toda), deixando a tela de trás à vista.
 *   beforeClose: chamado quando a pessoa tenta fechar (X, Cancelar, Esc,
 *          toque fora). Devolver false mantém o modal aberto.
 */
export function openModal(spec) {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal';
  const sizeClass = (spec.size && spec.size !== 'sm' ? ` ${spec.size}` : '') + (spec.sheet ? ' sheet' : '');

  // Computador: o foco inicial do showModal() fica no próprio painel
  // (autofocus) - senão cairia no X do topo, com anel azul. Na tela de toque
  // não: o Safari do iPhone desloca a tela para mostrar o painel focado.
  dlg.innerHTML = `
    <div class="modal-inner">
      <div class="modal-panel${sizeClass}" role="document"${TOUCH.matches ? '' : ' tabindex="-1" autofocus'}>
        <header class="modal-head">
          <div class="grow">
            <h2>${esc(spec.title)}</h2>
            ${spec.subtitle ? `<div class="sub">${esc(spec.subtitle)}</div>` : ''}
          </div>
          <button class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button>
        </header>
        <div class="modal-body">${spec.body}</div>
        ${spec.footer ? `<footer class="modal-foot">${spec.footer}</footer>` : ''}
      </div>
    </div>`;

  document.body.appendChild(dlg);
  openModals += 1;
  document.body.style.overflow = 'hidden';

  const api = {
    el: dlg,
    panel: dlg.querySelector('.modal-panel'),
    body: dlg.querySelector('.modal-body'),
    foot: dlg.querySelector('.modal-foot'),
    close(result) {
      if (!dlg.isConnected) return;
      // Os avisos que estão na tela (ex.: "Pedido criado") não podem sumir
      // junto com o modal: passam para o próximo da pilha (ou para a página).
      if (toastHost && dlg.contains(toastHost)) ensureToastHost(dlg);
      dlg.close();
      dlg.remove();
      // Modal dentro de modal (ex.: editar item dentro do pedido): a página
      // de trás só volta a rolar quando o último fechar.
      openModals = Math.max(openModals - 1, 0);
      if (!openModals) document.body.style.overflow = '';
      spec.onClose?.(result);
    },
    /** Fechamento pedido pela pessoa: respeita o `beforeClose`. */
    async requestClose() {
      if (asking) return;
      if (spec.beforeClose) {
        asking = true;
        try {
          if (!(await spec.beforeClose())) return;
        } finally {
          asking = false;
        }
      }
      api.close();
    },
  };
  let asking = false;

  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => api.requestClose()));

  // Clique fora do painel fecha (mas não durante uma seleção de texto arrastada).
  dlg.addEventListener('mousedown', (e) => {
    if (e.target === dlg || e.target.classList.contains('modal-inner')) api.requestClose();
  });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); api.requestClose(); });

  // Nos diálogos curtos (pagamento, item, senha), "OK"/"Ir" do teclado confirma.
  dlg.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.matches('input')) return;
    const ok = api.foot?.querySelector('[data-ok]');
    if (!ok || ok.disabled) return;
    e.preventDefault();
    ok.click();
  });

  dlg.showModal();
  // Aviso que já estava na tela continua visível por cima do modal novo.
  if (toastHost?.childElementCount) ensureToastHost();
  spec.onMount?.(api.panel, api);

  // Foco no primeiro campo útil. Na tela de toque não: o teclado subiria
  // cobrindo metade do formulário antes de a pessoa escolher onde mexer.
  if (TOUCH.matches) return api;
  requestAnimationFrame(() => {
    // o marcado com data-autofocus vem antes (ex.: o valor no pagamento, não "Como recebeu")
    const first = api.panel.querySelector('[data-autofocus]') || api.panel.querySelector('input:not([type=hidden]), textarea, select');
    if (first) first.focus();
  });

  return api;
}

/** Confirmação com Promise. Resolve true/false. */
export function confirmDialog({
  title,
  message = '',
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const modal = openModal({
      title,
      body: message ? `<p class="muted" style="font-size:var(--fs-md);line-height:1.6">${esc(message)}</p>` : '',
      footer: `
        <button class="btn" data-cancel>${esc(cancelText)}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm data-autofocus>${esc(confirmText)}</button>`,
      onClose: () => { if (!answered) resolve(false); },
    });
    modal.foot.querySelector('[data-cancel]').addEventListener('click', () => {
      answered = true; modal.close(); resolve(false);
    });
    modal.foot.querySelector('[data-confirm]').addEventListener('click', () => {
      answered = true; modal.close(); resolve(true);
    });
  });
}

/* -------------------------------------------------------- menu popup -- */

/**
 * Menu flutuante ancorado num botão.
 * @param {HTMLElement} anchor
 * @param {{label: string, icon?: string, danger?: boolean, separatorBefore?: boolean,
 *          onSelect: () => void}[]} items
 */
export function openMenu(anchor, items) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = items
    .map((it, i) => `
      ${it.separatorBefore ? '<hr>' : ''}
      <button role="menuitem" data-i="${i}" class="${it.danger ? 'danger' : ''}">
        ${it.icon ? icon(it.icon) : ''}<span>${esc(it.label)}</span>
      </button>`)
    .join('');

  // Dentro de um modal (camada do topo), o menu tem que morar no modal da
  // frente - no <body> ele abria ATRÁS da janela e o ⋮ parecia não funcionar.
  const host = anchor.closest('dialog[open]') || [...document.querySelectorAll('dialog[open]')].pop();
  if (host) menu.style.position = 'fixed';
  (host || document.body).appendChild(menu);

  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  const left = Math.min(r.right - mw, window.innerWidth - mw - 8);
  const top = r.bottom + mh + 8 > window.innerHeight ? r.top - mh - 6 : r.bottom + 6;
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;

  menu.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-i]');
    if (!btn) return;
    closeMenu();
    items[Number(btn.dataset.i)].onSelect();
  });

  activeMenu = menu;
  setTimeout(() => {
    document.addEventListener('click', onDocClick, { once: true });
    document.addEventListener('keydown', onEsc);
  }, 0);
}

let activeMenu = null;
const onDocClick = () => closeMenu();
const onEsc = (e) => { if (e.key === 'Escape') closeMenu(); };

export function closeMenu() {
  if (!activeMenu) return;
  activeMenu.remove();
  activeMenu = null;
  document.removeEventListener('keydown', onEsc);
}

window.addEventListener('resize', closeMenu);
window.addEventListener('scroll', closeMenu, { capture: true, passive: true });

/* ------------------------------------------------------- estado vazio - */

export function emptyState({ emoji = '📦', title, text = '', action = '' }) {
  return `
    <div class="empty">
      <div class="emoji">${emoji}</div>
      <h3>${esc(title)}</h3>
      ${text ? `<p>${esc(text)}</p>` : ''}
      ${action}
    </div>`;
}

/** Marca um botão como "carregando" enquanto uma promise roda. */
export async function withLoading(button, task) {
  // Sem botão (ex.: currentTarget que virou null depois de um await): só roda.
  if (!button) return task();
  const original = button.innerHTML;
  button.disabled = true;
  button.classList.add('btn-loading');
  button.innerHTML = '';
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.classList.remove('btn-loading');
    button.innerHTML = original;
  }
}
