import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {registerEntries,registryStatus,runRegistrySchedule,acquireLease,renewLease,releaseLease} from './registry.mjs';
import {inventoryService,SERVICE_VERSION} from './service.mjs';
import {serviceClient} from './enroll-cli.mjs';
import {requestJson} from './clients.mjs';
import {SyncError} from './core.mjs';
import {PRIORITY_SHARED_6400_SKUS} from './priority-shared-6400.mjs';

function fixture(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(fs.readFileSync(new URL('./migrations/0001_inventory_registry.sql',import.meta.url),'utf8'));
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
