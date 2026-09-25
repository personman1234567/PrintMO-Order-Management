import { SyncError, requireValue, uniqueStrings, warehouseList, makePlan } from './core.mjs';
import { shopifyToken, readPilot, readSupplierGateway } from './clients.mjs';
import { runGuardedWrite } from './writer.mjs';
function jsonSetting(env, key) {
  try { return JSON.parse(env[key] || '[]'); } catch { throw new SyncError(`INVALID_${key}`); }
}
export async function runDryRun(env, deps) {
  const mode = env.INVENTORY_SYNC_MODE || 'disabled';
  if (mode === 'disabled') return { mode, writes: 0 };
  requireValue(mode === 'dry-run', 'LIVE_WRITES_NOT_IMPLEMENTED');
  const ids = uniqueStrings(jsonSetting(env, 'PILOT_VARIANT_IDS'), /^gid:\/\/shopify\/ProductVariant\/\d+$/, 25, 'INVALID_PILOT');
  const warehouses = warehouseList(jsonSetting(env, 'SS_WAREHOUSES'));
  const bufferText = env.SS_SAFETY_BUFFER;
  requireValue(typeof bufferText === 'string' && /^\d+$/.test(bufferText), 'INVALID_BUFFER');
  const safetyBuffer = Number(bufferText);
  requireValue(Number.isSafeInteger(safetyBuffer), 'INVALID_BUFFER');
  const protectedLocationIds = jsonSetting(env, 'PROTECTED_LOCATION_IDS');
  requireValue(Array.isArray(protectedLocationIds) && protectedLocationIds.every(x => /^gid:\/\/shopify\/Location\/\d+$/.test(x)), 'INVALID_PROTECTED_LOCATIONS');
  const supplierLocationId = env.SUPPLIER_LOCATION_ID || '';
  requireValue(!supplierLocationId || (/^gid:\/\/shopify\/Location\/\d+$/.test(supplierLocationId) && !protectedLocationIds.includes(supplierLocationId)), 'INVALID_OR_PROTECTED_LOCATION');
  const token = await shopifyToken(env, deps);
  const variants = await readPilot(env, token, ids, deps);
  const supplier = await readSupplierGateway(env, [...new Set(variants.map(v => v.sku))], deps);
  return makePlan({ variants, inventory: supplier.items, observedAt: supplier.observedAt,
    warehouses, safetyBuffer, supplierLocationId, protectedLocationIds });
}
export async function runInventorySync(env, deps) {
  if (env.INVENTORY_SYNC_MODE === 'pilot-write') return runGuardedWrite(env, deps);
  return runDryRun(env, deps);
}
export default {
  async fetch() { return new Response('Not found', { status: 404 }); },
  async scheduled(_event, env) {
    try {
      const result = await runInventorySync(env);
      const statuses = { inStock: 0, outOfStock: 0, unknown: 0 };
      for (const row of result.rows || []) {
        if (row.supplierStockStatus === 'IN_STOCK') statuses.inStock++;
        else if (row.supplierStockStatus === 'OUT_OF_STOCK') statuses.outOfStock++;
        else statuses.unknown++;
      }
      console.log(JSON.stringify({ event: 'inventory-observation', mode: result.mode, writes: result.writes || 0,
        variants: result.mode === 'pilot-write' ? 1 : result.rows?.length || 0,
        blocked: result.rows?.filter(r => r.blockers.length).length || 0,
        ...statuses }));
    } catch (error) {
      // Never emit upstream bodies, tokens, URLs, product data, or user-controlled error strings.
      const code = error instanceof SyncError ? error.code : 'INVENTORY_OBSERVATION_FAILED';
      console.error(JSON.stringify({ event: 'inventory-observation-failed', code }));
      throw new Error(code);
    }
  }
};
