/** Clientes (CRM): histórico, tamanhos preferidos, segmentos e LGPD. */

import * as Data from '../core/data.js';
import { esc, money, formatDate, todayISO, addDays, maskPhone, maskCEP, onlyDigits, whatsappLink, downloadFile } from '../core/utils.js';
import { friendlyError } from '../core/errors.js';
import { icon } from './icons.js';
import { toast, toastError, openModal, withLoading, confirmDialog } from './kit.js';
import { $, $$, moneyHTML, table, head, field, matches, paged, exportCSV, readForm, code, badge, emptyBox, checkbox } from './common.js';
import { openSale, statusBadge } from './sales.js';

const SEGMENTS = {
  '': 'Todos',
  vip: 'VIP',
  recorrente: 'Recorrentes',
  inativo: 'Inativos há 90 dias',
  aniversario: 'Aniversariantes do mês',
  marketing: 'Aceitam marketing',
};

/** VIP: os 10% que mais gastaram (mínimo de 3 clientes para a régua fazer sentido). */
function vipCut(stats) {
  const totals = [...stats.values()].map((s) => s.total).sort((a, b) => b - a);
  if (totals.length < 3) return Infinity;
  return totals[Math.max(0, Math.ceil(totals.length * 0.1) - 1)];
}

export function mount(host) {
  let q = '';
  let seg = '';
  let limit = 50;

  host.innerHTML = `
    <div class="view">
      ${head('Clientes', '', `<button class="btn" data-export>${icon('download')} CSV</button><button class="btn btn-primary" data-new>${icon('plus')} Novo cliente</button>`)}
      <div class="toolbar">
        <div class="segmented" style="flex-wrap:wrap">
          ${Object.entries(SEGMENTS).map(([k, v]) => `<button data-seg="${k}" aria-pressed="${k === ''}">${esc(v)}</button>`).join('')}
        </div>
      </div>
      <div data-list></div>
    </div>`;

  function filtered() {
    const stats = Data.customerStats();
    const cut = vipCut(stats);
    const inactive = todayISO(addDays(new Date(), -90));
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    return Data.customers().filter((c) => {
      if (!matches(q, c.name, c.phone, onlyDigits(c.phone), c.cpf, c.email, c.instagram)) return false;
      const st = stats.get(c.id);
      if (seg === 'vip' && !(st && st.total >= cut)) return false;
      if (seg === 'recorrente' && !(st && st.count >= 2)) return false;
      if (seg === 'inativo' && !(st && st.last < inactive)) return false;
      if (seg === 'aniversario' && !(c.birthday && c.birthday.slice(5, 7) === month)) return false;
      if (seg === 'marketing' && !c.marketing_consent) return false;
      return true;
    });
  }

  function render() {
    const stats = Data.customerStats();
    const { shown, more } = paged(filtered(), limit);
    $('[data-list]', host).innerHTML = table([
      { label: 'Cliente', main: true, cell: (c) => `<div><span class="cell-primary">${esc(c.name)}</span><span class="cell-sub">${esc(maskPhone(c.phone))}${c.instagram ? ` · ${esc(c.instagram)}` : ''}</span></div>` },
      { label: 'Compras', right: true, cell: (c) => `<span class="num">${stats.get(c.id)?.count || 0}</span>` },
      { label: 'Total', right: true, cell: (c) => moneyHTML(stats.get(c.id)?.total || 0) },
      { label: 'Última', cell: (c) => (stats.get(c.id)?.last ? esc(formatDate(stats.get(c.id).last)) : '<span class="dim">-</span>') },
      { label: 'Tamanhos', cell: (c) => esc([c.size_top, c.size_bottom, c.size_shoes].filter(Boolean).join(' / ') || '-') },
    ], shown, { rowAttr: (c) => `data-open="${esc(c.id)}"`, empty: 'Nenhum cliente nesse filtro.' }) + more;
  }

  host.addEventListener('click', (e) => {
    const sb = e.target.closest('[data-seg]');
    if (sb) {
      seg = sb.dataset.seg;
      $$('[data-seg]', host).forEach((b) => b.setAttribute('aria-pressed', String(b === sb)));
      render();
      return;
    }
    if (e.target.closest('[data-new]')) { openCustomerForm(null); return; }
    if (e.target.closest('[data-more]')) { limit += 50; render(); return; }
    if (e.target.closest('[data-export]')) {
      const stats = Data.customerStats();
      exportCSV(`clientes-rota44-${todayISO()}.csv`, filtered().map((c) => ({
        nome: c.name, telefone: c.phone, email: c.email, cpf: c.cpf, instagram: c.instagram, aniversario: c.birthday || '',
        compras: stats.get(c.id)?.count || 0, total: stats.get(c.id)?.total || 0, ultima: stats.get(c.id)?.last || '', marketing: c.marketing_consent ? 'sim' : 'não',
      })));
      return;
    }
    const row = e.target.closest('[data-open]');
    if (row) openCustomer(row.dataset.open);
  });

  render();
  return { onSearch(v) { q = v; limit = 50; render(); }, onData: render };
}

export function openCustomerForm(c, done) {
  const m = openModal({
    title: c ? 'Editar cliente' : 'Novo cliente',
    size: 'lg',
    body: `
      <form class="form-grid" data-f>
        ${field('Nome', `<input class="input" name="name" value="${esc(c?.name)}" required data-autofocus>`, 12)}
        ${field('WhatsApp', `<input class="input" name="phone" inputmode="tel" value="${esc(maskPhone(c?.phone || ''))}">`, 6)}
        ${field('CPF', `<input class="input" name="cpf" inputmode="numeric" value="${esc(c?.cpf)}">`, 6, 'Opcional. Necessário para nota e limite por drop.')}
        ${field('E-mail', `<input class="input" name="email" type="email" value="${esc(c?.email)}">`, 6)}
        ${field('Instagram', `<input class="input" name="instagram" value="${esc(c?.instagram)}">`, 6)}
        ${field('Nascimento', `<input class="input" name="birthday" type="date" value="${esc(c?.birthday)}">`, 6)}
        ${field('CEP', `<input class="input" name="cep" inputmode="numeric" value="${esc(c?.cep)}">`, 6)}
        ${field('Endereço', `<input class="input" name="address" value="${esc(c?.address)}">`, 8)}
        ${field('Cidade', `<input class="input" name="city" value="${esc(c?.city)}">`, 4)}
        ${field('Tamanho de cima', `<input class="input" name="size_top" value="${esc(c?.size_top)}" placeholder="G">`, 4)}
        ${field('Tamanho de baixo', `<input class="input" name="size_bottom" value="${esc(c?.size_bottom)}" placeholder="42">`, 4)}
        ${field('Calçado', `<input class="input" name="size_shoes" value="${esc(c?.size_shoes)}" placeholder="41">`, 4)}
        ${field('Observações', `<textarea class="textarea" name="notes" rows="2">${esc(c?.notes)}</textarea>`, 12)}
        <div class="span-12">${checkbox('marketing_consent', 'Aceita receber novidades e promoções (LGPD)', c?.marketing_consent)}</div>
      </form>`,
    footer: `
      ${c ? '<button class="btn btn-ghost" data-anon style="margin-right:auto">Apagar dados (LGPD)</button>' : ''}
      <button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Salvar</button>`,
  });
  const form = $('[data-f]', m.panel);
  form.phone.addEventListener('input', () => { form.phone.value = maskPhone(form.phone.value); });
  form.cep.addEventListener('input', () => { form.cep.value = maskCEP(form.cep.value); });

  const ok = m.foot.querySelector('[data-ok]');
  ok.addEventListener('click', () => withLoading(ok, async () => {
    const v = readForm(form);
    if (!v.name) { toast('Informe o nome', { kind: 'warn' }); return; }
    const consentNow = v.marketing_consent && !c?.marketing_consent;
    const row = {
      id: c?.id,
      name: v.name, phone: onlyDigits(v.phone), cpf: onlyDigits(v.cpf), email: v.email, instagram: v.instagram,
      birthday: v.birthday || null, cep: v.cep, address: v.address, city: v.city,
      size_top: v.size_top, size_bottom: v.size_bottom, size_shoes: v.size_shoes, notes: v.notes,
      marketing_consent: v.marketing_consent,
      ...(consentNow ? { consent_at: new Date().toISOString(), consent_channel: 'sistema' } : {}),
    };
    try {
      const saved = await Data.saveRow('customers', row);
      m.close();
      toast('Cliente salvo');
      done?.(saved);
    } catch (err) {
      toastError('Não consegui salvar', friendlyError(err));
    }
  }));

  m.foot.querySelector('[data-anon]')?.addEventListener('click', async () => {
    const yes = await confirmDialog({
      title: 'Apagar os dados pessoais deste cliente?',
      message: 'Nome, telefone, CPF, e-mail e endereço somem para sempre. As vendas continuam nos relatórios, sem identificação.',
      confirmText: 'Apagar dados', danger: true,
    });
    if (!yes) return;
    try {
      await Data.saveRow('customers', {
        id: c.id, name: 'Cliente removido', phone: '', cpf: '', email: '', instagram: '', birthday: null, cep: '', address: '', city: '',
        notes: '', marketing_consent: false, deleted_at: new Date().toISOString(),
      });
      m.close();
      toast('Dados apagados');
      done?.(null);
    } catch (err) { toastError('Não consegui apagar', friendlyError(err)); }
  });
}

function openCustomer(id) {
  const m = openModal({ title: 'Cliente', size: 'lg', body: '<div data-c></div>', footer: '<div data-a class="row gap-2" style="flex-wrap:wrap;justify-content:flex-end;width:100%"></div>' });
  const draw = () => {
    const c = Data.customer(id);
    if (!c) { m.close(); return; }
    const sales = Data.sales().filter((s) => s.customer_id === id);
    const valid = sales.filter((s) => s.status !== 'cancelado');
    const total = valid.reduce((sum, s) => sum + Number(s.total) - Number(s.returned_total), 0);
    const credits = Data.storeCredits().filter((x) => x.customer_id === id && Number(x.balance) > 0);
    m.panel.querySelector('.modal-head h2').textContent = c.name;
    $('[data-c]', m.panel).innerHTML = `
      <div class="col gap-5">
        <div class="grid grid-kpi">
          <div class="kpi"><span class="kpi-label">Total gasto</span><span class="kpi-value sm money-sensitive">${esc(money(total))}</span></div>
          <div class="kpi"><span class="kpi-label">Compras</span><span class="kpi-value sm">${valid.length}</span></div>
          <div class="kpi"><span class="kpi-label">Ticket médio</span><span class="kpi-value sm money-sensitive">${esc(money(valid.length ? total / valid.length : 0))}</span></div>
        </div>
        <dl class="kv">
          <div><dt>WhatsApp</dt><dd>${esc(maskPhone(c.phone)) || '-'}</dd></div>
          <div><dt>E-mail</dt><dd>${esc(c.email) || '-'}</dd></div>
          <div><dt>Instagram</dt><dd>${esc(c.instagram) || '-'}</dd></div>
          <div><dt>Nascimento</dt><dd>${c.birthday ? esc(formatDate(c.birthday)) : '-'}</dd></div>
          <div><dt>Tamanhos</dt><dd>${esc([c.size_top, c.size_bottom, c.size_shoes].filter(Boolean).join(' / ')) || '-'}</dd></div>
          <div><dt>Marketing</dt><dd>${c.marketing_consent ? `Aceitou${c.consent_at ? ` em ${esc(formatDate(c.consent_at))}` : ''}` : 'Não aceitou'}</dd></div>
          ${c.address ? `<div><dt>Endereço</dt><dd>${esc(c.address)} ${esc(c.city)}</dd></div>` : ''}
          ${c.notes ? `<div><dt>Observações</dt><dd>${esc(c.notes)}</dd></div>` : ''}
        </dl>
        ${credits.length ? `<div class="alert" data-kind="info">${icon('tag')}<div>Vale-troca com saldo: ${credits.map((x) => `<b class="sku">${esc(x.code)}</b> ${esc(money(x.balance))}`).join(' · ')}</div></div>` : ''}
        <div>
          <div class="fieldset-title" style="margin-bottom:6px">Compras</div>
          ${table([
            { label: 'Venda', main: true, cell: (s) => `<div><span class="cell-primary">${esc(code(s.number))}</span><span class="cell-sub">${esc(formatDate(s.sale_date))}</span></div>` },
            { label: 'Situação', cell: (s) => statusBadge(s.status) },
            { label: 'Total', right: true, cell: (s) => moneyHTML(s.total) },
          ], sales.slice(0, 30), { rowAttr: (s) => `data-sale="${esc(s.id)}"`, empty: 'Nenhuma compra ainda.' })}
        </div>
      </div>`;
    const wa = whatsappLink(c.phone);
    $('[data-a]', m.foot).innerHTML = `
      <button class="btn btn-ghost" data-export-one>${icon('download')} Exportar dados</button>
      ${wa ? `<a class="btn" href="${esc(wa)}" target="_blank" rel="noopener">${icon('whatsapp')} WhatsApp</a>` : ''}
      <button class="btn btn-primary" data-edit>${icon('edit')} Editar</button>`;
  };
  m.panel.addEventListener('click', (e) => {
    const s = e.target.closest('[data-sale]');
    if (s) { openSale(s.dataset.sale); return; }
    if (e.target.closest('[data-edit]')) { openCustomerForm(Data.customer(id), () => draw()); return; }
    if (e.target.closest('[data-export-one]')) {
      const c = Data.customer(id);
      const out = { cliente: c, compras: Data.sales().filter((x) => x.customer_id === id).map((x) => ({ ...x, itens: Data.saleItems(x.id) })) };
      downloadFile(`cliente-${id.slice(0, 8)}.json`, JSON.stringify(out, null, 2), 'application/json');
    }
  });
  draw();
}

/** Escolher (ou cadastrar na hora) o cliente da venda. */
export function pickCustomer(onPick) {
  const m = openModal({
    title: 'Cliente da venda',
    size: 'lg',
    sheet: true,
    body: `
      <div class="col gap-3">
        <input class="input" data-q placeholder="Nome, telefone ou CPF" autocomplete="off" data-autofocus>
        <div data-list></div>
      </div>`,
    footer: '<button class="btn" data-none>Venda sem cadastro</button><button class="btn btn-primary" data-new>Cadastrar novo</button>',
  });
  const draw = (q) => {
    const list = Data.customers().filter((c) => matches(q, c.name, c.phone, onlyDigits(c.phone), c.cpf)).slice(0, 20);
    $('[data-list]', m.panel).innerHTML = list.length ? `<div class="mobile-list">${list.map((c) => `
      <button class="m-row link-like" data-id="${esc(c.id)}" style="width:100%">
        <span class="m-main"><span class="m-title">${esc(c.name)}</span><span class="m-sub">${esc(maskPhone(c.phone))}${c.size_top ? ` · veste ${esc(c.size_top)}` : ''}</span></span>
      </button>`).join('')}</div>` : emptyBox('Ninguém com esse nome', 'Use "Cadastrar novo".');
  };
  m.panel.addEventListener('input', (e) => { if (e.target.matches('[data-q]')) draw(e.target.value); });
  m.panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (b) { m.close(); onPick(Data.customer(b.dataset.id)); return; }
    if (e.target.closest('[data-none]')) { m.close(); onPick(null); return; }
    if (e.target.closest('[data-new]')) {
      openCustomerForm(null, (saved) => { m.close(); onPick(saved); });
    }
  });
  draw('');
}
