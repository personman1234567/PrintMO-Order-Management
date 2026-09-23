import { SyncError, requireValue, skuList, normalizeInventory } from './core.mjs';

// One retry only for throttling/server errors; no raw response body enters errors/logs.
export async function requestJson(url, options = {}, { fetchImpl = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let response;
    // Workers reject redirect: 'error'. Manual mode also keeps credentials off redirected hosts.
    try { response = await fetchImpl(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(15000) }); }
    catch { throw new SyncError('UPSTREAM_TRANSPORT_FAILED'); }
    if ((response.status === 429 || response.status >= 500) && attempt === 0) {
      const header = response.headers.get('Retry-After');
      const retry = header === null ? 0.5 : /^\d+$/.test(header) ? Number(header) : (Date.parse(header) - Date.now()) / 1000;
      if (!Number.isFinite(retry) || retry > 2) throw new SyncError('UPSTREAM_RETRY_DEFERRED');
      await response.body?.cancel();
      await sleep(Math.max(250, Number.isFinite(retry) ? retry * 1000 : 500));
      continue;
    }
    if (!response.ok) throw new SyncError(`UPSTREAM_HTTP_${response.status}`, response.status);
    try { return await response.json(); } catch { throw new SyncError('UPSTREAM_INVALID_JSON'); }
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
const PILOT_VARIANT_FIELDS = `id sku inventoryPolicy availableForSale sellableOnlineQuantity product { status }
  inventoryItem { id tracked inventoryLevels(first: 10, includeInactive: true) {
    nodes { isActive location { id } quantities(names: ["available", "committed", "on_hand"]) { name quantity } }
    pageInfo { hasNextPage }
  } }`;
export async function readPilot(env, token, ids, deps) {
  const data = await shopifyRead(env, token, `query InventoryPilot($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { ${PILOT_VARIANT_FIELDS} } } }`, { ids }, deps);
  requireValue(Array.isArray(data.nodes) && data.nodes.length === ids.length
    && data.nodes.every((v, i) => v?.id === ids[i] && v.product?.status === 'ACTIVE' && v.inventoryItem?.id), 'PILOT_VARIANT_MISSING_OR_INACTIVE');
  return data.nodes;
}
export async function readSupplierGateway(env, skus, deps) {
  skuList(skus);
  let url;
  try { url = new URL(env.SUPPLIER_INVENTORY_URL); } catch { throw new SyncError('SUPPLIER_GATEWAY_UNCONFIGURED'); }
  requireValue(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
    && url.pathname === '/order-manager/v1/supplier/ss/inventory', 'INVALID_GATEWAY_URL');
  requireValue(env.INVENTORY_READ_KEY, 'GATEWAY_CREDENTIAL_MISSING');
  url.searchParams.set('skus', skus.join(','));
  const data = await requestJson(url.href, { headers: {
    'X-Inventory-Read-Key': env.INVENTORY_READ_KEY,
    'X-Shopify-Shop-Domain': shopDomain(env), Accept: 'application/json'
  } }, deps);
  return { observedAt: data?.observedAt, items: normalizeInventory(data?.items, skus) };
}
