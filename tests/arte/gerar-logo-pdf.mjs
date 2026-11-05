// Escudo em JPEG sobre o preto do cabeçalho do PDF do pedido (o gerador de PDF não lê SVG).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const BRAND = fileURLToPath(new URL('../../assets/brand/', import.meta.url));
const svg = fs.readFileSync(`${BRAND}escudo.svg`).toString('base64');
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const p = await b.newPage();
await p.setContent('<!doctype html><canvas></canvas>');
const jpg = await p.evaluate(async (data) => {
  const i = new Image();
  i.src = `data:image/svg+xml;base64,${data}`;
  await i.decode();
  const c = document.querySelector('canvas');
  c.width = 340; c.height = 400;
  const g = c.getContext('2d');
  g.fillStyle = '#0a0a0b';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(i, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.92).split(',')[1];
}, svg);
fs.writeFileSync(`${BRAND}rota44-logo-pdf.jpg`, Buffer.from(jpg, 'base64'));
await b.close();
console.log('logo do PDF pronta');
