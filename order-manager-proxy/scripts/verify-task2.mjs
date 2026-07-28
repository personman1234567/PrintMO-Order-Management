import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {
  DISPLAY_STAGE_OPTIONS,
  STAGE_OPTIONS,
  applyDisplayStageTransition,
  blanksSubstage,
  buildProductionPatch,
  currentProductionSatisfiesDraft,
  displayStage,
  idempotencyKey,
  mergeProductionConflict,
  normalizeProduction,
  printedCountError,
  productionPath,
  responseError,
  setBlanksSubstage,
  stageRank,
  updateReadinessDependency,
} from '../extensions/printmo-production-status/src/production-client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const proxyRoot = resolve(here, '..');
const repoRoot = resolve(proxyRoot, '..');

assert.deepEqual(
  STAGE_OPTIONS.map(({value}) => value),
  ['received', 'to_order', 'blanks_cart', 'blanks_ordered', 'print', 'completed'],
  'The client must understand every canonical Shopify production stage',
);
assert.deepEqual(
  DISPLAY_STAGE_OPTIONS.map(({value}) => value),
  ['received', 'to_order', 'blanks', 'print', 'completed'],
  'Admin controls must collapse the two canonical Blanks values into one displayed stage',
);

const baseline = normalizeProduction({
  stage: 'received',
  version: 7,
  garmentCount: 4,
  printedCount: 1,
  blanksStatus: 0,
  blanksOrdered: 0,
});
assert.deepEqual(
  buildProductionPatch(baseline, {...baseline, stage: 'to_order', printedCount: 2, blanksStatus: 1}),
  {stage: 'to_order', printed_count: 2, blanks_status: 1, blanks_ordered: 0},
  'Client patch must use the v1 snake_case contract and send stage with blanksOrdered atomically',
);

const blanksInCart = setBlanksSubstage(baseline, 'cart');
const orderedBlanks = setBlanksSubstage(blanksInCart, 'ordered');
assert.equal(displayStage(blanksInCart.stage), 'blanks');
assert.equal(blanksSubstage(blanksInCart), 'cart');
assert.equal(orderedBlanks.stage, 'blanks_ordered');
assert.equal(orderedBlanks.blanksOrdered, 1);
assert.equal(blanksSubstage(orderedBlanks), 'ordered');

const readyToPrint = applyDisplayStageTransition({
  ...orderedBlanks,
  blanksStatus: 0,
  printsOrdered: 0,
  printsStatus: 0,
}, 'print');
assert.equal(readyToPrint.stage, 'print');
assert.equal(readyToPrint.blanksStatus, 1, 'Blanks → Ready to print must mark only Blanks ready');
assert.equal(readyToPrint.printsOrdered, 0);
assert.equal(readyToPrint.printsStatus, 0);

const complete = applyDisplayStageTransition({...readyToPrint, printedCount: 1, garmentCount: 4}, 'completed');
assert.equal(complete.printedCount, 4, 'Production complete must set the garment count');
assert.equal(complete.printsOrdered, 0, 'Production complete must preserve print readiness flags');
assert.equal(stageRank('blanks_ordered') > stageRank('to_order'), true);

const dependency = updateReadinessDependency(
  {...baseline, printsOrdered: 1, printsStatus: 1},
  'printsOrdered',
  'printsStatus',
  false,
);
assert.equal(dependency.clearedReady, true);
assert.equal(dependency.next.printsStatus, 0, 'Clearing Ordered must clear its dependent Ready milestone');
assert.equal(printedCountError('5', 4), 'Pieces printed cannot exceed 4.');
assert.equal(printedCountError('4', 4), '');

const conflictOriginal = normalizeProduction({...baseline, internalNotes: 'Original'});
const conflictDraft = {...conflictOriginal, internalNotes: 'Operator edit'};
const conflictCurrent = normalizeProduction({...conflictOriginal, version: 8, stage: 'to_order'});
const mergedConflict = mergeProductionConflict(conflictOriginal, conflictDraft, conflictCurrent);
assert.equal(mergedConflict.internalNotes, 'Operator edit', 'Conflict merge must keep operator-edited fields');
assert.equal(mergedConflict.stage, 'to_order', 'Conflict merge must adopt untouched server fields');
assert.equal(currentProductionSatisfiesDraft(
  conflictOriginal,
  conflictDraft,
  {...conflictCurrent, internalNotes: 'Operator edit'},
), true);

assert.equal(
  productionPath('gid://shopify/Order/123'),
  '/order-manager/v1/orders/gid%3A%2F%2Fshopify%2FOrder%2F123/production',
);
assert.equal(responseError(409, {error: {code: 'VERSION_CONFLICT', message: 'Changed'}}).code, 'VERSION_CONFLICT');
assert.equal(
  responseError(409, {
    error: {code: 'VERSION_CONFLICT', details: {current: {stage: 'print'}}},
  }).currentProduction.stage,
  'print',
);
const fallbackIdempotencyKey = idempotencyKey('gid://shopify/Order/123', {});
assert.match(
  fallbackIdempotencyKey,
  /^[A-Za-z0-9._:-]{8,200}$/,
  'Admin extension fallback idempotency keys must satisfy the Worker contract',
);
assert(!fallbackIdempotencyKey.includes('/'), 'Admin extension fallback keys must not embed Shopify GID separators');

const [extensionConfig, blockSource, webShim, previewSource, rendererSource] = await Promise.all([
  readFile(resolve(proxyRoot, 'extensions/printmo-production-status/shopify.extension.toml'), 'utf8'),
  readFile(resolve(proxyRoot, 'extensions/printmo-production-status/src/BlockExtension.jsx'), 'utf8'),
  readFile(resolve(repoRoot, 'order-manager-web/web-shim.js'), 'utf8'),
  readFile(resolve(repoRoot, 'order-manager-web/shopify-preview.js'), 'utf8'),
  readFile(resolve(repoRoot, 'renderer.js'), 'utf8'),
]);

assert.match(extensionConfig, /api_version = "2026-07"/);
assert.match(extensionConfig, /target = "admin\.order-details\.block\.render"/);
assert.match(blockSource, /shopify\.data\?\.selected\?\.\[0\]\?\.id/);
assert.match(blockSource, /expectedVersion: originalSnapshot\.version/);
assert.match(blockSource, /collapsedSummary=/);
assert.match(blockSource, /<s-form onSubmit=\{handleSubmit\} onReset=\{discard\}>/);
assert.match(blockSource, /label="PrintMO internal notes"/);
assert.match(blockSource, /Mark handoff complete/);
assert.match(blockSource, /Reopen production order/);
assert.doesNotMatch(blockSource, /label="Bundle"/);
assert.doesNotMatch(blockSource, /Version \{/);
assert.doesNotMatch(blockSource, /mirroredLegacy/);
assert.match(webShim, /getProductionMetadata/);
assert.match(webShim, /updateProductionMetadata/);
assert.match(webShim, /isShopifyCandidateView/);
assert.match(webShim, /stage === "print" \|\| stage === "completed"/);
assert.match(webShim, /\/order-manager\/v1\/batches\/commit/);
assert.match(rendererSource, /order\.productionStage === 'completed'/);
assert.match(rendererSource, /Production complete/);
assert.match(previewSource, /PrintMO production/);
assert.match(previewSource, /Production controls use canonical Shopify metadata/);

console.log('Shopify production controls and candidate-board verification passed.');
