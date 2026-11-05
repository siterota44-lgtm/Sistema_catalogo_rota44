/**
 * PDF do pedido pronto para enviar. No celular, "Enviar" abre a lista de apps
 * (WhatsApp entre eles). No computador, baixa o arquivo e abre a conversa do cliente.
 */

import { esc, whatsappLink } from '../core/utils.js';
import { fold } from '../core/calc.js';
import { orderPdfBlob, canShareFile, sharePdf, downloadBlob, openBlob } from '../docs/pdf.js';
import { icon } from './icons.js';
import { openModal, toast, toastError } from './kit.js';

function fileName(doc) {
  const who = fold(doc.customer.name || '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  return `pedido-rota44${who ? `-${who}` : ''}-${doc.date}.pdf`;
}

export function openOrderPdf(doc) {
  const m = openModal({
    title: 'Pedido em PDF',
    subtitle: doc.customer.name || '',
    body: `
      <div class="pdf-ready" data-ready>
        <div class="col gap-3" style="align-items:center;padding:18px 0">
          <div class="spinner"></div>
          <p class="small dim">Gerando o PDF…</p>
        </div>
      </div>`,
    footer: '<button class="btn btn-ghost" data-close>Fechar</button>',
  });
  const box = m.panel.querySelector('[data-ready]');

  orderPdfBlob(doc).then((blob) => {
    if (!box.isConnected) return;
    const name = fileName(doc);
    const file = new File([blob], name, { type: 'application/pdf' });
    // no computador o "Enviar" abre a janela do sistema, que nem sempre lista o WhatsApp
    const share = matchMedia('(hover: none)').matches && canShareFile(file);
    const first = String(doc.customer.name || '').trim().split(' ')[0];
    const wa = whatsappLink(doc.customer.phone, `Fala${first ? `, ${first}` : ''}! Segue o seu pedido na ${doc.store.name}.`);
    box.innerHTML = `
      <div class="pdf-file">
        <span class="pdf-icon" aria-hidden="true">PDF</span>
        <div class="grow col" style="min-width:0">
          <span class="strong truncate" data-name>${esc(name)}</span>
          <span class="xs dim">${esc(Math.max(1, Math.round(blob.size / 1024)))} KB · pronto para enviar</span>
        </div>
      </div>
      <div class="pdf-actions">
        ${share ? `<button class="btn btn-primary btn-block" data-share>${icon('whatsapp')} Enviar</button>` : ''}
        <button class="btn ${share ? '' : 'btn-primary'} btn-block" data-open>${icon('eye')} Abrir</button>
        <button class="btn btn-block" data-download>${icon('download')} Baixar</button>
        ${wa ? `<a class="btn btn-block" href="${esc(wa)}" target="_blank" rel="noopener">${icon('whatsapp')} Abrir a conversa do cliente</a>` : ''}
      </div>
      <p class="xs dim center" style="margin-top:10px">${share
        ? '"Enviar" abre a lista de apps: escolha o WhatsApp e a conversa.'
        : 'Baixe o PDF, abra a conversa e arraste o arquivo para o WhatsApp.'}</p>`;

    box.addEventListener('click', async (e) => {
      if (e.target.closest('[data-share]')) {
        try {
          if ((await sharePdf(file, { title: `Pedido - ${doc.store.name}` })) === 'shared') { toast('PDF enviado'); m.close(); }
        } catch (err) {
          console.error(err);
          toastError('Não deu para compartilhar', 'Use "Baixar" e envie o arquivo pelo WhatsApp.');
        }
      } else if (e.target.closest('[data-open]')) {
        if (!openBlob(blob)) toastError('O navegador bloqueou a nova aba', 'Use "Baixar".');
      } else if (e.target.closest('[data-download]')) {
        downloadBlob(blob, name);
        toast('PDF baixado', { text: name });
      }
    });
  }).catch((err) => {
    console.error(err);
    if (!box.isConnected) return;
    box.innerHTML = `<div class="alert" data-kind="error">${icon('alert')}
      <div>Não consegui gerar o PDF. Confira a internet (o gerador é baixado na primeira vez) e tente de novo.</div></div>`;
  });
  return m;
}
