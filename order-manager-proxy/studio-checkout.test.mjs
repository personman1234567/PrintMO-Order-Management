import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {preparedPriceProducts} from './prepared-price-products.mjs';
import {handleStudioCheckoutRequest,studioServiceRequests} from './studio-checkout.mjs';
import {fixtureBulkResponse,fixtureCalculated} from './prepared-order-discounts.test-support.mjs';
const gid=id=>'gid://shopify/ProductVariant/'+id;
const sessionId='83f0b76a-1f1c-4d00-9fa1-36845d0a7890';
const design=(type='image',side='front')=>({revision:'a'.repeat(64),prints:type?[{type,side,design:{xIn:1,yIn:1,wIn:3,hIn:3,rotation:0}}]:[],canvasCalibration:{bySide:{front:{referenceWidthIn:12,safeWidthIn:12,safeHeightIn:15}}}});
const item=(id='a',variant=1,quantity=12,type='image',side='front')=>({id,variantId:gid(variant),quantities:{[gid(variant)]:quantity},design:design(type,side),instructions:'Please center.'});
const service=(assetKey='shared',itemId='a')=>({key:'background-removal',variantId:gid(900),assetKey,itemId,side:'front',note:''});
let fixtureNumber=0;
function fixture(){
  const objects=new Map(),uploads=[],calls=[],created=[],ready=[];let version=0;
  const state={price:'10.00',servicePrice:'7.00',sku:'PM-ART-BG-REMOVE',available:true,eligible:true,failUpload:0,hiddenColors:[]};
  const bucket={objects,async get(key){const entry=objects.get(key);return entry?{etag:entry.etag,json:async()=>structuredClone(entry.value)}:null;},async put(key,body,options={}){const prev=objects.get(key);if(options.onlyIf?.etagDoesNotMatch==='*'&&prev)return null;if(options.onlyIf?.etagMatches&&prev?.etag!==options.onlyIf.etagMatches)return null;const value={value:JSON.parse(body),etag:String(++version)};objects.set(key,value);return value;}};
  const env={R2_BUCKET:bucket,SHOPIFY_SHOP_DOMAIN:'test.myshopify.com'};
  const product=id=>({id:'gid://shopify/Product/'+id,status:'ACTIVE',title:'Shirt '+id,handle:'shirt-'+id,image:'',config:{placements:{},hiddenColors:state.hiddenColors},variants:[{id:gid(id),price:state.price,availableForSale:state.available,title:'Blue / S',selectedOptions:[{name:'Color',value:'Blue'},{name:'Size',value:'S'}]}]});
  const deps={graphql:async(_env,query,variables)=>{
    calls.push({query,variables});
    if(query.includes('StudioCheckoutVariants'))return {data:{nodes:variables.ids.map(id=>{const n=Number(id.split('/').pop());return {id,price:n===900?state.servicePrice:state.price,sku:n===900?state.sku:'SHIRT',availableForSale:state.available,title:'Default',product:{id:'gid://shopify/Product/'+n,title:n===900?'Background removal':'Shirt '+n,status:'ACTIVE'}};})}};
    if(query.includes('PreparedRecipientCommerce'))return {data:{nodes:variables.ids.map(id=>{const n=Number(id.split('/').pop()),p=product(n);return id.includes('/ProductVariant/')?{...p.variants[0],product:{id:p.id,status:p.status}}:{...p,designerConfig:{value:JSON.stringify(p.config)}};})}};
    if(query.includes('PreparedCheckoutPrices'))return {data:{nodes:variables.ids.map(id=>({id,price:'5.00',product:{handle:'printing'}}))}};
    const bulk=fixtureBulkResponse(query,variables,{prices:{[gid(1)]:state.price,[gid(2)]:state.price,[gid(3)]:state.price,[gid(900)]:state.servicePrice},eligible:id=>Number(id.split('/').pop())===1?state.eligible:Number(id.split('/').pop())===900});
    if(bulk)return bulk;
    if(query.includes('PreparedCheckoutScopes'))return {data:{currentAppInstallation:{accessScopes:[{handle:'write_draft_orders'}]}}};
    if(query.includes('PreparedCheckoutCreate')){created.push(variables.input);return {data:{draftOrderCreate:{draftOrder:{id:'gid://shopify/DraftOrder/1',invoiceUrl:'https://test.myshopify.com/invoice/1',...fixtureCalculated(variables.input)},userErrors:[]}}};}
    if(query.includes('PreparedCheckoutRecover'))return {data:{draftOrders:{nodes:created.length?[{id:'gid://shopify/DraftOrder/1',invoiceUrl:'https://test.myshopify.com/invoice/1',status:'OPEN',...fixtureCalculated(created[0])}]:[]}}};
    throw Error('Unexpected query');
  },drafts:{detail:async()=>({items:created[0].lineItems.map((line,index)=>({id:'line-'+index,customAttributes:line.customAttributes}))}),markStudioCheckoutReady:async (id,at)=>{ready.push({id,at});},handle:async (request,actor)=>{const form=await request.formData(),file=form.get('file');if(state.failUpload){state.failUpload--;throw Error('Temporary production upload failure');}uploads.push({actor,role:form.get('role'),placement:form.get('placement'),lines:JSON.parse(form.get('lineItemIds')),name:file.name,text:await file.text()});}}};
  const prepared={priceProducts:(record,items)=>preparedPriceProducts(env,deps.graphql,record,items,JSON.parse),product:async()=>{throw Error('Studio price checks must not load the full catalog');},asset:async()=>{throw Error('Ordinary Studio must use embedded exported artwork');}};
  const ip='fixture-'+(++fixtureNumber);
  const post=(path,body,origin='https://print-mo.com')=>handleStudioCheckoutRequest(new Request('https://worker.test/order-manager/v1/studio-checkout/'+path,{method:'POST',headers:{Origin:origin,'CF-Connecting-IP':ip},body:JSON.stringify(body)}),env,deps,prepared);
  const quote=body=>post('quote',body);
  const checkout=(quoted,body={})=>post(quoted.id+'/checkout',{snapshotId:quoted.snapshotId,quoteId:quoted.quoteId,sessionId,artwork:{a:{front:'<svg>ORDINARY FRONT</svg>'}},...body});
  return {state,env,objects,uploads,calls,created,post,quote,checkout,ready};
}

test('Studio mixed garments reuse canonical tier policy; eligible service products count once at full price',async()=>{
  const f=fixture(),q=await f.quote({items:[item(),item('b',2,50)],services:[service(),service('shared','b')]});
  assert.equal(q.pricing.eligibleQuantity,12);assert.equal(q.pricing.rate,.05);
  assert.equal(q.pricing.subtotalCents,93700);assert.equal(q.pricing.discountCents,900);assert.equal(q.pricing.checkoutSubtotalCents,92800);
  assert.equal(q.services.length,1);assert.equal(q.services[0].quantity,1);assert.equal(q.services[0].priceCents,700);assert.equal(q.services[0].variantId,gid(900));assert.equal(q.services[0].note,'');
  assert.equal(q.items[0].variantId,gid(1));assert.deepEqual(q.items[0].quantities,{[gid(1)]:12});assert.equal(q.items[0].design.revision,'a'.repeat(64));assert.equal(q.items[0].variants[0].available,true);
  const input=f.calls.find(v=>v.query.includes('PreparedBulkCalculate')).variables.input;
  assert.deepEqual(input.lineItems.map(line=>!!line.appliedDiscount),[true,true,false,false,false]);
  assert.equal(input.lineItems.at(-1).quantity,1);assert.equal(input.acceptAutomaticDiscounts,false);assert.equal(input.allowDiscountCodesInCheckout,false);
  const attrs=Object.fromEntries(input.lineItems.at(-1).customAttributes.map(value=>[value.key,value.value]));
  assert.equal(attrs._group_id,q.id+':a');assert.equal(attrs._parent_id,'1');assert.equal(attrs._group_role,'artwork_service');assert.equal(attrs._batch_role,'service');
  assert.notEqual(attrs._batch_id,input.lineItems[0].customAttributes.find(v=>v.key==='_batch_id').value);
});

test('ordinary image, text, and no-art exports attach only to their garment lines and retry resumes the same Shopify draft',async()=>{
  const f=fixture(),q=await f.quote({items:[item(),item('b',2,1,'text','back'),item('c',3,1,'')],services:[service()]});
  const files={artwork:{a:{front:'<svg>IMAGE FRONT</svg>'},b:{back:'<svg><text>TEXT BACK</text></svg>'}},previews:{a:'data:image/png;base64,UFJPT0Y='},frontPreviews:{a:'data:image/png;base64,RlJPTlQ='}};
  f.state.failUpload=1;
  await assert.rejects(f.checkout(q,files),/Temporary production/);assert.equal(f.created.length,1);assert.equal(f.ready.length,0);
  const result=await f.checkout(q,files);assert.match(result.checkoutUrl,/invoice\/1$/);assert.equal(f.created.length,1);
  assert.deepEqual(f.uploads.map(v=>[v.role,v.placement,v.lines]),[['design','front',['line-0']],['mockup','other',['line-0']],['mobile-preview','front',['line-0']],['design','back',['line-2']]]);
  assert.equal(f.uploads[0].text,'<svg>IMAGE FRONT</svg>');assert.match(f.uploads[3].text,/TEXT BACK/);
  assert.equal(f.created[0].lineItems.at(-1).customAttributes.find(v=>v.key==='_artwork_service').value,'background-removal');
  assert(f.uploads.every(file=>file.actor==='studio-checkout'));
  assert.equal(f.ready.length,1);
  await f.checkout(q,files);assert.equal(f.created.length,1);assert.equal(f.uploads.length,4);
  assert.deepEqual(f.ready,[f.ready[0],f.ready[0]],'retry replays the same durable activity timestamp');
});

test('service SKU allowlist, identity dedupe and exact variant availability are enforced on the server',async()=>{
  const ids=new Set(['a','b']);
  assert.equal(studioServiceRequests([service(),service('shared','b')],ids).length,1);
  assert.equal(studioServiceRequests([service(),service('other')],ids).length,2);
  assert.equal(studioServiceRequests([{...service(),note:'x'.repeat(1100)}],ids)[0].note.length,1000);
  for(const bad of [{...service(),key:'free-custom-service'},{...service(),variantId:900},{...service(),assetKey:''},{...service(),itemId:'foreign'},{...service(),side:'elsewhere'}])assert.throws(()=>studioServiceRequests([bad],ids));
  const f=fixture();f.state.sku='SHIRT';await assert.rejects(f.quote({items:[item()],services:[service()]}),error=>error.code==='SERVICE_UNAVAILABLE');
  const g=fixture();g.state.available=undefined;await assert.rejects(g.quote({items:[item()]}),error=>error.code==='VARIANT_UNAVAILABLE');
  await assert.rejects(f.quote({items:[{...item(),quantities:{[gid(2)]:12}}]}),error=>error.code==='VARIANT_UNAVAILABLE');
});

test('checkout recalculates current prices and eligible collection membership instead of trusting the quoted client',async()=>{
  for(const changed of [f=>f.state.price='11.00',f=>f.state.servicePrice='8.00',f=>f.state.eligible=false]){
    const f=fixture(),q=await f.quote({items:[item()],services:[service()]});changed(f);
    await assert.rejects(f.checkout(q),error=>error.code==='PRICE_CHANGED');assert.equal(f.created.length,0);
  }
  const f=fixture(),q=await f.quote({items:[item()],services:[service()]});f.state.sku='OTHER';await assert.rejects(f.checkout(q),error=>error.code==='SERVICE_UNAVAILABLE');assert.equal(f.created.length,0);
});

test('snapshot, quantity and export tampering cannot change checkout; expiry and storefront Origin are required',async()=>{
  const f=fixture(),q=await f.quote({items:[item()]});
  for(const changes of [{snapshotId:'b'.repeat(64)},{quoteId:'b'.repeat(64)},{quantities:{a:{[gid(1)]:1}}},{services:[]}])await assert.rejects(f.checkout(q,changes),error=>error.code==='ORDER_CHANGED');
  await assert.rejects(f.checkout(q,{sessionId:'invalid'}),error=>error.code==='INVALID_SESSION');
  await assert.rejects(f.checkout(q,{artwork:{}}),error=>error.code==='INVALID_DESIGN');
  await assert.rejects(f.checkout(q,{artwork:{a:{front:'<svg><image href="https://evil.test/a"/></svg>'}}}),error=>error.code==='INVALID_DESIGN');
  for(const origin of ['','https://staff.example','https://evil.test'])await assert.rejects(f.post('quote',{items:[item()]},origin),error=>error.code==='ORIGIN_FORBIDDEN');
  assert.equal(f.created.length,0);
  const entry=[...f.objects.values()].find(v=>v.value.id===q.id);entry.value.expiresAt='2000-01-01T00:00:00.000Z';
  await assert.rejects(f.checkout(q),error=>error.code==='QUOTE_EXPIRED');
});

test('item count, numeric quantities, revisions and geometry are bounded before a checkout can be created',async()=>{
  const f=fixture();
  for(const body of [{items:[]},{items:Array.from({length:31},(_,i)=>item(String(i)))},{items:[item(),item()]},{items:[{...item(),id:'__proto__'}]},{items:[{...item(),design:{...design(),revision:'bad'}}]},{items:[{...item(),quantities:{[gid(1)]:1.5}}]},{items:[{...item(),design:{...design(),prints:[{...design().prints[0],design:{xIn:0,yIn:0,wIn:NaN,hIn:1,rotation:0}}]}}]}])await assert.rejects(f.quote(body));
  const q=await f.quote({items:[item('a',1,1,'')]});assert.deepEqual(q.items[0].prints,[]);
  await f.checkout(q,{artwork:{}});assert.equal(f.uploads.length,0);
});

test('Worker exposes only the two storefront-origin public Studio actions and preserves CORS preflight',async()=>{
  const source=readFileSync(new URL('./worker.js',import.meta.url),'utf8').replace(/from\s+(['"])(\.\/[^'"]+\.mjs)\1/g,(_match,_quote,module)=>'from '+JSON.stringify(new URL(module,import.meta.url).href));
  const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const url='https://worker.test/order-manager/v1/studio-checkout/quote';
  for(const origin of ['','https://staff.test','https://evil.test']){
    const response=await worker.fetch(new Request(url,{method:'POST',headers:{Origin:origin},body:'{}'}),{ALLOWED_ORIGINS:'https://staff.test'},{});
    assert.equal(response.status,403);
  }
  const preflight=await worker.fetch(new Request(url,{method:'OPTIONS',headers:{Origin:'https://print-mo.com','Access-Control-Request-Method':'POST'}}),{},{});
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'https://print-mo.com');
  const publicResponse=await worker.fetch(new Request(url,{method:'POST',headers:{Origin:'https://www.print-mo.com'},body:'{}'}),{},{});
  assert.equal(publicResponse.status,503);assert.equal((await publicResponse.json()).error.code,'CHECKOUT_UNAVAILABLE');
  const gallery=await worker.fetch(new Request('https://worker.test/order-manager/storage/checkout-exports',
    {headers:{Origin:'https://staff.test'}}),{ALLOWED_ORIGINS:'https://staff.test'},{});
  assert.equal(gallery.status,403);
});

test('selected commerce is batched once per quote and reread at checkout without catalog pagination',async()=>{
  const f=fixture(),q=await f.quote({items:[item(),item('b',2,2,''),item('c',3,3,'')]});
  const reads=()=>f.calls.filter(v=>v.query.includes('PreparedRecipientCommerce'));
  assert.equal(reads().length,1);
  assert.deepEqual(new Set(reads()[0].variables.ids),new Set([1,2,3].flatMap(n=>['gid://shopify/Product/'+n,gid(n)])));
  assert.match(reads()[0].query,/availableForSale/);assert.doesNotMatch(reads()[0].query,/media|swatch|variants\(/);
  await f.checkout(q);assert.equal(reads().length,2);
});
test('lean checkout rereads availability and hidden colors before allowing checkout',async()=>{
  for(const change of [f=>f.state.available=false,f=>f.state.available=undefined,f=>f.state.hiddenColors=['Blue']]){
    const f=fixture(),q=await f.quote({items:[item()]});change(f);
    await assert.rejects(f.checkout(q));assert.equal(f.created.length,0);
  }
});
