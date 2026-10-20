const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
const globals = source.slice(source.indexOf('const manualMockupsByOrderNumber'), source.indexOf('let activeCardDrag'));
const hydration = source.slice(source.indexOf('function orderNumberFromOrder'), source.indexOf('function splitOrderAssets'));
const manifests = source.slice(source.indexOf('function candidateMockupManifests'), source.indexOf('function getFirstMockupAssetIdentity'));
const state = source.slice(source.indexOf('function getProductionMockupState'), source.indexOf('function productionMockupSlotMarkup'));
const order = number => ({ name: `#${number} – Example`, _candidate: true, _provider: 'shopify', items: [] });
const empty = numbers => ({ orders: Object.fromEntries(numbers.map(number => [number, { orderNumber: number, assets: [] }])) });

function fixture(api = {}) {
  const updates = [];
  const context = vm.createContext({
    window: { api: { listManualMockups: async () => ({ assets: [] }), bulkListManualMockups: async numbers => empty(numbers), ...api } },
    console: { warn() {} }, allOrders: []
  });
  vm.runInContext(`${globals}\n${hydration}\n${manifests}\n${state}`, context);
  context.window.updateBoardMockupPreview = item => {
    if (item) updates.push({ order: item, number: context.orderNumberFromOrder(item), state: context.getProductionMockupState(item, false) });
  };
  return { context, updates, state: item => context.getProductionMockupState(item, false) };
}

test('a confirmed empty lookup settles to unavailable and repaints its card', async () => {
  const f = fixture(), item = order(2001);
  assert.equal(f.state(item), 'loading');
  await f.context.hydrateManualMockupsForOrders([item]);
  assert.equal(f.state(item), 'unavailable');
  assert.equal(f.updates.at(-1).state, 'unavailable');
});

test('background refresh preserves a confirmed no-preview state while checking again', async () => {
  const f = fixture(), item = order(2002);
  await f.context.hydrateManualMockupsForOrders([item]);
  let resolve;
  f.context.window.api.bulkListManualMockups = () => new Promise(done => { resolve = done; });
  const pending = f.context.hydrateManualMockupsForOrders([item], { refresh: true });
  assert.equal(f.state(item), 'unavailable');
  resolve(empty(['2002']));
  await pending;
  assert.equal(f.state(item), 'unavailable');
});

test('overlapping queue pages do not invalidate another order lookup', async () => {
  const requests = [];
  const f = fixture({ bulkListManualMockups: numbers => new Promise(resolve => requests.push({ numbers, resolve })) });
  const first = order(2003), second = order(2004);
  const pageOne = f.context.hydrateManualMockupsForOrders([first]);
  const pageTwo = f.context.hydrateManualMockupsForOrders([first, second], { refresh: true });
  assert.equal(requests[0].numbers.join(','), '2003');
  assert.equal(requests[1].numbers.join(','), '2004');
  requests[1].resolve(empty(['2004']));
  await pageTwo;
  requests[0].resolve(empty(['2003']));
  await pageOne;
  assert.equal(f.state(first), 'unavailable');
  assert.equal(f.state(second), 'unavailable');
});

test('detail refresh supersedes only its own order and rejects older bulk artwork', async () => {
  let resolve;
  const f = fixture({ bulkListManualMockups: () => new Promise(done => { resolve = done; }) });
  const first = order(2005), second = order(2006);
  const batch = f.context.hydrateManualMockupsForOrders([first, second]);
  await f.context.refreshManualMockupsForOrder(first);
  resolve({ orders: { '2005': { assets: [{ id: 'obsolete', url: 'https://example.test/old.png' }] }, '2006': { assets: [] } } });
  await batch;
  assert.equal(f.context.getManualMockupsForOrder(first).length, 0);
  assert.equal(f.state(first), 'unavailable');
  assert.equal(f.state(second), 'unavailable');
});

test('failed or omitted lookups show failure, not loading or an invented empty result', async () => {
  for (const response of [async () => { throw new Error('Offline'); }, async () => ({ orders: {} })]) {
    const f = fixture({ bulkListManualMockups: response }), item = order(2007);
    await f.context.hydrateManualMockupsForOrders([item]);
    assert.equal(f.state(item), 'failed');
    assert.equal(f.updates.at(-1).state, 'failed');
  }
});

test('Etsy without a mapped preview is unavailable without a manual lookup', async () => {
  let reads = 0;
  const f = fixture({ bulkListManualMockups: async () => { reads++; return { orders: {} }; } });
  const item = { ...order(2008), _provider: 'etsy' };
  assert.equal(f.state(item), 'unavailable');
  await f.context.hydrateManualMockupsForOrders([item]);
  assert.equal(reads, 0);
});

test('known private or catalog sources remain loading until their resolution and then show failure accurately', async () => {
  const f = fixture(), item = order(2009);
  const asset = { role: 'mockup', assetId: 'art-2009' };
  item.items = [{ assets: [asset] }];
  await f.context.hydrateManualMockupsForOrders([item]);
  assert.equal(f.state(item), 'loading');
  asset._previewState = 'failed';
  assert.equal(f.state(item), 'failed');
  assert.equal(f.context.getProductionMockupState(item, true), 'ready');
  const catalog = { ...order(2010), _provider: 'etsy', items: [{ catalogPreview: { previewId: 'catalog-1', _previewState: 'failed' } }] };
  assert.equal(f.state(catalog), 'failed');
});

test('bulk hydration respects the Worker 250-order limit', async () => {
  const sizes = [];
  const f = fixture({ bulkListManualMockups: async numbers => { sizes.push(numbers.length); return empty(numbers); } });
  const items = Array.from({ length: 251 }, (_, i) => order(3000 + i));
  await f.context.hydrateManualMockupsForOrders(items);
  assert.equal(sizes.join(','), '250,1');
  assert.equal(f.state(items[250]), 'unavailable');
});

test('a failed background recheck does not replace known artwork or a confirmed empty result', async () => {
  const f = fixture(), item = order(2011);
  await f.context.hydrateManualMockupsForOrders([item]);
  f.context.window.api.bulkListManualMockups = async () => { throw new Error('Offline'); };
  await f.context.hydrateManualMockupsForOrders([item], { refresh: true });
  assert.equal(f.state(item), 'unavailable');
});

test('late manual results reconcile with newer private artwork in the current board snapshot', async () => {
  let resolve;
  const f = fixture({ bulkListManualMockups: () => new Promise(done => { resolve = done; }) });
  const original = { ...order(2012), _orderKey: 'fixture:2012' };
  const pending = f.context.hydrateManualMockupsForOrders([original]);
  const current = { ...original, items: [{ assets: [{ assetId: 'new-art', role: 'mockup' }] }] };
  f.context.allOrders = [current];
  resolve(empty(['2012']));
  await pending;
  assert.equal(f.updates.at(-1).order, current);
  assert.equal(f.updates.at(-1).state, 'loading');
});
