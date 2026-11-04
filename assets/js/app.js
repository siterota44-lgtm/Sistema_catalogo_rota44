/**
 * Ponto de entrada do sistema: login → "sem acesso" → "banco antigo" → app.
 * Cada tela recebe um container NOVO a cada navegação: os ouvintes ficam nele
 * e somem junto, nada vaza de uma tela para outra.
 */

import { APP } from './config.js';
import { getSession, onAuthChange, signOut, updatePassword } from './core/supabase.js';
import * as Data from './core/data.js';
import { SALE_STATUS } from './core/constants.js';
import { friendlyError, isMissingSchema } from './core/errors.js';
import { initTelemetry, setSender, capture } from './core/telemetry.js';
import { initTheme, toggleTheme, isDark, isPrivacy, togglePrivacy } from './ui/theme.js';
import { renderLogin, renderBoot } from './ui/gate.js';
import { icon } from './ui/icons.js';
import { toast, toastError, closeMenu, openModal, withLoading } from './ui/kit.js';
import { initInputs } from './ui/inputs.js';
import { initPickers } from './ui/pickers.js';
import { esc, debounce, installThumbFallback, todayISO, addDays } from './core/utils.js';

import * as Dashboard from './ui/dashboard.js';
import * as Pos from './ui/pos.js';
import * as Sales from './ui/sales.js';
import * as Requests from './ui/requests.js';
import * as Returns from './ui/returns.js';
import * as Customers from './ui/customers.js';
import * as Products from './ui/products.js';
import * as Registers from './ui/registers.js';
import * as Promos from './ui/promos.js';
import * as Stock from './ui/stock.js';
import * as Purchases from './ui/purchases.js';
import * as Suppliers from './ui/suppliers.js';
import * as Labels from './ui/labels.js';
import * as Cash from './ui/cash.js';
import * as Finance from './ui/finance.js';
import * as Reports from './ui/reports.js';
import * as CatalogAdmin from './ui/catalog-admin.js';
import * as Settings from './ui/settings.js';

const ROOT = document.getElementById('app');
const SELL = ['admin', 'gerente', 'vendedor'];
const MGR = ['admin', 'gerente'];
const STK = ['admin', 'gerente', 'estoquista'];

/*
 * Menu por grupos e por perfil: o que o perfil não acessa nem aparece (a trava
 * de verdade está no banco). `tab`: fica na barra de baixo do celular.
 */
const ROUTES = [
  { id: 'painel', label: 'Painel', icon: 'dashboard', module: Dashboard, group: 'Loja', tab: true, roles: [...SELL, 'estoquista'] },
  { id: 'pdv', label: 'PDV', icon: 'cash', module: Pos, group: 'Loja', tab: true, roles: SELL },
  { id: 'vendas', label: 'Vendas', icon: 'orders', module: Sales, group: 'Loja', tab: true, roles: SELL, search: true },
  { id: 'pedidos', label: 'Pedidos do catálogo', short: 'Pedidos', icon: 'whatsapp', module: Requests, group: 'Loja', roles: SELL },
  { id: 'trocas', label: 'Trocas', icon: 'refresh', module: Returns, group: 'Loja', roles: MGR, search: true },
  { id: 'caixa', label: 'Caixa', icon: 'wallet', module: Cash, group: 'Loja', roles: SELL },
  { id: 'clientes', label: 'Clientes', icon: 'users', module: Customers, group: 'Loja', roles: SELL, search: true },
  { id: 'produtos', label: 'Produtos', icon: 'box', module: Products, group: 'Produtos', tab: true, roles: [...SELL, 'estoquista'], search: true },
  { id: 'cadastros', label: 'Categorias e drops', icon: 'grid', module: Registers, group: 'Produtos', roles: MGR },
  { id: 'promocoes', label: 'Promoções e cupons', icon: 'tag', module: Promos, group: 'Produtos', roles: MGR },
  { id: 'estoque', label: 'Estoque', icon: 'layers', module: Stock, group: 'Estoque', roles: [...SELL, 'estoquista'], search: true },
  { id: 'compras', label: 'Compras', icon: 'truck', module: Purchases, group: 'Estoque', roles: STK },
  { id: 'fornecedores', label: 'Fornecedores', icon: 'store', module: Suppliers, group: 'Estoque', roles: STK, search: true },
  { id: 'etiquetas', label: 'Etiquetas', icon: 'print', module: Labels, group: 'Estoque', roles: STK },
  { id: 'financeiro', label: 'Financeiro', icon: 'receipt', module: Finance, group: 'Gestão', roles: ['admin'] },
  { id: 'relatorios', label: 'Relatórios', icon: 'chart', module: Reports, group: 'Gestão', roles: MGR },
  { id: 'catalogo', label: 'Catálogo online', icon: 'link', module: CatalogAdmin, group: 'Gestão', roles: MGR },
  { id: 'ajustes', label: 'Ajustes', icon: 'settings', module: Settings, group: '', roles: [...SELL, 'estoquista'] },
];

const SEARCH_HINT = {
  vendas: 'Buscar venda, cliente, SKU…',
  clientes: 'Buscar nome, telefone, CPF…',
  produtos: 'Buscar produto, SKU, código…',
  estoque: 'Buscar produto, SKU…',
  fornecedores: 'Buscar fornecedor…',
  trocas: 'Buscar venda ou cliente…',
};

let current = null;
let currentId = null;
let globalsWired = false;
let pendingSearch = null;
let authWired = false;
let allowed = ROUTES;

initTheme();
initInputs();
initPickers();
initTelemetry();
installThumbFallback();
boot();

async function boot() {
  renderBoot(ROOT, 'Iniciando…');
  wireAuth();

  let session;
  try {
    session = await getSession();
  } catch (err) {
    console.error(err);
    renderBootError(err);
    return;
  }
  if (!session) {
    renderLogin(ROOT, { onDone: boot });
    return;
  }

  renderBoot(ROOT, 'Conferindo o acesso…');
  let me;
  try {
    me = await Data.whoami();
  } catch (err) {
    console.error(err);
    if (isMissingSchema(err)) renderSchemaHelp(0);
    else renderBootError(err);
    return;
  }
  if (!me.member) {
    renderNoAccess(session.user?.email);
    return;
  }
  if ((Number(me.schema_version) || 0) < APP.schemaVersion) {
    renderSchemaHelp(Number(me.schema_version) || 0);
    return;
  }

  setSender((rows) => Data.sendErrors(rows));
  renderBoot(ROOT, 'Carregando a loja…');
  try {
    await Data.loadAll();
  } catch (err) {
    console.error(err);
    if (isMissingSchema(err)) renderSchemaHelp(0);
    else renderBootError(err);
    return;
  }
  allowed = ROUTES.filter((r) => r.roles.includes(me.role));
  renderApp();
  startIdleWatch();
  startAutoSync();
}

function wireAuth() {
  if (authWired) return;
  authWired = true;
  onAuthChange((event) => {
    if (event === 'SIGNED_OUT') {
      Data.reset();
      renderLogin(ROOT, { onDone: boot });
    }
    if (event === 'PASSWORD_RECOVERY') openNewPassword();
  });
}

/** Voltou pelo link do e-mail "esqueci minha senha": pede a senha nova. */
function openNewPassword() {
  const m = openModal({
    title: 'Defina sua nova senha',
    subtitle: 'Você entrou pelo link do e-mail',
    body: `
      <div class="form-grid">
        <div class="field span-12"><label class="label" for="np-a">Nova senha</label>
          <input class="input" id="np-a" type="password" autocomplete="new-password" minlength="8" data-autofocus></div>
        <div class="field span-12"><label class="label" for="np-b">Repita a senha</label>
          <input class="input" id="np-b" type="password" autocomplete="new-password" minlength="8"></div>
      </div>
      <div class="alert hide" data-erro data-kind="warn" style="margin-top:12px">${icon('alert')}<div data-erro-txt></div></div>`,
    footer: '<button class="btn btn-primary" data-ok>Salvar senha</button>',
  });
  const btn = m.foot.querySelector('[data-ok]');
  btn.addEventListener('click', async () => {
    const a = m.panel.querySelector('#np-a').value;
    const b = m.panel.querySelector('#np-b').value;
    const erro = (t) => { m.panel.querySelector('[data-erro-txt]').textContent = t; m.panel.querySelector('[data-erro]').classList.remove('hide'); };
    if (a.length < 8) { erro('Use pelo menos 8 caracteres.'); return; }
    if (a !== b) { erro('As duas senhas estão diferentes.'); return; }
    await withLoading(btn, async () => {
      try {
        await updatePassword(a);
        m.close();
        toast('Senha atualizada');
        history.replaceState(null, '', location.pathname + location.hash);
      } catch (err) {
        erro(err.message);
      }
    });
  });
}

function gateCard(title, sub, inner) {
  ROOT.innerHTML = `
    <div class="gate"><div class="gate-card wide">
      <div class="gate-brand">
        <div class="brand-mark" role="img" aria-label="Rota 44"></div>
        <div><h1>${esc(title)}</h1><p>${esc(sub)}</p></div>
      </div>
      ${inner}
      <div class="gate-foot"><button class="btn btn-ghost btn-sm" data-logout>Sair da conta</button></div>
    </div></div>`;
  ROOT.querySelector('[data-retry]')?.addEventListener('click', () => location.reload());
  ROOT.querySelector('[data-logout]')?.addEventListener('click', async () => {
    await signOut().catch(() => {});
    location.reload();
  });
}

function renderSchemaHelp(version) {
  gateCard('Falta preparar o banco', `App ${APP.version}`, `
    <div class="alert" data-kind="warn">${icon('alert')}
      <div>O banco está na versão <b>${esc(version)}</b> e este app precisa da <b>${esc(APP.schemaVersion)}</b>. Nada foi perdido.</div></div>
    <ol class="col gap-3 small muted" style="margin:18px 0;padding-left:18px;list-style:decimal">
      <li>Abra o painel do Supabase → <b>SQL Editor</b> → <b>New query</b>.</li>
      <li>Cole o arquivo <code>supabase/schema.sql</code> inteiro e clique em <b>Run</b>.</li>
      <li>Na primeira vez, rode também <code>supabase/seed_base.sql</code> e <code>supabase/primeiro_admin.sql</code>.</li>
    </ol>
    <button class="btn btn-primary btn-block" data-retry>Já rodei, tentar de novo</button>`);
}

function renderNoAccess(email) {
  gateCard('Sem acesso à loja', email || '', `
    <div class="alert" data-kind="warn">${icon('lock')}
      <div>Este login existe, mas não está autorizado no sistema da Rota 44. Rode o <code>supabase/primeiro_admin.sql</code> ou peça para o administrador incluir em Ajustes → Equipe.</div></div>
    <button class="btn btn-block" data-retry style="margin-top:16px">Tentar de novo</button>`);
}

function renderBootError(err) {
  gateCard('Não consegui abrir a loja', 'Pode ser a internet ou o Supabase pausado', `
    <div class="alert" data-kind="warn">${icon('alert')}<div>${esc(friendlyError(err))}</div></div>
    <p class="small muted" style="margin:14px 0">Se o Supabase ficou sem uso por dias, o projeto grátis pausa: abra o painel do Supabase e clique em <b>Restore project</b>.</p>
    <button class="btn btn-primary btn-block" data-retry>Tentar de novo</button>`);
}

/* ==================================================================== */

function navHTML() {
  let html = '';
  let lastGroup = null;
  for (const r of allowed) {
    if (r.group !== lastGroup) {
      html += r.group ? `<div class="nav-group">${esc(r.group)}</div>` : '<div class="nav-sep"></div>';
      lastGroup = r.group;
    }
    html += `
      <button class="nav-item" data-route="${r.id}">
        ${icon(r.icon)}<span>${esc(r.label)}</span>
        ${r.id === 'vendas' ? '<span class="count" data-open-count hidden>0</span>' : ''}
        ${r.id === 'pedidos' ? '<span class="count accent" data-req-count hidden>0</span>' : ''}
        ${r.id === 'estoque' ? '<span class="count warn" data-low-count hidden>0</span>' : ''}
        ${r.id === 'financeiro' ? '<span class="count warn" data-due-count hidden>0</span>' : ''}
      </button>`;
  }
  return html;
}

function renderApp() {
  try { current?.destroy?.(); } catch (err) { capture(err, { where: 'destroy' }); }
  current = null;
  currentId = null;
  const canSell = Data.hasRole(...SELL);
  ROOT.innerHTML = `
    <div class="app" data-drawer="closed">
      <aside class="sidebar" aria-label="Menu principal">
        <div class="brand">
          <div class="brand-mark" role="img" aria-label="${esc(APP.name)}"></div>
          <span class="brand-wordmark">ROTA <b>44</b></span>
        </div>
        ${canSell ? `<button class="btn btn-primary btn-block" data-new-sale style="margin-bottom:10px">${icon('plus')} Nova venda</button>` : ''}
        <nav class="nav" data-nav>${navHTML()}</nav>
        <div class="sidebar-foot">
          <button class="user-chip" data-theme-toggle>
            <span class="avatar" data-theme-icon></span>
            <span class="grow small" data-theme-label>Tema ${isDark() ? 'escuro' : 'claro'}</span>
          </button>
          <button class="user-chip" data-privacy-toggle>
            <span class="avatar" data-privacy-icon></span>
            <span class="grow small" data-privacy-label>${isPrivacy() ? 'Valores ocultos' : 'Valores visíveis'}</span>
          </button>
        </div>
      </aside>

      <div class="main">
        <header class="topbar">
          <button class="icon-btn only-mobile" data-drawer-toggle aria-label="Abrir menu">${icon('menu')}</button>
          <h1 class="page-title" data-title>Painel</h1>
          <span class="grow"></span>
          <div class="search" data-search-wrap>
            ${icon('search')}
            <input class="input" type="search" placeholder="Buscar…" data-search aria-label="Buscar" autocomplete="off" enterkeyhint="search">
            <kbd>/</kbd>
          </div>
          <button class="icon-btn" data-refresh aria-label="Atualizar" title="Atualizar">${icon('refresh')}</button>
          <button class="icon-btn hide-mobile" data-privacy-toggle aria-label="Modo privacidade" data-privacy-icon></button>
          <button class="icon-btn" data-theme-toggle aria-label="Trocar tema" data-theme-icon></button>
        </header>
        <main class="content" data-view></main>
      </div>

      <nav class="tabbar" data-tabbar aria-label="Navegação">
        ${allowed.filter((r) => r.tab).map((r) => `<button data-route="${r.id}">${icon(r.icon)}<span>${esc(r.short || r.label)}</span></button>`).join('')}
        <button data-drawer-toggle aria-label="Mais opções">${icon('menu')}<span>Mais</span></button>
      </nav>
    </div>`;

  wireShell();
  route(location.hash.slice(2) || allowed[0].id);
}

function wireShell() {
  const app = ROOT.querySelector('.app');
  const $search = ROOT.querySelector('[data-search]');

  app.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-route]');
    if (nav) { location.hash = `#/${nav.dataset.route}`; closeDrawer(); return; }
    if (e.target.closest("[data-new-sale]")) { location.hash = "#/pdv"; closeDrawer(); return; }
    if (e.target.closest('[data-theme-toggle]')) {
      toggleTheme();
      syncToggleIcons();
      ROOT.querySelectorAll('[data-theme-label]').forEach((el) => { el.textContent = `Tema ${isDark() ? 'escuro' : 'claro'}`; });
      return;
    }
    if (e.target.closest('[data-privacy-toggle]')) {
      const on = togglePrivacy();
      syncToggleIcons();
      ROOT.querySelectorAll('[data-privacy-label]').forEach((el) => { el.textContent = on ? 'Valores ocultos' : 'Valores visíveis'; });
      return;
    }
    if (e.target.closest('[data-drawer-toggle]')) {
      app.dataset.drawer = app.dataset.drawer === 'open' ? 'closed' : 'open';
      if (app.dataset.drawer === 'open') addScrim();
      else closeDrawer();
      return;
    }
    if (e.target.closest('[data-refresh]')) refresh();
  });

  $search.addEventListener('input', debounce((e) => current?.onSearch?.(e.target.value), 180));

  // Ouvintes globais só uma vez: renderApp() roda de novo depois de um logout.
  if (!globalsWired) {
    globalsWired = true;
    window.addEventListener('hashchange', () => route(location.hash.slice(2) || allowed[0].id));
    document.addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea, select')) {
        if (e.key === 'Escape') e.target.blur();
        return;
      }
      if (document.querySelector('dialog.modal[open]')) return;
      if (e.key === '/') { e.preventDefault(); ROOT.querySelector('[data-search]')?.focus(); }
    });
    Data.subscribe(() => { updateCounts(); current?.onData?.(); });
    Data.onNewCatalogRequest((req) => {
      toast(`Pedido pelo catálogo: ${req.customer_name}`, { kind: 'info', text: `C${req.number} · veja em Pedidos do catálogo`, duration: 8000 });
      try { navigator.vibrate?.(120); } catch { /* sem vibração */ }
    });
  }
  syncToggleIcons();
  updateCounts();
}

function syncToggleIcons() {
  ROOT.querySelectorAll('[data-theme-icon]').forEach((el) => { el.innerHTML = icon(isDark() ? 'moon' : 'sun'); });
  ROOT.querySelectorAll('[data-privacy-icon]').forEach((el) => { el.innerHTML = icon(isPrivacy() ? 'eyeOff' : 'eye'); });
}

function setCount(sel, n) {
  ROOT.querySelectorAll(sel).forEach((el) => { el.textContent = String(n); el.hidden = n === 0; });
}

function updateCounts() {
  setCount('[data-open-count]', Data.sales().filter((s) => SALE_STATUS[s.status]?.open).length);
  setCount('[data-req-count]', Data.catalogRequests().filter((r) => r.status === 'novo').length);
  setCount('[data-low-count]', Data.lowStock().length);
  const soon = todayISO(addDays(new Date(), 3));
  setCount('[data-due-count]', Data.bills().filter((b) => b.status === 'aberta' && b.due_date <= soon).length);
}

function addScrim() {
  const app = ROOT.querySelector('.app');
  if (app.querySelector('.scrim')) return;
  const scrim = document.createElement('div');
  scrim.className = 'scrim only-mobile';
  scrim.addEventListener('click', closeDrawer);
  app.appendChild(scrim);
}

function closeDrawer() {
  const app = ROOT.querySelector('.app');
  if (!app) return;
  app.dataset.drawer = 'closed';
  app.querySelector('.scrim')?.remove();
}

/* ------------------------------------------------------------ roteador */

function route(id) {
  const [baseId] = String(id).split('?');
  const found = allowed.find((r) => r.id === baseId) || allowed[0];
  if (currentId === found.id) return;
  if (!ROOT.querySelector('[data-view]')) return;

  closeMenu();
  try { current?.destroy?.(); } catch (err) { capture(err, { where: 'destroy' }); }

  const oldHost = ROOT.querySelector('[data-view]');
  const viewHost = oldHost.cloneNode(false);
  oldHost.replaceWith(viewHost);

  const $search = ROOT.querySelector('[data-search]');
  currentId = found.id;
  ROOT.querySelector('[data-title]').textContent = found.label;
  ROOT.querySelector('[data-search-wrap]').classList.toggle('hide', !found.search);
  $search.placeholder = SEARCH_HINT[found.id] || 'Buscar…';
  if (!found.search) $search.value = '';

  ROOT.querySelectorAll('[data-route]').forEach((btn) => {
    if (btn.dataset.route === found.id) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });

  const ctx = {
    go(routeId, search) {
      if (search) pendingSearch = search;
      location.hash = `#/${routeId}`;
    },
  };
  try {
    current = found.module.mount(viewHost, ctx) || {};
  } catch (err) {
    console.error(err);
    capture(err, { where: `mount:${found.id}` });
    viewHost.innerHTML = `<div class="alert" data-kind="warn">${icon('alert')}<div>Esta tela falhou ao abrir: ${esc(err.message)}</div></div>`;
    current = {};
  }
  if (pendingSearch !== null && found.search) {
    $search.value = pendingSearch;
    current.onSearch?.(pendingSearch);
    pendingSearch = null;
  } else if (found.search && $search.value) current.onSearch?.($search.value);

  markDupTitle(viewHost, found.label);
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/* O título já está na barra de cima: o mesmo título no topo da tela some, inclusive quando ela se redesenha. */
let titleObserver = null;
function markDupTitle(host, label) {
  titleObserver?.disconnect();
  const mark = () => {
    const h2 = host.querySelector('.section-head h2');
    if (h2 && !h2.classList.contains('is-dup-title') && h2.textContent.trim() === label) h2.classList.add('is-dup-title');
  };
  mark();
  titleObserver = new MutationObserver(mark);
  titleObserver.observe(host, { childList: true, subtree: true });
}

async function refresh() {
  const btns = ROOT.querySelectorAll('[data-refresh]');
  btns.forEach((b) => { b.disabled = true; b.classList.add('is-spinning'); });
  try {
    await Data.reload();
    toast('Tudo atualizado', { duration: 1600 });
  } catch (err) {
    toastError('Não consegui atualizar', friendlyError(err));
  } finally {
    btns.forEach((b) => { b.disabled = false; b.classList.remove('is-spinning'); });
  }
}

/* O celular derruba o realtime quando a tela bloqueia: ao voltar, busca de novo. */
let autoSyncStarted = false;
function startAutoSync() {
  if (autoSyncStarted) return;
  autoSyncStarted = true;
  const sync = () => { if (!document.hidden) Data.refreshIfStale(); };
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('focus', sync);
  window.addEventListener('online', sync);
  window.addEventListener('pageshow', (e) => { if (e.persisted) sync(); });
  setInterval(() => { if (!document.hidden) Data.refreshIfStale(Data.isRealtimeUp() ? 300000 : 60000); }, 30000);
}

let idleWired = false;
function startIdleWatch() {
  if (!APP.idleLogoutMinutes || idleWired) return;
  idleWired = true;
  const limit = APP.idleLogoutMinutes * 60 * 1000;
  let timer;
  const reset = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await signOut().catch(() => {});
      Data.reset();
      renderLogin(ROOT, { onDone: boot });
      toast('Sessão encerrada por inatividade', { kind: 'info', duration: 6000 });
    }, limit);
  };
  ['pointerdown', 'keydown', 'visibilitychange'].forEach((evt) => document.addEventListener(evt, reset, { passive: true }));
  reset();
}
