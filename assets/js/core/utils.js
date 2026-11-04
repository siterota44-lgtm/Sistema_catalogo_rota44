/** Utilitários gerais: formatação, datas, template seguro contra XSS. */

/* ------------------------------------------------------------------ Moeda */

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const BRL_COMPACT = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1,
});

export function money(value) {
  return BRL.format(Number(value) || 0);
}

export function moneyCompact(value) {
  const n = Number(value) || 0;
  return Math.abs(n) >= 10000 ? BRL_COMPACT.format(n) : BRL.format(n);
}

/** Converte "1.234,56", "1234.56" ou "R$ 1.234,56" em number. */
export function parseMoney(input) {
  if (typeof input === 'number') return input;
  if (!input) return 0;
  let s = String(input).replace(/[^\d,.-]/g, '');
  // Se tem vírgula, ela é o separador decimal (padrão pt-BR).
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

const DECIMAL = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Valor para preencher um campo de dinheiro: 1500 → "1.500,00"; zero → vazio. */
export function moneyInputValue(value) {
  const n = Number(value) || 0;
  return n ? DECIMAL.format(n) : '';
}

/**
 * Máscara de dinheiro estilo app de banco: os dígitos entram pela direita e a
 * vírgula fica sempre nas duas últimas casas. "150000" → "1.500,00".
 */
export function maskMoney(value = '') {
  const digits = String(value).replace(/\D/g, '').replace(/^0+/, '').slice(0, 11);
  return digits ? DECIMAL.format(Number(digits) / 100) : '';
}

/* ------------------------------------------------------------------ Datas */

/** Data de hoje (AAAA-MM-DD) no fuso do aparelho, não em UTC. */
export function todayISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Converte para Date. "AAAA-MM-DD" vira meia-noite LOCAL: o `new Date()` puro
 * lê como UTC e, no Brasil, o pedido de hoje aparecia como sendo de ontem.
 */
export function toDate(value) {
  if (value instanceof Date) return value;
  const s = String(value ?? '');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
}

export function formatDate(value, opts = {}) {
  if (!value) return '-';
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', ...opts });
}

export function formatDateTime(value) {
  if (!value) return '-';
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

/** "hoje", "ontem", "há 3 dias", "12/03/2025". */
export function relativeDate(value) {
  if (!value) return '-';
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '-';
  const days = Math.floor((startOfDay(new Date()) - startOfDay(d)) / 86400000);
  if (days === 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days > 1 && days < 7) return `há ${days} dias`;
  return formatDate(d);
}

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function startOfMonth(d = new Date()) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Nº de dias corridos desde a data (usado para destacar pedidos parados). */
export function daysSince(value) {
  if (!value) return 0;
  return Math.floor((startOfDay(new Date()) - startOfDay(toDate(value))) / 86400000);
}

/* ---------------------------------------------------------------- Tela */

const MOBILE_MQ = window.matchMedia('(max-width: 860px)');

/** Mesmo corte do CSS (mobile.css): abaixo disso o layout é o do celular. */
export function isMobile() {
  return MOBILE_MQ.matches;
}

/** Avisa quando o layout troca entre celular e desktop. Devolve o "desligar". */
export function onLayoutChange(fn) {
  MOBILE_MQ.addEventListener('change', fn);
  return () => MOBILE_MQ.removeEventListener('change', fn);
}

/* -------------------------------------------------------- Template seguro */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapa texto para interpolação em HTML. Use SEMPRE em dado vindo do usuário. */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

const RAW = Symbol('raw');

/** Marca um fragmento como já sanitizado (HTML gerado por nós, não pelo usuário). */
export function raw(str) {
  return { [RAW]: true, value: String(str) };
}

/**
 * Template tag que escapa toda interpolação automaticamente.
 *   html`<p>${nomeDoCliente}</p>`   →  seguro
 *   html`<ul>${raw(itens)}</ul>`    →  insere HTML confiável
 * Arrays são concatenados (cada elemento passa pela mesma regra).
 */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    out += renderValue(values[i]) + strings[i + 1];
  }
  return out;
}

function renderValue(v) {
  if (v === null || v === undefined || v === false) return '';
  if (Array.isArray(v)) return v.map(renderValue).join('');
  if (typeof v === 'object' && v[RAW]) return v.value;
  return esc(v);
}

/* ------------------------------------------------------------------ Texto */

export function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function titleCase(str = '') {
  return String(str).toLowerCase().replace(/(^|\s|')\p{L}/gu, (m) => m.toUpperCase());
}

/** Máscara de telefone brasileiro conforme digita. */
export function maskPhone(value = '') {
  const d = String(value).replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function maskCEP(value = '') {
  const d = String(value).replace(/\D/g, '').slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

export function onlyDigits(value = '') {
  return String(value).replace(/\D/g, '');
}

/**
 * Número para o wa.me (com o 55 do Brasil). Regra pelo TAMANHO, não pelo
 * começo: "(55) 99999-8888" (DDD 55, Santa Maria-RS) tem 11 dígitos e
 * precisa do 55 na frente.
 *   10-11 dígitos → DDD + número          → 55 + número
 *   12-13 dígitos começando com 55        → já está completo
 * Devolve '' se não der para montar.
 */
export function waNumber(phone) {
  const d = onlyDigits(phone).replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  return '';
}

/** Link do WhatsApp a partir de um telefone brasileiro. */
export function whatsappLink(phone, message = '') {
  const full = waNumber(phone);
  if (!full) return null;
  const q = message ? `?text=${encodeURIComponent(message)}` : '';
  return `https://wa.me/${full}${q}`;
}

/* ---------------------------------------------------- fotos (miniatura) */

/** Lado maior da miniatura (listas do app e grade do catálogo). */
export const THUMB_PX = 720;

/** Caminho da miniatura no Storage: "p/abc.webp" → "p/abc.t.webp". */
export function thumbPath(path) {
  return String(path || '').replace(/(\.[a-z0-9]+)?$/i, '.t$1');
}

/** URL da miniatura de uma foto do Storage; outras URLs voltam iguais. */
export function thumbUrl(url) {
  const s = String(url || '');
  if (!s.includes('/storage/v1/object/public/')) return s;
  const [base, query] = s.split('?');
  return thumbPath(base) + (query ? `?${query}` : '');
}

/**
 * <img data-full="..."> que falhar (miniatura que não existe) troca para a
 * foto grande. Um ouvinte só, na fase de captura (o "error" de imagem não
 * sobe) - e sem onerror inline, que a CSP bloqueia.
 */
export function installThumbFallback(root = document) {
  root.addEventListener('error', (e) => {
    const img = e.target;
    if (img?.tagName !== 'IMG' || !img.dataset.full || img.getAttribute('src') === img.dataset.full) return;
    img.src = img.dataset.full;
  }, true);
}

/* ------------------------------------------------------------------ Misc */

/** UUID v4 (vira id no banco: pedido, cliente e pagamento nascem no aparelho). */
export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  // iPhone antigo (iOS < 15.4) não tem randomUUID - e o banco exige UUID.
  const b = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function debounce(fn, wait = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export function sum(list, pick = (x) => x) {
  return list.reduce((acc, item) => acc + (Number(pick(item)) || 0), 0);
}

export function groupBy(list, pick) {
  const map = new Map();
  for (const item of list) {
    const key = pick(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

export function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

/* -------------------------------------------------------------------- CSV */

export function toCSV(rows, headers) {
  const cols = headers || Object.keys(rows[0] ?? {});
  const escape = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    // Planilha aberta no Excel não pode executar fórmula vinda de um nome
    // de cliente ("=HYPERLINK(...)"): vira texto. Número negativo passa.
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-[\d.,\s]*$/.test(s)) s = `'${s}`;
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(';')];
  for (const row of rows) lines.push(cols.map((c) => escape(row[c])).join(';'));
  // BOM para o Excel brasileiro abrir com acentuação correta.
  return '﻿' + lines.join('\r\n');
}

export function downloadFile(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
