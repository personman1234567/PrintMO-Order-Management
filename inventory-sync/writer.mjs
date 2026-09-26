import { SyncError, requireValue, uniqueStrings, warehouseList, makePlan } from './core.mjs';
import { requestJson, shopDomain, shopifyRead, shopifyToken, readPilot, readSupplierGateway } from './clients.mjs';

const PRINTMO_SHOP = '429cc0-3.myshopify.com';
const SS_SUPPLIER_LOCATION = 'gid://shopify/Location/95240290552';

// A single, hard-coded mutation is the only write surface in the inventory Worker.
// Shopify's available quantity is compare-and-set so an order placed after our read
// makes the write fail instead of restoring stock already committed to that order.
export const SET_SUPPLIER_AVAILABLE = `mutation SetSupplierAvailable($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
  inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
    inventoryAdjustmentGroup { id }
    userErrors { code }
  }
}`;
export const WRITE_PREREQUISITES_QUERY = `query InventoryWritePrerequisites($locationId: ID!, $skuQuery: String!) {
  currentAppInstallation { accessScopes { handle } }
  location(id: $locationId) { id isActive fulfillsOnlineOrders }
  productVariants(first: 2, query: $skuQuery) {
    nodes { id sku }
    pageInfo { hasNextPage }
  }
}`;

function jsonSetting(env, key) {
  try { return JSON.parse(env[key] || '[]'); } catch { throw new SyncError(`INVALID_${key}`); }
}
function quantity(level, name) {
  const matches = level?.quantities?.filter(value => value.name === name);
  return matches?.length === 1 && Number.isSafeInteger(matches[0].quantity) ? matches[0].quantity : null;
}
async function readWritePrerequisites(env, token, variant, supplierLocationId, deps) {
  const data = await shopifyRead(env, token, WRITE_PREREQUISITES_QUERY,
    { locationId: supplierLocationId, skuQuery: `sku:${variant.sku}` }, deps);
  requireValue(data.currentAppInstallation?.accessScopes?.some(scope => scope.handle === 'write_inventory'), 'INVENTORY_WRITE_SCOPE_MISSING');
  requireValue(data.location?.id === supplierLocationId && data.location.isActive && data.location.fulfillsOnlineOrders,
    'SUPPLIER_LOCATION_NOT_ONLINE');
  const matches = data.productVariants;
  requireValue(matches?.pageInfo?.hasNextPage === false && Array.isArray(matches.nodes)
    && matches.nodes.filter(node => node.sku === variant.sku).length === 1
    && matches.nodes.find(node => node.sku === variant.sku)?.id === variant.id, 'SHARED_SUPPLIER_SKU');
  return data.location;
}

export async function setSupplierAvailable(env, token, { inventoryItemId, supplierLocationId, currentAvailable,
  targetAvailable, observedAt }, deps) {
  requireValue(['pilot-write', 'pilot-refresh'].includes(env.INVENTORY_SYNC_MODE), 'WRITE_MODE_REQUIRED');
  requireValue(shopDomain(env) === PRINTMO_SHOP && supplierLocationId === SS_SUPPLIER_LOCATION,
    'INVALID_WRITE_DESTINATION');
  const protectedLocationIds = jsonSetting(env, 'PROTECTED_LOCATION_IDS');
  requireValue(Array.isArray(protectedLocationIds) && protectedLocationIds.length > 0
    && protectedLocationIds.every(id => /^gid:\/\/shopify\/Location\/\d+$/.test(id))
    && !protectedLocationIds.includes(supplierLocationId), 'INVALID_OR_PROTECTED_LOCATION');
  requireValue(/^gid:\/\/shopify\/InventoryItem\/\d+$/.test(inventoryItemId)
    && /^gid:\/\/shopify\/Location\/\d+$/.test(supplierLocationId)
    && supplierLocationId === env.SUPPLIER_LOCATION_ID, 'INVALID_WRITE_DESTINATION');
  requireValue(Number.isSafeInteger(currentAvailable) && currentAvailable >= 0
    && Number.isSafeInteger(targetAvailable) && targetAvailable >= 0 && targetAvailable !== currentAvailable,
  'INVALID_WRITE_QUANTITY');
  if (env.INVENTORY_SYNC_MODE === 'pilot-refresh')
    requireValue(targetAvailable < currentAvailable, 'REFRESH_CANNOT_INCREASE_STOCK');
  const age = Date.now() - Date.parse(observedAt);
  requireValue(Number.isFinite(age) && age >= -30000 && age <= 300000, 'INVALID_WRITE_OBSERVATION');
  const idempotencyKey = crypto.randomUUID();
  const input = {
    name: 'available', reason: 'correction',
    referenceDocumentUri: `printmo://supplier-inventory/ss/${encodeURIComponent(observedAt)}`,
    quantities: [{ inventoryItemId, locationId: supplierLocationId, quantity: targetAvailable,
      changeFromQuantity: currentAvailable }]
  };
  const result = await requestJson(`https://${shopDomain(env)}/admin/api/2026-07/graphql.json`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query: SET_SUPPLIER_AVAILABLE, variables: { input, idempotencyKey } })
  }, deps);
  if (result?.errors?.length) throw new SyncError('SHOPIFY_WRITE_FAILED');
  const payload = result?.data?.inventorySetQuantities;
  if (payload?.userErrors?.length) throw new SyncError(
    payload.userErrors.some(error => error.code === 'CHANGE_FROM_QUANTITY_STALE')
      ? 'SHOPIFY_QUANTITY_CHANGED' : 'SHOPIFY_WRITE_REJECTED');
  requireValue(payload?.inventoryAdjustmentGroup?.id, 'SHOPIFY_WRITE_UNCONFIRMED');
  return { writes: 1, inventoryItemId, supplierLocationId, targetAvailable };
}

// The one-off seed requires zero Shopify commitments. Repeat refreshes may only
// lower Shopify's available quantity: a customer order must never be restored
// from an S&S snapshot that has not yet reflected our supplier purchase.
// Production keeps the downward-only refresh scope explicitly allowlisted.
export async function runGuardedWrite(env, deps) {
  const mode = env.INVENTORY_SYNC_MODE;
  requireValue(['pilot-write', 'pilot-refresh'].includes(mode), 'WRITE_MODE_REQUIRED');
  requireValue(shopDomain(env) === PRINTMO_SHOP && env.SUPPLIER_LOCATION_ID === SS_SUPPLIER_LOCATION,
    'INVALID_WRITE_DESTINATION');
  requireValue(env.SUPPLIER_FEED_SEMANTICS === (mode === 'pilot-refresh'
    ? 'ss-available-for-sale-downward-only' : 'ss-available-for-sale-zero-commitments'),
  'SUPPLIER_FEED_SEMANTICS_UNVERIFIED');
  const maxDelta = Number(env.INVENTORY_MAX_WRITE_DELTA);
  requireValue(/^\d+$/.test(String(env.INVENTORY_MAX_WRITE_DELTA || ''))
    && Number.isSafeInteger(maxDelta) && maxDelta > 0, 'WRITE_LIMIT_UNCONFIGURED');
  const ids = uniqueStrings(jsonSetting(env, 'PILOT_VARIANT_IDS'), /^gid:\/\/shopify\/ProductVariant\/\d+$/,
    mode === 'pilot-refresh' ? 6 : 1, 'PILOT_VARIANT_SCOPE_INVALID');
  if (mode === 'pilot-refresh' && ids.length > 1) {
    let writes = 0;
    let unchanged = 0;
    let failures = 0;
    for (const id of ids) {
      try {
        const result = await runGuardedWrite({ ...env, PILOT_VARIANT_IDS: JSON.stringify([id]) }, deps);
        writes += result.writes;
        unchanged += result.unchanged || 0;
      } catch (error) {
        failures++;
        console.error(JSON.stringify({ event: 'inventory-variant-failed', variantId: id,
          code: error instanceof SyncError ? error.code : 'INVENTORY_VARIANT_FAILED' }));
      }
    }
    if (failures) throw new SyncError('PILOT_BATCH_PARTIAL_FAILURE');
    return { mode, writes, unchanged, variants: ids.length };
  }
  const warehouses = warehouseList(jsonSetting(env, 'SS_WAREHOUSES'));
  const protectedLocationIds = jsonSetting(env, 'PROTECTED_LOCATION_IDS');
  requireValue(Array.isArray(protectedLocationIds) && protectedLocationIds.length > 0
    && protectedLocationIds.every(id => /^gid:\/\/shopify\/Location\/\d+$/.test(id)), 'PROTECTED_LOCATIONS_REQUIRED');
  const supplierLocationId = env.SUPPLIER_LOCATION_ID;
  requireValue(/^gid:\/\/shopify\/Location\/\d+$/.test(supplierLocationId)
    && !protectedLocationIds.includes(supplierLocationId), 'INVALID_OR_PROTECTED_LOCATION');
  requireValue(/^\d+$/.test(String(env.SS_SAFETY_BUFFER || ''))
    && Number.isSafeInteger(Number(env.SS_SAFETY_BUFFER)), 'INVALID_BUFFER');
  const token = await shopifyToken(env, deps);
  const [variant] = await readPilot(env, token, ids, deps);
  requireValue(/^[A-Za-z0-9_-]{1,64}$/.test(variant.sku), 'INVALID_SKU');
  const location = await readWritePrerequisites(env, token, variant, supplierLocationId, deps);
  const supplier = await readSupplierGateway(env, [variant.sku], deps);
  const plan = makePlan({ variants: [variant], inventory: supplier.items, observedAt: supplier.observedAt,
    warehouses, safetyBuffer: Number(env.SS_SAFETY_BUFFER), supplierLocationId,
    supplierLocation: location, protectedLocationIds });
  const [row] = plan.rows;
  const resolvedByPilot = new Set(['PENDING_COMMITMENTS_UNVERIFIED', 'CATALOG_SHARED_SKUS_UNVERIFIED',
    'COMMITMENT_MODEL_REQUIRED_FOR_REOPEN']);
  requireValue(row.blockers.every(blocker => resolvedByPilot.has(blocker)) && row.capacityBeforeCommitments !== null
    && row.gate.otherLocationAvailable === 0, 'WRITE_GUARD_BLOCKED');
  const level = variant.inventoryItem.inventoryLevels.nodes.find(node => node.location.id === supplierLocationId);
  const available = quantity(level, 'available');
  const committed = quantity(level, 'committed');
  const onHand = quantity(level, 'on_hand');
  // Reject missing or unexplained Shopify inventory states at the supplier level.
  requireValue(available !== null && available >= 0 && committed !== null && committed >= 0
    && onHand === available + committed, 'INVENTORY_STATES_UNVERIFIED');
  if (mode === 'pilot-write') {
    requireValue(variant.inventoryItem.inventoryLevels.nodes.every(other => quantity(other, 'committed') === 0),
      'SHOPIFY_COMMITMENTS_PRESENT');
  }
  // Do not subtract commitments from the S&S number. S&S may already have
  // deducted our purchase; subtracting again would count it twice.
  const targetAvailable = mode === 'pilot-refresh'
    ? Math.min(available, row.capacityBeforeCommitments) : row.capacityBeforeCommitments;
  // A confirmed physical-warehouse stockout must be able to close checkout even
  // when the prior supplier quantity is larger than the ordinary change limit.
  // A buffer-only zero or a partial supplier decrease still obeys that limit.
  const confirmedStockout = mode === 'pilot-refresh' && row.supplierAvailable === 0
    && targetAvailable === 0;
  requireValue(Number.isSafeInteger(targetAvailable)
    && (Math.abs(targetAvailable - available) <= maxDelta || confirmedStockout),
  'WRITE_DELTA_EXCEEDS_LIMIT');
  if (targetAvailable === available) return { mode, writes: 0, unchanged: 1 };
  const written = await setSupplierAvailable(env, token, { inventoryItemId: row.inventoryItemId,
    supplierLocationId, currentAvailable: available, targetAvailable, observedAt: plan.observedAt }, deps);
  return { mode, ...written };
}
