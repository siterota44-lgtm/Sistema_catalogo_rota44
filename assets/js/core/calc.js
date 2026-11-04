/**
 * Fórmulas. Módulo puro (sem tela, sem banco): roda igual no navegador e no
 * teste. Quem tem espelho no banco: priceOf ↔ public._variant_price.
 * O banco é quem decide o valor gravado; aqui é para mostrar antes de salvar.
 */

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function inWindow(from, to, at) {
  return (!from || new Date(from) <= at) && (!to || new Date(to) > at);
}

/**
 * Preço de lista e preço que vale agora.
 * @param {object} v variação @param {object} p produto
 * @param {object[]} promotions @param {object[]} categories
 */
export function priceOf(v, p, promotions = [], categories = [], at = new Date()) {
  const list = Number(v?.price ?? p?.base_price ?? 0);
  let best = list;
  const promo = v?.promo_price ?? p?.promo_price;
  if (promo != null && Number(promo) > 0 && Number(promo) < best && inWindow(p?.promo_from, p?.promo_to, at)) best = Number(promo);
  let pct = 0;
  for (const m of promotions) {
    if (!m.active || !inWindow(m.starts_at, m.ends_at, at)) continue;
    const hit = m.target_type === 'tudo'
      || (m.target_type === 'produto' && m.target_id === p?.id)
      || (m.target_type === 'colecao' && m.target_id === p?.collection_id)
      || (m.target_type === 'categoria' && (m.target_id === p?.category_id
        || categories.some((c) => c.id === p?.category_id && c.parent_id === m.target_id)));
    if (hit && Number(m.percent) > pct) pct = Number(m.percent);
  }
  if (pct) best = Math.min(best, round2(list * (1 - pct / 100)));
  return { list, price: best, onSale: best < list };
}

/** Margem real sobre o preço de venda, em %. */
export function marginPct(price, cost) {
  const p = Number(price) || 0;
  return p > 0 ? round2(((p - (Number(cost) || 0)) / p) * 100) : 0;
}

/** Custo + markup, com o arredondamento psicológico da loja (,90). */
export function suggestedPrice(cost, markupPct, roundTo = 0.9) {
  const raw = (Number(cost) || 0) * (1 + (Number(markupPct) || 0) / 100);
  if (raw <= 0) return 0;
  if (!roundTo) return round2(raw);
  const base = Math.floor(raw);
  const out = base + Number(roundTo);
  return round2(out >= raw ? out : out + 1);
}

/** Totais do carrinho, na mesma ordem do save_sale. */
export function cartTotals({ items = [], discount = 0, coupon = 0, pixPct = 0, usePix = false, shipping = 0 }) {
  const gross = round2(items.reduce((s, i) => s + i.qty * i.unit_price, 0));
  const itemsDiscount = round2(items.reduce((s, i) => s + (Number(i.discount_value) || 0), 0));
  const manual = Math.min(Number(discount) || 0, gross - itemsDiscount);
  const couponValue = Math.min(Number(coupon) || 0, gross - itemsDiscount - manual);
  const pixValue = usePix ? round2((gross - itemsDiscount - manual - couponValue) * (Number(pixPct) || 0) / 100) : 0;
  const total = round2(gross - itemsDiscount - manual - couponValue - pixValue + (Number(shipping) || 0));
  const manualPct = gross > 0 ? round2(((itemsDiscount + manual) / gross) * 100) : 0;
  return { gross, itemsDiscount, manual, coupon: couponValue, pix: pixValue, shipping: Number(shipping) || 0, total, manualPct };
}

/** Código 13 dígitos: confere o dígito verificador (EAN-13). */
export function validEAN13(code) {
  const s = String(code || '');
  if (!/^\d{13}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(s[12]);
}

/** Curva ABC: A até 80% do valor acumulado, B até 95%, C o resto. */
export function abcCurve(rows, pick = (r) => r.value) {
  const sorted = [...rows].sort((a, b) => pick(b) - pick(a));
  const total = sorted.reduce((s, r) => s + pick(r), 0) || 1;
  let acc = 0;
  return sorted.map((r) => {
    acc += pick(r);
    const share = acc / total;
    return { ...r, abc: share <= 0.8 ? 'A' : share <= 0.95 ? 'B' : 'C', share };
  });
}

/** Tolerância a erro de digitação na busca do catálogo (distância de edição). */
export function fuzzyIncludes(haystack, needle) {
  if (!needle) return true;
  if (haystack.includes(needle)) return true;
  const words = haystack.split(/\s+/);
  const limit = needle.length <= 3 ? 0 : needle.length <= 6 ? 1 : 2;
  return words.some((w) => editDistance(w.slice(0, needle.length + limit), needle) <= limit);
}

export function editDistance(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = i - 1;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? last : Math.min(last, prev[j], prev[j - 1]) + 1;
      last = tmp;
    }
  }
  return prev[b.length];
}

/** Sem acento e em minúsculas: "Calça" encontra "calca". */
export const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
