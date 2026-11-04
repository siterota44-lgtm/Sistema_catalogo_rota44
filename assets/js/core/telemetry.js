/**
 * Registro de erros do aparelho. Sem isso, um problema no celular só
 * aparecia se alguém contasse. Erros inesperados (de código) vão para a
 * tabela client_errors do Supabase - dá para ver em Ajustes → Diagnóstico.
 *
 * Fica de fora o que não é defeito: falta de internet e as mensagens de
 * regra do banco ("Estoque insuficiente..."). Antes do login (ou sem
 * internet) os erros esperam numa fila no aparelho e sobem depois.
 */

import { APP } from '../config.js';

const KEY = 'rota44.errq';
const MAX_QUEUE = 30;
const seen = new Set();
let sender = null;
let flushing = false;

function readQueue() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}
function writeQueue(q) {
  try { localStorage.setItem(KEY, JSON.stringify(q.slice(-MAX_QUEUE))); } catch { /* modo privado */ }
}

function isNoise(msg, err) {
  const m = msg.toLowerCase();
  return !m
    || err?.code === 'P0001'                               // mensagem de regra do banco
    || m.includes('failed to fetch') || m.includes('networkerror') || m.includes('load failed')
    || m.includes('network request failed') || m.includes('aborterror') || m.includes('the operation was aborted')
    || m.includes('resizeobserver loop')                   // aviso inofensivo do navegador
    || m.startsWith('script error');                       // erro de outra origem, sem detalhe
}

/** Guarda um erro (e tenta enviar). @param {any} err @param {object} [context] */
export function capture(err, context = {}) {
  try {
    const message = String(err?.message || err || '').slice(0, 500);
    if (isNoise(message, err)) return;
    const stack = String(err?.stack || '').slice(0, 4000);
    const key = `${message}|${stack.split('\n')[1] || ''}`;
    if (seen.has(key)) return;   // o mesmo erro repetido na mesma sessão conta uma vez
    seen.add(key);
    const q = readQueue();
    q.push({
      message,
      stack: stack || null,
      url: String(location.href).slice(0, 300),
      user_agent: String(navigator.userAgent).slice(0, 300),
      app_version: APP.version,
      context: {
        ...context,
        at: new Date().toISOString(),
        standalone: matchMedia('(display-mode: standalone)').matches,
        online: navigator.onLine,
      },
    });
    writeQueue(q);
    flush();
  } catch { /* o registro de erro nunca pode quebrar o app */ }
}

/** Quem envia (data.js, depois do login). */
export function setSender(fn) {
  sender = fn;
  flush();
}

export async function flush() {
  if (!sender || flushing || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
  const q = readQueue();
  if (!q.length) return;
  flushing = true;
  try {
    await sender(q);
    writeQueue(readQueue().slice(q.length));
  } catch { /* tenta de novo na próxima */ } finally {
    flushing = false;
  }
}

export function initTelemetry() {
  window.addEventListener('error', (e) => capture(e.error || e.message, { kind: 'error', src: `${e.filename || ''}:${e.lineno || ''}` }));
  window.addEventListener('unhandledrejection', (e) => capture(e.reason, { kind: 'promise' }));
  window.addEventListener('online', () => flush());
}
