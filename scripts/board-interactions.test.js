const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
const batches = fs.readFileSync(path.join(__dirname, '..', 'order-manager-web/blanks-batches.js'), 'utf8');
const section = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const item = id => ({ _candidate: true, _provider: 'shopify', _gid: id, _orderKey: id,
  name: `#${id} – Fixture`, _version: 1, status: 'received', productionStage: 'received',
  blanksOrdered: 0, blanksStatus: 0, printsOrdered: 0, printsStatus: 0,
  canonical: { production: { stage: 'received', version: 1 } } });

function moves(orders = [item('one')]) {
  const frames = [], paints = [];
  const context = vm.createContext({
    allOrders: orders, window: {}, Date, Set, Map, console,
    setTimeout: () => 0, requestAnimationFrame: fn => frames.push(fn),
    document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], body: {
      dataset: { orderSource: 'shopify' }, classList: { contains: () => false }
    } },
    renderBoard: async () => paints.push('refresh'),
    renderBoardFromLocalState: async statuses => paints.push([...statuses]),
    publishOrderManagerBoardSnapshot() {}
  });
  vm.runInContext(section(renderer, 'const candidateBoardCards', 'function publishOrderManagerBoardSnapshot'), context);
  vm.runInContext(section(renderer, 'function patchLocalOrders', '\n/**'), context);
  vm.runInContext(section(renderer, 'window.mergeOrderManagerProduction', '\n/**'), context);
  return {
    context, frames, paints,
    begin(patch, names = orders.map(order => order.name)) {
      const token = context.window.beginOrderManagerMove(names, patch);
      context.allOrders.forEach(order => context.applyPendingBoardMove(order));
      return token;
    },
    finish(token, success) { context.window.finishOrderManagerMove(token, success); },
    ack(order, status, version, fields = {}) {
      const before = order.status;
      Object.assign(order, { status, productionStage: status, _version: version, ...fields });
      order.canonical.production = { stage: order.productionStage, version };
      context.window.mergeOrderManagerProduction(order, before);
    }
  };
}

test('an older acknowledgment cannot undo a newer move', () => {
  const order = item('one'), f = moves([order]);
  const first = f.begin({ status: 'print' });
  const second = f.begin({ status: 'received' });
  f.ack(order, 'print', 2);
  assert.equal(order.status, 'received');
  f.finish(first, true);
  assert.equal(order.status, 'received');
  f.ack(order, 'received', 3);
  f.finish(second, true);
  assert.equal(order.status, 'received');
  assert.equal(order._version, 3);
});

test('failed newer move restores the last acknowledged state', () => {
  const order = item('one'), f = moves([order]);
  const first = f.begin({ status: 'print' });
  const second = f.begin({ status: 'received' });
  f.ack(order, 'print', 2);
  f.finish(first, true);
  f.finish(second, false);
  assert.equal(order.status, 'print');
  assert.equal(order._version, 2);
});

test('failed older move preserves a newer pending destination', () => {
  const order = item('one'), f = moves([order]);
  const first = f.begin({ status: 'print' });
  const second = f.begin({ status: 'blanks', blanksOrdered: 1 });
  f.finish(first, false);
  assert.equal(order.status, 'blanks');
  assert.equal(order.productionStage, 'blanks_ordered');
  f.ack(order, 'blanks', 2, { productionStage: 'blanks_ordered', blanksOrdered: 1 });
  f.finish(second, true);
  assert.equal(order.blanksOrdered, 1);
});

test('all failed moves restore original readiness as well as stage', () => {
  const order = item('one'), f = moves([order]);
  const token = f.begin({ status: 'blanks', blanksOrdered: 1 });
  f.finish(token, false);
  assert.equal(order.status, 'received');
  assert.equal(order.productionStage, 'received');
  assert.equal(order.blanksOrdered, 0);
});

test('partial bundle failure keeps acknowledged member changes', () => {
  const a = item('one'), b = item('two'), f = moves([a, b]);
  const token = f.begin({ status: 'print' });
  f.ack(a, 'print', 2);
  f.finish(token, false);
  assert.equal(a.status, 'print');
  assert.equal(b.status, 'received');
});

test('moves reconcile the current DTO after replacement', () => {
  const initial = item('one'), f = moves([initial]);
  const token = f.begin({ status: 'print' });
  const replacement = item('one');
  f.context.allOrders = [replacement];
  f.ack(replacement, 'print', 2);
  f.finish(token, true);
  assert.equal(replacement.status, 'print');
  assert.equal(replacement._version, 2);
});

test('deferred refresh flushes once after the last move settles', async () => {
  const f = moves(), token = f.begin({ status: 'print' });
  vm.runInContext('boardRefreshDeferred = true', f.context);
  f.context.flushDeferredBoardRefresh();
  assert.equal(f.frames.length, 0);
  f.finish(token, true);
  f.context.flushDeferredBoardRefresh();
  assert.equal(f.frames.length, 1);
  await f.frames[0]();
  assert.equal(f.paints.filter(value => value === 'refresh').length, 1);
});

function dropFixture() {
  const calls = { reads: 0, reviews: 0, moves: 0 };
  const context = vm.createContext({
    window: {}, console, document: { dispatchEvent() {} }, CustomEvent: class {}, orderNamesFromDragId: () => ['fixture'],
    movePatchForDropTarget: (status, options) => ({ status, blanksOrdered: options.blanksOrdered || 0 }),
    batchRefsForOrders: async () => { calls.reads++; return [{ id: 'batch' }]; },
    moveTouchesBatchMembership: (status, patch) => ['received', 'toOrder'].includes(status) || (status === 'blanks' && !patch.blanksOrdered),
    resolveBatchCorrection: async () => { calls.reviews++; return 'keep'; },
    statusLabel: () => 'Fixture', applyBatchAwareOrderMove: async () => { calls.moves++; return true; },
    removeOrderNamesFromBatchRefs: async () => {}
  });
  vm.runInContext(section(batches, '  async function handleBatchAwareDrop', '  async function applyBatchAwareOrderMove'), context);
  return { context, calls };
}

test('Production and Ordered drops do not wait for supplier accounting', async () => {
  const f = dropFixture();
  await f.context.handleBatchAwareDrop('fixture', 'print');
  await f.context.handleBatchAwareDrop('fixture', 'blanks', { blanksOrdered: 1 });
  assert.deepEqual(f.calls, { reads: 0, reviews: 0, moves: 2 });
});

test('membership-affecting drops retain lookup and correction review', async () => {
  const f = dropFixture();
  for (const destination of ['received', 'toOrder', 'blanks']) await f.context.handleBatchAwareDrop('fixture', destination);
  assert.deepEqual(f.calls, { reads: 3, reviews: 3, moves: 3 });
});

test('bundle persistence waits for every member before reporting partial failure', async () => {
  let settleSecond;
  const context = vm.createContext({ isShopifyBoard: () => true, window: { api: {
    updateBoardMove: name => name === 'a' ? Promise.reject(new Error('Rejected'))
      : new Promise(resolve => { settleSecond = resolve; })
  } } });
  vm.runInContext(section(batches, '  async function persistOrderMove', '  async function removeOrderNamesFromBatchRefs'), context);
  let finished = false;
  const request = context.persistOrderMove(['a', 'b'], 'print', {}).catch(error => { finished = true; return error; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(finished, false);
  settleSecond(true);
  assert.equal((await request).message, 'Rejected');
});

test('drop slot follows snapshot order and the selected Pipeline sort, including ties', () => {
  const drag = fs.readFileSync(path.join(__dirname, '..', 'order-manager-web/desktop-drag-polish.js'), 'utf8');
  const select = { value: 'newest' };
  const context = vm.createContext({ document: { body: { dataset: { orderSource: 'shopify' } }, getElementById: () => select } });
  vm.runInContext(section(drag, '  function placeholderOrder', '  function findPlaceholderAnchor'), context);
  const first = { group: 1, sortTime: 20, position: 0, received: 20, score: 1, value: 10 };
  const next = { ...first, position: 5, received: 10, score: 5, value: 50 };
  assert(context.placeholderOrder(first, next, { id: 'col-print' }) < 0, 'production follows the snapshot rather than oldest-first');
  assert(context.placeholderOrder(first, next, { id: 'col-received' }) < 0, 'newest-first puts the newer card first');
  select.value = 'oldest';
  assert(context.placeholderOrder(first, next, { id: 'col-received' }) > 0);
  select.value = 'value';
  assert(context.placeholderOrder(first, next, { id: 'col-received' }) > 0);
  select.value = 'attention';
  assert(context.placeholderOrder(first, next, { id: 'col-received' }) > 0);
  assert(context.placeholderOrder(first, { ...first, position: 5 }, { id: 'col-received' }) < 0, 'ties retain the renderer base order');
});

test('status mutations cannot consume the landing animation before the drop paints', () => {
  const drag = fs.readFileSync(path.join(__dirname, '..', 'order-manager-web/desktop-drag-polish.js'), 'utf8');
  let animations = 0;
  const handoffs = new Set([{}]);
  const context = vm.createContext({ isDesktop: () => true, activeDragCard: null, dropHandoffs: handoffs,
    layoutBeforeDrop: new Map([['order', {}]]), recentDropKeys: new Set(['order']),
    animateSnapshot: () => animations++ });
  vm.runInContext(section(drag, '  function animateAfterRender', '  function schedulePostRenderAnimation'), context);
  context.animateAfterRender();
  assert.equal(animations, 0);
  assert.equal(context.layoutBeforeDrop.size, 1);
  handoffs.clear();
  context.animateAfterRender(); context.animateAfterRender();
  assert.equal(animations, 1);
});

test('landing releases its transform effect without clearing a newer animation', () => {
  const drag = fs.readFileSync(path.join(__dirname, '..', 'order-manager-web/desktop-drag-polish.js'), 'utf8');
  const animations = [], layoutAnimations = new WeakMap();
  const card = { animate() {
    const animation = { cancel() { this.cancelled = true; this.oncancel?.(); } };
    animations.push(animation);
    return animation;
  } };
  const context = vm.createContext({ reducedMotion: { matches: false }, layoutAnimations });
  vm.runInContext(section(drag, '  function animateLayoutShift', '  function animateSnapshot'), context);
  const from = { left: 30, top: 40 }, to = { left: 0, top: 0 };
  context.animateLayoutShift(card, from, to);
  const first = animations[0];
  first.onfinish();
  assert.equal(first.cancelled, true, 'finished transform effect is removed');
  assert.equal(layoutAnimations.has(card), false);
  context.animateLayoutShift(card, from, to);
  const second = animations[1];
  first.oncancel();
  assert.equal(layoutAnimations.get(card), second, 'late cleanup cannot clear a newer move');
  second.cancel();
  assert.equal(layoutAnimations.has(card), false);
});

test('a held drop keeps its ghost and source suppression until the matching paint', async () => {
  const drag = fs.readFileSync(path.join(__dirname, '..', 'order-manager-web/desktop-drag-polish.js'), 'utf8');
  const element = (classes = []) => ({ dataset: { orderId: 'fixture' }, parentElement: {},
    classList: { values: new Set(classes), contains(name) { return this.values.has(name); },
      add(name) { this.values.add(name); }, remove(name) { this.values.delete(name); } },
    getBoundingClientRect: () => ({ left: 800, top: 100 }), remove() { this.removed = true; } });
  const source = element(), ghost = element(), placeholder = element(), snapshots = [];
  const context = vm.createContext({
    document: { body: { dataset: { orderSource: 'shopify' } }, dispatchEvent() {} }, CustomEvent: class {},
    dragGhost: ghost, ghostFrame: 0, hoverPlaceholder: placeholder, placeholderZone: {}, placeholderAnchor: {},
    layoutBeforeDrop: new Map(), recentDropKeys: new Set(), dropHandoffs: new Set(), layoutAnimations: new WeakMap(),
    updateDragGhost() {}, cardKey: () => 'fixture', placeholderContainerForZone: zone => zone,
    captureLayout: () => new Map([['fixture', { left: 0, top: 0 }]]), allBoardCards: () => [],
    animateSnapshot: snapshot => snapshots.push(snapshot)
  });
  vm.runInContext(section(drag, '  function beginDropHandoff', "  document.addEventListener('printmo:order-move-painted'"), context);
  assert.equal(context.beginDropHandoff(source, {}), true);
  assert.equal(source.classList.contains('drag-handoff-source'), true);
  assert.equal(ghost.classList.contains('drag-handoff-ghost'), true);
  assert.equal(ghost.removed, undefined);
  context.finishDropHandoffs(['another-order']);
  assert.equal(ghost.removed, undefined);
  context.finishDropHandoffs(['fixture']);
  context.finishDropHandoffs(['fixture']);
  assert.equal(ghost.removed, true);
  assert.equal(placeholder.removed, true);
  assert.equal(source.classList.contains('drag-handoff-source'), false);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].get('fixture').left, 800);
});

test('detail removal preserves confirmation and history protection', async () => {
  let allow = false;
  const calls = [];
  const context = vm.createContext({ confirm: () => allow,
    window: { api: { deleteOrder: async name => calls.push(['remove', name]) } },
    detailOrder: { name: 'fixture' }, closeDetail: () => calls.push(['close']),
    removeLocalOrders: names => { calls.push(['local', ...names]); return ['received']; },
    renderBoardFromLocalState: async statuses => calls.push(['paint', ...statuses]) });
  vm.runInContext(section(renderer, 'async function removeOrderFromBoard', 'function makeBundleCard'), context);
  await context.removeOrderFromBoard({ name: 'fixture', _candidate: true });
  assert.equal(calls.length, 0);
  allow = true;
  await context.removeOrderFromBoard({ name: 'fixture', _candidate: true, _historyReadOnly: true });
  assert.equal(calls.length, 0);
  await context.removeOrderFromBoard({ name: 'fixture', _candidate: true });
  assert.deepEqual(calls, [['remove', 'fixture'], ['local', 'fixture'], ['close'], ['paint', 'received']]);
});
