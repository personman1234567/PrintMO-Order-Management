import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createStorefrontSetupService, normalizeStorefrontSetup } from './storefront-setup.mjs';

const G = (kind, id) => `gid://shopify/${kind}/${id}`;
const page = (nodes, hasNextPage = false, endCursor = null) => ({ nodes, pageInfo: { hasNextPage, endCursor } });
const product = (id, extra = {}) => ({ id: G('Product', id), title: `Product ${id}`, status: 'ACTIVE', handle: `product-${id}`, ...extra });
function fixture(graphql = async () => { throw new Error('Unexpected Shopify call'); }) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('./migrations/0001_redis_free.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('./migrations/0016_storefront_setup.sql', import.meta.url), 'utf8'));
  for (const id of [1, 2]) sqlite.prepare("INSERT INTO shops(id,shop_domain,installed_at,created_at,updated_at) VALUES(?,?,'now','now','now')").run(id, `shop${id}.myshopify.com`);
  const wrap = (sql, args = []) => ({ bind: (...next) => wrap(sql, next),
    run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...args).changes } }),
    first: async () => sqlite.prepare(sql).get(...args), all: async () => ({ results: sqlite.prepare(sql).all(...args) }) });
  const db = { prepare: sql => wrap(sql), async batch(statements) {
    sqlite.exec('BEGIN'); try { const result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
  const service = shopId => createStorefrontSetupService({ db, shopId, graphql, now: () => new Date('2026-11-12T12:00:00Z') });
  return { db, sqlite, service: service(1), other: service(2) };
}
const save = (draft = {}, expectedRevision = 0, id = crypto.randomUUID(), idempotencyKey = crypto.randomUUID()) => ({ id, expectedRevision, idempotencyKey, draft });

test('setup drafts persist across service instances, stay shop-scoped and never call Shopify', async () => {
  const f = fixture(), input = save({ title: ' Dallas setup ', owner: { name: 'Dallas', approver: 'Ethan', email: 'owner@example.com' },
    collectionId: G('Collection', 481089487096), product: { sourceProductId: G('Product', 8249250021624), selectedVariantIds: [G('ProductVariant', 123)], retailPrices: { [G('ProductVariant', 123)]: 2500 } } });
  assert.deepEqual(await f.service.listDrafts(), { drafts: [], hasMore: false });
  const saved = await f.service.saveDraft(input, 'oidc:operator');
  assert.equal(saved.revision, 1); assert.equal(saved.draft.title, 'Dallas setup');
  assert.equal(saved.draft.product.retailPrices[G('ProductVariant', 123)], 2500);
  const reopened = createStorefrontSetupService({ db: f.db, shopId: 1, graphql: () => assert.fail('Save must be local') });
  assert.deepEqual(await reopened.getDraft(input.id), saved);
  assert.equal((await reopened.listDrafts()).drafts[0].title, 'Dallas setup');
  assert.deepEqual(await f.other.listDrafts(), { drafts: [], hasMore: false });
  await assert.rejects(f.other.getDraft(input.id), { code: 'SETUP_NOT_FOUND', status: 404 });
  const secondShop = await f.other.saveDraft({ ...input, draft: { title: 'Other shop' } }, 'oidc:operator');
  assert.equal(secondShop.revision, 1); assert.equal((await f.service.getDraft(input.id)).draft.title, 'Dallas setup');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM order_projection').get().n, 0);
});

test('CAS rejects stale saves and idempotency replays the original result after later edits', async () => {
  const f = fixture(), input = save({ title: 'Original' });
  const first = await f.service.saveDraft(input, 'a');
  assert.deepEqual(await f.service.saveDraft(input, 'a'), first);
  const changed = save({ title: 'Changed' }, 1, input.id);
  const second = await f.service.saveDraft(changed, 'b');
  assert.equal(second.revision, 2);
  assert.deepEqual(await f.service.saveDraft(input, 'a'), first);
  await assert.rejects(f.service.saveDraft(save({ title: 'Stale' }, 1, input.id), 'c'), error => error.code === 'VERSION_CONFLICT' && error.status === 409 && error.details.current.revision === 2);
  await assert.rejects(f.service.saveDraft({ ...input, draft: { title: 'Key reuse' } }, 'a'), { code: 'IDEMPOTENCY_KEY_REUSE' });
  await assert.rejects(f.service.saveDraft({ ...input, id: crypto.randomUUID() }, 'a'), { code: 'IDEMPOTENCY_KEY_REUSE' });
  assert.equal((await f.service.getDraft(input.id)).draft.title, 'Changed');
});

test('storage CAS also protects against a competing write between initial read and batch', async () => {
  const f = fixture(), input = save({ title: 'First' });
  await f.service.saveDraft(input, 'a');
  const originalBatch = f.db.batch; let competed = false;
  f.db.batch = async statements => {
    if (!competed) {
      competed = true;
      f.sqlite.prepare("UPDATE storefront_setup_drafts SET revision=2,draft_json=?,last_mutation_id='other' WHERE shop_id=1 AND id=?").run(JSON.stringify(normalizeStorefrontSetup({ title: 'Other device' })), input.id);
    }
    return originalBatch(statements);
  };
  await assert.rejects(f.service.saveDraft(save({ title: 'Lost update' }, 1, input.id), 'b'), error => error.code === 'VERSION_CONFLICT' && error.details.current.revision === 2);
  assert.equal((await f.service.getDraft(input.id)).draft.title, 'Other device');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM storefront_setup_mutations').get().n, 1);
});

test('validation enforces source identities, UTF, bytes, colors, prices and Shopify CDN URLs', async () => {
  const bad = [
    { version: 2 }, { title: '\ud800' }, { title: 'bad\u0000' }, { title: 42 }, { collectionId: G('Product', 1) },
    { partnerId: 'unverified' }, { appearance: { primary: 'red' } },
    { appearance: { logoUrl: 'https://cdn.shopify.com.evil.example/logo.png' } },
    { appearance: { logoUrl: 'https://user@cdn.shopify.com/logo.png' } },
    { product: { selectedVariantIds: [G('Product', 1)] } },
    { product: { retailPrices: { [G('ProductVariant', 1)]: 1.25 } } },
    { product: { retailPrices: { [G('ProductVariant', 1)]: -1 } } },
    { owner: { email: 'missing-at.example.com' } },
    { product: { photos: [{ id: 'photo', url: 'data:image/png;base64,a' }] } },
    { product: { photos: [{ id: 'same', url: 'https://cdn.shopify.com/1.png' }, { id: 'same', url: 'https://cdn.shopify.com/2.png' }] } }
  ];
  for (const input of bad) assert.throws(() => normalizeStorefrontSetup(input), { code: 'SETUP_INVALID' });
  assert.throws(() => normalizeStorefrontSetup({ ignored: '😀'.repeat(30000) }), { code: 'SETUP_TOO_LARGE', status: 413 });
  const cleaned = normalizeStorefrontSetup({ bankAccount: 'discard', owner: { vendorId: 'discard' }, appearance: { logoUrl: 'https://cdn.shopify.com/s/files/logo.png?v=1' }, product: { notes: 'Unicode works: 印刷 😀' } });
  assert.equal(cleaned.bankAccount, undefined); assert.equal(cleaned.owner.vendorId, undefined);
  assert.equal(cleaned.product.notes, 'Unicode works: 印刷 😀');
  const f = fixture();
  await assert.rejects(f.service.saveDraft({ ...save(), id: '../other' }, 'a'), { code: 'SETUP_INVALID' });
  await assert.rejects(f.service.saveDraft(save(), ''), { code: 'SETUP_INVALID' });
});

test('draft listing is bounded at 100 and does not return full documents', async () => {
  const f = fixture();
  for (let index = 0; index < 101; index++) await f.service.saveDraft(save({ title: `Setup ${index}` }), 'a');
  const result = await f.service.listDrafts();
  assert.equal(result.drafts.length, 100); assert.equal(result.hasMore, true);
  assert.equal(result.drafts[0].draft, undefined);
});

test('real collection reads use raw reference values and Dallas fallback requires both identities', async () => {
  const calls = [], f = fixture(async (query, variables, operation) => {
    calls.push({ query, variables, operation });
    assert.equal(/metaobject\s*\(|\breference\s*\{/.test(query), false);
    assert.equal(/\bmutation\b/.test(query), false);
    return { data: { collections: page([
      { id: G('Collection', 481089487096), title: 'Dallas', partnerReference: { value: G('Metaobject', 241830428920) } },
      { id: G('Collection', 2), title: 'Other', partnerReference: { value: G('Metaobject', 241830428920) } }
    ], true, 'page-two') } };
  });
  const first = await f.service.collections();
  assert.equal(first.collections[0].configuredOwner.id, 'dr-dallas');
  assert.equal(first.collections[0].configuredOwner.source, 'configured-fallback');
  assert.equal(first.collections[1].configuredOwner, null); assert.equal(first.endCursor, 'page-two');
  assert.equal(calls[0].operation, 'StorefrontSetupCollections'); assert.equal(calls[0].variables.after, null);
});

test('collection merchandise returns explicit relationship values and a bounded next cursor', async () => {
  const collectionId = G('Collection', 1), f = fixture(async (query, variables, operation) => {
    assert.equal(operation, 'StorefrontSetupCollectionProducts'); assert.equal(variables.after, 'first');
    return { data: { collection: { id: collectionId, title: 'Store', partnerReference: { value: G('Metaobject', 2) }, products: page([
      product(3, { partnerReference: { value: G('Metaobject', 2) }, partnerCollection: { value: collectionId } })
    ], true, 'second') } } };
  });
  const result = await f.service.collectionProducts({ collectionId, after: 'first' });
  assert.equal(result.products[0].partnerId, G('Metaobject', 2)); assert.equal(result.products[0].collectionId, collectionId);
  assert.equal(result.hasNextPage, true); assert.equal(result.endCursor, 'second');
});

test('catalog search protects normal catalog sources independently of Shopify text filtering', async () => {
  let filter;
  const f = fixture(async (query, variables) => {
    filter = variables.query;
    return { data: { products: page([product(1), product(2, { partnerReference: { value: G('Metaobject', 9) } }), product(3, { partnerCollection: { value: G('Collection', 9) } }), product(4, { status: 'DRAFT' })]) } };
  });
  const result = await f.service.catalogSearch({ query: 'tee" OR status:draft' });
  assert.deepEqual(result.products.map(p => p.id), [G('Product', 1)]);
  assert.equal(filter, '(status:active OR status:unlisted) AND title:tee\\"* AND title:OR* AND title:status\\:draft*');
});

test('catalog title prefixes use Shopify wildcard syntax and every user term remains a literal field value', async () => {
  const filters = [], f = fixture(async (query, variables) => {
    filters.push(variables.query); return { data: { products: page([]) } };
  });
  await f.service.catalogSearch({ query: 'Softstyle' });
  await f.service.catalogSearch({ query: 'Softstyle 64000' });
  await f.service.catalogSearch({ query: '-tee (OR) status:draft \\ "quote" *' });
  assert.equal(filters[0], '(status:active OR status:unlisted) AND title:Softstyle*');
  assert.equal(filters[1], '(status:active OR status:unlisted) AND title:Softstyle* AND title:64000*');
  assert.equal(filters[2], '(status:active OR status:unlisted) AND title:\\-tee* AND title:\\(OR\\)* AND title:status\\:draft* AND title:\\\\* AND title:\\"quote\\"* AND title:\\**');
});

test('catalog detail paginates variant reads and rejects partner merchandise as source', async () => {
  let partner = false;
  const f = fixture(async (query, variables, operation) => {
    assert.equal(operation, 'StorefrontSetupCatalogProduct'); assert.equal(variables.after, 'variants-one');
    return { data: { shop: { currencyCode: 'USD' }, product: product(1, { ...(partner ? { partnerReference: { value: G('Metaobject', 2) } } : {}), options: [{ name: 'Size', values: ['S'] }], variants: page([{ id: G('ProductVariant', 3), title: 'S', sku: 'blank-S', price: '8.56', selectedOptions: [{ name: 'Size', value: 'S' }] }], true, 'variants-two') }) } };
  });
  const result = await f.service.catalogProduct({ productId: G('Product', 1), after: 'variants-one' });
  assert.equal(result.product.currency, 'USD'); assert.equal(result.product.variants[0].price, '8.56'); assert.equal(result.endCursor, 'variants-two');
  partner = true;
  await assert.rejects(f.service.catalogProduct({ productId: G('Product', 1), after: 'variants-one' }), { code: 'SETUP_CATALOG_PRODUCT_REQUIRED' });
});

test('source denial, partial errors and malformed pagination never masquerade as complete data', async () => {
  for (const response of [
    { data: { collections: page([]) }, errors: [{ message: 'partial' }] },
    { data: { collections: page([], true, null) } },
    { data: { collections: page([{ id: 'one' }, { id: 'one' }]) } },
    { data: { collections: { nodes: [] } } },
    { data: { collections: page([]) }, extensions: { search: [{ warnings: [{ message: 'invalid filter' }] }] } }
  ]) await assert.rejects(fixture(async () => response).service.collections(), { code: 'SETUP_SOURCE_INCOMPLETE' });
  await assert.rejects(fixture(async () => ({ errors: [{ extensions: { code: 'ACCESS_DENIED' } }] })).service.collections(), { code: 'SETUP_SOURCE_ACCESS_DENIED', status: 403 });
  await assert.rejects(fixture(async () => { throw new Error('secret upstream body'); }).service.collections(), error => error.code === 'SETUP_SOURCE_UNAVAILABLE' && !error.message.includes('secret'));
  await assert.rejects(fixture(async () => ({ data: { collections: page([], true, 'repeat') } })).service.collections({ after: 'repeat' }), { code: 'SETUP_SOURCE_INCOMPLETE' });
});
