import test from 'node:test';
import assert from 'node:assert/strict';
import { searchPreparedCatalog } from './prepared-catalog.mjs';
import { colorFamilies, garmentType, catalogBrand } from '../order-manager-web/prepared-catalog-model.mjs';
import { finderQuery } from '../order-manager-web/prepared-garment-finder.mjs';
const product = (id, title, status = 'ACTIVE', colors = ['Navy']) => ({ id, title, handle: id, vendor: 'My Store', status, productType: '', options: [{ name: 'Color', optionValues: colors.map(name => ({ name, hasVariants: true, swatch: null })) }] });
const env = { SHOPIFY_SHOP_DOMAIN: 'test.myshopify.com' };
test('complete cached catalog supports stacked filters, exact styles, pagination and recent IDs', async () => {
  const calls = [];
  const all = [product('one', 'Gildan - Hooded Sweatshirt - 18500', 'UNLISTED', ['Navy', 'Forest']), product('two', 'Gildan - T-Shirt - 5000', 'ACTIVE', ['White']), product('three', 'Tultex - Hoodie - 18500X', 'UNLISTED', ['Navy'])];
  const graphql = async (_, query, variables, name) => { calls.push(name); if (name === 'PreparedFinderSku') return { data: { products: { nodes: [], pageInfo: {} } } }; return { data: { products: { nodes: variables.after ? all.slice(1) : all.slice(0, 1), pageInfo: { hasNextPage: !variables.after, endCursor: 'next' } } } }; };
  const result = await searchPreparedCatalog(env, graphql, { q: 'hoodie', status: 'UNLISTED', type: 'Hoodies', brand: 'Gildan', family: 'Blue|Green' });
  assert.deepEqual(result.products.map(p => p.id), ['one']); assert.equal(result.products[0].image, '');
  assert.equal(result.products[0].colors.length, 2); assert.equal(calls.filter(c => c === 'PreparedFinderProducts').length, 2);
  const ranked = await searchPreparedCatalog(env, graphql, { q: '18500' }); assert.equal(ranked.products[0].id, 'one');
  assert.equal(calls.filter(c => c === 'PreparedFinderProducts').length, 2);
  const recent = await searchPreparedCatalog(env, graphql, { recent: 'two' }); assert.deepEqual(recent.products.map(p => p.id), ['two']);
  const empty = await searchPreparedCatalog(env, graphql, { type: 'Polos', family: 'Blue' }); assert.equal(empty.total, 0);
});
test('native base colors win; denied optional metadata does not break unlisted selection', async () => {
  const make = native => async (_, query, variables, name) => {
    if (name === 'PreparedFinderColors') return native ? { data: { nodes: [{ id: 'meta', field: { references: { nodes: [{ name: 'White' }] } } }] } } : { ok: false, errors: [{ extensions: { code: 'ACCESS_DENIED' } }] };
    const p = product('one', 'Brand - Tee - 1', 'UNLISTED', ['Natural']); p.options[0].optionValues[0].linkedMetafieldValue = 'meta';
    return { data: { products: { nodes: [p], pageInfo: {} } } };
  };
  const native = await searchPreparedCatalog(env, make(true), { family: 'White' }); assert.equal(native.total, 1);
  const fallback = await searchPreparedCatalog(env, make(false), { family: 'Beige' }); assert.equal(fallback.total, 1);
  assert.equal(colorFamilies('Unusual color', null)[0], 'Unmapped');
  assert.deepEqual(colorFamilies('Black / white', '#000000', ['Black', 'White']), ['Black', 'White']);
});
test('unused color values do not create false color matches; exact SKU matches use Shopify', async () => {
  const graphql = async (_, query, variables, name) => {
    if (name === 'PreparedFinderSku') { assert.match(variables.query, /sku:ABC123\*/); return { data: { products: { nodes: [{ id: 'one' }], pageInfo: {} } } }; }
    const p = product('one', 'Brand - Tall Polo - TALL', 'UNLISTED', ['Black']); p.options[0].optionValues.push({ name: 'Navy', hasVariants: false });
    return { data: { products: { nodes: [p], pageInfo: {} } } };
  };
  assert.equal((await searchPreparedCatalog(env, graphql, { family: 'Blue' })).total, 0);
  assert.equal((await searchPreparedCatalog(env, graphql, { q: 'ABC123' })).products[0].id, 'one');
  assert.equal(garmentType(product('a', 'Brand - Heavy Blend Crewneck Sweatshirt - 18000')), 'Crewnecks');
  assert.equal(catalogBrand(product('a', 'Comfort Colors - Tee - 1717')), 'Comfort Colors');
});
test('query encoding preserves stack semantics through the authenticated path allowlist', () => {
  const path = finderQuery('American Apparel', { family: new Set(['Blue', 'Green']), brand: new Set(['American Apparel']) }, '30');
  assert.ok(!path.includes('+')); assert.ok(!path.includes('|'));
  assert.match(path, /American%20Apparel/); assert.match(path, /family=Blue%7CGreen/); assert.match(path, /after=30/);
});
test('failed catalog loads can retry and are never cached as an empty catalog', async () => {
  let calls = 0;
  const graphql = async () => ++calls === 1 ? { ok: false } : { data: { products: { nodes: [], pageInfo: {} } } };
  await assert.rejects(searchPreparedCatalog(env, graphql, {}), /could not load/);
  assert.equal((await searchPreparedCatalog(env, graphql, {})).total, 0);
});
test('private snapshots avoid cold Shopify reads and refresh stale metadata in the background', async () => {
  const p = product('one', 'Brand - Tee - 1');
  p.options[0].optionValues[0].linkedMetafieldValue = 'meta';
  let snapshot = { version: 1, loadedAt: '2020-01-01', nativeFamilies: [['meta', ['Blue']]], products: [{ id: 'old', title: 'Saved catalog item', brand: 'Brand', garmentType: 'T-shirts', status: 'ACTIVE', colors: [] }] };
  const local = { SHOPIFY_SHOP_DOMAIN: 'snapshot.myshopify.com', R2_BUCKET: { get: async () => ({ json: async () => snapshot }), put: async (_key, value) => { snapshot = JSON.parse(value); } } };
  const jobs = [];
  const graphql = async (_, query, variables, name) => name === 'PreparedFinderColors' ? { errors: [{ extensions: { code: 'ACCESS_DENIED' } }] } : { data: { products: { nodes: [p], pageInfo: {} } } };
  const old = await searchPreparedCatalog(local, graphql, {}, { waitUntil: job => jobs.push(job) });
  assert.equal(old.products[0].id, 'old'); await Promise.all(jobs);
  assert.equal((await searchPreparedCatalog(local, graphql, { family: 'Blue' })).products[0].id, 'one');
  assert.deepEqual(snapshot.nativeFamilies, [['meta', ['Blue']]]);
});
test('typing another search does not wait for a background catalog rebuild', async () => {
  const snapshot = { version: 1, loadedAt: '2020-01-01', products: [{ id: 'one', title: 'Cached tee', brand: 'Brand', garmentType: 'T-shirts', status: 'ACTIVE', colors: [] }] };
  const local = { SHOPIFY_SHOP_DOMAIN: 'typing.myshopify.com', R2_BUCKET: { get: async () => ({ json: async () => snapshot }), put: async () => {} } };
  let release; const gate = new Promise(resolve => { release = resolve; }), jobs = [];
  const graphql = async () => { await gate; return { data: { products: { nodes: [], pageInfo: {} } } }; };
  await searchPreparedCatalog(local, graphql, {}, { waitUntil: job => jobs.push(job) });
  const next = await Promise.race([searchPreparedCatalog(local, graphql, { q: 'cached' }), new Promise(resolve => setTimeout(() => resolve(null), 50))]);
  release(); await Promise.all(jobs);
  assert.equal(next?.total, 1);
});
