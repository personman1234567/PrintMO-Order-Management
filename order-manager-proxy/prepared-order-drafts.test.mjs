import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createPreparedDraftService, normalizePreparedDraft, handlePreparedDraftRequest } from './prepared-order-drafts.mjs';
import { deletePreparedPreparation } from './prepared-order-links.mjs';
import { preparedListLinkState } from './prepared-order-browse.mjs';
const draftId = 'd20f720b-ae22-4b31-886e-b72bbf8aed36';
const itemId = 'ad7410a7-0592-4abc-8eae-5c866bf65333';
const mutation = () => crypto.randomUUID();
const item = () => ({ id: itemId, productId: 'gid://shopify/Product/1', variantId: 'gid://shopify/ProductVariant/2', title: 'Unlisted blank', image: '', project: null });
const draft = () => ({ title: 'Team order', preparedFor: '', items: [item()], mockups: [] });
export function fixture() {
  const objects = new Map(); let revision = 0;
  const bucket = {
    async get(key) { const entry = objects.get(key); return entry ? { ...entry, body: entry.bytes.slice(), async json() { return JSON.parse(new TextDecoder().decode(entry.bytes)); } } : null; },
    async head(key) { return objects.get(key) || null; },
    async put(key, data, options = {}) {
      const previous = objects.get(key), condition = options.onlyIf;
      if (condition?.etagMatches && previous?.etag !== condition.etagMatches) return null;
      if (condition?.etagDoesNotMatch === '*' && previous) return null;
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
      const entry = { etag: `revision-${++revision}`, bytes, ...options }; objects.set(key, entry); return entry;
    },
    async list({ prefix, limit = 25, cursor }) { const values = [...objects.entries()].filter(([key]) => key.startsWith(prefix)); return { objects: values.slice(Number(cursor) || 0, (Number(cursor) || 0) + limit).map(([key, entry]) => ({ key, ...entry })), truncated: values.length > (Number(cursor) || 0) + limit, cursor: String((Number(cursor) || 0) + limit) }; }
  };
  const env = { R2_BUCKET: bucket, SHOPIFY_SHOP_DOMAIN: 'test.myshopify.com' };
  const service = createPreparedDraftService(env, { graphql: async () => { throw new Error('Unexpected Shopify call'); } });
  return { service, env, objects };
}
test('no image or Studio project is required; temporary URLs and submitted prices are not retained', () => {
  const normalized = normalizePreparedDraft({ ...draft(), price: 1, items: [{ ...item(), image: 'javascript:alert(1)', price: 1 }] });
  assert.equal(normalized.items[0].image, ''); assert.equal(normalized.items[0].project, null); assert.equal(normalized.items[0].price, undefined);
});
test('save and reopen preserve an unlisted/no-image configuration; list is private summary metadata', async () => {
  const { service } = fixture();
  const saved = await service.save(draftId, { draft: draft(), mutationId: mutation() }, 'shopify:1');
  assert.equal((await service.read(draftId)).revision, saved.revision);
  assert.equal((await service.read(draftId)).items[0].variantId, 'gid://shopify/ProductVariant/2');
  const list = await service.list(); assert.equal(list.drafts[0].itemCount, 1); assert.equal(list.drafts[0].items, undefined);
});

test('browse searches garments across pages, sorts globally and retains private lightweight summaries', async () => {
  const { service } = fixture();
  for (let i = 0; i < 31; i++) await service.save(crypto.randomUUID(), { draft: { ...draft(), title: 'Order ' + String(i).padStart(2, '0'), items: [{ ...item(), title: i === 30 ? 'Tall polo navy' : 'Plain shirt' }] }, mutationId: mutation() }, 'shopify:1');
  const first = await service.list(null, { sort: 'name' });
  assert.equal(first.drafts.length, 25); assert.equal(first.cursor, '25'); assert.equal(first.counts.current, 31);
  assert.equal(first.drafts[0].title, 'Order 00'); assert.equal(first.drafts[0].items, undefined);
  const next = await service.list(first.cursor, { sort: 'name' }); assert.equal(next.drafts.length, 6); assert.equal(next.cursor, null);
  const found = await service.list(null, { q: 'tall polo' }); assert.equal(found.drafts.length, 1); assert.equal(found.drafts[0].title, 'Order 30');
  assert.equal(found.drafts[0].thumbnail.image, ''); assert.equal(found.drafts[0].linkState, 'none');
});

test('archive and restore preserve the published revision, customer link, content and assets', async () => {
  const { service, env } = fixture(); const saved = await service.save(draftId, { draft: draft(), mutationId: mutation() }, 'shopify:1');
  const key = 'admin-prepared-orders/v1/test.myshopify.com/links/' + draftId + '.json';
  await env.R2_BUCKET.put(key, JSON.stringify({ sourceRevision: saved.revision, link: { id: itemId, status: 'active', expiresAt: '2099-01-01' } }));
  const body = { action: 'archive', mutationId: mutation(), expectedRevision: saved.revision };
  await service.manage(draftId, body, 'shopify:1'); await service.manage(draftId, body, 'shopify:1');
  assert.equal((await service.read(draftId)).revision, saved.revision);
  assert.equal((await service.list()).drafts.length, 0);
  const archived = await service.list(null, { view: 'archived' });
  assert.equal(archived.counts.archived, 1); assert.equal(archived.drafts[0].linkState, 'ready');
  assert.equal((await (await env.R2_BUCKET.get(key)).json()).link.status, 'active');
  await service.manage(draftId, { action: 'restore', mutationId: mutation(), expectedRevision: saved.revision }, 'shopify:1');
  assert.equal((await service.list()).drafts.length, 1);
});

test('rename keeps garment data, rejects stale revisions and correctly marks unpublished changes', async () => {
  const { service, env } = fixture(); const saved = await service.save(draftId, { draft: draft(), mutationId: mutation() }, 'shopify:1');
  await env.R2_BUCKET.put('admin-prepared-orders/v1/test.myshopify.com/links/' + draftId + '.json', JSON.stringify({ sourceRevision: saved.revision, link: { id: itemId, status: 'active', expiresAt: '2099-01-01' } }));
  const body = { action: 'rename', title: 'Lisa — Team apparel', mutationId: mutation(), expectedRevision: saved.revision };
  const renamed = await service.manage(draftId, body, 'shopify:1'); await service.manage(draftId, body, 'shopify:1');
  assert.equal(renamed.title, body.title); assert.deepEqual(renamed.items, saved.items);
  assert.equal((await service.list()).drafts[0].linkState, 'changes');
  await assert.rejects(service.manage(draftId, { ...body, mutationId: mutation() }, 'shopify:1'), error => error.code === 'VERSION_CONFLICT');
});

test('deleting disables the customer link, hides the preparation and prevents stale-save resurrection without deleting files', async () => {
  const { service, env, objects } = fixture();
  env.PREPARED_ORDER_ADMIN_TOKEN = 'test-only'; const requests = [];
  env.PREPARED_ORDER_SERVICE = { fetch: async (url, options) => { requests.push([url, options.method]); return Response.json({ revoked: true }); } };
  const saved = await service.save(draftId, { draft: draft(), mutationId: mutation() }, 'shopify:1');
  const key = 'admin-prepared-orders/v1/test.myshopify.com/links/' + draftId + '.json';
  await env.R2_BUCKET.put(key, JSON.stringify({ link: { id: itemId, status: 'active' } }));
  const artifact = 'admin-prepared-orders/v1/test.myshopify.com/assets/' + draftId + '/' + 'a'.repeat(64);
  await env.R2_BUCKET.put(artifact, 'production original');
  const body = { mutationId: mutation(), expectedRevision: saved.revision };
  assert.deepEqual(await deletePreparedPreparation(env, service, draftId, body, 'shopify:1'), { deleted: true });
  await deletePreparedPreparation(env, service, draftId, body, 'shopify:1');
  assert.equal(requests.length, 1); assert.match(requests[0][0], new RegExp(itemId + '/revoke$'));
  assert.equal((await service.list(null, { view: 'all' })).drafts.length, 0);
  await assert.rejects(service.read(draftId), error => error.code === 'DRAFT_NOT_FOUND');
  await assert.rejects(service.save(draftId, { draft: draft(), mutationId: mutation(), expectedRevision: saved.revision }, 'shopify:1'), error => error.code === 'DRAFT_NOT_FOUND');
  assert.ok(objects.has(artifact)); assert.ok(await service.asset(draftId, 'a'.repeat(64)));
  assert.equal((await (await env.R2_BUCKET.get(key)).json()).link.status, 'revoked');
});

test('deletion waits for publishing and retains the preparation if revocation fails', async () => {
  const { service, env } = fixture(); const saved = await service.save(draftId, { draft: draft(), mutationId: mutation() }, 'shopify:1');
  const key = 'admin-prepared-orders/v1/test.myshopify.com/links/' + draftId + '.json';
  const value = { publishingAt: new Date().toISOString(), link: { id: itemId, status: 'active' } };
  await env.R2_BUCKET.put(key, JSON.stringify(value));
  const body = { mutationId: mutation(), expectedRevision: saved.revision };
  await assert.rejects(deletePreparedPreparation(env, service, draftId, body, 'shopify:1'), error => error.code === 'PUBLISH_PENDING');
  delete value.publishingAt; await env.R2_BUCKET.put(key, JSON.stringify(value));
  env.PREPARED_ORDER_ADMIN_TOKEN = 'test-only'; env.PREPARED_ORDER_SERVICE = { fetch: async () => Response.json({}, { status: 503 }) };
  await assert.rejects(deletePreparedPreparation(env, service, draftId, body, 'shopify:1'), error => error.code === 'PREPARED_LINK_UNAVAILABLE');
  assert.equal((await service.read(draftId)).revision, saved.revision);
  assert.equal((await (await env.R2_BUCKET.get(key)).json()).link.status, 'active');
});

test('list states distinguish absence, publishing, expiry, disabled and edited links', () => {
  assert.equal(preparedListLinkState(null, 'r1'), 'none');
  assert.equal(preparedListLinkState({ publishingAt: new Date().toISOString() }, 'r1'), 'publishing');
  assert.equal(preparedListLinkState({ link: { status: 'active', expiresAt: '2020-01-01' } }, 'r1'), 'expired');
  assert.equal(preparedListLinkState({ link: { status: 'revoked', expiresAt: '2099-01-01' } }, 'r1'), 'disabled');
});
test('server normalization preserves crop and calibration without retaining temporary browser URLs', () => {
  const trim = { mode: 'transparency', basis: 'alpha', naturalWidth: 100, naturalHeight: 100, crop: { x: 30, y: 30, width: 40, height: 40 }, paddedCrop: { x: 28, y: 28, width: 44, height: 44 }, padding: 2 };
  const input = draft(); input.items[0].project = { prints: [{ id: itemId, type: 'image', side: 'front', asset: { assetId: 'a'.repeat(64), url: 'blob:temporary', mime: 'image/png', naturalW: 100, naturalH: 100 }, trim, design: { xIn: 1, yIn: 2, wIn: 3, hIn: 3, rotation: 25 } }], canvasCalibration: { version: 1, fingerprint: 'saved', bySide: {} } };
  const saved = normalizePreparedDraft(input).items[0].project;
  assert.deepEqual(saved.prints[0].trim.crop, trim.crop); assert.equal(saved.canvasCalibration.fingerprint, 'saved'); assert.equal(saved.prints[0].asset.url, undefined);
});
test('uncertain-save retry is idempotent and concurrent revisions cannot overwrite each other', async () => {
  const { service } = fixture(); const mutationId = mutation();
  const first = await service.save(draftId, { draft: draft(), mutationId }, 'shopify:1');
  const retry = await service.save(draftId, { draft: draft(), mutationId }, 'shopify:1'); assert.equal(first.revision, retry.revision);
  const next = await service.save(draftId, { draft: { ...draft(), title: 'Updated' }, mutationId: mutation(), expectedRevision: first.revision }, 'shopify:1');
  await assert.rejects(service.save(draftId, { draft: draft(), mutationId: mutation(), expectedRevision: first.revision }, 'shopify:1'), error => error.code === 'VERSION_CONFLICT');
  assert.equal((await service.read(draftId)).revision, next.revision);
});
test('artwork references belong to the same order and cannot point at another private order', async () => {
  const { service } = fixture(); const saved = await service.save(draftId, { draft: draft(), mutationId: mutation() }, 'shopify:1');
  const bytes = new Uint8Array([137,80,78,71,13,10,26,10]);
  const upload = await service.upload(draftId, new Request('https://test/upload', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: bytes }));
  const configured = draft(); configured.mockups.push({ assetId: upload.assetId, mime: 'image/png', name: 'Proof' });
  await service.save(draftId, { draft: configured, mutationId: mutation(), expectedRevision: saved.revision }, 'shopify:1');
  const other = crypto.randomUUID();
  await assert.rejects(service.save(other, { draft: configured, mutationId: mutation() }, 'shopify:1'), error => error.code === 'ASSET_MISSING');
  assert.equal((await service.read(draftId)).mockups.length, 1);
});
test('invalid uploads, oversized payloads, invalid transforms and missing artwork fail without replacing the order', async () => {
  const { service } = fixture(); await service.save(draftId, { draft: draft(), mutationId: mutation() }, 'shopify:1');
  await assert.rejects(service.upload(draftId, new Request('https://test/upload', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: '<script>bad</script>' })), error => error.code === 'INVALID_IMAGE');
  await assert.rejects(service.upload(draftId, new Request('https://test/upload', { method: 'POST', headers: { 'Content-Type': 'image/png', 'Content-Length': '30000000' }, body: 'x' })), error => error.status === 413);
  assert.throws(() => normalizePreparedDraft({ ...draft(), items: [{ ...item(), project: { prints: [{ id: itemId, type: 'image', side: 'front', asset: { assetId: 'a'.repeat(64) }, design: { xIn: 0, yIn: 0, wIn: 0, hIn: 2, rotation: 0 } }] } }] }), error => error.code === 'INVALID_PLACEMENT');
  assert.equal((await service.read(draftId)).title, 'Team order');
});
test('WebP signature parsing is independent of UTF-8 byte sequences in its binary size header', async () => {
  const { service } = fixture(); await service.save(draftId, { draft: draft(), mutationId: mutation() }, 'shopify:1');
  const bytes = new Uint8Array([82, 73, 70, 70, 194, 128, 0, 0, 87, 69, 66, 80, 0]);
  const result = await service.upload(draftId, new Request('https://test/upload', { method: 'POST', headers: { 'Content-Type': 'image/webp' }, body: bytes }));
  assert.equal(result.mime, 'image/webp');
});
test('product detail follows all variant pages and retains unlisted/no-image products', async () => {
  const { env } = fixture(); const cursors = [];
  const service = createPreparedDraftService(env, { graphql: async (_, query, variables) => {
    cursors.push(variables.variantCursor);
    return { ok: true, httpStatus: 200, errors: [], data: { product: { id: 'gid://shopify/Product/1', title: 'Unlisted', status: 'UNLISTED', handle: 'unlisted', designerConfig: null,
      variants: { nodes: [{ id: `gid://shopify/ProductVariant/${variables.variantCursor ? 3 : 2}`, title: 'White', price: '4.97', selectedOptions: [] }], pageInfo: { hasNextPage: !variables.variantCursor, endCursor: 'next' } } } } };
  } });
  const product = await service.product('gid://shopify/Product/1'); assert.equal(product.variants.length, 2); assert.equal(product.image, ''); assert.deepEqual(cursors, [null, 'next']);
});
test('catalog unwraps the production adapter envelope and carries pagination without requiring images', async () => {
  const { env } = fixture(); let variables;
  const service = createPreparedDraftService(env, { graphql: async (_, query, input) => {
    variables = input;
    return { ok: true, httpStatus: 200, errors: [], data: { products: { nodes: [
      { id: 'gid://shopify/Product/1', title: 'Visible', handle: 'visible', status: 'ACTIVE' },
      { id: 'gid://shopify/Product/2', title: 'Hidden', handle: 'hidden', status: 'UNLISTED' },
      { id: 'gid://shopify/Product/3', title: 'Archived', status: 'ARCHIVED' }
    ], pageInfo: { hasNextPage: true, endCursor: 'page-2' } } } };
  } });
  const result = await service.catalog('shirt', 'page-1');
  assert.equal(variables.after, 'page-1'); assert.equal(result.endCursor, 'page-2');
  assert.deepEqual(result.products.map(product => product.status), ['ACTIVE', 'UNLISTED']);
  assert.equal(result.products[1].image, '');
});

test('product details use native swatch colors/textures, retain configured fallbacks and support missing swatches', async () => {
  const { env } = fixture();
  const service = createPreparedDraftService(env, { graphql: async (_, query) => {
    assert.match(query, /optionValues.*swatch/s);
    return { ok: true, data: { product: { id: 'gid://shopify/Product/1', title: 'Unlisted', status: 'UNLISTED', handle: 'unlisted', designerConfig: { value: JSON.stringify({ placements: {}, colors: [{ name: 'Navy', tintHex: '#001944' }, { name: 'White', tintHex: '#ffffff' }] }) }, options: [{ name: 'Color', optionValues: [{ name: 'White', swatch: { color: '#fefeff' } }, { name: 'Heather', swatch: { image: { image: { url: 'https://cdn.shopify.com/heather.jpg' } } } }, { name: 'Unknown', swatch: null }] }], variants: { nodes: [], pageInfo: { hasNextPage: false } } } } };
  } });
  const product = await service.product('gid://shopify/Product/1');
  assert.deepEqual(product.swatches.White, { color: '#fefeff', image: '' });
  assert.equal(product.swatches.Heather.image, 'https://cdn.shopify.com/heather.jpg');
  assert.equal(product.swatches.Navy.color, '#001944'); assert.equal(product.swatches.Unknown, undefined);
});

test('per-item swatches and mockup/review flags persist without accepting executable image URLs', () => {
  const input = draft(); input.items[0].swatch = { color: '#ffffff', image: 'javascript:alert(1)' }; input.items[0].mockupNeedsUpdate = true; input.items[0].placementNeedsReview = true;
  const result = normalizePreparedDraft(input).items[0];
  assert.deepEqual(result.swatch, { color: '#ffffff', image: '' }); assert.equal(result.mockupNeedsUpdate, true); assert.equal(result.placementNeedsReview, true);
});
test('Shopify product failures are actionable and never interpreted as an empty catalog', async () => {
  const { env } = fixture();
  const denied = createPreparedDraftService(env, { graphql: async () => ({ ok: true, data: null, errors: [{ extensions: { code: 'ACCESS_DENIED' } }] }) });
  await assert.rejects(denied.catalog(''), error => error.code === 'CATALOG_ACCESS_DENIED' && error.status === 502);
  const failed = createPreparedDraftService(env, { graphql: async () => ({ ok: false, httpStatus: 500, data: null, errors: [] }) });
  await assert.rejects(failed.product('gid://shopify/Product/1'), error => error.code === 'CATALOG_UNAVAILABLE');
});
test('mockup assignments preserve legacy references and only retain garments in this order', () => {
  const normalized = normalizePreparedDraft({ ...draft(), mockups: [
    { assetId: 'a'.repeat(64), name: 'Legacy' },
    { assetId: 'b'.repeat(64), name: 'Assigned', itemIds: [itemId, itemId, draftId] }
  ] });
  assert.deepEqual(normalized.mockups[0].itemIds, []);
  assert.deepEqual(normalized.mockups[1].itemIds, [itemId]);
});
test('admin classification overrides and automatic summaries survive private project persistence', () => {
  const input = draft(); input.items[0].project = { prints: [], printClassOverrides: { front: { variantId: 46714190201080, label: 'Full Front Print' }, bogus: { variantId: 1, label: 'Invalid' } },
    printSummary: [{ side: 'front', variantId: 46714190201080, label: 'Full Front Print', mode: 'manual' }] };
  const project = normalizePreparedDraft(input).items[0].project;
  assert.deepEqual(project.printClassOverrides, { front: { variantId: 46714190201080, label: 'Full Front Print' } });
  assert.equal(project.printSummary[0].mode, 'manual');
});
test('private asset response is authenticated-route-only, attachment/no-sniff and never exposes an R2 key', async () => {
  const { env, service } = fixture(); await service.save(draftId, { draft: draft(), mutationId: mutation() }, 'shopify:1');
  const upload = await service.upload(draftId, new Request('https://test/upload', { method: 'POST', headers: { 'Content-Type': 'image/svg+xml' }, body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>' }));
  const result = await handlePreparedDraftRequest(new Request(`https://test/order-manager/v1/prepared-order-drafts/${draftId}/assets/${upload.assetId}`), env, {}, { kind: 'shopify', subject: '1' }, {});
  assert.equal(result.headers.get('Content-Type'), 'application/octet-stream'); assert.equal(result.headers.get('X-Content-Type-Options'), 'nosniff'); assert.match(result.headers.get('Content-Security-Policy'), /sandbox/);
  assert.equal(JSON.stringify(upload).includes('admin-prepared-orders'), false);
});
test('every preparation route is behind existing Shopify/partner authentication', async () => {
  const source = readFileSync(new URL('./worker.js', import.meta.url), 'utf8').replace(/from '(.\/[^']+\.mjs)'/g, (_, specifier) => `from ${JSON.stringify(new URL(specifier, import.meta.url).href)}`);
  const worker = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).default;
  for (const path of ['', '/catalog', `/${draftId}`, `/${draftId}/assets/${'a'.repeat(64)}`]) {
    const response = await worker.fetch(new Request(`https://test/order-manager/v1/prepared-order-drafts${path}`), {}, {});
    assert.equal(response.status, 401);
  }
});

test('optional quantity prefills survive normalization without requiring Designer data',()=>{
  assert.deepEqual(normalizePreparedDraft({...draft(),items:[{...item(),sizeQty:{M:2,XL:0}}]}).items[0].sizeQty,{M:2});
  assert.deepEqual(normalizePreparedDraft(draft()).items[0].sizeQty,{});
  for(const sizeQty of [{M:-1},{M:1.5},{M:'2'},{M:10000}])assert.throws(()=>normalizePreparedDraft({...draft(),items:[{...item(),sizeQty}]}),/whole garment quantities/);
});
