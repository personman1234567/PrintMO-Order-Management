const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('order-manager-proxy/worker.js', 'utf8');
const section = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
const context = vm.createContext({ isoNow: () => 'now', validTargetDate: () => false,
  PRODUCTION_STAGES: new Set(['received','to_order','blanks_cart','blanks_ordered','print','completed']),
  garmentCountFromLineItems: () => 10 });
vm.runInContext(section('function validPrintItemId(', 'function garmentCountFromLineItems(')
  + section('function defaultProductionState(', 'function parseProductionMetafield(')
  + section('function normalizeProductionPatch(', 'async function setProductionMetafield(')
  + section('function validatePrintablePatch(', 'function selectOperationalCustomerName('), context);
const plain = value => JSON.parse(JSON.stringify(value));
const value = { printItemId: 'print-1', garmentLineIds: ['tee-1'], placement: 'full-front' };
const patch = entries => context.normalizeProductionPatch({ print_placements: entries });
test('placement assignments survive unrelated production changes and reach revision state', () => {
  const start = context.defaultProductionState();
  const assigned = context.applyProductionPatch(start, patch({ one: value }), 'operator', 'm1');
  assert.deepEqual(plain(assigned.printPlacements.one), value);
  const moved = context.applyProductionPatch(assigned, { stage: 'to_order' }, 'operator', 'm2');
  assert.deepEqual(plain(moved.printPlacements.one), value);
  assert.equal(moved.revision, 2);
});
test('placement delta merges, supports included prints and clearing, without deleting other assignments', () => {
  let state = context.defaultProductionState();
  state = context.applyProductionPatch(state, patch({ one: value, two: { ...value, printItemId: null, placement: 'back-tag' } }), 'op', 'm');
  state = context.applyProductionPatch(state, patch({ one: null }), 'op', 'm2');
  assert.deepEqual(Object.keys(state.printPlacements), ['two']);
  assert.equal(state.printPlacements.two.printItemId, null);
});
test('rejects invalid locations, empty garments, unsafe IDs, excessive records and non-object payloads', () => {
  for (const invalid of [[], null, { a: { ...value, placement: 'invented' } }, { a: { ...value, garmentLineIds: [] } },
    { a: { ...value, garmentLineIds: ['__proto__'] } }, { a: { ...value, printItemId: 123 } },
    Object.fromEntries(Array.from({ length: 251 }, (_, i) => [String(i), value]))]) {
    assert.throws(() => patch(invalid), error => error.code === 'INVALID_PRINT_PLACEMENTS');
  }
});
test('cross-order, removed and self-referencing print assignments fail before committing', () => {
  const state = context.defaultProductionState(), items = [{ id: 'tee-1' }, { id: 'print-1' }];
  const good = patch({ one: value });
  const next = context.applyProductionPatch(state, good, 'op', 'm');
  assert.equal(context.validatePrintablePatch(items, state, good, next), 10);
  for (const entry of [{ ...value, printItemId: 'other-order' }, { ...value, garmentLineIds: ['removed'] },
    { ...value, garmentLineIds: ['print-1'] }]) {
    const change = patch({ one: entry });
    assert.throws(() => context.validatePrintablePatch(items, state, change, next), error => error.code === 'INVALID_PRINT_PLACEMENTS');
  }
});

test('adapter retries unrelated revisions once but retains competing placement edits', async () => {
  const shim = fs.readFileSync('order-manager-web/web-shim.js', 'utf8');
  const part = shim.slice(shim.indexOf('function applyCandidateProduction('), shim.indexOf('// 1) Populate dashboard'));
  const run = async remote => {
    const order = { _gid: 'one', _provider: 'shopify', _version: 1, printPlacements: {}, canonical: { production: {} } };
    let calls = 0;
    const sandbox = { structuredClone, candidateByName: () => order, candidateIdentity: () => 'one',
      candidateStageToBoard: s => s, candidateMutationChains: new Map(), newIdempotencyKey: () => 'key',
      window: { api: { updateProductionMetadata: async () => {
        calls++;
        if (calls === 1) throw Object.assign(Error('Conflict'), { status: 409, code: 'VERSION_CONFLICT',
          details: { current: { version: 2, printPlacements: remote } } });
        return { production: { version: 3, printPlacements: { one: value } } };
      } } } };
    vm.runInNewContext(part, sandbox);
    let error;
    try { await sandbox.updateCandidateOrder('one', { print_placements: { one: value } }, { printPlacementsBaseline: {} }); }
    catch (caught) { error = caught; }
    return { calls, error, order };
  };
  const unrelated = await run({});
  assert.equal(unrelated.calls, 2);
  assert.equal(unrelated.error, undefined);
  const competing = await run({ one: { ...value, placement: 'back-tag' } });
  assert.equal(competing.calls, 1);
  assert.equal(competing.error.code, 'PRINT_PLACEMENTS_CONFLICT');
  assert.equal(competing.order.printPlacements.one.placement, 'back-tag');
  const converged = await run({ one: value });
  assert.equal(converged.calls, 1);
  assert.equal(converged.error, undefined);
});
