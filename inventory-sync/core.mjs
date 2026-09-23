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
function quantity(level, name) {
  const values = level?.quantities?.filter(q => q.name === name);
  return values?.length === 1 && Number.isSafeInteger(values[0].quantity) ? values[0].quantity : null;
}
function gateEvidence(variant, capacityBeforeCommitments, supplierLocationId, supplierLocation) {
  const levels = variant.inventoryItem?.inventoryLevels;
  const desired = capacityBeforeCommitments === null ? 'HOLD' : capacityBeforeCommitments === 0 ? 'BLOCK' : 'REOPEN';
  const evidence = {
    desired,
    candidate: desired === 'BLOCK' ? 'ZERO_SUPPLIER_AVAILABLE' :
      desired === 'REOPEN' ? 'QUANTITY_REQUIRES_COMMITMENT_MODEL' : 'NO_CHANGE',
    shopifyAvailableForSale: typeof variant.availableForSale === 'boolean' ? variant.availableForSale : null,
    sellableOnlineQuantity: Number.isSafeInteger(variant.sellableOnlineQuantity) ? variant.sellableOnlineQuantity : null,
    supplierAvailable: null, supplierCommitted: null, otherLocationAvailable: null, blockers: []
  };
  if (!supplierLocation || supplierLocation.id !== supplierLocationId)
    evidence.blockers.push('SUPPLIER_LOCATION_ONLINE_UNVERIFIED');
  else if (!supplierLocation.isActive || !supplierLocation.fulfillsOnlineOrders)
    evidence.blockers.push('SUPPLIER_LOCATION_NOT_ONLINE');
  if (!levels || !Array.isArray(levels.nodes) || levels.pageInfo?.hasNextPage !== false)
    evidence.blockers.push('SHOPIFY_LEVELS_UNVERIFIED');
  else {
    const ids = levels.nodes.map(level => level?.location?.id);
    if (ids.some(id => !id) || new Set(ids).size !== ids.length ||
      levels.nodes.some(level => typeof level.isActive !== 'boolean'))
      evidence.blockers.push('SHOPIFY_LEVELS_UNVERIFIED');
    else {
      const supplierLevel = levels.nodes.find(level => level.location.id === supplierLocationId);
      if (!supplierLevel?.isActive) evidence.blockers.push('SUPPLIER_LEVEL_INACTIVE');
      else {
        evidence.supplierAvailable = quantity(supplierLevel, 'available');
        evidence.supplierCommitted = quantity(supplierLevel, 'committed');
        if (evidence.supplierAvailable === null) evidence.blockers.push('SUPPLIER_AVAILABLE_UNVERIFIED');
      }
      const otherLocations = levels.nodes.filter(level => level.isActive && level.location.id !== supplierLocationId);
      if (otherLocations.some(level => quantity(level, 'available') === null)) evidence.blockers.push('OTHER_LOCATION_STOCK_UNKNOWN');
      else {
        const total = otherLocations.reduce((sum, level) => sum + Math.max(0, quantity(level, 'available')), 0);
        if (Number.isSafeInteger(total)) evidence.otherLocationAvailable = total;
        else evidence.blockers.push('OTHER_LOCATION_STOCK_UNKNOWN');
      }
      if (evidence.otherLocationAvailable > 0 && evidence.desired === 'BLOCK') evidence.blockers.push('OTHER_LOCATION_STOCK_MAY_SELL');
    }
  }
  if (evidence.shopifyAvailableForSale === null || evidence.sellableOnlineQuantity === null)
    evidence.blockers.push('SHOPIFY_AVAILABILITY_UNVERIFIED');
  if (evidence.desired === 'REOPEN') evidence.blockers.push('COMMITMENT_MODEL_REQUIRED_FOR_REOPEN');
  return evidence;
}
export function makePlan({ variants, inventory, observedAt, warehouses, safetyBuffer, supplierLocationId, supplierLocation = null, protectedLocationIds, now = Date.now() }) {
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
    const supplierStockStatus = supplierAvailable === null ? 'UNKNOWN' : supplierAvailable === 0 ? 'OUT_OF_STOCK' : 'IN_STOCK';
    const capacityBeforeCommitments = supplierAvailable === null ? null : Math.max(0, supplierAvailable - safetyBuffer);
    const gate = gateEvidence(v, capacityBeforeCommitments, supplierLocationId, supplierLocation);
    return {
      variantId: v.id, inventoryItemId: v.inventoryItem?.id ?? null, sku: v.sku,
      supplierLocationId: supplierLocationId || null, supplierAvailable,
      supplierStockStatus, gate,
      capacityBeforeCommitments,
      proposedQuantity: null, writeReady: false, blockers: [...blockers, ...gate.blockers]
    };
  });
  return { mode: 'dry-run', observedAt, generatedAt: new Date(now).toISOString(), writes: 0, rows };
}
