import { SyncError, requireValue, uniqueStrings, warehouseList, makePlan } from './core.mjs';
import { shopifyToken, readPilot, readSupplierGateway } from './clients.mjs';
import { runGuardedWrite, runGuardedBatch } from './writer.mjs';
import { BELLA_3001_VARIANT_IDS } from './bella-3001-allowlist.mjs';
import { SCHEDULED_VARIANTS } from './scheduled-variants.mjs';
import { PRIORITY_SHARED_6400_SKUS } from './priority-shared-6400.mjs';
import { BATCH_SIZE } from './enrollment.mjs';
import {inventoryService} from './service.mjs';
import {runRegistrySchedule} from './registry.mjs';
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
export function scheduledShard(env, scheduledTime) {
  const count = Number(env.PILOT_SHARD_COUNT || '1');
  requireValue(Number.isSafeInteger(count) && count >= 1 && count <= 5, 'INVALID_SHARD_COUNT');
  if (count === 1) return env;
  requireValue(env.INVENTORY_SYNC_MODE === 'pilot-refresh' && Number.isSafeInteger(scheduledTime), 'INVALID_SHARD_SCHEDULE');
  const ids = uniqueStrings(jsonSetting(env, 'PILOT_VARIANT_IDS'), /^gid:\/\/shopify\/ProductVariant\/\d+$/, 75, 'PILOT_VARIANT_SCOPE_INVALID');
  requireValue(ids.length > 6 && Math.ceil(ids.length / count) <= 15, 'PILOT_SHARD_SCOPE_INVALID');
  const minute = Math.floor(scheduledTime / 60000);
  const selected = ids.filter((_, index) => index % count === minute % count);
  return { ...env, PILOT_VARIANT_IDS: JSON.stringify(selected) };
}
export function scheduledBella3001Ids(scheduledTime) {
  requireValue(Number.isSafeInteger(scheduledTime), 'INVALID_SHARD_SCHEDULE');
  const minute = Math.floor(scheduledTime / 60000);
  return BELLA_3001_VARIANT_IDS.filter((_, index) => index % 5 === minute % 5);
}
export function scheduledAllVariants(scheduledTime) {
  requireValue(Number.isSafeInteger(scheduledTime), 'INVALID_SHARD_SCHEDULE');
  const minute = Math.floor(scheduledTime / 60000);
  return SCHEDULED_VARIANTS.filter(entry => !PRIORITY_SHARED_6400_SKUS.has(entry.sku))
    .filter((_, index) => index % 5 === minute % 5);
}
async function runExpandedSchedule(env, deps, scheduledTime) {
  const token = await shopifyToken(env, deps);
  if (env.PRIORITY_SYNC_ENABLED === 'true') {
    const pinnedTultex = jsonSetting(env, 'PILOT_VARIANT_IDS');
    requireValue(env.BELLA_3001_SYNC_ENABLED === 'true' && env.PILOT_SHARD_COUNT === '5'
      && Array.isArray(pinnedTultex) && pinnedTultex.length === 72
      && pinnedTultex.every((id, index) => id === SCHEDULED_VARIANTS[index].id), 'SCHEDULE_CONFIG_MISMATCH');
    const entries = scheduledAllVariants(scheduledTime);
    const groups = Array.from({ length: Math.ceil(entries.length / BATCH_SIZE) },
      (_, index) => entries.slice(index * BATCH_SIZE, index * BATCH_SIZE + BATCH_SIZE));
    // Each group uses one combined Shopify identity/level read, one S&S read,
    // and at most one CAS mutation; this legacy schedule has no application request cap.
    requireValue(groups.every(group => group.length >= 1 && group.length <= BATCH_SIZE),
      'SCHEDULE_SCOPE_INVALID');
    let writes = 0;
    let increases = 0;
    let failures = 0;
    let held = 0;
    for (const [index, group] of groups.entries()) {
      try {
        const result = await runGuardedBatch({ ...env, SHOPIFY_ACCESS_TOKEN: token,
          PILOT_VARIANT_IDS: JSON.stringify(group.map(entry => entry.id)),
          PILOT_VARIANT_SKUS: JSON.stringify(group.map(entry => entry.sku)),
          PILOT_MISSING_SKU_POLICIES: JSON.stringify(group.map(entry => entry.missingPolicy)) }, deps);
        writes += result.writes;
        increases += result.increases;
        held += result.held || 0;
      } catch (error) {
        failures++;
        console.error(JSON.stringify({ event: 'inventory-shard-failed', group: index,
          code: error instanceof SyncError ? error.code : 'INVENTORY_SHARD_FAILED' }));
      }
    }
    if (failures) throw new SyncError('PILOT_BATCH_PARTIAL_FAILURE');
    return { mode: 'pilot-refresh', writes, increases, held, variants: entries.length };
  }
  const tultexIds = JSON.parse(scheduledShard(env, scheduledTime).PILOT_VARIANT_IDS);
  const bellaIds = scheduledBella3001Ids(scheduledTime);
  // Each call makes a bounded catalog, supplier, and Shopify preflight read,
  // followed by at most one CAS mutation. Keep the full minute below 50
  // external subrequests even if every batch has stock decreases.
  const groups = [tultexIds, ...Array.from({ length: Math.ceil(bellaIds.length / 15) },
    (_, index) => bellaIds.slice(index * 15, index * 15 + 15))];
  requireValue(groups.length <= 12 && groups.every(group => group.length >= 1 && group.length <= 15),
    'SCHEDULE_SCOPE_INVALID');
  let writes = 0;
  let increases = 0;
  let failures = 0;
  for (const [index, ids] of groups.entries()) {
    try {
      const result = await runGuardedBatch({ ...env, SHOPIFY_ACCESS_TOKEN: token,
        PILOT_VARIANT_IDS: JSON.stringify(ids),
        SUPPLIER_MISSING_SKU_POLICY: index === 0 ? 'hold' : 'block' }, deps);
      writes += result.writes;
      increases += result.increases;
    } catch (error) {
      failures++;
      console.error(JSON.stringify({ event: 'inventory-shard-failed', group: index,
        code: error instanceof SyncError ? error.code : 'INVENTORY_SHARD_FAILED' }));
    }
  }
  if (failures) throw new SyncError('PILOT_BATCH_PARTIAL_FAILURE');
  return { mode: 'pilot-refresh', writes, increases, variants: tultexIds.length + bellaIds.length };
}
export async function runInventorySync(env, deps, scheduledTime) {
  if(scheduledTime!==undefined&&env.INVENTORY_REGISTRY_ENABLED==='true'&&env.INVENTORY_SYNC_MODE==='pilot-refresh')return runRegistrySchedule(env,deps,scheduledTime);
  if (scheduledTime !== undefined && env.INVENTORY_SYNC_MODE === 'pilot-refresh'
    && env.BELLA_3001_SYNC_ENABLED === 'true')
    return runExpandedSchedule(env, deps, scheduledTime);
  if (['pilot-write', 'pilot-refresh'].includes(env.INVENTORY_SYNC_MODE))
    return runGuardedWrite(scheduledTime === undefined ? env : scheduledShard(env, scheduledTime), deps);
  return runDryRun(env, deps);
}
export default {
  fetch:inventoryService,
  async scheduled(event, env) {
    try {
      const result = await runInventorySync(env, undefined, event.scheduledTime);
      const statuses = { inStock: 0, outOfStock: 0, unknown: 0 };
      for (const row of result.rows || []) {
        if (row.supplierStockStatus === 'IN_STOCK') statuses.inStock++;
        else if (row.supplierStockStatus === 'OUT_OF_STOCK') statuses.outOfStock++;
        else statuses.unknown++;
      }
      console.log(JSON.stringify({ event: 'inventory-observation', mode: result.mode, writes: result.writes || 0,
        held: result.held || 0,
        increases: result.increases || 0,
        variants: result.variants || (['pilot-write', 'pilot-refresh'].includes(result.mode) ? 1 : result.rows?.length || 0),
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
