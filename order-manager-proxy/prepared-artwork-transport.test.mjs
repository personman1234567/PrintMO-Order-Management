import test from 'node:test';
import assert from 'node:assert/strict';
import {readPreparedBody,assertPreparedArtworkSize,validatePreparedReferences,hydratePreparedSvg,hydratePreparedSvgBlob,logPreparedFailure,PREPARED_REQUEST_LIMIT} from './prepared-artwork-transport.mjs';
import {recipientArtwork} from './prepared-recipient.mjs';
const digest=async data=>Buffer.from(await crypto.subtle.digest('SHA-256',data)).toString('hex');
async function fixture(length=16){
  const data=new Uint8Array(length);data.set([137,80,78,71,13,10,26,10]);const hash=await digest(data);
  const record={id:'preparation',items:[{id:'tee',project:{prints:[{side:'front',asset:{assetId:hash,mime:'image/png'}}]}},{id:'other',project:{prints:[]}}]};
  let reads=0;
  const service={asset:async(owner,id)=>{assert.equal(owner,'preparation');assert.equal(id,hash);reads++;return {size:data.length,httpMetadata:{contentType:'image/png'},arrayBuffer:async()=>data.buffer};}};
  const svg='<svg><g transform="rotate(35)"><image width="384" height="288" href="pm-prepared-asset:'+hash+'"/></g></svg>';
  return {record,service,svg,hash,data,reads:()=>reads};
}
test('rejects declared and streamed body overruns with an artwork-specific error, numerical hints and no parsing',async()=>{
  const request=new Request('https://test/checkout',{method:'POST',headers:{'Content-Length':String(PREPARED_REQUEST_LIMIT+1),'X-PM-Prepared-Metrics':JSON.stringify({artworkBytes:30000000,previewBytes:100,private:'DO NOT LOG'})},body:'{}'});
  await assert.rejects(readPreparedBody(request),error=>error.code==='REQUEST_TOO_LARGE'&&error.status===413&&error.details.clientArtworkBytes===30000000&&/artwork/.test(error.message)&&!('private'in error.details));
  const streamed=new Request('https://test/checkout',{method:'POST',body:'x'.repeat(PREPARED_REQUEST_LIMIT+1)});
  await assert.rejects(readPreparedBody(streamed),error=>error.code==='REQUEST_TOO_LARGE'&&error.details.requestBytes>PREPARED_REQUEST_LIMIT);
});
test('measures parsed per-side UTF-8 bytes without exposing item IDs or content',async()=>{
  const request=new Request('https://test/checkout',{method:'POST',body:JSON.stringify({artwork:{'private-item':{front:'é'}},quantities:{tee:{XL:3}}})});
  const body=await readPreparedBody(request);assert.equal(body.quantities.tee.XL,3);
  assert.deepEqual(request.preparedDiagnostic.sides,[{itemIndex:0,side:'front',bytes:2}]);
  assert.ok(!JSON.stringify(request.preparedDiagnostic).includes('private-item'));
  const malformed=new Request('https://test/checkout',{method:'POST',body:JSON.stringify({artwork:{tee:'not a map'}})});
  await readPreparedBody(malformed);assert.deepEqual(malformed.preparedDiagnostic.sides,[]);
});
test('large stored admin rasters hydrate unchanged bytes and retain current transforms without counting as submitted artwork',async()=>{
  const f=await fixture(13*1024*1024),files=[{itemId:'tee',side:'front',svg:f.svg}];
  const parsed=recipientArtwork(f.record,{tee:{prints:[{side:'front'}]}},{tee:{front:f.svg}},new Set(['tee']));
  assert.equal(parsed.length,1);
  const metrics=await validatePreparedReferences(f.record,files,f.service);
  assert.equal(metrics.preparedSourceBytes,f.data.length);assert.ok(metrics.expandedArtworkBytes>12*1024*1024);
  const hydrated=await hydratePreparedSvg(f.record,'tee',f.svg,f.service);
  assert.ok(hydrated.includes('transform="rotate(35)"'));assert.ok(!hydrated.includes('pm-prepared-asset:'));
  assert.deepEqual(Buffer.from(/base64,([A-Za-z0-9+/=]+)/.exec(hydrated)[1],'base64'),Buffer.from(f.data));
  const blob=await hydratePreparedSvgBlob(f.record,'tee',f.svg,f.service);assert.equal(blob.size,Buffer.byteLength(hydrated));assert.equal(await blob.text(),hydrated);
});
test('foreign, unknown-item, malformed and vector references fail before any source read',async()=>{
  const f=await fixture();
  for(const file of [{itemId:'unknown',svg:f.svg},{itemId:'tee',svg:f.svg.replace(f.hash,'a'.repeat(64))},{itemId:'tee',svg:'<svg><text>pm-prepared-asset:'+f.hash+'</text></svg>'},{itemId:'tee',svg:f.svg.replace('pm-prepared-asset:','PM-PREPARED-ASSET:')}])await assert.rejects(validatePreparedReferences(f.record,[file],f.service),error=>error.code==='PREPARED_SOURCE_INVALID');
  const vector=structuredClone(f.record);vector.items[0].project.prints[0].asset.mime='image/svg+xml';
  await assert.rejects(validatePreparedReferences(vector,[{itemId:'tee',svg:f.svg}],f.service));assert.equal(f.reads(),0);
});
test('garment transfers may reuse a project source from the same immutable snapshot',async()=>{
  const f=await fixture();const result=await validatePreparedReferences(f.record,[{itemId:'other',svg:f.svg}],f.service);
  assert.equal(result.preparedSourceCount,1);
  const foreign=structuredClone(f.record);foreign.items[0].project.prints=[];
  await assert.rejects(validatePreparedReferences(foreign,[{itemId:'other',svg:f.svg}],f.service));
});
test('new customer artwork keeps its side limit, independent of a claimed admin flag',()=>{
  const svg='<svg>'+ 'x'.repeat(12*1024*1024)+'</svg>';
  assert.throws(()=>assertPreparedArtworkSize(svg,1,'back'),error=>error.code==='ARTWORK_TOO_LARGE'&&error.details.itemIndex===1&&error.details.side==='back');
  const record={items:[{id:'tee',project:{}}]};
  assert.throws(()=>recipientArtwork(record,{tee:{prints:[{side:'front'}]}},{tee:{front:svg,admin:true}},new Set(['tee'])),error=>error.code==='ARTWORK_TOO_LARGE');
});
test('corrupt bytes, incorrect MIME and repeated expansion over the production ceiling are rejected',async()=>{
  const f=await fixture();
  await assert.rejects(validatePreparedReferences(f.record,[{itemId:'tee',svg:f.svg}],{asset:async()=>({httpMetadata:{contentType:'image/png'},arrayBuffer:async()=>new Uint8Array(16).buffer})}),error=>error.code==='PREPARED_SOURCE_INVALID');
  await assert.rejects(validatePreparedReferences(f.record,[{itemId:'tee',svg:f.svg}],{asset:async()=>({httpMetadata:{contentType:'image/jpeg'},arrayBuffer:async()=>f.data.buffer})}),error=>error.code==='PREPARED_SOURCE_INVALID');
  const large=await fixture(13*1024*1024),svg='<svg>'+Array(3).fill('<image href="pm-prepared-asset:'+large.hash+'"/>').join('')+'</svg>';
  await assert.rejects(validatePreparedReferences(large.record,[{itemId:'tee',svg}],large.service),error=>error.code==='PREPARED_OUTPUT_TOO_LARGE');
  assert.equal(large.reads(),1,'repeated refs share size verification without allocating expanded SVG');
});
test('diagnostic reference links safe logs to the response without bearer IDs, source IDs or artwork',async()=>{
  const f=await fixture(),request=new Request('https://private.test/private-bearer/checkout');
  request.preparedDiagnostic={stage:'request',requestBytes:123,secret:f.hash,sides:[{itemIndex:0,side:'front',bytes:99}]};
  const error=Object.assign(new Error('private artwork '+f.svg),{code:'REQUEST_TOO_LARGE',status:413,details:{url:'https://secret',source:f.hash}});
  const logs=[],original=console.warn;console.warn=(...values)=>logs.push(values);
  try{logPreparedFailure(request,error);}finally{console.warn=original;}
  const log=JSON.parse(logs[0][1]);assert.equal(log.requestId,error.requestId);assert.equal(log.requestBytes,123);assert.equal(log.endpoint,'checkout');
  const serialized=JSON.stringify(logs);for(const secret of ['private-bearer',f.hash,'https://secret','<svg>'])assert.ok(!serialized.includes(secret));
});

test('actual public Worker rejection returns the same reference as its structured server log',async()=>{
  const {default:worker}=await import('./worker.js');
  const id='a17410a7-0592-4abc-8eae-5c866bf65333',snapshotId='a'.repeat(64),logs=[];
  const env={SHOPIFY_SHOP_DOMAIN:'test.myshopify.com',R2_BUCKET:{get:async()=>({etag:'local',json:async()=>({record:{id:'local',items:[],mockups:[]},items:[]})})},PREPARED_ORDER_SERVICE:{fetch:async()=>Response.json({preparedOrder:{id,template:{purchase:{kind:'order_manager_prepared',snapshotId}}}})}};
  const original=console.warn;console.warn=(...values)=>logs.push(values);
  try{
    const request=new Request('https://worker.test/order-manager/v1/prepared-orders/public/'+id+'/checkout',{method:'POST',headers:{Origin:'https://print-mo.com','Content-Type':'application/json','Content-Length':String(PREPARED_REQUEST_LIMIT+1),'X-PM-Prepared-Metrics':JSON.stringify({artworkBytes:31462820,largestSideBytes:16729132})},body:'{}'});
    const response=await worker.fetch(request,env,{waitUntil(){}}),payload=await response.json();
    const log=JSON.parse(logs.find(values=>values[0]==='prepared_order_request_failed')[1]);
    assert.equal(response.status,413);assert.equal(payload.error.code,'REQUEST_TOO_LARGE');assert.equal(log.requestId,payload.error.requestId);
    assert.equal(log.clientArtworkBytes,31462820);assert.ok(!JSON.stringify(logs).includes(id));
  }finally{console.warn=original;}
});
