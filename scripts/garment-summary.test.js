const test = require('node:test');
const assert = require('node:assert/strict');
const { model, colorFamily, diagram } = require('../order-manager-web/order-garment-summary');
const line = (title, variantTitle = '', extra = {}) => ({ title, variantTitle, qty: 1, ...extra });

test('supplier aliases resolve to a bounded color palette', () => {
  for (const value of ['Maroon', 'Cardinal Red', 'Sport Red', 'Heather Red']) assert.equal(colorFamily(value), 'red');
  assert.equal(colorFamily('Deep Blue'), 'navy');
  assert.equal(colorFamily('Royal Blue'), 'blue');
  assert.equal(colorFamily('Sport Grey'), 'gray');
  assert.equal(colorFamily('Black'), 'black');
  for (const value of ['Mystery', 'Camo', 'Black / White', '']) assert.equal(colorFamily(value), 'unknown');
});
test('sizes collapse without merging different garment colors or changing labels', () => {
  const result = model({ items: [line('Gildan T-shirt', 'Navy / S'), line('Gildan T-shirt', 'Navy / L', { qty: 4 }), line('Gildan T-shirt', 'Red / L')] });
  assert.equal(result.qty, 5);
  assert.equal(result.color.family, 'navy');
  assert.equal(result.extra, 1);
  assert.match(result.label, /Navy/);
});
test('one garment group can summarize known front and back print rows', () => {
  const result = model({ items: [line('Cotton T-shirt', 'Black / M'), line('T-shirt Breast Print'), line('T-shirt Full Back Print')] });
  assert.deepEqual(result.locations, ['breast', 'back']);
  assert.equal(result.fill, '#34383e');
  assert.match(diagram(result), /x="57"/);
  assert.match(diagram(result, true), /height="33"/);
});
test('unassigned prints never decorate every garment in a mixed order', () => {
  const result = model({ items: [line('T-shirt', 'Red / L'), line('Hoodie', 'Blue / L'), line('T-shirt Breast Print')] });
  assert.deepEqual(result.locations, []);
  assert.deepEqual(model({ items: [line('T-shirt', 'Red'), line('Unknown product'), line('T-shirt Breast Print')] }).locations, []);
});
test('explicit group links resolve prints to the matching garment only', () => {
  const result = model({ items: [line('Hoodie', 'Navy / L', { qty: 5, properties: { group_id: 'a' } }), line('T-shirt', 'White / L', { properties: { group_id: 'b' } }), line('T-shirt Full Back Print', '', { properties: { group_id: 'b' } }), line('T-shirt Breast Print', '', { properties: { group_id: 'a' } })] });
  assert.deepEqual(result.locations, ['breast']);
});
test('unknown products do not become invented shirts and unknown colors remain neutral', () => {
  assert.equal(model({ items: [line('DTF Print'), line('Mystery product')] }), null);
  assert.equal(model({ items: [line('Hoodie', 'Mystery / XL')] }).color.family, 'unknown');
  assert.equal(model({ items: [line('T-shirt', 'Red / L', { qty: 0 })] }), null);
});
test('product text is never interpolated into SVG markup', () => {
  const result = model({ items: [line('<img onerror=bad> T-shirt', 'Black / L')] });
  assert(!diagram(result).includes('onerror'));
});

test('compatibility attachment of order-wide assets does not invent a garment assignment', () => {
  const item = line('Hoodie', 'Navy', { id: 'garment-a', assets: [{ role: 'design', side: 'back' }] });
  assert.deepEqual(model({ items: [item] }).locations, []);
  item.assets[0].lineItemId = 'garment-a';
  assert.deepEqual(model({ items: [item] }).locations, ['back']);
});
