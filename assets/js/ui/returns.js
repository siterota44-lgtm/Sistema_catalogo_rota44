/** Trocas, devoluções e vale-troca. Tamanho errado é o motivo nº 1 em loja de roupa. */

import * as Data from '../core/data.js';
import { esc, money, formatDate, relativeDate, todayISO } from '../core/utils.js';
import { RETURN_REASONS, PAYMENT_METHODS } from '../core/constants.js';
import { friendlyError } from '../core/errors.js';
import { icon } from './icons.js';
import { toast, toastError, openModal, withLoading } from './kit.js';
import { $, $$, moneyHTML, badge, table, head, field, optionsMap, matches, code, emptyBox } from './common.js';
import { openSale } from './sales.js';

export function mount(host) {
  let tab = 'trocas';
  let q = '';

  function render() {
    const rets = Data.returns().filter((r) => {
      const s = Data.sale(r.sale_id);
      return matches(q, String(r.number), s?.customer_name, String(s?.number || ''));
    });
    const credits = Data.storeCredits().filter((c) => matches(q, c.code, Data.customer(c.customer_id)?.name));
    host.innerHTML = `
      <div class="view">
        ${head('Trocas e devoluções', '', `<button class="btn btn-primary" data-new>${icon('plus')} Nova troca</button>`)}
        <div class="tabs" role="tablist">
          <button role="tab" data-tab="trocas" aria-selected="${tab === 'trocas'}">Trocas e devoluções</button>
          <button role="tab" data-tab="vales" aria-selected="${tab === 'vales'}">Vale-troca</button>
        </div>
        ${tab === 'trocas' ? table([
          { label: 'Nº', main: true, cell: (r) => { const s = Data.sale(r.sale_id); return `<div><span class="cell-primary">#${r.number} · ${esc(s?.customer_name || 'Sem cadastro')}</span><span class="cell-sub">Venda ${esc(code(s?.number))} · ${esc(relativeDate(r.created_at))}</span></div>`; } },
          { label: 'Tipo', cell: (r) => badge(r.kind === 'troca' ? 'Troca' : 'Devolução', r.kind === 'troca' ? 'blue' : 'amber') },
          { label: 'Motivo', cell: (r) => esc(RETURN_REASONS[r.reason] || r.reason) },
          { label: 'Peças', cell: (r) => esc(Data.returnItems(r.id).map((i) => { const si = Data.allSaleItems().find((x) => x.id === i.sale_item_id); return `${i.qty}× ${si?.product_name || ''} ${si?.size_label || ''}${i.condition === 'avaria' ? ' (avaria)' : ''}`; }).join(', ')) },
          { label: 'Valor', right: true, cell: (r) => moneyHTML(r.amount, 'strong') },
        ], rets, { rowAttr: (r) => `data-open="${esc(r.sale_id)}"`, empty: 'Nenhuma troca registrada.' })
        : table([
          { label: 'Código', main: true, cell: (c) => `<div><span class="cell-primary sku">${esc(c.code)}</span><span class="cell-sub">${esc(c.notes)}</span></div>` },
          { label: 'Cliente', cell: (c) => esc(Data.customer(c.customer_id)?.name || 'Sem cadastro') },
          { label: 'Valor', right: true, cell: (c) => moneyHTML(c.amount) },
          { label: 'Saldo', right: true, cell: (c) => moneyHTML(c.balance, Number(c.balance) > 0 ? 'strong' : 'dim') },
          { label: 'Validade', cell: (c) => (c.expires_on ? `<span class="${c.expires_on < todayISO() ? 'tone-danger' : ''}">${esc(formatDate(c.expires_on))}</span>` : 'Sem validade') },
        ], credits, { empty: 'Nenhum vale-troca emitido.' })}
      </div>`;
  }

  host.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; render(); return; }
    if (e.target.closest('[data-new]')) { openPickSale(); return; }
    const row = e.target.closest('[data-open]');
    if (row) openSale(row.dataset.open);
  });

  render();
  return { onSearch(v) { q = v; render(); }, onData: render };
}

function openPickSale() {
  const m = openModal({
    title: 'Qual foi a venda?',
    size: 'lg',
    body: `
      <div class="col gap-3">
        <input class="input" data-q placeholder="Número da venda, cliente ou telefone" data-autofocus autocomplete="off">
        <div data-list></div>
      </div>`,
  });
  const draw = (q) => {
    const list = Data.sales().filter((s) => s.status !== 'cancelado' && s.stock_state === 'out' && matches(q, String(s.number), s.customer_name, s.customer_phone)).slice(0, 12);
    $('[data-list]', m.panel).innerHTML = list.length ? `<div class="mobile-list">${list.map((s) => `
      <button class="m-row link-like" data-sale="${esc(s.id)}" style="width:100%">
        <span class="m-main"><span class="m-title">${esc(code(s.number))} ${esc(s.customer_name || 'Sem cadastro')}</span>
          <span class="m-sub">${esc(formatDate(s.sale_date))} · ${Data.saleItems(s.id).reduce((a, i) => a + i.qty, 0)} peças</span></span>
        <span class="m-side">${moneyHTML(s.total)}</span>
      </button>`).join('')}</div>` : emptyBox('Nada encontrado');
  };
  m.panel.addEventListener('input', (e) => { if (e.target.matches('[data-q]')) draw(e.target.value); });
  m.panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sale]');
    if (b) { m.close(); openReturnForm(b.dataset.sale); }
  });
  draw('');
}

export function openReturnForm(saleId, done) {
  const s = Data.sale(saleId);
  const items = Data.saleItems(saleId).filter((i) => i.qty - i.returned_qty > 0);
  if (!items.length) { toast('Todas as peças desta venda já voltaram', { kind: 'info' }); return; }
  const m = openModal({
    title: `Troca / devolução · venda ${code(s.number)}`,
    subtitle: s.customer_name || 'Sem cadastro',
    size: 'lg',
    body: `
      <div class="col gap-4">
        <div class="segmented" data-kind role="group" aria-label="Tipo">
          <button type="button" data-k="troca" aria-pressed="true">Troca (gera vale)</button>
          <button type="button" data-k="devolucao" aria-pressed="false">Devolução (volta o dinheiro)</button>
        </div>
        <div class="col gap-2">
          ${items.map((i) => `
            <div class="card card-pad" data-item="${esc(i.id)}" style="padding:10px 12px">
              <div class="row-between" style="flex-wrap:wrap"><div><b>${esc(i.product_name)}</b> <span class="small dim">${esc(i.color_name)} ${esc(i.size_label)}</span></div>
                <span class="small money-sensitive">${esc(money(i.total / i.qty))} cada</span></div>
              <div class="row gap-3" style="margin-top:8px;flex-wrap:wrap">
                <label class="row gap-2 small">Devolver
                  <select class="select" name="qty" style="width:auto">${Array.from({ length: i.qty - i.returned_qty + 1 }, (_, n) => `<option value="${n}">${n}</option>`).join('')}</select>
                </label>
                <label class="row gap-2 small">Estado
                  <select class="select" name="cond" style="width:auto"><option value="vendavel">Pode vender</option><option value="avaria">Com defeito (avaria)</option></select>
                </label>
              </div>
            </div>`).join('')}
        </div>
        <div class="form-grid">
          ${field('Motivo', `<select class="select" name="reason">${optionsMap(RETURN_REASONS, 'tamanho')}</select>`, 6)}
          <div class="field span-6" data-refund hidden><label class="label">Como devolveu</label>
            <select class="select" name="refund">${optionsMap({ pix: 'Pix', dinheiro: 'Dinheiro', credito: 'Estorno no cartão', debito: 'Estorno no débito', outro: 'Outro' }, 'pix')}</select></div>
          ${field('Observação', '<input class="input" name="notes">', 12)}
        </div>
      </div>`,
    footer: '<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Confirmar</button>',
  });
  let kind = 'troca';
  m.panel.addEventListener('click', (e) => {
    const k = e.target.closest('[data-k]');
    if (!k) return;
    kind = k.dataset.k;
    $$('[data-k]', m.panel).forEach((b) => b.setAttribute('aria-pressed', String(b === k)));
    $('[data-refund]', m.panel).hidden = kind !== 'devolucao';
  });
  const ok = m.foot.querySelector('[data-ok]');
  ok.addEventListener('click', () => withLoading(ok, async () => {
    const picked = $$('[data-item]', m.panel).map((el) => ({
      sale_item_id: el.dataset.item,
      qty: Number($('[name=qty]', el).value),
      condition: $('[name=cond]', el).value,
    })).filter((x) => x.qty > 0);
    if (!picked.length) { toast('Escolha ao menos uma peça', { kind: 'warn' }); return; }
    try {
      const r = await Data.createReturn({
        sale_id: saleId, kind,
        reason: $('[name=reason]', m.panel).value,
        notes: $('[name=notes]', m.panel).value,
        refund_method: kind === 'devolucao' ? $('[name=refund]', m.panel).value : null,
        date: todayISO(),
        items: picked,
      });
      m.close();
      done?.();
      if (r.credit_code) {
        openModal({
          title: 'Vale-troca gerado',
          subtitle: `Valor: ${money(r.amount)}`,
          body: `<p class="pay-big sku" style="font-size:2rem">${esc(r.credit_code)}</p>
            <p class="small muted" style="text-align:center;margin-top:8px">Passe este código no PDV, em Receber → Vale-troca.</p>`,
          footer: '<button class="btn btn-primary" data-close>Pronto</button>',
        });
      } else {
        toast('Devolução registrada', { text: `${money(r.amount)} estornado` });
      }
    } catch (err) {
      toastError('Não consegui registrar', friendlyError(err));
    }
  }));
}
