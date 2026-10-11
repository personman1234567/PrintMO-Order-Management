import test from 'node:test';
import assert from 'node:assert/strict';
import { moneyToMinor, estimateGarments, createGarmentCostService } from './garment-costs.mjs';

const variantId = 'gid://shopify/ProductVariant/201';
const isPrint = item => item.title === 'DTF Print';
const shirt = (id, quantity, extra = {}) => ({ id, title: 'Shirt', sku: 'B001', variantId, currentQuantity: quantity, ...extra });
const costs = new Map([[`variant:${variantId}`, { amount: '3.79', currencyCode: 'USD', sku: 'B001' }]]);
test('costs use exact cents and distinguish null from a valid zero', () => {
  assert.equal(moneyToMinor('3.79'), 379);
  assert.equal(moneyToMinor('3.7900'), 379);
  assert.equal(moneyToMinor('0.00'), 0);
  assert.equal(moneyToMinor(null), null);
  assert.equal(moneyToMinor('3.791'), null);
});
test('garment costs split shelf allocations and aggregate repeated SKU lines', () => {
  const estimate = estimateGarments({ id: 'order', items: [shirt('a', 5, { shelfQuantity: 2 }), shirt('b', 3)] }, costs, isPrint);
  assert.equal(estimate.garmentMinor, 3032);
  assert.equal(estimate.shelfMinor, 758);
  assert.equal(estimate.supplierMinor, 2274);
  assert.equal(estimate.lines[0].supplierQuantity, 3);
  assert.equal(estimate.status, 'complete');
});
test('manual and missing costs stay excluded; prints and reduced quantities do not inflate totals', () => {
  const estimate = estimateGarments({ id: 'order', items: [shirt('a', 1), shirt('b', 2, { sku: '' }),
    shirt('c', 3, { variantId: null }), shirt('d', 0), shirt('e', 9, { title: 'DTF Print' })] }, costs, isPrint);
  assert.equal(estimate.garmentMinor, 379);
  assert.equal(estimate.exclusions.length, 2);
  assert.equal(estimate.exclusions[0].exclusionReason, 'Manual item');
  assert.equal(estimate.lines.length, 3);
});
test('zero costs are complete; incompatible currencies are excluded', () => {
  const zero = estimateGarments({ id: 'order', items: [shirt('a', 2)] }, new Map([[`variant:${variantId}`, { amount: '0.00', currencyCode: 'USD' }]]), isPrint);
  assert.equal(zero.status, 'complete'); assert.equal(zero.supplierMinor, 0);
  const foreign = estimateGarments({ id: 'order', items: [shirt('a', 2)] }, new Map([[`variant:${variantId}`, { amount: '3.79', currencyCode: 'CAD' }]]), isPrint);
  assert.equal(foreign.exclusions[0].exclusionReason, 'Different currency');
  assert.equal(foreign.lines[0].unitCostMinor, null);
});
test('catalog resolution deduplicates variant requests and caches for subsequent orders', async () => {
  let requests = 0;
  const service = createGarmentCostService({ shopKey: 'dedup-test', isPrint,
    readOrder: async id => ({ id, items: [shirt('a', id === 'one' ? 2 : 3), shirt('b', 1)] }),
    graphql: async () => { requests++; return { data: { productVariant: { id: variantId, sku: 'B001', inventoryItem: { unitCost: { amount: '3.79', currencyCode: 'USD' } } } } }; }
  });
  const values = await service.estimates(['one', 'two', 'one']);
  assert.equal(values.length, 2); assert.equal(requests, 1);
  assert.equal(values[0].supplierMinor, 1137); assert.equal(values[1].supplierMinor, 1516);
});

test('native order costs use the current inline catalog values without variant lookups', async () => {
  const service = createGarmentCostService({ shopKey: 'inline-cost-test', isPrint,
    readOrder: async id => ({ id, provider: 'shopify', items: [
      shirt('known', 5, { shelfQuantity: 2, catalogCost: { amount: '3.79', currencyCode: 'USD', sku: 'B001' } })
    ] }), graphql: async () => { assert.fail('Inline costs must not trigger another Shopify request'); }
  });
  const [value] = await service.estimates(['one']);
  assert.equal(value.status, 'complete');
  assert.equal(value.garmentMinor, 1895);
  assert.equal(value.supplierMinor, 1137);
});

test('inline missing costs, valid zero and changed SKUs retain exclusions without price fallback', async () => {
  const service = createGarmentCostService({ shopKey: 'inline-exclusions-test', isPrint,
    readOrder: async id => ({ id, items: [
      shirt('missing', 1, { catalogCost: { sku: 'B001' } }),
      shirt('zero', 2, { variantId: `${variantId}0`, catalogCost: { amount: '0.00', currencyCode: 'USD', sku: 'B001' } }),
      shirt('changed', 3, { variantId: `${variantId}1`, catalogCost: { amount: '4.00', currencyCode: 'USD', sku: 'OTHER' } })
    ] }), graphql: async () => { assert.fail('Missing inline costs must remain explicit'); }
  });
  const [value] = await service.estimates(['one']);
  assert.equal(value.garmentMinor, 0);
  assert.equal(value.lines[1].unitCostMinor, 0);
  assert.deepEqual(value.exclusions.map(line => line.exclusionReason), ['Missing cost', 'Catalog SKU changed']);
});

test('multiple orders load together with no more than four total upstream operations', async () => {
  let active = 0;
  let peak = 0;
  const observe = async value => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return value;
  };
  const service = createGarmentCostService({ shopKey: 'bounded-orders-test', isPrint,
    readOrder: id => observe({ id, items: [shirt('line', 2, { variantId: `gid://shopify/ProductVariant/${id}` })] }),
    graphql: (_query, { id }) => observe({ data: { productVariant: {
      id, sku: 'B001', inventoryItem: { unitCost: { amount: '3.79', currencyCode: 'USD' } }
    } } })
  });
  const ids = Array.from({ length: 12 }, (_, index) => String(1000 + index));
  const values = await service.estimates(ids);
  assert.equal(peak, 4);
  assert.deepEqual(values.map(value => value.orderId), ids);
  assert(values.every(value => value.status === 'complete' && value.garmentMinor === 758));
});

test('a blocked first order does not prevent other orders from loading', async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const read = [];
  const service = createGarmentCostService({ shopKey: 'slow-first-test', isPrint,
    readOrder: async id => {
      if (id === 'slow') await blocked;
      read.push(id);
      return { id, items: [shirt('line', 1, { catalogCost: { amount: '3.79', currencyCode: 'USD', sku: 'B001' } })] };
    }, graphql: async () => { assert.fail('Unexpected catalog lookup'); }
  });
  const pending = service.estimates(['slow', 'two', 'three', 'four', 'five']);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(read, ['two', 'three', 'four', 'five']);
  release();
  assert.equal((await pending).length, 5);
});
test('Etsy uses supplier SKU only and requires a unique exact catalog match', async () => {
  const make = (shopKey, nodes, hasNextPage = false) => createGarmentCostService({ shopKey, isPrint,
    readOrder: async id => ({ id, provider: 'etsy', items: [shirt('a', 2, { sku: 'ETSY-SOURCE', supplierSku: 'B001' }), shirt('b', 1, { sku: 'ETSY-SOURCE' })] }),
    graphql: async (_query, variables) => {
      assert.equal(variables.query, 'sku:"B001"');
      return { data: { productVariants: { nodes, pageInfo: { hasNextPage } } } };
    }
  });
  const variant = { sku: 'B001', inventoryItem: { unitCost: { amount: '3.25', currencyCode: 'USD' } } };
  const [matched] = await make('etsy-one', [variant, { sku: 'B001-OTHER' }]).estimates(['etsy:1:2']);
  assert.equal(matched.supplierMinor, 650); assert.equal(matched.exclusions[0].exclusionReason, 'Manual item');
  const [ambiguous] = await make('etsy-two', [variant, variant]).estimates(['etsy:1:2']);
  assert.equal(ambiguous.lines[0].exclusionReason, 'Ambiguous catalog SKU');
  const [unmatched] = await make('etsy-none', []).estimates(['etsy:1:2']);
  assert.equal(unmatched.lines[0].exclusionReason, 'No catalog match');
});
test('upstream errors are explicit unavailable results and do not reject the caller', async () => {
  const service = createGarmentCostService({ shopKey: 'error-test', isPrint,
    readOrder: async id => ({ id, items: [shirt('a', 2)] }), graphql: async () => ({ errors: [{ message: 'Access denied' }] }) });
  const [value] = await service.estimates(['order']);
  assert.equal(value.status, 'unavailable'); assert.equal(value.lookupFailed, true);
  assert.equal(value.lines[0].exclusionReason, 'Cost unavailable');
  const unavailable = createGarmentCostService({ shopKey: 'order-error', isPrint, readOrder: async () => { throw new Error('Order inaccessible'); } });
  assert.equal((await unavailable.estimates(['order']))[0].garmentMinor, null);
});
test('five-minute cache refreshes prices without rewriting an earlier captured estimate', async () => {
  const originalNow = Date.now;
  let clock = originalNow();
  let price = '3.79';
  let calls = 0;
  Date.now = () => clock;
  const service = createGarmentCostService({ shopKey: 'snapshot-expiry-test', isPrint,
    readOrder: async id => ({ id, items: [shirt('a', 2)] }),
    graphql: async () => { calls++; return { data: { productVariant: { id: variantId, sku: 'B001', inventoryItem: { unitCost: { amount: price, currencyCode: 'USD' } } } } }; }
  });
  try {
    const [captured] = await service.estimates(['order']);
    price = '4.50';
    const [cached] = await service.estimates(['order']);
    assert.equal(cached.supplierMinor, 758); assert.equal(calls, 1);
    clock += 300001;
    const [updated] = await service.estimates(['order']);
    assert.equal(updated.supplierMinor, 900); assert.equal(calls, 2);
    assert.equal(captured.supplierMinor, 758); assert.equal(captured.lines[0].unitCostMinor, 379);
  } finally { Date.now = originalNow; }
});
