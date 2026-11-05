// O que a loja usa no balcão: etiqueta em cada papel (a 203 dpi, como a térmica
// imprime), leitor USB, leitor pela câmera (câmera simulada do Chrome com a imagem
// de uma etiqueta), PDF do pedido e as mensagens de WhatsApp sem código interno.
// Nada vai para o projeto real.
//   cd tests && node e2e/balcao.mjs   (precisa de `node netlify/build.mjs` antes)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDb, addUser, q, open, login, nav, shot, ok, section, result, startServer, stopServer, BASE, SHOTS } from './harness.mjs';
import { code128SVG } from '../../assets/js/core/barcode.js';

const OUT = fileURLToPath(new URL('../out/', import.meta.url));
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const db = await createDb();
await addUser(db, 'siterota44@gmail.com', 'Rota 44', 'admin');
await db.query(`update public.store_settings set whatsapp='44999990000', instagram='@rota44', address='Av. Brasil, 44 - Maringá/PR', pix_key='44999990000', pix_name='Rota 44 Streetwear', require_cash_session=false`);
await startServer();
const one = async (sql, params) => (await q(db, sql, params))[0];
const closeTop = async (page) => { await page.evaluate(() => [...document.querySelectorAll('dialog.modal[open] [data-close]')].pop()?.click()); await page.waitForTimeout(100); };

const A = await open(db, { device: 'Desktop', theme: 'light' });
const page = A.page;
await login(page, 'siterota44@gmail.com');

/* Ferramentas de conferência: página à parte, sem a CSP do site. */
const toolBrowser = await chromium.launch({ executablePath: CHROME });
const tools = await toolBrowser.newPage();
await tools.setContent('<!doctype html><canvas></canvas>');
await tools.addScriptTag({ content: await (await fetch('https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js')).text() });
await tools.evaluate(async () => {
  const pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
  window.pdfjs = pdfjs;
});
const pdfInfo = (bytes, dpi) => tools.evaluate(async ({ b64, dpi }) => {
  const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const doc = await window.pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const pg = await doc.getPage(1);
  const base = pg.getViewport({ scale: 1 });
  const vp = pg.getViewport({ scale: dpi / 72 });
  const c = document.querySelector('canvas');
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  await pg.render({ canvasContext: c.getContext('2d'), viewport: vp, background: 'white' }).promise;
  const text = [];
  for (let i = 1; i <= doc.numPages; i++) text.push((await (await doc.getPage(i)).getTextContent()).items.map((t) => t.str).join(' '));
  const png = c.toDataURL('image/png').split(',')[1];
  return { pages: doc.numPages, mm: [base.width, base.height].map((v) => Math.round(v / 2.8346)), text: text.join(' '), png };
}, { b64: Buffer.from(bytes).toString('base64'), dpi });

/* Como a térmica: cada ponto é preto ou branco, sem meio-tom. Depois lê com o ZXing. */
const readThermal = () => tools.evaluate(() => {
  const c = document.querySelector('canvas');
  const g = c.getContext('2d');
  const im = g.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < im.data.length; i += 4) {
    const v = im.data[i] * 0.3 + im.data[i + 1] * 0.59 + im.data[i + 2] * 0.11 < 128 ? 0 : 255;
    im.data[i] = v; im.data[i + 1] = v; im.data[i + 2] = v;
  }
  g.putImageData(im, 0, 0);
  const hints = new Map([[ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.CODE_128]], [ZXing.DecodeHintType.TRY_HARDER, true]]);
  try {
    const reader = new ZXing.MultiFormatReader();
    reader.setHints(hints);
    return reader.decodeWithState(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.HTMLCanvasElementLuminanceSource(c)))).getText();
  } catch (e) { return `ERRO: ${e.message || e.name || e}`; }
});

/* ====================================================== ETIQUETAS */
section('Etiquetas em cada papel');
const demo = await q(db, `select v.id, v.barcode, v.sku, p.name from public.product_variants v join public.products p on p.id = v.product_id order by p.name, v.sku`);
await nav(page, 'etiquetas');
await page.waitForSelector('[data-qty]');
const fields = page.locator('[data-qty]');
for (const i of [0, 1, 2]) await fields.nth(i).fill('1');
await page.click('[data-print]');
await page.waitForSelector('dialog.modal[open] .label-tag');
ok((await page.inputValue('dialog.modal[open] [data-format]')) === '50x30', 'abre em rolo 50×30 mm');
const FORMATS = [['50x30', [50, 30], 3], ['40x25', [40, 25], 3], ['60x40', [60, 40], 3], ['a4', [210, 297], 1]];
for (const [fmt, size, pages] of FORMATS) {
  await page.selectOption('dialog.modal[open] [data-format]', fmt);
  await page.waitForTimeout(80);
  await page.evaluate(() => { window.print = () => {}; });
  await page.click('dialog.modal[open] [data-print]');
  await page.emulateMedia({ media: 'print' });
  const fit = await page.evaluate(() => [...document.querySelectorAll('#print-root .label-tag')].map((t) => ({
    over: t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth + 1,
    code: (() => { const c = t.querySelector('.lt-code'); return c.scrollWidth > c.clientWidth + 1; })(),
    text: t.querySelector('.lt-code').textContent,
  })));
  ok(fit.length === 3 && !fit.some((f) => f.over), `${fmt}: nada estoura a etiqueta`);
  ok(!fit.some((f) => f.code), `${fmt}: linha do código cabe inteira`);
  ok(await page.isVisible('#print-root .label-tag') && !(await page.isVisible('.sidebar')), `${fmt}: no papel só sai a etiqueta`);
  const bytes = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  const info = await pdfInfo(bytes, 203);
  ok(info.pages === pages, `${fmt}: ${info.pages} página(s) para 3 etiquetas`);
  ok(info.mm[0] === size[0] && info.mm[1] === size[1], `${fmt}: página de ${info.mm.join('×')} mm`);
  const read = await readThermal();
  const printed = fit[0].text.split(' ')[0];
  ok(read === printed, `${fmt}: código lido a 203 dpi preto e branco (${read})`);
  fs.writeFileSync(`${SHOTS}etiqueta-${fmt}.png`, Buffer.from((await tools.evaluate(() => document.querySelector('canvas').toDataURL('image/png'))).split(',')[1], 'base64'));
}
await shot(page, 'etiquetas-prévia');
await closeTop(page);
ok(!(await page.evaluate(() => [...document.querySelectorAll('head style')].some((s) => /@page/.test(s.textContent)))), 'a regra de página do rolo não fica valendo para o comprovante');

/* ====================================================== LEITOR USB */
section('Leitor USB (é um teclado muito rápido)');
const bip = async (code, delay = 3) => { await page.keyboard.type(code, { delay }); await page.keyboard.press('Enter'); };
const V = demo.find((x) => x.name.startsWith('Camiseta'));
await db.query(`update public.product_variants set on_hand = 50 where id = $1`, [V.id]);
await page.reload();
await page.waitForSelector('.app');
const waitQty = (n) => page.waitForFunction((want) => document.querySelector('.cart-qty b')?.textContent === want, String(n), { timeout: 6000 }).catch(async (e) => {
  console.log('    DBG', JSON.stringify(await page.evaluate(() => ({ qty: document.querySelector('.cart-qty b')?.textContent, campo: document.querySelector('[data-scan]')?.value, foco: document.activeElement?.tagName, toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent.trim()) }))));
  throw e;
});
await nav(page, 'pdv');
await page.waitForSelector('[data-scan]');
await page.click('[data-scan]');
await bip(V.barcode);
await page.waitForSelector('.cart-item');
ok((await page.inputValue('[data-scan]')) === '', 'bipou no campo: entra no carrinho e o campo limpa');
await bip(V.barcode);
await waitQty(2);
ok(true, 'bipou a mesma peça: quantidade vai para 2');
await bip('7891234567895');
await page.waitForSelector('.toast:has-text("Código não encontrado")');
ok((await page.inputValue('[data-scan]')) === '', 'código que não existe avisa e sai do campo');
await bip(V.barcode);
await waitQty(3);
ok(true, 'o bipe seguinte não cola no código errado');
await page.evaluate(() => document.activeElement.blur());
await bip(V.barcode);
await waitQty(4);
ok(true, 'foco fora do campo: o bipe ainda entra');
await page.evaluate(() => document.activeElement.blur());
await bip('123456', 160);
await page.waitForTimeout(150);
ok((await page.textContent('.cart-qty b')) === '4', 'digitar devagar fora do campo não vira bipe');
await nav(page, 'produtos');
await page.waitForTimeout(120);
const before = await page.evaluate(() => localStorage.getItem('rota44.cart'));
await page.evaluate(() => document.activeElement.blur());
await bip(V.barcode);
await page.waitForTimeout(120);
ok(before === await page.evaluate(() => localStorage.getItem('rota44.cart')), 'em outra tela o bipe não mexe no carrinho');
await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('rota44.cart')); c.items = []; localStorage.setItem('rota44.cart', JSON.stringify(c)); });

/* ====================================================== PDF E MENSAGENS */
section('PDF do pedido e mensagens de WhatsApp');
const SECRET = /\bC\d+\b|#\d{2,}|R44-|\b244\d{10}\b|\bvenda\s+\d/i;
await page.reload();
await page.waitForSelector('.app');
await nav(page, 'pdv');
await page.waitForSelector('[data-scan]');
await page.click('[data-scan]');
await bip(V.barcode);
await page.waitForSelector('.cart-item');
await page.click('[data-customer]');
await page.click('dialog.modal[open] [data-new]');
await page.fill('dialog.modal[open]:last-of-type [name=name]', 'Maria Rocha');
await page.fill('dialog.modal[open]:last-of-type [name=phone]', '44988887777');
await page.click('dialog.modal[open]:last-of-type [data-ok]');
await page.waitForFunction(() => document.querySelector('[data-customer]')?.textContent.includes('Maria'));
await page.click('[data-checkout]');
await page.waitForSelector('[data-method=crediario]');
await page.click('[data-method=crediario]');
await page.selectOption('[data-method-form] [name=inst]', '2');
await page.click('[data-method-form] [data-add]');
await page.waitForTimeout(100);
await page.click('[data-finish]');
await page.waitForSelector('.receipt');
const sale = await one(`select * from public.sales order by number desc limit 1`);
const waReceipt = decodeURIComponent(await page.getAttribute('dialog.modal[open] .modal-foot a[href*="wa.me"]', 'href'));
ok(waReceipt.includes('Camiseta') && !SECRET.test(waReceipt), 'mensagem da venda sem número nem código', waReceipt);
await page.click('dialog.modal[open] [data-pdf]');
await page.waitForSelector('dialog.modal[open] [data-name]', { timeout: 30000 });
const fname = await page.textContent('dialog.modal[open] [data-name]');
ok(/^pedido-rota44-maria-rocha-\d{4}-\d{2}-\d{2}\.pdf$/.test(fname), `nome do arquivo sem código: ${fname}`);
ok(await page.isVisible('dialog.modal[open] .pdf-actions a[href*="wa.me/5544988887777"]'), 'no computador: abre a conversa do cliente');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('dialog.modal[open] [data-download]')]);
const pdfPath = await dl.path();
const pdfBytes = fs.readFileSync(pdfPath);
ok(pdfBytes.subarray(0, 5).toString() === '%PDF-', `é um PDF de verdade (${Math.round(pdfBytes.length / 1024)} KB)`);
ok(pdfBytes.length < 300 * 1024, 'leve para o WhatsApp (menos de 300 KB)');
const doc = await pdfInfo(pdfBytes, 110);
fs.writeFileSync(`${SHOTS}pedido-pdf.png`, Buffer.from(doc.png, 'base64'));
fs.writeFileSync(`${OUT}pedido-exemplo.pdf`, pdfBytes);
for (const t of ['Maria Rocha', 'Camiseta Boxy Mira', 'PEDIDO', 'TOTAL', 'Falta pagar', 'CHAVE PIX', '44999990000', 'Parcela 1/2', 'Parcela 2/2', 'não é nota fiscal']) ok(doc.text.includes(t), `PDF traz: ${t}`);
ok(!SECRET.test(doc.text), 'PDF sem número interno, SKU nem código de barras', doc.text.slice(0, 300));
ok(!/custo|margem|lucro/i.test(doc.text), 'PDF sem custo nem margem');
await closeTop(page);
await closeTop(page);

await nav(page, 'vendas');
await page.selectOption('[data-f=period]', 'tudo');
await page.click(`tr[data-open="${sale.id}"]`);
await page.waitForSelector('dialog.modal[open] [data-pdf]');
const waSale = decodeURIComponent(await page.getAttribute('dialog.modal[open] .modal-foot a[href*="wa.me"]', 'href'));
ok(!SECRET.test(waSale), 'WhatsApp da ficha da venda também sem código');
await page.click('dialog.modal[open] [data-pdf]');
await page.waitForSelector('dialog.modal[open]:last-of-type [data-name]', { timeout: 30000 });
ok(true, 'ficha da venda gera o PDF');
await closeTop(page);
await closeTop(page);

const vPhone = await one(`select id from public.product_variants where sku=$1`, [V.sku]);
await db.query(`insert into public.catalog_requests (customer_name, customer_phone, delivery_pref, notes, items, total) values ('João Lima', '44977776666', 'Correios', 'Presente', $1, 149.90)`, [JSON.stringify([{ variant_id: vPhone.id, name: 'Camiseta Boxy Mira', color: 'Off-white', size: 'M', qty: 1, unit_price: 149.9, available: true }])]);
await page.reload();
await page.waitForSelector('.app');
await nav(page, 'pedidos');
await page.waitForSelector('article [data-pdf]');
const waReq = decodeURIComponent(await page.getAttribute('article a[href*="wa.me"]', 'href'));
ok(waReq.includes('seu pedido') && !SECRET.test(waReq), 'WhatsApp do pedido do catálogo sem o C1', waReq);
await page.click('article [data-pdf]');
await page.waitForSelector('dialog.modal[open] [data-name]', { timeout: 30000 });
const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('dialog.modal[open] [data-download]')]);
const req = await pdfInfo(fs.readFileSync(await dl2.path()), 110);
ok(req.text.includes('João Lima') && req.text.includes('Correios') && req.text.includes('Presente') && !SECRET.test(req.text), 'pedido do catálogo também vira PDF, sem código');
await closeTop(page);
ok(A.errors.length === 0, 'balcão sem erros de JS', A.errors.join(' | '));
await A.browser.close();

/* ====================================================== CÂMERA */
section('Leitor pela câmera (Chrome com câmera simulada)');
// A imagem que a câmera vê: uma etiqueta um pouco torta e desfocada, com ruído.
const framePath = `${OUT}camera-etiqueta.y4m`;
const luma = await tools.evaluate(({ svg, name }) => {
  const c = document.querySelector('canvas');
  c.width = 1280; c.height = 720;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#6d6d6d'; g.fillRect(0, 0, 1280, 720);
  g.save();
  g.translate(640, 360); g.rotate(-0.05); g.filter = 'blur(0.7px)';
  g.fillStyle = '#fff'; g.fillRect(-300, -180, 600, 360);
  g.fillStyle = '#000'; g.font = 'bold 34px sans-serif'; g.fillText(name, -280, -125);
  const box = Number(/viewBox="0 0 (\d+)/.exec(svg)[1]);
  const k = 560 / box;
  for (const m of svg.matchAll(/<rect x="(\d+)" y="0" width="(\d+)"/g)) g.fillRect(-280 + Number(m[1]) * k, -90, Number(m[2]) * k, 170);
  g.restore();
  const im = g.getImageData(0, 0, 1280, 720).data;
  const y = new Uint8Array(1280 * 720);
  let seed = 11;
  for (let i = 0; i < y.length; i++) {
    seed = (seed * 16807) % 2147483647;
    y[i] = Math.max(0, Math.min(255, im[i * 4] * 0.9 + 12 + (seed % 15) - 7));
  }
  let s = '';
  for (let i = 0; i < y.length; i += 32768) s += String.fromCharCode(...y.subarray(i, i + 32768));
  return btoa(s);
}, { svg: code128SVG(V.barcode, { height: 60 }), name: V.name });
fs.writeFileSync(framePath, Buffer.concat([
  Buffer.from('YUV4MPEG2 W1280 H720 F10:1 Ip A1:1 C420mpeg2 XYSCSS=420MPEG2\nFRAME\n'),
  Buffer.from(luma, 'base64'),
  Buffer.alloc(640 * 360 * 2, 128),
]));
await toolBrowser.close();

const C = await open(db, { device: 'Desktop', theme: 'dark', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${framePath}`] });
const cam = C.page;
await login(cam, 'siterota44@gmail.com');
await nav(cam, 'pdv');
await cam.waitForSelector('[data-camera]');
console.log('    leitor em uso:', (await cam.evaluate(() => 'BarcodeDetector' in window)) ? 'nativo do navegador' : 'ZXing em WebAssembly (o mesmo do Safari do iPhone)');
await cam.click('[data-camera]');
await cam.waitForSelector('.scan-box video');
await cam.waitForFunction(() => document.querySelector('[data-last]')?.textContent.startsWith('Adicionada'), null, { timeout: 45000 });
ok(true, `leu a etiqueta pela câmera: ${await cam.textContent('[data-last]')}`);
await shot(cam, 'leitor-camera');
await cam.waitForTimeout(4500);
await closeTop(cam);
await cam.waitForSelector('.cart-item');
ok((await cam.textContent('.cart-qty b')) === '1', 'câmera parada em cima do código conta uma vez só');
await cam.evaluate(() => { const c = JSON.parse(localStorage.getItem('rota44.cart')); c.items = []; localStorage.setItem('rota44.cart', JSON.stringify(c)); });
await nav(cam, 'estoque');
await cam.click('[data-tab=contagem]');
await cam.click('[data-start]');
await cam.waitForSelector('dialog.modal[open] [data-camera]');
await cam.click('dialog.modal[open] [data-camera]');
await cam.waitForFunction(() => /: 1$/.test([...document.querySelectorAll('[data-last]')].pop()?.textContent || ''), null, { timeout: 45000 });
await cam.waitForTimeout(4500);
const counted = await cam.evaluate(() => [...document.querySelectorAll('[data-last]')].pop().textContent);
ok(/: 1$/.test(counted), `contagem pela câmera não conta a mais: ${counted}`);
await closeTop(cam);
await cam.fill('dialog.modal[open] [data-q]', '7891234567895');
await cam.press('dialog.modal[open] [data-q]', 'Enter');
await cam.waitForSelector('.toast:has-text("fora desta contagem")');
ok((await cam.inputValue('dialog.modal[open] [data-q]')) === '', 'contagem: código desconhecido sai do campo');
ok(C.errors.length === 0, 'câmera sem erros de JS e sem bloqueio de segurança', C.errors.join(' | '));
await C.browser.close();
fs.rmSync(framePath, { force: true });

/* ====================================================== MOTOR DO SAFARI */
if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
  section('Motor do Safari (sem câmera neste computador)');
  process.env.E2E_ENGINE = 'webkit';
  const W = await open(db, { device: 'iPhone 13', theme: 'light' });
  const w = W.page;
  await login(w, 'siterota44@gmail.com');
  // etiqueta branca sobre camiseta preta: o caso que a biblioteca antiga nunca lia
  const zx = await w.evaluate(async ({ svg }) => {
    const box = Number(/viewBox="0 0 (\d+)/.exec(svg)[1]);
    const c = document.createElement('canvas');
    c.width = 1280; c.height = 720;
    const g = c.getContext('2d');
    g.fillStyle = '#111'; g.fillRect(0, 0, 1280, 720);
    g.fillStyle = '#fff'; g.fillRect(340, 180, 600, 360);
    g.fillStyle = '#000';
    for (const m of svg.matchAll(/<rect x="(\d+)" y="0" width="(\d+)"/g)) g.fillRect(360 + Number(m[1]) * (560 / box), 300, Number(m[2]) * (560 / box), 170);
    const { BarcodeDetector, prepareZXingModule } = await import('https://cdn.jsdelivr.net/npm/barcode-detector@3.2.3/ponyfill/+esm');
    prepareZXingModule({ overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? `https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.6/dist/reader/${path}` : prefix + path) } });
    const r = await new BarcodeDetector({ formats: ['code_128', 'ean_13', 'ean_8', 'upc_a'] }).detect(c);
    return r[0]?.rawValue;
  }, { svg: code128SVG(V.barcode, { height: 60 }) });
  ok(zx === V.barcode, `leitor do iPhone lê etiqueta em camiseta preta, com a segurança do site ligada (${zx})`);
  await nav(w, 'vendas');
  await w.selectOption('[data-f=period]', 'tudo');
  await w.click(`tr[data-open="${sale.id}"]`);
  await w.click('dialog.modal[open] [data-pdf]');
  await w.waitForSelector('dialog.modal[open] [data-name]', { timeout: 40000 });
  ok(true, 'PDF do pedido é gerado no Safari');
  await shot(w, 'iphone-pedido-pdf');
  ok(W.errors.length === 0, 'Safari sem erros de JS', W.errors.join(' | '));
  await W.browser.close();
  delete process.env.E2E_ENGINE;
}

await stopServer();
const fails = result();
process.exit(fails ? 1 : 0);
