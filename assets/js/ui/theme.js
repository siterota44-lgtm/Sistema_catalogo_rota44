/** Tema claro/escuro/automático e o "modo privacidade" que borra os valores. */

const THEME_KEY = 'rota44.theme';     // 'auto' | 'light' | 'dark'
const PRIVACY_KEY = 'rota44.privacy'; // 'on' | 'off'

export function getTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch { return 'auto'; }
}

export function applyTheme(mode = getTheme()) {
  const root = document.documentElement;
  if (mode === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  try { localStorage.setItem(THEME_KEY, mode); } catch { /* modo privado do navegador */ }
  syncMetaThemeColor();
}

/** Alterna entre claro e escuro a partir do que está sendo exibido agora. */
export function toggleTheme() {
  applyTheme(isDark() ? 'light' : 'dark');
  return getTheme();
}

export function isDark() {
  const mode = getTheme();
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Deixa a barra do navegador no celular com a cor do app. */
function syncMetaThemeColor() {
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = isDark() ? '#0b0b0c' : '#eeece7';
}

/* ------------------------------------------------------- privacidade -- */

export function isPrivacy() {
  try { return localStorage.getItem(PRIVACY_KEY) === 'on'; } catch { return false; }
}

export function applyPrivacy(on = isPrivacy()) {
  document.documentElement.setAttribute('data-privacy', on ? 'on' : 'off');
  try { localStorage.setItem(PRIVACY_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
}

export function togglePrivacy() {
  const next = !isPrivacy();
  applyPrivacy(next);
  return next;
}

/* ------------------------------------------------------------- início - */

export function initTheme() {
  applyTheme();
  applyPrivacy();
  // Se o usuário está em "automático", acompanha a mudança do sistema ao vivo.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getTheme() === 'auto') syncMetaThemeColor();
  });
}
