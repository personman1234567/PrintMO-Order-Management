const test = require('node:test');
const assert = require('node:assert/strict');
const variant = (id, color, fit, size = 'M') => ({ id, selectedOptions: [{ name: 'Color', value: color }, { name: 'Fit', value: fit }, { name: 'Size', value: size }] });

test('color-only changes and extra colors keep fit and deduplicate size variants', async () => {
  const { colorVariants } = await import('../order-manager-web/prepared-color-model.mjs');
  const variants = [variant('1', 'Navy', 'Regular'), variant('2', 'Navy', 'Regular', 'L'), variant('3', 'Black', 'Regular'), variant('4', 'Black', 'Tall')];
  assert.deepEqual(colorVariants({ variants }, variants[0], true).map(v => v.id), ['1', '3']);
  assert.deepEqual(colorVariants({ variants }, variants[0], false).map(v => v.id), ['1', '3', '4']);
});

test('artwork reuse preserves source physical calibration without sharing mutable project data', async () => {
  const { copiedArtwork, previewSignature } = await import('../order-manager-web/prepared-color-model.mjs');
  const source = { productId: 'source', color: 'Navy', project: { prints: [{ id: 'art', side: 'front', asset: { assetId: 'a', mime: 'image/png' }, design: { xIn: 2, yIn: 3, wIn: 4, hIn: 2, rotation: 12 } }], canvasCalibration: { bySide: { front: { safeWidthIn: 12, safeHeightIn: 16, referenceWidthIn: 24 } } }, printSummary: [{ side: 'front' }], printClassOverrides: { front: { variantId: 7 } } } };
  const copy = copiedArtwork(source, { productId: 'target' });
  assert.deepEqual(copy.canvasCalibration, source.project.canvasCalibration); assert.deepEqual(copy.printClassOverrides, {});
  copy.prints[0].design.xIn = 5; assert.equal(source.project.prints[0].design.xIn, 2);
  const changed = { ...source, project: copy }; assert.notEqual(previewSignature(source), previewSignature(changed));
  const same = copiedArtwork(source, source); assert.deepEqual(same.printClassOverrides, source.project.printClassOverrides);
  assert.equal(previewSignature({ ...source, swatch: { color: '#000000' } }), previewSignature(source));
});
