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

const workflows = require('../order-manager-web/order-list-workflows');
function workflowFixture(jobs, overrides = {}) {
  const writes = [], manifests = [];
  const resolve = ref => jobs.find(job => job._provider === ref.provider && (job._orderKey || job._gid) === ref.orderKey);
  const deps = { getOrders: () => jobs,
    api: { setBundle: async ([ref], label) => { writes.push(['bundle', ref.orderKey, label]); resolve(ref).bundle = label; } },
    blanks: {
      prepareExplicitMove: async (_, status, opts) => ({ patch: { status, ...opts }, batchChoice: 'keep', batchRefs: [] }),
      moveExplicitOrder: async (ref, patch) => { writes.push(['move', ref.orderKey]); const job = resolve(ref); job.productionStage = patch.status === 'blanks' ? patch.blanksOrdered ? 'blanks_ordered' : 'blanks_cart' : patch.status === 'toOrder' ? 'to_order' : patch.status; },
      correctExplicitBatch: async job => { writes.push(['correction', job._gid]); },
      recordExplicitOrdered: async selected => { manifests.push(selected.map(job => job._gid)); return { batch: { id: 'saved' } }; }
    }, submit: async () => ({ result: { acceptedOrderKeys: jobs.map(model.orderKey) }, report: { outcome: 'confirmed' } }),
    ...overrides
  };
  return { controller: workflows.create(deps), writes, manifests, deps };
}

test('selection reconciles only visible identities; sorting and renames preserve selection', () => {
  const keys = ['a', 'b', 'c'];
  assert.deepEqual(model.reconcileSelection(keys, ['c', 'a']), { selected: ['a', 'c'], removed: ['b'] });
  assert.deepEqual(model.reconcileSelection(['a', 'a'], ['a']), { selected: ['a'], removed: [] });
  const first = order('1'), renamed = { ...first, name: 'Renamed' };
  assert.deepEqual(model.reconcileSelection([model.orderKey(first)], [model.orderKey(renamed)]).removed, []);
});

test('all selected orders must qualify, with provider authority and canonical destinations', () => {
  const jobs = [order('1', 'to_order'), order('2', 'received'), order('etsy', 'to_order', { _provider: 'etsy', _capabilities: { productionWrite: true, supplierBatch: false } })];
  assert.equal(model.actionEligibility('supplier', jobs.slice(0, 2).map(model.orderKey), jobs).enabled, false);
  assert.match(model.actionEligibility('supplier', [model.orderKey(jobs[2])], jobs).reason, /Shopify/);
  assert.match(model.actionEligibility('bundle', [model.orderKey(jobs[0]), model.orderKey(jobs[2])], jobs).reason, /one source/);
  assert.equal(model.actionEligibility('move', [model.orderKey(jobs[2])], jobs, 'print').enabled, true);
  assert.equal(model.actionEligibility('move', [model.orderKey(jobs[0])], jobs, 'completed').enabled, false);
  assert.equal(model.actionEligibility('move', [model.orderKey(jobs[0])], jobs, 'blanks_ordered').enabled, false);
  assert.equal(model.actionEligibility('move', [model.orderKey(order('unknown', 'unexpected'))], [order('unknown', 'unexpected')], 'received').enabled, false);
});

test('bundle and stage changes use exact identities despite colliding display names', async () => {
  const jobs = [order('1'), order('2'), order('hidden', 'received', { bundle: 'Keep' })];
  const fixture = workflowFixture(jobs);
  await fixture.controller.execute(fixture.controller.review('bundle', jobs.slice(0, 2).map(model.orderKey), { label: 'Team' }));
  assert.deepEqual(jobs.map(job => job.bundle), ['Team', 'Team', 'Keep']);
  await fixture.controller.execute(fixture.controller.review('unbundle', [model.orderKey(jobs[0])]));
  assert.equal(jobs[1].bundle, 'Team');
  assert.equal(jobs[2].bundle, 'Keep');
  assert.throws(() => fixture.controller.review('bundle', jobs.map(model.orderKey)), /unbundled/);
});

test('bundle label collision is rejected before writes', async () => {
  const jobs = [order('1'), order('2'), order('hidden', 'received', { bundle: 'Existing' })];
  const fixture = workflowFixture(jobs);
  await assert.rejects(fixture.controller.execute(fixture.controller.review('bundle', jobs.slice(0, 2).map(model.orderKey), { label: ' Existing ' })), /already in use/);
  assert.deepEqual(fixture.writes, []);
});

test('review rejects stage or garment changes before mutation', async () => {
  const jobs = [order('1')], fixture = workflowFixture(jobs);
  const review = fixture.controller.review('move', jobs.map(model.orderKey), { destination: 'print' });
  jobs[0].items = [{ sku: 'changed', qty: 2 }];
  await assert.rejects(fixture.controller.execute(review), /changed/);
  assert.deepEqual(fixture.writes, []);
});

test('metadata partial failure retains successful members without global rollback', async () => {
  const jobs = [order('1'), order('2')], fixture = workflowFixture(jobs);
  fixture.deps.api.setBundle = async ([ref], label) => { if (ref.orderKey === '2') throw new Error('Save failed'); jobs[0].bundle = label; };
  const result = await fixture.controller.execute(fixture.controller.review('bundle', jobs.map(model.orderKey), { label: 'Team' }));
  assert.deepEqual(result.results.map(item => item.outcome), ['saved', 'failed']);
  assert.equal(jobs[0].bundle, 'Team'); assert.equal(jobs[1].bundle, undefined);
});

test('manifest success plus stage failure retries only stage advancement', async () => {
  const jobs = [order('1', 'blanks_cart'), order('2', 'blanks_cart')], fixture = workflowFixture(jobs);
  const original = fixture.deps.blanks.moveExplicitOrder; let fail = true;
  fixture.deps.blanks.moveExplicitOrder = async (ref, patch) => { if (ref.orderKey === '2' && fail) throw new Error('Offline'); await original(ref, patch); };
  const result = await fixture.controller.execute(fixture.controller.review('ordered', jobs.map(model.orderKey), { supplierOrderNumber: '123456' }));
  assert.deepEqual(result.results.map(item => item.outcome), ['saved', 'remaining']);
  assert.equal(fixture.manifests.length, 1);
  assert.match(fixture.controller.eligibility('ordered', [model.orderKey(jobs[1])]).reason, /Retry remaining/);
  fail = false;
  const retry = await fixture.controller.retryRemaining(fixture.controller.remaining());
  assert.equal(retry.results[0].outcome, 'saved');
  assert.equal(fixture.manifests.length, 1);
  assert.equal(jobs[1].productionStage, 'blanks_ordered');
});

test('stage success plus membership failure retries only batch correction', async () => {
  const jobs = [order('1', 'blanks_ordered')], fixture = workflowFixture(jobs);
  fixture.deps.blanks.prepareExplicitMove = async () => ({ patch: { status: 'received' }, batchChoice: 'remove', batchRefs: [{ id: 'a' }, { id: 'b' }] });
  let fail = true;
  fixture.deps.blanks.correctExplicitBatch = async () => { if (fail) throw new Error('Batch save failed'); };
  const result = await fixture.controller.execute(fixture.controller.review('move', jobs.map(model.orderKey), { destination: 'received' }));
  assert.equal(result.results[0].outcome, 'remaining');
  assert.equal(jobs[0].productionStage, 'received');
  fail = false; await fixture.controller.retryRemaining(fixture.controller.remaining());
  assert.equal(fixture.writes.filter(item => item[0] === 'move').length, 1);
});

test('supplier partial, rejected and unknown results never mark rejected jobs saved or auto retry', async () => {
  for (const outcome of ['partial', 'rejected', 'unknown', 'confirmed']) {
    const jobs = [order('1', 'to_order'), order('2', 'to_order')]; let calls = 0;
    const fixture = workflowFixture(jobs, { submit: async () => { calls++; return { result: { acceptedOrderKeys: outcome === 'confirmed' ? jobs.map(model.orderKey) : outcome === 'partial' ? [model.orderKey(jobs[0])] : [] }, report: { outcome, summary: 'Review supplier result' } }; } });
    const result = await fixture.controller.execute(fixture.controller.review('supplier', jobs.map(model.orderKey)));
    assert.equal(result.results.filter(item => item.outcome === 'saved').length, outcome === 'confirmed' ? 2 : outcome === 'partial' ? 1 : 0);
    assert.equal(calls, 1);
    if (outcome === 'unknown') assert.match(fixture.controller.eligibility('supplier', jobs.map(model.orderKey)).reason, /reconcile/);
  }
});

test('duplicate submit is blocked while an operation is in flight', async () => {
  const jobs = [order('1', 'to_order')]; let release;
  const fixture = workflowFixture(jobs, { submit: () => new Promise(resolve => { release = resolve; }) });
  const reviewed = fixture.controller.review('supplier', jobs.map(model.orderKey));
  const running = fixture.controller.execute(reviewed);
  await assert.rejects(fixture.controller.execute(reviewed), /already running/);
  assert.equal(fixture.controller.eligibility('supplier', jobs.map(model.orderKey)).enabled, false);
  release({ result: { acceptedOrderKeys: jobs.map(model.orderKey) }, report: { outcome: 'confirmed' } }); await running;
});

const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
function adapterFixture() {
  const context = vm.createContext({ document: { body: { dataset: { orderSource: 'shopify' } } }, window: {}, console, URL, URLSearchParams, crypto: require('node:crypto').webcrypto, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../order-manager-web/web-shim.js'), 'utf8'), context);
  const jobs = ['1', '2'].map(id => context.candidateOrderToBoard({ id, displayName: '#Same', source: { provider: 'shopify' }, commerce: { customerName: 'Same' }, production: { stage: 'received', version: 1 } }));
  return { context, jobs };
}

test('real adapter mutations address exact order and preserve name callers', async () => {
  const { context, jobs } = adapterFixture(), calls = [];
  context.window.api.updateProductionMetadata = async (id, payload) => { calls.push(id); return { production: { stage: payload.patch.stage || 'received', bundleId: payload.patch.bundle_id, version: 2 } }; };
  await context.window.api.setBundle([{ provider: 'shopify', orderKey: '1' }], 'Exact');
  assert.deepEqual(calls, ['1']); assert.equal(jobs[0].bundle, 'Exact'); assert.equal(jobs[1].bundle, '');
  await context.window.api.updateBoardMove(jobs[1].name, { status: 'print' });
  assert.deepEqual(calls, ['1', '2']);
  await assert.rejects(context.window.api.updateBoardMove({ provider: 'etsy', orderKey: '1' }, { status: 'print' }), /no longer/);
});

test('real adapter serializes exact identity through names and descriptors', async () => {
  const { context, jobs } = adapterFixture(); let release, concurrent = 0, peak = 0;
  context.window.api.updateProductionMetadata = async () => { concurrent++; peak = Math.max(peak, concurrent); if (!release) await new Promise(resolve => { release = resolve; }); concurrent--; return { production: { version: 2 } }; };
  const first = context.window.api.updateBoardMove({ provider: 'shopify', orderKey: '2' }, { status: 'print' });
  const second = context.window.api.setBundle([jobs[1].name], 'Name path');
  await new Promise(resolve => setImmediate(resolve)); release(); await Promise.all([first, second]);
  assert.equal(peak, 1);
});

test('real adapter never retries a workflow whose prerequisites changed during CAS reconciliation', async () => {
  const { context, jobs } = adapterFixture(); let calls = 0;
  context.window.api.updateProductionMetadata = async () => { calls++; throw Object.assign(new Error('Conflict'), { status: 409, code: 'VERSION_CONFLICT', details: { current: { stage: 'blanks_ordered', version: 2, bundleId: '' } } }); };
  await assert.rejects(context.window.api.updateBoardMove({ provider: 'shopify', orderKey: '1' }, { status: 'print' }, { workflowBaseline: { stage: 'received', bundle: '' } }), error => error.code === 'WORKFLOW_CHANGED');
  assert.equal(calls, 1); assert.equal(jobs[0].productionStage, 'blanks_ordered');
});

test('immutable mutation descriptors fail closed after switching to Legacy', async () => {
  const { context } = adapterFixture(); context.document.body.dataset.orderSource = 'legacy';
  const ref = { provider: 'shopify', orderKey: '1' };
  await assert.rejects(context.window.api.updateBoardMove(ref, { status: 'print' }), /source changed/);
  await assert.rejects(context.window.api.setBundle([ref], 'Team'), /source changed/);
  await assert.rejects(context.window.api.processBatch([ref]), /source changed/);
});

test('accepted supplier orders requiring metadata repair are retained for reconciliation without resubmission', async () => {
  const jobs = [order('1', 'to_order')];
  const fixture = workflowFixture(jobs, { submit: async () => ({ result: { acceptedOrderKeys: jobs.map(model.orderKey) }, report: { outcome: 'confirmed', metadataRepairRequired: ['1'] } }) });
  const result = await fixture.controller.execute(fixture.controller.review('supplier', jobs.map(model.orderKey)));
  assert.equal(result.results[0].outcome, 'unknown');
  assert.match(result.results[0].message, /accepted.*reconciliation/);
  assert.equal(fixture.controller.eligibility('supplier', jobs.map(model.orderKey)).enabled, false);
});

test('multiple batch correction retries skip already confirmed manifest removals', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../order-manager-web/blanks-batches.js'), 'utf8');
  const start = source.indexOf('  async function correctExplicitBatch('), end = source.indexOf('  async function recordExplicitOrdered(', start);
  const cache = new Map([['a', { orderNames: ['Exact'] }], ['b', { orderNames: ['Exact'] }]]), calls = [];
  let fail = true;
  const context = vm.createContext({ assertReceivingNames: () => {}, batchDetailsById: cache,
    removeOrderNamesFromBatchRefs: async (_, [ref]) => { calls.push(ref.id); if (ref.id === 'b' && fail) throw new Error('Offline'); cache.set(ref.id, { orderNames: [] }); }
  });
  vm.runInContext(source.slice(start, end), context);
  const refs = [{ id: 'a' }, { id: 'b' }];
  await assert.rejects(context.correctExplicitBatch({ name: 'Exact' }, refs), /Offline/);
  fail = false; await context.correctExplicitBatch({ name: 'Exact' }, refs);
  assert.deepEqual(calls, ['a', 'b', 'b']);
});

test('receiving manifest subtracts partial shelf claims and rejects fully shelf-covered selected jobs before saving', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../order-manager-web/blanks-batches.js'), 'utf8');
  const start = source.indexOf('  function buildBlanksBatchPayload('), end = source.indexOf('  function visibleOrderNames(', start);
  let claimed = 24, calls = 0, savedPayload;
  const context = vm.createContext({ Map, Number, cleanText: value => String(value || ''),
    orderPayload: order => ({ orderId: order._gid, name: order.name, items: order.items.map(item => ({ ...item })) }),
    window: { api: { getShelfOrder: async () => ({ lines: [{ lineItemId: 'shirt', claimed }] }), createBlanksBatch: async payload => { calls++; savedPayload = payload; return { batch: {} }; } } }
  });
  vm.runInContext(source.slice(start, end), context);
  const selected = [order('1', 'blanks_cart', { items: [{ id: 'shirt', sku: 'B102', qty: 24 }] })];
  await assert.rejects(context.saveBatchForOrders(selected, { requireAllOrders: true }), /supplier garments remaining/);
  assert.equal(calls, 0);
  claimed = 22; await context.saveBatchForOrders(selected, { requireAllOrders: true });
  assert.equal(savedPayload.expectedGarments, 2); assert.equal(calls, 1);
});

test('recovery remains available after a different selection finishes another action', async () => {
  const jobs = [order('1', 'blanks_cart'), order('2', 'received')], fixture = workflowFixture(jobs);
  const original = fixture.deps.blanks.moveExplicitOrder;
  fixture.deps.blanks.moveExplicitOrder = async (ref, patch, baseline) => { if (ref.orderKey === '1') throw new Error('Offline'); return original(ref, patch, baseline); };
  await fixture.controller.execute(fixture.controller.review('ordered', [model.orderKey(jobs[0])], { supplierOrderNumber: '123456' }));
  await fixture.controller.execute(fixture.controller.review('move', [model.orderKey(jobs[1])], { destination: 'print' }));
  assert.deepEqual(fixture.controller.remainingJobs().map(job => job.key), [model.orderKey(jobs[0])]);
});
