const test = require('node:test');
const assert = require('node:assert/strict');
const planner = require('../order-manager-web/production-planner-model');
const garment = require('../order-manager-web/order-garment-summary');
const { variant } = require('../order-manager-web/cart-garment-model');
const line = (id, title, qty, extra = {}) => ({ id, title, qty, sku: 'B102', variantTitle: 'Black / M', ...extra });
const job = (id, items, extra = {}) => ({ _candidate: true, _provider: 'shopify', _gid: `gid://shopify/Order/${id}`,
  name: `#${id} – Customer ${id}`, status: 'print', productionStage: 'print', items, ...extra });
const options = { garment, variant, isGarmentItem: item => !!item.sku && !garment.isPrint(item) };
test('planning preserves complete order quantities and immutable identities across providers, bundles and partial printing', () => {
  const one = job(1, [line('tee', 'Cotton T-shirt', 10), line('hoodie', 'Hoodie', 5)], { progress: 12, bundle: 'Team' });
  const two = job(2, [line('customer', 'Polo', 8, { sku: '' })], { _provider: 'etsy', _gid: 'etsy:123:456', printEligibility: { customer: true } });
  const data = planner.build([one, two, one, job(3, [line('x', 'Hoodie', 20)], { productionStage: 'completed' }),
    job(4, [], { displayFulfillmentStatus: 'FULFILLED' }), job(5, [], { _historyReadOnly: true })], options);
  assert.equal(data.total, 23); assert.equal(data.jobs.length, 2);
  const run = planner.browse(data, { scope: 'run', run: [planner.identity(two)] });
  assert.equal(run.total, 8); assert.equal(run.jobs[0].order, two);
  assert.equal(planner.browse(data, { query: 'hoodie' }).total, 15, 'search returns whole matching orders');
  assert.equal(planner.browse(data, { query: '<script>' }).jobs.length, 0);
});
test('garment groups combine sizes/colors honestly, preserve unknowns and keep placement combinations in one bucket', () => {
  const order = job(1, [line('m', 'Pocket T-shirt', 4), line('l', 'Pocket T-shirt', 6, { variantTitle: 'Black / L' }),
    line('unknown', 'Supplied apparel', 3), line('front', 'T-shirt Chest Print', 10, { sku: '' })], {
    printPlacements: { front: { printItemId: 'front', garmentLineIds: ['m', 'l'], placement: 'chest' } }
  });
  const data = planner.build([order], options), groups = planner.browse(data).groups;
  assert.equal(data.total, 13); assert.equal(groups[0].id, 'tee'); assert.equal(groups[0].quantity, 10);
  assert.deepEqual([...groups[0].styles[0].sizes.entries()], [['M', 4], ['L', 6]]);
  assert.equal(groups[1].id, 'other');
  const setup = planner.browse(data, { groupBy: 'setup' });
  assert.equal(setup.groups.reduce((sum, group) => sum + group.quantity, 0), 13);
  assert(setup.groups.some(group => group.label === 'Placement not recorded' && group.quantity === 3));
});
test('receiving quantities and unresolved allocation remain explicit and never imply print readiness', () => {
  const order = job(1, [line('a', 'Hoodie', 10), line('b', 'Polo', 5)], { printsStatus: 0 });
  const data = planner.build([order], { ...options, accountingForOrder: () => ({ lines: [
    { lineId: 'a', accountedQty: 4, allocationPending: false }, { lineId: 'b', accountedQty: 5, allocationPending: true }
  ] }) });
  assert.deepEqual(data.lines.map(line => [line.ready, line.waiting, line.unknown]), [[4, 6, 0], [0, 0, 5]]);
  assert.equal(data.jobs[0].printsReady, false);
  assert.equal(planner.browse(data, { material: 'unknown' }).jobs.length, 1);
  assert.equal(planner.browse(data).groups.reduce((sum, group) => sum + group.ready + group.waiting + group.unknown, 0), 15);
});
test('pulling sizes follow garment-size order rather than alphabetical order', () => {
  assert.deepEqual(['L', 'XS', '2XL', 'M', 'S', 'XL'].sort(planner.compareSizes), ['XS', 'S', 'M', 'L', 'XL', '2XL']);
});
