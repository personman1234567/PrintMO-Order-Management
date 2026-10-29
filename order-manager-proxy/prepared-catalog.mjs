import { catalogBrand, garmentType, colorFamilies, catalogMatch, COLOR_FAMILIES } from '../order-manager-web/prepared-catalog-model.mjs';
import { mapConcurrent } from './prepared-publish-progress.mjs';
export const FINDER_PRODUCTS_QUERY = `query PreparedFinderProducts($after:String){products(first:100,after:$after,query:"status:active OR status:unlisted",sortKey:TITLE){nodes{
 id title handle status vendor productType category{name} featuredMedia{preview{image{url}}}
 options{name optionValues{name hasVariants linkedMetafieldValue swatch{color image{image{url}}}}}
}pageInfo{hasNextPage endCursor}}}`;
const NATIVE_COLORS_QUERY = `query PreparedFinderColors($ids:[ID!]!){nodes(ids:$ids){...on Metaobject{id field(key:"color_taxonomy_reference"){references(first:5){nodes{...on TaxonomyValue{name}}}}}}}`;
const SKU_QUERY = `query PreparedFinderSku($query:String!,$after:String){products(first:100,query:$query,after:$after){nodes{id}pageInfo{hasNextPage endCursor}}}`;
const caches = new WeakMap();
const fail = (message, code = 'CATALOG_UNAVAILABLE') => { throw Object.assign(new Error(message), { code, status: 502 }); };
function checked(result) {
  if (result?.ok !== false && result?.data && !result.errors?.length) return result.data;
  if (result?.errors?.some(e => e.extensions?.code === 'ACCESS_DENIED')) fail('Shopify did not allow product access. Reopen Order Manager from Shopify Admin and retry.', 'CATALOG_ACCESS_DENIED');
  fail('The garment catalog could not load. Retry; your selected garments are still here.');
}
async function index(env, graphql, context, force = false) {
  let shops = caches.get(graphql); if (!shops) { shops = new Map(); caches.set(graphql, shops); }
  const shop = env.SHOPIFY_SHOP_DOMAIN.toLowerCase(), existing = shops.get(shop);
  if (existing && existing.expires > Date.now() && (!force || existing.refreshing)) return existing.promise;
  const value = { expires: Date.now() + 300000, promise: null, refreshing: force };
  value.promise = (async () => {
    const key = `admin-prepared-orders/v1/${encodeURIComponent(shop)}/catalog-index.json`;
    const snapshot = await env.R2_BUCKET?.get(key).then(stored => stored?.json()).catch(() => null);
    if (!force && snapshot?.version === 1 && Array.isArray(snapshot.products) && snapshot.loadedAt) {
      if (Date.now() - Date.parse(snapshot.loadedAt) > 300000) {
        if (context?.waitUntil) {
          const refresh = index(env, graphql, context, true);
          // Keep serving this snapshot while Shopify refreshes, including the
          // user's next keystroke. Do not replace it with a pending rebuild.
          shops.set(shop, value); value.expires = Date.now() + 30000;
          context.waitUntil(refresh.then(fresh => {
            if (shops.get(shop) === value) { value.promise = Promise.resolve(fresh); value.expires = Date.now() + 300000; }
          }).catch(() => {}));
        }
        else return index(env, graphql, context, true);
      }
      return { ...snapshot, skuCache: new Map() };
    }
    const products = []; let after = null;
    do {
      const data = checked(await graphql(env, FINDER_PRODUCTS_QUERY, { after }, 'PreparedFinderProducts'));
      products.push(...data.products.nodes.filter(p => ['ACTIVE', 'UNLISTED'].includes(p.status)));
      after = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
      if (data.products.pageInfo.hasNextPage && !after) fail('The complete garment catalog could not load. Retry.');
    } while (after);
    const native = new Map(snapshot?.nativeFamilies || []), ids = [...new Set(products.flatMap(p => p.options?.flatMap(o => o.optionValues?.map(v => v.linkedMetafieldValue).filter(Boolean) || []) || []))];
    // Optional enrichment: read_products-only installations remain usable when
    // Shopify denies metaobject access; named/hex families are explicit fallbacks.
    let nativeDenied = false;
    await mapConcurrent(Array.from({ length: Math.ceil(ids.length / 80) }, (_, i) => ids.slice(i * 80, i * 80 + 80)), 2, async batch => {
      if (nativeDenied) return;
      try {
        const result = await graphql(env, NATIVE_COLORS_QUERY, { ids: batch }, 'PreparedFinderColors');
        if (result?.errors?.length || result?.ok === false) { nativeDenied = true; return; }
        for (const node of result.data?.nodes || []) if (node?.id) native.set(node.id, node.field?.references?.nodes?.map(v => v.name) || []);
      } catch { nativeDenied = true; }
    });
    const built = { version: 1, nativeFamilies: [...native], products: products.map(p => {
      const colors = (p.options || []).filter(o => /colou?r/i.test(o.name)).flatMap(o => (o.optionValues || []).filter(v => v.hasVariants !== false).map(v => ({ name: v.name, color: v.swatch?.color || '', image: v.swatch?.image?.image?.url || '', families: colorFamilies(v.name, v.swatch?.color, native.get(v.linkedMetafieldValue)) })));
      return { id: p.id, title: p.title, handle: p.handle, status: p.status, brand: catalogBrand(p), garmentType: garmentType(p), image: p.featuredMedia?.preview?.image?.url || '', colors };
    }), loadedAt: new Date().toISOString() };
    try { await env.R2_BUCKET?.put(key, JSON.stringify(built), { httpMetadata: { contentType: 'application/json' } }); } catch { /* A cache write must not prevent selection. */ }
    return { ...built, skuCache: new Map() };
  })().catch(error => { if (shops.get(shop) === value) shops.delete(shop); throw error; }).finally(() => { value.refreshing = false; });
  shops.set(shop, value); return value.promise;
}
export async function searchPreparedCatalog(env, graphql, input, context) {
  const state = await index(env, graphql, context, input.refresh === '1'), query = String(input.q || '').trim().slice(0, 120);
  let skuMatches = new Set();
  if (/^[a-z0-9_.-]{3,80}$/i.test(query) && /\d/.test(query)) {
    if (!state.skuCache.has(query)) state.skuCache.set(query, (async () => {
      const found = new Set(); let after = null;
      do { const data = checked(await graphql(env, SKU_QUERY, { query: `(status:active OR status:unlisted) AND sku:${query}*`, after }, 'PreparedFinderSku')); data.products.nodes.forEach(p => found.add(p.id)); after = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null; } while (after);
      return found;
    })().catch(error => { state.skuCache.delete(query); throw error; }));
    skuMatches = await state.skuCache.get(query);
  }
  const parse = key => String(input[key] || '').split('|').filter(Boolean);
  const filters = { status: parse('status'), type: parse('type'), brand: parse('brand'), family: parse('family') };
  const recent = new Set(String(input.recent || '').split('|').filter(Boolean));
  const matches = state.products.filter(product => !input.recent || recent.has(product.id)).map(product => ({ product, score: catalogMatch(product, query, filters, skuMatches) })).filter(value => value.score >= 0).sort((a, b) => b.score - a.score || a.product.title.localeCompare(b.product.title));
  const offset = /^\d{1,8}$/.test(input.after || '') ? Number(input.after) : 0;
  const facets = { brand: [...new Set(state.products.map(p => p.brand))].sort(), type: [...new Set(state.products.map(p => p.garmentType))].sort(), family: COLOR_FAMILIES.filter(f => state.products.some(p => p.colors.some(c => c.families.includes(f)))) };
  return { products: matches.slice(offset, offset + 30).map(v => v.product), total: matches.length, facets, hasNextPage: offset + 30 < matches.length, endCursor: offset + 30 < matches.length ? String(offset + 30) : null, loadedAt: state.loadedAt };
}
