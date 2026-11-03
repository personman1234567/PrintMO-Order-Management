const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../order-manager-web/supplier-result-model.js');

// Labelled saved-response fixture supplied by the read-only audit. No live call.
const saved1845 = { batchId: 'fixture-1845', outcome: 'unknown', operation: 'cart', supplierOrderNumbers: ['77535278'],
  acceptanceEvidence: 'unconfirmed', orderResults: [{ orderId: 'fixture-order', orderName: '#1845' }],
  acceptedLines: [{ sku: '3362607', acceptedQty: 2 }], rejectedLines: [],
  lineResults: [{ sku: 'B10259214', itemNames: ['Tultex 202 / Military Green / Medium'], orderNames: ['#1845'], requestedQty: 2, reportedAcceptedQty: null, status: 'unconfirmed' }],
  issues: [{ code: 'SUPPLIER_QUANTITY_MISMATCH', reason: 'The returned identifiers do not match the request.' }],
  totals: { requestedUnits: 2, reportedAcceptedUnits: 0 } };

test('saved #1845 keeps native order and reported units separate from unresolved item matching', () => {
  const before = JSON.stringify(saved1845), view = model.presentation(saved1845);
  assert.equal(view.title, 'S&S returned order 77535278');
  assert.equal(view.summary, 'S&S reported 2 units. Item matching needs review.');
  assert.equal(view.report.lineResults[0].sku, 'B10259214');
  assert.equal(view.report.lineResults[0].requestedQty, 2);
  const returned = view.report.lineResults.find(line => line.sku === '3362607');
  assert.equal(returned.reportedAcceptedQty, 2);
  assert.equal(returned.requestedQty, null);
  assert.equal(returned.status, 'identifier_review');
  assert.match(view.nextStep, /cancel it.*choose Yes/);
  assert.doesNotMatch(JSON.stringify(view), /not a placed purchase|unexpected purchase|no order placed/i);
  assert.equal(JSON.stringify(saved1845), before, 'presentation must not rewrite saved supplier evidence');
});

test('official partial order response and native item errors remain visible', () => {
  const view = model.presentation({ placementOutcome: 'partial', detailOutcome: 'partial', supplierOrderNumbers: ['fixture-order-number'],
    acceptedLines: [{ sku: 'SHIRT-M', acceptedQty: 3 }],
    rejectedLines: [{ sku: 'SHIRT-M', reason: 'Only 3 units available in this warehouse.' }],
    lineResults: [{ sku: 'SHIRT-M', requestedQty: 4, reportedAcceptedQty: 3, notAcceptedQty: 1, status: 'partial', issues: [{ reason: 'Only 3 units available in this warehouse.' }] }] });
  assert.equal(view.report.placementOutcome, 'partial');
  assert.match(view.title, /returned order fixture-order-number/);
  assert.equal(view.report.nativeErrors[0].reason, 'Only 3 units available in this warehouse.');
  assert.equal(view.exceptions[0].reportedAcceptedQty, 3);
  assert.equal(view.exceptions[0].notAcceptedQty, 1);
});

test('missing quantity, explicit zero and native rejection are not interchangeable', () => {
  const view = model.presentation({ outcome: 'rejected', rejectedLines: [{ sku: 'MISSING', reason: 'Identifier was not found.' }],
    lineResults: [{ sku: 'ZERO', requestedQty: 2, reportedAcceptedQty: 0, status: 'review' }, { sku: 'MISSING', requestedQty: 2, reportedAcceptedQty: null, status: 'not_accepted', issues: [{ reason: 'Identifier was not found.' }] }] });
  assert.equal(view.report.lineResults[0].reportedAcceptedQty, 0);
  assert.equal(view.report.lineResults[1].reportedAcceptedQty, null);
  assert.equal(view.report.lineResults[1].notAcceptedQty, null);
  assert.equal(view.title, 'S&S rejected the request');
  assert.equal(view.summary, 'Identifier was not found.');
});

test('summary-only confirmation does not manufacture supplier-reported quantities', () => {
  const view = model.presentation({ outcome: 'confirmed', supplierOrderNumbers: ['summary-response'], acceptanceEvidence: 'summary_confirmed',
    acceptedLines: [{ sku: 'SHIRT-M', requestedQty: 4, acceptedQty: 4 }], totals: { reportedAcceptedUnits: 4 } });
  assert.equal(view.report.reportedUnits, null);
  assert.equal(view.report.lineResults[0].reportedAcceptedQty, null);
  assert.match(view.title, /returned order summary-response/);
});

test('genuine unknown transport result has one Order History instruction and retains any reported values', () => {
  const view = model.presentation({ outcome: 'unknown', lineResults: [{ sku: 'SHIRT-M', requestedQty: 4, reportedAcceptedQty: 1, status: 'unconfirmed' }] });
  assert.equal(view.title, 'S&S order result not confirmed');
  assert.match(view.warning, /may have reached S&S/);
  assert.equal(view.report.lineResults[0].reportedAcceptedQty, 1);
  assert.equal(view.nextStep, '');
});

test('preflight no-send message stays distinct from unknown placement', () => {
  const view = model.presentation({ preflightFailed: true, outcome: 'rejected', rejectedLines: [{ reason: 'Supplier authentication is unavailable.' }] });
  assert.equal(view.title, 'Nothing was sent to S&S');
  assert.equal(view.warning, '');
  assert.equal(view.nextStep, '');
  assert.equal(view.report.nativeErrors[0].reason, 'Supplier authentication is unavailable.');
});

test('native 503 and earlier attempt time remain visible while current selection was not sent',()=>{
  const previous={outcome:'unknown',supplierMessage:'Service unavailable.',upstreamHttpStatus:503,attemptStartedAt:'2026-11-02T23:29:57.535Z'};
  assert.match(model.presentation(previous).summary,/S&S HTTP 503: Service unavailable/);
  const blocked=model.presentation({outcome:'unknown',submissionAction:'blocked',supplierRequestSent:false,
    totals:{requestedUnits:26},orderCount:6,actionMessage:'This selection was not sent.',previousResults:[previous]});
  assert.match(blocked.summary,/26 garments across 6 orders/);assert.match(blocked.summary,/selection was not sent/);
  assert.match(blocked.summary,/2026-11-02T23:29:57.535Z/);assert.match(blocked.summary,/HTTP 503/);
});

test('explicit throttling gives a retry time without claiming nothing was placed or retrying automatically',()=>{
  const report={outcome:'rejected',failureKind:'rate_limited',orderSubmissionAttempted:true,preflightFailed:false,
    upstreamHttpStatus:503,supplierMessage:'You are being throttled. Please wait 1 minute before your next request.',retryAt:new Date(Date.now()+60000).toISOString(),
    lineResults:[{sku:'A',requestedQty:26,status:'not_accepted',issues:[]}]};
  const view=model.presentation(report);assert.equal(view.title,'S&S asked you to wait');assert.match(view.summary,/being throttled/);
  assert.match(view.nextStep,/Retry after/);assert.match(view.nextStep,/Nothing will be retried automatically/);assert.equal(view.exceptions.length,0);
  assert.doesNotMatch(JSON.stringify(view),/Nothing was sent|nothing was placed/);
  const blocked=model.presentation({...report,submissionAction:'blocked',supplierRequestSent:false,orderCount:6,totals:{requestedUnits:26}});
  assert.match(blocked.title,/nothing new sent/);assert.doesNotMatch(blocked.nextStep,/Order History/);
});

test('blocked and saved actions never masquerade as a fresh unknown supplier request', () => {
  const saved={outcome:'unknown',supplierOrderNumbers:['77535278'],submissionAction:'blocked',supplierRequestSent:false,
    actionMessage:'No new S&S request was sent. Review the earlier attempt.'};
  const blocked=model.presentation(saved);assert.equal(blocked.title,'Submission blocked — nothing new sent');
  assert.match(blocked.summary,/No new S&S request/);assert.equal(blocked.warning,'');
  assert.match(model.presentation({...saved,submissionAction:'saved'}).title,/Saved result.*77535278/);
  assert.match(model.presentation({...saved,submissionAction:'replayed'}).summary,/No new supplier request/);
});

test('web adapter saves material state atomically and retains the same submission intent only during ambiguity', async () => {
  const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
  const code=fs.readFileSync(path.join(__dirname,'../order-manager-web/web-shim.js'),'utf8');
  const order={name:'#fixture',_provider:'etsy',_orderKey:'etsy:1:1',status:'toOrder',canonical:{supplierAttention:{requiresReview:true,submissionBlocked:true}}};
  const calls=[],context={window:{api:{}},Date,Set,Map,JSON,
    isShopifyCandidateView:()=>true,candidateByName:()=>order,candidateIdentity:o=>JSON.stringify([o._provider,o._orderKey]),
    newIdempotencyKey:()=>`fixture-key-${calls.length+1}`,updateCandidateOrder:async(reference,patch)=>{calls.push({reference,patch});},
    apiFetch:async(route,options)=>{const body=JSON.parse(options.body);calls.push({route,body});
      if(route.endsWith('/retry-review'))return{ok:true,supplierRequestSent:false};
      if(calls.filter(c=>c.route?.endsWith('/commit')).length===1)throw new TypeError('Synthetic network interruption');
      return{outcome:'confirmed',orderResults:[{orderId:'etsy:1:1',outcome:'confirmed'}]};
    }};
  vm.runInNewContext(code.slice(code.indexOf('window.api.updateReady ='),code.indexOf('window.api.updateProgress =')),context);
  const reference={provider:'etsy',orderKey:'etsy:1:1'};
  await context.window.api.updateReady(reference,{stage:'blanks_cart',blanksOrdered:0,printsOnSavedSheet:true});
  assert.equal(calls[0].reference,reference);assert.equal(calls[0].patch.stage,'blanks_cart');assert.equal(calls[0].patch.prints_on_saved_sheet,true);
  vm.runInNewContext(code.slice(code.indexOf('const pendingSupplierIntents ='),code.indexOf('window.api.createBlanksBatch =')),context);
  await assert.rejects(()=>context.window.api.processBatch(['#fixture']),/Synthetic network interruption/);
  const first=calls.find(c=>c.route?.endsWith('/commit')).body.idempotencyKey;
  await context.window.api.processBatch(['#fixture']);
  assert.equal(calls.filter(c=>c.route?.endsWith('/commit'))[1].body.idempotencyKey,first);
  await context.window.api.processBatch(['#fixture']);
  assert.notEqual(calls.filter(c=>c.route?.endsWith('/commit'))[2].body.idempotencyKey,first,'a completed intent does not reuse its key for a deliberately new order');
});
