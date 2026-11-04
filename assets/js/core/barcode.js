/**
 * Code 128 em SVG, sem biblioteca: a etiqueta sai nítida em qualquer impressora.
 * Código numérico usa pares de dígitos (conjunto C), porque fica bem mais curto
 * na etiqueta de 50 mm; texto usa o conjunto B.
 */

const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const CODE_B = 100;
const START_B = 104;
const START_C = 105;
const STOP = 106;

/**
 * Sequência de códigos Code 128, com o dígito verificador.
 * Só dígitos: pares no conjunto C; se a quantidade for ímpar (o nosso código tem
 * 13), o último vai no conjunto B. A barra fica quase 2× mais larga do que com
 * tudo em B, o que faz diferença na etiqueta de 50 mm numa térmica de 203 dpi.
 */
export function code128Values(text) {
  const s = String(text);
  const digits = /^\d+$/.test(s) && s.length >= 4;
  const values = [digits ? START_C : START_B];
  if (digits) {
    const even = s.length - (s.length % 2);
    for (let i = 0; i < even; i += 2) values.push(Number(s.slice(i, i + 2)));
    if (even < s.length) values.push(CODE_B, s.charCodeAt(even) - 32);
  } else {
    for (const ch of s) {
      const code = ch.charCodeAt(0);
      values.push(code >= 32 && code <= 126 ? code - 32 : 0);
    }
  }
  const check = values.reduce((sum, v, i) => sum + (i === 0 ? v : v * i), 0) % 103;
  values.push(check, STOP);
  return values;
}

/** Devolve o <svg> das barras (texto fica por conta de quem chama). */
export function code128SVG(text, { height = 40, quiet = 10 } = {}) {
  const values = code128Values(text);
  let x = quiet;
  let bars = '';
  for (const v of values) {
    const pattern = PATTERNS[v];
    for (let i = 0; i < pattern.length; i++) {
      const w = Number(pattern[i]);
      if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${w}" height="${height}"/>`;
      x += w;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x + quiet} ${height}" preserveAspectRatio="none" fill="#000" role="img" aria-label="Código de barras">${bars}</svg>`;
}
