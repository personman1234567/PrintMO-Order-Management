import test from 'node:test';
import assert from 'node:assert/strict';
import { makePlan, normalizeInventory } from './core.mjs';
import { requestJson, shopifyRead } from './clients.mjs';
import worker, { runDryRun, runInventorySync } from './worker.mjs';
import { runGuardedWrite, setSupplierAvailable } from './writer.mjs';
import { gatewayInventoryHandler } from './gateway-handler.mjs';
import { audit } from './cli.mjs';
const now = Date.now();
const id = 'gid://shopify/ProductVariant/1';
const itemId = 'gid://shopify/InventoryItem/1';
const localId = 'gid://shopify/Location/1';
const supplierId = 'gid://shopify/Location/95240290552';
const variant = { id, sku: 'B00760004', product: { status: 'ACTIVE' }, inventoryPolicy: 'DENY',
  availableForSale: true, sellableOnlineQuantity: 8,
  inventoryItem: { id: itemId, tracked: true, inventoryLevels: { pageInfo: { hasNextPage: false }, nodes: [
    { isActive: true, location: { id: localId, fulfillsOnlineOrders: true }, quantities: [{ name: 'available', quantity: 0 }] },
    { isActive: true, location: { id: supplierId, fulfillsOnlineOrders: true }, quantities: [
      { name: 'available', quantity: 8 }, { name: 'committed', quantity: 0 }] },
  ] } } };
const inventory = [{ sku: variant.sku, warehouses: [{ warehouseAbbr: 'IL', qty: 8, dropship: false }, { warehouseAbbr: 'KS', qty: 0, dropship: false }] }];
const base = { variants: [variant], inventory, observedAt: new Date(now).toISOString(), warehouses: ['IL', 'KS'], safetyBuffer: 2,
  supplierLocationId: supplierId, supplierLocation: { id: supplierId, isActive: true, fulfillsOnlineOrders: true }, protectedLocationIds: [localId], now };
const env = { INVENTORY_SYNC_MODE: 'dry-run', PILOT_VARIANT_IDS: JSON.stringify([id]), SS_WAREHOUSES: '["IL","KS"]',
  PROTECTED_LOCATION_IDS: JSON.stringify([localId]), SS_SAFETY_BUFFER: '2', SUPPLIER_LOCATION_ID: supplierId,
  SHOPIFY_SHOP_DOMAIN: '429cc0-3.myshopify.com', SHOPIFY_ACCESS_TOKEN: 'shop-secret',
  SUPPLIER_INVENTORY_URL: 'https://gateway.example/order-manager/v1/supplier/ss/inventory', INVENTORY_READ_KEY: 'gateway-secret' };
const response = (body, status = 200, headers) => Response.json(body, { status, headers });

test('uses only selected warehouses and keeps commitments unknown, never proposes writes', () => {
  const result = makePlan(base);
  assert.equal(result.rows[0].supplierAvailable, 8);
  assert.equal(result.rows[0].capacityBeforeCommitments, 6);
  assert.equal(result.rows[0].proposedQuantity, null);
  assert.equal(result.rows[0].writeReady, false);
  assert.equal(result.writes, 0);
  assert.ok(result.rows[0].blockers.includes('PENDING_COMMITMENTS_UNVERIFIED'));
});
test('confirmed zero remains zero; missing SKU and warehouse remain unknown', () => {
  assert.equal(makePlan({ ...base, inventory: [{ sku: variant.sku, warehouses: [{ warehouseAbbr: 'IL', qty: 0, dropship: false }, { warehouseAbbr: 'KS', qty: 0, dropship: false }] }] }).rows[0].supplierAvailable, 0);
  assert.equal(makePlan({ ...base, inventory: [] }).rows[0].supplierAvailable, null);
  assert.equal(makePlan({ ...base, warehouses: ['TX'] }).rows[0].supplierAvailable, null);
});
test('stockout gate identifies a zero-at-supplier candidate but never marks a write ready', () => {
  const row = makePlan({ ...base, inventory: [{ sku: variant.sku, warehouses: [
    { warehouseAbbr: 'IL', qty: 0, dropship: false }, { warehouseAbbr: 'KS', qty: 0, dropship: false }
  ] }] }).rows[0];
  assert.equal(row.gate.desired, 'BLOCK');
  assert.equal(row.gate.candidate, 'ZERO_SUPPLIER_AVAILABLE');
  assert.equal(row.gate.otherLocationAvailable, 0);
  assert.equal(row.gate.shopifyAvailableForSale, true);
  assert.equal(row.writeReady, false);
  assert.equal(row.proposedQuantity, null);
});
test('other location stock can defeat a supplier-only stockout; incomplete levels cannot certify one', () => {
  const zero = [{ sku: variant.sku, warehouses: [
    { warehouseAbbr: 'IL', qty: 0, dropship: false }, { warehouseAbbr: 'KS', qty: 0, dropship: false }
  ] }];
  const withHQ = structuredClone(variant);
  withHQ.inventoryItem.inventoryLevels.nodes[0].quantities[0].quantity = 2;
  const row = makePlan({ ...base, variants: [withHQ], inventory: zero }).rows[0];
  assert.equal(row.gate.otherLocationAvailable, 2);
  assert.ok(row.blockers.includes('OTHER_LOCATION_STOCK_MAY_SELL'));
  const incomplete = structuredClone(variant);
  incomplete.inventoryItem.inventoryLevels.pageInfo.hasNextPage = true;
  assert.ok(makePlan({ ...base, variants: [incomplete], inventory: zero }).rows[0].blockers.includes('SHOPIFY_LEVELS_UNVERIFIED'));
});
test('restock is not converted into a sellable quantity without commitment accounting', () => {
  const row = makePlan(base).rows[0];
  assert.equal(row.gate.desired, 'REOPEN');
  assert.equal(row.gate.candidate, 'QUANTITY_REQUIRES_COMMITMENT_MODEL');
  assert.ok(row.blockers.includes('COMMITMENT_MODEL_REQUIRED_FOR_REOPEN'));
  assert.equal(row.proposedQuantity, null);
});
test('offline supplier location and an untracked variant cannot pass the gate', () => {
  const untracked = structuredClone(variant);
  untracked.inventoryItem.tracked = false;
  const row = makePlan({ ...base, variants: [untracked], supplierLocation: { ...base.supplierLocation, fulfillsOnlineOrders: false } }).rows[0];
  assert.ok(row.blockers.includes('TRACKING_DISABLED'));
  assert.ok(row.blockers.includes('SUPPLIER_LOCATION_NOT_ONLINE'));
  assert.equal(row.writeReady, false);
});
test('never substitutes HQ for supplier location', () => {
  assert.throws(() => makePlan({ ...base, supplierLocationId: localId }), /PROTECTED_LOCATION/);
  const row = makePlan({ ...base, supplierLocationId: '' }).rows[0];
  assert.equal(row.supplierLocationId, null);
  assert.ok(row.blockers.includes('SUPPLIER_LOCATION_UNCONFIGURED'));
});
test('stale, invalid and future timestamps fail closed', () => {
  for (const observedAt of ['invalid', new Date(now - 300001).toISOString(), new Date(now + 30001).toISOString()]) {
    assert.throws(() => makePlan({ ...base, observedAt }), /STALE_SUPPLIER_SNAPSHOT/);
  }
});
test('malformed, negative, duplicate and unexpected supplier data fail closed', () => {
  for (const payload of [null, {}, [inventory[0], inventory[0]], [{...inventory[0],sku:'OTHER'}],
    [{sku:variant.sku, warehouses:[{warehouseAbbr:'IL',qty:-1,dropship:false}]}],
    [{sku:variant.sku, warehouses:[{warehouseAbbr:'IL',qty:'8',dropship:false}]}],
    [{sku:variant.sku, warehouses:[{warehouseAbbr:'IL',qty:8}]}],
    [{sku:variant.sku, warehouses:[inventory[0].warehouses[0],inventory[0].warehouses[0]]}]]) {
    assert.throws(() => normalizeInventory(payload, [variant.sku]), /INVALID_SUPPLIER_RESPONSE/);
  }
});
test('shared SKUs, untracked inventory and oversell policy are explicit blockers', () => {
  const rows = makePlan({...base, variants:[variant,{...variant,id:'gid://shopify/ProductVariant/2',inventoryPolicy:'CONTINUE',inventoryItem:{...variant.inventoryItem,tracked:false}}]}).rows;
  assert.ok(rows.every(r => r.blockers.includes('SHARED_SUPPLIER_SKU')));
  assert.ok(rows[1].blockers.includes('TRACKING_DISABLED'));
  assert.ok(rows[1].blockers.includes('OVERSELL_POLICY'));
});
test('disabled and invalid modes do not call networks', async () => {
  let calls=0;
  const deps={fetchImpl:async()=>{calls++;throw Error('unexpected');}};
  assert.equal((await runDryRun({},deps)).mode,'disabled');
  await assert.rejects(runDryRun({...env,INVENTORY_SYNC_MODE:'live'},deps), /LIVE_WRITES_NOT_IMPLEMENTED/);
  await assert.rejects(runDryRun({...env,PILOT_VARIANT_IDS:'[]'},deps), /INVALID_PILOT/);
  await assert.rejects(runDryRun({...env,SUPPLIER_LOCATION_ID:localId},deps), /INVALID_OR_PROTECTED_LOCATION/);
  assert.equal(calls,0);
});
test('dry-run end to end queries Shopify and GETs the gateway; no secrets in report', async () => {
  const calls=[];
  const result=await runDryRun(env,{fetchImpl:async(url,options)=>{
    calls.push({url,options});
    if(url.includes('myshopify')) {
      const query = JSON.parse(options.body).query;
      assert.equal(options.headers['X-Shopify-Access-Token'],'shop-secret');
      assert.match(query,/^query InventoryPilot/);
      return response({data:{nodes:[variant]}});
    }
    assert.equal(options.headers['X-Inventory-Read-Key'],'gateway-secret');
    assert.equal(options.redirect,'manual');
    assert.equal(new URL(url).searchParams.get('skus'),variant.sku);
    return response({observedAt:new Date().toISOString(),items:inventory});
  }});
  assert.equal(calls.length,2);
  assert.equal(result.writes,0);
  assert.doesNotMatch(JSON.stringify(result),/shop-secret|gateway-secret/);
});
test('GraphQL partial errors are rejected, and mutations cannot be sent', async () => {
  await assert.rejects(shopifyRead(env,'token','query { shop { name } }',{}, {fetchImpl:async()=>response({data:{shop:{}},errors:[{extensions:{code:'ACCESS_DENIED'}}]})}),/SHOPIFY_ACCESS_DENIED/);
  await assert.rejects(shopifyRead(env,'token','mutation { anything }'),/READ_ONLY_QUERY_REQUIRED/);
});
test('one bounded retry; long Retry-After and auth failures do not retry', async () => {
  let calls=0;
  await assert.rejects(requestJson('https://example.test',{}, {fetchImpl:async()=>{calls++;return response({},503);},sleep:async()=>{}}), /UPSTREAM_HTTP_503/);
  assert.equal(calls,2);
  calls=0;
  await assert.rejects(requestJson('https://example.test',{}, {fetchImpl:async()=>{calls++;return response({},429,{'Retry-After':'60'});}}), /UPSTREAM_RETRY_DEFERRED/);
  assert.equal(calls,1);
  await assert.rejects(requestJson('https://example.test',{}, {fetchImpl:async()=>response({},429,{'Retry-After':new Date(Date.now()+60000).toUTCString()})}), /UPSTREAM_RETRY_DEFERRED/);
  await assert.rejects(requestJson('https://example.test',{}, {fetchImpl:async()=>response({error:'secret'},401)}), /UPSTREAM_HTTP_401/);
  await assert.rejects(requestJson('https://example.test',{}, {fetchImpl:async(_url,options)=>{
    assert.equal(options.redirect,'manual');
    return new Response(null,{status:302,headers:{Location:'https://unexpected.example/'}});
  }}), /UPSTREAM_HTTP_302/);
});
test('all S&S warehouse mode excludes DS and dropship stock and reports three stock states', () => {
  const warehouses = ['*'];
  const withDropship = [{ sku: variant.sku, warehouses: [
    { warehouseAbbr: 'IL', qty: 4, dropship: false },
    { warehouseAbbr: 'DS', qty: 100, dropship: true },
    { warehouseAbbr: 'CC', qty: 200, dropship: true },
  ] }];
  const stocked = makePlan({ ...base, warehouses, inventory: withDropship }).rows[0];
  assert.equal(stocked.supplierAvailable, 4);
  assert.equal(stocked.supplierStockStatus, 'IN_STOCK');
  const zero = makePlan({ ...base, warehouses, inventory: [{ sku: variant.sku, warehouses: [
    { warehouseAbbr: 'DS', qty: 100, dropship: true },
  ] }] }).rows[0];
  assert.equal(zero.supplierAvailable, 0);
  assert.equal(zero.supplierStockStatus, 'OUT_OF_STOCK');
  const unknown = makePlan({ ...base, warehouses, inventory: [] }).rows[0];
  assert.equal(unknown.supplierAvailable, null);
  assert.equal(unknown.supplierStockStatus, 'UNKNOWN');
  assert.throws(() => makePlan({ ...base, warehouses: ['*', 'IL'] }), /INVALID_WAREHOUSES/);
});
test('gateway enforces auth and read method before upstream requests', async () => {
  let calls=0;
  const gatewayEnv={ORDER_MANAGER_ADMIN_KEY:'test',SS_ACCOUNT_NUMBER:'a',SS_API_KEY:'b'};
  const deps={fetchImpl:async url=>{calls++;return response(url.includes('/products/')
    ? [{sku:variant.sku,warehouses:inventory[0].warehouses.map(w=>({warehouseAbbr:w.warehouseAbbr,dropship:w.dropship}))}]
    : inventory.map(item=>({...item,warehouses:item.warehouses.map(({warehouseAbbr,qty})=>({warehouseAbbr,qty}))})));}};
  const url='https://gateway.example/order-manager/v1/supplier/ss/inventory?skus=B00760004';
  assert.equal((await gatewayInventoryHandler(new Request(url),gatewayEnv,deps)).status,401);
  assert.equal((await gatewayInventoryHandler(new Request(url,{method:'POST',headers:{'X-Order-Manager-Key':'test'}}),gatewayEnv,deps)).status,405);
  assert.equal(calls,0);
  const valid=await gatewayInventoryHandler(new Request(url,{headers:{'X-Order-Manager-Key':'test'}}),gatewayEnv,deps);
  assert.equal(valid.status,200);
  assert.equal(calls,2);
  assert.equal(valid.headers.get('Cache-Control'),'no-store');
  assert.deepEqual((await valid.json()).items,inventory);
});
test('gateway never converts upstream missing/error into stock zero or leaks payloads', async () => {
  const r=await gatewayInventoryHandler(new Request('https://gateway.example/order-manager/v1/supplier/ss/inventory?skus=B00760004',{headers:{'X-Order-Manager-Key':'test'}}),
    {ORDER_MANAGER_ADMIN_KEY:'test',SS_ACCOUNT_NUMBER:'a',SS_API_KEY:'b'}, {fetchImpl:async()=>response({error:'private'},404)});
  assert.equal(r.status,502);
  assert.deepEqual(await r.json(),{error:'UPSTREAM_HTTP_404'});
});
test('public Worker requests cannot trigger a run or read reports', async () => {
  assert.equal((await worker.fetch(new Request('https://example.test/run'),env)).status,404);
});
test('audit continues after a location scope failure', async () => {
  const report=await audit(env,{deps:{fetchImpl:async(_url,options)=>{
    const q=JSON.parse(options.body).query;
    if(q.includes('InventoryHealth')) return response({data:{shop:{name:'Example'},currentAppInstallation:{accessScopes:[{handle:'read_inventory'}]}}});
    if(q.includes('InventoryCatalogSample')) return response({data:{productVariants:{nodes:[variant],pageInfo:{hasNextPage:true}}}});
    return response({errors:[{extensions:{code:'ACCESS_DENIED'}}]});
  }}});
  assert.equal(report.checks.catalog.ok,true);
  assert.equal(report.checks.locations.code,'SHOPIFY_ACCESS_DENIED');
  assert.equal(report.checks.shopify.inventoryWriteGranted,false);
});

function pilotWriteFixture({ supplierQty = 8, available = 5, committed = 0, localAvailable = 0,
  localCommitted = 0,
  tracked = true, online = true, scopes = ['read_inventory', 'write_inventory'],
  skuMatches = [{ id, sku: variant.sku }], mutationResult = null } = {}) {
  const item = structuredClone(variant);
  item.inventoryItem.tracked = tracked;
  item.inventoryItem.inventoryLevels.nodes[0].quantities = [
    { name: 'available', quantity: localAvailable }, { name: 'committed', quantity: localCommitted },
    { name: 'on_hand', quantity: localAvailable + localCommitted }
  ];
  item.inventoryItem.inventoryLevels.nodes[1].quantities = [
    { name: 'available', quantity: available }, { name: 'committed', quantity: committed },
    { name: 'on_hand', quantity: available + committed }
  ];
  const calls = [];
  const deps = { fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.includes('myshopify')) {
      const { query } = JSON.parse(options.body);
      if (query.startsWith('query InventoryPilot')) return response({ data: { nodes: [item] } });
      if (query.startsWith('query InventoryWritePrerequisites')) return response({ data: {
        currentAppInstallation: { accessScopes: scopes.map(handle => ({ handle })) },
        location: { id: supplierId, isActive: true, fulfillsOnlineOrders: online },
        productVariants: { nodes: skuMatches, pageInfo: { hasNextPage: false } }
      } });
      if (query.startsWith('mutation SetSupplierAvailable')) return response(mutationResult || { data: {
        inventorySetQuantities: { inventoryAdjustmentGroup: { id: 'gid://shopify/InventoryAdjustmentGroup/1' }, userErrors: [] }
      } });
      throw Error('unexpected Shopify query');
    }
    return response({ observedAt: new Date().toISOString(), items: [{ sku: item.sku,
      warehouses: [{ warehouseAbbr: 'IL', qty: supplierQty, dropship: false },
        { warehouseAbbr: 'DS', qty: 900, dropship: true }] }] });
  } };
  const writeEnv = { ...env, INVENTORY_SYNC_MODE: 'pilot-write', SS_WAREHOUSES: '["*"]',
    SS_SAFETY_BUFFER: '0', SUPPLIER_FEED_SEMANTICS: 'ss-available-for-sale-zero-commitments',
    INVENTORY_MAX_WRITE_DELTA: '20' };
  return { calls, deps, writeEnv };
}

test('production-disabled writer makes no network requests even when write settings are present', async () => {
  const { deps, writeEnv } = pilotWriteFixture();
  let calls = 0;
  const disabled = { ...writeEnv, INVENTORY_SYNC_MODE: 'disabled' };
  assert.equal((await runInventorySync(disabled, { fetchImpl: async () => { calls++; return deps.fetchImpl(); } })).writes, 0);
  assert.equal(calls, 0);
  await assert.rejects(setSupplierAvailable(disabled, 'token', {
    inventoryItemId: itemId, supplierLocationId: supplierId, currentAvailable: 5,
    targetAvailable: 4, observedAt: new Date().toISOString()
  }), /WRITE_MODE_REQUIRED/);
});

test('guarded pilot mirrors S&S available stock with no Shopify commitments, using CAS and idempotency', async () => {
  const { calls, deps, writeEnv } = pilotWriteFixture();
  const result = await runGuardedWrite(writeEnv, deps);
  assert.equal(result.writes, 1);
  assert.equal(result.targetAvailable, 8); // S&S available=8; DS 900 is excluded.
  const writes = calls.filter(call => JSON.parse(call.options.body || '{}').query?.startsWith('mutation'));
  assert.equal(writes.length, 1);
  const { query, variables } = JSON.parse(writes[0].options.body);
  assert.match(query, /@idempotent\(key: \$idempotencyKey\)/);
  assert.match(variables.idempotencyKey, /^[0-9a-f-]{36}$/);
  assert.equal(variables.input.name, 'available');
  assert.deepEqual(variables.input.quantities, [{ inventoryItemId: itemId, locationId: supplierId,
    quantity: 8, changeFromQuantity: 5 }]);
  assert.doesNotMatch(JSON.stringify(result), /shop-secret|gateway-secret/);
});

test('unchanged pilot stock performs no mutation', async () => {
  const { calls, deps, writeEnv } = pilotWriteFixture({ available: 8 });
  const result = await runGuardedWrite(writeEnv, deps);
  assert.equal(result.writes, 0);
  assert.equal(calls.filter(call => JSON.parse(call.options.body || '{}').query?.startsWith('mutation')).length, 0);
});

test('stockout can target zero while dropship stock remains positive', async () => {
  const { calls, deps, writeEnv } = pilotWriteFixture({ supplierQty: 0, available: 5 });
  const result = await runGuardedWrite(writeEnv, deps);
  assert.equal(result.targetAvailable, 0);
  assert.equal(JSON.parse(calls.at(-1).options.body).variables.input.quantities[0].locationId, supplierId);
});

test('pilot writer rejects unverified source policy, missing limit, and multiple variants before network access', async () => {
  for (const change of [
    { SUPPLIER_FEED_SEMANTICS: '' }, { INVENTORY_MAX_WRITE_DELTA: '' },
    { PILOT_VARIANT_IDS: JSON.stringify([id, 'gid://shopify/ProductVariant/2']) },
    { PROTECTED_LOCATION_IDS: '[]' }, { SUPPLIER_LOCATION_ID: localId }
  ]) {
    const { calls, deps, writeEnv } = pilotWriteFixture();
    await assert.rejects(runGuardedWrite({ ...writeEnv, ...change }, deps));
    assert.equal(calls.length, 0);
  }
});

test('pilot writer blocks scope, location, shared SKU, tracking, other-location stock, and large changes before mutation', async () => {
  for (const [fixture, change] of [
    [{ scopes: ['read_inventory'] }, {}],
    [{ online: false }, {}],
    [{ skuMatches: [{ id, sku: variant.sku }, { id: 'gid://shopify/ProductVariant/2', sku: variant.sku }] }, {}],
    [{ tracked: false }, {}],
    [{ supplierQty: 0, localAvailable: 2 }, {}],
    [{}, { INVENTORY_MAX_WRITE_DELTA: '0' }],
    [{}, { INVENTORY_MAX_WRITE_DELTA: '1', SS_SAFETY_BUFFER: '8' }]
  ]) {
    const { calls, deps, writeEnv } = pilotWriteFixture(fixture);
    await assert.rejects(runGuardedWrite({ ...writeEnv, ...change }, deps));
    assert.equal(calls.filter(call => JSON.parse(call.options.body || '{}').query?.startsWith('mutation')).length, 0);
  }
});

test('pilot writer never restores a Shopify order commitment from an unchanged S&S feed', async () => {
  for (const fixture of [{ committed: 1 }, { localCommitted: 1 }]) {
    const { calls, deps, writeEnv } = pilotWriteFixture(fixture);
    await assert.rejects(runGuardedWrite(writeEnv, deps), /SHOPIFY_COMMITMENTS_PRESENT/);
    assert.equal(calls.filter(call => JSON.parse(call.options.body || '{}').query?.startsWith('mutation')).length, 0);
  }
});

test('Shopify CAS conflict and GraphQL errors fail without reporting a successful write', async () => {
  for (const mutationResult of [
    { data: { inventorySetQuantities: { inventoryAdjustmentGroup: null,
      userErrors: [{ code: 'CHANGE_FROM_QUANTITY_STALE' }] } } },
    { errors: [{ message: 'private upstream detail' }] }
  ]) {
    const { deps, writeEnv } = pilotWriteFixture({ mutationResult });
    await assert.rejects(runGuardedWrite(writeEnv, deps), /SHOPIFY_QUANTITY_CHANGED|SHOPIFY_WRITE_FAILED/);
  }
});
