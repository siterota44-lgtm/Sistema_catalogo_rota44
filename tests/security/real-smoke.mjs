// Abre o site local (dist/) no Chrome falando com o Supabase REAL, sem imitação.
// Não grava nada. Serve para conferir a ligação de verdade: antes do schema.sql
// mostra "Falta preparar o banco"; depois, entra no sistema.
//   cd tests && ROTA44_EMAIL=... ROTA44_PASS=... node security/real-smoke.mjs
// A senha vem do ambiente e não fica em arquivo nenhum.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../../dist/', import.meta.url));
const OUT = fileURLToPath(new URL('../out/shots/', import.meta.url));
const PORT = 8767;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const csp = /Content-Security-Policy: (.+)/.exec(fs.readFileSync(`${DIST}_headers`, 'utf8'))[1].replace(/;\s*upgrade-insecure-requests/, '');
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  if (p === '/sistema') p = '/sistema.html';
  const file = path.join(DIST, p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'content-security-policy': csp });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(PORT, r));

const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errors.push(`console: ${m.text()}`); });

await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => !document.querySelector('.cat-boot'), { timeout: 20000 });
console.log('catálogo:', (await page.textContent('#catalog')).replace(/\s+/g, ' ').trim().slice(0, 120));
await page.screenshot({ path: `${OUT}real-catalogo.png` });

await page.goto(`http://localhost:${PORT}/sistema`);
await page.waitForSelector('#email', { timeout: 20000 });
if (process.env.ROTA44_EMAIL && process.env.ROTA44_PASS) {
  await page.fill('#email', process.env.ROTA44_EMAIL);
  await page.fill('#password', process.env.ROTA44_PASS);
  await page.click('button[type=submit]');
  await page.waitForSelector('.gate-card h1, .app, [data-error]:not(.hide)', { timeout: 25000 });
  console.log('sistema após login:', (await page.textContent('#app')).replace(/\s+/g, ' ').trim().slice(0, 200));
  await page.screenshot({ path: `${OUT}real-sistema.png` });
}
console.log('erros de JS:', errors.length ? errors.join(' | ') : 'nenhum');
await b.close();
server.close();
