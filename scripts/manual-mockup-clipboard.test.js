const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the shipped handlers with browser/transport boundaries replaced.
const source = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
const handlers = source.slice(source.indexOf('let manualMockupUploadPending'), source.indexOf('\nfunction canUploadManualDesign'));

function fixture(clipboard) {
  const nodes = new Map(), uploads = [], alerts = [];
  const document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, {
        hidden: true, value: '', textContent: '', dataset: {}, listeners: {}, disabled: false,
        addEventListener(type, handler) { this.listeners[type] = handler; },
        focus() { document.activeElement = this; }
      });
      return nodes.get(id);
    }
  };
  const order = { name: '#1800 – Example', _candidate: true };
  const context = vm.createContext({
    document, navigator: { clipboard }, detailOrder: order, File, Blob, DOMException,
    alert: message => alerts.push(message),
    window: { api: { uploadManualMockup: async (number, file) => uploads.push({ number, file }) } },
    orderNumberFromOrder: item => item.name.split(' – ')[0].replace('#', ''),
    refreshManualMockupsForOrder: async () => {}, renderOrderAssets() {},
    renderBoardFromLocalState: async () => {}
  });
  vm.runInContext(handlers, context);
  context.setupManualMockupControls();
  return { context, document, order, uploads, alerts, node: id => document.getElementById(id) };
}
const image = () => new File(['image-bytes'], 'image.png', { type: 'image/png' });
const settle = () => new Promise(resolve => setImmediate(resolve));

test('unsupported clipboard read exposes native paste without an error dialog', async () => {
  const f = fixture(undefined);
  await f.context.pasteManualMockupFromClipboard();
  assert.equal(f.node('manual-mockup-paste-area').hidden, false);
  assert.equal(f.document.activeElement, f.node('manual-mockup-paste-target'));
  assert.equal(f.alerts.length, 0);
});

test('denied embedded clipboard read recovers through native paste', async () => {
  const f = fixture({ read: async () => { throw new DOMException('Denied', 'NotAllowedError'); } });
  await f.context.pasteManualMockupFromClipboard();
  const event = { clipboardData: { files: [image()] }, preventDefault() { this.prevented = true; } };
  f.node('manual-mockup-paste-target').listeners.paste(event);
  await settle();
  assert.equal(event.prevented, true);
  assert.equal(f.uploads[0].number, '1800');
  assert.equal(f.uploads[0].file.type, 'image/png');
  assert.equal(f.node('manual-mockup-status').dataset.state, 'success');
  assert.equal(f.node('manual-mockup-paste-area').hidden, true);
  assert.equal(f.alerts.length, 0);
});

test('direct read selects a supported representation rather than the first image MIME', async () => {
  const f = fixture({ read: async () => [{ types: ['image/tiff', 'image/png'], getType: async type => new Blob(['bytes'], { type }) }] });
  await f.context.pasteManualMockupFromClipboard();
  assert.equal(f.uploads.length, 1);
  assert.equal(f.uploads[0].file.type, 'image/png');
});

test('switching order while clipboard access is pending never attaches to the new order', async () => {
  let resolve;
  const f = fixture({ read: () => new Promise(done => { resolve = done; }) });
  const pending = f.context.pasteManualMockupFromClipboard();
  f.context.detailOrder = { name: '#1801 – Another customer' };
  resolve([{ types: ['image/png'], getType: async () => image() }]);
  await pending;
  assert.equal(f.uploads.length, 0);
});

test('native item-list paste works and pasted text/HTML never becomes content', async () => {
  const f = fixture();
  const handler = f.node('manual-mockup-paste-target').listeners.paste;
  handler({ clipboardData: { files: [], items: [{ kind: 'file', getAsFile: image }] }, preventDefault() {} });
  await settle();
  assert.equal(f.uploads.length, 1);
  handler({ clipboardData: { files: [], items: [{ kind: 'string', type: 'text/html' }] }, preventDefault() {} });
  await settle();
  assert.equal(f.uploads.length, 1);
  assert.equal(f.node('manual-mockup-paste-target').value, '');
  assert.match(f.node('manual-mockup-status').textContent, /No image was pasted/);
});

test('upload failure leaves recovery feedback and restores the controls', async () => {
  const f = fixture({ read: async () => [{ types: ['image/png'], getType: async () => image() }] });
  f.context.window.api.uploadManualMockup = async () => { throw new Error('Network unavailable'); };
  await f.context.pasteManualMockupFromClipboard();
  assert.equal(f.node('manual-mockup-status').dataset.state, 'error');
  assert.match(f.node('manual-mockup-status').textContent, /Network unavailable/);
  assert.equal(f.node('manual-mockup-paste-btn').disabled, false);
  assert.equal(f.node('manual-mockup-file-input').disabled, false);
});

test('history and provider upload restrictions apply to both paste paths', async () => {
  for (const restriction of [{ _historyReadOnly: true }, { _capabilities: { artworkUpload: false } }]) {
    const f = fixture({ read: async () => { throw new Error('Must not read clipboard'); } });
    Object.assign(f.order, restriction);
    await f.context.pasteManualMockupFromClipboard();
    f.node('manual-mockup-paste-target').listeners.paste({ clipboardData: { files: [image()] }, preventDefault() {} });
    await settle();
    assert.equal(f.uploads.length, 0);
    assert.equal(f.node('manual-mockup-paste-area').hidden, true);
  }
});
