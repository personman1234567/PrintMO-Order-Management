import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { webcrypto, createHmac } from 'node:crypto';
import { isSupplierService, claimSupplierAttempt, consolidateSupplierEvidence } from './supplier-submission.mjs';

globalThis.crypto ||= webcrypto;
const root = path.dirname(fileURLToPath(import.meta.url));
const workerSource = fs.readFileSync(path.join(root, 'worker.js'), 'utf8').replace(/from '(\.\/[^']+)'/g,
  (_, relative) => `from '${pathToFileURL(path.join(root, relative)).href}'`);
const worker = await import(`data:text/javascript;base64,${Buffer.from(workerSource+'\nexport { handleV1BatchCommit };').toString('base64')}`);
const schema = fs.readdirSync(path.join(root, 'migrations')).filter(name => /^\d+.*\.sql$/.test(name)).sort()
  .map(name => fs.readFileSync(path.join(root, 'migrations', name), 'utf8')).join('\n');
function database() {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec(schema);
  let failSavedOnce = false;
  const wrap = (sql, values = []) => ({ sql, values, bind: (...args) => wrap(sql, args),
    async run() {
      if (failSavedOnce && /UPDATE supplier_cart_reconciliations SET state = 'saved'/.test(sql)) { failSavedOnce = false; throw new Error('synthetic audit write interruption'); }
      const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } };
    },
    async first() { return sqlite.prepare(sql).get(...values) || null; },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; }
  });
  return { sqlite, failNextAuditSave() { failSavedOnce = true; }, prepare: sql => wrap(sql),
    async batch(statements) { sqlite.exec('BEGIN'); try { const results = statements.map(s => ({ meta: { changes: Number(sqlite.prepare(s.sql).run(...s.values).changes) } })); sqlite.exec('COMMIT'); return results; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } } };
}
const identity = { kind: 'partner', subject: 'synthetic-staff' };
const now = '2026-11-02T00:00:00.000Z';
async function setup() {
  const db = database();
  await db.prepare('INSERT INTO shops (id,shop_domain,installed_at,created_at,updated_at) VALUES (1,?,?,?,?)').bind('fixture.myshopify.com', now, now, now).run();
  return { db, env: { ORDER_DB: db, SHOPIFY_SHOP_DOMAIN: 'fixture.myshopify.com', UPSTREAM_BASE: 'https://supplier.synthetic.invalid', ORDER_MANAGER_ADMIN_KEY: 'synthetic', SS_TEST_ORDER: '1' } };
}
async function seedOrder(db, key = 'etsy:1:1', items = [{ id: 'l1', title: 'Shirt', supplierSku: 'A', quantity: 2 }]) {
  const id = key.split(':')[2];
  const contract = { displayName: `#${id}`, commerce: { lineItemsComplete: true, lineItems: items }, source: { provider: 'etsy' } };
  const state = { stage: 'to_order', revision: 0 };
  await db.prepare(`INSERT INTO provider_order_projection (shop_id,provider,provider_account_id,external_order_id,order_key,source_display_number,commerce_json,eligibility_state,enrollment_state,board_enrolled,fetched_at,created_at,updated_at)
    VALUES (1,'etsy','1',?,?,?,?,'eligible','active',1,?,?,?)`).bind(id, key, id, JSON.stringify(contract), now, now, now).run();
  await db.prepare(`INSERT INTO provider_production_state (shop_id,order_key,provider,provider_account_id,external_order_id,state_json,created_at,updated_at)
    VALUES (1,?,'etsy','1',?,?,?,?)`).bind(key, id, JSON.stringify(state), now, now).run();
}
async function seedBatch(db, id, keys, extra = {}) {
  await db.prepare(`INSERT INTO batches (id,shop_id,po_number,state,line_hash,request_json,response_json,expires_at,created_by,created_at,updated_at)
    VALUES (?,1,?,'confirmed','fixture',?,?,?,'staff',?,?)`).bind(id, id, JSON.stringify({ provider: 'etsy', operation: 'cart', orderKeys: keys, ...extra }), JSON.stringify({ outcome: 'partial' }), now, now, now).run();
}

const fixture = { requestedLines: [{ sku: 'A', qty: 6 }], lineSources: Array.from({ length: 6 }, (_, i) => ({ orderId: 'O'+i, orderName: '#'+i, sku: 'A', qty: 1, title: 'Shirt' })), orderIds: Array.from({ length: 6 }, (_, i) => 'O'+i), batchId: 'synthetic', poNumber: 'synthetic' };
const source = (orderId, sku='A', qty=2) => ({orderId,orderName:orderId,lineItemId:orderId+'-'+sku,sku,qty,title:'Synthetic shirt'});
async function attempt(db,id,state,sources,response={}) {
  const provider='etsy', orderKeys=[...new Set(sources.map(s=>s.orderId))];
  const quantities=new Map();for(const s of sources)quantities.set(s.sku,(quantities.get(s.sku)||0)+s.qty);
  const request={provider,operation:'order_placement',orderKeys,lineSources:sources,lines:[...quantities].map(([sku,qty])=>({sku,qty}))};
  await seedBatch(db,id,orderKeys,request);
  await db.prepare('UPDATE batches SET state=?,response_json=? WHERE id=?').bind(state,JSON.stringify(response),id).run();
}
const claim=(db,id,sources)=>claimSupplierAttempt(db,{shopId:1,provider:'etsy',lineSources:sources,batchId:id,now});

// Optional cross-repository gate: run against the gateway checkout's actual Express handler.
const gatewayFixturePath=process.env.PRINTMO_SUPPLIER_GATEWAY_FIXTURE;
test('complete captured throttle: actual Express HTTP -> Shopify Worker -> D1 -> UI; replaced-body ambiguity remains protected',
  {skip:!gatewayFixturePath},async()=>{
  const require=createRequire(import.meta.url),{createSupplierCommitFixture,fixtureGatewayKey}=require(gatewayFixturePath);
  const {db,env}=await setup(),gid='gid://shopify/Order/1';let nativeCalls=0,replaceBody=false;
  const app=createSupplierCommitFixture({nativeFetch:async(url,options)=>{
    assert.equal(String(url),'https://api.ssactivewear.com/v2/orders/');assert.equal(options.method,'POST');nativeCalls++;
    return Response.json({code:'503',message:'You are being throttled. Please wait 1 minute before your next request.'},
      {status:503,headers:{'Retry-After':'60','X-Rate-Limit-Remaining':'0'}});
  }});
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const origin=`http://127.0.0.1:${server.address().port}`;env.UPSTREAM_BASE=origin;env.ORDER_MANAGER_ADMIN_KEY=fixtureGatewayKey;
  await db.prepare(`INSERT INTO order_projection(shop_id,order_gid,display_name,stage,active,production_revision,production_json,commerce_json,created_at,updated_at)
    VALUES(1,?,'#synthetic','to_order',1,0,?,?,?,?)`).bind(gid,JSON.stringify({stage:'to_order',revision:0}),
      JSON.stringify({commerce:{lineItemsComplete:true,lineItems:[{id:'synthetic-line',sku:'B10259214',title:'Synthetic shirt',quantity:26}]}}),now,now).run();
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    assert(String(url).startsWith(origin+'/'));assert.equal(options.method,'POST');
    if(replaceBody)return new Response('<html>private fixture payload must never persist</html>',{status:502,headers:{'Content-Type':'text/html'}});
    return originalFetch(url,options);
  };
  const submit=key=>worker.handleV1BatchCommit(new Request('https://fixture/commit',{method:'POST',body:JSON.stringify({orderIds:[gid],idempotencyKey:key})}),env,'*','',identity);
  try{
    const first=await submit('captured-throttle-1');assert.equal(first.status,422);
    const report=(await first.json()).error.details.report;assert.equal(nativeCalls,1);assert.equal(report.failureKind,'rate_limited');
    assert.equal(report.supplierErrorCode,'503');assert.equal(report.upstreamHttpStatus,503);assert.equal(report.orderSubmissionAttempted,true);
    assert.equal(report.gatewayEvidence.bodyFormat,'json');assert.equal(report.gatewayEvidence.hasSupplierMessage,true);
    const persisted=JSON.parse((await db.prepare('SELECT response_json FROM batches WHERE id=?').bind(report.batchId).first()).response_json);
    assert.equal(persisted.supplierMessage,report.supplierMessage);assert.equal(persisted.retryAt,report.retryAt);assert.equal(persisted.gatewayEvidence.hasDispatchMarker,true);
    const ui=require('../order-manager-web/supplier-result-model.js');
    assert.match(ui.presentation(persisted).summary,/being throttled/);assert.match(ui.presentation(persisted).nextStep,/Retry after/);
    assert.equal((await submit('captured-throttle-1')).status,422);assert.equal(nativeCalls,1,'same key replays without dispatch');
    assert.equal((await submit('captured-throttle-2')).status,409);assert.equal(nativeCalls,1,'early deliberate retry observes cooldown');
    // Advance only synthetic persisted cooldown; production history is never used or changed.
    await db.prepare("UPDATE batches SET response_json=json_set(response_json,'$.retryAt','2000-01-01T00:00:00.000Z') WHERE id=?").bind(report.batchId).run();
    replaceBody=true;
    const ambiguous=(await(await submit('replaced-body-fixture')).json()).error.details.report;
    assert.equal(ambiguous.outcome,'unknown');assert.equal(ambiguous.failureKind,null);assert.equal(ambiguous.orderSubmissionAttempted,null);
    assert.equal(ambiguous.gatewayEvidence.bodyFormat,'non_json');assert.equal(ambiguous.gatewayEvidence.contentType,'text/html');
    const stored=JSON.parse((await db.prepare('SELECT response_json FROM batches WHERE id=?').bind(ambiguous.batchId).first()).response_json);
    assert.equal(stored.gatewayEvidence.hasDispatchMarker,false);assert.doesNotMatch(JSON.stringify(stored),/private fixture payload|<html>|synthetic-api-key/);
    assert.match(ui.presentation(stored).summary,/gateway returned HTTP 502/i);
    assert.equal((await submit('still-unknown-fixture')).status,409);assert.equal(nativeCalls,1,'ambiguity and cooldown never schedule automatic supplier POSTs');
  }finally{globalThis.fetch=originalFetch;await new Promise(resolve=>server.close(resolve));}
});

test('captured 503 retains native status, message, original time and tri-state dispatch',()=>{
  const payload={outcome:'unknown',upstreamHttpStatus:503,error:{message:'S&S rejected the order request (HTTP 503).'},responseBodyFormat:'non_json'};
  for(const marker of [true,false,undefined]) {
    const report=worker.normalizeSupplierCommitReport({...fixture,payload:{...payload,...(marker===undefined?{}:{orderSubmissionAttempted:marker})},
      error:Object.assign(new Error(payload.error.message),{status:502}),attemptStartedAt:'2026-11-02T23:29:57.535Z'});
    assert.equal(report.upstreamHttpStatus,503);assert.equal(report.httpStatus,502);
    assert.equal(report.supplierMessage,payload.error.message);assert.equal(report.attemptStartedAt,'2026-11-02T23:29:57.535Z');
    assert.equal(report.orderSubmissionAttempted,marker??null);assert.equal(report.preflightFailed,marker===false);
    assert.equal(report.postResultUncertain,marker??null);assert.equal(report.outcome,marker===false?'rejected':'unknown');
  }
});

const throttlePayload={outcome:'unknown',upstreamHttpStatus:503,responseBodyFormat:'json',orderSubmissionAttempted:true,
  error:{code:'503',message:'You are being throttled. Please wait 1 minute before your next request.'}};
const normalizeThrottle=(payload=throttlePayload)=>worker.normalizeSupplierCommitReport({...fixture,payload,error:Object.assign(new Error('Supplier response'),{status:502})});
test('only the explicit native throttle is rate limited; generic or contradictory 503 remains uncertain',()=>{
  const rate=normalizeThrottle();assert.equal(rate.failureKind,'rate_limited');assert.equal(rate.outcome,'rejected');
  assert.equal(rate.orderSubmissionAttempted,true);assert.equal(rate.preflightFailed,false);assert.equal(rate.postResultUncertain,false);
  assert(Date.parse(rate.retryAt)-Date.parse(rate.recordedAt)>=60000);
  for(const patch of [{error:{code:'503',message:'Service unavailable.'}},{error:{message:throttlePayload.error.message}},
    {responseBodyFormat:'non_json'},{orderSubmissionAttempted:undefined},{Orders:[{OrderNumber:'SYN-PLACED'}]},
    {Orders:[{}]},{acceptedLines:[{sku:'A',acceptedQty:1}]}]){
    const result=normalizeThrottle({...throttlePayload,...patch});assert.equal(result.failureKind,null);assert.equal(result.outcome,'unknown');
  }
});

test('verified throttle cooldown blocks early retry then permits a new intent; same key and generic ambiguity remain held',async()=>{
  const {db}=await setup(),sources=[source('etsy:1:1')],rate=normalizeThrottle();
  rate.retryAt='2026-11-02T00:01:00.000Z';await attempt(db,'rate-limited','failed',sources,rate);await attempt(db,'intentional-retry','prepared',sources);
  await assert.rejects(()=>claim(db,'intentional-retry',sources),error=>error.code==='BATCH_REVIEW_REQUIRED'&&error.body.report.failureKind==='rate_limited');
  const claimLater=(id,at)=>claimSupplierAttempt(db,{shopId:1,provider:'etsy',lineSources:sources,batchId:id,now:at});
  await claimLater('intentional-retry','2026-11-02T00:01:01.000Z');
  await assert.rejects(()=>claimLater('rate-limited','2026-11-02T00:01:02.000Z'));
  await db.prepare("UPDATE batches SET state='confirmed' WHERE id='intentional-retry'").run();
  await attempt(db,'other-unknown','unknown',sources,{outcome:'unknown',httpStatus:502});await attempt(db,'still-protected','prepared',sources);
  await assert.rejects(()=>claimLater('still-protected','2026-11-02T00:01:03.000Z'),error=>error.code==='BATCH_REVIEW_REQUIRED');
});

test('owner audit resolves only its unchanged failed attempt; other unknown and same-intent claims stay protected',async()=>{
  const {db}=await setup(),sources=[source('etsy:1:1')],saved={outcome:'unknown',httpStatus:502};
  await attempt(db,'failed-503','unknown',sources,saved);
  const original=await db.prepare("SELECT * FROM batches WHERE id='failed-503'").first();
  const resolution={originalLineHash:original.line_hash,originalUpdatedAt:original.updated_at,originalResponseJson:original.response_json,actor:'synthetic-owner'};
  await db.prepare("INSERT INTO supplier_attempts(id,batch_id,attempt_type,outcome,response_json,created_at) VALUES('owner-resolution','failed-503','owner_retry_resolution','owner_authorized_retry',?,?)").bind(JSON.stringify(resolution),now).run();
  await attempt(db,'fresh','prepared',sources);await claim(db,'fresh',sources);
  assert.equal((await db.prepare("SELECT response_json FROM batches WHERE id='failed-503'").first()).response_json,original.response_json);
  await assert.rejects(()=>claim(db,'failed-503',sources),error=>error.code==='BATCH_REVIEW_REQUIRED'||error.code==='BATCH_RECONCILIATION_REQUIRED');
  await db.prepare("UPDATE batches SET state='confirmed' WHERE id='fresh'").run();
  await attempt(db,'other-unknown','unknown',sources,saved);await attempt(db,'blocked','prepared',sources);
  await assert.rejects(()=>claim(db,'blocked',sources),error=>error.code==='BATCH_REVIEW_REQUIRED');
  await db.prepare("UPDATE batches SET state='confirmed' WHERE id='other-unknown'").run();
  await db.prepare("UPDATE batches SET updated_at='changed-after-review' WHERE id='failed-503'").run();
  await assert.rejects(()=>claim(db,'blocked',sources),error=>error.code==='BATCH_REVIEW_REQUIRED');
});

test('native order confirmation survives partial detail and native rejection coexists with orders',()=>{
  const short=worker.normalizeSupplierCommitReport({...fixture,payload:{ok:true,orderNumber:'SYN-1',acceptedLines:[{sku:'A',acceptedQty:5}]}});
  assert.equal(short.outcome,'confirmed');assert.equal(short.placementOutcome,'confirmed');assert.equal(short.detailOutcome,'partial');assert.equal(short.totals.reportedAcceptedUnits,5);assert.equal(short.acceptedOrderCount,0);
  const partial=worker.normalizeSupplierCommitReport({...fixture,payload:{Orders:[{OrderNumber:'SYN-2',Lines:[{Sku:'A',QtyOrdered:5}]}],LineErrors:[{Identifier:'A',Message:'One unavailable'}]}});
  assert.equal(partial.outcome,'partial');assert.equal(partial.supplierOrderNumber,'SYN-2');assert.equal(partial.rejectedLines[0].reason,'One unavailable');assert.equal(partial.lineResults.length,1);
  const missingDetail=worker.normalizeSupplierCommitReport({...fixture,payload:{Orders:[{OrderNumber:'SYN-PARTIAL'}],LineErrors:[{Message:'Some items unavailable'}]}});
  assert.equal(missingDetail.placementOutcome,'partial');assert.equal(missingDetail.supplierOrderNumber,'SYN-PARTIAL');assert.equal(missingDetail.rejectedLines[0].reason,'Some items unavailable');
  const rejected=worker.normalizeSupplierCommitReport({...fixture,error:Object.assign(new Error('bad SKU'),{status:400}),payload:{errors:[{field:'lines[0].identifier',message:'SKU not found'}]}});
  assert.equal(rejected.outcome,'rejected');assert.equal(rejected.rejectedLines[0].reason,'SKU not found');
});

test('zero and missing detail differ without replacing known placement with unknown',()=>{
  const zero=worker.normalizeSupplierCommitReport({...fixture,payload:{ok:true,orderNumber:'SYN-0',acceptedLines:[{sku:'A',acceptedQty:0}]}});
  assert.equal(zero.outcome,'confirmed');assert.equal(zero.lineResults[0].reportedAcceptedQty,0);assert.equal(zero.detailOutcome,'partial');
  const missing=worker.normalizeSupplierCommitReport({...fixture,payload:{ok:true,orderNumber:'SYN-M',acceptedLines:[{sku:'A',acceptedQty:null}]}});
  assert.equal(missing.outcome,'confirmed');assert.equal(missing.lineResults[0].reportedAcceptedQty,null);assert.equal(missing.detailOutcome,'unresolved');
  const timeout=worker.normalizeSupplierCommitReport({...fixture,error:Object.assign(new Error('timeout'),{status:502}),payload:{orderSubmissionAttempted:true}});
  assert.equal(timeout.outcome,'unknown');assert.equal(timeout.supplierOrderNumber,null);
});

test('pure line evidence preserves native zero and does not coerce missing quantities into zero',()=>{
  for(const value of [null,undefined,'']) {
    const r=consolidateSupplierEvidence({...fixture,outcome:'confirmed',acceptedLines:[{sku:'A',acceptedQty:value}]});
    assert.equal(r.lineResults[0].reportedAcceptedQty,null);assert.equal(r.acceptanceEvidence,'unconfirmed');
  }
  const zero=consolidateSupplierEvidence({...fixture,outcome:'confirmed',acceptedLines:[{sku:'A',acceptedQty:0}]});
  assert.equal(zero.acceptanceEvidence,'supplier_reported');assert.equal(zero.lineResults[0].reportedAcceptedQty,0);assert.equal(zero.lineResults[0].fullyCovered,false);
});

test('summary-only compatibility and old aggregate-derived gateway quantities stay labelled',()=>{
  for(const payload of [{ok:true,orderNumber:'SYN-S'}, {ok:true,Orders:[{OrderNumber:'SYN-S',Lines:[]}],acceptedLines:[{sku:'A',acceptedQty:6}]}, {ok:true,Orders:[{OrderNumber:'SYN-S'}],acceptedLines:[{sku:'A',acceptedQty:6}],acceptanceEvidence:'summary_confirmed'}]) {
    const r=worker.normalizeSupplierCommitReport({...fixture,payload});assert.equal(r.outcome,'confirmed');assert.equal(r.acceptanceEvidence,'summary_confirmed');assert.equal(r.totals.reportedAcceptedUnits,null);
  }
  const native=worker.normalizeSupplierCommitReport({...fixture,payload:{ok:true,Orders:[{OrderNumber:'SYN-N'}],acceptedLines:[{sku:'A',acceptedQty:6}],acceptanceEvidence:'supplier_reported'}});
  assert.equal(native.acceptanceEvidence,'supplier_reported');assert.equal(native.totals.reportedAcceptedUnits,6);
});

test('labelled 1845 saved-shape fixture keeps returned reference and unresolved identifiers without alias guessing',()=>{
  const r=worker.normalizeSupplierCommitReport({requestedLines:[{sku:'B10259214',qty:2}],lineSources:[source('SYN-1845','B10259214',2)],orderIds:['SYN-1845'],batchId:'saved-shape-fixture',poNumber:'fixture',payload:{ok:true,Orders:[{OrderNumber:'77535278'}],acceptedLines:[{sku:'3362607',acceptedQty:2}]}});
  assert.equal(r.outcome,'confirmed');assert.equal(r.supplierOrderNumber,'77535278');assert.equal(r.detailOutcome,'unresolved');assert.equal(r.lineResults[0].sku,'B10259214');assert.equal(r.lineResults[0].reportedAcceptedQty,null);assert.equal(r.unmatchedAcceptedLines[0].sku,'3362607');assert.equal(r.unmatchedAcceptedLines[0].acceptedQty,2);assert.equal(r.acceptedOrderCount,0);assert(r.issues.some(i=>i.code==='SUPPLIER_IDENTIFIER_UNMATCHED'));
});

test('native sku precedes internal skuID regardless of supplier object property order',()=>{
  for(const line of [{skuID:3362607,sku:'B10259214',qtyOrdered:2},{sku:'B10259214',skuID:3362607,qtyOrdered:2}]) {
    const r=worker.normalizeSupplierCommitReport({requestedLines:[{sku:'B10259214',qty:2}],lineSources:[source('SYN-ORDER','B10259214')],orderIds:['SYN-ORDER'],batchId:'synthetic',poNumber:'synthetic',payload:{Orders:[{OrderNumber:'SYN-RETURN',Lines:[line]}]}});
    assert.equal(r.outcome,'confirmed');assert.equal(r.lineResults[0].reportedAcceptedQty,2);assert.equal(r.unmatchedAcceptedLines.length,0);
  }
});

test('only the exact artwork service is excluded; physical PM products remain',()=>{
  assert(isSupplierService({sku:'PM-ART-BG-REMOVE'}));assert(!isSupplierService({sku:'PM-PHYSICAL'}));
  const rows=[{order_gid:'O',commerce_json:JSON.stringify({commerce:{lineItemsComplete:true,lineItems:[{sku:'PM-ART-BG-REMOVE',title:'Artwork',quantity:1},{sku:'PM-PHYSICAL',title:'Shirt',quantity:2}]}})}];
  assert.deepEqual(worker.supplierLinesFromProjectionRows(rows),[{sku:'PM-PHYSICAL',qty:2}]);
});

test('atomic existing-attempt claim protects simultaneous fresh keys and genuine unknown demand',async()=>{
  const {db}=await setup(),sources=[source('etsy:1:1')];await attempt(db,'C1','prepared',sources);await attempt(db,'C2','prepared',sources);
  const results=await Promise.allSettled([claim(db,'C1',sources),claim(db,'C2',sources)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  await attempt(db,'unrelated','prepared',[source('etsy:1:2')]);await claim(db,'unrelated',[source('etsy:1:2')]);
});

test('known historic order with identifier mismatch does not block a new intent or rewrite history',async()=>{
 const {db}=await setup(),sources=[source('etsy:1:1845','B10259214')],saved={outcome:'unknown',supplierOrderNumbers:['77535278'],httpStatus:null,issues:[{code:'SUPPLIER_QUANTITY_MISMATCH'}]};
 await attempt(db,'old-1845','unknown',sources,saved);await attempt(db,'new-intent','prepared',sources);await claim(db,'new-intent',sources);
 assert.equal((await db.prepare("SELECT state FROM batches WHERE id='new-intent'").first()).state,'submitting');
 assert.equal((await db.prepare("SELECT response_json FROM batches WHERE id='old-1845'").first()).response_json,JSON.stringify(saved));
});

test('known completed placement with unmatched identifiers permits a deliberately new order intent',async()=>{
 const {db}=await setup(),sources=[source('etsy:1:1845','B10259214',2)];
 const saved=worker.normalizeSupplierCommitReport({requestedLines:[{sku:'B10259214',qty:2}],lineSources:sources,orderIds:['etsy:1:1845'],batchId:'known-native',poNumber:'fixture',payload:{ok:true,Orders:[{OrderNumber:'77535278'}],acceptedLines:[{sku:'3362607',acceptedQty:2}]}});
 assert.equal(saved.outcome,'confirmed');assert.equal(saved.detailOutcome,'unresolved');assert.equal(saved.lineResults[0].reportedAcceptedQty,null);
 await attempt(db,'known-native','confirmed',sources,saved);await attempt(db,'new-native-intent','prepared',sources);await claim(db,'new-native-intent',sources);
 assert.equal((await db.prepare('SELECT COUNT(*) count FROM supplier_order_holds').first()).count,0);
});

test('confirmed history and obsolete hold rows do not lifetime-block new demand or get purged',async()=>{
  const {db}=await setup(),sources=[source('etsy:1:1')];await attempt(db,'old-success','confirmed',sources,{outcome:'confirmed',supplierOrderNumbers:['SYN-OLD']});
  await db.prepare("INSERT INTO supplier_order_holds(shop_id,provider,order_key,batch_id,created_at) VALUES(1,'etsy','etsy:1:1','old-success',?)").bind(now).run();
  await attempt(db,'new-success-key','prepared',sources);await claim(db,'new-success-key',sources);
  assert.equal((await db.prepare('SELECT COUNT(*) count FROM supplier_order_holds').first()).count,1);
});

test('known partial placement and exact artwork error remain evidence rather than a lifetime ordering ban',async()=>{
 const {db}=await setup(),sources=[source('etsy:1:1','A')],saved={outcome:'partial',supplierOrderNumbers:['SYN-PLACED'],acceptedLines:[{sku:'INTERNAL-ID',acceptedQty:2}],rejectedLines:[{sku:null,reason:'Item Identifier PM-ART-BG-REMOVE - Invalid Warehouse ItemIdentifier Combination'}]};
 await attempt(db,'old-partial','confirmed',sources,saved);await attempt(db,'new-partial-intent','prepared',sources);await claim(db,'new-partial-intent',sources);
 assert.equal((await db.prepare("SELECT response_json FROM batches WHERE id='old-partial'").first()).response_json,JSON.stringify(saved));
 const other=[source('etsy:1:2','A')];await attempt(db,'unrelated-partial','prepared',other);await claim(db,'unrelated-partial',other);
});

test('transport ambiguity outranks a reference while deterministic failure stays retryable',async()=>{
 const {db}=await setup(),sources=[source('etsy:1:1')];
 await attempt(db,'failed-transport','failed',sources,{outcome:'rejected',supplierOrderNumbers:['SYN-MAYBE'],httpStatus:503,preflightFailed:false,acceptedLines:[{sku:'A',acceptedQty:2}]});
 await attempt(db,'same-demand','prepared',sources);await assert.rejects(()=>claim(db,'same-demand',sources),e=>e.code==='BATCH_REVIEW_REQUIRED');
 const other=[source('etsy:1:2')];await attempt(db,'failed-before-post','failed',other,{outcome:'rejected',httpStatus:503,preflightFailed:true});
 await attempt(db,'safe-retry','prepared',other);await claim(db,'safe-retry',other);
});

test('retired cart-review and cart-confirmation routes cannot mutate audit or order records',async()=>{
  const {db,env}=await setup();Object.assign(env,{SHOPIFY_API_KEY:'synthetic-client',SHOPIFY_API_SECRET:'synthetic-secret',PARTNER_USER_IDS:'synthetic-staff'});
  const nowSeconds=Math.floor(Date.now()/1000),header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const payload=Buffer.from(JSON.stringify({aud:'synthetic-client',dest:'https://fixture.myshopify.com',iss:'https://fixture.myshopify.com/admin',sub:'synthetic-staff',iat:nowSeconds,nbf:nowSeconds-5,exp:nowSeconds+300})).toString('base64url');
  const token=header+'.'+payload+'.'+createHmac('sha256','synthetic-secret').update(header+'.'+payload).digest('base64url');
  const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('Unexpected external call');};
  try {
    for(const [route,method] of [['cart-review','GET'],['cart-reconcile','POST'],['retry-review','POST']]) {
      const response=await worker.default.fetch(new Request('https://worker.test/order-manager/v1/batches/'+route,{method,headers:{Authorization:'Bearer '+token,...(method==='POST'?{'Content-Type':'application/json'}:{})},...(method==='POST'?{body:JSON.stringify({orders:[]})}:{})}),env);
      assert.equal(response.status,410);assert.match((await response.json()).error.code,/RETIRED/);
    }
    assert.equal(calls,0);assert.equal((await db.prepare('SELECT COUNT(*) count FROM supplier_cart_reconciliations').first()).count,0);
  }finally{globalThis.fetch=original;}
});

test('real commit retains operation/test flag, original idempotency and narrow partial protection',async()=>{
  const {db,env}=await setup();await seedOrder(db,'etsy:1:1',[{id:'a',title:'Shirt',supplierSku:'A',quantity:2},{id:'b',title:'Other',supplierSku:'B',quantity:1},{id:'fee',title:'Artwork',supplierSku:'PM-ART-BG-REMOVE',quantity:1}]);await seedOrder(db,'etsy:1:2');
  const originalFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=async(url,options)=>{assert.match(String(url),/^https:\/\/supplier\.synthetic\.invalid\//);calls++;const body=JSON.parse(options.body);assert.equal(body.testOrder,true);assert(!body.lines.some(l=>l.sku==='PM-ART-BG-REMOVE'));return Response.json(calls===1?{outcome:'partial',Orders:[{OrderNumber:'SYN-PLACED',Lines:[{Sku:'A',QtyOrdered:2}]}],acceptedLines:[{sku:'A',acceptedQty:2}],LineErrors:[{Identifier:'B',Message:'Unavailable'}],testOrder:false}:{ok:true,orderNumber:'SYN-OTHER'});};
  try{
    const submit=(orderKey,idempotencyKey)=>worker.handleProviderBatchCommit(new Request('https://fixture/commit',{method:'POST',body:JSON.stringify({orderKeys:[orderKey],idempotencyKey})}),env,'*','',identity);
    const first=await(await submit('etsy:1:1','native-partial-1')).json();assert.equal(first.outcome,'partial');assert.equal(first.operation,'order_placement');assert.equal(first.testOrder,true);assert.equal(first.supplierOrderNumber,'SYN-PLACED');
    assert.equal((await submit('etsy:1:1','native-partial-1')).status,207);assert.equal(calls,1);
    assert.equal((await submit('etsy:1:1','native-partial-2')).status,200);assert.equal(calls,2);
    assert.equal((await submit('etsy:1:2','native-unrelated')).status,200);assert.equal(calls,3);
    assert.equal((await db.prepare('SELECT COUNT(*) count FROM supplier_order_holds').first()).count,0);
    assert.equal(JSON.parse((await db.prepare("SELECT commerce_json FROM provider_order_projection WHERE order_key='etsy:1:1'").first()).commerce_json).commerce.lineItems.length,3);
  }finally{globalThis.fetch=originalFetch;}
});

test('Shopify archive aliases and unknown legacy deletion remain forbidden',async()=>{
  const {env}=await setup();for(const field of ['archivedAt','archived_at'])assert.equal((await worker.handleV1ProductionPatch(new Request('https://fixture/order-manager/v1/orders/gid%3A%2F%2Fshopify%2FOrder%2F1/production',{method:'PATCH',body:JSON.stringify({expectedVersion:0,idempotencyKey:'archive-synthetic',patch:{[field]:true}})}),env,'*','',identity)).status,403);
  assert.equal((await worker.handleLegacyQueueDelete(new Request('https://fixture/legacy',{method:'DELETE'}),env,'*','')).status,403);
});

test('a real ambiguous earlier POST blocks without mixing its two units into the current 27-unit selection',async()=>{
 const {db}=await setup(),oldSources=[source('etsy:1:1845','B10259214',2)],saved={outcome:'unknown',httpStatus:502,acceptedLines:[{sku:'3362607',acceptedQty:2}]};
 await attempt(db,'real-unknown','unknown',oldSources,saved);
 const current=[...oldSources,source('etsy:1:2000','OTHER',25)];await attempt(db,'current-27','prepared',current);
 let blocked;try{await claim(db,'current-27',current);}catch(error){blocked=error;}
 const report=blocked.body.report;assert.equal(report.batchId,'current-27');assert.equal(report.totals.requestedUnits,27);assert.equal(report.orderCount,2);
 assert.equal(report.lineResults.length,0);assert.equal(report.previousResults[0].acceptedLines[0].acceptedQty,2);assert.equal(report.supplierRequestSent,false);
 const unrelated=[source('etsy:1:3000','NEW')];await attempt(db,'unrelated-current','prepared',unrelated);await claim(db,'unrelated-current',unrelated);
 assert.equal((await db.prepare("SELECT response_json FROM batches WHERE id='real-unknown'").first()).response_json,JSON.stringify(saved));
});

test('saved-sheet tracking retires on ordered or in-hand while independent readiness and supplier history survive',()=>{
  let state=worker.normalizeProductionState({batchRefs:['KEEP-SUPPLIER-REFERENCE'],readiness:{}});
  state=worker.applyProductionPatch(state,{printsOnSavedSheet:true},'fixture','sheet');assert.equal(state.printsOnSavedSheet,true);
  state=worker.applyProductionPatch(state,{printsOrdered:1},'fixture','ordered');assert.equal(state.printsOnSavedSheet,false);
  state=worker.applyProductionPatch(state,{printsOrdered:0},'fixture','reverse');assert.equal(state.printsOnSavedSheet,false);
  state=worker.applyProductionPatch(state,{printsStatus:1,blanksStatus:1},'fixture','shelf');
  assert.equal(state.readiness.printsOrdered,false);assert.equal(state.readiness.printsReady,true);assert.equal(state.readiness.blanksReady,true);
  state=worker.applyProductionPatch(state,{printsStatus:0,blanksStatus:0,printsOnSavedSheet:false},'fixture','not-recorded');
  assert.deepEqual(state.batchRefs,['KEEP-SUPPLIER-REFERENCE']);assert.equal(worker.productionForClient('fixture',state).printsOnSavedSheet,false);
});
