import { SyncError, requireValue, uniqueStrings, skuList, normalizeInventory } from './core.mjs';

// One retry only for throttling/server errors; no raw response body enters errors/logs.
export async function requestJson(url, options = {}, { fetchImpl = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), retryHttp = true, supplierErrors = false, now = Date.now } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let response;
    // Workers reject redirect: 'error'. Manual mode also keeps credentials off redirected hosts.
    try { response = await fetchImpl(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(15000) }); }
    catch (error) { if (error instanceof SyncError) throw error; throw new SyncError('UPSTREAM_TRANSPORT_FAILED'); }
    if (retryHttp && (response.status === 429 || response.status >= 500) && attempt === 0) {
      const header = response.headers.get('Retry-After');
      const retry = header === null ? 0.5 : /^\d+$/.test(header) ? Number(header) : (Date.parse(header) - Date.now()) / 1000;
      if (!Number.isFinite(retry) || retry > 2) throw new SyncError('UPSTREAM_RETRY_DEFERRED');
      await response.body?.cancel();
      await sleep(Math.max(250, Number.isFinite(retry) ? retry * 1000 : 500));
      continue;
    }
    if (!response.ok) {
      let code = 'UPSTREAM_HTTP_' + response.status;
      if (supplierErrors) {
        try {
          const data = await response.json();
          if (/^UPSTREAM_[A-Z0-9_]+$|^INVALID_SUPPLIER_RESPONSE$|^SUPPLIER_(RATE_LIMITED|SOURCE_STALE)$/.test(data?.error || '')) code = data.error;
        } catch { /* No raw supplier body enters errors or logs. */ }
      }
      const error = new SyncError(code, response.status);
      const header = response.headers.get('Retry-After');
      const seconds = header === null ? null : /^\d+$/.test(header) ? Number(header) : Math.ceil((Date.parse(header) - now()) / 1000);
      if (Number.isFinite(seconds)) error.retryAfterSeconds = Math.max(1, seconds);
      throw error;
    }
    let data;try { data=await response.json(); } catch { throw new SyncError('UPSTREAM_INVALID_JSON'); }
    if(data.errors?.some(e=>e.extensions?.code==='THROTTLED')&&attempt===0){
      const cost=data.extensions?.cost,rate=cost?.throttleStatus?.restoreRate;
      const wait=rate>0?Math.ceil(Math.max(1,(cost.requestedQueryCost||50)-cost.throttleStatus.currentlyAvailable)/rate*1000):1000;
      if(wait>15000)throw new SyncError('UPSTREAM_RETRY_DEFERRED');
      await sleep(Math.max(250,wait));continue;
    }
    const budget=data.extensions?.cost?.throttleStatus;
    if(budget?.restoreRate>0&&budget.currentlyAvailable<50)await sleep(Math.ceil((50-budget.currentlyAvailable)/budget.restoreRate*1000));
    return data;
  }
}
export function shopDomain(env) {
  const shop = String(env.SHOPIFY_SHOP_DOMAIN || '').trim().toLowerCase();
  requireValue(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop), 'INVALID_SHOP_DOMAIN');
  return shop;
}
export async function shopifyToken(env, deps) {
  if (env.SHOPIFY_ACCESS_TOKEN) return env.SHOPIFY_ACCESS_TOKEN;
  requireValue(env.SHOPIFY_API_KEY && env.SHOPIFY_API_SECRET, 'SHOPIFY_CREDENTIALS_MISSING');
  const data = await requestJson(`https://${shopDomain(env)}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.SHOPIFY_API_KEY, client_secret: env.SHOPIFY_API_SECRET })
  }, deps);
  requireValue(typeof data?.access_token === 'string' && data.access_token, 'SHOPIFY_TOKEN_MISSING');
  return data.access_token;
}
export async function shopifyRead(env, token, query, variables = {}, deps) {
  // Fail closed: this module cannot send mutations or arbitrary shorthand operations.
  requireValue(/^\s*query\b/.test(query) && !/\bmutation\b/.test(query), 'READ_ONLY_QUERY_REQUIRED');
  const data = await requestJson(`https://${shopDomain(env)}/admin/api/2026-07/graphql.json`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables })
  }, deps);
  if (data?.errors?.length) throw new SyncError(data.errors.some(e => e.extensions?.code === 'ACCESS_DENIED') ? 'SHOPIFY_ACCESS_DENIED' : 'SHOPIFY_QUERY_FAILED');
  requireValue(data?.data, 'SHOPIFY_DATA_MISSING');
  return data.data;
}
export const VARIANT_FIELDS = 'id sku inventoryPolicy product { status } inventoryItem { id tracked }';
export const SKU_MATCH_FIELDS = `id sku product { status } inventoryItem { inventoryLevels(first:10, includeInactive:true) {
  nodes { quantities(names:["committed"]) { name quantity } } pageInfo { hasNextPage }
} }`;
// Ignore a draft's copied SKU only when every inventory level verifies that it
// has no outstanding customer commitments. Active and Unlisted copies block.
export function isUniqueSellableSku(result, variant) {
  if (result?.pageInfo?.hasNextPage !== false || !Array.isArray(result.nodes)) return false;
  const exact = result.nodes.filter(node => node.sku === variant.sku);
  if (exact.filter(node => node.id === variant.id).length !== 1) return false;
  return exact.filter(node => node.id !== variant.id).every(node => {
    const levels = node.inventoryItem?.inventoryLevels;
    return node.product?.status === 'DRAFT' && levels?.pageInfo?.hasNextPage === false
      && Array.isArray(levels.nodes) && levels.nodes.every(level => {
        const values = level.quantities?.filter(q => q.name === 'committed');
        return values?.length === 1 && values[0].quantity === 0;
      });
  });
}
export async function verifyDraftSkuDuplicates(env, token, variants, deps) {
  const duplicates = variants.filter(v => v.inventoryItem?.duplicateSkuCount > 0);
  const verified = new Set();
  if (!duplicates.length) return verified;
  for(let offset=0;offset<duplicates.length;offset+=25){
  const batch=duplicates.slice(offset,offset+25);
  const variables = Object.fromEntries(batch.map((v,i) => ['sku'+i,'sku:'+v.sku]));
  const declarations = batch.map((_,i) => `$sku${i}:String!`).join(',');
  const fields = batch.map((_,i) => `sku${i}:productVariants(first:2,query:$sku${i}){nodes{${SKU_MATCH_FIELDS}}pageInfo{hasNextPage}}`).join('\n');
  const data = await shopifyRead(env,token,`query VerifyDraftSkuDuplicates(${declarations}){${fields}}`,variables,deps);
  batch.forEach((v,i) => {
    const result = data['sku'+i];
    requireValue(isUniqueSellableSku(result,v) && result.nodes.filter(n=>n.sku===v.sku&&n.id!==v.id).length===v.inventoryItem.duplicateSkuCount,'SHARED_SUPPLIER_SKU');
    verified.add(v.id);
  });
  }
  return verified;
}
const PILOT_VARIANT_FIELDS = `id sku inventoryPolicy availableForSale sellableOnlineQuantity product { status }
  inventoryItem { id tracked inventoryLevels(first: 10, includeInactive: true) {
    nodes { isActive location { id } quantities(names: ["available", "committed", "on_hand"]) { name quantity } }
    pageInfo { hasNextPage }
  } }`;
export async function readPilot(env, token, ids, deps) {
  const data = await shopifyRead(env, token, `query InventoryPilot($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { ${PILOT_VARIANT_FIELDS} } } }`, { ids }, deps);
  requireValue(Array.isArray(data.nodes) && data.nodes.length === ids.length
    && data.nodes.every((v, i) => v?.id === ids[i] && ['ACTIVE', 'UNLISTED'].includes(v.product?.status) && v.inventoryItem?.id), 'PILOT_VARIANT_MISSING_OR_INACTIVE');
  return data.nodes;
}
export function isSupplierDeferred(error) {
  return /^(SUPPLIER_RATE_LIMITED|UPSTREAM_RETRY_DEFERRED|UPSTREAM_HTTP_(429|502|503))$/.test(error?.code || '')
    || [429,502,503].includes(error?.status);
}
export const SUPPLIER_BATCH_SIZE = 250;
export function supplierBatchSize(env) {
  const size = Number(env.INVENTORY_SUPPLIER_BATCH_SIZE || 25);
  requireValue(Number.isSafeInteger(size) && size >= 25 && size <= SUPPLIER_BATCH_SIZE && size % 25 === 0, 'INVALID_SUPPLIER_BATCH_SIZE');
  return size;
}
export function supplierSkuList(skus) {
  return uniqueStrings(skus, /^[A-Za-z0-9_-]{1,64}$/, SUPPLIER_BATCH_SIZE, 'INVALID_SKUS');
}
export function normalizeSupplierBatch(items, skus) {
  supplierSkuList(skus);
  requireValue(Array.isArray(items) && items.length <= skus.length
    && items.every(item => item && skus.includes(item.sku))
    && new Set(items.map(item => item.sku)).size === items.length, 'INVALID_SUPPLIER_RESPONSE');
  const normalized = [];
  for (let i = 0; i < skus.length; i += 25) {
    const batch = skus.slice(i, i + 25);
    normalized.push(...normalizeInventory(items.filter(item => batch.includes(item.sku)), batch));
  }
  // Optional prices survive stock normalization without affecting stock validity.
  const prices = new Map(items.filter(item => Object.hasOwn(item, 'customerPrice')).map(item => [item.sku, item.customerPrice]));
  return normalized.map(item => prices.has(item.sku) ? {...item, customerPrice: prices.get(item.sku)} : item);
}
export function supplierSlice(snapshot, skus) {
  skuList(skus);
  supplierSkuList(snapshot?.skus);
  requireValue(skus.every(sku => snapshot.skus.includes(sku)), 'SUPPLIER_PREFETCH_SCOPE_MISMATCH');
  const items = normalizeSupplierBatch(snapshot.items, snapshot.skus);
  return { observedAt: snapshot.observedAt, items: items.filter(item => skus.includes(item.sku)) };
}
export async function readSupplierGateway(env, skus, deps) {
  skuList(skus);
  if (deps?.supplierSnapshot) return supplierSlice(deps.supplierSnapshot, skus);
  return readSupplierGatewayBulk(env, skus, deps);
}
export async function readSupplierGatewayBulk(env, skus, deps) {
  supplierSkuList(skus);
  let url;
  try { url = new URL(env.SUPPLIER_INVENTORY_URL); } catch { throw new SyncError('SUPPLIER_GATEWAY_UNCONFIGURED'); }
  requireValue(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
    && url.pathname === '/order-manager/v1/supplier/ss/inventory', 'INVALID_GATEWAY_URL');
  requireValue(env.INVENTORY_READ_KEY, 'GATEWAY_CREDENTIAL_MISSING');
  url.searchParams.set('skus', skus.join(','));
  const data = await requestJson(url.href, { headers: {
    'X-Inventory-Read-Key': env.INVENTORY_READ_KEY,
    'X-Shopify-Shop-Domain': shopDomain(env), Accept: 'application/json'
  } }, { ...deps, retryHttp: false, supplierErrors: true });
  return { observedAt: data?.observedAt, skus: [...skus], items: normalizeSupplierBatch(data?.items, skus) };
}
