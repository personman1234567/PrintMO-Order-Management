const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const model = require('../order-manager-web/mobile-order-model');
const source = fs.readFileSync(path.join(__dirname, '../order-manager-web/mobile-order-workspace.js'), 'utf8');

class Node {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = {}; this.classList = { toggle() {} }; }
  append(...nodes) { for (const node of nodes) { node.remove(); this.children.push(node); node.parentNode = this; } }
  replaceChildren(...nodes) { for (const node of this.children) node.parentNode = null; this.children = []; this.append(...nodes); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); this.parentNode = null; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
}
function harness() {
  const row = { key: 'shopify:1', number: '#1837', customer: 'Repeated customer', provider: 'shopify', stageLabel: 'Ordered',
    stage: 'blanks_ordered', receivedAt: '2026-01-01T00:00:00Z',
    quantities: { garments: 3, prints: 2 }, materials: { blanks: { label: 'Ordered', value: 'ordered' }, prints: { label: 'Not recorded', value: 'none' } },
    progress: { printed: 0, printable: 3 } };
  const order = { items: [] };
  const recognition = { preview: { url: 'https://example.test/front.png', state: 'ready', kind: 'front', identity: 'front-1' },
    garments: [{ label: 'Black T-shirt', qty: 2 }, { label: 'Blue hoodie', qty: 1 }], moreLabel: '', delivery: { kind: 'pickup', label: 'Pickup' } };
  const calls = { opened: [], failed: [], scheduled: 0 };
  const el = (tag, text, className) => { const node = new Node(tag); node.textContent = text; node.className = className; return node; };
  const context = vm.createContext({ el, button: (text, action, className) => { const node = el('button', text, className); node.listeners.click = action; return node; },
    icon: () => '<svg aria-hidden="true"></svg>', document: { createElement: tag => new Node(tag) },
    window: { MobileOrderRecognition: { describe: () => recognition, markPreviewFailed: (raw, identity) => {
      calls.failed.push({ raw, identity }); recognition.preview = { state: 'failed', kind: 'garment', identity: '' };
    } }, OrderGarmentSummary: { models: () => [{ key: 'black', locations: ['front'] }], diagram: model => { assert.deepEqual([...model.locations], []); return '<svg>Garment reference</svg>'; } } },
    model, previewObserver: null, area: 'orders', selected: new Set(), selectionMode: false, busy: false,
    openOrder: key => calls.opened.push(key), renderSelection() {}, openActions() {}, startProgress() {},
    findOrder: () => order, board: { indicators: () => [{ label: 'Cached data', tone: 'neutral' }] },
    renderEditor() {}, schedule: () => calls.scheduled++ });
  vm.runInContext(source.slice(source.indexOf('    function makeRow('), source.indexOf('    function renderEditor(')), context);
  const record = context.makeRow(row);
  return { context, row, order, recognition, calls, record, render: () => context.renderRow(row, record) };
}

test('Orders keeps a separate large proof control and a bounded order-status rail', () => {
  const h = harness(); h.render();
  assert.equal(h.record.previewButton.parentNode, h.record.preview);
  assert.equal(h.record.preview.parentNode, h.record.node);
  assert.notEqual(h.record.previewButton.parentNode, h.record.open);
  h.record.previewButton.listeners.click(); assert.deepEqual(h.calls.opened, [h.row.key]);
  assert.equal(h.record.previewCaption.hidden, true, 'ordinary front mockups have no redundant badge');
  assert.equal(h.record.delivery.children.at(-1).textContent, 'Pickup');
  assert.equal(h.record.delivery.parentNode, h.record.number);
  assert.equal(h.record.attention.children.length, 0, 'cache metadata does not occupy a card row');
  assert.equal(h.record.stage.parentNode, h.record.rail);
  assert.equal(h.record.detail.parentNode, h.record.status);
  assert.equal(h.record.date.hidden, true, 'no empty target-date placeholder');
  assert.equal(h.record.garments, undefined, 'the row has no line-item list');
  assert.match(h.record.age.getAttribute('aria-label'), /^Order age/);
});

test('image-only hydration updates unchanged rows and obsolete image events cannot overwrite new pixels', () => {
  const h = harness(); h.render(); const oldImage = h.record.previewMedia.children[0];
  h.recognition.preview = { url: 'https://example.test/art.png', state: 'loading', kind: 'artwork', identity: 'art-2' }; h.render();
  assert.equal(h.record.previewMedia.children[0].src, 'https://example.test/art.png');
  assert.equal(h.record.previewCaption.textContent, 'Order artwork');
  oldImage.listeners.load(); oldImage.listeners.error();
  assert.equal(h.record.previewMedia.dataset.state, 'loading'); assert.equal(h.calls.failed.length, 0);
  h.record.previewMedia.children[0].listeners.load(); assert.equal(h.record.previewMedia.dataset.state, 'ready');
});

test('failed images mark their exact asset and fall back to an unassigned garment reference', () => {
  const h = harness(); h.render(); h.record.previewMedia.children[0].listeners.error();
  assert.equal(h.calls.failed[0].raw, h.order); assert.equal(h.calls.failed[0].identity, 'front-1');
  assert.equal(h.calls.scheduled, 1); h.render();
  assert.equal(h.record.previewCaption.textContent, 'Garment summary');
  assert.match(h.record.previewMedia.innerHTML, /Garment reference/);
});

test('partial item snapshots do not present unknown quantities as zero while cached material facts remain visible', () => {
  const h = harness(); h.row.partial = true; h.row.quantities = { garments: 0, prints: 0 }; h.render();
  assert.doesNotMatch(h.record.detail.textContent, /0 garments|0 print items/);
  assert.match(h.record.detail.textContent, /Blanks: Ordered/);
  h.row.partial = false; h.row.quantities = { garments: 3, prints: 2 }; h.render();
  assert.match(h.record.detail.textContent, /Blanks: Ordered/); assert.equal(h.record.attention.children.length, 0);
});

test('Supplies and Print retain the existing text layout and can return to recognition rows', () => {
  const h = harness(); h.render();
  for (const area of ['supplies', 'print']) {
    h.context.area = area; h.render();
    assert.equal(h.record.preview.hidden, true); assert.equal(h.record.delivery.hidden, true);
    assert.equal(h.record.meta.parentNode, h.record.open); assert.equal(h.record.attention.parentNode, h.record.open);
    assert.equal(h.record.progress.hidden, area !== 'print');
  }
  h.context.area = 'orders'; h.render();
  assert.equal(h.record.preview.hidden, false); assert.equal(h.record.stage.parentNode, h.record.rail);
  assert.equal(h.record.delivery.parentNode, h.record.number);
});

test('only the derived blanks-cart duplicate is removed; independent materials and operational warnings survive', () => {
  const h = harness(); h.row.stage = 'blanks_cart'; h.row.stageLabel = 'In S&S Cart';
  h.row.materials.blanks = { value: 'cart', label: 'In S&S cart' }; h.render();
  assert.equal(h.record.detail.textContent, '');
  assert.equal(h.record.detail.hidden, true);
  assert.equal(h.record.printValue.textContent, 'Not recorded');
  assert.equal(h.record.prints.parentNode, h.record.rail);
  h.row.materials.blanks = { value: 'hand', label: 'In hand' }; h.render();
  assert.match(h.record.detail.textContent, /Blanks: In hand/);
  h.context.board.indicators = () => [{ label: 'Prints pending · do not press', tone: 'danger' }, { label: 'Some data unavailable', tone: 'warning' }];
  h.render(); // Invalidation normally accompanies an updated shared row.
  h.record.signature = ''; h.render();
  assert.deepEqual(h.record.attention.children.map(node => node.textContent), ['Prints pending · do not press', 'Some data unavailable']);
});

test('targets remain optional internal dates and never displace order age', () => {
  const h = harness(); h.row.target = { label: 'Due tomorrow · Nov 12', accessible: 'Internal finish-by date: November 12', tone: 'soon' }; h.render();
  assert.equal(h.record.date.textContent, 'Target tomorrow · Nov 12');
  assert.equal(h.record.date.parentNode, h.record.status);
  assert.equal(h.record.date.hidden, false);
  assert.match(h.record.age.getAttribute('aria-label'), /^Order age/);
});

test('order age uses creation time and handles missing, invalid and future timestamps honestly', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  for (const [value, label] of [['2026-11-06T12:00:00Z', '4d'], ['2026-11-10T06:00:00Z', '6h'], ['2026-11-10T11:30:00Z', '30m'], ['2026-11-10T11:59:59Z', 'Just now']]) {
    assert.equal(model.orderAge(value, now).label, label);
  }
  for (const value of [undefined, null, '', 'not a date', '2026-11-11T12:00:00Z']) {
    assert.equal(model.orderAge(value, now).label, 'Unavailable');
  }
});

test('visible preview priority follows the inner scroller, deduplicates hydration feedback and clears when Orders hides', () => {
  const frames = [], events = []; let intersect, options;
  const context = vm.createContext({ requestAnimationFrame: fn => { frames.push(fn); return frames.length; },
    IntersectionObserver: class { constructor(callback, config) { intersect = callback; options = config; } },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    document: { dispatchEvent: event => events.push(event) }, scroll: {}, root: { hidden: false },
    currentRows: [{ key: 'one' }, { key: 'two' }], area: 'orders', enabled: () => true, view: () => ({ stage: 'all' }) });
  vm.runInContext(source.slice(source.indexOf('    const visibleRows ='), source.indexOf("    const nav = el('nav'")), context);
  assert.equal(options.root, context.scroll); assert.equal(options.rootMargin, '160px 0px');
  intersect([{ target: { dataset: { orderKey: 'two' } }, isIntersecting: true }]); frames.shift()();
  assert.deepEqual([...events[0].detail.keys], ['two']);
  context.publishVisibleRows(); frames.shift()(); assert.equal(events.length, 1);
  context.root.hidden = true; context.publishVisibleRows(); frames.shift()();
  assert.deepEqual([...events[1].detail.keys], []);
});
