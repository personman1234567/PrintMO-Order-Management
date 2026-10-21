const { test } = require('node:test');
const assert = require('node:assert/strict');
const model = require('../order-manager-web/cart-garment-model.js');
const shirt = (id, qty, sku = 'RED-M') => ({ id, title: 'T-shirt · Style A', variantTitle: 'Red / M', sku, qty });
const order = (id, items, extra = {}) => ({ _candidate: true, _provider: 'shopify', _gid: id, name: `#${id} – Customer ${id}`, status: 'blanks', items, ...extra });
const options = { shelfFor: () => ({ lines: [] }), isPrint: item => item.title === 'DTF Print' };
test('shared exact variants combine across orders and split back without changing totals', () => {
  const result = model.build([order('1234', [shirt('a', 10)]), order('1235', [shirt('b', 6)])], options);
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].expected, 16);
  assert.deepEqual(result.groups.map(group => group.rows[0].expected), [10, 6]);
  assert.equal(result.groups.flatMap(group => group.rows).reduce((sum, row) => sum + row.expected, 0), result.expected);
});
test('sizes and styles with different supplier SKUs remain separate, even with identical names', () => {
  const result = model.build([order('1', [shirt('a', 10), { ...shirt('b', 8, 'RED-L'), variantTitle: 'Red / L' }, shirt('c', 24, 'OTHER-M')])], options);
  assert.equal(result.rows.length, 3); assert.equal(result.total, 42);
});
test('shelf claims subtract only from the matching current line', () => {
  const result = model.build([order('1', [shirt('a', 10), shirt('b', 6, 'BLUE-M')])], {
    ...options, shelfFor: () => ({ lines: [{ lineItemId: 'a', quantity: 10, claimed: 4 }] }) });
  assert.equal(result.expected, 12); assert.equal(result.shelf, 4); assert.equal(result.total, 16);
});
test('unavailable or changed shelf allocations never masquerade as supplier totals', () => {
  for (const snapshot of [null, { status: 'unavailable' }, { lines: [], needsReview: true }, { lines: [{ lineItemId: 'a', quantity: 9, claimed: 2 }] }]) {
    const result = model.build([order('1', [shirt('a', 10)])], { ...options, shelfFor: () => snapshot });
    assert.equal(result.rows[0].expected, null); assert.equal(result.unresolved, 10);
  }
});
test('manual items stay visible and separate; print services and nonpositive lines are excluded', () => {
  const result = model.build([order('1', [shirt('a', 10, ''), shirt('b', 2, ''), shirt('c', 0), { title: 'DTF Print', qty: 12 }])], options);
  assert.equal(result.rows.length, 2); assert.equal(result.total, 12); assert.equal(result.unresolved, 12);
});
test('only operational In Cart orders contribute, with stable provider-aware identity', () => {
  const a = order('1', [shirt('a', 10)]);
  const result = model.build([a, a, order('2', [shirt('b', 8)], { blanksOrdered: 1 }), order('3', [shirt('c', 5)], { status: 'print' }),
    order('4', [shirt('d', 4)], { _candidate: false }), order('5', [shirt('e', 3)], { hidden: true }), order('1', [shirt('f', 6)], { _provider: 'etsy' })],
  { ...options, isVisible: order => !order.hidden });
  assert.equal(result.orderCount, 2); assert.equal(result.expected, 16);
});
test('exact named colors and sizes survive without family approximations or HTML evaluation', () => {
  const result = model.variant({ variantTitle: 'Unknown variant', customAttributes: [{ key: 'Color', value: 'Heather Aqua Blue' }, { key: 'Size', value: 'Youth XL' }] });
  assert.equal(result.color, 'Heather Aqua Blue'); assert.equal(result.size, 'Youth XL');
  assert.equal(model.variant({ variantTitle: '<img src=x> / M' }).color, '<img src=x>');
});
