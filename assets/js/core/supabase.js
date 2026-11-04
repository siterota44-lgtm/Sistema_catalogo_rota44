/** Cliente Supabase + autenticação. */

// Versão fixa: a URL fica em cache por 1 ano no aparelho (a "@2" solta é
// revalidada toda semana) e nenhuma atualização da biblioteca muda o app
// sem aviso. Ao trocar, atualize também os modulepreload do index.html.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
import { getConfig } from '../config.js';

let client = null;

/*
 * Tempo limite: no 4G "conectado mas sem dados" uma chamada fica pendurada
 * para sempre (o botão Salvar girando). Estourou o tempo, vira erro de rede
 * comum e a tela avisa. Reenviar é seguro: pedido novo tem um código do
 * aparelho (client_ref) e pagamento nasce com id - o banco não grava duas vezes.
 */
const TIMEOUT_MS = 20000;
const UPLOAD_TIMEOUT_MS = 90000;

export function fetchWithTimeout(input, init = {}) {
  const url = typeof input === 'string' ? input : input?.url || '';
  const ms = url.includes('/storage/v1/') ? UPLOAD_TIMEOUT_MS : TIMEOUT_MS;
  const ctrl = new AbortController();
  const outer = init.signal;
  if (outer) {
    if (outer.aborted) ctrl.abort();
    else outer.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, ms);
  return fetch(input, { ...init, signal: ctrl.signal })
    .catch((err) => {
      if (timedOut) throw new TypeError('Failed to fetch (tempo esgotado)');
      throw err;
    })
    .finally(() => clearTimeout(timer));
}

export function getClient() {
  if (client) return client;
  const cfg = getConfig();
    client = createClient(cfg.url, cfg.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // O link de "esqueci minha senha" volta com o código na URL.
      detectSessionInUrl: true,
      storageKey: 'rota44.auth',
      flowType: 'pkce',
    },
    global: {
      headers: { 'x-client-info': 'rota44-sistema/1.0' },
      fetch: fetchWithTimeout,
    },
  });
  return client;
}

export function resetClient() {
  client = null;
}

/* ------------------------------------------------------------- sessão --- */

export async function getSession() {
  const { data, error } = await getClient().auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getUser() {
  const { data } = await getClient().auth.getUser();
  return data?.user ?? null;
}

export function onAuthChange(callback) {
  const { data } = getClient().auth.onAuthStateChange((event, session) => callback(event, session));
  return () => data.subscription.unsubscribe();
}

export async function signIn(email, password) {
  const { data, error } = await getClient().auth.signInWithPassword({
    email: String(email).trim().toLowerCase(),
    password,
  });
  if (error) throw new Error(friendlyAuthError(error));
  return data.session;
}

export async function signOut() {
  await getClient().auth.signOut();
}

/** Encerra a sessão em TODOS os aparelhos (celular perdido, senha exposta). */
export async function signOutEverywhere() {
  const { error } = await getClient().auth.signOut({ scope: 'global' });
  if (error) throw new Error(friendlyAuthError(error));
}

export async function sendPasswordReset(email) {
  const { error } = await getClient().auth.resetPasswordForEmail(String(email).trim().toLowerCase(), {
    redirectTo: `${location.origin}${location.pathname}`,
  });
  if (error) throw new Error(friendlyAuthError(error));
}

export async function updatePassword(newPassword) {
  const { error } = await getClient().auth.updateUser({ password: newPassword });
  if (error) throw new Error(friendlyAuthError(error));
}

/** Traduz as mensagens do Supabase, que vêm em inglês. */
export function friendlyAuthError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  if (msg.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (msg.includes('email not confirmed')) return 'Confirme seu e-mail antes de entrar.';
  if (msg.includes('rate limit') || msg.includes('too many')) {
    return 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';
  }
  if (msg.includes('password should') || msg.includes('weak password') || msg.includes('weak_password')) {
    return 'Senha fraca: use pelo menos 8 caracteres, misturando letras e números.';
  }
  if (msg.includes('same as the old') || msg.includes('should be different')) return 'A nova senha precisa ser diferente da atual.';
  if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('load failed')) {
    return 'Sem conexão com o servidor. Verifique a internet.';
  }
  if (msg.includes('signups not allowed')) return 'Cadastro desativado. Crie o usuário pelo painel do Supabase.';
  return error?.message || 'Não foi possível concluir a operação.';
}
