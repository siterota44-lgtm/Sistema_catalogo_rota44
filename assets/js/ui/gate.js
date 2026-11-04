/** Tela de login. A chave pública vem do config.js: não há configuração inicial. */

import { APP } from '../config.js';
import { signIn, sendPasswordReset } from '../core/supabase.js';
import { toast, toastError } from './kit.js';
import { icon } from './icons.js';
import { esc } from '../core/utils.js';

function shell(inner) {
  return `
    <div class="gate">
      <div class="gate-card">
        <div class="gate-brand">
          <div class="brand-mark" role="img" aria-label="${esc(APP.name)}"></div>
          <p>${esc(APP.subtitle)}</p>
        </div>
        ${inner}
      </div>
    </div>`;
}

export function renderLogin(host, { onDone }) {
  host.innerHTML = shell(`
    <form class="gate-form" data-form novalidate>
      <div class="field">
        <label class="label" for="email">E-mail</label>
        <input class="input" id="email" name="email" type="email" autocomplete="username"
               inputmode="email" autocapitalize="off" spellcheck="false" required data-autofocus>
      </div>
      <div class="field">
        <label class="label" for="password">Senha</label>
        <div style="position:relative">
          <input class="input" id="password" name="password" type="password"
                 autocomplete="current-password" required style="padding-right:44px">
          <button type="button" class="icon-btn sm" data-toggle-pw aria-label="Mostrar senha"
                  style="position:absolute;right:5px;top:50%;transform:translateY(-50%)">${icon('eye')}</button>
        </div>
      </div>
      <div class="alert hide" data-error data-kind="error">${icon('alert')}<div data-error-text></div></div>
      <button class="btn btn-primary btn-lg btn-block" type="submit">Entrar</button>
      <button class="btn btn-ghost btn-sm" type="button" data-forgot>Esqueci minha senha</button>
    </form>
    <div class="gate-foot"><a href="./">Ver o catálogo da loja</a></div>`);

  const form = host.querySelector('[data-form]');
  const errBox = host.querySelector('[data-error]');
  const errText = host.querySelector('[data-error-text]');
  const submit = form.querySelector('[type="submit"]');

  host.querySelector('[data-toggle-pw]').addEventListener('click', (e) => {
    const input = form.password;
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    e.currentTarget.innerHTML = icon(showing ? 'eye' : 'eyeOff');
    input.focus();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.classList.add('hide');
    const email = form.email.value.trim();
    const password = form.password.value;
    if (!email || !password) {
      errText.textContent = 'Preencha e-mail e senha.';
      errBox.classList.remove('hide');
      return;
    }
    submit.disabled = true;
    submit.classList.add('btn-loading');
    const label = submit.textContent;
    submit.textContent = '';
    try {
      await signIn(email, password);
      onDone();
    } catch (err) {
      errText.textContent = err.message;
      errBox.classList.remove('hide');
      form.password.value = '';
      form.password.focus();
    } finally {
      submit.disabled = false;
      submit.classList.remove('btn-loading');
      submit.textContent = label;
    }
  });

  host.querySelector('[data-forgot]').addEventListener('click', async () => {
    const email = form.email.value.trim();
    if (!email) {
      toast('Digite seu e-mail primeiro.', { kind: 'warn' });
      form.email.focus();
      return;
    }
    try {
      await sendPasswordReset(email);
      toast('Link enviado', { text: 'Confira sua caixa de entrada (e o spam).' });
    } catch (err) {
      toastError('Não foi possível enviar', err.message);
    }
  });
}

export function renderBoot(host, message = 'Carregando…') {
  host.innerHTML = `
    <div class="boot">
      <div class="col gap-4" style="align-items:center">
        <div class="brand-mark" style="width:64px;height:75px"></div>
        <div class="spinner"></div>
        <p class="small dim">${esc(message)}</p>
      </div>
    </div>`;
}
