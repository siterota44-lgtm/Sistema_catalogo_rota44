// Roteiro no motor do Safari (WebKit), com a tela e o toque do iPhone: fotos de
// verdade (grandes e em pé), foto da categoria, 4 fotos por peça, catálogo e pedido
// no WhatsApp. Nada vai para o projeto real.
//   cd tests && npx playwright-core install webkit
//   node e2e/iphone.mjs       (precisa de `node netlify/build.mjs` antes)
process.env.E2E_ENGINE = process.env.E2E_ENGINE || 'webkit';
import { createDb, addUser, q, open, login, nav, shot, audit, ok, section, result, startServer, stopServer, BASE, uploads } from './harness.mjs';

const db = await createDb();
await addUser(db, 'siterota44@gmail.com', 'Rota 44', 'admin');
await db.query(`update public.store_settings set whatsapp='44999990000', instagram='@rota44.oficial', address='Av. Brasil, 44 - Maringá/PR', hours='Seg a sáb, 9h às 19h', email='contato@rota44.test', free_shipping_over=299, pix_discount_pct=5`);
await startServer();
const one = async (sql, params) => (await q(db, sql, params))[0];
const toastWith = (page, text) => page.waitForSelector(`.toast:has-text("${text}")`, { timeout: 15000 });

const X = await open(db, { device: 'iPhone 13', theme: 'light' });
const page = X.page;
// o WebKit de teste no Windows gera WebP; o Safari do iPhone não: devolve PNG. Aqui fica igual ao iPhone.
await X.ctx.addInitScript(() => {
  const url = HTMLCanvasElement.prototype.toDataURL;
  const blob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toDataURL = function (t, q) { return url.call(this, t === 'image/webp' ? 'image/png' : t, q); };
  HTMLCanvasElement.prototype.toBlob = function (cb, t, q) { return blob.call(this, cb, t === 'image/webp' ? 'image/png' : t, q); };
});
await login(page, 'siterota44@gmail.com');

/* Fotos como as do iPhone: grandes (12 MP), JPEG pesado. */
const bigPhoto = async (hue) => Buffer.from(await page.evaluate((h) => {
  const c = document.createElement('canvas'); c.width = 3024; c.height = 4032;
  const g = c.getContext('2d');
  // detalhe fino de verdade, como tecido e estampa: é o que pesa no JPEG
  let seed = 7 + h;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let y = 0; y < 4032; y += 6) for (let x = 0; x < 3024; x += 6) {
    g.fillStyle = `hsl(${(h + rnd() * 60) % 360} 70% ${25 + rnd() * 50}%)`;
    g.fillRect(x, y, 6, 6);
  }
  return c.toDataURL('image/jpeg', 0.9).split(',')[1];
}, hue), 'base64');

/* JPEG deitado (400×200) marcado como "girar 90°": é assim que o iPhone salva foto em pé. */
const landscape = Buffer.from(await page.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 400; c.height = 200;
  const g = c.getContext('2d'); g.fillStyle = '#c00'; g.fillRect(0, 0, 400, 200);
  return c.toDataURL('image/jpeg', 0.9).split(',')[1];
}), 'base64');
const exif = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.from([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0])]);
const seg = Buffer.alloc(4); seg[0] = 0xff; seg[1] = 0xe1; seg.writeUInt16BE(exif.length + 2, 2);
const rotated = Buffer.concat([landscape.subarray(0, 2), seg, exif, landscape.subarray(2)]);

section('Motor do Safari');
ok(await page.evaluate(() => navigator.userAgent.includes('iPhone') && !window.chrome), 'rodando como iPhone, sem Chrome');
const r = await page.evaluate(() => {
  const radius = (sel) => parseFloat(getComputedStyle(document.querySelector(sel)).borderTopLeftRadius);
  return { btn: radius('.btn'), icon: radius('.icon-btn'), card: radius('.card, .kpi') };
});
ok(r.btn >= 100 && r.icon >= 100, `botões redondos como na i7even (${r.btn}px)`);
ok(r.card >= 16, `cartões com canto de ${r.card}px`);
await shot(page, 'iphone-painel');

section('Foto da categoria');
await nav(page, 'cadastros');
await page.click('[data-edit]:has-text("Camisetas") >> nth=0');
await page.waitForSelector('dialog.modal[open] [data-photo]');
ok((await page.locator('dialog.modal[open] [data-photo] [data-file]').count()) === 2, 'no celular: câmera ou galeria');
ok((await audit(page, 'categoria', { mobile: true })).length === 0, 'formulário da categoria sem zoom nem toque pequeno');
await page.locator('dialog.modal[open] [data-photo] [data-file]').last().setInputFiles({ name: 'IMG_0001.jpeg', mimeType: 'image/jpeg', buffer: rotated });
await page.waitForSelector('dialog.modal[open] [data-photo] img');
await page.click('dialog.modal[open] [data-ok]');
await toastWith(page, 'Salvo');
const camisetas = await one(`select image_url from public.categories where slug='camisetas'`);
ok(camisetas.image_url.includes('/storage/v1/object/public/produtos/'), 'foto da categoria gravada');
const dim = await page.evaluate(async (url) => {
  const i = new Image(); i.src = url; await i.decode();
  return { w: i.naturalWidth, h: i.naturalHeight };
}, camisetas.image_url);
ok(dim.h > dim.w, `foto em pé continua em pé (${dim.w}×${dim.h})`);
await page.waitForSelector('.cat-thumb img');
ok(true, 'miniatura aparece na lista de categorias');
await shot(page, 'iphone-categorias');

section('Cadastrar peça com 4 fotos');
await nav(page, 'produtos');
await page.click('[data-new]');
await page.waitForSelector('dialog.modal[open] [data-f]');
await page.fill('[data-f] [name=name]', 'Camiseta Quatro Fotos');
const catId = (await one(`select id from public.categories where slug='camisetas-oversized'`)).id;
await page.selectOption('[data-f] [name=category_id]', catId);
const preto = (await one(`select id from public.colors where name='Preto'`)).id;
await page.click(`[data-color="${preto}"]`);
await page.waitForTimeout(60);
await page.evaluate(() => {
  document.querySelectorAll('[data-combo] [data-initial]').forEach((i) => { i.value = '3'; i.dispatchEvent(new Event('input', { bubbles: true })); });
});
await page.fill('[data-f] [name=base_price]', '14990');
ok((await audit(page, 'produto', { mobile: true })).length === 0, 'formulário da peça sem zoom nem toque pequeno', (await audit(page, 'produto', { mobile: true })).join(' | '));
const before = uploads.size;
const fotos = [];
for (const hue of [0, 60, 150, 220, 300]) fotos.push({ name: `IMG_${hue}.jpeg`, mimeType: 'image/jpeg', buffer: await bigPhoto(hue) });
ok(fotos.every((f) => f.buffer.length > 1048576), `fotos de teste maiores que o limite do Storage (${(fotos[0].buffer.length / 1048576).toFixed(1)} MB)`);
await page.setInputFiles('[data-gallery] [data-file]', fotos);
await page.waitForSelector('.toast:has-text("até 4 fotos")');
ok(true, 'selecionar 5 fotos avisa: entram só 4');
await page.waitForFunction(() => document.querySelectorAll('[data-gallery] .gallery-item').length === 4 && !document.querySelector('[data-gallery] .spinner'), null, { timeout: 90000 });
ok((await page.locator('[data-gallery] .gallery-add').count()) === 0, 'com 4 fotos o botão de adicionar sai');
ok((await page.textContent('[data-gallery]')).includes('4 de 4'), 'mostra 4 de 4');
await page.click('[data-gallery] .gallery-item:nth-child(4) [data-rm]');
await page.waitForSelector('[data-gallery] .gallery-add');
ok(true, 'tirou uma: dá para colocar outra');
await page.setInputFiles('[data-gallery] [data-file]', fotos[4]);
await page.waitForFunction(() => document.querySelectorAll('[data-gallery] .gallery-item').length === 4 && !document.querySelector('[data-gallery] .spinner'), null, { timeout: 60000 });
await shot(page, 'iphone-produto-fotos');
await page.click('.modal-foot [data-ok]');
await toastWith(page, 'Produto criado');
const prod = await one(`select * from public.products where name='Camiseta Quatro Fotos'`);
const imgs = await q(db, `select url from public.product_images where product_id=$1 order by sort`, [prod.id]);
ok(imgs.length === 4, `gravou ${imgs.length} fotos no produto`);
ok(prod.cover_url === imgs[0].url, 'a primeira é a capa');
const sent = [...uploads.values()].slice(before);
ok(sent.length >= 8 && sent.every((f) => f.body.length <= 1048576), `${sent.length} arquivos enviados, o maior com ${(Math.max(...sent.map((f) => f.body.length)) / 1024).toFixed(0)} KB (limite de 1 MB)`);
ok(sent.every((f) => f.path.endsWith('.jpg') && f.body[0] === 0xff && f.body[1] === 0xd8), 'no iPhone vai em JPEG de verdade (o Safari não gera WebP)');
ok((await q(db, `select id from public.product_variants where product_id=$1`, [prod.id])).length > 0, 'variações criadas');

section('Venda no iPhone');
await nav(page, 'caixa');
await page.waitForTimeout(150);
ok((await audit(page, 'caixa', { mobile: true })).length === 0, 'tela de caixa sem problema');

section('Catálogo');
const c = page;
await c.goto(`${BASE}/`);
await c.waitForSelector('.k-top');
await shot(c, 'iphone-catalogo-topo');
const top = await c.evaluate(() => {
  const s = document.querySelector('.k-shield');
  const p = document.querySelector('.k-brand p');
  const h = document.querySelector('.k-brand h1');
  const size = parseFloat(getComputedStyle(h).fontSize);
  const range = document.createRange();
  const t = h.firstChild; range.setStart(t, 0); range.setEnd(t, 4);
  const gap = h.querySelector('b').getBoundingClientRect().left - range.getBoundingClientRect().right;
  return { rot: getComputedStyle(s).transform, text: p.textContent, cut: p.scrollHeight > p.clientHeight + 1, gap: gap / size };
});
ok(top.rot === 'none', 'escudo reto');
ok(top.gap < 0.28, `44 perto do ROTA (${top.gap.toFixed(2)} da altura da letra)`);
ok(top.text === 'Streetwear pra quem vive a rua.', `frase nova: ${top.text}`);
ok(!top.cut, 'frase inteira, sem cortar');
const tile = c.locator('.k-cat:has-text("Camisetas") .k-cat-img img');
ok((await tile.count()) === 1, 'categoria com foto no topo');
await tile.evaluate(async (i) => { i.loading = 'eager'; await i.decode().catch(() => {}); });
ok(await tile.evaluate((i) => i.naturalWidth > 0), 'a foto da categoria carrega');
ok((await tile.getAttribute('data-full')) === camisetas.image_url, 'é a foto que a loja escolheu');
const cal = c.locator('.k-cat:has-text("Calças") .k-cat-img img');
ok((await cal.count()) === 1, 'categoria sem foto usa a foto de uma peça');

section('Rodapé com os dados da loja');
const foot = await c.textContent('.k-end');
for (const t of ['(44) 99999-0000', '@rota44.oficial', 'Av. Brasil, 44', 'Seg a sáb', 'contato@rota44.test', 'Troca em até 30 dias', 'Parcelamos em até 3x', '5% de desconto no Pix', 'Frete grátis acima de', 'Como comprar']) ok(foot.includes(t), `mostra: ${t}`);
ok(!/Sobre\s*Trocas|Privacidade|Área da loja/.test(foot), 'saiu Sobre, Trocas, Frete, Privacidade e o link da área da loja');
await c.locator('.k-end').scrollIntoViewIfNeeded();
await shot(c, 'iphone-catalogo-rodape');
ok((await audit(c, 'catalogo', { mobile: true })).length === 0, 'catálogo sem zoom, sem rolagem lateral e sem toque pequeno', (await audit(c, 'catalogo', { mobile: true })).join(' | '));

section('Barra fixa ao rolar');
await c.evaluate(() => window.scrollTo(0, 0));
await c.waitForFunction(() => getComputedStyle(document.querySelector('.k-chips')).visibility === 'hidden', null, { timeout: 5000 });
ok(true, 'no topo: só as fotos das categorias');
await c.evaluate(() => window.scrollTo(0, 500));
await c.waitForFunction(() => document.querySelector('.k-sticky').classList.contains('stuck'));
await c.waitForTimeout(250);
ok(await c.isVisible('.k-chip:has-text("Camisetas")'), 'rolou: os nomes entram na barra fixa');
await shot(c, 'iphone-catalogo-rolado');
await c.click('.k-chip:has-text("Camisetas")');
await c.waitForTimeout(150);
ok((await c.locator('.k-card').count()) >= 1, 'o nome filtra na hora');
await c.evaluate(() => window.scrollTo(0, 0));
await c.click('.k-cat:has-text("Tudo")');
await c.waitForTimeout(100);

section('A peça aparece sem ficar presa no cache');
await db.query(`update public.products set name='Calça Baggy Renomeada' where slug='calca-baggy-spike'`);
await c.reload();
await c.waitForSelector('.k-top');
ok((await c.textContent('#k-main')).includes('Calça Baggy Renomeada'), 'mudou no sistema, recarregou: já aparece');

section('Ficha com as 4 fotos');
await c.goto(`${BASE}/#p=${prod.slug}`);
await c.reload();
await c.waitForSelector('.k-pdp [data-gal] .k-gal-slide img');
ok((await c.locator('.k-gal-slide').count()) === 4, 'a ficha mostra as 4 fotos');
ok((await c.locator('.k-gal-dots button').count()) === 4, 'com 4 bolinhas');
await c.click('.k-gal-dots button:nth-child(3)');
await c.waitForFunction(() => { const t = document.querySelector('.k-gal-track'); return t.scrollLeft > t.clientWidth * 1.5; }, null, { timeout: 5000 });
ok(true, 'tocar na bolinha passa a foto');
const loaded = await c.evaluate(async () => {
  const list = [...document.querySelectorAll('.k-gal-slide img')];
  await Promise.all(list.map((i) => { i.loading = 'eager'; return i.decode().catch(() => {}); }));
  return list.map((i) => i.naturalWidth);
});
ok(loaded.every((w) => w > 0), `todas carregam (${loaded.join(', ')} px)`);
await shot(c, 'iphone-ficha');

section('Pedido no WhatsApp');
await c.click('.k-size:not(.off) >> nth=0');
await c.click('[data-add]');
await c.waitForSelector('.k-bag-bar:not([hidden])');
await c.click('.k-bag-bar');
await c.waitForSelector('[data-send]');
await c.fill('[data-send] [name=name]', 'Cliente iPhone');
ok((await audit(c, 'sacola', { mobile: true })).length === 0, 'sacola sem zoom nem toque pequeno');
await shot(c, 'iphone-sacola');
const [tab] = await Promise.all([X.ctx.waitForEvent('page'), c.click('.k-btn.wa[type=submit]')]);
await tab.waitForURL(/wa\.me/, { timeout: 15000 }).catch(() => {});
await c.waitForSelector('.k-sheet-head h2:has-text("Pedido enviado")');
ok(tab.url().includes('wa.me/5544999990000'), 'abre o WhatsApp da loja sem o Safari bloquear');
ok(decodeURIComponent(tab.url()).includes('Camiseta Quatro Fotos'), 'com a peça na mensagem');
ok(!/\bC\d+\b|R44-/.test(decodeURIComponent(tab.url())), 'mensagem sem código interno');
ok((await q(db, `select id from public.catalog_requests`)).length === 1, 'e o pedido entra no sistema');

ok(X.errors.length === 0, 'sem erro de JS no Safari', X.errors.join(' | '));
await X.browser.close();
await stopServer();
const fails = result();
process.exit(fails ? 1 : 0);
