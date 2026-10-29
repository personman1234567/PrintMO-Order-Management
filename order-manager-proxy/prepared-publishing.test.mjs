import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePreparedLinkRequest } from './prepared-order-links.mjs';
import { mapConcurrent, preparedPublishStream } from './prepared-publish-progress.mjs';
import { consumePreparedPublishResponse, preparedPublishMessage } from '../order-manager-web/prepared-publish-progress.mjs';

const draftId='d20f720b-ae22-4b31-886e-b72bbf8aed36',linkId='a17410a7-0592-4abc-8eae-5c866bf65333';
function fixture() {
  const objects=new Map();let etag=0;
  const bucket={async get(key){const saved=objects.get(key);return saved?{etag:saved.etag,json:async()=>structuredClone(saved.value)}:null;},async put(key,body,options={}){const previous=objects.get(key);if(options.onlyIf?.etagMatches&&previous?.etag!==options.onlyIf.etagMatches||options.onlyIf?.etagDoesNotMatch==='*'&&previous)return null;const saved={etag:String(++etag),value:JSON.parse(body)};objects.set(key,saved);return saved;}};
  const stats={products:0,productConcurrency:0,uploads:0,uploadConcurrency:0,creates:0,revises:0,assetReads:0,scopeReads:0};
  let productsActive=0,uploadsActive=0,price='5.00',failRevision=false,revision=0,expiresAt='2099-01-01T00:00:00Z',status='active',activeId=linkId;
  const record={id:draftId,revision:'source-1',title:'Team order',preparedFor:'Team',customerMessage:'Choose your sizes.',mockups:[],items:Array.from({length:4},(_,index)=>({id:'item-'+index,productId:'gid://shopify/Product/'+(index+1),variantId:'gid://shopify/ProductVariant/'+(index+1),handle:'shirt-'+index,title:'Shirt',color:'Navy',printMode:'manual',manualPrints:[{side:'front',variantId:46714190168312}],project:null}))};
  const service={read:async()=>structuredClone(record),product:async id=>{stats.products++;stats.productConcurrency=Math.max(stats.productConcurrency,++productsActive);await Promise.resolve();await Promise.resolve();productsActive--;const number=id.split('/').pop();return {handle:'shirt-'+number,title:'Shirt '+number,image:'',config:{placements:{}},variants:[{id:'gid://shopify/ProductVariant/'+number,title:'Navy / M',price:'10.00',selectedOptions:[{name:'Color',value:'Navy'},{name:'Size',value:'M'}]}]};},asset:async(_,id)=>{stats.assetReads++;return {arrayBuffer:async()=>new TextEncoder().encode(id).buffer};}};
  const env={R2_BUCKET:bucket,SHOPIFY_SHOP_DOMAIN:'test.myshopify.com',PREPARED_ORDER_ADMIN_TOKEN:'test-only',PREPARED_ORDER_SERVICE:{fetch:async(url,options)=>{
    const path=new URL(url).pathname;
    if(path==='/api/prepared-orders'){stats.creates++;if(stats.creates>1)activeId='b17410a7-0592-4abc-8eae-5c866bf65333';return Response.json({id:activeId,status:'uploading'});}
    if(path.includes('/assets/')){stats.uploads++;stats.uploadConcurrency=Math.max(stats.uploadConcurrency,++uploadsActive);await Promise.resolve();await Promise.resolve();uploadsActive--;return Response.json({url:'https://designer-preview-upload.printmobusiness.workers.dev/api/prepared-orders/public/'+activeId+'/assets/'+path.split('/').pop()});}
    if(path.endsWith('/edit'))return Response.json({revision:'revision-'+revision});
    if(path.endsWith('/finalize')||path.endsWith('/revise')){if(failRevision)return Response.json({error:'temporary failure'},{status:503});revision++;if(path.endsWith('/revise'))stats.revises++;return Response.json({id:activeId,reference:'PM-TEST',expiresAt});}
    return Response.json({preparedOrder:{id:activeId,status,expiresAt}});
  }}};
  const deps={graphql:async(_,query)=>{if(query.includes('PreparedCheckoutScopes')){stats.scopeReads++;return {ok:true,data:{currentAppInstallation:{accessScopes:[{handle:'write_draft_orders'}]}}};}return {ok:true,data:{nodes:[{id:'gid://shopify/ProductVariant/46714190168312',price,product:{handle:'printing'}}]}};}};
  const events=[];
  const publish=(refresh=false)=>handlePreparedLinkRequest(new Request('https://test',{method:'POST',body:JSON.stringify({expectedRevision:record.revision,refresh})}),env,deps,service,draftId,'publish',event=>events.push(event));
  const addAsset=(letter)=>record.mockups.push({assetId:letter.repeat(64),mime:'image/png',itemIds:[record.items[0].id]});
  return {env,record,stats,events,objects,publish,addAsset,setPrice:value=>price=value,failRevision:value=>failRevision=value,setStatus:value=>status=value,setExpiry:value=>expiresAt=value};
}

test('first publish loads each product once and bounds image/product concurrency',async()=>{
  const f=fixture();for(const letter of ['a','b','c','d'])f.addAsset(letter);
  const first=await f.publish();
  assert.equal(f.stats.products,4,'recipient template must reuse the product reads');
  assert.equal(f.stats.uploads,4);assert.equal(f.stats.assetReads,4);
  assert.equal(f.stats.productConcurrency,3);assert.ok(f.stats.uploadConcurrency>=1&&f.stats.uploadConcurrency<=2);
  assert.equal(first.publication.uploadedAssets,4);
  assert.deepEqual(f.events.filter(e=>e.stage==='assets').map(e=>e.completed),[0,1,2,3,4]);
  assert.equal(f.events.at(-1).stage,'publishing');
});

test('unchanged publication does no Shopify/product/asset work; explicit price refresh still works',async()=>{
  const f=fixture();f.addAsset('a');const first=await f.publish();const before={...f.stats};
  const unchanged=await f.publish();assert.deepEqual(f.stats,before);assert.equal(unchanged.publication.unchanged,true);
  assert.equal(unchanged.link.url,first.link.url);
  await f.publish(true);assert.equal(f.stats.revises,0,'unchanged refreshed content must not create another snapshot revision');
  f.setPrice('6.00');await f.publish(true);
  assert.equal(f.stats.revises,1);assert.equal(f.stats.uploads,1,'a price change must not recopy the image');
});

test('editing an order reuses old files, copies only new files, and keeps the URL',async()=>{
  const f=fixture();f.addAsset('a');f.addAsset('b');const first=await f.publish();
  f.record.revision='source-2';f.record.customerMessage='Updated';
  const metadataOnly=await f.publish();assert.equal(metadataOnly.publication.uploadedAssets,0);assert.equal(metadataOnly.publication.reusedAssets,2);
  f.addAsset('c');f.record.revision='source-3';const changed=await f.publish();
  assert.equal(f.stats.uploads,3);assert.equal(changed.publication.uploadedAssets,1);assert.equal(changed.publication.reusedAssets,2);
  assert.equal(changed.link.url,first.link.url);assert.equal(changed.link.id,first.link.id);
});

test('new and refreshed customer URLs stay on the live website even with an old preview variable', async()=>{
  const f=fixture(); f.env.PREPARED_ORDER_PREVIEW_THEME_ID='163707977976';
  const published=await f.publish(); assert.equal(published.link.url,'https://print-mo.com/pages/designer-studio?preparedOrder='+linkId);
  const reopened=await handlePreparedLinkRequest(new Request('https://test'),f.env,{}, {},draftId,'link');
  assert.equal(reopened.link.url,published.link.url); assert.equal(new URL(reopened.link.url).searchParams.has('preview_theme_id'),false);
});

test('removing and later restoring a mockup does not upload it again',async()=>{
  const f=fixture();f.addAsset('a');const mockup=f.record.mockups[0];await f.publish();
  f.record.mockups=[];f.record.revision='source-2';await f.publish();
  f.record.mockups=[mockup];f.record.revision='source-3';const restored=await f.publish();
  assert.equal(f.stats.uploads,1);assert.equal(restored.publication.reusedAssets,1);
});

test('simultaneous publishers cannot create competing links for one saved order',async()=>{
  const f=fixture();const results=await Promise.allSettled([f.publish(),f.publish()]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.find(result=>result.status==='rejected').reason.code,'PUBLISH_PENDING');
  assert.equal(f.stats.creates,1);
});

test('failed updates preserve the live mapping and acknowledged copies for a retry',async()=>{
  const f=fixture();f.addAsset('a');await f.publish();f.addAsset('b');f.record.revision='source-2';f.failRevision(true);
  await assert.rejects(f.publish(),error=>error.code==='PREPARED_LINK_UNAVAILABLE');
  const mapping=[...f.objects.entries()].find(([key])=>key.includes('/links/'))[1].value;
  assert.equal(mapping.link.sourceRevision,'source-1');assert.equal(mapping.publishingAt,undefined);
  f.failRevision(false);const retry=await f.publish();assert.equal(f.stats.uploads,2);assert.equal(retry.publication.reusedAssets,2);
});

test('a revoked link cannot reuse the old no-op path',async()=>{
  const f=fixture();f.addAsset('a');const first=await f.publish();f.setStatus('revoked');const next=await f.publish();assert.equal(f.stats.creates,2);
  assert.notEqual(first.link.id,next.link.id);assert.equal(f.stats.uploads,2,'a new link must own its own assets');
});

test('bounded workers await in-flight tasks before propagating an error',async()=>{
  let release,completed=false;
  const pending=new Promise(resolve=>release=resolve);
  const run=mapConcurrent([0,1,2],2,async value=>{if(value===0){await Promise.resolve();throw new Error('failed');}await pending;completed=true;});
  let settled=false;run.catch(()=>settled=true);await Promise.resolve();await Promise.resolve();assert.equal(settled,false);
  release();await assert.rejects(run,/failed/);assert.equal(completed,true);
});

test('progress stream sends actual phases and a final result without buffering the operation',async()=>{
  let release;const wait=new Promise(resolve=>release=resolve);let tracked;
  const response=preparedPublishStream(async emit=>{emit({stage:'products'});await wait;emit({stage:'assets',completed:2,total:2,reused:2});return {link:{id:linkId}};},{'Access-Control-Allow-Origin':'https://admin.test'},{waitUntil:promise=>tracked=promise});
  const events=[];const result=consumePreparedPublishResponse(response,event=>events.push(event));
  await new Promise(resolve=>setImmediate(resolve));assert.equal(events[0].stage,'products');
  release();assert.equal((await result).link.id,linkId);await tracked;
  assert.match(preparedPublishMessage(events[1]),/2 unchanged files reused/);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://admin.test');
});

test('progress errors preserve recoverable codes and never become a false success',async()=>{
  const response=preparedPublishStream(async()=>{throw Object.assign(new Error('Order changed'),{code:'VERSION_CONFLICT',status:409});},{});
  await assert.rejects(consumePreparedPublishResponse(response,()=>{}),error=>error.code==='VERSION_CONFLICT'&&error.status===409);
  const privateError=preparedPublishStream(async()=>{throw new Error('private infrastructure detail');},{});
  const text=await privateError.text();assert.doesNotMatch(text,/infrastructure detail/);
});

test('a disconnected progress reader does not cancel the tracked publication',async()=>{
  let release,tracked,finished=false;const wait=new Promise(resolve=>release=resolve);
  const response=preparedPublishStream(async emit=>{emit({stage:'products'});await wait;finished=true;return {link:{id:linkId}};},{},{waitUntil:promise=>tracked=promise});
  await response.body.cancel();release();await tracked;assert.equal(finished,true);
});

test('stream reader handles split Unicode/chunks, interrupted responses and JSON fallback',async()=>{
  const bytes=new TextEncoder().encode(JSON.stringify({type:'progress',stage:'products',label:'Checking…'})+'\n'+JSON.stringify({type:'result',link:{id:linkId}}));
  const response=new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=2)controller.enqueue(bytes.slice(i,i+2));controller.close();}}),{headers:{'Content-Type':'application/x-ndjson'}});
  const events=[];assert.equal((await consumePreparedPublishResponse(response,event=>events.push(event))).link.id,linkId);assert.equal(events[0].label,'Checking…');
  await assert.rejects(consumePreparedPublishResponse(new Response('{"type":"progress","stage":"products"}\n',{headers:{'Content-Type':'application/x-ndjson'}}),()=>{}),/interrupted/);
  assert.equal((await consumePreparedPublishResponse(Response.json({link:{id:linkId}}),()=>{})).link.id,linkId);
});
