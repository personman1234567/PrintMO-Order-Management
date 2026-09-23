// Pure observation/planning only. No inventory mutation is implemented.
export class SyncError extends Error {
  constructor(code, status = 500) { super(code); this.code = code; this.status = status; }
}
export function requireValue(condition, code) {
  if (!condition) throw new SyncError(code);
}
export function uniqueStrings(value, pattern, max, code) {
  requireValue(Array.isArray(value) && value.length > 0 && value.length <= max, code);
  requireValue(value.every(v => typeof v === 'string' && pattern.test(v)) && new Set(value).size === value.length, code);
  return value;
}
export function skuList(value) { return uniqueStrings(value, /^[A-Za-z0-9_-]{1,64}$/, 25, 'INVALID_SKUS'); }
export function warehouseList(value) {
  if (Array.isArray(value) && value.length === 1 && value[0] === '*') return value;
  return uniqueStrings(value, /^[A-Z0-9]{1,8}$/, 30, 'INVALID_WAREHOUSES');
}
export function normalizeInventory(payload, skus) {
  skuList(skus);
  requireValue(Array.isArray(payload) && payload.length <= skus.length, 'INVALID_SUPPLIER_RESPONSE');
  const seen = new Set();
  return payload.map(item => {
    requireValue(item && skus.includes(item.sku) && !seen.has(item.sku), 'INVALID_SUPPLIER_RESPONSE');
    seen.add(item.sku);
    requireValue(Array.isArray(item.warehouses) && item.warehouses.length > 0 && item.warehouses.length <= 100, 'INVALID_SUPPLIER_RESPONSE');
    const warehouses = new Set();
    return { sku: item.sku, warehouses: item.warehouses.map(w => {
      requireValue(w && /^[A-Z0-9]{1,8}$/.test(w.warehouseAbbr) && !warehouses.has(w.warehouseAbbr)
        && Number.isSafeInteger(w.qty) && w.qty >= 0 && typeof w.dropship === 'boolean', 'INVALID_SUPPLIER_RESPONSE');
      warehouses.add(w.warehouseAbbr);
      return { warehouseAbbr: w.warehouseAbbr, qty: w.qty, dropship: w.dropship };
    }) };
  });
}
export function makePlan({ variants, inventory, observedAt, warehouses, safetyBuffer, supplierLocationId, protectedLocationIds, now = Date.now() }) {
  warehouseList(warehouses);
  requireValue(Number.isSafeInteger(safetyBuffer) && safetyBuffer >= 0, 'INVALID_BUFFER');
  requireValue(Array.isArray(variants) && variants.length > 0 && variants.length <= 25, 'INVALID_PILOT');
  requireValue(new Set(variants.map(v => v.id)).size === variants.length, 'DUPLICATE_VARIANT');
  const skus = [...new Set(variants.map(v => v.sku))];
  const items = normalizeInventory(inventory, skus);
  const age = now - Date.parse(observedAt);
  requireValue(Number.isFinite(age) && age >= -30000 && age <= 300000, 'STALE_SUPPLIER_SNAPSHOT');
  requireValue(Array.isArray(protectedLocationIds), 'INVALID_PROTECTED_LOCATIONS');
  if (supplierLocationId) {
    requireValue(/^gid:\/\/shopify\/Location\/\d+$/.test(supplierLocationId), 'INVALID_SUPPLIER_LOCATION');
    requireValue(!protectedLocationIds.includes(supplierLocationId), 'PROTECTED_LOCATION');
  }
  const rows = variants.map(v => {
    const blockers = ['PENDING_COMMITMENTS_UNVERIFIED', 'CATALOG_SHARED_SKUS_UNVERIFIED'];
    if (!supplierLocationId) blockers.push('SUPPLIER_LOCATION_UNCONFIGURED');
    if (!protectedLocationIds.length) blockers.push('LOCAL_LOCATIONS_UNVERIFIED');
    if (!v.inventoryItem?.tracked) blockers.push('TRACKING_DISABLED');
    if (v.inventoryPolicy !== 'DENY') blockers.push('OVERSELL_POLICY');
    if (variants.filter(other => other.sku === v.sku).length > 1) blockers.push('SHARED_SUPPLIER_SKU');
    const item = items.find(i => i.sku === v.sku);
    const selected = warehouses[0] === '*' ? item?.warehouses.filter(w => !w.dropship && w.warehouseAbbr !== 'DS')
      : warehouses.map(code => item?.warehouses.find(w => w.warehouseAbbr === code));
    let supplierAvailable = null;
    if (!item) blockers.push('SUPPLIER_SKU_MISSING');
    else if (selected.some(w => !w)) blockers.push('WAREHOUSE_COVERAGE_INCOMPLETE');
    else if (selected.some(w => w.dropship || w.warehouseAbbr === 'DS')) blockers.push('DROPSHIP_WAREHOUSE_SELECTED');
    else {
      supplierAvailable = selected.reduce((sum, w) => sum + w.qty, 0);
      requireValue(Number.isSafeInteger(supplierAvailable), 'INVALID_SUPPLIER_RESPONSE');
    }
    return {
      variantId: v.id, inventoryItemId: v.inventoryItem?.id ?? null, sku: v.sku,
      supplierLocationId: supplierLocationId || null, supplierAvailable,
      supplierStockStatus: supplierAvailable === null ? 'UNKNOWN' : supplierAvailable === 0 ? 'OUT_OF_STOCK' : 'IN_STOCK',
      capacityBeforeCommitments: supplierAvailable === null ? null : Math.max(0, supplierAvailable - safetyBuffer),
      proposedQuantity: null, writeReady: false, blockers
    };
  });
  return { mode: 'dry-run', observedAt, generatedAt: new Date(now).toISOString(), writes: 0, rows };
}
