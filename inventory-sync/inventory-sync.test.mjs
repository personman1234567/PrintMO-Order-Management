import test from 'node:test';
import assert from 'node:assert/strict';
import { makePlan, normalizeInventory } from './core.mjs';
import { requestJson, shopifyRead } from './clients.mjs';
import worker, { runDryRun } from './worker.mjs';
import { gatewayInventoryHandler } from './gateway-handler.mjs';
import { audit } from './cli.mjs';
const now = Date.now();
const id = 'gid://shopify/ProductVariant/1';
const itemId = 'gid://shopify/InventoryItem/1';
const localId = 'gid://shopify/Location/1';
const supplierId = 'gid://shopify/Location/2';
const variant = { id, sku: 'B00760004', product: { status: 'ACTIVE' }, inventoryPolicy: 'DENY', inventoryItem: { id: itemId, tracked: true } };
const inventory = [{ sku: variant.sku, warehouses: [{ warehouseAbbr: 'IL', qty: 8, dropship: false }, { warehouseAbbr: 'KS', qty: 0, dropship: false }] }];
const base = { variants: [variant], inventory, observedAt: new Date(now).toISOString(), warehouses: ['IL', 'KS'], safetyBuffer: 2, supplierLocationId: supplierId, protectedLocationIds: [localId], now };
const env = { INVENTORY_SYNC_MODE: 'dry-run', PILOT_VARIANT_IDS: JSON.stringify([id]), SS_WAREHOUSES: '["IL","KS"]',
  PROTECTED_LOCATION_IDS: JSON.stringify([localId]), SS_SAFETY_BUFFER: '2', SUPPLIER_LOCATION_ID: supplierId,
  SHOPIFY_SHOP_DOMAIN: 'example.myshopify.com', SHOPIFY_ACCESS_TOKEN: 'shop-secret',
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
      assert.match(JSON.parse(options.body).query,/^query InventoryPilot/);
      assert.equal(options.headers['X-Shopify-Access-Token'],'shop-secret');
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
