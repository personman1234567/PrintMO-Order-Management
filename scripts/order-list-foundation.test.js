const { test } = require('node:test');
const assert = require('node:assert/strict');
const model = require('../order-manager-web/order-board-model');
const detail = require('../order-manager-web/order-detail-state');

const classifiers = {
  isPrintItem: item => item.title === 'T-shirt Chest Print',
  isGarmentItem: item => item.title !== 'T-shirt Chest Print' && Boolean(item.sku),
  targetDatePresentation: detail.targetDatePresentation
};
function order(id, stage = 'received', extra = {}) {
  return { _candidate: true, _gid: id, _provider: 'shopify', name: '#1812 – Fixture Customer',
    productionStage: stage, receivedAt: '2026-10-08T15:00:00Z', progress: 0,
    items: [{ id: 'shirt', title: 'Fixture shirt', sku: 'B102', qty: 24 },
      { id: 'print', title: 'T-shirt Chest Print', sku: '', qty: 48 },
      { id: 'fee', title: 'Setup fee', sku: '', qty: 1 }], ...extra };
}

test('view state starts on Board and keeps its list stage when switching layouts', () => {
  const state = model.createViewState();
  assert.deepEqual(state.get(), { layout: 'board', stage: 'all', query: '', sort: 'newest', filters: { ...model.FILTER_DEFAULTS } });
  state.setStage('blanks_cart'); state.setLayout('list'); state.setLayout('board');
  assert.deepEqual(state.get(), { layout: 'board', stage: 'blanks_cart', query: '', sort: 'newest', filters: { ...model.FILTER_DEFAULTS } });
  state.setLayout('invalid'); state.setStage('invalid');
  assert.deepEqual(state.get(), { layout: 'board', stage: 'blanks_cart', query: '', sort: 'newest', filters: { ...model.FILTER_DEFAULTS } });
  assert.equal(model.createViewState().get().layout, 'board');
});

test('immutable identity survives a customer rename and separates matching provider IDs', () => {
  const first = order('same-id');
  const renamed = { ...first, name: '#9999 – Renamed customer' };
  assert.equal(model.orderKey(first), model.orderKey(renamed));
  assert.notEqual(model.orderKey(first), model.orderKey({ ...first, _provider: 'etsy' }));
  assert.equal(model.orderKey({ _candidate: true, name: '#1812' }), null);
});

test('counts are individual orders, including bundled members, across all six stages', () => {
  const orders = model.STAGES.map((stage, index) => order(String(index), stage.id, { bundle: 'Team' }));
  orders.push(order('etsy', 'received', { _provider: 'etsy' }));
  const data = model.snapshot(orders, classifiers);
  assert.equal(data.total, 7);
  assert.equal(data.counts.received, 2);
  for (const stage of model.STAGES.slice(1)) assert.equal(data.counts[stage.id], 1);
  assert.equal(model.summarize(orders[2], classifiers).stageLabel, 'In S&S Cart');
  assert.equal(model.summarize(orders[3], classifiers).stageLabel, 'Ordered');
});

test('printed-but-unfulfilled work stays active; fulfilled, history, and legacy do not', () => {
  const data = model.snapshot([
    order('active', 'completed', { displayFulfillmentStatus: 'UNFULFILLED' }),
    order('partial', 'completed', { displayFulfillmentStatus: 'PARTIALLY_FULFILLED' }),
    order('fulfilled', 'completed', { displayFulfillmentStatus: 'FULFILLED' }),
    order('history', 'completed', { _historyReadOnly: true }),
    { name: 'Legacy fixture', status: 'received' }
  ], classifiers);
  assert.equal(data.total, 2);
  assert.equal(data.counts.completed, 2);
});

test('unknown stages and unusable identities cannot silently become Pipeline orders', () => {
  const data = model.snapshot([order('unknown', 'future_stage'), order('duplicate'),
    order('duplicate'), { _candidate: true, name: '#1812' }], classifiers);
  assert.equal(data.counts.unknown, 1);
  assert.equal(data.identityErrors, 2);
  assert.equal(data.rows[0].stageLabel, 'Unknown stage');
  const state = model.createViewState(); state.setStage('unknown');
  assert.equal(state.visibleRows(data).length, 1);
});

test('stage filtering is read-only and cart/ordered stay distinct', () => {
  const orders = [order('cart', 'blanks_cart'), order('ordered', 'blanks_ordered')];
  const before = JSON.stringify(orders);
  const data = model.snapshot(orders, classifiers);
  const state = model.createViewState(); state.setStage('blanks_ordered');
  assert.deepEqual(state.visibleRows(data).map(row => row.stage), ['blanks_ordered']);
  assert.equal(JSON.stringify(orders), before);
});

test('garments, print items, other charges, and printable eligibility remain distinct', () => {
  const fixture = order('quantities', 'print', { printEligibility: { shirt: false, fee: true } });
  const summary = model.summarize(fixture, classifiers);
  assert.deepEqual(summary.quantities, { garments: 24, prints: 48, other: 1, pieces: 73, lines: 3 });
  assert.equal(summary.progress.printable, 1);
  assert.equal(model.printableTotal({ ...fixture, _candidate: false }, classifiers), 24);
  assert.equal(model.quantities({ items: [{ qty: Infinity }, { qty: -4 }] }).pieces, 0);
});

test('material flags and printed progress never manufacture a stage transition or approval', () => {
  const summary = model.summarize(order('pending', 'print', { blanksOrdered: 1,
    blanksStatus: 1, printsOrdered: 1, printsStatus: 0, progress: 24 }), classifiers);
  assert.equal(summary.stage, 'print');
  assert.equal(summary.materials.blanks.label, 'Ready');
  assert.equal(summary.materials.prints.label, 'Ordered');
  assert.equal(summary.progress.percent, 100);
  assert.equal(model.progress({}, 0).percent, 0);
  const outOfSequence = model.materialState(0, 1);
  assert.equal(outOfSequence.ordered, false);
  assert.equal(outOfSequence.ready, true);
});

test('confirmed snapshot updates replace derived progress and stage without another store', () => {
  const fixture = order('progress', 'print', { progress: 6 });
  assert.equal(model.snapshot([fixture], classifiers).rows[0].progress.percent, 25);
  fixture.progress = 24; fixture.productionStage = 'completed';
  const current = model.snapshot([fixture], classifiers);
  assert.equal(current.counts.print, 0);
  assert.equal(current.counts.completed, 1);
  assert.equal(current.rows[0].progress.percent, 100);
});

test('target urgency uses the existing Chicago date contract and keeps completed dates neutral', () => {
  const options = { ...classifiers, now: Date.parse('2026-10-09T16:00:00Z') };
  assert.equal(model.summarize(order('today', 'print', { targetDate: '2026-10-09' }), options).target.label, 'Today');
  assert.equal(model.summarize(order('done', 'completed', { targetDate: '2026-10-08' }), options).target.tone, 'neutral');
  assert.equal(model.summarize(order('none'), options).target, null);
});

test('Pipeline triage retains its existing age and material heuristic', () => {
  const fixture = order('triage', 'received', { receivedAt: '2026-10-06T16:00:00Z' });
  const context = { totals: { apparel: 24, prints: 48 }, designCount: 0, hasMockup: false,
    now: Date.parse('2026-10-09T16:00:00Z') };
  const result = model.evaluateTriage(fixture, context);
  assert.equal(result.score, 127);
  assert.equal(result.label, 'Missing files');
  assert.ok(result.tags.includes('attention'));
  const ready = model.evaluateTriage({ ...fixture, blanksStatus: 1, printsStatus: 1 }, context);
  assert.equal(ready.label, 'Ready');
  assert.ok(!ready.tags.includes('attention'));
});

test('receiving accounting and recorded attention are separate from heuristic readiness', () => {
  const fixture = order('receiving', 'blanks_ordered', { canonical: {
    attention: { required: true, reasons: ['Allocation needs review'] }
  } });
  const accounting = { accountedGarments: 18, expectedGarments: 24, fullyAccounted: false };
  const summary = model.summarize(fixture, { ...classifiers, accountingForOrder: () => accounting,
    evaluateTriage: () => ({ label: 'Partly ready' }) });
  assert.equal(summary.accounting.accountedGarments, 18);
  assert.deepEqual(summary.attention.reasons, ['Allocation needs review']);
  assert.equal(summary.triage.label, 'Partly ready');
  assert.equal(summary.materials.blanks.ready, false);
});

test('search matches order/customer/bundle only, ignores case and normalizes spaces', () => {
  const data = model.snapshot([order('1', 'received', { name: '#10 – Alex Miller', bundle: 'Team Alpha' }),
    order('2', 'print', { name: '#11 – Sam Mills' })], classifiers);
  const state = model.createViewState();
  state.setQuery(' ALEX   MILLER '); assert.equal(state.browse(data).shown, 1);
  state.setQuery('alpha'); assert.equal(state.browse(data).rows[0].number, '#10');
  state.setQuery('B102'); assert.equal(state.browse(data).shown, 0);
  state.setQuery('#11'); assert.equal(state.browse(data).shown, 1);
});

test('combined filters AND together and counts are computed before selected stage', () => {
  const data = model.snapshot([order('1', 'received', { blanksStatus: 1, displayFinancialStatus: 'PAID' }),
    order('2', 'print', { blanksStatus: 1, displayFinancialStatus: 'PAID' }),
    order('3', 'print', { blanksStatus: 0, displayFinancialStatus: 'PAID' }),
    order('4', 'received', { _provider: 'etsy', blanksStatus: 1, displayFinancialStatus: 'PAID' })], classifiers);
  const state = model.createViewState(); state.setStage('received');
  state.setFilters({ source: 'shopify', blanks: 'ready', payment: 'PAID' });
  const result = state.browse(data);
  assert.equal(result.shown, 1); assert.equal(result.matched, 2); assert.equal(result.total, 4);
  assert.equal(result.counts.received, 1); assert.equal(result.counts.print, 1);
  assert.equal(data.rows.length, 4);
});

test('sorts are deterministic and put missing dates last', () => {
  const data = model.snapshot([order('b', 'received', { name: '#12 – Zed', receivedAt: '2026-10-08T10:00:00Z', targetDate: '2026-10-12' }),
    order('a', 'received', { name: '#11 – Alex', receivedAt: '2026-10-08T10:00:00Z', targetDate: '2026-10-10' }),
    order('c', 'received', { name: '#10 – Bea', receivedAt: '2026-10-07T10:00:00Z' })], classifiers);
  const state = model.createViewState();
  assert.deepEqual(state.browse(data).rows.map(row => row.number), ['#11', '#12', '#10']);
  state.setSort('oldest'); assert.equal(state.browse(data).rows[0].number, '#10');
  state.setSort('target'); assert.deepEqual(state.browse(data).rows.map(row => row.number), ['#11', '#12', '#10']);
  state.setSort('customer'); assert.deepEqual(state.browse(data).rows.map(row => row.customer), ['Alex', 'Bea', 'Zed']);
});

test('money preserves actual zero and currency and leaves missing/invalid values unknown', () => {
  for (const value of [null, undefined, '', 'broken', false, '   ', {}]) {
    const row = model.summarize(order('1', 'received', { canonical: { commerce: { total: value, currencyCode: 'USD' } } }), classifiers);
    assert.equal(row.money.amount, null);
  }
  const zero = model.summarize(order('1', 'received', { canonical: { commerce: { total: '0.00', currencyCode: 'USD' } } }), classifiers);
  assert.deepEqual(zero.money, { amount: 0, currency: 'USD' });
  assert.equal(zero.financialStatus, null);
  assert.equal(model.summarize(order('2', 'received', { canonical: { commerce: { total: 12 } } }), classifiers).money.currency, null);
});

test('Pipeline heuristics stay in Pipeline; formal attention, accounting, and handoff stay distinct', () => {
  const options = { ...classifiers, evaluateTriage: () => ({ label: 'Missing files', tone: 'danger', tags: ['attention'] }) };
  const pipeline = model.summarize(order('1'), options), printing = model.summarize(order('2', 'print', { printsStatus: 1 }), options);
  assert.equal(model.indicators(pipeline)[0].label, 'Missing files');
  assert.equal(model.indicators(printing).some(item => item.label === 'Missing files'), false);
  const pending = model.summarize(order('3', 'print', { printsStatus: 0 }), options);
  assert.equal(model.indicators(pending)[0].label, 'Prints pending · do not press');
  const printed = model.summarize(order('4', 'completed', { printsStatus: 1 }), options);
  assert.deepEqual(model.indicators(printed), [{ label: 'Awaiting handoff', tone: 'neutral', needsAttention: false }]);
  const allocation = model.summarize(order('5', 'blanks_ordered'), { ...classifiers,
    accountingForOrder: () => ({ missingGarments: 0, fullyAccounted: false, lines: [{ allocationPending: true }] }) });
  assert.equal(model.indicators(allocation)[0].label, 'Allocation needs review');
});

test('target filters use Chicago urgency and keep completed targets neutral', () => {
  const data = model.snapshot([order('1', 'received', { targetDate: '2026-10-08' }),
    order('2', 'received', { targetDate: '2026-10-09' }),
    order('3', 'received', { targetDate: '2026-10-10' }),
    order('4', 'completed', { targetDate: '2026-10-08' }), order('5')], { ...classifiers, now: Date.parse('2026-10-09T17:00:00Z') });
  const state = model.createViewState();
  for (const [value, id] of [['late', '1'], ['today', '2'], ['tomorrow', '3'], ['none', '5']]) {
    state.setFilters({ target: value }); assert.equal(state.browse(data).rows[0].key, model.orderKey(order(id)));
    assert.equal(state.browse(data).shown, value === 'late' ? 2 : 1);
  }
});

test('unknown payment and partial line data stay discoverable without fabricated values', () => {
  const data = model.snapshot([order('1', 'received', { canonical: { commerce: { lineItemsComplete: false }, sync: { partial: true } } }),
    order('2', 'received', { displayFinancialStatus: 'partially paid' })], classifiers);
  const state = model.createViewState(); state.setFilters({ payment: 'UNKNOWN' });
  assert.equal(state.browse(data).shown, 1); assert.equal(data.rows[0].partial, true);
  assert.equal(model.indicators(data.rows[0])[0].label, 'Some data unavailable');
  state.setFilters({ payment: 'PARTIALLY_PAID' }); assert.equal(state.browse(data).shown, 1);
});

test('browse state survives layout toggles and rejects invalid filter/sort choices', () => {
  const state = model.createViewState(); state.setQuery('Alex'); state.setSort('target'); state.setStage('print'); state.setFilters({ source: 'etsy' });
  const original = state.get(); state.setLayout('list'); state.setLayout('board');
  state.setFilters({ source: 'invalid', payment: '<script>' }); state.setSort('bad');
  assert.deepEqual(state.get(), original);
  assert.equal(Object.isFrozen(state.get().filters), true);
  state.resetFilters(); assert.equal(state.get().query, ''); assert.equal(state.get().stage, 'all'); assert.equal(state.get().sort, 'target');
});

test('supplier getter uses the existing batch cache, separates multiple states, and performs no reads', async () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  let reads = 0;
  const batches = [
    { id: 'a', orderNames: ['single', 'multiple'], missingGarments: 4, supplierStatus: { state: 'delivered', observedAt: '2020-01-01T00:00:00Z' } },
    { id: 'b', orderNames: ['multiple'], supplierStatus: { state: 'in_transit', observedAt: new Date().toISOString() } }
  ];
  const context = { console, CustomEvent: class {}, window: {
    api: { listBlanksBatches: async () => { reads++; return { batches }; }, getBlanksBatch: async () => ({}) },
    getOrderManagerBoardSnapshot: () => []
  }, document: { addEventListener() {}, dispatchEvent() {}, getElementById: () => null, querySelectorAll: () => [],
    body: { dataset: {} } } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../order-manager-web/blanks-batches.js'), 'utf8'), context);
  await context.window.blanksBatchFoundation.hydrateAccounting();
  const getter = context.window.blanksBatchFoundation.supplierSummaryForOrder;
  const before = reads;
  assert.equal(getter('unavailable'), null);
  assert.match(getter('single').label, /Delivered.*check in/);
  assert.equal(getter('single').stale, true);
  const multiple = getter('multiple');
  assert.equal(multiple.multiple, true);
  assert.match(multiple.label, /2 S&S batches.*Delivered.*In transit/);
  assert.equal(multiple.stale, true);
  assert.equal(reads, before);
});
