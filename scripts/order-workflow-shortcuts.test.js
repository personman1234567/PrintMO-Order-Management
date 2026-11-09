const test = require('node:test');
const assert = require('node:assert/strict');
const receiving = require('../order-manager-web/receiving-review-model');
const checklist = require('../order-manager-web/production-run-checklist');

const line = (key, extra = {}) => ({ itemKey: key, expectedQty: 5, receivedQty: 5,
  orderLines: [{ orderName: 'A', expectedQty: 2 }, { orderName: 'B', expectedQty: 3 }], ...extra });

test('only complete, unconfirmed, consistent shared lines get full allocation proposals', () => {
  const manifest = [line('full'), line('short', { receivedQty: 4 }), line('saved', { allocationConfirmed: true }),
    line('unknown', { receivedQty: null }), line('fraction', { receivedQty: 5.5 }),
    line('mismatch', { expectedQty: 6, receivedQty: 6 }),
    line('single', { orderLines: [{ orderName: 'A', expectedQty: 5 }] })];
  const proposals = receiving.fullAllocations({ manifest });
  assert.deepEqual(proposals.map(value => value.itemKey), ['full']);
  assert.deepEqual(proposals[0].allocations, { A: 2, B: 3 });
  assert.deepEqual(receiving.fullAllocations({ manifest: [line('excess', { receivedQty: 7 })] })[0].allocations, { A: 2, B: 3 });
});

test('proposal signatures detect changed receipts or order membership before any bulk write', () => {
  const first = receiving.fullAllocations({ manifest: [line('a')] })[0];
  const changed = receiving.fullAllocations({ manifest: [line('a', { receivedQty: 6 })] })[0];
  const moved = receiving.fullAllocations({ manifest: [line('a', { orderLines: [{ orderName: 'A', expectedQty: 2 }, { orderName: 'C', expectedQty: 3 }] })] })[0];
  assert.notEqual(first.signature, changed.signature);
  assert.notEqual(first.signature, moved.signature);
});

test('duplicate source lines aggregate per order and unusual order names remain exact data', () => {
  const proposal = receiving.fullAllocations({ manifest: [line('a', { orderLines: [
    { orderName: '__proto__', expectedQty: 2 }, { orderName: 'B', expectedQty: 1 }, { orderName: 'B', expectedQty: 2 }
  ] })] })[0];
  assert.equal(proposal.allocations.__proto__, 2);
  assert.equal(proposal.allocations.B, 3);
  assert.equal(Object.getPrototypeOf(proposal.allocations), Object.prototype);
});

test('receiving attention derives from missing garments, allocation and supplier exceptions', () => {
  assert.deepEqual(receiving.attentionReasons({ missingGarments: 2, supplierStatus: { state: 'delivered' } }), ['Delivered · 2 still to check in']);
  assert.equal(receiving.attentionReasons({ missingGarments: 0, pendingAllocationLines: 1 }).length, 1);
  assert.deepEqual(receiving.attentionReasons({ missingGarments: 0, pendingAllocationLines: 0, supplierStatus: { state: 'delivered' } }), []);
  assert.equal(receiving.attentionReasons({ supplierStatus: { state: 'exception' } })[0], 'Delivery exception');
  assert.equal(receiving.attentionReasons({ missingGarments: 4, supplierStatus: { state: 'in_transit' } }).length, 1);
});

test('checklist keeps exact quantities, instructions and unknowns, and escapes all order content', () => {
  const jobs = [{ name: '<script>alert(1)</script>', identity: { provider: 'etsy' }, quantity: 2, printsReady: false,
    targetDate: '2026-11-07', order: { notes: 'Handle <carefully>', items: [{ id: 'one', customAttributes: [
      { key: '_designer_item_instructions', value: 'Front & back\nKeep centered' }
    ] }] }, lines: [{ itemId: 'one', title: '<img onerror=alert(1)>', color: 'Blue', size: 'L', quantity: 2, ready: 1, setupLabel: 'Placement not recorded' }] }];
  const before = JSON.stringify(jobs);
  const html = checklist.render(jobs, { revision: 7, generatedAt: '2026-11-06T18:00:00Z', excluded: 1 });
  assert.match(html, /1 order · 2 garments/);
  assert.match(html, /1\/2 blanks ready/);
  assert.match(html, /Prints not marked in hand/);
  assert.match(html, /Front &amp; back\nKeep centered/);
  assert.match(html, /Placement not recorded/);
  assert.match(html, /Run revision 7/);
  assert.match(html, /1 saved run member/);
  assert.doesNotMatch(html, /<script|<img/);
  assert.match(html, /Handle &lt;carefully&gt;/);
  assert.equal(JSON.stringify(jobs), before);
});
