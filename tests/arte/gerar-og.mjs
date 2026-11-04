// Prévia do link no WhatsApp e no Instagram (1200×630): o muro de grafite + o escudo.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const BRAND = fileURLToPath(new URL('../../assets/brand/', import.meta.url));
const b64 = (f) => fs.readFileSync(BRAND + f).toString('base64');
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
const font = fs.readFileSync(new URL('../../assets/fonts/bebas-neue-400-latin.woff2', import.meta.url)).toString('base64');
await p.setContent(`<!doctype html><style>
  @font-face { font-family: 'B'; src: url(data:font/woff2;base64,${font}); }
  body { margin:0; width:1200px; height:630px; background:#0b0b0c; position:relative; overflow:hidden; font-family:'B'; color:#fff; }
  .w { position:absolute; inset:0; background:url(data:image/webp;base64,${b64('grafite-escuro.webp')}) 0 0/900px; opacity:.6; }
  .s { position:absolute; left:70px; top:90px; width:380px; filter:drop-shadow(0 16px 40px rgba(0,0,0,.7)); }
  .t { position:absolute; left:500px; top:170px; }
  h1 { margin:0; font-size:150px; line-height:.9; font-weight:400; text-shadow:5px 5px 0 #e00000; }
  p { margin:22px 0 0; font-size:44px; letter-spacing:.04em; color:#eee; }
  .b { position:absolute; left:0; right:0; bottom:0; height:14px; background:#e00000; }
</style><div class="w"></div><img class="s" src="data:image/svg+xml;base64,${b64('escudo.svg')}"><div class="t"><h1>DIRETO<br>DAS RUAS</h1><p>RAP · SKATE · TRAP</p></div><div class="b"></div>`);
await p.waitForTimeout(400);
await p.screenshot({ path: `${BRAND}og-rota44.jpg`, type: 'jpeg', quality: 82 });
await b.close();
console.log('og pronta');
