/**
 * Gráficos em SVG puro - sem biblioteca externa.
 *
 * Desenha no tamanho real do contêiner (ResizeObserver) em vez de esticar um
 * viewBox fixo: assim o texto não deforma no celular e o traço fica sempre
 * com a mesma espessura.
 */

import { esc, money } from '../core/utils.js';

const VIZ = ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)', 'var(--viz-4)', 'var(--viz-5)', 'var(--viz-6)'];

/* ---------------------------------------------------------- escala Y -- */

/** Arredonda o topo do eixo para um número "redondo" (1, 2, 2.5 ou 5 × 10ⁿ). */
function niceMax(value) {
  if (!(value > 0)) return 10;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const norm = value / base;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * base;
}

function shortNumber(n) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

/* -------------------------------------------------- gráfico de linhas -- */

/**
 * @param {HTMLElement} host
 * @param {{labels: string[], series: {name: string, values: number[]}[],
 *          format?: (n: number) => string, height?: number}} spec
 */
export function lineChart(host, spec) {
  const state = {
    ...spec,
    format: spec.format || money,
    height: spec.height || 230,
    series: spec.series.map((s, i) => ({ ...s, color: s.color || VIZ[i % VIZ.length] })),
  };

  host.classList.add('chart');
  host.innerHTML = '';

  const svgHolder = document.createElement('div');
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  host.append(svgHolder, tip);

  let geometry = null;

  function draw() {
    const width = Math.max(host.clientWidth || 640, 260);
    const { labels, series, height } = state;
    const padL = 46;
    const padR = 52;      // espaço para o rótulo do último ponto
    const padT = 12;
    const padB = 26;
    const plotW = Math.max(width - padL - padR, 40);
    const plotH = Math.max(height - padT - padB, 40);

    const peak = Math.max(0, ...series.flatMap((s) => s.values.map((v) => Number(v) || 0)));
    const empty = peak <= 0;
    // topo nunca abaixo de 4: cada divisão vale pelo menos 1 (sem "2, 2, 1" repetido)
    const top = Math.max(niceMax(peak * 1.08), 4);
    const n = labels.length;

    const x = (i) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const y = (v) => padT + plotH - (Math.max(Number(v) || 0, 0) / top) * plotH;

    geometry = { x, y, padL, padT, plotW, plotH, n, width, height };

    // Grade + eixo Y (4 divisões)
    const ticks = 4;
    let grid = '';
    let yAxis = '';
    for (let t = 0; t <= ticks; t++) {
      const val = (top / ticks) * t;
      const py = y(val);
      grid += `<line x1="${padL}" y1="${py}" x2="${padL + plotW}" y2="${py}"/>`;
      yAxis += `<text class="y" x="${padL - 9}" y="${py + 4}">${esc(shortNumber(val))}</text>`;
    }

    /*
     * Eixo X: a quantidade de rótulos vem da largura disponível, não de um
     * número fixo - num iPhone de 390px cabem 4, num monitor cabem 8.
     * O último é sempre exibido; o penúltimo some se fosse encostar nele.
     */
    const maxLabels = Math.max(2, Math.floor(plotW / 58));
    const stride = Math.max(1, Math.ceil(n / maxLabels));
    const folga = plotW / Math.max(n - 1, 1) * stride;   // distância entre rótulos
    let xAxis = '';
    for (let i = 0; i < n; i++) {
      const ultimo = i === n - 1;
      if (i % stride !== 0 && !ultimo) continue;
      // evita o encavalamento do penúltimo com o último
      if (!ultimo && n - 1 - i < stride * 0.6 && folga < 70) continue;
      xAxis += `<text class="x" x="${x(i)}" y="${padT + plotH + 17}">${esc(labels[i])}</text>`;
    }

    // Linhas + área + rótulo direto no último ponto
    let paths = '';
    for (const s of state.series) {
      const pts = s.values.map((v, i) => `${x(i)},${y(v)}`);
      if (!pts.length) continue;
      const d = `M${pts.join('L')}`;
      const areaD = `${d}L${x(s.values.length - 1)},${y(0)}L${x(0)},${y(0)}Z`;
      paths += `<path class="chart-area" fill="${s.color}" d="${areaD}"/>`;
      paths += `<path class="chart-line" stroke="${s.color}" d="${d}" vector-effect="non-scaling-stroke"/>`;

      const li = s.values.length - 1;
      const last = Number(s.values[li]) || 0;
      paths += `<circle class="chart-dot" cx="${x(li)}" cy="${y(last)}" r="3.5" fill="${s.color}"/>`;
      paths += `<text class="chart-endlabel" x="${x(li) + 9}" y="${y(last) + 4}">${esc(shortNumber(last))}</text>`;
    }

    svgHolder.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"
           role="img" aria-label="${esc(state.ariaLabel || 'Gráfico de linha')}">
        <g class="chart-grid">${grid}</g>
        <g class="chart-axis">${yAxis}${xAxis}</g>
        ${empty ? `<text class="chart-empty" x="${padL + plotW / 2}" y="${padT + plotH / 2}">Ainda sem vendas neste período</text>` : paths}
        <g class="chart-hover" hidden>
          <line class="chart-crosshair" y1="${padT}" y2="${padT + plotH}"/>
        </g>
        <rect class="chart-hit" x="${padL}" y="${padT}" width="${plotW}" height="${plotH}"/>
      </svg>`;
  }

  /* --------------------------------------------------------- interação */

  function indexFromEvent(evt) {
    if (!geometry) return -1;
    const rect = svgHolder.querySelector('svg').getBoundingClientRect();
    const clientX = evt.touches?.[0]?.clientX ?? evt.clientX;
    const scale = geometry.width / rect.width;
    const px = (clientX - rect.left) * scale;
    const ratio = (px - geometry.padL) / geometry.plotW;
    return Math.round(Math.min(Math.max(ratio, 0), 1) * (geometry.n - 1));
  }

  function showAt(i, evt) {
    if (i < 0 || !geometry) return;
    const svg = svgHolder.querySelector('svg');
    const hover = svg.querySelector('.chart-hover');
    const line = hover.querySelector('line');
    hover.removeAttribute('hidden');
    line.setAttribute('x1', geometry.x(i));
    line.setAttribute('x2', geometry.x(i));

    tip.innerHTML = `
      <div class="tip-title">${esc(state.labels[i] ?? '')}</div>
      ${state.series.map((s) => `
        <div class="tip-row">
          <span style="display:inline-flex;align-items:center;gap:6px">
            <span class="tip-swatch" style="background:${s.color}"></span>${esc(s.name)}
          </span>
          <b>${esc(state.format(s.values[i] ?? 0))}</b>
        </div>`).join('')}`;

    const rect = svg.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const left = rect.left - hostRect.left + (geometry.x(i) / geometry.width) * rect.width;
    const topPx = rect.top - hostRect.top + 18;
    tip.style.left = `${Math.min(Math.max(left, 70), host.clientWidth - 70)}px`;
    tip.style.top = `${topPx}px`;
    tip.classList.add('on');
  }

  function hide() {
    tip.classList.remove('on');
    svgHolder.querySelector('.chart-hover')?.setAttribute('hidden', '');
  }

  const onMove = (evt) => showAt(indexFromEvent(evt), evt);

  host.addEventListener('pointermove', onMove);
  host.addEventListener('pointerleave', hide);
  host.addEventListener('touchmove', onMove, { passive: true });
  host.addEventListener('touchend', hide);

  draw();

  const ro = new ResizeObserver(() => draw());
  ro.observe(host);

  return {
    update(next) {
      Object.assign(state, next);
      if (next.series) {
        state.series = next.series.map((s, i) => ({ ...s, color: s.color || VIZ[i % VIZ.length] }));
      }
      draw();
    },
    destroy() {
      ro.disconnect();
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', hide);
    },
  };
}

/** Legenda em HTML - sempre presente quando há 2+ séries. */
export function legendHTML(series) {
  return series
    .map((s, i) => `
      <span class="legend-item">
        <span class="legend-swatch" style="background:${s.color || VIZ[i % VIZ.length]}"></span>${esc(s.name)}
      </span>`)
    .join('');
}

/** Tabela equivalente ao gráfico - alternativa acessível e conferível. */
export function chartTableHTML(labels, series, format = money) {
  return `
    <table class="chart-table">
      <thead>
        <tr><th>Período</th>${series.map((s) => `<th>${esc(s.name)}</th>`).join('')}</tr>
      </thead>
      <tbody>
        ${labels.map((label, i) => `
          <tr>
            <td>${esc(label)}</td>
            ${series.map((s) => `<td>${esc(format(s.values[i] ?? 0))}</td>`).join('')}
          </tr>`).join('')}
      </tbody>
    </table>`;
}

/* ------------------------------------------------- barras horizontais -- */

/**
 * Ranking: uma série só, mesmo matiz para todas as barras (o comprimento já
 * carrega a informação - cor por posição seria ruído).
 */
export function rankBarsHTML(rows, { format = money, color = 'var(--viz-1)', emptyText = 'Sem dados no período.' } = {}) {
  if (!rows.length) return `<p class="small dim">${esc(emptyText)}</p>`;
  const max = Math.max(...rows.map((r) => Math.abs(r.value) || 0), 1);
  return `
    <div class="rank">
      ${rows.map((r, i) => `
        <div class="rank-row">
          <span class="rank-name truncate" title="${esc(r.label)}">${esc(r.label)}</span>
          <span class="rank-value money-sensitive">${esc(format(r.value))}</span>
          ${r.sub ? `<span class="rank-sub" style="grid-column:1/-1">${esc(r.sub)}</span>` : ''}
          <span class="rank-track">
            <span class="rank-fill" style="width:${((Math.abs(r.value) / max) * 100).toFixed(1)}%;
                  background:${color}; animation-delay:${i * 40}ms"></span>
          </span>
        </div>`).join('')}
    </div>`;
}
