/** Promoções (preço por categoria, coleção, produto ou loja) e cupons. */

import * as Data from '../core/data.js';
import { esc, money, parseMoney, formatDate, todayISO } from '../core/utils.js';
import { friendlyError } from '../core/errors.js';
import { icon } from './icons.js';
import { toast, toastError, openModal, withLoading, confirmDialog } from './kit.js';
import { $, table, head, field, options, optionsMap, readForm, switchField, badge, moneyInput, categoryOptions } from './common.js';

const TARGETS = { tudo: 'Loja toda', categoria: 'Categoria', colecao: 'Drop / coleção', produto: 'Produto' };
// no fuso do aparelho: sem isso a promoção acabava às 21 h do último dia
const toDate = (iso) => (iso ? todayISO(new Date(iso)) : '');
const dateStart = (d) => (d ? new Date(`${d}T00:00:00`).toISOString() : null);
const dateEnd = (d) => (d ? new Date(`${d}T23:59:59`).toISOString() : null);

function windowBadge(x) {
  const now = new Date();
  if (!x.active) return badge('Desligado', 'gray');
  if (x.starts_at && new Date(x.starts_at) > now) return badge('Agendado', 'blue');
  if (x.ends_at && new Date(x.ends_at) <= now) return badge('Encerrado', 'gray');
  return badge('Valendo', 'green');
}
const period = (x) => (x.starts_at || x.ends_at ? `${x.starts_at ? formatDate(x.starts_at) : '...'} até ${x.ends_at ? formatDate(x.ends_at) : '...'}` : 'Sem data');

export function mount(host) {
  let tab = 'promocoes';
  function targetName(p) {
    if (p.target_type === 'tudo') return 'Loja toda';
    if (p.target_type === 'categoria') return Data.category(p.target_id)?.name || 'Categoria';
    if (p.target_type === 'colecao') return Data.collection(p.target_id)?.name || 'Drop';
    return Data.product(p.target_id)?.name || 'Produto';
  }
  function render() {
    host.innerHTML = `
      <div class="view">
        ${head('Promoções e cupons', 'Promoção baixa o preço na vitrine. Cupom vale na hora de fechar.', `<button class="btn btn-primary" data-new>${icon('plus')} ${tab === 'promocoes' ? 'Nova promoção' : 'Novo cupom'}</button>`)}
        <div class="tabs" role="tablist">
          <button role="tab" data-tab="promocoes" aria-selected="${tab === 'promocoes'}">Promoções</button>
          <button role="tab" data-tab="cupons" aria-selected="${tab === 'cupons'}">Cupons</button>
        </div>
        ${tab === 'promocoes' ? table([
          { label: 'Promoção', main: true, cell: (p) => `<div><span class="cell-primary">${esc(p.name)}</span><span class="cell-sub">${esc(period(p))}</span></div>` },
          { label: 'Desconto', right: true, cell: (p) => `<b class="num">${Number(p.percent)}%</b>` },
          { label: 'Vale para', cell: (p) => esc(targetName(p)) },
          { label: 'Situação', cell: windowBadge },
        ], Data.promotions(), { rowAttr: (p) => `data-edit="${esc(p.id)}"`, empty: 'Nenhuma promoção. Ex.: 20% em toda a coleção anterior.' })
        : table([
          { label: 'Cupom', main: true, cell: (c) => `<div><span class="cell-primary sku" style="font-size:var(--fs-base)">${esc(c.code)}</span><span class="cell-sub">${esc(period(c))}</span></div>` },
          { label: 'Desconto', right: true, cell: (c) => `<b class="num">${c.kind === 'percent' ? `${Number(c.value)}%` : esc(money(c.value))}</b>` },
          { label: 'Mínimo', right: true, cell: (c) => (Number(c.min_total) > 0 ? esc(money(c.min_total)) : '-') },
          { label: 'Uso', cell: (c) => esc(`${c.max_uses ? `até ${c.max_uses} no total` : 'sem limite'}${c.max_per_customer ? `, ${c.max_per_customer} por cliente` : ''}`) },
          { label: 'Situação', cell: windowBadge },
        ], Data.coupons(), { rowAttr: (c) => `data-edit="${esc(c.id)}"`, empty: 'Nenhum cupom. Ex.: ROTA10.' })}
      </div>`;
  }
  host.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; render(); return; }
    if (e.target.closest('[data-new]')) { (tab === 'promocoes' ? promoForm : couponForm)(null); return; }
    const row = e.target.closest('[data-edit]');
    if (row) {
      if (tab === 'promocoes') promoForm(Data.promotions().find((p) => p.id === row.dataset.edit));
      else couponForm(Data.coupons().find((c) => c.id === row.dataset.edit));
    }
  });
  render();
  return { onData: render };
}

function promoForm(p) {
  const m = openModal({
    title: p ? 'Editar promoção' : 'Nova promoção',
    body: `
      <form class="form-grid" data-f>
        ${field('Nome', `<input class="input" name="name" value="${esc(p?.name)}" required data-autofocus placeholder="Black 44">`, 12)}
        ${field('Desconto (%)', `<input class="input" type="number" inputmode="decimal" name="percent" min="1" max="90" value="${esc(p?.percent)}">`, 6)}
        ${field('Vale para', `<select class="select" name="target_type">${optionsMap(TARGETS, p?.target_type || 'tudo')}</select>`, 6)}
        <div class="field span-12" data-target></div>
        ${field('Começa', `<input class="input" type="date" name="starts_at" value="${esc(toDate(p?.starts_at))}">`, 6)}
        ${field('Termina', `<input class="input" type="date" name="ends_at" value="${esc(toDate(p?.ends_at))}">`, 6)}
        <div class="span-12">${switchField('active', 'Ligada', p ? p.active : true)}</div>
      </form>`,
    footer: `${p ? '<button class="btn btn-ghost" data-del style="margin-right:auto">Excluir</button>' : ''}<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Salvar</button>`,
  });
  const form = $('[data-f]', m.panel);
  const drawTarget = () => {
    const type = form.target_type.value;
    const box = $('[data-target]', m.panel);
    const label = { categoria: 'Categoria', colecao: 'Drop', produto: 'Produto' }[type];
    if (!label) { box.innerHTML = ''; box.hidden = true; return; }
    box.hidden = false;
    const list = type === 'categoria' ? categoryOptions(p?.target_id, { empty: 'Escolha' })
      : type === 'colecao' ? options(Data.collections(), p?.target_id, { empty: 'Escolha' })
        : options(Data.products(), p?.target_id, { empty: 'Escolha' });
    box.innerHTML = `<label class="label">${label}</label><select class="select" name="target_id">${list}</select>`;
  };
  form.target_type.addEventListener('change', drawTarget);
  drawTarget();
  const ok = m.foot.querySelector('[data-ok]');
  ok.addEventListener('click', () => withLoading(ok, async () => {
    const v = readForm(form);
    if (!v.name || !Number(v.percent)) { toast('Preencha nome e desconto', { kind: 'warn' }); return; }
    if (v.target_type !== 'tudo' && !v.target_id) { toast('Escolha para o que vale', { kind: 'warn' }); return; }
    try {
      await Data.saveRow('promotions', {
        id: p?.id, name: v.name, percent: Number(v.percent), target_type: v.target_type, target_id: v.target_type === 'tudo' ? null : v.target_id,
        starts_at: dateStart(v.starts_at), ends_at: dateEnd(v.ends_at), active: v.active,
      });
      m.close();
      toast('Promoção salva');
    } catch (err) { toastError('Não consegui salvar', friendlyError(err)); }
  }));
  m.foot.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'Excluir esta promoção?', confirmText: 'Excluir', danger: true }))) return;
    try { await Data.deleteRow('promotions', p.id); m.close(); toast('Excluída'); } catch (err) { toastError('Não deu', friendlyError(err)); }
  });
}

function couponForm(c) {
  const m = openModal({
    title: c ? 'Editar cupom' : 'Novo cupom',
    body: `
      <form class="form-grid" data-f>
        ${field('Código', `<input class="input" name="code" value="${esc(c?.code)}" required data-autofocus autocapitalize="characters" placeholder="ROTA10">`, 6)}
        ${field('Tipo', `<select class="select" name="kind">${optionsMap({ percent: 'Porcentagem', valor: 'Valor em R$' }, c?.kind || 'percent')}</select>`, 6)}
        ${field('Desconto', `<input class="input" name="value" inputmode="decimal" value="${esc(c?.value)}" placeholder="10">`, 6)}
        ${field('Compra mínima', moneyInput('min_total', c?.min_total), 6)}
        ${field('Limite total de usos', `<input class="input" type="number" inputmode="numeric" min="1" name="max_uses" value="${esc(c?.max_uses)}" placeholder="Sem limite">`, 6)}
        ${field('Limite por cliente', `<input class="input" type="number" inputmode="numeric" min="1" name="max_per_customer" value="${esc(c?.max_per_customer)}" placeholder="Sem limite">`, 6)}
        ${field('Começa', `<input class="input" type="date" name="starts_at" value="${esc(toDate(c?.starts_at))}">`, 6)}
        ${field('Termina', `<input class="input" type="date" name="ends_at" value="${esc(toDate(c?.ends_at))}">`, 6)}
        <div class="span-12">${switchField('active', 'Ligado', c ? c.active : true)}</div>
      </form>`,
    footer: `${c ? '<button class="btn btn-ghost" data-del style="margin-right:auto">Excluir</button>' : ''}<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Salvar</button>`,
  });
  const form = $('[data-f]', m.panel);
  const ok = m.foot.querySelector('[data-ok]');
  ok.addEventListener('click', () => withLoading(ok, async () => {
    const v = readForm(form);
    const code = v.code.toUpperCase().replace(/\s+/g, '');
    const value = parseMoney(v.value);
    if (!/^[A-Z0-9_-]{3,24}$/.test(code)) { toast('Código: de 3 a 24 letras ou números, sem espaço', { kind: 'warn' }); return; }
    if (!value) { toast('Informe o desconto', { kind: 'warn' }); return; }
    try {
      await Data.saveRow('coupons', {
        id: c?.id, code, kind: v.kind, value, min_total: parseMoney(v.min_total), max_uses: Number(v.max_uses) || null,
        max_per_customer: Number(v.max_per_customer) || null, starts_at: dateStart(v.starts_at), ends_at: dateEnd(v.ends_at), active: v.active,
      });
      m.close();
      toast('Cupom salvo');
    } catch (err) { toastError('Não consegui salvar', friendlyError(err)); }
  }));
  m.foot.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: `Excluir o cupom ${c.code}?`, confirmText: 'Excluir', danger: true }))) return;
    try { await Data.deleteRow('coupons', c.id); m.close(); toast('Excluído'); } catch (err) { toastError('Não deu', friendlyError(err)); }
  });
}
