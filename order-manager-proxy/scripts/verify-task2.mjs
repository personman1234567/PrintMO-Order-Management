import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {
  STAGE_OPTIONS,
  buildProductionPatch,
  idempotencyKey,
  normalizeProduction,
  productionPath,
  responseError,
} from '../extensions/printmo-production-status/src/production-client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const proxyRoot = resolve(here, '..');
const repoRoot = resolve(proxyRoot, '..');

assert.deepEqual(
  STAGE_OPTIONS.map(({value}) => value),
  ['received', 'to_order', 'blanks_cart', 'blanks_ordered', 'print', 'completed'],
  'Admin controls must expose every canonical Shopify production stage',
);

const baseline = normalizeProduction({
  stage: 'received',
  version: 7,
  printedCount: 1,
  blanksStatus: 0,
});
assert.deepEqual(
  buildProductionPatch(baseline, {...baseline, stage: 'to_order', printedCount: 2, blanksStatus: 1}),
  {stage: 'to_order', printed_count: 2, blanks_status: 1},
  'Client patch must use the v1 snake_case mutation contract and omit unchanged fields',
);
assert.equal(
  productionPath('gid://shopify/Order/123'),
  '/order-manager/v1/orders/gid%3A%2F%2Fshopify%2FOrder%2F123/production',
);
assert.equal(responseError(409, {error: {code: 'VERSION_CONFLICT', message: 'Changed'}}).code, 'VERSION_CONFLICT');
const fallbackIdempotencyKey = idempotencyKey('gid://shopify/Order/123', {});
assert.match(
  fallbackIdempotencyKey,
  /^[A-Za-z0-9._:-]{8,200}$/,
  'Admin extension fallback idempotency keys must satisfy the Worker contract',
);
assert(!fallbackIdempotencyKey.includes('/'), 'Admin extension fallback keys must not embed Shopify GID separators');

const [extensionConfig, blockSource, webShim, previewSource] = await Promise.all([
  readFile(resolve(proxyRoot, 'extensions/printmo-production-status/shopify.extension.toml'), 'utf8'),
  readFile(resolve(proxyRoot, 'extensions/printmo-production-status/src/BlockExtension.jsx'), 'utf8'),
  readFile(resolve(repoRoot, 'order-manager-web/web-shim.js'), 'utf8'),
  readFile(resolve(repoRoot, 'order-manager-web/shopify-preview.js'), 'utf8'),
]);

assert.match(extensionConfig, /api_version = "2026-07"/);
assert.match(extensionConfig, /target = "admin\.order-details\.block\.render"/);
assert.match(blockSource, /shopify\.data\?\.selected\?\.\[0\]\?\.id/);
assert.match(blockSource, /expectedVersion: production\.version/);
assert.match(blockSource, /collapsedSummary=/);
assert.match(blockSource, /label="Blanks ready"/);
assert.doesNotMatch(blockSource, /mirroredLegacy/);
assert.match(webShim, /getProductionMetadata/);
assert.match(webShim, /updateProductionMetadata/);
assert.match(webShim, /isShopifyCandidateView/);
assert.match(webShim, /\/order-manager\/v1\/batches\/commit/);
assert.match(previewSource, /PrintMO production/);
assert.match(previewSource, /Production controls use canonical Shopify metadata/);

console.log('Shopify production controls and candidate-board verification passed.');
