import test from 'node:test';
import assert from 'node:assert/strict';
import {preparedColorOptions,recipientConfigurations} from './prepared-colors.mjs';
import {handlePublicPreparedLinkRequest,buildPreparedCheckoutLines} from './prepared-order-links.mjs';
const id='a17410a7-0592-4abc-8eae-5c866bf65333',itemId='ad7410a7-0592-4abc-8eae-5c866bf65333',snapshotId='a'.repeat(64);
const gid=n=>'gid://shopify/ProductVariant/'+n;
const variant=(n,color,size='M',fit='Regular',availableForSale=true)=>({id:gid(n),price:'12.00',availableForSale,image:{url:'https://cdn.shopify.com/'+color+'.png'},selectedOptions:[{name:'Color',value:color},{name:'Size',value:size},{name:'Fit',value:fit}]});
const product={id:'gid://shopify/Product/1',title:'Tee',handle:'tee',config:{placements:{},hiddenColors:['Hidden']},swatches:{Navy:{color:'#123456'}},variants:[variant(1,'Black'),variant(2,'Navy'),variant(3,'Navy','XL'),variant(4,'Hidden'),variant(5,'Navy','M','Slim'),variant(6,'Sold out','M','Regular',false),variant(7,'Unknown')]};
const record={items:[{id:itemId,productId:product.id,variantId:gid(1),title:'Tee',color:'Black',printMode:'none',project:{prints:[{type:'image',side:'front',asset:{},design:{xIn:1,yIn:1,wIn:2,hIn:2,rotation:0}}]}}]};
const service={product:async()=>structuredClone(product)};
test('exact product colors fix Fit, honor hidden colors, preserve missing swatch data and canonical availability',async()=>{
 const palette=await preparedColorOptions(record,itemId,service);
 assert.deepEqual(palette.colors.map(c=>c.name),['Black','Navy','Sold out','Unknown']);
 assert.deepEqual(palette.colors.find(c=>c.name==='Navy').variants.map(v=>v.id),[2,3]);
 assert.equal(palette.colors.find(c=>c.name==='Navy').variants[0].image,'https://cdn.shopify.com/Navy.png');
 assert.equal(palette.colors.find(c=>c.name==='Unknown').tintHex,'');
 assert.deepEqual(palette.colors.find(c=>c.name==='Navy').families,['Blue']);
 assert.deepEqual(palette.colors.find(c=>c.name==='Unknown').families,['Unmapped']);
 assert.equal(palette.colors.find(c=>c.name==='Sold out').variants[0].available,false);
 assert.equal(await recipientConfigurations(record,undefined,service),record);
 const changed=await recipientConfigurations(record,{[itemId]:gid(2)},service);
 assert.equal(changed.items[0].color,'Navy');assert.equal(record.items[0].color,'Black');
 for(const n of [4,5,6,999])await assert.rejects(recipientConfigurations(record,{[itemId]:gid(n)},service));
 await assert.rejects(preparedColorOptions({items:[{...record.items[0],project:null}]},itemId,service),/supplied mockup/);
});
test('new bearer intent changes exact quote/checkout variants; omitted intent and disabled feature retain original path',async()=>{
 const snapshot={record,items:[{id:itemId,title:'Tee',color:'Black',variants:[{id:gid(1),size:'M',priceCents:1200}],prints:[],images:[]}]};
 const env={SHOPIFY_SHOP_DOMAIN:'test.myshopify.com',PREPARED_RECIPIENT_COLORS_ENABLED:'true',R2_BUCKET:{get:async()=>({json:async()=>structuredClone(snapshot)})}};
 const original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({preparedOrder:{id,reference:'PM',expiresAt:'2099-01-01',template:{purchase:{kind:'order_manager_prepared',snapshotId}}}});
 const base='https://test/order-manager/v1/prepared-orders/public/'+id;
 const request=configurations=>new Request(base+'/quote',{method:'POST',body:JSON.stringify({snapshotId,designs:{},...(configurations?{configurations}:{})})});
 try{
  const before=await handlePublicPreparedLinkRequest(request(),env,{},service);
  assert.deepEqual(before.items[0].variants.map(v=>v.id),[gid(1)]);
  const after=await handlePublicPreparedLinkRequest(request({[itemId]:gid(2)}),env,{},service);
  assert.notEqual(after.quoteId,before.quoteId);assert.deepEqual(after.items[0].variants.map(v=>v.id),[gid(2),gid(3)]);
  const lines=buildPreparedCheckoutLines(after.items,{[itemId]:{[gid(2)]:2}},id,snapshotId).lines;
  assert.equal(lines[0].variantId,gid(2));assert.equal(lines[0].quantity,2);
  assert.ok(lines[0].customAttributes.some(a=>a.key==='_garment_color'&&a.value==='Navy · Regular'));
  assert.throws(()=>buildPreparedCheckoutLines(after.items,{[itemId]:{[gid(1)]:2}},id,snapshotId));
  await assert.rejects(handlePublicPreparedLinkRequest(request({[itemId]:gid(2)}),{...env,PREPARED_RECIPIENT_COLORS_ENABLED:'false'},{},service),error=>error.code==='COLORS_UNAVAILABLE');
  const palette=await handlePublicPreparedLinkRequest(new Request(base+'/colors?item='+itemId+'&snapshotId='+snapshotId),env,{},service);assert.equal(palette.itemId,itemId);
  await assert.rejects(handlePublicPreparedLinkRequest(new Request(base+'/colors?item='+itemId+'&snapshotId=wrong'),env,{},service),error=>error.code==='ORDER_CHANGED');
 }finally{globalThis.fetch=original;}
});

test('a color change reuses its full product and keeps unchanged garments on fresh lean commerce reads',async()=>{
 const other={...structuredClone(product),id:'gid://shopify/Product/2',variants:[variant(101,'Black')]};
 const otherItem={...structuredClone(record.items[0]),id:'bd7410a7-0592-4abc-8eae-5c866bf65333',productId:other.id,variantId:gid(101)};
 const combined={items:[record.items[0],otherItem]},reads=[],leanReads=[];
 const selectedService={product:async productId=>{reads.push(productId);return structuredClone(productId===product.id?product:other)},priceProducts:async record=>{leanReads.push(record.items.map(item=>item.id));return new Map([[other.id,structuredClone(other)]])}};
 const snapshot={record:combined,items:[{id:itemId,variants:[{id:gid(1),size:'M',priceCents:1200}],prints:[],images:[]},{id:otherItem.id,variants:[{id:gid(101),size:'M',priceCents:1200}],prints:[],images:[]}]};
 const env={SHOPIFY_SHOP_DOMAIN:'test.myshopify.com',PREPARED_RECIPIENT_COLORS_ENABLED:'true',R2_BUCKET:{get:async()=>({json:async()=>snapshot})}};
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({preparedOrder:{id,reference:'PM',expiresAt:'2099-01-01',template:{purchase:{kind:'order_manager_prepared',snapshotId}}}});
 try{
  const result=await handlePublicPreparedLinkRequest(new Request('https://test/order-manager/v1/prepared-orders/public/'+id+'/quote',{method:'POST',body:JSON.stringify({snapshotId,designs:{},configurations:{[itemId]:gid(2)}})}),env,{},selectedService);
  assert.deepEqual(reads,[product.id]);assert.deepEqual(leanReads,[[otherItem.id]]);
  assert.equal(result.items.length,2);assert.deepEqual(result.items[1].variants.map(v=>v.id),[gid(101)]);
 }finally{globalThis.fetch=original}
});
