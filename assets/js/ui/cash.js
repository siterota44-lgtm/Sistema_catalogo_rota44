/** Caixa da loja: abertura, sangria, suprimento e fechamento conferido por forma. */

import * as Data from '../core/data.js';
import { esc, money, parseMoney, formatDateTime } from '../core/utils.js';
import { PAYMENT_METHODS } from '../core/constants.js';
import { friendlyError } from '../core/errors.js';
import { icon } from './icons.js';
import { toast, toastError, openModal, withLoading } from './kit.js';
import { $, moneyHTML, badge, table, head, field, moneyInput, emptyBox } from './common.js';

export function openCashOpen(done) {
  const m = openModal({
    title: 'Abrir caixa',
    body: `<div class="form-grid">${field('Dinheiro na gaveta agora', moneyInput('amount', '', 'data-autofocus'), 12, 'O troco que está no caixa ao começar.')}</div>`,
    footer: '<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Abrir caixa</button>',
  });
  const ok = m.foot.querySelector('[data-ok]');
  ok.addEventListener('click', () => withLoading(ok, async () => {
    try {
      const r = await Data.openCash({ opening_amount: parseMoney(m.panel.querySelector('[name=amount]').value) });
      m.close();
      toast(`Caixa #${r.number} aberto`);
      done?.();
    } catch (err) { toastError('Não consegui abrir', friendlyError(err)); }
  }));
}

export function mount(host) {
  let summary = null;

  async function loadSummary() {
    const open = Data.myOpenCash();
    summary = open ? await Data.cashSummary(open.id).catch(() => null) : null;
    render();
  }

  function render() {
    const open = Data.myOpenCash();
    const closed = Data.cashSessions().filter((c) => c.closed_at).slice(0, 20);
    const others = Data.cashSessions().filter((c) => !c.closed_at && c.opened_by !== Data.who().user_id);
    host.innerHTML = `
      <div class="view">
        ${head('Caixa', open ? `Aberto às ${formatDateTime(open.opened_at)}` : 'Fechado', open ? `
          <button class="btn" data-move="suprimento">${icon('plus')} Suprimento</button>
          <button class="btn" data-move="sangria">${icon('minus')} Sangria</button>
          <button class="btn btn-primary" data-close-cash>${icon('lock')} Fechar caixa</button>` : `<button class="btn btn-primary" data-open>${icon('cash')} Abrir caixa</button>`)}
        ${open && summary ? `
          <div class="grid grid-kpi">
            <div class="kpi"><span class="kpi-label">Dinheiro na gaveta</span><span class="kpi-value sm money-sensitive">${esc(money(summary.dinheiro))}</span></div>
            <div class="kpi"><span class="kpi-label">Pix</span><span class="kpi-value sm money-sensitive">${esc(money(summary.pix))}</span></div>
            <div class="kpi"><span class="kpi-label">Débito</span><span class="kpi-value sm money-sensitive">${esc(money(summary.debito))}</span></div>
            <div class="kpi"><span class="kpi-label">Crédito</span><span class="kpi-value sm money-sensitive">${esc(money(summary.credito))}</span></div>
          </div>
          ${Data.cashMovements(open.id).length ? `<div>${table([
            { label: 'Movimento', main: true, cell: (c) => `<div><span class="cell-primary">${c.type === 'sangria' ? 'Sangria' : 'Suprimento'}</span><span class="cell-sub">${esc(formatDateTime(c.created_at))} · ${esc(c.reason)}</span></div>` },
            { label: 'Valor', right: true, cell: (c) => moneyHTML(c.type === 'sangria' ? -c.amount : c.amount) },
          ], Data.cashMovements(open.id))}</div>` : ''}` : ''}
        ${!open ? `<div class="card">${emptyBox('Caixa fechado', 'Abra antes de receber em dinheiro. Pix e cartão também entram na conferência do dia.')}</div>` : ''}
        ${others.length ? `<div class="alert" data-kind="info">${icon('info')}<div>Caixa aberto também por: ${esc(others.map((c) => Data.memberName(c.opened_by)).join(', '))}</div></div>` : ''}
        <div>
          <div class="fieldset-title" style="margin-bottom:6px">Fechamentos</div>
          ${table([
            { label: 'Caixa', main: true, cell: (c) => `<div><span class="cell-primary">#${c.number} · ${esc(Data.memberName(c.opened_by))}</span><span class="cell-sub">${esc(formatDateTime(c.opened_at))} até ${esc(formatDateTime(c.closed_at))}</span></div>` },
            { label: 'Esperado', right: true, cell: (c) => moneyHTML(c.expected?.dinheiro || 0) },
            { label: 'Contado', right: true, cell: (c) => moneyHTML(c.counted?.dinheiro || 0) },
            { label: 'Diferença', right: true, cell: (c) => { const d = Number(c.difference || 0); return Math.abs(d) < 0.005 ? badge('Bateu', 'green') : `<b class="num money-sensitive ${d < 0 ? 'tone-danger' : 'tone-ok'}">${esc(money(d))}</b>`; } },
          ], closed, { empty: 'Nenhum caixa fechado ainda.' })}
        </div>
      </div>`;
  }

  host.addEventListener('click', (e) => {
    if (e.target.closest('[data-open]')) { openCashOpen(loadSummary); return; }
    const mv = e.target.closest('[data-move]');
    if (mv) { openMove(mv.dataset.move); return; }
    if (e.target.closest('[data-close-cash]')) openClose();
  });

  function openMove(type) {
    const open = Data.myOpenCash();
    const m = openModal({
      title: type === 'sangria' ? 'Sangria (retirada)' : 'Suprimento (reforço)',
      body: `<div class="form-grid">
        ${field('Valor', moneyInput('amount', '', 'data-autofocus'), 12)}
        ${field('Motivo (obrigatório)', `<input class="input" name="reason" placeholder="${type === 'sangria' ? 'Depósito no banco' : 'Troco'}">`, 12)}
      </div>`,
      footer: '<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Lançar</button>',
    });
    const ok = m.foot.querySelector('[data-ok]');
    ok.addEventListener('click', () => withLoading(ok, async () => {
      const amount = parseMoney(m.panel.querySelector('[name=amount]').value);
      const reason = m.panel.querySelector('[name=reason]').value.trim();
      if (!amount || !reason) { toast('Preencha valor e motivo', { kind: 'warn' }); return; }
      try {
        await Data.cashMove({ session_id: open.id, type, amount, reason });
        m.close();
        toast('Lançado');
        loadSummary();
      } catch (err) { toastError('Não consegui lançar', friendlyError(err)); }
    }));
  }

  async function openClose() {
    const open = Data.myOpenCash();
    const exp = await Data.cashSummary(open.id);
    const methods = ['dinheiro', 'pix', 'debito', 'credito'];
    const m = openModal({
      title: 'Fechar caixa',
      subtitle: 'Conte a gaveta e confira os comprovantes',
      body: `<div class="form-grid">
        ${methods.map((k) => field(`${PAYMENT_METHODS[k].label} (esperado ${money(exp[k])})`, moneyInput(k, k === 'dinheiro' ? '' : exp[k], k === 'dinheiro' ? 'data-autofocus' : ''), 6)).join('')}
        ${field('Observação', '<input class="input" name="notes">', 12)}
      </div>`,
      footer: '<button class="btn" data-close>Voltar</button><button class="btn btn-primary" data-ok>Fechar caixa</button>',
    });
    const ok = m.foot.querySelector('[data-ok]');
    ok.addEventListener('click', () => withLoading(ok, async () => {
      const counted = Object.fromEntries(methods.map((k) => [k, parseMoney(m.panel.querySelector(`[name=${k}]`).value)]));
      try {
        const r = await Data.closeCash({ session_id: open.id, counted, notes: m.panel.querySelector('[name=notes]').value });
        m.close();
        const d = Number(r.difference);
        toast(Math.abs(d) < 0.005 ? 'Caixa fechado: bateu!' : `Caixa fechado com diferença de ${money(d)}`, { kind: Math.abs(d) < 0.005 ? 'success' : 'warn' });
        summary = null;
        render();
      } catch (err) { toastError('Não consegui fechar', friendlyError(err)); }
    }));
  }

  render();
  loadSummary();
  return { onData() { if (!$('dialog.modal[open]')) loadSummary(); } };
}
