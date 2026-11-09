const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const detail = require('../order-manager-web/order-detail-state');
const worker = fs.readFileSync('order-manager-proxy/worker.js', 'utf8');
const shim = fs.readFileSync('order-manager-web/web-shim.js', 'utf8');
const between = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const plain = value => JSON.parse(JSON.stringify(value));
const backend = vm.createContext({ isoNow: () => 'now', validTargetDate: () => false, validPrintItemId: () => true,
  normalizePrintPlacements: value => value || {}, PRODUCTION_STAGES: new Set(['received', 'print', 'completed', 'blanks_cart', 'blanks_ordered']) });
vm.runInContext(between(worker, 'function defaultProductionState(', 'async function readProductionMetafield(')
  + between(worker, 'function normalizeProductionPatch(', 'async function setProductionMetafield('), backend);

test('reference use survives canonical normalization, unrelated edits, hydration and explicit recovery without changing assets', () => {
  const asset = { assetId: 'original', side: 'front', name: 'Original.png' };
  let state = backend.defaultProductionState();
  const change = backend.normalizeProductionPatch({ artwork_references: { 'original|front': true, 'second|back': true } });
  state = backend.applyProductionPatch(state, change, 'op', 'keep');
  state = backend.normalizeProductionState(JSON.parse(JSON.stringify(state)));
  state = backend.applyProductionPatch(state, { internalNotes: 'Unrelated' }, 'op', 'notes');
  const dto = backend.productionForClient('order', state, 'digest', [asset]);
  const local = { _version: 0, printsOnSavedSheet: true };
  detail.mergeCanonicalProductionState(local, dto);
  assert.deepEqual(plain(local.artworkReferences), { 'original|front': true, 'second|back': true });
  assert.equal(local.printsOnSavedSheet, false);
  assert.deepEqual(plain(dto.assets), [asset]);
  state = backend.applyProductionPatch(state, { artworkReferences: { 'original|front': null } }, 'op', 'restore');
  assert.deepEqual(plain(state.artworkReferences), { 'second|back': true });
  detail.mergeCanonicalProductionState(local, { version: 0, artworkReferences: {} });
  assert.equal(local.artworkReferences['original|front'], true, 'stale hydration cannot undo reference use');
});

test('invalid reference values, unsafe identities and excessive changes are rejected; old records default empty', () => {
  assert.deepEqual(plain(backend.normalizeProductionState({}).artworkReferences), {});
  for (const value of [null, [], 'original', { '__proto__|': false }, { 'original|front': 1 }, { 'original|front': false },
    { 'original|front': 'true' }, { 'original': true }, Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`a${i}|front`, true]))]) {
    assert.throws(() => backend.normalizeProductionPatch({ artwork_references: value }), error => error.code === 'INVALID_ARTWORK_REFERENCE');
  }
});

function adapter(orders, commit) {
  let active = true;
  const byId = new Map(orders.map(order => [order._gid, order]));
  const calls = [];
  const candidateByName = reference => {
    const order = byId.get(typeof reference === 'string' ? reference : reference.orderKey);
    if (!order) throw Error('Order no longer available');
    return order;
  };
  const context = { structuredClone, candidateByName, candidateIdentity: order => order._gid,
    candidateStageToBoard: stage => stage, candidateMutationChains: new Map(), newIdempotencyKey: () => 'synthetic-key',
    isShopifyCandidateView: () => active,
    window: { api: { updateProductionMetadata: async (id, payload) => {
      calls.push({ id, payload: plain(payload) });
      if (commit) await commit(id, payload, calls.length);
      return { production: { version: byId.get(id)._version + 1, printsOrdered: 1, printsOnSavedSheet: false } };
    } } } };
  vm.runInNewContext(between(shim, 'function applyCandidateProduction(', '// 1) Populate dashboard')
    + between(shim, 'window.api.markSavedSheetPrintsOrdered =', 'window.api.setArtworkReference ='), context);
  return { api: context.window.api, calls, setActive: value => { active = value; }, context };
}
const order = (id, patch = {}) => ({ _candidate: true, _provider: 'shopify', _gid: id, _orderKey: id,
  _version: 1, productionStage: 'received', printsOnSavedSheet: true, printsOrdered: 0, printsStatus: 0,
  canonical: { production: {} }, ...patch });
const ref = order => ({ provider: order._provider, orderKey: order._orderKey });

test('bulk update saves only eligible selected orders, deduplicates and preserves independent material state', async () => {
  const orders = [order('saved', { blanksStatus: 1, blanksOrdered: 0, bundle: 'KEEP', notes: 'KEEP', progress: 2 }),
    order('untouched'), order('none', { printsOnSavedSheet: false }), order('ordered', { printsOrdered: 1 }),
    order('hand', { printsStatus: 1 }), order('history', { _historyReadOnly: true }),
    order('read-only', { _capabilities: { productionWrite: false } }), order('completed', { productionStage: 'completed' }),
    order('etsy', { _provider: 'etsy' })];
  const api = adapter(orders);
  const results = await api.api.markSavedSheetPrintsOrdered([ref(orders[0]), ref(orders[0]), ...orders.slice(2).map(ref)]);
  assert.equal(results.results.filter(row => row.outcome === 'saved').length, 1);
  assert.deepEqual(api.calls, [{ id: 'saved', payload: { expectedVersion: 1,
    patch: { prints_ordered: 1, prints_on_saved_sheet: false }, idempotencyKey: 'synthetic-key' } }]);
  assert.equal(orders[1].printsOnSavedSheet, true);
  assert.equal(orders[0].printsOnSavedSheet, false);
  assert.equal(orders[0].printsStatus, 0);
  for (const [field, value] of Object.entries({ blanksStatus: 1, blanksOrdered: 0, bundle: 'KEEP', notes: 'KEEP', progress: 2 })) assert.equal(orders[0][field], value);
});

test('partial failure keeps confirmed success and continues to the next saved order', async () => {
  const orders = [order('a'), order('b'), order('c')];
  const api = adapter(orders, async id => { if (id === 'b') throw Error('Synthetic network failure'); });
  const result = await api.api.markSavedSheetPrintsOrdered(orders.map(ref));
  assert.deepEqual(plain(result.results.map(row => row.outcome)), ['saved', 'failed', 'saved']);
  assert.equal(orders[0].printsOrdered, 1); assert.equal(orders[1].printsOrdered, 0); assert.equal(orders[2].printsOrdered, 1);
});

test('changed sheet state on a version conflict prevents a retry; unrelated revision retries once', async () => {
  for (const changed of [true, false]) {
    const current = order('a');
    const api = adapter([current], async (_, payload, count) => {
      if (count === 1) throw Object.assign(Error('Conflict'), { status: 409, code: 'VERSION_CONFLICT', details: { current: {
        version: 2, printsOnSavedSheet: !changed, printsStatus: changed ? 1 : 0, printsOrdered: 0
      } } });
    });
    const result = await api.api.markSavedSheetPrintsOrdered([ref(current)]);
    assert.equal(result.results[0].outcome, changed ? 'changed' : 'saved');
    assert.equal(api.calls.length, changed ? 1 : 2);
    if (changed) assert.equal(current.printsStatus, 1, 'independent In hand state must survive');
    else assert.equal(api.calls[1].payload.expectedVersion, 2);
  }
});

test('source switch during a bulk update stops subsequent writes', async () => {
  const orders = [order('a'), order('b')];
  const api = adapter(orders, async () => api.setActive(false));
  const result = await api.api.markSavedSheetPrintsOrdered(orders.map(ref));
  assert.equal(api.calls.length, 1);
  assert.equal(result.results[1].outcome, 'failed');
  assert.equal(orders[1].printsOnSavedSheet, true);
});
