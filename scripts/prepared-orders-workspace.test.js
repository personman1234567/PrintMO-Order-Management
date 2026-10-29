const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
test('prepared workspace is isolated from Legacy and preserves editor leave protection', () => {
  const elements = new Map();
  const document = { body: { dataset: { orderSource: 'legacy', activeView: 'orders' }, classList: { contains: () => false } },
    getElementById: id => { if (!elements.has(id)) elements.set(id, { setAttribute() {}, querySelector: () => null }); return elements.get(id); },
    querySelectorAll: () => [], dispatchEvent() {}, addEventListener() {} };
  const context = { document, window: { matchMedia: () => ({ matches: false }), requestAnimationFrame: callback => callback() }, CustomEvent: function () {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../order-manager-web/workspace-navigation.js'), 'utf8'), context);
  const nav = context.window.OrderManagerNavigation;
  assert.equal(nav.navigate('prepared'), false);
  document.body.dataset.orderSource = 'shopify'; assert.equal(nav.navigate('prepared'), true);
  nav.register('prepared', { canLeave: () => false }); assert.equal(nav.navigate('orders'), false); assert.equal(document.body.dataset.activeView, 'prepared');
});
test('main page loads a small preparation controller, never the editor entry or a hidden startup frame', () => {
  const html = fs.readFileSync(path.join(__dirname, '../order-manager-web/index.html'), 'utf8');
  assert.match(html, /prepared-orders\.js/); assert.doesNotMatch(html, /src=["'][^"']*placement-editor/);
  const controller = fs.readFileSync(path.join(__dirname, '../order-manager-web/prepared-orders-workspace.js'), 'utf8');
  assert.match(controller, /event\.source !== frame\.contentWindow/); assert.match(controller, /event\.origin !== location\.origin/);
});

function editorStartup({ pending = false, cancel, failProduct = false } = {}) {
  const element = tag => ({ tag, children: [], dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
    append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
    setAttribute() {}, addEventListener() {}, focus() {} });
  const root = element('root'), feedback = element('feedback');
  root.querySelector = selector => selector === '.prepared-feedback' ? feedback : null;
  root.querySelectorAll = () => [];
  const document = { getElementById: () => root, createElement: element, querySelector: () => null };
  const window = { addEventListener() {}, OrderManagerNavigation: { register() {} }, api: {
    async preparedDraftRequest() { if (failProduct) { failProduct = false; throw new Error('Product lookup failed'); } return { config: {} }; },
  } };
  // Exercise the real startup function without loading the rest of the admin UI.
  const source = fs.readFileSync(path.join(__dirname, '../order-manager-web/prepared-orders-workspace.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/\}\)\(\);\s*$/, `window.startupTest = { openEditor, busy: () => working, seed(job, cancel) {
      record = { id: 'order', revision: 'saved', items: [], mockups: [] };
      if (job) previewJobs.set('garment', job);
      previewCancel = cancel ? { job, cancel } : null;
    } }; })();`);
  vm.runInNewContext(source, { createPreparedOrderBrowser: () => ({ suspend() {}, remember() {} }), document, window, crypto: require('node:crypto'), console, clearTimeout, setTimeout });
  window.startupTest.seed(pending ? {} : undefined, cancel);
  return { ...window.startupTest, root, feedback, item: { id: 'garment', productId: 'product', title: 'Garment', project: null } };
}

test('Place artwork opens the isolated editor with no pending preview', async () => {
  const startup = editorStartup();
  await startup.openEditor(startup.item);
  assert.equal(startup.root.children.length, 1);
  assert.equal(startup.root.children[0].src, './placement-editor/index.html');
  assert.equal(startup.root.children[0]._context.project, null);
  assert.equal(startup.busy(), false);
});

test('visible garment removal handles alternatives, mockup assignments and pending previews', () => {
  let accept = false, cancellations = 0;
  const source = fs.readFileSync(path.join(__dirname, '../order-manager-web/prepared-orders-workspace.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/\}\)\(\);\s*$/, `window.removalTest = { removeGarment, seed(value) { record=value; activeItemId='root'; const job={}; previewJobs.set('alternative',job); previewCancel={job,cancel:()=>window.cancelled()}; }, state:()=>({record,activeItemId,jobs:previewJobs.size}) }; })();`);
  const root = { querySelector: () => null, querySelectorAll: () => [] };
  const window = { addEventListener() {}, cancelled: () => { cancellations++; }, OrderManagerNavigation:{register(){}} };
  vm.runInNewContext(source, {createPreparedOrderBrowser:()=>({}),document:{getElementById:()=>root},window,confirm:()=>accept,setTimeout:()=>0,clearTimeout,console});
  const record = { items:[{id:'root',title:'Tee'},{id:'alternative',alternativeForItemId:'root'},{id:'keep'}],mockups:[{assetId:'shared',itemIds:['root','alternative','keep']},{assetId:'original',itemIds:['root']}] };
  window.removalTest.seed(record);
  assert.equal(window.removalTest.removeGarment(record.items[0]),false);
  assert.equal(record.items.length,3);
  accept=true; assert.equal(window.removalTest.removeGarment(record.items[0]),true);
  const state=window.removalTest.state();
  assert.deepEqual(Array.from(record.items,item=>item.id),['keep']);
  assert.deepEqual(Array.from(record.mockups[0].itemIds),['keep']);
  assert.equal(record.mockups[1].itemIds.length,0); assert.equal(record.mockups.length,2);
  assert.equal(state.activeItemId,'keep'); assert.equal(state.jobs,0); assert.equal(cancellations,1);
  const build = source.slice(source.indexOf("const heading = node('header'"),source.indexOf("if (!item.alternativeForItemId) panel.append"));
  assert.match(build,/textButton\('Remove garment'/);
});

test('editor startup cancels an existing matching preview, never an absent one', async () => {
  let cancellations = 0;
  const absent = editorStartup({ cancel: () => { cancellations++; } });
  await absent.openEditor(absent.item);
  assert.equal(cancellations, 0);
  const pending = editorStartup({ pending: true, cancel: () => { cancellations++; } });
  await pending.openEditor(pending.item);
  assert.equal(cancellations, 1);
  assert.equal(pending.root.children.length, 1);
});

test('startup failures release the busy state and allow opening the editor again', async () => {
  for (const options of [{ failProduct: true }, { pending: true, cancel: () => { throw new Error('Cancellation failed'); } }]) {
    const startup = editorStartup(options);
    await startup.openEditor(startup.item);
    assert.equal(startup.busy(), false);
    assert.equal(startup.root.children.length, 0);
    assert.ok(startup.feedback.children.length, 'The error and retry must be visible');
    await startup.openEditor(startup.item);
    assert.equal(startup.root.children.length, 1);
    assert.equal(startup.busy(), false);
  }
});

async function previewHarness(timeoutMs = 1000) {
  const { createPreparedPreviewRenderer } = await import('../order-manager-web/prepared-preview-renderer.mjs');
  let receive, frames = 0, removed = 0;
  const messages = [], source = { postMessage(data) { messages.push(data); } };
  const window = { location: { origin: 'https://app.example' }, addEventListener(_, handler) { receive = handler; }, removeEventListener() { receive = null; } };
  const document = { body: { append() { frames++; } }, createElement: () => ({ contentWindow: source, setAttribute() {}, remove() { removed++; } }) };
  const renderer = createPreparedPreviewRenderer({ window, document, timeoutMs });
  return { renderer, messages, count: () => ({ frames, removed }), send: (data, origin = window.location.origin, sender = source) => receive?.({ data, origin, source: sender }) };
}

test('background previews reuse one renderer, acknowledge exports, and reset the previous canvas', async () => {
  const test = await previewHarness(), requestId = '11111111-1111-4111-8111-111111111111';
  for (const session of ['first', 'second']) {
    const result = test.renderer.render({ session });
    if (session === 'first') test.send({ type: 'pm-placement:ready' });
    assert.equal(test.messages.at(-1).context.session, session);
    test.send({ type: 'pm-placement:request', action: 'preview', session, requestId, payload: { proof: session } });
    assert.equal((await result).proof, session);
    assert.equal(test.messages.at(-2).type, 'pm-placement:response');
    assert.equal(test.messages.at(-1).type, 'pm-placement:reset');
  }
  assert.equal(test.count().frames, 1);
  test.renderer.destroy(); assert.equal(test.count().removed, 1);
});

test('preview messages require the matching source, origin and current session', async () => {
  const test = await previewHarness(), result = test.renderer.render({ session: 'current' });
  test.send({ type: 'pm-placement:ready' }, 'https://wrong.example');
  test.send({ type: 'pm-placement:ready' }, undefined, {});
  assert.equal(test.messages.length, 0);
  test.send({ type: 'pm-placement:ready' });
  test.send({ type: 'pm-placement:preview-error', session: 'previous', message: 'stale' });
  test.send({ type: 'pm-placement:preview-error', session: 'current', message: 'Image could not load' });
  await assert.rejects(result, /Image could not load/);
  const retry = test.renderer.render({ session: 'retry' }); test.renderer.cancel();
  await assert.rejects(retry, /cancelled/); test.renderer.destroy();
});

test('a stalled preview is bounded and the renderer can be retried afterwards', async () => {
  const test = await previewHarness(5);
  await assert.rejects(test.renderer.render({ session: 'stalled' }), /could not finish/);
  const retry = test.renderer.render({ session: 'retry' }); test.renderer.destroy();
  await assert.rejects(retry, /cancelled/);
});


test('prepared browse state labels do not conflate saved work with customer-link readiness', async () => {
  const { preparedOrderListState, preparedListDate } = await import('../order-manager-web/prepared-order-browser.mjs');
  assert.deepEqual(preparedOrderListState('ready'), ['Link ready', 'success']);
  assert.deepEqual(preparedOrderListState('changes'), ['Unpublished changes', 'warning']);
  assert.equal(preparedOrderListState('none')[0], 'No customer link');
  assert.equal(preparedOrderListState('unrecognized')[0], 'Link status unavailable');
  const now = new Date(2026, 9, 28, 12);
  assert.equal(preparedListDate(now.toISOString(), now), 'Today');
  assert.equal(preparedListDate(new Date(2026, 9, 27, 12).toISOString(), now), 'Yesterday');
  assert.equal(preparedListDate('invalid', now), '');
});
