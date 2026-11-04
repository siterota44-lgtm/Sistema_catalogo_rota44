/** Ajustes: dados da loja, regras de venda, equipe, minha conta, backup e auditoria. */

import * as Data from '../core/data.js';
import { APP } from '../config.js';
import { signOut, signOutEverywhere, updatePassword } from '../core/supabase.js';
import { esc, parseMoney, maskPhone, onlyDigits, formatDateTime, todayISO, downloadFile } from '../core/utils.js';
import { ROLES } from '../core/constants.js';
import { friendlyError } from '../core/errors.js';
import { isDark, toggleTheme, getTheme, applyTheme } from './theme.js';
import { icon } from './icons.js';
import { toast, toastError, openModal, withLoading, confirmDialog } from './kit.js';
import { $, head, field, optionsMap, moneyInput, readForm, switchField, table, badge, emptyBox } from './common.js';

export function mount(host) {
  const isAdmin = Data.hasRole('admin');
  const isMgr = Data.hasRole('admin', 'gerente');
  const TABS = { conta: 'Minha conta', ...(isAdmin ? { loja: 'Loja', regras: 'Vendas e taxas', equipe: 'Equipe', seguranca: 'Backup e auditoria' } : {}) };
  let tab = isAdmin ? 'loja' : 'conta';

  function render() {
    host.innerHTML = `
      <div class="view">
        ${head('Ajustes', `${Data.who().email || ''} · ${ROLES[Data.role()] || ''}`)}
        <div class="tabs" role="tablist">
          ${Object.entries(TABS).map(([k, v]) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${esc(v)}</button>`).join('')}
        </div>
        <div data-body></div>
      </div>`;
    ({ conta: drawAccount, loja: drawStore, regras: drawRules, equipe: drawTeam, seguranca: drawSecurity })[tab]($('[data-body]', host));
  }

  function drawStore(box) {
    const s = Data.settings();
    box.innerHTML = `
      <form class="card card-pad form-grid" data-store>
        ${field('Nome da loja', `<input class="input" name="store_name" value="${esc(s.store_name)}">`, 6)}
        ${field('Frase', `<input class="input" name="tagline" value="${esc(s.tagline)}">`, 6)}
        ${field('WhatsApp da loja (recebe os pedidos)', `<input class="input" name="whatsapp" inputmode="tel" value="${esc(maskPhone(s.whatsapp))}" placeholder="(44) 99999-0000">`, 6)}
        ${field('Instagram', `<input class="input" name="instagram" value="${esc(s.instagram)}" placeholder="@rota44">`, 6)}
        ${field('TikTok', `<input class="input" name="tiktok" value="${esc(s.tiktok)}">`, 6)}
        ${field('E-mail', `<input class="input" type="email" name="email" value="${esc(s.email)}">`, 6)}
        ${field('Endereço', `<input class="input" name="address" value="${esc(s.address)}">`, 8)}
        ${field('Horário', `<input class="input" name="hours" value="${esc(s.hours)}" placeholder="Seg a sáb, 9h às 19h">`, 4)}
        ${field('Chave Pix', `<input class="input" name="pix_key" value="${esc(s.pix_key)}">`, 6)}
        ${field('Nome no Pix', `<input class="input" name="pix_name" value="${esc(s.pix_name)}">`, 6)}
        ${field('Rodapé do comprovante', `<input class="input" name="receipt_footer" value="${esc(s.receipt_footer)}">`, 12)}
        <div class="span-12 row" style="justify-content:flex-end"><button type="button" class="btn btn-primary" data-save-store>Salvar</button></div>
      </form>`;
    const f = $('[data-store]', box);
    f.whatsapp.addEventListener('input', () => { f.whatsapp.value = maskPhone(f.whatsapp.value); });
  }

  function drawRules(box) {
    const s = Data.settings();
    box.innerHTML = `
      <form class="card card-pad col gap-5" data-rules>
        <div class="fieldset"><div class="fieldset-title">Desconto e estoque</div>
          <div class="form-grid">
            ${field('Limite do vendedor (%)', `<input class="input" name="discount_limit_vendedor" inputmode="decimal" value="${esc(s.discount_limit_vendedor)}">`, 4)}
            ${field('Limite do gerente (%)', `<input class="input" name="discount_limit_gerente" inputmode="decimal" value="${esc(s.discount_limit_gerente)}">`, 4)}
            ${field('Reserva de pedido online (horas)', `<input class="input" type="number" inputmode="numeric" min="1" name="reservation_hours" value="${esc(s.reservation_hours)}">`, 4)}
            <div class="span-12 col gap-2">
              ${switchField('block_negative_stock', 'Bloquear venda sem estoque', s.block_negative_stock)}
              ${switchField('require_cash_session', 'Exigir caixa aberto para receber em dinheiro', s.require_cash_session)}
            </div>
          </div>
        </div>
        <div class="fieldset"><div class="fieldset-title">Taxas da maquininha</div>
          <div class="form-grid">
            ${field('Débito (%)', `<input class="input" name="fee_debit_pct" inputmode="decimal" value="${esc(s.fee_debit_pct)}">`, 4)}
            ${field('Crédito à vista (%)', `<input class="input" name="fee_credit_pct" inputmode="decimal" value="${esc(s.fee_credit_pct)}">`, 4)}
            ${field('Crédito parcelado (%)', `<input class="input" name="fee_credit_inst_pct" inputmode="decimal" value="${esc(s.fee_credit_inst_pct)}">`, 4)}
            ${field('Débito cai em (dias)', `<input class="input" type="number" inputmode="numeric" min="0" name="debit_days" value="${esc(s.debit_days)}">`, 6)}
            ${field('Crédito cai em (dias)', `<input class="input" type="number" inputmode="numeric" min="0" name="credit_days" value="${esc(s.credit_days)}">`, 6)}
          </div>
        </div>
        <div class="fieldset"><div class="fieldset-title">Trocas</div>
          <div class="form-grid">
            ${field('Prazo de troca (dias)', `<input class="input" type="number" inputmode="numeric" min="0" name="exchange_days" value="${esc(s.exchange_days)}">`, 6)}
            ${field('Validade do vale-troca (dias)', `<input class="input" type="number" inputmode="numeric" min="0" name="credit_valid_days" value="${esc(s.credit_valid_days)}">`, 6, '0 = sem validade')}
          </div>
        </div>
        <div class="fieldset"><div class="fieldset-title">Preço sugerido</div>
          <div class="form-grid">
            ${field('Markup padrão (%)', `<input class="input" name="default_markup_pct" inputmode="decimal" value="${esc(s.default_markup_pct)}">`, 6)}
            ${field('Terminar em (centavos)', `<input class="input" name="round_prices_to" inputmode="decimal" value="${esc(s.round_prices_to)}">`, 6, 'Ex.: 0,90 para R$ 149,90')}
          </div>
        </div>
        <div class="row" style="justify-content:flex-end"><button type="button" class="btn btn-primary" data-save-rules>Salvar</button></div>
      </form>`;
  }

  async function drawTeam(box) {
    box.innerHTML = '<div class="spinner"></div>';
    try {
      const list = await Data.membersList();
      box.innerHTML = `
        <div class="col gap-3">
          <div class="alert" data-kind="info">${icon('info')}<div>Para incluir alguém: crie o login no painel do Supabase (<b>Authentication → Users → Add user</b>) e adicione aqui com o mesmo e-mail. Desativar não apaga o histórico de vendas.</div></div>
          ${table([
            { label: 'Nome', main: true, cell: (m) => `<div><span class="cell-primary">${esc(m.nome)}</span><span class="cell-sub">${esc(m.email)}</span></div>` },
            { label: 'Perfil', cell: (m) => badge(ROLES[m.role], m.role === 'admin' ? 'red' : m.role === 'gerente' ? 'blue' : 'gray') },
            { label: 'Comissão', right: true, cell: (m) => `<span class="num">${Number(m.commission_pct)}%</span>` },
            { label: 'Situação', cell: (m) => (m.active ? badge('Ativo', 'green') : badge('Desativado', 'gray')) },
          ], list, { rowAttr: (m) => `data-member='${esc(JSON.stringify(m))}'` })}
          <div><button class="btn btn-primary" data-add-member>${icon('plus')} Incluir na equipe</button></div>
        </div>`;
    } catch (err) {
      box.innerHTML = `<div class="alert" data-kind="warn">${icon('alert')}<div>${esc(friendlyError(err))}</div></div>`;
    }
  }

  function memberForm(m) {
    const modal = openModal({
      title: m ? `Editar ${m.nome}` : 'Incluir na equipe',
      body: `<form class="form-grid" data-f>
        ${m ? '' : field('E-mail do login', '<input class="input" name="email" type="email" data-autofocus>', 12)}
        ${field('Nome', `<input class="input" name="nome" value="${esc(m?.nome)}">`, 12)}
        ${field('Perfil', `<select class="select" name="role">${optionsMap(ROLES, m?.role || 'vendedor')}</select>`, 12)}
        ${field('Comissão (%)', `<input class="input" name="commission_pct" inputmode="decimal" value="${esc(m?.commission_pct ?? 0)}">`, 6)}
        ${field('Limite de desconto (%)', `<input class="input" name="discount_limit" inputmode="decimal" value="${esc(m?.discount_limit)}" placeholder="O do perfil">`, 6)}
        <div class="span-12">${switchField('active', 'Ativo', m ? m.active : true)}</div>
      </form>`,
      footer: '<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Salvar</button>',
    });
    const ok = modal.foot.querySelector('[data-ok]');
    ok.addEventListener('click', () => withLoading(ok, async () => {
      const v = readForm($('[data-f]', modal.panel));
      try {
        await Data.memberUpsert({
          user_id: m?.user_id, email: v.email, nome: v.nome, role: v.role, commission_pct: parseMoney(v.commission_pct),
          discount_limit: v.discount_limit === '' ? null : parseMoney(v.discount_limit), active: v.active,
        });
        modal.close();
        toast('Equipe atualizada');
        render();
      } catch (err) { toastError('Não consegui salvar', friendlyError(err)); }
    }));
  }

  function drawAccount(box) {
    const has = Data.who().has_pin;
    box.innerHTML = `
      <div class="col gap-4">
        <div class="card card-pad col gap-3">
          <div class="fieldset-title">Aparência</div>
          <div class="segmented" data-theme-choice>
            ${[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro']].map(([k, v]) => `<button data-set-theme="${k}" aria-pressed="${getTheme() === k}">${v}</button>`).join('')}
          </div>
        </div>
        <form class="card card-pad col gap-3" data-pw>
          <div class="fieldset-title">Trocar senha</div>
          <div class="form-grid">
            ${field('Senha nova', '<input class="input" type="password" name="a" autocomplete="new-password">', 6)}
            ${field('Repita', '<input class="input" type="password" name="b" autocomplete="new-password">', 6)}
          </div>
          <div><button type="button" class="btn" data-save-pw>Salvar senha</button></div>
        </form>
        ${isMgr ? `<div class="card card-pad col gap-3">
          <div class="fieldset-title">Senha de liberação de desconto ${has ? badge('Definida', 'green') : badge('Não definida', 'amber')}</div>
          <p class="small muted">O vendedor digita essa senha no PDV quando o desconto passa do limite dele. Ela fica registrada na venda.</p>
          <div class="link-box" style="max-width:320px"><input class="input" type="password" inputmode="numeric" data-pin placeholder="4 a 8 números" autocomplete="off"><button class="btn" data-save-pin>Salvar</button></div>
        </div>` : ''}
        <div class="card card-pad col gap-3">
          <div class="fieldset-title">Sessão</div>
          <div class="row gap-2" style="flex-wrap:wrap">
            <button class="btn" data-logout>${icon('logout')} Sair</button>
            <button class="btn btn-ghost" data-logout-all>Sair de todos os aparelhos</button>
          </div>
          <p class="xs dim">Rota 44 · versão ${esc(APP.version)}</p>
        </div>
      </div>`;
  }

  async function drawSecurity(box) {
    box.innerHTML = `
      <div class="col gap-4">
        <div class="card card-pad col gap-3">
          <div class="fieldset-title">Backup</div>
          <p class="small muted">Baixa uma cópia de tudo (JSON). O backup automático diário é configurado no GitHub: veja o README.</p>
          <div><button class="btn" data-backup>${icon('download')} Baixar backup agora</button></div>
        </div>
        <div class="card"><div class="card-head"><h3>Auditoria: últimas ações</h3></div><div class="card-body" data-audit><div class="spinner"></div></div></div>
        <div class="card"><div class="card-head"><h3>Diagnóstico: erros dos aparelhos</h3><button class="btn btn-ghost btn-sm" data-clear-errors>Limpar</button></div><div class="card-body" data-errors><div class="spinner"></div></div></div>
      </div>`;
    const LABEL = { store_settings: 'Configurações', store_members: 'Equipe', products: 'Produto', product_variants: 'Variação', coupons: 'Cupom', promotions: 'Promoção', bills: 'Conta', purchases: 'Compra', returns: 'Troca', sales: 'Venda' };
    const ACTION = { INSERT: 'criou', UPDATE: 'alterou', DELETE: 'apagou' };
    try {
      const rows = await Data.auditLog(80);
      $('[data-audit]', box).innerHTML = table([
        { label: 'Quando', main: true, cell: (r) => `<div><span class="cell-primary">${esc(LABEL[r.table_name] || r.table_name)}: ${esc(ACTION[r.action] || r.action)}</span><span class="cell-sub">${esc(formatDateTime(r.at))}</span></div>` },
        { label: 'Quem', cell: (r) => esc(r.user_id ? Data.memberName(r.user_id) : 'Sistema') },
        { label: 'O quê', cell: (r) => esc((r.after?.name || r.after?.description || r.after?.code || (r.after?.number ? `#${r.after.number}` : '') || r.before?.name || '').toString().slice(0, 60)) },
      ], rows, { empty: 'Nada registrado.' });
    } catch (err) { $('[data-audit]', box).textContent = friendlyError(err); }
    try {
      const rows = await Data.listErrors();
      $('[data-errors]', box).innerHTML = rows.length ? table([
        { label: 'Erro', main: true, cell: (r) => `<div><span class="cell-primary">${esc(r.message)}</span><span class="cell-sub">${esc(formatDateTime(r.created_at))} · ${esc(r.context?.source || 'sistema')}</span></div>` },
      ], rows) : '<p class="small dim">Nenhum erro. Boa!</p>';
    } catch (err) { $('[data-errors]', box).textContent = friendlyError(err); }
  }

  host.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; render(); return; }
    const save = e.target.closest('[data-save-store]');
    if (save) {
      withLoading(save, async () => {
        const v = readForm($('[data-store]', host));
        try { await Data.saveSettings({ ...v, whatsapp: onlyDigits(v.whatsapp) }); toast('Dados da loja salvos'); }
        catch (err) { toastError('Não consegui salvar', friendlyError(err)); }
      });
      return;
    }
    const rules = e.target.closest('[data-save-rules]');
    if (rules) {
      withLoading(rules, async () => {
        const v = readForm($('[data-rules]', host));
        const numeric = ['discount_limit_vendedor', 'discount_limit_gerente', 'fee_debit_pct', 'fee_credit_pct', 'fee_credit_inst_pct', 'default_markup_pct', 'round_prices_to'];
        const ints = ['reservation_hours', 'debit_days', 'credit_days', 'exchange_days', 'credit_valid_days'];
        const patch = { block_negative_stock: v.block_negative_stock, require_cash_session: v.require_cash_session };
        numeric.forEach((k) => { patch[k] = parseMoney(v[k]); });
        ints.forEach((k) => { patch[k] = Number(v[k]) || 0; });
        patch.reservation_hours = Math.max(patch.reservation_hours, 1);
        try { await Data.saveSettings(patch); toast('Regras salvas'); }
        catch (err) { toastError('Não consegui salvar', friendlyError(err)); }
      });
      return;
    }
    if (e.target.closest('[data-add-member]')) { memberForm(null); return; }
    const mb = e.target.closest('[data-member]');
    if (mb) { memberForm(JSON.parse(mb.dataset.member)); return; }
    const th = e.target.closest('[data-set-theme]');
    if (th) { applyTheme(th.dataset.setTheme); render(); return; }
    const pw = e.target.closest('[data-save-pw]');
    if (pw) {
      const a = host.querySelector('[name=a]').value;
      const b = host.querySelector('[name=b]').value;
      if (a.length < 8) { toast('Use pelo menos 8 caracteres', { kind: 'warn' }); return; }
      if (a !== b) { toast('As duas senhas estão diferentes', { kind: 'warn' }); return; }
      withLoading(pw, async () => {
        try { await updatePassword(a); toast('Senha trocada'); host.querySelector('[name=a]').value = ''; host.querySelector('[name=b]').value = ''; }
        catch (err) { toastError('Não consegui trocar', err.message); }
      });
      return;
    }
    const pin = e.target.closest('[data-save-pin]');
    if (pin) {
      withLoading(pin, async () => {
        try { await Data.setMyPin(host.querySelector('[data-pin]').value); toast('Senha de liberação salva'); render(); }
        catch (err) { toastError('Não consegui salvar', friendlyError(err)); }
      });
      return;
    }
    if (e.target.closest('[data-logout]')) { await signOut().catch(() => {}); return; }
    if (e.target.closest('[data-logout-all]')) {
      if (await confirmDialog({ title: 'Sair de todos os aparelhos?', message: 'Use se perdeu um celular ou a senha vazou.', confirmText: 'Sair de todos', danger: true })) {
        await signOutEverywhere().catch((err) => toastError('Não consegui', err.message));
      }
      return;
    }
    if (e.target.closest('[data-backup]')) {
      downloadFile(`backup-rota44-${todayISO()}.json`, JSON.stringify(Data.backupSnapshot()), 'application/json');
      toast('Backup baixado');
      return;
    }
    if (e.target.closest('[data-clear-errors]')) {
      try { await Data.clearErrors(); render(); } catch (err) { toastError('Não consegui limpar', friendlyError(err)); }
    }
  });

  render();
  return {};
}
