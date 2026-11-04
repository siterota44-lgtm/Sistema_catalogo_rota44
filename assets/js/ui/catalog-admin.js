/** Gestão do catálogo online: aberto/fechado, link, QR code, textos e regras da vitrine. */

import * as Data from '../core/data.js';
import { esc, parseMoney, moneyInputValue, maskPhone, onlyDigits } from '../core/utils.js';
import { friendlyError } from '../core/errors.js';
import { icon } from './icons.js';
import { toast, toastError, withLoading } from './kit.js';
import { $, head, field, moneyInput, switchField, readForm, catalogUrl, optionsMap, badge } from './common.js';

export function mount(host) {
  const url = catalogUrl();

  function checklist() {
    const s = Data.settings();
    const visible = Data.products().filter((p) => p.status === 'ativo' && p.catalog_visible);
    const noPhoto = visible.filter((p) => !Data.coverOf(p)).length;
    const noStock = visible.filter((p) => Data.productStock(p.id) <= 0).length;
    const items = [
      { ok: !!s.whatsapp, text: s.whatsapp ? 'WhatsApp da loja preenchido' : 'Falta o WhatsApp da loja: é para ele que o pedido vai' },
      { ok: visible.length > 0, text: `${visible.length} produto${visible.length === 1 ? '' : 's'} à mostra` },
      { ok: !noPhoto, text: noPhoto ? `${noPhoto} produto${noPhoto === 1 ? '' : 's'} sem foto` : 'Todos os produtos têm foto' },
      { ok: !noStock, text: noStock ? `${noStock} produto${noStock === 1 ? '' : 's'} sem estoque (aparecem como esgotados)` : 'Todos os produtos têm estoque' },
      { ok: !!s.instagram, text: s.instagram ? 'Instagram preenchido' : 'Falta o Instagram da loja' },
      { ok: !!s.address, text: s.address ? 'Endereço preenchido' : 'Falta o endereço: ele aparece no rodapé do catálogo' },
    ];
    return `<ul class="col gap-2 small">${items.map((i) => `<li class="row gap-2"><span class="${i.ok ? 'tone-ok' : 'warn-note'}" style="display:inline-flex">${icon(i.ok ? 'checkCircle' : 'alert')}</span>${esc(i.text)}</li>`).join('')}</ul>`;
  }

  function render() {
    const s = Data.settings();
    const share = `Fala! Olha o catálogo da ${s.store_name || 'Rota 44'}: ${url}`;
    host.innerHTML = `
      <div class="view">
        ${head('Catálogo online', 'A vitrine pública: o cliente escolhe e o pedido chega no WhatsApp')}
        <div class="grid grid-2">
          <div class="card card-pad col gap-4">
            <div class="row-between"><b>Situação</b>${s.catalog_open ? badge('Aberto', 'green') : badge('Fechado', 'gray')}</div>
            <label class="switch" data-open-wrap><input type="checkbox" data-open ${s.catalog_open ? 'checked' : ''}><span class="track"><span class="thumb" style="display:block"></span></span><span>Catálogo aberto ao público</span></label>
            <div class="field"><label class="label">Link</label>
              <div class="link-box">
                <input class="input" readonly value="${esc(url)}" data-link aria-label="Link do catálogo">
                <button class="btn" data-copy>${icon('copy')} Copiar</button>
                <a class="btn" href="${esc(url)}" target="_blank" rel="noopener">${icon('share')} Abrir</a>
              </div>
            </div>
            <div class="field"><label class="label">Mensagem pronta</label>
              <div class="link-box"><input class="input" readonly value="${esc(share)}" data-share aria-label="Mensagem"><button class="btn" data-copy-share>${icon('copy')}</button></div>
            </div>
            <div class="fieldset-title">Antes de divulgar</div>
            ${checklist()}
          </div>
          <div class="card card-pad col gap-3" style="align-items:center">
            <div class="fieldset-title" style="align-self:flex-start">QR code para o balcão e a sacola</div>
            <div class="qr-box" data-qr><span class="spinner"></span></div>
            <button class="btn" data-qr-print>${icon('print')} Imprimir</button>
          </div>
        </div>
        <form class="card card-pad col gap-5" data-f>
          <div class="fieldset">
            <div class="fieldset-title">Topo do catálogo</div>
            <div class="form-grid">
              ${field('Frase embaixo do nome', `<input class="input" name="tagline" value="${esc(s.tagline)}" placeholder="Streetwear pra quem vive a rua.">`, 6)}
              ${field('Aviso na faixa vermelha', `<input class="input" name="announcement" value="${esc(s.announcement)}" placeholder="Frete grátis acima de R$ 299 · 5% no Pix">`, 6)}
            </div>
            <p class="xs dim">Para escolher o que vai nos Destaques: em Produtos, abra a peça e marque "Destaque no topo do catálogo".</p>
          </div>
          <div class="fieldset">
            <div class="fieldset-title">Regras da vitrine</div>
            <div class="form-grid">
              ${field('Produto esgotado', `<select class="select" name="sold_out_behavior">${optionsMap({ mostrar: 'Mostrar com selo "Esgotado" e avise-me', ocultar: 'Esconder do catálogo' }, s.sold_out_behavior)}</select>`, 6)}
              ${field('"Últimas unidades" abaixo de', `<input class="input" type="number" inputmode="numeric" min="0" name="low_stock_threshold" value="${esc(s.low_stock_threshold)}">`, 3)}
              ${field('Selo "Novo" por (dias)', `<input class="input" type="number" inputmode="numeric" min="0" name="new_days" value="${esc(s.new_days)}">`, 3)}
              ${field('Desconto no Pix (%)', `<input class="input" name="pix_discount_pct" inputmode="decimal" value="${esc(s.pix_discount_pct)}">`, 4)}
              ${field('Parcelar em até', `<input class="input" type="number" inputmode="numeric" min="1" max="24" name="max_installments" value="${esc(s.max_installments)}">`, 4)}
              ${field('Frete grátis acima de', moneyInput('free_shipping_over', s.free_shipping_over), 4)}
              <div class="span-12">${switchField('show_low_count', 'Mostrar "restam N" nas últimas unidades', s.show_low_count)}</div>
            </div>
          </div>
          <div class="fieldset">
            <div class="fieldset-title">Textos da loja</div>
            <div class="form-grid">
              ${field('Sobre a loja', `<textarea class="textarea" name="about" rows="3">${esc(s.about)}</textarea>`, 12, 'Aparece no rodapé do catálogo.')}
              ${field('Frete e entrega', `<textarea class="textarea" name="shipping_info" rows="2">${esc(s.shipping_info)}</textarea>`, 12, 'Aparece no rodapé do catálogo.')}
              ${field('Trocas e devoluções', `<textarea class="textarea" name="exchange_policy" rows="3">${esc(s.exchange_policy)}</textarea>`, 12, 'Aparece na ficha de cada peça.')}
              ${field('Política de privacidade', `<textarea class="textarea" name="privacy_policy" rows="3">${esc(s.privacy_policy)}</textarea>`, 12, 'Abre pelo link na sacola.')}
            </div>
            <p class="xs dim">WhatsApp, Instagram, TikTok, e-mail, endereço e horário ficam em Ajustes → Loja. O que estiver preenchido aparece no rodapé.</p>
          </div>
          <div class="row" style="justify-content:flex-end"><button type="button" class="btn btn-primary" data-save>Salvar catálogo</button></div>
        </form>
      </div>`;
    drawQR();
  }

  async function drawQR() {
    const box = $('[data-qr]', host);
    try {
      const mod = await import('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm');
      const qrcode = mod.default || mod.qrcode || mod;
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      if (box.isConnected) box.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    } catch {
      if (box.isConnected) box.innerHTML = '<p class="small dim">Sem internet para gerar o QR agora.</p>';
    }
  }

  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); toast('Copiado'); }
    catch { toast('Não consegui copiar', { kind: 'warn' }); }
  };

  host.addEventListener('change', async (e) => {
    if (e.target.matches('[data-open]')) {
      try {
        await Data.saveSettings({ catalog_open: e.target.checked });
        toast(e.target.checked ? 'Catálogo aberto' : 'Catálogo fechado');
      } catch (err) { toastError('Não consegui mudar', friendlyError(err)); }
    }
  });
  host.addEventListener('click', (e) => {
    if (e.target.closest('[data-copy]')) { copy(url); return; }
    if (e.target.closest('[data-copy-share]')) { copy($('[data-share]', host).value); return; }
    if (e.target.closest('[data-qr-print]')) {
      const svg = $('[data-qr]', host).innerHTML;
      const w = window.open('', '_blank', 'width=420,height=520');
      if (w) {
        w.document.write(`<!doctype html><title>QR Rota 44</title><body style="margin:24px;text-align:center;font-family:sans-serif"><div style="width:280px;margin:0 auto">${svg}</div><h2>Catálogo ${esc(Data.settings().store_name)}</h2><p>${esc(url)}</p>`);
        w.document.close();
        w.focus();
        w.print();
      }
      return;
    }
    const save = e.target.closest('[data-save]');
    if (save) {
      withLoading(save, async () => {
        const v = readForm($('[data-f]', host));
        try {
          await Data.saveSettings({
            announcement: v.announcement, tagline: v.tagline,
            sold_out_behavior: v.sold_out_behavior, low_stock_threshold: Number(v.low_stock_threshold) || 0, new_days: Number(v.new_days) || 0,
            pix_discount_pct: parseMoney(v.pix_discount_pct), max_installments: Number(v.max_installments) || 1, free_shipping_over: parseMoney(v.free_shipping_over),
            show_low_count: v.show_low_count, about: v.about, exchange_policy: v.exchange_policy, shipping_info: v.shipping_info, privacy_policy: v.privacy_policy,
          });
          toast('Catálogo salvo');
        } catch (err) { toastError('Não consegui salvar', friendlyError(err)); }
      });
    }
  });

  render();
  return {};
}
