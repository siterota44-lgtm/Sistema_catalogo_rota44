/** Fornecedores: fabricante, confecção, estamparia, bordado, atacadista. */

import * as Data from '../core/data.js';
import { esc, maskPhone, onlyDigits, whatsappLink, money } from '../core/utils.js';
import { SUPPLIER_KINDS } from '../core/constants.js';
import { friendlyError } from '../core/errors.js';
import { icon } from './icons.js';
import { toast, toastError, openModal, withLoading } from './kit.js';
import { $, table, head, field, optionsMap, readForm, matches, switchField, badge, moneyHTML } from './common.js';

export function mount(host) {
  let q = '';
  host.innerHTML = `
    <div class="view">
      ${head('Fornecedores', '', `<button class="btn btn-primary" data-new>${icon('plus')} Novo fornecedor</button>`)}
      <div data-list></div>
    </div>`;
  function render() {
    const rows = Data.suppliers().filter((s) => matches(q, s.name, s.doc, s.contact, s.whatsapp));
    $('[data-list]', host).innerHTML = table([
      { label: 'Fornecedor', main: true, cell: (s) => `<div><span class="cell-primary">${esc(s.name)}</span><span class="cell-sub">${esc(SUPPLIER_KINDS[s.kind])}${s.contact ? ` · ${esc(s.contact)}` : ''}</span></div>` },
      { label: 'WhatsApp', cell: (s) => esc(maskPhone(s.whatsapp)) || '-' },
      { label: 'Prazo', cell: (s) => (s.lead_days != null ? `${s.lead_days} dias` : '-') },
      { label: 'Compras', right: true, cell: (s) => moneyHTML(Data.purchases().filter((p) => p.supplier_id === s.id && p.status !== 'cancelado').reduce((a, p) => a + Number(p.total), 0)) },
      { label: 'Nota', cell: (s) => (s.rating ? '★'.repeat(s.rating) : '-') },
      { label: 'Situação', cell: (s) => (s.active ? badge('Ativo', 'green') : badge('Inativo', 'gray')) },
    ], rows, { rowAttr: (s) => `data-edit="${esc(s.id)}"`, empty: 'Nenhum fornecedor cadastrado.' });
  }
  host.addEventListener('click', (e) => {
    if (e.target.closest('[data-new]')) { openSupplierForm(null); return; }
    const row = e.target.closest('[data-edit]');
    if (row) openSupplierForm(Data.supplier(row.dataset.edit));
  });
  render();
  return { onSearch(v) { q = v; render(); }, onData: render };
}

export function openSupplierForm(s, done) {
  const wa = s ? whatsappLink(s.whatsapp) : null;
  const m = openModal({
    title: s ? 'Editar fornecedor' : 'Novo fornecedor',
    size: 'lg',
    body: `
      <form class="form-grid" data-f>
        ${field('Nome / razão social', `<input class="input" name="name" value="${esc(s?.name)}" required data-autofocus>`, 8)}
        ${field('Tipo', `<select class="select" name="kind">${optionsMap(SUPPLIER_KINDS, s?.kind || 'fabricante')}</select>`, 4)}
        ${field('CNPJ / CPF', `<input class="input" name="doc" inputmode="numeric" value="${esc(s?.doc)}">`, 4)}
        ${field('Contato', `<input class="input" name="contact" value="${esc(s?.contact)}">`, 4)}
        ${field('WhatsApp', `<input class="input" name="whatsapp" inputmode="tel" value="${esc(maskPhone(s?.whatsapp || ''))}">`, 4)}
        ${field('E-mail', `<input class="input" type="email" name="email" value="${esc(s?.email)}">`, 6)}
        ${field('Endereço', `<input class="input" name="address" value="${esc(s?.address)}">`, 6)}
        ${field('Prazo de entrega (dias)', `<input class="input" type="number" inputmode="numeric" min="0" name="lead_days" value="${esc(s?.lead_days)}">`, 4)}
        ${field('Condição de pagamento', `<input class="input" name="payment_terms" value="${esc(s?.payment_terms)}" placeholder="30/60 dias">`, 4)}
        ${field('Avaliação (1 a 5)', `<input class="input" type="number" inputmode="numeric" min="1" max="5" name="rating" value="${esc(s?.rating)}">`, 4)}
        ${field('Observações', `<textarea class="textarea" name="notes" rows="2">${esc(s?.notes)}</textarea>`, 12)}
        <div class="span-12">${switchField('active', 'Ativo', s ? s.active : true)}</div>
      </form>`,
    footer: `${wa ? `<a class="btn btn-ghost" style="margin-right:auto" href="${esc(wa)}" target="_blank" rel="noopener">${icon('whatsapp')} WhatsApp</a>` : ''}
      <button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Salvar</button>`,
  });
  const form = $('[data-f]', m.panel);
  form.whatsapp.addEventListener('input', () => { form.whatsapp.value = maskPhone(form.whatsapp.value); });
  const ok = m.foot.querySelector('[data-ok]');
  ok.addEventListener('click', () => withLoading(ok, async () => {
    const v = readForm(form);
    if (!v.name) { toast('Informe o nome', { kind: 'warn' }); return; }
    try {
      const saved = await Data.saveRow('suppliers', {
        id: s?.id, name: v.name, kind: v.kind, doc: v.doc, contact: v.contact, whatsapp: onlyDigits(v.whatsapp), email: v.email, address: v.address,
        lead_days: v.lead_days === '' ? null : Number(v.lead_days), payment_terms: v.payment_terms, rating: v.rating === '' ? null : Number(v.rating), notes: v.notes, active: v.active,
      });
      m.close();
      toast('Fornecedor salvo');
      done?.(saved);
    } catch (err) { toastError('Não consegui salvar', friendlyError(err)); }
  }));
}
