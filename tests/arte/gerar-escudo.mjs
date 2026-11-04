// Redesenha o escudo da Rota 44 em vetor (a partir das medidas do logo original),
// para ficar nítido em qualquer tamanho, e gera os ícones PNG do app.
import opentype from 'opentype.js';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const BRAND = new URL('../../assets/brand/', import.meta.url);
const ttf = await (await fetch('https://fonts.gstatic.com/s/arimo/v36/P5sfzZCDf9_T_3cV7NCUECyoxNk3CstsBw.ttf')).arrayBuffer();
const font = opentype.parse(ttf);
function textPath(txt, x0, y0, w, h) {
  const p = font.getPath(txt, 0, 0, 100);
  const bb = p.getBoundingBox();
  const sx = w / (bb.x2 - bb.x1), sy = h / (bb.y2 - bb.y1);
  const f = (n) => +n.toFixed(1);
  const X = (x) => f(x0 + (x - bb.x1) * sx), Y = (y) => f(y0 + (y - bb.y1) * sy);
  return p.commands.map((c) => {
    if (c.type === 'M') return `M${X(c.x)} ${Y(c.y)}`;
    if (c.type === 'L') return `L${X(c.x)} ${Y(c.y)}`;
    if (c.type === 'Q') return `Q${X(c.x1)} ${Y(c.y1)} ${X(c.x)} ${Y(c.y)}`;
    if (c.type === 'C') return `C${X(c.x1)} ${Y(c.y1)} ${X(c.x2)} ${Y(c.y2)} ${X(c.x)} ${Y(c.y)}`;
    return 'Z';
  }).join('');
}
const C = 223;
// metade esquerda; a direita é o espelho (o logo é simétrico)
function shield(pts) {
  const m = (x) => +(2 * C - x).toFixed(1);
  const { top, dip, peak, tip, waist, belly, bottom } = pts;
  return `M${C} ${top}`
    + `C${C - 22} ${top + 9} ${dip[0] + 26} ${dip[1]} ${dip[0]} ${dip[1]}`
    + `C${dip[0] - 30} ${dip[1]} ${peak[0] + 22} ${peak[1]} ${peak[0]} ${peak[1]}`
    + `C${peak[0] - 22} ${peak[1] + 2} ${tip[0] + 26} ${tip[1] - 32} ${tip[0]} ${tip[1]}`
    + `C${tip[0] + 18} ${tip[1] + 14} ${waist[0]} ${waist[1] - 24} ${waist[0]} ${waist[1]}`
    + `C${waist[0]} ${waist[1] + 54} ${belly[0]} ${belly[1] - 62} ${belly[0]} ${belly[1]}`
    + `C${belly[0]} ${belly[1] + 92} ${belly[0] + 108} ${bottom - 50} ${C} ${bottom}`
    + `C${m(belly[0] + 108)} ${bottom - 50} ${m(belly[0])} ${belly[1] + 92} ${m(belly[0])} ${belly[1]}`
    + `C${m(belly[0])} ${belly[1] - 62} ${m(waist[0])} ${waist[1] + 54} ${m(waist[0])} ${waist[1]}`
    + `C${m(waist[0])} ${waist[1] - 24} ${m(tip[0] + 18)} ${tip[1] + 14} ${m(tip[0])} ${tip[1]}`
    + `C${m(tip[0] + 26)} ${tip[1] - 32} ${m(peak[0] - 22)} ${peak[1] + 2} ${m(peak[0])} ${peak[1]}`
    + `C${m(peak[0] + 22)} ${peak[1]} ${m(dip[0] - 30)} ${dip[1]} ${m(dip[0])} ${dip[1]}`
    + `C${m(dip[0] + 26)} ${dip[1]} ${C + 22} ${top + 9} ${C} ${top}Z`;
}
const outer = shield({ top: 24, dip: [150, 48], peak: [84, 28], tip: [0, 108], waist: [35, 162], belly: [0, 345], bottom: 547 });
const white = shield({ top: 38, dip: [150, 59], peak: [84, 42], tip: [13, 108], waist: [47, 162], belly: [4, 345], bottom: 533 });
const inner = shield({ top: 66, dip: [152, 83], peak: [88, 71], tip: [49, 107], waist: [70, 162], belly: [28, 345], bottom: 512 });
const rota = textPath('ROTA', 94, 117, 256, 57);
const quatroA = textPath('4', 73, 256, 134, 152);
const quatroB = textPath('4', 237, 256, 134, 152);
const defs = `<clipPath id="r44-i"><path d="${inner}"/></clipPath>`;
const body = `
  <path d="${outer}" fill="#3a4a72"/>
  <path d="${white}" fill="#fff"/>
  <g clip-path="url(#r44-i)">
    <rect x="0" y="0" width="446" height="191" fill="#2b2b2b"/>
    <rect x="0" y="211" width="446" height="340" fill="#f80000"/>
  </g>
  <path d="${rota}" fill="#fff" stroke="#fff" stroke-width="5" stroke-linejoin="round"/>
  <path d="${quatroA}${quatroB}" fill="#fff" stroke="#fff" stroke-width="9" stroke-linejoin="miter" stroke-miterlimit="6"/>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 16 458 538" role="img" aria-label="Rota 44"><defs>${defs}</defs>${body}</svg>\n`;
fs.writeFileSync(new URL('escudo.svg', BRAND), svg);

const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const shoot = async (size, bg, pad, name) => {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  await p.setContent(`<!doctype html><body style="margin:0;background:${bg};display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${size - 2 * pad}px;height:${size - 2 * pad}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body>`);
  await p.screenshot({ path: new URL(name, BRAND).pathname.replace(/^\/([A-Z]:)/, '$1').replace(/%20/g, ' ').replace(/%C3%81/g, 'Á'), omitBackground: bg === 'transparent' });
  await p.close();
};
await shoot(512, '#141414', 48, 'icone-512.png');
await shoot(192, '#141414', 18, 'icone-192.png');
await shoot(180, '#141414', 16, 'apple-touch.png');
await shoot(64, 'transparent', 2, 'favicon-64.png');
// comparação com o original
const p = await b.newPage({ viewport: { width: 900, height: 560 } });
const orig = fs.readFileSync('../../Imagens/Screenshot_1.png').toString('base64');
await p.setContent(`<body style="margin:0;background:#000;display:flex;gap:6px">
  <div style="width:446px;height:547px;overflow:hidden;position:relative"><img style="position:absolute;left:-146px;top:-107px" src="data:image/png;base64,${orig}"></div>
  <div style="width:446px;height:547px"><svg viewBox="0 0 446 547" width="446" height="547"><defs>${defs}</defs>${body}</svg></div></body>`);
await p.screenshot({ path: 'out/escudo.png' });
await b.close();
console.log('ok', svg.length);
