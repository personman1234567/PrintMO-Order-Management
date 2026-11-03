const assert = require('node:assert/strict');
const model = require('../order-manager-web/order-action-model.js');

const summary = {
  id: 'gid://shopify/Order/123', displayName: '#1001', customer: { displayName: 'Example Recipient' },
  commerce: { lineItemsComplete: true, lineItems: [
    { id: 'a', title: 'Example T-shirt', quantity: 4, currentQuantity: 2, variantTitle: 'Black / M' },
    { id: 'b', title: 'T-Shirt Full Front Print', quantity: 2 },
    { id: 'c', title: 'Removed product', quantity: 1, currentQuantity: 0 }
  ] }
};
const order = { _provider: 'shopify', _gid: summary.id, canonical: summary,
  email: 'stale@example.invalid', shippingAddress: { address1: 'Stale address' }, name: '#1001 – Placeholder' };
assert.equal(model.copyField(order, 'orderNumber').text, '#1001');
assert.equal(model.copyField(order, 'customerName').text, 'Example Recipient');
assert.equal(model.copyField(order, 'lineItems').text, '2 × Example T-shirt — Black / M\n2 × T-Shirt Full Front Print');
assert.equal(model.copyField(order, 'email').enabled, false);
assert.equal(model.copyField(order, 'shippingAddress').enabled, false);
assert.equal(model.copyField({ ...order, canonical: { ...summary, displayName: summary.id } }, 'orderNumber').enabled, false);
assert.equal(model.copyField({ name: '#7 - Some Name', orderNumber: '7' }, 'orderNumber').enabled, false);
assert.equal(model.copyField({ ...order, canonical: { ...summary, customer: { displayName: 'Name unavailable' } } }, 'customerName').enabled, false);

const detail = { detail: { lineItems: [
  { id: 'one', title: 'Example shirt', currentQuantity: 1, customAttributes: [{ key: 'Color', value: 'Blue' }, { key: 'Size', value: 'M' }, { key: 'Personalization', value: 'DO NOT COPY' }] },
  { id: 'two', title: 'Example shirt', currentQuantity: 3, customAttributes: [{ key: 'Color', value: 'Red' }, { key: 'Size', value: 'L' }] }
], data: {
  displayName: '#1001', lineItemsComplete: true,
  customer: { displayName: 'Example Customer', email: 'person@example.invalid' },
  delivery: {
    shippingAddress: { name: 'Example Recipient', company: 'Example Company', address1: '1 Example Street', address2: 'Unit 2', city: 'Exampleville', provinceCode: 'MO', zip: '00000', country: 'United States', phone: 'NEVER COPY PHONE' },
    billingAddress: { name: 'Billing Recipient', address1: 'Billing street' }
  }
} } };
assert.equal(model.copyField(order, 'customerName', { detail }).text, 'Example Recipient');
assert.equal(model.copyField(order, 'email', { detail }).text, 'person@example.invalid');
assert.equal(model.copyField(order, 'shippingAddress', { detail }).text,
  'Example Recipient\nExample Company\n1 Example Street\nUnit 2\nExampleville, MO 00000\nUnited States');
assert.equal(model.copyField(order, 'lineItems', { detail }).text,
  '1 × Example shirt — Color: Blue; Size: M\n3 × Example shirt — Color: Red; Size: L');
assert(!JSON.stringify(model.copyFields(order, { detail })).includes('DO NOT COPY'));

const redacted = { detail: { lineItems: [], data: { lineItemsComplete: true, customer: null, delivery: { shippingAddress: null, billingAddress: null } } } };
for (const id of ['email', 'shippingAddress', 'customerName', 'lineItems']) assert.equal(model.copyField(order, id, { detail: redacted }).enabled, false, id);
assert.equal(model.copyField({ ...order, canonicalDetail: detail }, 'email', { detail: null }).enabled, false);
assert.equal(model.copyField(order, 'lineItems', { detail: { detail: { ...detail.detail, data: { ...detail.detail.data, lineItemsComplete: false } } } }).enabled, false);
assert.equal(model.copyField({ ...order, canonical: { ...summary, commerce: { ...summary.commerce, lineItemsComplete: false } } }, 'lineItems').enabled, false);
assert.equal(model.copyField(order, 'lineItems', { detail: { detail: { data: { lineItemsComplete: true }, lineItems: null } } }).enabled, false);
assert.equal(model.copyField(order, 'lineItems', { detail: { detail: { data: { lineItemsComplete: true }, lineItems: [{ title: 'Missing quantity' }] } } }).enabled, false);
assert.equal(model.copyField(order, 'shippingAddress', { detail: { detail: { data: { delivery: {
  shippingAddress: null, billingAddress: { address1: 'Do not substitute billing' }
} } } } }).enabled, false);
assert.equal(model.copyField(order, 'shippingAddress', { detail: { detail: { data: { delivery: {
  shippingAddress: { name: 'Name alone is not a postal address', country: 'US' }
} } } } }).enabled, false);

const etsyContract = {
  id: 'etsy:account:99', orderKey: 'etsy:account:99', displayName: '99',
  source: { provider: 'etsy', displayNumber: '99' }, customer: { displayName: 'Example Buyer' },
  sync: { partial: false, errors: [] }, commerce: { lineItems: [{
    title: 'Example custom shirt', quantity: 2, variations: [
      { name: 'Color', value: 'Azalea' }, { name: 'Size', value: 'L' },
      { name: 'Personalization', value: 'PRIVATE TEXT', questionId: 'private' }
    ]
  }] }
};
const etsy = { _provider: 'etsy', canonical: etsyContract };
assert.equal(model.copyField(etsy, 'orderNumber').text, '99');
assert.equal(model.copyField(etsy, 'lineItems').text, '2 × Example custom shirt — Color: Azalea; Size: L');
const customQuestion = { title: 'Example item', quantity: 1,
  customAttributes: [{ key: 'Color', value: 'PRIVATE ANSWER' }],
  variations: [{ name: 'Color', value: 'PRIVATE ANSWER', questionId: 'custom' }] };
assert.equal(model.copyField({ ...etsy, canonical: { ...etsyContract, commerce: { lineItems: [customQuestion] } } }, 'lineItems').text, '1 × Example item');
assert.equal(model.copyField({ ...etsy, canonical: { ...etsyContract, sync: { partial: true, errors: [] } } }, 'lineItems').enabled, false);
assert.equal(model.copyField({ ...etsy, canonical: { ...etsyContract, sync: { partial: false, errors: [{ code: 'INCOMPLETE' }] } } }, 'lineItems').enabled, false);
const etsyDetail = { ...etsyContract, detail: { partial: false, errors: [], customer: { displayName: 'Example Buyer', email: null }, lineItems: etsyContract.commerce.lineItems, data: { customer: { displayName: 'Example Buyer', email: null }, delivery: { shippingAddress: null } } } };
assert.equal(model.copyField(etsy, 'lineItems', { detail: etsyDetail }).enabled, true);
assert.equal(model.copyField(etsy, 'email', { detail: etsyDetail }).enabled, false);
assert.equal(model.copyField(etsy, 'shippingAddress', { detail: etsyDetail }).enabled, false);
assert.equal(model.copyField(etsy, 'email', { detail: etsyDetail }).reason, 'Email is unavailable from Etsy.');
assert.equal(model.copyField(etsy, 'shippingAddress', { detail: etsyDetail }).reason, 'Shipping address is unavailable from Etsy.');
const deliveryOrder = deliveryMethod => ({ ...order,
  canonical: { ...summary, commerce: { ...summary.commerce, deliveryMethod } } });
for (const kind of ['pickup', 'pickup-point']) {
  assert.equal(model.copyField(deliveryOrder({ kind, complete: true }), 'shippingAddress').reason,
    'Shipping address is not applicable for pickup.');
}
for (const type of ['PICK_UP', 'PICKUP', 'PICKUP_POINT']) {
  assert.equal(model.copyField(deliveryOrder({ types: [type], complete: true }), 'shippingAddress').reason,
    'Shipping address is not applicable for pickup.');
}
for (const deliveryMethod of [undefined, { kind: 'local-delivery', complete: true },
  { kind: 'shipping', complete: true }, { kind: 'mixed', types: ['PICK_UP', 'SHIPPING'], complete: true },
  { kind: 'pickup', complete: false }]) {
  assert(!model.copyField(deliveryOrder(deliveryMethod), 'shippingAddress', { detail: redacted }).reason.includes('pickup'));
}
assert.equal(model.copyField(deliveryOrder({ kind: 'local-delivery', complete: true }), 'shippingAddress', { detail }).enabled, true);
assert.deepEqual(model.copyFields(order).map(field => field.id), ['orderNumber', 'customerName', 'lineItems', 'shippingAddress', 'email']);
const removableEtsy = { _candidate: true, _provider: 'etsy', _orderKey: 'etsy:fixture:99',
  _capabilities: { productionWrite: true }, canonical: { source: { provider: 'etsy' } } };
assert.equal(model.canRemoveFromBoard(removableEtsy), true);
for (const patch of [
  { _provider: 'shopify' }, { _provider: 'printmo' }, { _provider: 'unknown' }, { _provider: undefined },
  { _candidate: false }, { _orderKey: 'shopify:fixture:99' }, { _orderKey: '' },
  { _historyReadOnly: true }, { displayFulfillmentStatus: 'fulfilled' },
  { _capabilities: {} }, { _capabilities: { productionWrite: false } },
  { canonical: { source: { provider: 'shopify' } } }
]) assert.equal(model.canRemoveFromBoard({ ...removableEtsy, ...patch }), false, JSON.stringify(patch));
assert.equal(model.canRemoveFromBoard(null), false);
console.log('Order action copy model tests passed.');
