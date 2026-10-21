const test = require('node:test');
const assert = require('node:assert/strict');
const { model, colorFamily, diagram, palette, locationOf, markersFor } = require('../order-manager-web/order-garment-summary');
const line = (title, variantTitle = '', extra = {}) => ({ title, variantTitle, qty: 1, ...extra });

test('supplier aliases resolve to a bounded color palette', () => {
  for (const value of ['Maroon', 'Cardinal Red', 'Sport Red', 'Heather Red']) assert.equal(colorFamily(value), 'red');
  assert.equal(colorFamily('Deep Blue'), 'navy');
  assert.equal(colorFamily('Royal Blue'), 'blue');
  assert.equal(colorFamily('Sport Grey'), 'gray');
  assert.equal(colorFamily('Black'), 'black');
  for (const value of ['Mystery', 'Camo', 'Black / White', '']) assert.equal(colorFamily(value), 'unknown');
});
test('sizes collapse without merging different garment colors or changing labels', () => {
  const result = model({ items: [line('Gildan T-shirt', 'Navy / S'), line('Gildan T-shirt', 'Navy / L', { qty: 4 }), line('Gildan T-shirt', 'Red / L')] });
  assert.equal(result.qty, 5);
  assert.equal(result.color.family, 'navy');
  assert.equal(result.extra, 1);
  assert.match(result.label, /Navy/);
});
test('one garment group can summarize known front and back print rows', () => {
  const result = model({ items: [line('Cotton T-shirt', 'Black / M'), line('T-shirt Breast Print'), line('T-shirt Full Back Print')] });
  assert.deepEqual(result.locations, ['breast', 'full-back']);
  assert.equal(result.fill, palette.black);
  assert.match(diagram(result), /data-placement="breast"/);
  assert.match(diagram(result, true), /data-placement="full-back"/);
});
test('unassigned prints never decorate every garment in a mixed order', () => {
  const result = model({ items: [line('T-shirt', 'Red / L'), line('Hoodie', 'Blue / L'), line('T-shirt Breast Print')] });
  assert.deepEqual(result.locations, []);
  assert.deepEqual(model({ items: [line('T-shirt', 'Red'), line('Unknown product'), line('T-shirt Breast Print')] }).locations, []);
});
test('explicit group links resolve prints to the matching garment only', () => {
  const result = model({ items: [line('Hoodie', 'Navy / L', { qty: 5, properties: { group_id: 'a' } }), line('T-shirt', 'White / L', { properties: { group_id: 'b' } }), line('T-shirt Full Back Print', '', { properties: { group_id: 'b' } }), line('T-shirt Breast Print', '', { properties: { group_id: 'a' } })] });
  assert.deepEqual(result.locations, ['breast']);
});
test('unknown products do not become invented shirts and unknown colors remain neutral', () => {
  assert.equal(model({ items: [line('DTF Print'), line('Mystery product')] }), null);
  assert.equal(model({ items: [line('Hoodie', 'Mystery / XL')] }).color.family, 'unknown');
  assert.equal(model({ items: [line('T-shirt', 'Red / L', { qty: 0 })] }), null);
});
test('product text is never interpolated into SVG markup', () => {
  const result = model({ items: [line('<img onerror=bad> T-shirt', 'Black / L')] });
  assert(!diagram(result).includes('onerror'));
});

test('compatibility attachment of order-wide assets does not invent a garment assignment', () => {
  const item = line('Hoodie', 'Navy', { id: 'garment-a', assets: [{ role: 'design', side: 'back' }] });
  assert.deepEqual(model({ items: [item] }).locations, []);
  item.assets[0].lineItemId = 'garment-a';
  assert.deepEqual(model({ items: [item] }).locations, ['back']);
});

test('chest, full front, back tag, half back and full back retain distinct placements', () => {
  const titles = ['T-shirt Breast Print', 'T-shirt Chest Print', 'T-shirt Full Print', 'T-shirt Back Tag Print', 'T-shirt Half Back Print', 'T-shirt Full Back Print'];
  assert.deepEqual(titles.map(locationOf), ['breast', 'chest', 'full-front', 'back-tag', 'half-back', 'full-back']);
  const result = model({ items: [line('T-shirt', 'Navy'), ...titles.map(t => line(t))] });
  const front = markersFor(result.type, 'front', result.locations), back = markersFor(result.type, 'back', result.locations);
  assert.deepEqual(front.map(m => m.location), ['breast', 'chest', 'full-front']);
  assert.deepEqual(back.map(m => m.location), ['back-tag', 'half-back', 'full-back']);
  assert(front[2].height > front[1].height);
  assert(back[2].height > back[1].height);
  assert(back[0].width < back[1].width);
});

test('sleeve markers respect wearer side and leave unspecified sides unassigned', () => {
  const unknown = model({ items: [line('T-shirt'), line('T-shirt Sleeve Print')] });
  assert.deepEqual(markersFor('tee', 'front', unknown.locations), []);
  assert.match(unknown.placementText, /side unspecified/);
  const known = model({ items: [line('Long Sleeve T-shirt'), line('T-shirt Sleeve Print', '', { properties: { placement: 'left-sleeve' } })] });
  assert.deepEqual(known.locations, ['left-sleeve']);
  assert(markersFor(known.type, 'front', known.locations)[0].x > 50);
  assert(markersFor(known.type, 'front', ['right-sleeve'])[0].x < 50);
});

test('each supplied category uses its actual vector views, including pocket shirts and hat side', () => {
  const cases = [['T-shirt', 'tee'], ['Pocket T-shirt', 'pocket-tee'], ['Long Sleeve T-shirt', 'longsleeve'], ['Crewneck Sweatshirt', 'sweatshirt'], ['Hoodie', 'hoodie'], ['Polo', 'polo'], ['Hat', 'hat']];
  for (const [title, type] of cases) {
    const result = model({ items: [line(title, 'Black')] });
    assert.equal(result.type, type);
    assert.match(diagram(result), new RegExp(`#${type}-front`));
    assert.match(diagram(result, true), new RegExp(`#${type}-${type === 'hat' ? 'side' : 'back'}`));
  }
  assert.equal(model({ items: [line('Crewneck T-shirt')] }).type, 'tee');
});

test('every family has contrasting seam color and safe fixed fills', () => {
  const luminance = hex => {
    const c = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
  };
  for (const family of Object.keys(palette)) {
    const result = model({ items: [line('T-shirt', '', { properties: { color: family } })] });
    const a = luminance(result.fill), b = luminance(result.stroke);
    assert((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 3, family);
  }
});

test('owned SVG sprite includes fourteen themed views and no executable or remote content', () => {
  const fs = require('fs'), path = require('path');
  const sprite = fs.readFileSync(path.join(__dirname, '../order-manager-web/Assets/garments/garment-icons.svg'), 'utf8');
  assert.equal([...sprite.matchAll(/<symbol\b/g)].length, 14);
  assert.equal(new Set([...sprite.matchAll(/<symbol id="([^"]+)/g)].map(m => m[1])).size, 14);
  assert.match(sprite, /var\(--garment-fill/);
  assert.match(sprite, /var\(--garment-ink/);
  assert.match(sprite, /var\(--garment-shadow/);
  assert(!/<script\b|<image\b|<foreignObject\b|\bon\w+=|\bhref=|url\(/i.test(sprite));
});

test('manual invoice assignments select the exact garment/color and override automatic placement', () => {
  const { models } = require('../order-manager-web/order-garment-summary.js');
  const order = { items: [line('T-shirt', 'Red', { id: 'red' }), line('Hoodie', 'Navy', { id: 'navy' }),
    line('T-shirt Full Print', '', { id: 'print' })], printPlacements: {
      a: { printItemId: 'print', garmentLineIds: ['navy'], placement: 'back-tag' },
      b: { printItemId: null, garmentLineIds: ['red'], placement: 'breast' }
    } };
  const results = models(order);
  assert.deepEqual(results.find(g => g.color.family === 'red').locations, ['breast']);
  assert.deepEqual(results.find(g => g.color.family === 'navy').locations, ['back-tag']);
  order.items = order.items.filter(item => item.id !== 'print');
  assert.deepEqual(models(order).find(g => g.color.family === 'navy').locations, []);
});
test('dark families have deliberately paired darker seams instead of white inversion', () => {
  const { colorPairs } = require('../order-manager-web/order-garment-summary.js');
  for (const family of ['black', 'navy', 'brown', 'purple']) {
    assert.notEqual(colorPairs[family][1], '#e3e9ef');
    const brightness = hex => hex.slice(1).match(/../g).reduce((n,c) => n + parseInt(c,16), 0);
    assert(brightness(colorPairs[family][1]) < brightness(colorPairs[family][0]));
  }
});
