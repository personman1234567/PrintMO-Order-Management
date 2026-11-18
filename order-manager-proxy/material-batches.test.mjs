import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createPrintBatchService, materialBatchLabel, orderedDate } from './material-batches.mjs';
function fixture() {
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('./migrations/0019_material_batches.sql',import.meta.url),'utf8'));
 const wrap=(sql,args=[])=>({bind(...a){return wrap(sql,a);},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){const r=sqlite.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};}});
 const db={prepare:sql=>wrap(sql),async batch(stmts){sqlite.exec('BEGIN');try{const r=[];for(const s of stmts)r.push(await s.run());sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const orders=new Map([1,2,3].map(n=>[`gid://shopify/Order/${n}`,{name:`#${n}`,version:1,eligible:true,ordered:false,ready:false,savedSheet:true}]));
 const calls=[];let fail=null;
 const service=createPrintBatchService(db,1,{now:()=>new Date('2026-11-14T02:15:00Z'),readOrder:async id=>({...orders.get(id)}),mutateOrder:async(id,version,patch,key)=>{
   calls.push({id,version,patch,key});const o=orders.get(id);if(version!==o.version)throw Object.assign(new Error('conflict'),{code:'VERSION_CONFLICT'});
   if(fail==='before')throw new Error('network');
   if(patch.prints_ordered)o.ordered=true;if('prints_on_saved_sheet' in patch)o.savedSheet=!!patch.prints_on_saved_sheet;if(patch.prints_status)o.ready=true;o.version++;
   if(fail==='after')throw new Error('network');
 }});
 const body={id:'1794610000000-test-batch',mode:'saved-sheet',orderedDate:'2026-11-13',orders:[1,2].map(n=>({provider:'shopify',orderKey:`gid://shopify/Order/${n}`}))};
 return {service,orders,calls,db,sqlite,body,setFail:v=>{fail=v;}};
}
test('Chicago defaults distinguish ordered date from immutable record time',()=>{
 assert.equal(orderedDate(undefined,new Date('2026-11-14T02:15Z')),'2026-11-13');assert.match(materialBatchLabel('prints','',new Date('2026-11-14T02:15Z')),/Prints.*Nov 13, 2026.*8:15 PM/);
 for(const value of ['2026-02-30','2026-13-01','yesterday',123])assert.throws(()=>orderedDate(value));
});
test('saved batch persists exact membership and name/date edits preserve it',async()=>{
 const f=fixture();let b=await f.service.create(f.body,'staff:1');assert.equal(b.members.length,2);assert.equal(f.calls.length,0);
 b=await f.service.metadata({id:b.id,expectedRevision:b.revision,label:'Friday sheets',orderedDate:'2026-11-12'});
 assert.equal(b.label,'Friday sheets');assert.equal(b.createdAt,'2026-11-14T02:15:00.000Z');assert.deepEqual(b.members.map(m=>m.orderKey),f.body.orders.map(o=>o.orderKey));
 await assert.rejects(f.service.metadata({id:b.id,expectedRevision:0,label:'stale',orderedDate:'2026-11-11'}),e=>e.code==='VERSION_CONFLICT');
});
test('create intent replays and prevents duplicate outstanding membership atomically',async()=>{
 const f=fixture();const b=await f.service.create(f.body,'staff:1');assert.equal((await f.service.create(f.body,'staff:1')).id,b.id);
 await assert.rejects(f.service.create({...f.body,id:'another-batch-id'},'staff:2'),e=>e.code==='PRINT_ALREADY_BATCHED');
 assert.equal((await f.service.list()).batches.length,1);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM print_material_members').get().n,2);
});
test('new ordering and selected receipt use canonical saves only for saved members',async()=>{
 const f=fixture();let b=await f.service.create(f.body,'staff:1');b=await f.service.run({id:b.id,expectedRevision:b.revision,action:'mark-ordered'},'staff:1');assert.ok(b.members.every(m=>m.ordered));
 b=await f.service.run({id:b.id,expectedRevision:b.revision,action:'receive',confirmComplete:true,orderKeys:[b.members[0].orderKey]},'staff:1');
 assert.deepEqual(b.members.map(m=>m.inHand),[true,false]);assert.equal(f.orders.get('gid://shopify/Order/3').ready,false);
 assert.deepEqual(f.calls[2].patch,{prints_status:1});assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM print_material_members WHERE active=1').get().n,1);
});
test('unknown receipt outcome recovers from canonical readiness without double mutation',async()=>{
 const f=fixture();let b=await f.service.create(f.body,'staff:1');b=await f.service.run({id:b.id,expectedRevision:b.revision,action:'mark-ordered'},'staff:1');f.setFail('after');
 b=await f.service.run({id:b.id,expectedRevision:b.revision,action:'receive',confirmComplete:true},'staff:1');assert.ok(b.members.every(m=>!m.inHand&&m.message));const count=f.calls.length;f.setFail(null);
 b=await f.service.run({id:b.id,expectedRevision:b.revision,action:'receive',confirmComplete:true},'staff:2');assert.ok(b.members.every(m=>m.inHand));assert.equal(f.calls.length,count);
});
test('receipt rejects stale batch revisions, outsiders and missing physical confirmation',async()=>{
 const f=fixture();let b=await f.service.create(f.body,'staff:1');await assert.rejects(f.service.run({id:b.id,expectedRevision:b.revision,action:'receive'},'staff:1'),e=>e.code==='RECEIPT_CONFIRMATION_REQUIRED');
 await assert.rejects(f.service.run({id:b.id,expectedRevision:b.revision,action:'receive',confirmComplete:true,orderKeys:['gid://shopify/Order/3']},'staff:1'),e=>e.code==='INVALID_MEMBERS');
 b=await f.service.run({id:b.id,expectedRevision:b.revision,action:'mark-ordered'},'staff:1');await assert.rejects(f.service.run({id:b.id,expectedRevision:0,action:'receive',confirmComplete:true},'staff:2'),e=>e.code==='VERSION_CONFLICT');
});
test('changed print status remains unresolved and never gets forced In hand',async()=>{
 const f=fixture();let b=await f.service.create(f.body,'staff:1');b=await f.service.run({id:b.id,expectedRevision:b.revision,action:'mark-ordered'},'staff:1');f.orders.get(b.members[0].orderKey).ordered=false;
 b=await f.service.run({id:b.id,expectedRevision:b.revision,action:'receive',confirmComplete:true},'staff:1');assert.equal(b.members[0].inHand,false);assert.match(b.members[0].message,/status changed/);assert.equal(b.members[1].inHand,true);
});
test('already ordered prints can be explicitly grouped without an ordering mutation',async()=>{
 const f=fixture();for(const o of f.orders.values()){o.ordered=true;o.savedSheet=false;}const b=await f.service.create({...f.body,mode:'ordered'},'staff:1');assert.ok(b.members.every(m=>m.ordered));assert.equal(f.calls.length,0);
});
const source=readFileSync(new URL('./worker.js',import.meta.url),'utf8').replace(/from '(\.\/[^']+\.mjs)'/g,(_,file)=>'from '+JSON.stringify(new URL(file,import.meta.url).href));
const worker=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport { buildBlanksBatch, applyBatchOrderAction, applyBatchReferenceUpdate, handleBlanksBatches };').toString('base64'));
test('apparel names/dates persist independently from membership and full receipt confirms allocation',()=>{
 const b=worker.buildBlanksBatch({label:'Friday apparel',orderedDate:'2026-11-12',supplierOrderNumber:'12345678',orders:[1,2].map(n=>({orderId:`gid://shopify/Order/${n}`,name:`#${n}`,items:[{id:`line${n}`,title:'Shirt',variantTitle:'Black / M',sku:'B1',qty:2}]}))});
 assert.equal(b.orderedDate,'2026-11-12');const members=[...b.orderIds];worker.applyBatchReferenceUpdate(b,{supplierOrderNumber:'12345678',label:'Renamed',orderedDate:'2026-11-11'});assert.equal(b.label,'Renamed');assert.deepEqual(b.orderIds,members);
 assert.equal(worker.applyBatchOrderAction(structuredClone(b),{action:'receive-all',confirmComplete:true,expectedUpdatedAt:'stale'}).ok,false);
 const result=worker.applyBatchOrderAction(b,{action:'receive-all',confirmComplete:true,expectedUpdatedAt:b.updatedAt});assert.ok(result.ok);assert.equal(result.batch.totals.receivedGarments,4);assert.ok(result.batch.orders.every(o=>o.fullyAccounted));
});
test('definite version conflicts permit a reviewed new attempt without replaying the obsolete intent',async()=>{
 const f=fixture();let b=await f.service.create(f.body,'staff:1');
 f.orders.get(b.members[0].orderKey).version=2;
 // Persisted canonical intent from an interrupted attempt predates an unrelated note edit.
 const row=await f.db.prepare('SELECT data_json FROM print_material_batches WHERE id=?').bind(b.id).first();const data=JSON.parse(row.data_json);data.members[0].orderVersion=1;
 await f.db.prepare('UPDATE print_material_batches SET data_json=? WHERE id=?').bind(JSON.stringify(data),b.id).run();
 b=await f.service.run({id:b.id,expectedRevision:b.revision,action:'mark-ordered'},'staff:1');assert.ok(b.members[0].retryConflict);
 b=await f.service.run({id:b.id,expectedRevision:b.revision,action:'mark-ordered',retryReviewed:true},'staff:1');assert.ok(b.members[0].ordered);assert.equal(b.members[0].attempt,1);assert.equal(f.calls.at(-1).version,2);
});
test('membership correction releases only selected reservations and preserves print status/history',async()=>{
 const f=fixture();let b=await f.service.create(f.body,'staff:1');b=await f.service.run({id:b.id,expectedRevision:b.revision,action:'remove',orderKeys:[b.members[0].orderKey]},'staff:1');assert.ok(b.members[0].removedAt);assert.equal(f.calls.length,0);
 const replacement=await f.service.create({...f.body,id:'replacement-batch',orders:[f.body.orders[0]]},'staff:1');assert.equal(replacement.members.length,1);assert.equal((await f.service.get(b.id)).members.length,2);
});
test('old successful mutation replay cannot checkpoint readiness that was subsequently reversed',async()=>{
 const f=fixture();let b=await f.service.create(f.body,'staff:1');b=await f.service.run({id:b.id,expectedRevision:b.revision,action:'mark-ordered'},'staff:1');
 const replayService=createPrintBatchService(f.db,1,{readOrder:async id=>({...f.orders.get(id)}),mutateOrder:async()=>({ok:true})});
 b=await replayService.run({id:b.id,expectedRevision:b.revision,action:'receive',confirmComplete:true},'staff:1');assert.ok(b.members.every(m=>!m.inHand));
});
test('apparel full-receipt endpoint uses conditional storage and leaves unverified readiness in review',async()=>{
 const batch=worker.buildBlanksBatch({id:'test-batch-123',orderedDate:'2026-11-13',orders:[{name:'#1',items:[{title:'Shirt',sku:'B1',qty:2}]}]});
 const objects=new Map(),key='';let seq=0,conflict=false,guarded=0;const bucket={
  async get(key){const record=objects.get(key);return record?{etag:record.etag,customMetadata:{},text:async()=>record.body}:null},async head(key){return this.get(key)},
  async put(key,body,options){if(options?.onlyIf){guarded++;if(conflict||objects.get(key)?.etag!==options.onlyIf.etagMatches)return null;}const etag=String(++seq);objects.set(key,{body,etag});return{etag,customMetadata:options?.customMetadata||{}};}
 };
 // Find the incumbent private key format through a create request first; no Shopify identity supplied.
 const create=new Request('https://worker.test/order-manager/blanks-batches',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:batch.id,orderedDate:batch.orderedDate,orders:[{name:'#1',items:[{title:'Shirt',sku:'B1',qty:2}]}]})});
 // captureGarmentCosts skips name-only legacy members, preserving the existing compatibility fixture.
 const created=await worker.handleBlanksBatches(create,{PREVIEWS:bucket},'*','Content-Type');assert.equal(created.status,201);const current=(await created.json()).batch;
 const request=()=>new Request('https://worker.test/order-manager/blanks-batches',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:current.id,action:'receive-all',confirmComplete:true,expectedUpdatedAt:current.updatedAt})});
 conflict=true;assert.equal((await worker.handleBlanksBatches(request(),{PREVIEWS:bucket},'*','Content-Type')).status,409);
 conflict=false;const response=await worker.handleBlanksBatches(request(),{PREVIEWS:bucket},'*','Content-Type');assert.equal(response.status,200);const result=await response.json();assert.equal(result.batch.totals.receivedGarments,2);assert.equal(result.receiptResults[0].outcome,'review');assert.equal(result.indexEntry.pendingReadinessOrders,1);assert.ok(guarded>=3);
});
test('terminal print checkpoint releases reservation in the same D1 transaction',async()=>{
 const f=fixture();let b=await f.service.create(f.body,'staff:1');b=await f.service.run({id:b.id,expectedRevision:b.revision,action:'mark-ordered'},'staff:1');
 const original=f.db.batch;let terminalTransactions=0;f.db.batch=async statements=>{if(statements.length>1)terminalTransactions++;return original(statements);};
 b=await f.service.run({id:b.id,expectedRevision:b.revision,action:'receive',confirmComplete:true},'staff:1');assert.ok(terminalTransactions>=2);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM print_material_members WHERE active=1').get().n,0);
 // A later distinct purchase can group these orders after canonical reset without a stranded reservation.
 for(const order of f.orders.values()){order.ready=false;order.savedSheet=true;order.ordered=false;}
 const replacement=await f.service.create({...f.body,id:'later-print-purchase'},'staff:1');assert.equal(replacement.members.length,2);
});
