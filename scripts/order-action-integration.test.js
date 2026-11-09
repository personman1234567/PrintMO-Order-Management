const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
const shim = fs.readFileSync(path.join(__dirname, '..', 'order-manager-web', 'web-shim.js'), 'utf8');
function section(source, start, end) {
  const offset = source.indexOf(start);
  const finish = source.indexOf(end, offset + start.length);
  assert(offset >= 0 && finish > offset, `Missing executable section: ${start}`);
  return source.slice(offset, finish);
}
const plain = value => JSON.parse(JSON.stringify(value));
const reference = order => ({ provider: order._provider, orderKey: order._orderKey });
function fixture() {
  // Deliberately colliding presentation text; the by-name map resolves Etsy last.
  const orders = ['shopify', 'etsy'].map(provider => ({
    _candidate: true, _provider: provider, _orderKey: `${provider}:fixture:1`,
    _gid: `${provider}:fixture:1`, name: '#1001 - Example Recipient',
    status: provider === 'shopify' ? 'received' : 'print',
    _capabilities: { productionWrite: true }
  }));
  const calls = { canonical: [], legacy: [], confirmations: [], paints: [], closed: 0 };
  let candidate = true, confirmed = true, onConfirm, failure;
  const context = vm.createContext({
    allOrders: orders, detailOrder: orders[0],
    candidateOrdersByIdentity: new Map(orders.map(order => [JSON.stringify([order._provider, order._orderKey]), order])),
    candidateOrdersByName: new Map(orders.map(order => [order.name, order])),
    window: { api: {}, OrderActionModel: require('../order-manager-web/order-action-model.js') },
    isShopifyCandidateView: () => candidate,
    confirm: message => { calls.confirmations.push(message); onConfirm?.(); return confirmed; },
    closeDetail: () => { calls.closed++; },
    renderBoardFromLocalState: async statuses => calls.paints.push([...statuses]),
    apiFetch: async (url, options) => { calls.legacy.push({ url, options: plain(options) }); return { ok: true }; }
  });
  for (const [source, start, end] of [
    [renderer, 'function boardOrderIdentity(', '\nfunction boardMoveSnapshot('],
    [renderer, 'function removeLocalOrders(', '\n/**'],
    [renderer, 'async function removeOrderFromBoard(', '\nfunction makeBundleCard('],
    [shim, 'function candidateByName(', '\nfunction applyCandidateProduction('],
    [shim, 'window.api.deleteOrder =', '\nwindow.api.updateBundleStatus ='],
    [shim, 'window.api.updateProgress =', '\nwindow.api.updateName ='],
    [shim, 'window.api.updateReady =', '\n// Per-order CAS']
  ]) vm.runInContext(section(source, start, end), context);
  context.updateCandidateOrder = async (key, patch) => {
    const order = context.candidateByName(key);
    calls.canonical.push({ target: reference(order), reference: plain(key), patch: plain(patch) });
    if (failure) throw failure;
    return { ok: true };
  };
  return { context, orders, calls,
    setCandidate: value => { candidate = value; },
    setConfirmed: value => { confirmed = value; },
    onConfirm: callback => { onConfirm = callback; },
    fail: error => { failure = error; }
  };
}

test('material choices use Detail patches and exact provider identity through the readiness adapter', async () => {
  const model = require('../order-manager-web/order-board-model');
  for (const provider of ['shopify', 'etsy']) {
    for (const kind of ['prints', 'blanks']) {
      for (const [value] of model.MATERIAL_OPTIONS[kind]) {
        const f = fixture(), target = f.orders.find(order => order._provider === provider);
        Object.assign(target, { productionStage: 'print', blanksOrdered: 0, printsOrdered: 0,
          blanksStatus: 0, printsStatus: 0, printsOnSavedSheet: true });
        const before = JSON.stringify(target);
        const patch = model.materialPatch(kind, value, target);
        const other = kind === 'prints' ? 'blanks' : 'prints';
        assert.equal(Object.hasOwn(patch, `${other}Ordered`), false);
        assert.equal(Object.hasOwn(patch, `${other}Status`), false);
        await f.context.window.api.updateReady(reference(target), patch);
        const call = f.calls.canonical[0];
        assert.deepEqual(call.reference, reference(target));
        assert.deepEqual(call.target, reference(target));
        assert.equal(f.calls.legacy.length, 0);
        assert.equal(JSON.stringify(target), before, 'patch generation never mutates the cached order');
        if (kind === 'prints') {
          assert.equal(call.patch.prints_status, value === 'hand' ? 1 : 0);
          assert.equal(call.patch.prints_ordered, value === 'ordered' ? 1 : 0);
          assert.equal(call.patch.prints_on_saved_sheet, value === 'sheet');
          assert.equal(Object.hasOwn(call.patch, 'stage'), false);
        } else {
          assert.equal(call.patch.blanks_status, value === 'hand' ? 1 : 0);
          assert.equal(call.patch.blanks_ordered, value === 'ordered' ? 1 : 0);
          assert.equal(call.patch.stage, value === 'cart' ? 'blanks_cart' : value === 'ordered' ? 'blanks_ordered' : undefined);
        }
      }
    }
  }
  assert.deepEqual(model.materialPatch('blanks', 'none', { stage: 'blanks_cart' }), { blanksStatus: 0, blanksOrdered: 0, stage: 'received' });
  assert.deepEqual(model.materialPatch('prints', 'hand', { printsOrdered: 1 }), { printsStatus: 1, printsOrdered: 1, printsOnSavedSheet: false });
  assert.throws(() => model.materialPatch('prints', 'cart', {}), /valid material status/);
});

for (const provider of ['etsy']) {
  test(`confirmed ${provider} removal archives only its immutable identity despite a display-name collision`, async () => {
    const f = fixture(), target = f.orders.find(order => order._provider === provider);
    const other = f.orders.find(order => order !== target);
    f.context.detailOrder = other;
    await f.context.removeOrderFromBoard(target);
    assert.equal(f.calls.confirmations[0], `Remove ${target.name} from the board?`);
    assert.deepEqual(f.calls.canonical[0].target, reference(target));
    assert.deepEqual(f.calls.canonical[0].reference, reference(target));
    assert(Number.isFinite(Date.parse(f.calls.canonical[0].patch.archived_at)));
    assert.equal(f.context.allOrders.length, 1);
    assert.equal(f.context.allOrders[0], other);
    assert.equal(f.calls.closed, 0, 'a same-name detail belonging to another provider stays open');
    assert.deepEqual(f.calls.paints, [[target.status]]);
    assert.equal(f.calls.legacy.length, 0);
  });
}

test('removal closes matching detail, while cancel and history never mutate', async () => {
  const f = fixture(), target = f.orders[1];
  f.context.detailOrder = target;
  f.setConfirmed(false);
  await f.context.removeOrderFromBoard(target);
  await f.context.removeOrderFromBoard({ ...target, _historyReadOnly: true });
  assert.equal(f.calls.confirmations.length, 1);
  assert.equal(f.calls.canonical.length, 0);
  assert.equal(f.context.allOrders.length, 2);
  f.setConfirmed(true);
  await f.context.removeOrderFromBoard(target);
  assert.equal(f.calls.closed, 1);
});

test('source switch during removal confirmation cannot send candidate identity to Legacy', async () => {
  const f = fixture();
  f.onConfirm(() => f.setCandidate(false));
  await assert.rejects(f.context.removeOrderFromBoard(f.orders[1]), /source changed/i);
  assert.equal(f.calls.legacy.length, 0);
  assert.equal(f.calls.canonical.length, 0);
  assert.equal(f.context.allOrders.length, 2);
  assert.equal(f.calls.closed, 0);
  assert.equal(f.calls.paints.length, 0);
});

test('failed canonical archive retains both cards and matching detail', async () => {
  const f = fixture();
  f.fail(new Error('Synthetic save failure'));
  await assert.rejects(f.context.removeOrderFromBoard(f.orders[1]), /Synthetic save failure/);
  assert.equal(f.context.allOrders.length, 2);
  assert.equal(f.calls.closed, 0);
  assert.equal(f.calls.paints.length, 0);
});

test('candidate delete adapter rejects read-only and no-longer-current identities', async () => {
  for (const patch of [{ _historyReadOnly: true }, { _capabilities: { productionWrite: false } }, { displayFulfillmentStatus: 'FULFILLED' }]) {
    const f = fixture(); Object.assign(f.orders[1], patch);
    await assert.rejects(f.context.window.api.deleteOrder(reference(f.orders[1])), /read-only/i);
    assert.equal(f.calls.canonical.length, 0);
  }
  const f = fixture();
  await assert.rejects(f.context.window.api.deleteOrder({ provider: 'etsy', orderKey: 'etsy:fixture:missing' }), /no longer/i);
  assert.equal(f.calls.canonical.length, 0);
});

test('printed-count adapter preserves provider identity and completion stage under a name collision', async () => {
  const f = fixture();
  for (const [index, order] of f.orders.entries()) {
    const stage = index ? 'print' : 'completed';
    await f.context.window.api.updateProgress({ name: order.name, ...reference(order), progress: index + 2, stage });
    assert.deepEqual(f.calls.canonical[index], {
      target: reference(order), reference: reference(order), patch: { printed_count: index + 2, stage }
    });
  }
  assert.equal(f.calls.legacy.length, 0);
});

test('pending candidate printed count fails closed after switching to Legacy', async () => {
  const f = fixture(); f.setCandidate(false);
  await assert.rejects(f.context.window.api.updateProgress({ ...reference(f.orders[0]), progress: 4, stage: 'completed' }), /source changed/i);
  assert.equal(f.calls.canonical.length, 0);
  assert.equal(f.calls.legacy.length, 0);
});

test('Shopify and unknown board removal callers fail closed without confirmation or transport', async () => {
  const f = fixture();
  for (const target of [f.orders[0], { ...f.orders[1], _provider: 'unknown' }, { ...f.orders[1], _provider: undefined }]) {
    await f.context.removeOrderFromBoard(target);
    await assert.rejects(f.context.window.api.deleteOrder(reference(target)), /only Etsy/i);
  }
  for (const target of [f.orders[1].name, { provider: 'etsy', orderKey: 'shopify:fixture:1' },
    { provider: 'etsy', orderKey: 'etsy:incomplete' }, {}])
    await assert.rejects(f.context.window.api.deleteOrder(target), /only Etsy/i);
  assert.equal(f.calls.confirmations.length, 0);
  assert.equal(f.calls.canonical.length, 0);
  assert.equal(f.calls.legacy.length, 0);
  assert.equal(f.context.allOrders.length, 2);
});

test('Etsy-looking descriptor cannot archive a conflicting provider record or an order without write capability', async () => {
  for (const patch of [{ _provider: 'shopify' }, { canonical: { source: { provider: 'shopify' } } }, { _capabilities: {} }]) {
    const f = fixture(); Object.assign(f.orders[1], patch);
    await assert.rejects(f.context.window.api.deleteOrder({ provider: 'etsy', orderKey: 'etsy:fixture:1' }), /only Etsy|read-only/i);
    assert.equal(f.calls.canonical.length, 0);
    assert.equal(f.calls.legacy.length, 0);
  }
});

test('Legacy board removal fails closed while printed-count retains its authenticated route', async () => {
  const f = fixture(); f.setCandidate(false);
  await assert.rejects(f.context.window.api.deleteOrder('legacy-fixture'), /source changed/i);
  await f.context.window.api.updateProgress('legacy-fixture', 3);
  assert.equal(f.calls.canonical.length, 0);
  assert.deepEqual(f.calls.legacy.map(call => ({ url: call.url, method: call.options.method, body: JSON.parse(call.options.body) })), [
    { url: '/order-manager/v1/legacy/queue/mutate', method: 'POST', body: { orderName: 'legacy-fixture', patch: { progress: 3 } } }
  ]);
});
