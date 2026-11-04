// Gera a arte de grafite do fundo (original, feita aqui): um azulejo sem emenda
// com tags, throw-ups, coroas, setas, respingos e escorridos nas cores do escudo.
// Saída: assets/brand/grafite-escuro.webp e grafite-claro.webp (fundo transparente).
// Rodar: cd tests && node arte/gerar-grafite.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../../assets/brand/', import.meta.url));
const FONTS = {
  'Sedgwick Ave Display': 'https://fonts.gstatic.com/s/sedgwickavedisplay/v23/xfuu0XPgU3jZPUoUo3ScvmPi-NapQ8OxM2cz.ttf',
  'Permanent Marker': 'https://fonts.gstatic.com/s/permanentmarker/v16/Fh4uPib9Iyv2ucM6pGQMWimMp004Hao.ttf',
  'Rubik Wet Paint': 'https://fonts.gstatic.com/s/rubikwetpaint/v2/HTx0L20uMDGHgdULcpTF3Oe4d_-F-w.ttf',
  'Rubik Spray Paint': 'https://fonts.gstatic.com/s/rubikspraypaint/v1/WnzhHBAoeBPUDTB4EWR82y6EXWPH-Ro-.ttf',
  'Bowlby One': 'https://fonts.gstatic.com/s/bowlbyone/v25/taiPGmVuC4y96PFeqp8smo4.ttf',
};
const faces = {};
for (const [k, u] of Object.entries(FONTS)) {
  faces[k] = Buffer.from(await (await fetch(u)).arrayBuffer()).toString('base64');
}

const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const p = await b.newPage();
await p.setContent('<!doctype html><canvas></canvas>');

const res = await p.evaluate(async ({ faces }) => {
  for (const [k, v] of Object.entries(faces)) {
    const f = new FontFace(k, `url(data:font/ttf;base64,${v})`);
    await f.load();
    document.fonts.add(f);
  }
  const S = 1300;

  function make(palette, seed0) {
    let seed = seed0;
    const R = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const rr = (a, c) => a + R() * (c - a);
    const pick = (l) => l[Math.floor(R() * l.length)];
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const g = c.getContext('2d');

    // desenha com repetição nas bordas: é o que faz o azulejo não ter emenda.
    // O sorteio de cada elemento é feito uma vez só, fora de wrap.
    const wrap = (x, y, fn) => {
      for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
        g.save(); g.translate(x + dx, y + dy); fn(); g.restore();
      }
    };
    const dots = (r, n) => Array.from({ length: n }, () => {
      const a = R() * 6.283; const d = Math.pow(R(), 2.1) * r;
      return [Math.cos(a) * d, Math.sin(a) * d, rr(0.5, 3.4) * (1 - d / r / 1.4)];
    });
    const drawDots = (list, col) => {
      g.fillStyle = col;
      for (const [x, y, s] of list) { g.beginPath(); g.arc(x, y, Math.max(s, 0.3), 0, 6.283); g.fill(); }
    };
    const dripList = (w, n, lw) => Array.from({ length: n }, () => [rr(-w / 2, w / 2), rr(20, 150), rr(lw * 0.6, lw * 1.5), rr(-1, 1)]);
    const drawDrips = (list, y0, col) => {
      g.strokeStyle = col; g.fillStyle = col; g.lineCap = 'round';
      for (const [x, l, lw, off] of list) {
        g.lineWidth = lw;
        g.beginPath(); g.moveTo(x, y0); g.lineTo(x + off, y0 + l); g.stroke();
        g.beginPath(); g.arc(x + off, y0 + l, lw * 0.85, 0, 6.283); g.fill();
      }
    };
    const crown = (s, col) => {
      g.strokeStyle = col; g.lineWidth = s * 0.13; g.lineJoin = 'miter'; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-s, s * 0.55); g.lineTo(-s * 1.05, -s * 0.5); g.lineTo(-s * 0.45, 0); g.lineTo(0, -s * 0.85);
      g.lineTo(s * 0.45, 0); g.lineTo(s * 1.05, -s * 0.5); g.lineTo(s, s * 0.55); g.closePath(); g.stroke();
      g.beginPath(); g.moveTo(-s, s * 0.9); g.lineTo(s, s * 0.9); g.stroke();
    };
    const arrow = (l, col, lw, a, c2) => {
      g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(-l / 2, 0); g.bezierCurveTo(-l / 5, a, l / 5, c2, l / 2, 0); g.stroke();
      g.beginPath(); g.moveTo(l / 2 - lw * 5, -lw * 4); g.lineTo(l / 2, 0); g.lineTo(l / 2 - lw * 5, lw * 4); g.stroke();
    };
    const xcircle = (s, col) => {
      g.strokeStyle = col; g.lineWidth = s * 0.2; g.lineCap = 'round';
      g.beginPath(); g.arc(0, 0, s, 0, 6.283); g.stroke();
      g.lineWidth = s * 0.26;
      g.beginPath(); g.moveTo(-s * 1.1, s * 1.1); g.lineTo(s * 1.15, -s * 1.15);
      g.moveTo(-s * 0.85, -s * 0.85); g.lineTo(s * 0.85, s * 0.85); g.stroke();
    };
    const star = (s, col) => {
      g.fillStyle = col; g.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? s * 0.42 : s; const a = -1.5708 + i * 0.62832;
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath(); g.fill();
    };

    const { ink, ink2, red, ghost } = palette;
    const TAGS = ['ROTA 44', 'R44', '44', 'NA RUA', 'RAP', 'SKATE', 'TRAP', 'STREET', 'UNDERGROUND', 'ROTA', 'QUEBRADA',
      'CREW 44', 'RUA', 'FREESTYLE', 'BOOM BAP', 'VANDAL', 'OLD SCHOOL', 'NO CORRE', 'ALL CITY', 'HIP HOP'];
    const FACES = ['Sedgwick Ave Display', 'Permanent Marker', 'Rubik Wet Paint', 'Sedgwick Ave Display', 'Rubik Spray Paint'];

    // camada de trás: tags grandes e apagadas
    for (let n = 0; n < 5; n++) {
      const x = rr(0, S); const y = rr(0, S); const rot = rr(-0.35, 0.25); const sz = rr(120, 230);
      const t = pick(TAGS); const f = pick(['Sedgwick Ave Display', 'Permanent Marker']);
      wrap(x, y, () => { g.rotate(rot); g.font = `${sz}px "${f}"`; g.fillStyle = ghost; g.textAlign = 'center'; g.fillText(t, 0, 0); });
    }
    // pinceladas secas vermelhas com coroa ou X por cima (nada de bola chapada)
    for (let n = 0; n < 2; n++) {
      const x = rr(0, S); const y = rr(0, S); const rot = rr(-0.5, 0.3); const l = rr(240, 460); const w = rr(46, 92);
      const streaks = Array.from({ length: Math.round(w / 2.6) }, (_, i) => [
        -w / 2 + i * 2.6 + rr(-0.8, 0.8), -l / 2 + rr(0, l * 0.1), l / 2 - rr(0, l * 0.12), rr(2.2, 3.8), R() < 0.12 ? rr(0.2, 0.7) * l - l / 2 : null,
      ]);
      const ds = dots(l * 0.62, 60); const dr = dripList(l * 0.6, 4, 2.6);
      const mark = R() < 0.5 ? 'crown' : 'x'; const ms = w * 0.5;
      wrap(x, y, () => {
        g.rotate(rot); g.strokeStyle = red; g.lineCap = 'round';
        for (const [yy, x0, x1, lw, gap] of streaks) {
          g.lineWidth = lw; g.beginPath();
          if (gap !== null) { g.moveTo(x0, yy); g.lineTo(gap - 8, yy); g.moveTo(gap + 18, yy); g.lineTo(x1, yy); }
          else { g.moveTo(x0, yy); g.lineTo(x1, yy); }
          g.stroke();
        }
        drawDots(ds, red); drawDrips(dr, w * 0.42, red);
        if (mark === 'crown') crown(ms, ink); else xcircle(ms * 0.8, ink);
      });
    }
    // névoa de spray: pontinhos densos no meio, soltos na borda
    for (let n = 0; n < 2; n++) {
      const x = rr(0, S); const y = rr(0, S); const r = rr(70, 130);
      const ds = Array.from({ length: 520 }, () => {
        const a = R() * 6.283; const d = (R() + R() + R()) / 3 * r * 1.5;
        return [Math.cos(a) * d, Math.sin(a) * d, rr(0.5, 1.5)];
      });
      const col = R() < 0.5 ? red : ink2;
      wrap(x, y, () => drawDots(ds, col));
    }
    // throw-ups: letra gorda com contorno (bubble)
    for (let n = 0; n < 3; n++) {
      const x = rr(0, S); const y = rr(0, S); const rot = rr(-0.18, 0.12); const sz = rr(95, 170);
      const t = pick(['44', 'R44', 'ROTA', 'RUA', 'RAP', 'NA RUA']); const tone = pick([ink, red]);
      const dr = dripList(sz * 1.5, 4, sz * 0.02);
      wrap(x, y, () => {
        g.rotate(rot); g.font = `${sz}px "Bowlby One"`; g.textAlign = 'center'; g.lineJoin = 'round';
        g.strokeStyle = tone; g.lineWidth = sz * 0.17; g.strokeText(t, sz * 0.05, sz * 0.07);
        g.globalCompositeOperation = 'destination-out';
        g.lineWidth = sz * 0.07; g.strokeStyle = '#000'; g.strokeText(t, 0, 0); g.fillStyle = '#000'; g.fillText(t, 0, 0);
        g.globalCompositeOperation = 'source-over';
        g.strokeStyle = tone; g.lineWidth = sz * 0.035; g.strokeText(t, 0, 0);
        drawDrips(dr, sz * 0.22, tone);
      });
    }
    // tags por cima, em grade embaralhada: cobre o azulejo sem amontoar
    const grid = 4; const cell = S / grid;
    const slots = [];
    for (let i = 0; i < grid; i++) for (let j = 0; j < grid; j++) slots.push([i, j]);
    slots.sort(() => R() - 0.5);
    for (const [i, j] of slots) {
      const x = (i + rr(0.1, 0.9)) * cell; const y = (j + rr(0.2, 0.95)) * cell; const kind = R();
      const col = R() < 0.1 ? red : pick([ink, ink2, ink2]);
      if (kind < 0.62) {
        const t = pick(TAGS); const f = pick(FACES); const rot = rr(-0.3, 0.2); const sz = rr(36, 88);
        const dr = R() < 0.65 ? dripList(sz * Math.min(t.length, 6) * 0.42, 3, 2.2) : [];
        wrap(x, y, () => { g.rotate(rot); g.font = `${sz}px "${f}"`; g.fillStyle = col; g.textAlign = 'center'; g.fillText(t, 0, 0); drawDrips(dr, sz * 0.08, col); });
      } else if (kind < 0.72) {
        const rot = rr(-0.3, 0.3); const s = rr(22, 42);
        wrap(x, y, () => { g.rotate(rot); crown(s, col); });
      } else if (kind < 0.82) {
        const rot = rr(-0.5, 0.5); const l = rr(110, 230); const lw = rr(3, 6); const a = rr(-50, 50); const c2 = rr(-50, 50);
        wrap(x, y, () => { g.rotate(rot); arrow(l, col, lw, a, c2); });
      } else if (kind < 0.9) {
        const rot = rr(-0.2, 0.2); const s = rr(20, 38); const dr = dripList(s * 1.4, 3, s * 0.08);
        wrap(x, y, () => { g.rotate(rot); xcircle(s, col); drawDrips(dr, s * 0.9, col); });
      } else {
        const rot = rr(-0.4, 0.4); const s = rr(14, 30);
        wrap(x, y, () => { g.rotate(rot); star(s, col); });
      }
    }
    // respingos soltos
    for (let n = 0; n < 8; n++) {
      const x = rr(0, S); const y = rr(0, S); const ds = dots(rr(30, 90), 18); const col = R() < 0.3 ? red : ink2;
      wrap(x, y, () => drawDots(ds, col));
    }
    return c.toDataURL('image/webp', 0.5).split(',')[1];
  }

  return {
    escuro: make({ ink: '#e4e4e6', ink2: '#9a9ca2', red: '#9c1b1b', ghost: 'rgba(255,255,255,.12)' }, 4404),
    claro: make({ ink: '#1c1c1c', ink2: '#4a4c52', red: '#8f1f1f', ghost: 'rgba(20,20,20,.1)' }, 4404),
  };
}, { faces });

for (const [k, v] of Object.entries(res)) {
  fs.writeFileSync(`${OUT}grafite-${k}.webp`, Buffer.from(v, 'base64'));
  console.log(k, Math.round(v.length * 0.75 / 1024), 'KB');
}

// Prévia dos dois temas lado a lado
const q = await b.newPage({ viewport: { width: 1500, height: 760 } });
await q.setContent(`<body style="margin:0;display:grid;grid-template-columns:1fr 1fr;height:760px">
  <div style="background:#0d0d0e url(data:image/webp;base64,${res.escuro}) 0 0/750px"></div>
  <div style="background:#f1efeb url(data:image/webp;base64,${res.claro}) 0 0/750px"></div></body>`);
await q.waitForTimeout(300);
await q.screenshot({ path: 'out/grafite.png' });
await b.close();
