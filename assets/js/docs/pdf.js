/**
 * Pedido em PDF, gerado no próprio aparelho (sem servidor), para mandar ao cliente.
 *
 * A biblioteca (jsPDF, ~350 KB) só é baixada na primeira vez que alguém gera um
 * PDF. O desenho (drawOrderPdf) recebe a biblioteca por parâmetro, e por isso o
 * teste consegue conferir cada texto que vai para o papel.
 *
 * É um documento para o cliente: nada de número interno, SKU ou custo. A fonte é
 * a Helvetica embutida do PDF (cobre os acentos), por isso nada de "→" ou emoji.
 */

import { money, formatDate, maskPhone, thumbUrl } from '../core/utils.js';

// Versão fixa (mesma regra do supabase-js).
const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@4.2.1/+esm';
// Escudo sobre o preto do cabeçalho: gerado por tests/arte/gerar-logo-pdf.mjs.
const LOGO_URL = 'assets/brand/rota44-logo-pdf.jpg';

const C = {
  ink: [10, 10, 11],
  red: [217, 0, 0],
  text: [20, 20, 20],
  muted: [100, 101, 106],
  soft: [190, 191, 196],
  line: [226, 224, 219],
  zebra: [248, 247, 244],
  panel: [243, 241, 236],
  white: [255, 255, 255],
  green: [27, 128, 57],
};

const PAGE_W = 210;
const PAGE_H = 297;
const M = 16;
const CW = PAGE_W - 2 * M;
const FOOT = 18;
const THUMB = 14;

/** Texto seguro para a fonte do PDF. */
const pt = (s) => String(s ?? '').replace(/[  ]/g, ' ').replace(/[→−•–—]/g, '-')
  .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').trim();
const brl = (n) => pt(money(n));

/**
 * Desenha o documento e devolve a instância do jsPDF.
 * @param {Function} JsPDF  construtor do jsPDF
 * @param {object} doc      ver docs/order-doc.js
 * @param {{logo?: string}} [opts]  escudo em data URL
 */
export function drawOrderPdf(JsPDF, doc, { logo } = {}) {
  const pdf = new JsPDF({ unit: 'mm', format: 'a4', compress: true });
  const fill = (rgb) => pdf.setFillColor(...rgb);
  const color = (rgb) => pdf.setTextColor(...rgb);
  const font = (style, size) => { pdf.setFont('helvetica', style); pdf.setFontSize(size); };
  const store = doc.store;

  pdf.setProperties({
    title: `Pedido - ${store.name}`,
    subject: `Pedido de ${doc.customer.name || 'cliente'}`,
    author: store.name,
    creator: store.name,
  });

  /* ------------------------------------------------ cabeçalho escuro --- */

  const HEAD_H = 38;
  fill(C.ink); pdf.rect(0, 0, PAGE_W, HEAD_H, 'F');
  fill(C.red); pdf.rect(0, HEAD_H, PAGE_W, 1.4, 'F');
  let infoX = M;
  if (logo) {
    pdf.addImage(logo, 'JPEG', M, 7, 21, 24.6, 'logo', 'FAST');
    infoX = M + 26;
  }
  font('bold', 17); color(C.white);
  pdf.text(pt(store.name), infoX, 14.5);
  font('normal', 8.2); color(C.soft);
  const contact = [
    store.tagline,
    [store.phone && `WhatsApp ${maskPhone(store.phone)}`, store.instagram].filter(Boolean).join('   |   '),
    [store.address, store.hours].filter(Boolean).join('   |   '),
  ].filter(Boolean);
  let cy = 20;
  for (const l of contact) {
    for (const s of pdf.splitTextToSize(pt(l), 104)) { pdf.text(s, infoX, cy); cy += 4; }
  }
  font('bold', 22); color(C.white);
  pdf.text('PEDIDO', PAGE_W - M, 18, { align: 'right' });
  font('normal', 8.5); color(C.soft);
  pdf.text(`Emitido em ${formatDate(doc.date)}`, PAGE_W - M, 24, { align: 'right' });
  if (doc.status) pdf.text(pt(doc.status), PAGE_W - M, 28.5, { align: 'right' });

  let y = HEAD_H + 9;

  /* --------------------------------------------------------- cliente --- */

  const phoneLine = doc.customer.phone ? `WhatsApp ${maskPhone(doc.customer.phone)}` : '';
  font('normal', 8.5);
  const addrLines = doc.customer.address ? pdf.splitTextToSize(pt(doc.customer.address), CW - 8) : [];
  const custH = 15 + (phoneLine ? 4.5 : 0) + addrLines.length * 4;
  fill(C.panel); pdf.roundedRect(M, y, CW, custH, 2.5, 2.5, 'F');
  font('bold', 7); color(C.muted); pdf.text('CLIENTE', M + 4, y + 5.5);
  font('bold', 12); color(C.text);
  pdf.text(pdf.splitTextToSize(pt(doc.customer.name || 'Consumidor'), CW - 8)[0], M + 4, y + 11.5);
  let iy = y + 16.5;
  font('normal', 8.5); color(C.muted);
  if (phoneLine) { pdf.text(phoneLine, M + 4, iy); iy += 4.5; }
  for (const l of addrLines) { pdf.text(l, M + 4, iy); iy += 4; }
  y += custH + 7;

  /* ----------------------------------------------------------- peças --- */

  const hasPhotos = doc.items.some((it) => it.thumb);
  const X_TEXT = M + (hasPhotos ? THUMB + 4 : 2);
  const X_QTY = M + CW - 64;
  const X_UNIT = M + CW - 30;
  const X_TOTAL = M + CW - 3;
  const DESC_W = X_QTY - X_TEXT - 8;

  const tableHead = () => {
    font('bold', 7.5); color(C.muted);
    pdf.text('PEÇA', X_TEXT, y + 4);
    pdf.text('QTD', X_QTY, y + 4, { align: 'center' });
    pdf.text('UNITÁRIO', X_UNIT, y + 4, { align: 'right' });
    pdf.text('TOTAL', X_TOTAL, y + 4, { align: 'right' });
    y += 6.5;
    pdf.setDrawColor(...C.ink); pdf.setLineWidth(0.5); pdf.line(M, y, PAGE_W - M, y);
    y += 1;
  };
  const newPage = () => { pdf.addPage(); y = M; };

  tableHead();
  doc.items.forEach((it, i) => {
    font('bold', 10);
    const nameLines = pdf.splitTextToSize(pt(it.name), DESC_W);
    font('normal', 8.2);
    const extra = (it.details || []).filter(Boolean).flatMap((d) => pdf.splitTextToSize(pt(d), DESC_W));
    const textH = 6 + (nameLines.length - 1) * 4.5 + extra.length * 3.8 + 3;
    const rowH = Math.max(textH, hasPhotos ? THUMB + 3 : 11);

    if (y + rowH > PAGE_H - FOOT - 4) { newPage(); tableHead(); }
    if (i % 2 === 1) { fill(C.zebra); pdf.rect(M, y, CW, rowH, 'F'); }
    if (it.thumb) {
      fill(C.white); pdf.roundedRect(M + 1, y + 1.5, THUMB, THUMB, 1.2, 1.2, 'F');
      pdf.addImage(it.thumb, 'JPEG', M + 1, y + 1.5, THUMB, THUMB, undefined, 'FAST');
    }

    let ty = y + 6;
    font('bold', 10); color(C.text);
    nameLines.forEach((l) => { pdf.text(l, X_TEXT, ty); ty += 4.5; });
    font('normal', 8.2); color(C.muted);
    extra.forEach((l) => { pdf.text(l, X_TEXT, ty - 0.4); ty += 3.8; });

    font('normal', 10); color(C.text);
    pdf.text(String(it.qty), X_QTY, y + 6, { align: 'center' });
    pdf.text(it.unit ? brl(it.unit) : 'Cortesia', X_UNIT, y + 6, { align: 'right' });
    font('bold', 10);
    pdf.text(brl(it.unit * it.qty), X_TOTAL, y + 6, { align: 'right' });

    y += rowH;
    pdf.setDrawColor(...C.line); pdf.setLineWidth(0.2); pdf.line(M, y, PAGE_W - M, y);
  });
  y += 7;

  /* ------------------------------------------- pagamento + totais ----- */

  const t = doc.totals;
  const upper = [
    t.discount > 0 ? ['Descontos', `- ${brl(t.discount)}`] : null,
    t.coupon > 0 ? ['Cupom', `- ${brl(t.coupon)}`] : null,
    t.pix > 0 ? ['Desconto no Pix', `- ${brl(t.pix)}`] : null,
    t.shipping > 0 ? ['Frete', brl(t.shipping)] : null,
  ].filter(Boolean);
  if (upper.length) upper.unshift(['Produtos', brl(t.subtotal)]);
  const after = [
    t.returned > 0 ? ['Devolvido', `- ${brl(t.returned)}`] : null,
    t.paid > 0 && t.balance > 0.005 ? ['Recebido', brl(t.paid)] : null,
    t.balance > 0.005 ? ['Falta pagar', brl(t.balance)] : null,
  ].filter(Boolean);
  const blockH = Math.max(upper.length * 5.6 + 18 + after.length * 5.6, 34);
  if (y + blockH > PAGE_H - FOOT - 4) newPage();

  const TX = PAGE_W - M - 82;
  let ry = y + 4;
  font('normal', 9.5);
  for (const [label, value] of upper) {
    color(C.muted); pdf.text(label, TX + 3, ry);
    color(C.text); pdf.text(value, PAGE_W - M - 3, ry, { align: 'right' });
    ry += 5.6;
  }
  fill(C.red); pdf.roundedRect(TX, ry - 2, 82, 12.5, 2.2, 2.2, 'F');
  font('bold', 8.5); color(C.white); pdf.text('TOTAL', TX + 4, ry + 5.6);
  font('bold', 14); pdf.text(brl(t.total), PAGE_W - M - 4, ry + 6.2, { align: 'right' });
  ry += 16.5;
  for (const [label, value] of after) {
    const owe = label === 'Falta pagar';
    font(owe ? 'bold' : 'normal', 9.5);
    color(owe ? C.red : C.muted); pdf.text(label, TX + 3, ry);
    color(owe ? C.red : C.text); pdf.text(value, PAGE_W - M - 3, ry, { align: 'right' });
    ry += 5.6;
  }
  if (t.paid > 0 && t.balance <= 0.005) {
    font('bold', 9); color(C.green); pdf.text('Pagamento quitado. Tamo junto!', PAGE_W - M - 3, ry, { align: 'right' });
    ry += 5.6;
  }

  let ly = y + 4;
  const LW = TX - M - 8;
  const payLines = [
    ...(doc.payments || []).map((p) => `${formatDate(p.date)}  ${p.method}${p.installments > 1 ? ` ${p.installments}x` : ''}  ${brl(p.amount)}`),
    ...(doc.parcels || []).map((p) => `Parcela ${p.label}: ${brl(p.amount)} ${p.paid ? `paga em ${formatDate(p.paid)}` : `vence ${formatDate(p.due)}`}`),
    doc.delivery && `Entrega: ${doc.delivery}`,
    doc.tracking && `Rastreio: ${doc.tracking}`,
  ].filter(Boolean);
  const showPix = store.pixKey && t.balance > 0.005;
  if (payLines.length || showPix) {
    font('bold', 7.5); color(C.muted); pdf.text('PAGAMENTO E ENTREGA', M, ly); ly += 5;
    font('normal', 9); color(C.text);
    for (const l of payLines) {
      for (const s of pdf.splitTextToSize(pt(l), LW)) { pdf.text(s, M, ly); ly += 4.5; }
    }
    if (showPix) {
      ly += 1.5;
      pdf.setDrawColor(...C.ink); pdf.setLineWidth(0.35);
      pdf.roundedRect(M, ly - 4, LW, store.pixName ? 15 : 11, 1.8, 1.8, 'S');
      font('bold', 7.5); color(C.muted); pdf.text('CHAVE PIX', M + 3, ly);
      font('bold', 10.5); color(C.text);
      pdf.text(pdf.splitTextToSize(pt(store.pixKey), LW - 6)[0], M + 3, ly + 5);
      if (store.pixName) { font('normal', 8); color(C.muted); pdf.text(pdf.splitTextToSize(pt(store.pixName), LW - 6)[0], M + 3, ly + 9); }
      ly += store.pixName ? 15 : 11;
    }
  }
  y = Math.max(ry, ly) + 5;

  /* ------------------------------------------------ textos da loja ---- */

  if (doc.notes) {
    font('normal', 8.8);
    const lines = pdf.splitTextToSize(pt(doc.notes), CW);
    if (y + 6 + Math.min(lines.length, 3) * 4 > PAGE_H - FOOT - 4) newPage();
    font('bold', 7.5); color(C.muted); pdf.text('OBSERVAÇÕES', M, y); y += 4.6;
    font('normal', 8.8); color(C.text);
    for (const l of lines) {
      if (y > PAGE_H - FOOT - 4) newPage();
      pdf.text(l, M, y); y += 4;
    }
    y += 3;
  }
  const closing = [store.footer, store.exchangeDays > 0 ? `Trocas em até ${store.exchangeDays} dias com a etiqueta.` : ''].filter(Boolean);
  if (closing.length) {
    if (y + 8 + closing.length * 4.5 > PAGE_H - FOOT - 4) newPage();
    y += 3;
    font('italic', 9.5); color(C.text);
    for (const line of closing) {
      for (const l of pdf.splitTextToSize(pt(line), CW)) { pdf.text(l, PAGE_W / 2, y, { align: 'center' }); y += 4.5; }
    }
  }

  /* ------------------------------------------------------- rodapé ----- */

  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    pdf.setDrawColor(...C.line); pdf.setLineWidth(0.3);
    pdf.line(M, PAGE_H - 13, PAGE_W - M, PAGE_H - 13);
    font('normal', 7.5); color(C.muted);
    pdf.text(pt([store.name, store.instagram, 'Este documento não é nota fiscal'].filter(Boolean).join('   |   ')), M, PAGE_H - 8.5);
    pdf.text(`Página ${p} de ${pages}`, PAGE_W - M, PAGE_H - 8.5, { align: 'right' });
  }
  return pdf;
}

/* ===================================================================== */
/*  Navegador                                                            */
/* ===================================================================== */

let libPromise = null;
let logoPromise = null;

/** Baixa a biblioteca uma vez só; as chamadas seguintes reaproveitam. */
export function loadJsPDF() {
  libPromise ||= import(JSPDF_URL).then((m) => m.jsPDF || m.default?.jsPDF || m.default)
    .catch((err) => { libPromise = null; throw err; });
  return libPromise;
}

const toDataURL = (blob) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(fr.result);
  fr.onerror = reject;
  fr.readAsDataURL(blob);
});

/** Sem o escudo (arquivo faltando, sem internet), o PDF sai só com o nome. */
export function loadLogo() {
  logoPromise ||= fetch(LOGO_URL)
    .then((r) => (r.ok ? r.blob() : null))
    .then((blob) => (blob ? toDataURL(blob) : null))
    .catch(() => null);
  return logoPromise;
}

/** Foto da peça em JPEG quadrado e pequeno: o arquivo continua leve para o WhatsApp. */
async function photoData(url) {
  if (!url) return null;
  for (const u of [thumbUrl(url), url]) {
    try {
      const r = await fetch(u);
      if (!r.ok) continue;
      const bmp = await createImageBitmap(await r.blob());
      const size = 200;
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, size, size);
      const k = Math.min(size / bmp.width, size / bmp.height);
      g.drawImage(bmp, (size - bmp.width * k) / 2, (size - bmp.height * k) / 2, bmp.width * k, bmp.height * k);
      bmp.close?.();
      return c.toDataURL('image/jpeg', 0.82);
    } catch { /* tenta a próxima; sem foto, a linha sai só com o texto */ }
  }
  return null;
}

/** @returns {Promise<Blob>} */
export async function orderPdfBlob(doc) {
  const [JsPDF, logo] = await Promise.all([loadJsPDF(), loadLogo()]);
  const items = await Promise.all(doc.items.map(async (it) => ({ ...it, thumb: await photoData(it.photo) })));
  return drawOrderPdf(JsPDF, { ...doc, items }, { logo }).output('blob');
}

/** O aparelho consegue mandar o arquivo direto para o WhatsApp (folha de compartilhar)? */
export function canShareFile(file) {
  try {
    return !!navigator.canShare && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/**
 * Compartilhar exige um toque "fresco": o Safari recusa se houver espera no meio.
 * Por isso a tela gera o PDF primeiro e só depois oferece o botão.
 * @returns {Promise<'shared'|'cancelled'>}
 */
export async function sharePdf(file, { title } = {}) {
  try {
    await navigator.share({ files: [file], title });
    return 'shared';
  } catch (err) {
    if (err?.name === 'AbortError') return 'cancelled';
    throw err;
  }
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function openBlob(blob) {
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (win) win.opener = null;
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return !!win;
}
