import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createDraftOrderService, draftUploadMetadata } from './draft-orders.mjs';

const workerSource = readFileSync(new URL('./worker.js', import.meta.url), 'utf8')
  .replace(/from '(\.\/[^']+)'/g, (_, source) => `from ${JSON.stringify(new URL(source, import.meta.url).href)}`);
const worker = await import(`data:text/javascript;base64,${Buffer.from(workerSource).toString('base64')}`);
const gid = 'gid://shopify/Order/84';
const timestamp = '2026-10-31T12:00:00Z';
const connection = (...types) => ({ nodes: types.map(type => ({ status: 'OPEN', deliveryMethod: { methodType: type } })), pageInfo: { hasNextPage: false } });

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('./migrations/', import.meta.url)).filter(file => file.endsWith('.sql')).sort())
    sqlite.exec(readFileSync(new URL(`./migrations/${file}`, import.meta.url), 'utf8'));
  for (const id of [1, 2]) sqlite.prepare("INSERT INTO shops (id,shop_domain,installed_at,created_at,updated_at) VALUES (?,?,'now','now','now')").run(id, `shop${id}.myshopify.com`);
  const wrap = (sql, values = []) => ({ bind: (...next) => wrap(sql, next),
    async run() { return { meta: { changes: sqlite.prepare(sql).run(...values).changes } }; },
    async first() { return sqlite.prepare(sql).get(...values); },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; } });
  const db = { prepare: sql => wrap(sql), async batch(statements) {
    sqlite.exec('BEGIN'); try { const result = []; for (const s of statements) result.push(await s.run()); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
  const objects = new Map();
  const bucket = {
    async put(key, bytes, options = {}) { objects.set(key, { bytes: new Uint8Array(bytes), ...options }); },
    async get(key) { const value = objects.get(key); return value ? {
      customMetadata: value.customMetadata || {}, body: value.bytes,
      writeHttpMetadata: headers => headers.set('Content-Type', value.httpMetadata?.contentType || 'image/png'),
      arrayBuffer: async () => value.bytes.buffer.slice(value.bytes.byteOffset, value.bytes.byteOffset + value.bytes.byteLength)
    } : null; },
    async head(key) { return objects.get(key) || null; }
  };
  return { sqlite, db, bucket, objects, env: { ORDER_DB: db, PREVIEWS: bucket, R2_BUCKET: bucket } };
}

test('delivery uses exact typed methods, never pickup heuristics or fulfillment readiness', () => {
  for (const [type, kind] of Object.entries({ PICK_UP: 'pickup', SHIPPING: 'shipping', LOCAL: 'local-delivery', PICKUP_POINT: 'pickup-point', RETAIL: 'in-store', NONE: 'none' })) {
    assert.deepEqual(worker.summarizeDeliveryMethods(connection(type), [], timestamp), {
      kind, types: [type], complete: true, source: 'shopify-fulfillment-orders', fetchedAt: timestamp
    });
  }
  assert.equal(worker.summarizeDeliveryMethods(connection('PICK_UP', 'SHIPPING')).kind, 'mixed');
  assert.equal(worker.summarizeDeliveryMethods(connection('SHIPPING', 'SHIPPING')).kind, 'shipping');
  const changed = connection('SHIPPING', 'PICK_UP'); changed.nodes[1].status = 'CANCELLED';
  assert.equal(worker.summarizeDeliveryMethods(changed).kind, 'shipping');
});

test('non-physical services do not turn physical delivery into mixed delivery', () => {
  for (const [type, kind] of [['PICK_UP', 'pickup'], ['SHIPPING', 'shipping'], ['LOCAL', 'local-delivery']]) {
    const result = worker.summarizeDeliveryMethods(connection(type, 'NONE'), [], timestamp);
    assert.equal(result.kind, kind);
    assert.equal(result.complete, true);
    assert.deepEqual(result.types, ['NONE', type].sort());
  }
  assert.equal(worker.summarizeDeliveryMethods(connection('NONE')).kind, 'none');
  assert.equal(worker.summarizeDeliveryMethods(connection('PICK_UP', 'SHIPPING', 'NONE')).kind, 'mixed');
  assert.equal(worker.summarizeDeliveryMethods(connection('PICK_UP', 'NONE', null)).kind, 'unknown');
  const truncated = connection('PICK_UP', 'NONE'); truncated.pageInfo.hasNextPage = true;
  assert.equal(worker.summarizeDeliveryMethods(truncated).kind, 'unknown');
});

test('Etsy delivery is always shipping regardless of receipt shipment flags', () => {
  for (const flags of [{}, { is_shipped: false }, { is_shipped: true }, { is_canceled: true }]) {
    const order = worker.normalizeEtsyOrderContract({ providerAccountId: '123',
      receipt: { receipt_id: '456', ...flags }, fetchedAt: timestamp });
    assert.deepEqual(order.commerce.deliveryMethod, { kind: 'shipping', types: ['SHIPPING'],
      complete: true, source: 'etsy-shipping-policy', fetchedAt: timestamp });
  }
});

test('unknown, missing, null, truncated and denied delivery remain unknown', () => {
  const truncated = connection('PICK_UP'); truncated.pageInfo.hasNextPage = true;
  const noPageInfo = connection('SHIPPING'); delete noPageInfo.pageInfo;
  for (const value of [undefined, connection(), connection('NEW_METHOD'), connection(null), truncated, noPageInfo]) {
    const result = worker.summarizeDeliveryMethods(value); assert.equal(result.kind, 'unknown'); assert.equal(result.complete, false);
  }
  const denied = [{ path: ['nodes', 0, 'fulfillmentOrders'], extensions: { code: 'ACCESS_DENIED' } }];
  assert.equal(worker.summarizeDeliveryMethods(connection('SHIPPING'), denied).kind, 'unknown');
  assert.equal(worker.summarizeDeliveryMethods(connection('SHIPPING'), [{ message: 'Unknown error scope' }]).kind, 'unknown');
  assert.equal(worker.summarizeDeliveryMethods(connection('SHIPPING'), [{ path: ['nodes', 0, 'shippingAddress'] }]).kind, 'shipping');
});

test('summary carries delivery without fetching detail, and incomplete item facts stay independent', async () => {
  let requests = 0;
  const summary = await worker.normalizeShopifySummary({}, { id: gid, name: '#1084', createdAt: timestamp,
    currencyCode: 'USD', fulfillmentOrders: connection('PICK_UP', 'NONE'),
    lineItems: { nodes: [], pageInfo: { hasNextPage: false } } }, [], async () => { ++requests; throw Error('Unexpected detail read'); });
  assert.equal(requests, 0); assert.equal(summary.commerce.deliveryMethod.kind, 'pickup');
  assert.equal(summary.commerce.lineItemsComplete, true); assert.equal(summary.sync.partial, false);
});

function designerSummary() {
  return { id: gid, displayName: '#1084', commerce: { lineItems: [{ id: 'gid://shopify/LineItem/1', sku: 'BLACK-M', quantity: 1,
    customAttributes: [
      { key: '_designRef', value: 'fixture_design_1' }, { key: 'group_role', value: 'garment' },
      { key: 'design_preview_url', value: 'https://preview.test/previews/2026-10-31/fixture_design_1/workspace_tee_black_mockup.png' },
      { key: '_designer_front_preview_url', value: 'https://preview.test/previews/2026-10-31/fixture_design_1/workspace_tee_black_mobile-preview_front.png' }
    ] }] } };
}

test('front candidates require an explicit garment line, matching design ref and safe HTTPS preview path', () => {
  const summary = designerSummary();
  assert.equal(worker.designerAssetCandidates(summary).length, 2);
  const derivative = worker.designerAssetCandidates(summary).find(asset => asset.previewKind);
  assert.equal(derivative.side, 'front'); assert.equal(derivative.lineItemId, summary.commerce.lineItems[0].id);
  for (const url of ['javascript:alert(1)', 'https://preview.test/previews/2026-10-31/different_ref/front.png', 'https://preview.test/orders/1084/front.png']) {
    summary.commerce.lineItems[0].customAttributes.at(-1).value = url;
    assert.equal(worker.designerAssetCandidates(summary).filter(asset => asset.previewKind).length, 0);
  }
  const print = designerSummary(); print.commerce.lineItems[0].customAttributes[1].value = 'print';
  assert.equal(worker.designerAssetCandidates(print).filter(asset => asset.previewKind).length, 0);
});

test('front imported first cannot replace the composite, even with identical bytes; DTOs and tickets stay private', async () => {
  const f = fixture(), candidates = worker.designerAssetCandidates(designerSummary());
  for (const candidate of candidates) await f.bucket.put(candidate.previewKey, new Uint8Array([1, 2, 3]), {
    httpMetadata: { contentType: 'image/png' }, customMetadata: {
      role: candidate.previewKind ? 'mobile-preview' : 'mockup', side: candidate.previewKind ? 'front' : '', designref: candidate.designRef
    }
  });
  const derivative = candidates.find(asset => asset.previewKind), composite = candidates.find(asset => !asset.previewKind);
  await worker.copyDesignerAsset(f.env, 1, gid, derivative);
  await worker.copyDesignerAsset(f.env, 1, gid, composite);
  await worker.copyDesignerAsset(f.env, 1, gid, derivative);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM asset_manifests').get().n, 2);
  const canonical = await worker.d1AssetsForOrder(f.env, 1, gid);
  assert.equal(canonical.length, 1); assert.equal(canonical[0].name, composite.name);
  assert.equal((await worker.d1AssetsForOrders(f.env, 1, [gid])).get(gid)[0].name, composite.name);
  const mobile = (await worker.d1MobilePreviewsForOrders(f.env, 1, [gid])).get(gid);
  assert.equal(mobile.role, 'mobile-preview'); assert.equal(mobile.side, 'front'); assert.equal(mobile.name, derivative.name);
  assert.equal(worker.mobilePreviewForSummary(mobile, designerSummary()), mobile);
  const edited = designerSummary(); edited.commerce.lineItems[0].customAttributes.pop();
  assert.equal(worker.mobilePreviewForSummary(mobile, edited), null);
  const removed = designerSummary(); removed.commerce.lineItems[0].currentQuantity = 0;
  assert.equal(worker.mobilePreviewForSummary(mobile, removed), null);
  assert.equal(JSON.stringify(mobile).includes('source_key'), false); assert.equal(JSON.stringify(mobile).includes('object_key'), false);
  assert.equal((await worker.d1MobilePreviewsForOrders(f.env, 2, [gid])).size, 0);
  f.sqlite.prepare("UPDATE asset_manifest_links SET assignment_status = 'needs_review' WHERE preview_kind = 'mobile-front'").run();
  assert.equal((await worker.d1MobilePreviewsForOrders(f.env, 1, [gid])).size, 0);
});

test('missing/invalid optional front preview does not fail the canonical import', async () => {
  const f = fixture(), summary = designerSummary(), candidates = worker.designerAssetCandidates(summary);
  await f.bucket.put(candidates[0].previewKey, new Uint8Array([4, 5]), { httpMetadata: { contentType: 'image/png' } });
  const report = await worker.syncDesignerStudioAssetsForSummary(f.env, 1, summary);
  assert.deepEqual(report.errors, []); assert.equal(report.imported, 1);
  await f.bucket.put(candidates[1].previewKey, new Uint8Array([4, 5]), { httpMetadata: { contentType: 'image/png' }, customMetadata: { role: 'design', side: 'front', designref: 'fixture_design_1' } });
  await assert.rejects(worker.copyDesignerAsset(f.env, 1, gid, candidates[1]), /metadata/);
});

function preparedFixture() {
  const f = fixture(), id = 'gid://shopify/DraftOrder/42';
  const line = { id: 'draft-line', title: 'Tee', variantTitle: 'Black / M', sku: 'BLACK-M', quantity: 1,
    customAttributes: [{ key: 'group_role', value: 'garment' }] };
  const node = { id, name: '#D42', status: 'OPEN', createdAt: timestamp, updatedAt: timestamp,
    lineItems: { nodes: [line], pageInfo: { hasNextPage: false } }, order: null };
  const service = createDraftOrderService({ ...f.env, DRAFT_ORDERS_ENABLED: '1' }, { shop: async () => ({ id: 1 }),
    graphql: async (_env, _query, _variables, operation) => ({ data: operation === 'PrintMODraft'
      ? { draftOrder: node } : operation === 'PrintMODraftOrderLines'
        ? { order: { id: gid, lineItems: { nodes: [{ ...line, id: 'order-line' }], pageInfo: { hasNextPage: false } } } }
        : { draftOrders: { nodes: [node], pageInfo: { hasNextPage: false } } } }) });
  const upload = async (role, uploadId, file = new File(['fixture-png'], 'preview.png', { type: 'image/png' })) => {
    const form = new FormData(); form.set('role', role); form.set('placement', 'front'); form.set('uploadId', uploadId);
    form.set('lineItemIds', JSON.stringify([line.id])); form.set('file', file);
    return service.handle(new Request(`https://worker.test/order-manager/v1/drafts/${encodeURIComponent(id)}/assets`, { method: 'POST', body: form }), 'fixture:operator');
  };
  return { f, id, line, node, service, upload };
}

test('prepared front upload is separate from original artwork through draft conversion', async () => {
  const { f, id, node, service, upload } = preparedFixture();
  await upload('mobile-preview', 'mobile_upload_fixture_1');
  const draft = await upload('mockup', 'canonical_upload_fixture_1');
  assert.equal(draft.artwork.length, 1); assert.equal(draft.artwork[0].role, 'mockup'); assert.equal(draft.mobilePreview.role, 'mobile-preview');
  assert.equal((await service.list()).drafts[0].mockupCount, 1);
  node.order = { id: gid, name: '#1084' }; node.status = 'COMPLETED';
  const purchased = await service.detail(id);
  assert.equal(purchased.artwork.length, 1); assert.equal((await worker.d1AssetsForOrder(f.env, 1, gid)).length, 1);
  assert.equal((await worker.d1MobilePreviewsForOrders(f.env, 1, [gid])).get(gid).lineItemId, 'order-line');
  const rows = f.sqlite.prepare('SELECT role, preview_kind FROM draft_artwork ORDER BY preview_kind').all();
  assert.deepEqual(rows.map(row => [row.role, row.preview_kind]), [['mockup', ''], ['mockup', 'mobile-front']]);
  assert.throws(() => draftUploadMetadata(new File(['x'], 'preview.png', { type: 'image/png' }), 'mobile-preview', 'back'), /front/);
  assert.throws(() => draftUploadMetadata(new File(['x'], 'preview.svg', { type: 'image/svg+xml' }), 'mobile-preview', 'front'), /Mockups/);
});

test('actual Prepared WebP bytes upload, persist and promote as a private mobile preview without entering the canonical gallery', async () => {
  const { f, node, service, upload } = preparedFixture();
  // A valid 2x2 navy WebP fixture; exercises real multipart MIME/extension validation.
  const bytes = Buffer.from('UklGRjYAAABXRUJQVlA4ICoAAABwAQCdASoCAAIAAgA0JaACdAFAAAD++sQ//0JP/+Js//pNnwiowmkjsAA=', 'base64');
  const file = new File([bytes], 'front-preview.webp', { type: 'image/webp' });
  const uploaded = await upload('mobile-preview', 'webp_mobile_upload_1', file);
  assert.equal(uploaded.mobilePreview.contentType, 'image/webp');
  assert.equal(uploaded.mobilePreview.name, 'front-preview.webp');
  assert.equal(uploaded.mobilePreview.byteSize, bytes.length); assert.deepEqual(uploaded.artwork, []);
  const stored = f.sqlite.prepare("SELECT object_key,content_type FROM draft_artwork WHERE preview_kind = 'mobile-front'").get();
  assert.equal(stored.content_type, 'image/webp'); assert.deepEqual(Buffer.from(f.objects.get(stored.object_key).bytes), bytes);
  await upload('mockup', 'webp_canonical_upload_1');
  node.order = { id: gid, name: '#1084' }; node.status = 'COMPLETED';
  const converted = await service.detail(node.id);
  assert.equal(converted.artwork.length, 1); assert.equal(converted.mobilePreview.contentType, 'image/webp');
  const mobile = (await worker.d1MobilePreviewsForOrders(f.env, 1, [gid])).get(gid);
  assert.equal(mobile.contentType, 'image/webp'); assert.equal(mobile.side, 'front');
  assert.equal((await worker.d1AssetsForOrder(f.env, 1, gid)).length, 1);
  assert.equal((await worker.d1AssetsForOrders(f.env, 1, [gid])).get(gid)[0].name, 'preview.png');
});

test('hidden optional previews have a separate bounded quota and cannot consume the 100 original-file slots', async () => {
  const { f, id, line, upload, service } = preparedFixture();
  const insert = f.sqlite.prepare(`INSERT INTO draft_artwork
    (id,shop_id,draft_gid,object_key,filename,content_type,byte_size,sha256,role,placement,items_json,item_kind,state,created_by,created_at,updated_at,preview_kind)
    VALUES (?,1,?,?,'seed.png','image/png',1,'seed-hash','mockup','front',?,'draft','active','fixture',?,?,?)`);
  for (const [kind, count] of [['', 99], ['mobile-front', 19]]) for (let i = 0; i < count; i++) {
    const assetId = `seed-${kind || 'canonical'}-${i}`;
    insert.run(assetId, id, `private/${assetId}`, JSON.stringify([line]), timestamp, timestamp, kind);
  }
  await upload('mobile-preview', 'quota_mobile_upload_20');
  const completed = await upload('mockup', 'quota_required_upload_100');
  assert.equal(completed.artwork.length, 100); assert.equal((await service.list()).drafts[0].artworkCount, 100);
  await assert.rejects(upload('mobile-preview', 'quota_mobile_upload_21'), error => error.code === 'TOO_MANY_PREVIEWS');
  await assert.rejects(upload('mockup', 'quota_required_upload_101'), error => error.code === 'TOO_MANY_FILES');
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM draft_artwork WHERE preview_kind = 'mobile-front'").get().count, 20);
});
