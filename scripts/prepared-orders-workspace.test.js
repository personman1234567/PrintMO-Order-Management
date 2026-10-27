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
