const test = require('node:test');
const assert = require('node:assert/strict');
const { describe, associatedItems } = require('../order-manager-web/mobile-detail-summary');

test('detail uses the authoritative current total, without subtracting its informational discount again', () => {
  const canonical = {
    displayName: '#4107',
    commerce: { total: 199, currencyCode: 'USD', financialStatus: 'PENDING' },
    data: {
      customer: { displayName: 'Alex Morgan' },
      commerce: {
        subtotal: { amount: '167.00', currencyCode: 'USD' }, discounts: { amount: '10.00' },
        shipping: { amount: '8.00' }, tax: { amount: '13.13' },
        total: { amount: '188.13', currencyCode: 'USD' }, financialStatus: 'PAID',
        outstanding: { amount: '0.00', currencyCode: 'USD' }
      }
    }
  };
  const result = describe({ canonical, total: 177, customer: 'Old customer' });
  assert.equal(result.customerLabel, 'Alex Morgan');
  assert.equal(result.orderLabel, '#4107');
  assert.deepEqual(result.total, { amount: 188.13, currencyCode: 'USD' });
  assert.deepEqual(result.payment, { status: 'PAID', label: 'Paid', outstanding: { amount: 0, currencyCode: 'USD' } });
});

test('missing facts stay unavailable and explicit current nulls do not resurrect board facts', () => {
  const result = describe({ total: 90, currencyCode: 'USD', financialStatus: 'PAID', displayFinancialStatus: 'PAID' }, {
    detail: { data: { commerce: { total: null, outstanding: '', financialStatus: null, currencyCode: null } } },
    sync: { stale: true, partial: true }
  });
  assert.equal(result.total, null);
  assert.equal(result.payment.status, 'UNKNOWN');
  assert.equal(result.payment.outstanding, null);
  assert.deepEqual(result.freshness, { stale: true, partial: true });
  assert.equal(describe().total, null);
  assert.equal(describe().customerLabel, 'Customer unavailable');
});

test('payment statuses preserve refunds and partial payments; paid does not invent a zero balance', () => {
  for (const [status, label] of [['PARTIALLY_PAID', 'Partially paid'], ['REFUNDED', 'Refunded'], ['PARTIALLY_REFUNDED', 'Partially refunded']]) {
    assert.deepEqual(describe({}, { commerce: { financialStatus: status } }).payment, { status, label, outstanding: null });
  }
  assert.equal(describe({}, { commerce: { financialStatus: 'PAID' } }).payment.outstanding, null);
  assert.equal(describe({}, { commerce: { financialStatus: 'NEW_UNKNOWN_STATUS', fullyPaid: true } }).payment.status, 'UNKNOWN');
});

test('fulfillment uses current explicit facts and never defaults missing or null status to unfulfilled', () => {
  const board = { fulfillmentStatus: 'FULFILLED', displayFulfillmentStatus: 'FULFILLED' };
  assert.deepEqual(describe(board, { commerce: { fulfillmentStatus: 'UNFULFILLED' }, data: {
    commerce: { fulfillmentStatus: 'PARTIALLY_FULFILLED' }
  } }).fulfillment, { status: 'PARTIALLY_FULFILLED', label: 'Partially fulfilled' });
  assert.deepEqual(describe(board, { data: { commerce: { fulfillmentStatus: null } } }).fulfillment,
    { status: 'UNKNOWN', label: 'Unknown' });
  assert.equal(describe({}, { commerce: { fulfillmentStatus: 'ON_HOLD' } }).fulfillment.label, 'On hold');
  assert.equal(describe({ displayFulfillmentStatus: 'shipped' }).fulfillment.label, 'Shipped');
  for (const fulfillmentStatus of [null, '', 'UNRECOGNIZED']) {
    assert.deepEqual(describe({}, { commerce: { fulfillmentStatus } }).fulfillment, { status: 'UNKNOWN', label: 'Unknown' });
  }
  assert.deepEqual(describe().fulfillment, { status: 'UNKNOWN', label: 'Unknown' });
});

test('zero totals survive and missing currency is not silently USD; malformed money is unavailable', () => {
  assert.deepEqual(describe({}, { commerce: { total: 0, currencyCode: 'CAD' } }).total, { amount: 0, currencyCode: 'CAD' });
  assert.deepEqual(describe({}, { commerce: { total: '12.50' } }).total, { amount: 12.5, currencyCode: null });
  for (const total of ['', ' ', 'not money', Infinity, false, {}]) assert.equal(describe({}, { commerce: { total } }).total, null);
});

test('charges preserve canonical unknowns and known zero without recalculating total or applying discounts twice', () => {
  const order = { subtotal: 177, shipping: 8, tax: 13.13, discounts: 20, discount: 20, total: 188.13, currencyCode: 'USD' };
  const facts = describe(order, { data: { commerce: {
    subtotal: { amount: '167.00', currencyCode: 'USD' }, shipping: { amount: '0.00' },
    tax: null, discounts: { amount: '10.00' }, total: { amount: '188.13' }
  } } });
  assert.deepEqual(facts.charges, {
    subtotal: { amount: 167, currencyCode: 'USD' }, shipping: { amount: 0, currencyCode: 'USD' },
    tax: null, discounts: { amount: 10, currencyCode: 'USD' }
  });
  assert.equal(facts.total.amount, 188.13);
  assert.equal(describe(order, { commerce: { discounts: null, discount: 10 } }).charges.discounts, null);
  assert.deepEqual(describe({}, { commerce: { discount: 0, currencyCode: 'CAD' } }).charges.discounts,
    { amount: 0, currencyCode: 'CAD' });
  assert.deepEqual(describe().charges, { subtotal: null, shipping: null, tax: null, discounts: null });
});

test('only complete exact delivery methods count: local delivery and pickup point remain distinct', () => {
  for (const [kind, label] of [['pickup', 'Pickup'], ['shipping', 'Shipping'], ['local-delivery', 'Local delivery'], ['pickup-point', 'Pickup point'], ['mixed', 'Mixed delivery'], ['none', 'No delivery']]) {
    assert.deepEqual(describe({}, { commerce: { deliveryMethod: { kind, complete: true } } }).delivery, { kind, label, complete: true });
  }
  for (const deliveryMethod of [undefined, { kind: 'pickup' }, { kind: 'pickup', complete: false }, { kind: 'unsupported', complete: true }]) {
    const value = describe({ shippingAddress: null }, { commerce: { deliveryMethod }, data: { delivery: {
      shippingLines: [{ title: 'LOCAL PICKUP' }], fulfillmentOrders: [{ method: { type: 'PICK_UP' } }]
    } } }).delivery;
    assert.deepEqual(value, { kind: 'unknown', label: 'Check delivery', complete: false });
  }
});

test('summary delivery remains available when rich detail has no delivery aggregate', () => {
  assert.equal(describe({}, { commerce: { deliveryMethod: { kind: 'shipping', complete: true } }, data: { commerce: { total: 20 } } }).delivery.kind, 'shipping');
});

test('proof association uses explicit exact IDs only, deduplicates links and reports missing lines', () => {
  const items = [{ id: 'M', title: 'Navy M', qty: 4 }, { id: 'L', title: 'Navy L', qty: 2 }, { id: 'XL', title: 'Hoodie', qty: 2 }];
  const asset = { role: 'mockup', lineItemIds: ['L', 'M', 'L', 'missing'], lineItemId: 'M' };
  const result = associatedItems(asset, items);
  assert.deepEqual(result.items, [items[1], items[0]]);
  assert.deepEqual(result.lineItemIds, ['L', 'M', 'missing']);
  assert.deepEqual(result.unresolvedLineItemIds, ['missing']);
  assert.equal(result.scope, 'items');
  assert.deepEqual(associatedItems({ role: 'mockup', title: 'Navy M', groupId: 'G1' }, items), {
    scope: 'order', lineItemIds: [], items: [], unresolvedLineItemIds: []
  });
});

test('compatibility attachment to an item does not create an association and inputs remain unchanged', () => {
  const asset = Object.freeze({ role: 'mockup', lineItemIds: Object.freeze(['unknown']) });
  const first = Object.freeze({ id: 'first', assets: Object.freeze([asset]) });
  const items = Object.freeze([first]);
  assert.deepEqual(associatedItems(asset, items).items, []);
  assert.deepEqual(associatedItems(asset, items).unresolvedLineItemIds, ['unknown']);
  assert.deepEqual(associatedItems({ role: 'mockup' }, items).items, []);
  const canonical = Object.freeze({ commerce: Object.freeze({ total: 10, currencyCode: 'EUR' }) });
  assert.equal(describe(Object.freeze({ canonical })).total.amount, 10);
});
