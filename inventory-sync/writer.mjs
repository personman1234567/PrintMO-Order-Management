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

async function readBatchPrerequisites(env, token, variants, supplierLocationId, deps) {
  const variables = { locationId: supplierLocationId };
  const searches = variants.map((variant, index) => {
    variables[`sku${index}`] = `sku:${variant.sku}`;
    return `sku${index}: productVariants(first: 2, query: $sku${index}) {
      nodes { id sku } pageInfo { hasNextPage }
    }`;
  });
  const declarations = variants.map((_, index) => `$sku${index}: String!`).join(', ');
  const query = `query InventoryBatchPrerequisites($locationId: ID!, ${declarations}) {
    currentAppInstallation { accessScopes { handle } }
    location(id: $locationId) { id isActive fulfillsOnlineOrders }
    ${searches.join('\n')}
  }`;
  const data = await shopifyRead(env, token, query, variables, deps);
  requireValue(data.currentAppInstallation?.accessScopes?.some(scope => scope.handle === 'write_inventory'),
    'INVENTORY_WRITE_SCOPE_MISSING');
  requireValue(data.location?.id === supplierLocationId && data.location.isActive && data.location.fulfillsOnlineOrders,
    'SUPPLIER_LOCATION_NOT_ONLINE');
  const matches = variants.map((variant, index) => {
    const result = data[`sku${index}`];
    return result?.pageInfo?.hasNextPage === false && Array.isArray(result.nodes)
      && result.nodes.filter(node => node.sku === variant.sku).length === 1
      && result.nodes.find(node => node.sku === variant.sku)?.id === variant.id;
  });
  return { location: data.location, matches };
}

// The full five-minute catalog needs one Shopify read per batch. Expected SKU
// identities are pinned at enrollment and checked against live variants and a
// store-wide exact-SKU search in the same GraphQL request.
async function readScheduledBatch(env, token, entries, supplierLocationId, deps) {
  const variables = { ids: entries.map(entry => entry.id), locationId: supplierLocationId };
  const searches = entries.map((entry, index) => {
    variables[`sku${index}`] = `sku:${entry.sku}`;
    return `sku${index}: productVariants(first: 2, query: $sku${index}) {
      nodes { id sku } pageInfo { hasNextPage }
    }`;
  });
  const declarations = entries.map((_, index) => `$sku${index}: String!`).join(', ');
  const query = `query InventoryScheduledBatch($ids: [ID!]!, $locationId: ID!, ${declarations}) {
    nodes(ids: $ids) { ... on ProductVariant { id sku inventoryPolicy availableForSale sellableOnlineQuantity
      product { status } inventoryItem { id tracked inventoryLevels(first: 10, includeInactive: true) {
        nodes { isActive location { id } quantities(names: ["available", "committed", "on_hand"]) { name quantity } }
        pageInfo { hasNextPage }
      } } } }
    currentAppInstallation { accessScopes { handle } }
    location(id: $locationId) { id isActive fulfillsOnlineOrders }
    ${searches.join('\n')}
  }`;
  const data = await shopifyRead(env, token, query, variables, deps);
  requireValue(Array.isArray(data.nodes) && data.nodes.length === entries.length
    && data.nodes.every((variant, index) => variant?.id === entries[index].id
      && variant.sku === entries[index].sku && ['ACTIVE', 'UNLISTED'].includes(variant.product?.status)
      && variant.inventoryItem?.id), 'PILOT_VARIANT_MISSING_OR_INACTIVE');
  requireValue(data.currentAppInstallation?.accessScopes?.some(scope => scope.handle === 'write_inventory'),
    'INVENTORY_WRITE_SCOPE_MISSING');
  requireValue(data.location?.id === supplierLocationId && data.location.isActive && data.location.fulfillsOnlineOrders,
    'SUPPLIER_LOCATION_NOT_ONLINE');
  const matches = entries.map((entry, index) => {
    const result = data[`sku${index}`];
    return result?.pageInfo?.hasNextPage === false && Array.isArray(result.nodes)
      && result.nodes.filter(node => node.sku === entry.sku).length === 1
      && result.nodes.find(node => node.sku === entry.sku)?.id === entry.id;
  });
  return { variants: data.nodes, preflight: { location: data.location, matches } };
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

async function setSupplierAvailableBatch(env, token, updates, observedAt, deps) {
  requireValue(env.INVENTORY_SYNC_MODE === 'pilot-refresh' && updates.length > 0 && updates.length <= 16,
    'INVALID_BATCH_WRITE');
  const supplierLocationId = env.SUPPLIER_LOCATION_ID;
  requireValue(shopDomain(env) === PRINTMO_SHOP && supplierLocationId === SS_SUPPLIER_LOCATION,
    'INVALID_WRITE_DESTINATION');
  const age = Date.now() - Date.parse(observedAt);
  requireValue(Number.isFinite(age) && age >= -30000 && age <= 300000, 'INVALID_WRITE_OBSERVATION');
  requireValue(updates.every(update => /^gid:\/\/shopify\/InventoryItem\/\d+$/.test(update.inventoryItemId)
    && Number.isSafeInteger(update.currentAvailable) && update.currentAvailable >= 0
    && Number.isSafeInteger(update.targetAvailable) && update.targetAvailable >= 0
    && Number.isSafeInteger(update.sourceCapacity) && update.sourceCapacity >= 0
    && Number.isSafeInteger(update.shopifyCommitted) && update.shopifyCommitted >= 0
    && (update.targetAvailable < update.currentAvailable ||
      (env.SUPPLIER_REOPEN_POLICY === 'subtract-shopify-commitments'
        && update.targetAvailable > update.currentAvailable
        && update.targetAvailable <= Math.max(0, update.sourceCapacity - update.shopifyCommitted))))
    && new Set(updates.map(update => update.inventoryItemId)).size === updates.length, 'INVALID_BATCH_WRITE');
  const input = {
    name: 'available', reason: 'correction',
    referenceDocumentUri: `printmo://supplier-inventory/ss/${encodeURIComponent(observedAt)}`,
    quantities: updates.map(update => ({ inventoryItemId: update.inventoryItemId,
      locationId: supplierLocationId, quantity: update.targetAvailable,
      changeFromQuantity: update.currentAvailable }))
  };
  const result = await requestJson(`https://${shopDomain(env)}/admin/api/2026-07/graphql.json`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query: SET_SUPPLIER_AVAILABLE, variables: { input, idempotencyKey: crypto.randomUUID() } })
  }, deps);
  if (result?.errors?.length) throw new SyncError('SHOPIFY_WRITE_FAILED');
  const payload = result?.data?.inventorySetQuantities;
  if (payload?.userErrors?.length) throw new SyncError(
    payload.userErrors.some(error => error.code === 'CHANGE_FROM_QUANTITY_STALE')
      ? 'SHOPIFY_QUANTITY_CHANGED' : 'SHOPIFY_WRITE_REJECTED');
  requireValue(payload?.inventoryAdjustmentGroup?.id, 'SHOPIFY_WRITE_UNCONFIRMED');
  return updates.length;
}

// Large scheduled catalogs use one combined guarded Shopify read and one CAS
// mutation per at-most-15-variant batch, staying inside the Worker request budget.
// A stale CAS fails the batch; the next shard run rereads every quantity.
export async function runGuardedBatch(env, deps) {
  requireValue(env.INVENTORY_SYNC_MODE === 'pilot-refresh', 'WRITE_MODE_REQUIRED');
  requireValue(shopDomain(env) === PRINTMO_SHOP && env.SUPPLIER_LOCATION_ID === SS_SUPPLIER_LOCATION,
    'INVALID_WRITE_DESTINATION');
  requireValue(env.SUPPLIER_FEED_SEMANTICS === 'ss-available-for-sale-downward-only',
    'SUPPLIER_FEED_SEMANTICS_UNVERIFIED');
  requireValue(['disabled', 'subtract-shopify-commitments'].includes(env.SUPPLIER_REOPEN_POLICY || 'disabled'),
    'INVALID_REOPEN_POLICY');
  const protectedLocationIds = jsonSetting(env, 'PROTECTED_LOCATION_IDS');
  requireValue(Array.isArray(protectedLocationIds) && protectedLocationIds.length > 0
    && protectedLocationIds.every(id => /^gid:\/\/shopify\/Location\/\d+$/.test(id))
    && !protectedLocationIds.includes(env.SUPPLIER_LOCATION_ID), 'PROTECTED_LOCATIONS_REQUIRED');
  const ids = uniqueStrings(jsonSetting(env, 'PILOT_VARIANT_IDS'), /^gid:\/\/shopify\/ProductVariant\/\d+$/,
    16, 'PILOT_VARIANT_SCOPE_INVALID');
  const token = await shopifyToken(env, deps);
  const scheduledSkus = env.PILOT_VARIANT_SKUS ? jsonSetting(env, 'PILOT_VARIANT_SKUS') : null;
  requireValue(scheduledSkus === null || Array.isArray(scheduledSkus)
    && scheduledSkus.length === ids.length && scheduledSkus.every(sku => /^[A-Za-z0-9_-]{1,64}$/.test(sku))
    && new Set(scheduledSkus).size === scheduledSkus.length, 'INVALID_SCHEDULED_SKUS');
  const missingPolicies = env.PILOT_MISSING_SKU_POLICIES ? jsonSetting(env, 'PILOT_MISSING_SKU_POLICIES') : null;
  requireValue(missingPolicies === null || Array.isArray(missingPolicies)
    && missingPolicies.length === ids.length && missingPolicies.every(policy => ['hold', 'block'].includes(policy)),
  'INVALID_MISSING_SKU_POLICIES');
  const scheduled = scheduledSkus === null ? null : await readScheduledBatch(env, token,
    ids.map((id, index) => ({ id, sku: scheduledSkus[index] })), env.SUPPLIER_LOCATION_ID, deps);
  const variants = scheduled?.variants || await readPilot(env, token, ids, deps);
  requireValue(variants.every(v => /^[A-Za-z0-9_-]{1,64}$/.test(v.sku))
    && new Set(variants.map(v => v.sku)).size === variants.length, 'INVALID_OR_SHARED_SKU');
  const supplier = await readSupplierGateway(env, variants.map(v => v.sku), deps);
  const preflight = scheduled?.preflight || await readBatchPrerequisites(env, token, variants, env.SUPPLIER_LOCATION_ID, deps);
  const updates = [];
  let failures = 0;
  for (const [index, variant] of variants.entries()) {
    try {
      requireValue(preflight.matches[index], 'SHARED_SUPPLIER_SKU');
      const missingSupplierSku = !supplier.items.some(item => item.sku === variant.sku);
      const plan = makePlan({ variants: [variant], inventory: supplier.items.filter(item => item.sku === variant.sku),
        observedAt: supplier.observedAt, warehouses: warehouseList(jsonSetting(env, 'SS_WAREHOUSES')),
        safetyBuffer: Number(env.SS_SAFETY_BUFFER), supplierLocationId: env.SUPPLIER_LOCATION_ID,
        supplierLocation: preflight.location, protectedLocationIds });
      const [row] = plan.rows;
      const resolvedByPilot = new Set(['PENDING_COMMITMENTS_UNVERIFIED', 'CATALOG_SHARED_SKUS_UNVERIFIED',
        'COMMITMENT_MODEL_REQUIRED_FOR_REOPEN']);
      const missingPolicy = missingPolicies?.[index] || env.SUPPLIER_MISSING_SKU_POLICY;
      if (missingSupplierSku && missingPolicy === 'block')
        resolvedByPilot.add('SUPPLIER_SKU_MISSING');
      requireValue(row.blockers.every(blocker => resolvedByPilot.has(blocker))
        && (row.capacityBeforeCommitments !== null || missingSupplierSku && missingPolicy === 'block')
        && row.gate.otherLocationAvailable === 0, 'WRITE_GUARD_BLOCKED');
      const level = variant.inventoryItem.inventoryLevels.nodes.find(node => node.location.id === env.SUPPLIER_LOCATION_ID);
      const available = quantity(level, 'available');
      const committed = quantity(level, 'committed');
      const onHand = quantity(level, 'on_hand');
      requireValue(available !== null && available >= 0 && committed !== null && committed >= 0
        && onHand === available + committed, 'INVENTORY_STATES_UNVERIFIED');
      const commitments = variant.inventoryItem.inventoryLevels.nodes.map(node => quantity(node, 'committed'));
      const shopifyCommitted = commitments.reduce((total, amount) => total + amount, 0);
      requireValue(commitments.every(amount => amount !== null && amount >= 0)
        && Number.isSafeInteger(shopifyCommitted), 'SHOPIFY_COMMITMENTS_UNVERIFIED');
      // A successful gateway response that omits a SKU can block that SKU in the
      // closeout catalog. A failed gateway response never reaches this branch.
      const sourceCapacity = missingSupplierSku ? 0 : row.capacityBeforeCommitments;
      // Shopify has already removed committed units from its available count.
      // S&S may or may not have removed Print-MO's purchase yet, so subtracting
      // every Shopify commitment only for an increase is a conservative ceiling.
      const reopenCapacity = Math.max(0, sourceCapacity - shopifyCommitted);
      const targetAvailable = sourceCapacity < available ? sourceCapacity
        : env.SUPPLIER_REOPEN_POLICY === 'subtract-shopify-commitments'
          ? Math.max(available, reopenCapacity) : available;
      if (targetAvailable !== available) updates.push({ inventoryItemId: row.inventoryItemId,
        currentAvailable: available, targetAvailable, sourceCapacity, shopifyCommitted });
    } catch (error) {
      failures++;
      console.error(JSON.stringify({ event: 'inventory-variant-failed', variantId: variant.id,
        code: error instanceof SyncError ? error.code : 'INVENTORY_VARIANT_FAILED' }));
    }
  }
  const writes = updates.length ? await setSupplierAvailableBatch(env, token, updates, supplier.observedAt, deps) : 0;
  if (failures) throw new SyncError('PILOT_BATCH_PARTIAL_FAILURE');
  return { mode: 'pilot-refresh', writes,
    increases: updates.filter(update => update.targetAvailable > update.currentAvailable).length,
    unchanged: ids.length - writes, variants: ids.length };
}

// The one-off seed requires zero Shopify commitments. Legacy pilot-refresh stays
// downward-only; the scheduled batch can permit a bounded conservative reopen
// when SUPPLIER_REOPEN_POLICY is explicitly enabled for enrolled variants.
export async function runGuardedWrite(env, deps) {
  const mode = env.INVENTORY_SYNC_MODE;
  requireValue(['pilot-write', 'pilot-refresh'].includes(mode), 'WRITE_MODE_REQUIRED');
  requireValue(shopDomain(env) === PRINTMO_SHOP && env.SUPPLIER_LOCATION_ID === SS_SUPPLIER_LOCATION,
    'INVALID_WRITE_DESTINATION');
  requireValue(env.SUPPLIER_FEED_SEMANTICS === (mode === 'pilot-refresh'
    ? 'ss-available-for-sale-downward-only' : 'ss-available-for-sale-zero-commitments'),
  'SUPPLIER_FEED_SEMANTICS_UNVERIFIED');
  const protectedLocationIds = jsonSetting(env, 'PROTECTED_LOCATION_IDS');
  requireValue(Array.isArray(protectedLocationIds) && protectedLocationIds.length > 0
    && protectedLocationIds.every(id => /^gid:\/\/shopify\/Location\/\d+$/.test(id))
    && !protectedLocationIds.includes(env.SUPPLIER_LOCATION_ID), 'PROTECTED_LOCATIONS_REQUIRED');
  const ids = uniqueStrings(jsonSetting(env, 'PILOT_VARIANT_IDS'), /^gid:\/\/shopify\/ProductVariant\/\d+$/,
    mode === 'pilot-refresh' ? 15 : 1, 'PILOT_VARIANT_SCOPE_INVALID');
  if (mode === 'pilot-refresh' && ids.length > 6) {
    // One Shopify catalog read and one supplier gateway read per minute-sized shard.
    // Individual guards and compare-and-set writes remain independent.
    const token = await shopifyToken(env, deps);
    const variants = await readPilot(env, token, ids, deps);
    requireValue(variants.every(v => /^[A-Za-z0-9_-]{1,64}$/.test(v.sku))
      && new Set(variants.map(v => v.sku)).size === variants.length, 'INVALID_OR_SHARED_SKU');
    const supplier = await readSupplierGateway(env, variants.map(v => v.sku), deps);
    let writes = 0;
    let unchanged = 0;
    let failures = 0;
    for (const variant of variants) {
      try {
        const result = await runOneGuardedWrite(env, deps, token, variant, supplier);
        writes += result.writes;
        unchanged += result.unchanged || 0;
      } catch (error) {
        failures++;
        console.error(JSON.stringify({ event: 'inventory-variant-failed', variantId: variant.id,
          code: error instanceof SyncError ? error.code : 'INVENTORY_VARIANT_FAILED' }));
      }
    }
    if (failures) throw new SyncError('PILOT_BATCH_PARTIAL_FAILURE');
    return { mode, writes, unchanged, variants: ids.length };
  }
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
  const token = await shopifyToken(env, deps);
  const [variant] = await readPilot(env, token, ids, deps);
  requireValue(/^[A-Za-z0-9_-]{1,64}$/.test(variant.sku), 'INVALID_SKU');
  const supplier = await readSupplierGateway(env, [variant.sku], deps);
  return runOneGuardedWrite(env, deps, token, variant, supplier);
}

async function runOneGuardedWrite(env, deps, token, variant, supplier) {
  const mode = env.INVENTORY_SYNC_MODE;
  const warehouses = warehouseList(jsonSetting(env, 'SS_WAREHOUSES'));
  const protectedLocationIds = jsonSetting(env, 'PROTECTED_LOCATION_IDS');
  requireValue(Array.isArray(protectedLocationIds) && protectedLocationIds.length > 0
    && protectedLocationIds.every(id => /^gid:\/\/shopify\/Location\/\d+$/.test(id)), 'PROTECTED_LOCATIONS_REQUIRED');
  const supplierLocationId = env.SUPPLIER_LOCATION_ID;
  requireValue(/^gid:\/\/shopify\/Location\/\d+$/.test(supplierLocationId)
    && !protectedLocationIds.includes(supplierLocationId), 'INVALID_OR_PROTECTED_LOCATION');
  requireValue(/^\d+$/.test(String(env.SS_SAFETY_BUFFER || ''))
    && Number.isSafeInteger(Number(env.SS_SAFETY_BUFFER)), 'INVALID_BUFFER');
  const location = await readWritePrerequisites(env, token, variant, supplierLocationId, deps);
  const plan = makePlan({ variants: [variant], inventory: supplier.items.filter(item => item.sku === variant.sku), observedAt: supplier.observedAt,
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
  requireValue(Number.isSafeInteger(targetAvailable) && targetAvailable >= 0,
    'INVALID_WRITE_QUANTITY');
  if (targetAvailable === available) return { mode, writes: 0, unchanged: 1 };
  const written = await setSupplierAvailable(env, token, { inventoryItemId: row.inventoryItemId,
    supplierLocationId, currentAvailable: available, targetAvailable, observedAt: plan.observedAt }, deps);
  return { mode, ...written };
}
