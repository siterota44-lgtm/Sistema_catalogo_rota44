// O código de barras da etiqueta é legível de verdade? Desenha o SVG, passa para
// imagem e lê com o ZXing (a mesma biblioteca que o leitor de câmera usa no Safari).
import { chromium } from 'playwright-core';
import { code128SVG } from '../../assets/js/core/barcode.js';

const CODES = ['2440000000163', '2440000000170', '2449999999990', '123456', 'R44-001'];
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await b.newPage();
await page.setContent('<!doctype html><canvas></canvas>');
const lib = await (await fetch('https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js')).text();
await page.addScriptTag({ content: lib });
let fails = 0;
for (const c of CODES) {
  const svg = code128SVG(c, { height: 60 });
  const out = await page.evaluate(async ({ svg, c }) => {
    // 50 mm a 203 dpi ~ 400 px: o tamanho real da etiqueta impressa
    const cv = document.querySelector('canvas');
    cv.width = 400; cv.height = 90;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 400, 90);
    g.fillStyle = '#000';
    const box = Number(/viewBox="0 0 (\d+)/.exec(svg)[1]);
    const k = 400 / box;
    for (const m of svg.matchAll(/<rect x="(\d+)" y="0" width="(\d+)"/g)) g.fillRect(Number(m[1]) * k, 0, Number(m[2]) * k, 90);
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.CODE_128]);
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    const reader = new ZXing.BrowserMultiFormatReader(hints);
    try {
      const r = reader.decodeFromCanvas ? reader.decodeFromCanvas(cv) : await reader.decodeFromImage(undefined, cv.toDataURL());
      return r.getText();
    } catch (e) { return `ERRO: ${e.message || e}`; }
  }, { svg, c });
  const pass = out === c;
  if (!pass) fails += 1;
  console.log(pass ? '  ✓' : '  ✗', c, pass ? '' : `leu: ${out}`);
}
await b.close();
process.exit(fails ? 1 : 0);
