import {syncCosts,costConfig,configureCosts,costStatus,money} from './costs.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {registerEntries,registryStatus,runRegistrySchedule,acquireLease,renewLease,releaseLease} from './registry.mjs';
import {inventoryService,SERVICE_VERSION} from './service.mjs';
import {serviceClient,enrollProductBatches} from './enroll-cli.mjs';
import {requestJson,readSupplierGatewayBulk,supplierSlice,normalizeSupplierBatch,isSupplierDeferred} from './clients.mjs';
import {SyncError} from './core.mjs';
import {PRIORITY_SHARED_6400_SKUS} from './priority-shared-6400.mjs';

function fixture(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(fs.readFileSync(new URL('./migrations/0001_inventory_registry.sql',import.meta.url),'utf8'));
 sqlite.exec(fs.readFileSync(new URL('./migrations/0002_inventory_costs.sql',import.meta.url),'utf8'));
 const db={prepare(sql){const statement=sqlite.prepare(sql);return {bind(...values){return {
  async first(){return statement.get(...values)||null;},async all(){return {results:statement.all(...values)};},
  async run(){const r=statement.run(...values);return {success:true,meta:{changes:Number(r.changes)}};}
 };},async first(){return statement.get()||null;},async all(){return {results:statement.all()};}};},
 async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 return {sqlite,env:{INVENTORY_DB:db,SHOPIFY_ACCESS_TOKEN:'test',SHOPIFY_SHOP_DOMAIN:'429cc0-3.myshopify.com',INVENTORY_REFRESH_SECONDS:'300',INVENTORY_RUN_SECONDS:'45',INVENTORY_REGISTRY_ENABLED:'true',INVENTORY_ADMIN_KEY:'x'.repeat(40)}};
}
const entries=n=>Array.from({length:n},(_,i)=>({id:'gid://shopify/ProductVariant/'+(i+1),sku:'TEST'+(i+1),missingPolicy:'hold'}));

test('21000 variants refresh without a catalog or request-count cap and repeated registration preserves progress',async()=>{
 const f=fixture(),rows=entries(21000);const now=()=>1000000;
 for(let i=0;i<rows.length;i+=25)await registerEntries(f.env,rows.slice(i,i+25),{now:now()});
 let calls=0;const deps={now,runBatch:async env=>{calls++;return {writes:JSON.parse(env.PILOT_VARIANT_IDS).length};}};
 const result=await runRegistrySchedule(f.env,deps,now());
 assert.equal(result.variants,21000);assert.equal(result.batches,840);assert.equal(calls,840);
 await registerEntries(f.env,rows.slice(0,25),{now:now()});
 assert.equal((await runRegistrySchedule(f.env,deps,now())).variants,0);
 assert.equal((await registryStatus(f.env,now())).awaitingFirstRefresh,0);f.sqlite.close();
});
test('refresh saves each completed batch, resumes after the runtime budget, and retries failures without starving later batches',async()=>{
 const f=fixture(),rows=entries(75);let current=1000000;
 for(let i=0;i<rows.length;i+=25)await registerEntries(f.env,rows.slice(i,i+25),{now:current});
 const visited=[];let fail=true;
 const deps={now:()=>current,runBatch:async env=>{const ids=JSON.parse(env.PILOT_VARIANT_IDS);visited.push(ids);current+=23000;if(fail){fail=false;throw new SyncError('UPSTREAM_TRANSPORT_FAILED');}return {writes:ids.length};}};
 const first=await runRegistrySchedule(f.env,deps);assert.equal(first.batches,2);assert.equal(first.failures,1);
 const partial=await registryStatus(f.env,current);assert.equal(partial.failed,25);assert.equal(partial.awaitingFirstRefresh,50);
 await runRegistrySchedule(f.env,deps);assert.equal(visited.length,3);assert.equal((await registryStatus(f.env,current)).awaitingFirstRefresh,25);
 current+=60000;await runRegistrySchedule(f.env,deps);assert.equal((await registryStatus(f.env,current)).failed,0);assert.equal((await registryStatus(f.env,current)).awaitingFirstRefresh,0);f.sqlite.close();
});
test('leases prevent overlapping writes and recover expiration without allowing an old holder to release a new lease',async()=>{
 const f=fixture();const old=await acquireLease(f.env,1000);assert.ok(old);assert.equal(await acquireLease(f.env,1001),null);
 await renewLease(f.env,old,2000);assert.equal(await acquireLease(f.env,121000),null);
 const fresh=await acquireLease(f.env,122001);assert.ok(fresh);await releaseLease(f.env,old);assert.equal(await acquireLease(f.env,122002),null);
 await releaseLease(f.env,fresh);assert.ok(await acquireLease(f.env,122003));f.sqlite.close();
});
test('registry keeps shared 6400 SKUs disabled and rejects identity drift before inserting other entries',async()=>{
 const f=fixture(),row=entries(1)[0];await registerEntries(f.env,[row]);
 await assert.rejects(registerEntries(f.env,[{...row,sku:'CHANGED'},entries(2)[1]]),/PINNED_SKU_CHANGED/);
 assert.equal((await registryStatus(f.env)).entries,1);
 await registerEntries(f.env,[{id:'gid://shopify/ProductVariant/100',sku:[...PRIORITY_SHARED_6400_SKUS][0]}]);
 const status=await registryStatus(f.env);assert.equal(status.scheduled,1);assert.equal(status.excluded,1);f.sqlite.close();
});
test('refreshing an enrolled product preserves its existing missing-source policy',async()=>{
 const f=fixture(),row={...entries(1)[0],missingPolicy:'block'};await registerEntries(f.env,[row]);
 await registerEntries(f.env,[{id:row.id,sku:row.sku}],{verified:true});
 assert.equal(f.sqlite.prepare('SELECT missing_policy FROM inventory_sync_variants').get().missing_policy,'block');f.sqlite.close();
});
test('permanent service rejects unauthenticated calls before upstream access and identifies authenticated health',async()=>{
 const f=fixture();let calls=0;const deps={fetchImpl:async()=>{calls++;return Response.json({data:{currentAppInstallation:{accessScopes:[{handle:'write_inventory'},{handle:'write_products'}]}}});}};
 const url='https://example.com/inventory/health';assert.equal((await inventoryService(new Request(url),f.env,deps)).status,404);assert.equal(calls,0);
 const r=await inventoryService(new Request(url,{headers:{Authorization:'Bearer '+f.env.INVENTORY_ADMIN_KEY}}),f.env,deps);
 const d=await r.json();assert.equal(r.status,200);assert.equal(d.service,SERVICE_VERSION);assert.equal(d.policyWriteAvailable,true);assert.equal(calls,1);f.sqlite.close();
});
test('permanent client retries a busy lease and rejects unexpected HTML instead of treating a 404 as success',async()=>{
 let calls=0,waits=0;const env={INVENTORY_ADMIN_KEY:'x'.repeat(40)};
 const invoke=serviceClient(env,{sleep:async()=>waits++,fetchImpl:async()=>++calls===1?Response.json({error:'INVENTORY_BUSY'},{status:409}):Response.json({ok:true})});
 assert.equal((await invoke('/inventory/health')).ok,true);assert.equal(waits,1);
 await assert.rejects(serviceClient(env,{fetchImpl:async()=>new Response('Not found',{status:404})})('/inventory/health'),/INVENTORY_SERVICE_HTTP_404/);
});
test('Shopify throttling uses the returned cost budget and retries once',async()=>{
 let calls=0;const waits=[];const data=await requestJson('https://example.com',{}, {sleep:async ms=>waits.push(ms),fetchImpl:async()=>++calls===1?Response.json({errors:[{extensions:{code:'THROTTLED'}}],extensions:{cost:{requestedQueryCost:100,throttleStatus:{currentlyAvailable:0,restoreRate:50}}}}):Response.json({data:{ok:true}})});
 assert.equal(data.data.ok,true);assert.deepEqual(waits,[2000]);assert.equal(calls,2);
});

const inventoryRows=skus=>skus.map(sku=>({sku,warehouses:[{warehouseAbbr:'IL',qty:10,dropship:false}]}));
test('bulk registry reads 250 SKUs then processes ten independent 25-variant batches',async()=>{
 const f=fixture(),rows=entries(577),observedAt=new Date(1000000).toISOString();f.env.INVENTORY_SUPPLIER_BATCH_SIZE='250';
 for(let i=0;i<rows.length;i+=25)await registerEntries(f.env,rows.slice(i,i+25),{now:1000000});
 const reads=[],batches=[];
 const deps={now:()=>1000000,readSupplierBulk:async(env,skus)=>{reads.push(skus);return {skus,observedAt,items:inventoryRows(skus)};},
 runBatch:async(env,deps)=>{const skus=JSON.parse(env.PILOT_VARIANT_SKUS),snapshot=supplierSlice(deps.supplierSnapshot,skus);batches.push(skus);assert.ok(skus.length<=25);assert.equal(snapshot.items.length,skus.length);assert.equal(snapshot.observedAt,observedAt);return {writes:skus.length};}};
 const summary=await runRegistrySchedule(f.env,deps);assert.equal(summary.variants,577);assert.equal(summary.writes,577);
 assert.deepEqual(reads.map(r=>r.length),[250,250,77]);assert.equal(batches.length,24);assert.equal((await registryStatus(f.env,1000000)).awaitingFirstRefresh,0);f.sqlite.close();
});
test('bulk prefetch respects runtime budget and only completed 25-variant batches advance',async()=>{
 const f=fixture(),rows=entries(275);f.env.INVENTORY_SUPPLIER_BATCH_SIZE='250';let current=1000000,reads=0;
 for(let i=0;i<rows.length;i+=25)await registerEntries(f.env,rows.slice(i,i+25),{now:current});
 const deps={now:()=>current,readSupplierBulk:async(env,skus)=>{reads++;return {skus,observedAt:new Date(current).toISOString(),items:inventoryRows(skus)};},runBatch:async()=>{current+=23000;return {writes:25};}};
 assert.equal((await runRegistrySchedule(f.env,deps)).variants,50);assert.equal(reads,1);assert.equal((await registryStatus(f.env,current)).awaitingFirstRefresh,225);
 assert.equal((await runRegistrySchedule(f.env,deps)).variants,50);assert.equal(reads,2);assert.equal((await registryStatus(f.env,current)).awaitingFirstRefresh,175);f.sqlite.close();
});
test('rate limits and gateway 502/503 stop the schedule and persist cooldown across cron invocations',async()=>{
 for(const code of ['SUPPLIER_RATE_LIMITED','UPSTREAM_RETRY_DEFERRED','UPSTREAM_HTTP_502','UPSTREAM_HTTP_503']){
  const f=fixture();f.env.INVENTORY_SUPPLIER_BATCH_SIZE='250';let current=1000000,reads=0,writes=0;
  for(let i=0;i<300;i+=25)await registerEntries(f.env,entries(300).slice(i,i+25),{now:current});
  const deps={now:()=>current,readSupplierBulk:async()=>{reads++;const e=new SyncError(code);e.retryAfterSeconds=120;throw e;},runBatch:async()=>{writes++;}};
  const first=await runRegistrySchedule(f.env,deps);assert.equal(first.batches,1);assert.equal(first.deferred,true);assert.equal(first.retryAt,current+120000);
  current+=60000;assert.equal((await runRegistrySchedule(f.env,deps)).deferred,true);assert.equal(reads,1);assert.equal(writes,0);
  const status=await registryStatus(f.env,current);assert.equal(status.awaitingFirstRefresh,300);assert.equal(status.failed,25);
  current+=60000;await runRegistrySchedule(f.env,deps);assert.equal(reads,2);f.sqlite.close();
 }
});
test('legacy 25-SKU scheduler also stops on deferral while ordinary variant guards can continue',async()=>{
 const f=fixture();for(let i=0;i<75;i+=25)await registerEntries(f.env,entries(75).slice(i,i+25),{now:1000000});let calls=0;
 const summary=await runRegistrySchedule(f.env,{now:()=>1000000,runBatch:async()=>{calls++;throw new SyncError('UPSTREAM_HTTP_502');}});
 assert.equal(calls,1);assert.equal(summary.deferred,true);f.sqlite.close();
});
test('supplier bulk response validates every row and keeps omissions absent in exact slices',async()=>{
 const skus=entries(250).map(r=>r.sku),items=inventoryRows(skus.slice(0,249)),observedAt=new Date().toISOString();
 const snapshot={skus,items,observedAt};assert.equal(normalizeSupplierBatch(items,skus).length,249);
 assert.equal(supplierSlice(snapshot,[skus[249]]).items.length,0);assert.equal(supplierSlice(snapshot,[skus[0]]).observedAt,observedAt);
 assert.throws(()=>supplierSlice(snapshot,['OTHER']),/SUPPLIER_PREFETCH_SCOPE_MISMATCH/);
 assert.throws(()=>normalizeSupplierBatch([...items,items[0]],skus),/INVALID_SUPPLIER_RESPONSE/);
 assert.throws(()=>normalizeSupplierBatch([...items,{...items[0],sku:'OTHER'}],skus),/INVALID_SUPPLIER_RESPONSE/);
 assert.throws(()=>supplierSlice({...snapshot,items:[...items.slice(0,-1),{...items.at(-1),warehouses:[{warehouseAbbr:'IL',qty:-1,dropship:false}]}]},[skus[0]]),/INVALID_SUPPLIER_RESPONSE/);
});
test('supplier gateway propagates safe error codes and Retry-After without immediate retries',async()=>{
 const env={SUPPLIER_INVENTORY_URL:'https://example.com/order-manager/v1/supplier/ss/inventory',INVENTORY_READ_KEY:'test',SHOPIFY_SHOP_DOMAIN:'429cc0-3.myshopify.com'};
 for(const status of [429,502,503]){let calls=0;await assert.rejects(readSupplierGatewayBulk(env,['SKU'],{fetchImpl:async()=>{calls++;return Response.json({error:'SUPPLIER_RATE_LIMITED',private:'secret'},{status,headers:{'Retry-After':'90'}});}}),e=>e.code==='SUPPLIER_RATE_LIMITED'&&e.retryAfterSeconds===90&&!e.message.includes('secret'));assert.equal(calls,1);}
 let calls=0;await assert.rejects(readSupplierGatewayBulk(env,entries(251).map(r=>r.sku),{fetchImpl:async()=>{calls++;}}),/INVALID_SKUS/);assert.equal(calls,0);
});
test('577-variant enrollment warms three bounded groups and retains 24 guarded apply calls',async()=>{
 const product={id:'gid://shopify/Product/1',variants:entries(577)},calls=[],report={batches:[]};
 const invoke=async(endpoint,input)=>{calls.push({endpoint,input});if(endpoint==='/inventory/health')return {supplierBatchSize:250};if(endpoint==='/inventory/enroll')return {ready:true,rows:input.entries};return {};};
 await enrollProductBatches(product,{execute:true,invoke,report});
 assert.deepEqual(calls.filter(c=>c.endpoint==='/inventory/prefetch').map(c=>c.input.entries.length),[250,250,77]);
 assert.equal(calls.filter(c=>c.input?.mode==='apply').length,24);assert.equal(report.batches.length,24);
 assert.ok(calls.filter(c=>c.endpoint==='/inventory/enroll').every(c=>c.input.entries.length<=25));
 assert.equal(calls.filter(c=>c.input?.mode==='verify').length,0);
});
test('enrollment preserves completed progress and stops on rate limiting or 502 without requery hammering',async()=>{
 for(const code of ['SUPPLIER_RATE_LIMITED','UPSTREAM_RETRY_DEFERRED','UPSTREAM_HTTP_502','UPSTREAM_HTTP_503']){
  const report={batches:[]},calls=[];
  const invoke=async(endpoint,input)=>{calls.push({endpoint,input});if(endpoint==='/inventory/health')return {supplierBatchSize:250};if(input?.mode==='apply'){if(input.offset===25)throw new SyncError(code);return {ready:true};}return {};};
  await assert.rejects(enrollProductBatches({id:'gid://shopify/Product/1',variants:entries(100)},{execute:true,invoke,report}),e=>e.code===code);
  assert.equal(report.batches[0].result.ready,true);assert.equal(calls.filter(c=>c.input?.mode==='apply').length,2);assert.equal(calls.filter(c=>c.input?.mode==='verify').length,0);
 }
});
test('uncertain enrollment write still receives one bounded verify/reapply using fresh server state',async()=>{
 const calls=[];let failed=false;
 const invoke=async(endpoint,input)=>{calls.push({endpoint,input});if(endpoint==='/inventory/health')return {};if(input?.mode==='apply'&&!failed){failed=true;throw new SyncError('ENROLLMENT_REQUEST_UNCERTAIN_REQUERY');}return {ready:true};};
 await enrollProductBatches({id:'gid://shopify/Product/1',variants:entries(25)},{execute:true,invoke,report:{batches:[]}});
 assert.deepEqual(calls.filter(c=>c.endpoint==='/inventory/enroll').map(c=>c.input.mode),['apply','verify','apply']);assert.equal(calls.filter(c=>c.endpoint==='/inventory/prefetch').length,0);
});
test('authenticated prefetch checks live product/SKU identities and never sends Shopify mutations',async()=>{
 const f=fixture();f.env.INVENTORY_SUPPLIER_BATCH_SIZE='250';f.env.SUPPLIER_INVENTORY_URL='https://example.com/order-manager/v1/supplier/ss/inventory';f.env.INVENTORY_READ_KEY='test';
 const rows=entries(250),productId='gid://shopify/Product/1';let supplierCalls=0,queries=0,mismatch=false;
 const deps={fetchImpl:async(url,options)=>{if(String(url).includes('/supplier/')){supplierCalls++;assert.equal(new URL(url).searchParams.get('skus').split(',').length,250);return Response.json({observedAt:new Date().toISOString(),items:inventoryRows(rows.map(r=>r.sku))});}
 const {query}=JSON.parse(options.body);assert.match(query,/^query InventoryPrefetchIdentity/);queries++;return Response.json({data:{nodes:rows.map((r,i)=>({...r,sku:mismatch&&i===0?'OTHER':r.sku,product:{id:productId,status:'ACTIVE'}}))}});}};
 const request=()=>new Request('https://example.com/inventory/prefetch',{method:'POST',headers:{Authorization:'Bearer '+f.env.INVENTORY_ADMIN_KEY,'Content-Type':'application/json'},body:JSON.stringify({productId,entries:rows})});
 assert.equal((await inventoryService(new Request('https://example.com/inventory/prefetch',{method:'POST'}),f.env,deps)).status,404);assert.equal(queries,0);
 let response=await inventoryService(request(),f.env,deps);assert.equal(response.status,200);assert.equal((await response.json()).variants,250);assert.equal(supplierCalls,1);assert.equal((await registryStatus(f.env)).entries,0);
 mismatch=true;response=await inventoryService(request(),f.env,deps);assert.equal(response.status,422);assert.equal((await response.json()).error,'PRODUCT_IDENTITY_CHANGED');assert.equal(supplierCalls,1);
 const lease=await acquireLease(f.env);assert.ok(lease);await releaseLease(f.env,lease);f.sqlite.close();
});
test('enrollment client preserves rate-limit retry metadata without automatically replaying writes',async()=>{
 let calls=0;const invoke=serviceClient({INVENTORY_ADMIN_KEY:'x'.repeat(40)},{fetchImpl:async()=>{calls++;return Response.json({error:'SUPPLIER_RATE_LIMITED',retryAfterSeconds:90},{status:422,headers:{'Retry-After':'90'}});}});
 await assert.rejects(invoke('/inventory/enroll',{mode:'apply'}),e=>e.code==='SUPPLIER_RATE_LIMITED'&&e.retryAfterSeconds===90);assert.equal(calls,1);
});

test('gateway HTTP 502 defers even when its safe body reports a transport failure',async()=>{
 const f=fixture(),rows=entries(25),productId='gid://shopify/Product/1';f.env.INVENTORY_SUPPLIER_BATCH_SIZE='250';f.env.SUPPLIER_INVENTORY_URL='https://example.com/order-manager/v1/supplier/ss/inventory';f.env.INVENTORY_READ_KEY='test';
 const request=new Request('https://example.com/inventory/prefetch',{method:'POST',headers:{Authorization:'Bearer '+f.env.INVENTORY_ADMIN_KEY,'Content-Type':'application/json'},body:JSON.stringify({productId,entries:rows})});
 const response=await inventoryService(request,f.env,{fetchImpl:async(url)=>String(url).includes('/supplier/')?Response.json({error:'UPSTREAM_TRANSPORT_FAILED'},{status:502}):Response.json({data:{nodes:rows.map(r=>({...r,product:{id:productId,status:'ACTIVE'}}))}})});
 assert.equal(response.status,503);assert.equal(response.headers.get('Retry-After'),'60');const payload=await response.json();assert.equal(payload.error,'UPSTREAM_TRANSPORT_FAILED');
 const invoke=serviceClient({INVENTORY_ADMIN_KEY:'x'.repeat(40)},{fetchImpl:async()=>Response.json(payload,{status:503,headers:{'Retry-After':'60'}})});
 await assert.rejects(invoke('/inventory/prefetch',{}),e=>isSupplierDeferred(e)&&e.retryAfterSeconds===60);f.sqlite.close();
});


function costInput(rows,prices,current='2.00'){
 return {currencyCode:'USD',matches:rows.map(()=>true),supplier:{observedAt:new Date(1000000).toISOString(),items:inventoryRows(rows.map(r=>r.sku)).map((r,i)=>({...r,customerPrice:prices[i]}))},
 variants:rows.map(r=>({...r,product:{id:'gid://shopify/Product/1',status:'ACTIVE'},inventoryItem:{unitCost:current===null?null:{amount:current,currencyCode:'USD'}}}))};
}
test('cost preview carries prices through bulk slices, compares decimal amounts, and retains unusable costs',async()=>{
 const f=fixture(),rows=entries(5);await registerEntries(f.env,rows,{productId:'gid://shopify/Product/1',now:1000000});
 const input=costInput(rows,['2.0000','3.10',null,0,'bad']);
 const sliced=supplierSlice({...input.supplier,skus:rows.map(r=>r.sku)},[rows[1].sku]);assert.equal(sliced.items[0].customerPrice,'3.10');assert.equal(sliced.observedAt,input.supplier.observedAt);
 await configureCosts(f.env,{mode:'preview'},1000000);
 const result=await syncCosts(f.env,input,await costConfig(f.env),{now:()=>1000000,fetchImpl:()=>assert.fail('preview must not call Shopify')});
 assert.deepEqual(result,{checked:5,changed:1,writes:0,unchanged:1,skipped:3,failed:0,deferred:0});
 const status=await costStatus(f.env);assert.equal(status.eligible,5);assert.equal(status.checked,5);assert.equal(status.changes,1);assert.equal(status.skipped,3);
 assert.equal(money('02.1000'),'2.10');assert.equal(money('2.105'),null);f.sqlite.close();
});
test('cost writes group by product, send only cost, preserve recovery values, and repeat as no-ops',async()=>{
 const f=fixture(),rows=entries(2),input=costInput(rows,['3.10','4.00'],null),calls=[];
 f.env.SHOPIFY_POLICY_CLIENT_ID='id';f.env.SHOPIFY_POLICY_CLIENT_SECRET='secret';
 const deps={now:()=>1000000,costAuth:{},fetchImpl:async(url,options)=>{
  calls.push({url,options});if(url.endsWith('/access_token'))return Response.json({access_token:'policy-token'});
  const body=JSON.parse(options.body);assert.match(body.query,/mutation SyncSupplierCosts/);
  assert.deepEqual(body.variables,{productId:'gid://shopify/Product/1',variants:rows.map((r,i)=>({id:r.id,inventoryItem:{cost:input.supplier.items[i].customerPrice}}))});
  return Response.json({data:{productVariantsBulkUpdate:{userErrors:[],productVariants:rows.map((r,i)=>({id:r.id,inventoryItem:{unitCost:{amount:input.supplier.items[i].customerPrice,currencyCode:'USD'}}}))}}});
 }};
 const result=await syncCosts(f.env,input,{mode:'enabled'},deps);assert.equal(result.writes,2);assert.equal(calls.length,2);
 let stored=f.sqlite.prepare('SELECT * FROM inventory_sync_costs WHERE variant_id=?').get(rows[0].id);assert.equal(stored.before_cost,null);assert.equal(stored.written_cost,'3.10');assert.equal(stored.written_at,1000000);
 input.variants.forEach((v,i)=>v.inventoryItem.unitCost={amount:input.supplier.items[i].customerPrice,currencyCode:'USD'});
 assert.equal((await syncCosts(f.env,input,{mode:'enabled'},deps)).writes,0);assert.equal(calls.length,2);
 stored=f.sqlite.prepare('SELECT * FROM inventory_sync_costs WHERE variant_id=?').get(rows[0].id);assert.equal(stored.before_cost,null);assert.equal(stored.written_cost,'3.10');f.sqlite.close();
});
test('cost write errors retry on a fresh pass, and deadline deferral makes no provider calls',async()=>{
 const f=fixture(),rows=entries(2),input=costInput(rows,['3.00','4.00']);let reject=true,calls=0;
 f.env.SHOPIFY_POLICY_CLIENT_ID='id';f.env.SHOPIFY_POLICY_CLIENT_SECRET='secret';
 const deps={now:()=>1000000,costAuth:{token:'policy'},fetchImpl:async()=>{calls++;if(reject)return Response.json({},{status:503});return Response.json({data:{productVariantsBulkUpdate:{userErrors:reject?[{message:'rejected'}]:[],productVariants:reject?[]:rows.map((r,i)=>({id:r.id,inventoryItem:{unitCost:{amount:input.supplier.items[i].customerPrice,currencyCode:'USD'}}}))}}});}};
 assert.equal((await syncCosts(f.env,input,{mode:'enabled'},deps)).failed,2);assert.equal(calls,1);
 assert.equal(f.sqlite.prepare('SELECT before_cost FROM inventory_sync_costs LIMIT 1').get().before_cost,'2.00');
 assert.equal((await syncCosts(f.env,input,{mode:'enabled'},deps)).deferred,2);assert.equal(calls,1);
 reject=false;deps.costAuth={token:'policy'};assert.equal((await syncCosts(f.env,input,{mode:'enabled'},deps)).writes,2);
 assert.equal((await syncCosts(f.env,input,{mode:'enabled'},{...deps,costDeadline:999999})).deferred,2);assert.equal(calls,2);f.sqlite.close();
});
test('cost pilot limits writes and currency or identity failures retain current values',async()=>{
 const f=fixture(),input=costInput(entries(2),['3.00','4.00']);input.variants[1].product.id='gid://shopify/Product/2';
 assert.equal((await syncCosts(f.env,input,{mode:'preview',productId:'gid://shopify/Product/1'},{now:()=>1000000})).checked,1);
 input.currencyCode='CAD';assert.equal((await syncCosts(f.env,input,{mode:'enabled'},{now:()=>1000000})).skipped,2);
 input.currencyCode='USD';input.matches=[false,false];assert.equal((await syncCosts(f.env,input,{mode:'enabled'},{now:()=>1000000})).skipped,2);f.sqlite.close();
});
test('cost failure does not mark a successful stock batch failed or schedule supplier backoff',async()=>{
 const f=fixture(),rows=entries(25);await registerEntries(f.env,rows,{now:1000000});await configureCosts(f.env,{mode:'enabled'},1000000);
 const result=await runRegistrySchedule(f.env,{now:()=>1000000,runBatch:async(env,deps)=>{assert.equal(deps.collectCosts,true);return {writes:25,costInput:costInput(rows,rows.map(()=>null))};},syncCosts:async()=>{throw new Error('cost database failure');}});
 assert.equal(result.writes,25);assert.equal(result.failures,0);assert.equal(result.costs.failed,25);assert.equal((await registryStatus(f.env,1000000)).failed,0);f.sqlite.close();
});


test('mixed-product costs share one Shopify request and confirm each product independently',async()=>{
 const f=fixture(),rows=entries(2),input=costInput(rows,['3.00','4.00']);input.variants[1].product.id='gid://shopify/Product/2';
 f.env.SHOPIFY_POLICY_CLIENT_ID='id';f.env.SHOPIFY_POLICY_CLIENT_SECRET='secret';let calls=0;
 const result=await syncCosts(f.env,input,{mode:'enabled'},{now:()=>1000000,costAuth:{token:'policy'},fetchImpl:async(url,options)=>{
  calls++;const operation=JSON.parse(options.body);assert.match(operation.query,/cost0:productVariantsBulkUpdate/);assert.match(operation.query,/cost1:productVariantsBulkUpdate/);
  assert.equal(operation.variables.product0,'gid://shopify/Product/1');assert.equal(operation.variables.product1,'gid://shopify/Product/2');
  return Response.json({data:{cost0:{userErrors:[],productVariants:[{id:rows[0].id,inventoryItem:{unitCost:{amount:'3.00',currencyCode:'USD'}}}]},cost1:{userErrors:[{message:'rejected'}],productVariants:[]}}});
 }});
 assert.equal(calls,1);assert.equal(result.writes,1);assert.equal(result.failed,1);
 assert.equal(f.sqlite.prepare('SELECT state FROM inventory_sync_costs WHERE variant_id=?').get(rows[0].id).state,'matched');
 assert.equal(f.sqlite.prepare('SELECT state FROM inventory_sync_costs WHERE variant_id=?').get(rows[1].id).state,'failed');f.sqlite.close();
});


test('250-SKU stock group checkpoints ten batches before one combined cost phase',async()=>{
 const f=fixture(),rows=entries(250);f.env.INVENTORY_SUPPLIER_BATCH_SIZE='250';
 for(let i=0;i<rows.length;i+=25)await registerEntries(f.env,rows.slice(i,i+25),{now:1000000});
 await configureCosts(f.env,{mode:'enabled'},1000000);let stocks=0,costCalls=0;
 const result=await runRegistrySchedule(f.env,{now:()=>1000000,
 readSupplierBulk:async(env,skus)=>({skus,observedAt:new Date(1000000).toISOString(),items:inventoryRows(skus)}),
 runBatch:async env=>{stocks++;const ids=JSON.parse(env.PILOT_VARIANT_IDS);return {writes:ids.length,costInput:costInput(rows.filter(r=>ids.includes(r.id)),ids.map(()=> '3.00'))};},
 syncCosts:async(env,input)=>{costCalls++;assert.equal(stocks,10);assert.equal((await registryStatus(env,1000000)).awaitingFirstRefresh,0);assert.equal(input.variants.length,250);return {checked:250,writes:250};}});
 assert.equal(costCalls,1);assert.equal(result.writes,250);assert.equal(result.costs.writes,250);f.sqlite.close();
});
