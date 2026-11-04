// Fórmulas e código de barras, sem navegador. Rodar: cd tests && npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import { priceOf, marginPct, suggestedPrice, cartTotals, validEAN13, abcCurve, fuzzyIncludes, fold, round2 } from '../../assets/js/core/calc.js';
import { code128Values, code128SVG } from '../../assets/js/core/barcode.js';

test('preço: promocional só vale dentro da data', () => {
  const p = { id: 'p', base_price: 100, promo_price: 80, promo_from: '2026-01-01T00:00:00Z', promo_to: '2026-02-01T00:00:00Z' };
  assert.equal(priceOf({}, p, [], [], new Date('2026-01-15')).price, 80);
  assert.equal(priceOf({}, p, [], [], new Date('2026-03-01')).price, 100);
});

test('preço: variação sobrescreve o produto e a melhor promoção vale', () => {
  const p = { id: 'p', base_price: 100, category_id: 'filha' };
  const cats = [{ id: 'filha', parent_id: 'mae' }];
  const promos = [
    { active: true, percent: 10, target_type: 'tudo' },
    { active: true, percent: 30, target_type: 'categoria', target_id: 'mae' },
    { active: false, percent: 90, target_type: 'tudo' },
  ];
  assert.deepEqual(priceOf({ price: 200 }, p, promos, cats), { list: 200, price: 140, onSale: true });
});

test('margem e preço sugerido com final ,90', () => {
  assert.equal(marginPct(100, 40), 60);
  assert.equal(suggestedPrice(60, 100), 120.9);
  assert.equal(suggestedPrice(60.5, 100), 121.9);
  assert.equal(suggestedPrice(0, 100), 0);
});

test('totais do carrinho seguem a ordem do banco', () => {
  const t = cartTotals({ items: [{ qty: 2, unit_price: 100, discount_value: 10 }], discount: 10, coupon: 18, usePix: true, pixPct: 5, shipping: 20 });
  assert.equal(t.gross, 200);
  assert.equal(t.total, round2(200 - 10 - 10 - 18 - 8.1 + 20));
  assert.equal(t.manualPct, 10);
});

test('curva ABC', () => {
  const r = abcCurve([{ v: 80 }, { v: 15 }, { v: 5 }], (x) => x.v);
  assert.deepEqual(r.map((x) => x.abc), ['A', 'B', 'C']);
});

test('busca tolera erro de digitação e acento', () => {
  assert.ok(fuzzyIncludes(fold('Moletom Canguru Heavy'), fold('moleton')));
  assert.ok(fuzzyIncludes(fold('Calça Baggy'), fold('calca')));
  assert.ok(!fuzzyIncludes(fold('Camiseta Boxy'), fold('moletom')));
});

test('dígito verificador do código interno', () => {
  assert.ok(validEAN13('2440000000163'));
  assert.ok(!validEAN13('2440000000164'));
});

test('Code 128: 13 dígitos usam conjunto C + B, com verificador', () => {
  const v = code128Values('2440000000163');
  assert.equal(v[0], 105);                // start C
  assert.deepEqual(v.slice(1, 7), [24, 40, 0, 0, 0, 16]);
  assert.deepEqual(v.slice(7, 9), [100, 19]);   // troca para o conjunto B + o último dígito
  assert.equal(v.at(-1), 106);            // stop
  const check = v.slice(0, -2).reduce((s, x, i) => s + (i === 0 ? x : x * i), 0) % 103;
  assert.equal(v.at(-2), check);
  assert.match(code128SVG('2440000000163'), /<svg[^>]*><rect/);
});
