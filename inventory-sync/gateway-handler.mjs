// Adapter candidate for the separate Render gateway. NOT mounted or deployed here.
// Node 22+ / Web Request and Response. Mount inside the gateway's authenticated router.
import { createHash, timingSafeEqual } from 'node:crypto';
import { SyncError, requireValue, skuList, normalizeInventory } from './core.mjs';
import { requestJson } from './clients.mjs';
function authorized(request, env) {
  const supplied = request.headers.get('X-Order-Manager-Key') || '';
  if (!env.ORDER_MANAGER_ADMIN_KEY || !supplied) return false;
  const digest = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(supplied), digest(env.ORDER_MANAGER_ADMIN_KEY));
}
export async function gatewayInventoryHandler(request, env, deps) {
  const reply = (body, status) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  if (!authorized(request, env)) return reply({ error: 'UNAUTHORIZED' }, 401);
  if (request.method !== 'GET') return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const url = new URL(request.url);
  if (url.pathname !== '/order-manager/v1/supplier/ss/inventory') return reply({ error: 'NOT_FOUND' }, 404);
  if (!env.SS_ACCOUNT_NUMBER || !env.SS_API_KEY) return reply({ error: 'SUPPLIER_NOT_CONFIGURED' }, 503);
  let skus;
  try { skus = skuList((url.searchParams.get('skus') || '').split(',')); }
  catch { return reply({ error: 'INVALID_SKUS' }, 400); }
  try {
    const suffix = skus.map(encodeURIComponent).join(',');
    const options = {
      method: 'GET', headers: { Accept: 'application/json', Authorization: `Basic ${Buffer.from(`${env.SS_ACCOUNT_NUMBER}:${env.SS_API_KEY}`).toString('base64')}` }
    };
    const payload = await requestJson(`https://api.ssactivewear.com/v2/inventory/${suffix}`, options, deps);
    const products = await requestJson(`https://api.ssactivewear.com/v2/products/${suffix}`, options, deps);
    requireValue(Array.isArray(products) && products.length <= skus.length, 'INVALID_SUPPLIER_RESPONSE');
    const flags = new Map();
    for (const product of products) {
      requireValue(product && skus.includes(product.sku) && !flags.has(product.sku)
        && Array.isArray(product.warehouses), 'INVALID_SUPPLIER_RESPONSE');
      const byCode = new Map();
      for (const warehouse of product.warehouses) {
        requireValue(warehouse && typeof warehouse.dropship === 'boolean'
          && !byCode.has(warehouse.warehouseAbbr), 'INVALID_SUPPLIER_RESPONSE');
        byCode.set(warehouse.warehouseAbbr, warehouse.dropship);
      }
      flags.set(product.sku, byCode);
    }
    requireValue(Array.isArray(payload), 'INVALID_SUPPLIER_RESPONSE');
    const merged = payload.map(item => ({ ...item, warehouses: item.warehouses?.map(warehouse => {
      requireValue(flags.get(item.sku)?.has(warehouse.warehouseAbbr), 'INVALID_SUPPLIER_RESPONSE');
      return { ...warehouse, dropship: flags.get(item.sku).get(warehouse.warehouseAbbr) };
    }) }));
    return reply({ observedAt: new Date().toISOString(), items: normalizeInventory(merged, skus) }, 200);
  } catch (error) {
    // Supplier 404 can mean invalid/discontinued, never translate it to zero quantity.
    return reply({ error: error instanceof SyncError ? error.code : 'SUPPLIER_READ_FAILED' }, 502);
  }
}
