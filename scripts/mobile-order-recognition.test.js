const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const recognition = require('../order-manager-web/mobile-order-recognition');
function order() {
  const composite={assetId:'composite',role:'mockup',url:'https://example.test/dual.png'};
  return {_candidate:true,items:[{id:'shirt',title:'Tultex 202 Tee',variantTitle:'Navy / L',qty:4,properties:{group_id:'one',_designRef:'reference'},assets:[composite]}],assets:[composite],
    mobilePreview:{assetId:'front',role:'mobile-preview',previewKind:'mobile-front',side:'front',lineItemId:'shirt',designRef:'reference',url:'https://example.test/front.png'},
    canonical:{commerce:{lineItemsComplete:true}}};
}
test('mobile chooses explicit associated front while canonical composite is unchanged',()=>{
  const item=order(), before=JSON.stringify(item.assets);
  assert.equal(recognition.describe(item).preview.url,'https://example.test/front.png');
  assert.equal(JSON.stringify(item.assets),before);
  const source=fs.readFileSync('renderer.js','utf8');
  const block=source.slice(source.indexOf('function getFirstMockupUrl('),source.indexOf('function candidateMockupManifests('));
  const context=vm.createContext({getManualMockupsForOrder:()=>[],splitOrderAssets:job=>({mockups:job.assets}),getAssetUrlValue:asset=>asset.url});
  vm.runInContext(block,context);
  assert.equal(context.getFirstMockupUrl(item),'https://example.test/dual.png');
});
test('wrong line, wrong design, unspecified side and unassigned derivatives never become front',()=>{
  for(const patch of [{lineItemId:null},{lineItemId:'other'},{designRef:'obsolete'},{side:'back'},{role:'mockup'},{previewKind:''}]){
    const item=order();Object.assign(item.mobilePreview,patch);
    assert.equal(recognition.describe(item).preview.url,'https://example.test/dual.png');
  }
});
test('front failures fall back to composite, then a settled honest garment summary',()=>{
  const item=order();recognition.markPreviewFailed(item,'front');
  assert.equal(recognition.describe(item).preview.url,'https://example.test/dual.png');
  recognition.markPreviewFailed(item,'composite');
  const result=recognition.describe(item);
  assert.equal(result.preview.url,'');assert.equal(result.preview.kind,'garment');assert.equal(result.preview.state,'failed');
});
test('unassigned order artwork stays artwork even when placed in the first item array',()=>{
  const item=order();item.mobilePreview=null;item.assets[0].role='design';item.assets[0].lineItemId=null;
  const result=recognition.describe(item);assert.equal(result.preview.kind,'artwork');assert.equal(result.preview.side,'');
  assert.match(result.garments[0].label,/Navy/);
});
test('catalog photos and generated garment summaries remain distinct from artwork',()=>{
  const item=order();item.mobilePreview=null;item.assets=[];item.items[0].assets=[];
  item.items[0].catalogPreview={previewId:'catalog',url:'https://example.test/catalog.png'};
  assert.equal(recognition.describe(item).preview.kind,'catalog');
  item.items[0].catalogPreview=null;assert.equal(recognition.describe(item).preview.kind,'garment');
});
test('delivery labels use only a complete explicit method and never infer pickup readiness',()=>{
  const labels={pickup:'Pickup',shipping:'Shipping','local-delivery':'Local delivery','pickup-point':'Pickup point','in-store':'In-store',none:'No delivery',mixed:'Mixed delivery'};
  for(const [kind,label] of Object.entries(labels)){
    const item=order();item.canonical.commerce.deliveryMethod={kind,complete:true};
    assert.deepEqual(recognition.describe(item).delivery,{kind,label});
    item.canonical.commerce.deliveryMethod.complete=false;
    assert.equal(recognition.describe(item).delivery.kind,'unknown');
  }
  const item=order();item.shippingAddress=null;item.shippingLine={title:'Local Pickup'};item.displayFulfillmentStatus='FULFILLED';
  assert.equal(recognition.describe(item).delivery.kind,'unknown');
});
test('style/color groups are not design counts; partial quantities remain unavailable',()=>{
  const item=order();item.items.push({...item.items[0],id:'second',qty:2,properties:{group_id:'two'}});
  let result=recognition.describe(item);assert.equal(result.garments.length,1);assert.equal(result.garments[0].qty,6);assert.equal(result.moreLabel,'Multiple item groups · View items');
  item.canonical.commerce.lineItemsComplete=false;result=recognition.describe(item);
  assert.equal(result.partial,true);assert.match(result.moreLabel,/incomplete/);assert.doesNotMatch(result.moreLabel,/design/);
});

test('scrolling during private hydration retains and drains the latest visible rows',async()=>{
  const source=fs.readFileSync('order-manager-web/web-shim.js','utf8');
  const block=source.slice(source.indexOf('let mobileRecognitionHydrationPending ='),source.indexOf('function candidateByName('));
  const requests=[], listeners={};
  const records=['one','two'].map(id=>({id,source:{provider:'shopify'},production:{mobilePreview:{assetId:id}}}));
  const context=vm.createContext({document:{body:{dataset:{mobileWorkspace:'true'}},addEventListener:(name,fn)=>{listeners[name]=fn;}},
    candidateBoardHydrationRecords:records,candidateBoardMockupRepaint:()=>{},console,
    hydrateCandidateAssets:items=>new Promise(resolve=>requests.push({ids:items.map(item=>item.id),resolve}))});
  vm.runInContext(block,context);
  const show=id=>listeners['printmo:mobile-recognition-visible']({detail:{keys:[JSON.stringify(['shopify',id])]}});
  show('one');show('two');assert.equal(requests.length,1);
  requests[0].resolve();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests.length,2);assert.equal(requests[1].ids.join(','),'two');requests[1].resolve();
});

test('staff replacement proofs override a previously submitted front derivative',()=>{
  const old=globalThis.getManualMockupsForOrder;
  try {
    globalThis.getManualMockupsForOrder=()=>[{id:'replacement',url:'https://example.test/replacement.png'}];
    assert.equal(recognition.describe(order()).preview.url,'https://example.test/replacement.png');
  } finally { if(old)globalThis.getManualMockupsForOrder=old;else delete globalThis.getManualMockupsForOrder; }
});

test('standalone artwork hydration settles mobile rows even without a mockup callback',async()=>{
  const source=fs.readFileSync('order-manager-web/web-shim.js','utf8');
  const block=source.slice(source.indexOf('async function hydrateCandidateAssets('),source.indexOf('function applyCandidateCachedAssetUrls('));
  const asset={assetId:'art',role:'design'},events=[];
  const context=vm.createContext({document:{body:{dataset:{mobileWorkspace:'true'}},dispatchEvent:event=>events.push(event.type)},CustomEvent:class{constructor(type){this.type=type;}},
    candidateAssetHydrationQueue:records=>[{asset,record:records[0],isMockup:false}],candidateRecordIsVisibleInBoard:()=>true,
    prefetchCandidateAssetTickets:async()=>{},withCandidateTicketBatchTimeout:promise=>promise,
    runWithConcurrency:async(entries,limit,fn)=>{for(const entry of entries)await fn(entry);},ASSET_HYDRATION_CONCURRENCY:4,
    candidateAssetObjectUrl:async()=> 'https://example.test/art.png',candidateCatalogPreviewEntries:()=>[],console});
  vm.runInContext(block,context);await context.hydrateCandidateAssets([{id:'order'}]);
  assert.equal(asset._previewState,'ready');assert.equal(asset.url,'https://example.test/art.png');
  assert.ok(events.includes('printmo:mobile-recognition-updated'));
});

test('new internal preview property cannot add a URL chip to desktop/detail item display',()=>{
  const source=fs.readFileSync('renderer.js','utf8');
  const block=source.slice(source.indexOf('function customerItemAttributes('),source.indexOf('function openDetail('));
  const context=vm.createContext({console});vm.runInContext(block,context);
  const item={id:'shirt',title:'Tee',qty:1,price:10,customAttributes:[{key:'Color',value:'Navy'}]};
  const before=JSON.stringify(context.consolidateLineItemsForDisplay([item]));
  item.customAttributes.push({key:'_designer_front_preview_url',value:'https://example.test/private-front.png'});
  const after=context.consolidateLineItemsForDisplay([item]);
  assert.equal(JSON.stringify(after),before);
  assert.equal(item.customAttributes.length,2);
});
