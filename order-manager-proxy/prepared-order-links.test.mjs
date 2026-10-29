import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePreparedLinkRequest, handlePublicPreparedLinkRequest, buildPreparedCheckoutLines, resolveItemPrints, transferProductionAssets } from './prepared-order-links.mjs';
const id='d20f720b-ae22-4b31-886e-b72bbf8aed36',itemId='ad7410a7-0592-4abc-8eae-5c866bf65333',linkId='a17410a7-0592-4abc-8eae-5c866bf65333';
const variant='gid://shopify/ProductVariant/1';
const product={title:'Unlisted shirt',image:'',config:{placements:{}},variants:[{id:variant,title:'Navy / S',price:'10.00',selectedOptions:[{name:'Color',value:'Navy'},{name:'Size',value:'S'}]}]};
const record={id,revision:'source-1',title:'Team order',preparedFor:'Team',customerMessage:'Choose your sizes.',note:'PRIVATE STAFF NOTE',mockups:[],items:[{id:itemId,productId:'gid://shopify/Product/1',variantId:variant,title:product.title,color:'Navy',printMode:'manual',manualPrints:[{side:'front',variantId:46714190168312}],project:null}]};

test('two-sided automatic artwork cannot silently lose an unpriced side',()=>{
  const art=side=>({type:'image',side,design:{xIn:1,yIn:1,wIn:3,hIn:3,rotation:0},asset:{}});
  const item={...record.items[0],printMode:'auto',project:{prints:[art('front'),art('back')]}};
  const prints=resolveItemPrints(item,product);
  assert.deepEqual(prints.map(print=>print.side),['front','back']);
  const selection=buildPreparedCheckoutLines([{id:item.id,title:item.title,variants:[{id:variant}],prints}],{[item.id]:{[variant]:2}},id,'snapshot');
  assert.equal(selection.lines.length,3);
  assert.deepEqual(selection.lines.slice(1).map(line=>line.customAttributes.find(value=>value.key==='_side').value),['front','back']);
  item.project.prints[1].design.wIn=0;
  assert.throws(()=>resolveItemPrints(item,product),/no print charge/);
});

test('published alternatives remain outside legacy templates and only chosen configurations reach Shopify',async()=>{
  const altId='bd7410a7-0592-4abc-8eae-5c866bf65333',altVariant='gid://shopify/ProductVariant/2';
  const source=structuredClone(record);source.items.push({...source.items[0],id:altId,alternativeForItemId:itemId,productId:'gid://shopify/Product/2',variantId:altVariant});
  const env={R2_BUCKET:bucket(),SHOPIFY_SHOP_DOMAIN:'test.myshopify.com',PREPARED_ORDER_ADMIN_TOKEN:'fixture-token'};
  let template,unavailable=false,lines;const original=globalThis.fetch;
  globalThis.fetch=async(url,options={})=>{
    const path=new URL(url).pathname;
    if(path.includes('/public/'))return Response.json({preparedOrder:{id:linkId,reference:'PM-TEST',expiresAt:'2099-01-01',template}});
    if(path.endsWith('/finalize')){template=JSON.parse(options.body).template;return Response.json({id:linkId,expiresAt:'2099-01-01'});}
    return Response.json({id:linkId,status:'uploading'});
  };
  const deps={graphql:async(_,query,variables)=>{
    if(query.includes('PreparedCheckoutScopes'))return {ok:true,data:{currentAppInstallation:{accessScopes:[{handle:'write_draft_orders'}]}}};
    if(query.includes('PreparedCheckoutPrices'))return {ok:true,data:{nodes:[{id:'gid://shopify/ProductVariant/46714190168312',price:'5.00'}]}};
    if(query.includes('PreparedCheckoutCreate')){lines=variables.input.lineItems;return {ok:true,data:{draftOrderCreate:{draftOrder:{id:'gid://shopify/DraftOrder/1',invoiceUrl:'https://test.myshopify.com/invoice/test'},userErrors:[]}}};}
    throw Error('Unexpected query');
  },drafts:{detail:async()=>({items:[{id:'line-alt',customAttributes:[{key:'_preparedItemId',value:altId},{key:'group_role',value:'garment'}]}]})}};
  const service={read:async()=>structuredClone(source),product:async productId=>{if(productId.endsWith('/2')&&unavailable)throw Error('Alternative unavailable');const next=structuredClone(product);if(productId.endsWith('/2'))next.variants[0].id=altVariant;return next;}};
  const base='https://test/order-manager/v1/prepared-orders/public/'+linkId;
  const post=(path,body)=>handlePublicPreparedLinkRequest(new Request(base+path,{method:'POST',body:JSON.stringify(body)}),env,deps,service);
  try{
    await handlePreparedLinkRequest(new Request('https://test',{method:'POST',body:JSON.stringify({expectedRevision:source.revision})}),env,deps,service,id,'publish');
    assert.deepEqual(template.workspaces.map(ws=>ws.id),[itemId]);
    unavailable=true;
    const view=await handlePublicPreparedLinkRequest(new Request(base),env,deps,service),snapshotId=view.order.snapshotId;
    assert.equal(view.order.choices[0].options.length,2);
    assert.equal(JSON.stringify(view).includes('PRIVATE STAFF NOTE'),false);
    const primary=await post('/quote',{snapshotId,designs:{}});assert.deepEqual(primary.items.map(item=>item.id),[itemId]);
    unavailable=false;
    const selection={choices:{[itemId]:altId},extras:[]},quote=await post('/quote',{snapshotId,selection,designs:{}});
    assert.deepEqual(quote.items.map(item=>item.id),[altId]);
    await post('/checkout',{snapshotId,selection,designs:{},quoteId:quote.quoteId,sessionId:id,quantities:{[altId]:{[altVariant]:2}}});
    assert.equal(lines[0].variantId,altVariant);assert.equal(lines[0].quantity,2);
    assert.ok(lines.every(line=>line.customAttributes.some(attr=>attr.key==='_preparedItemId'&&attr.value===altId)));
    await assert.rejects(post('/checkout',{snapshotId,selection,designs:{},quoteId:quote.quoteId,sessionId:id,quantities:{[itemId]:{[variant]:2}}}),error=>error.code==='INVALID_SELECTION');
  }finally{globalThis.fetch=original;}
});
test('edited front/back production exports and the supplied mockup remain assigned to their own garments',async()=>{
  const manualId='bd7410a7-0592-4abc-8eae-5c866bf65333',uploads=[];
  const source=structuredClone(record);source.items.push({...source.items[0],id:manualId});
  source.mockups=[{assetId:'a'.repeat(64),mime:'image/png',itemIds:[manualId]}];
  const env={R2_BUCKET:bucket(),SHOPIFY_SHOP_DOMAIN:'test.myshopify.com'};
  const deps={drafts:{detail:async()=>({items:[itemId,manualId].map((id,index)=>({id:'line-'+index,customAttributes:[{key:'_preparedItemId',value:id},{key:'_group_role',value:'garment'}]}))}),handle:async request=>{const form=await request.formData();uploads.push({role:form.get('role'),placement:form.get('placement'),lines:JSON.parse(form.get('lineItemIds')),bytes:await form.get('file').text()});}}};
  await transferProductionAssets(env,deps,{asset:async()=>({arrayBuffer:async()=>new TextEncoder().encode('SUPPLIED MOCKUP').buffer})},{record:source,recipientFiles:[{itemId,side:'front',svg:'<svg>EDITED FRONT</svg>'},{itemId,side:'back',svg:'<svg>EDITED BACK</svg>'}]},'checkout','gid://shopify/DraftOrder/1',[{itemId},{itemId:manualId}],{completedUploads:[]});
  assert.deepEqual(uploads,[{role:'design',placement:'front',lines:['line-0'],bytes:'<svg>EDITED FRONT</svg>'},{role:'design',placement:'back',lines:['line-0'],bytes:'<svg>EDITED BACK</svg>'},{role:'mockup',placement:'other',lines:['line-1'],bytes:'SUPPLIED MOCKUP'}]);
});
function bucket(){const objects=new Map();let revision=0;return{async get(key){const value=objects.get(key);return value?{etag:value.etag,json:async()=>structuredClone(value.body)}:null},async put(key,body,options={}){const previous=objects.get(key);if(options.onlyIf?.etagMatches&&previous?.etag!==options.onlyIf.etagMatches)return null;if(options.onlyIf?.etagDoesNotMatch==='*'&&previous)return null;const value={body:JSON.parse(body),etag:'r'+(++revision)};objects.set(key,value);return value},objects};}
test('manual and artwork-configured prints reuse canonical classes without requiring images or Studio data',()=>{
  assert.equal(resolveItemPrints(record.items[0],product)[0].label,'Chest Print');
  assert.deepEqual(resolveItemPrints({...record.items[0],printMode:'none'},product),[]);
  assert.throws(()=>resolveItemPrints({...record.items[0],printMode:null},product),error=>error.code==='PRINTING_REQUIRED');
  const artwork={...record.items[0],printMode:'auto',project:{prints:[{side:'front',design:{wIn:4,hIn:4,xIn:0,yIn:0,rotation:0}}]}};
  assert.equal(resolveItemPrints(artwork,product)[0].label,'Breast Print');
  assert.equal(resolveItemPrints({...artwork,project:{...artwork.project,printClassOverrides:{front:{variantId:46714190201080,label:'Full Front Print'}}}},product)[0].mode,'manual');
});
test('mixed selections keep garment/print quantities together and reject injected variants or invalid quantities',()=>{
  const items=[{id:itemId,title:'Manual',color:'Navy',variants:[{id:variant,size:'S'}],prints:[{side:'front',label:'Chest Print',variantId:46714190168312}]},{id:'other',title:'Artwork',variants:[{id:'gid://shopify/ProductVariant/2',size:'M'}],prints:[{side:'back',label:'Full Back Print',variantId:46714190299384}]}];
  const result=buildPreparedCheckoutLines(items,{[itemId]:{[variant]:3},other:{'gid://shopify/ProductVariant/2':2}},linkId,'snapshot');
  assert.equal(result.total,5);assert.deepEqual(result.lines.map(line=>line.quantity),[3,3,2,2]);
  assert.notEqual(result.lines[0].customAttributes.find(a=>a.key==='_group_id').value,result.lines[2].customAttributes.find(a=>a.key==='_group_id').value);
  assert.ok(result.lines.every(line=>line.customAttributes.every(a=>a.key.startsWith('_')||a.key==='Printing')),'production IDs must be private checkout attributes');
  assert.throws(()=>buildPreparedCheckoutLines(items,{[itemId]:{'gid://shopify/ProductVariant/999':1}},linkId,'snapshot'));
  assert.throws(()=>buildPreparedCheckoutLines(items,{[itemId]:{[variant]:-1}},linkId,'snapshot'));
});
test('shared artwork and mockups are copied once, assigned to all selected garment lines and retained on retry',async()=>{
  const second='bd7410a7-0592-4abc-8eae-5c866bf65333',assetId='a'.repeat(64),uploads=[];
  const source=structuredClone(record);source.items.push({...source.items[0],id:second});
  for(const item of source.items)item.project={prints:[{side:'front',asset:{assetId,mime:'image/png'}}]};
  source.mockups=[{assetId,mime:'image/png',itemIds:[itemId,second]}];
  const env={R2_BUCKET:bucket(),SHOPIFY_SHOP_DOMAIN:'test.myshopify.com'};
  const deps={drafts:{detail:async()=>({items:[itemId,second].map((id,index)=>({id:'line-'+index,customAttributes:[{key:'_preparedItemId',value:id},{key:'group_role',value:'garment'}]}))}),handle:async request=>{const form=await request.formData();uploads.push({role:form.get('role'),lines:JSON.parse(form.get('lineItemIds')),bytes:(await form.get('file').arrayBuffer()).byteLength});}}};
  const progress={completedUploads:[]},service={asset:async()=>({arrayBuffer:async()=>new Uint8Array([137,80,78,71,13,10,26,10]).buffer})};
  const run=()=>transferProductionAssets(env,deps,service,{record:source},'checkout','gid://shopify/DraftOrder/1',[{itemId},{itemId:second}],progress);
  await run();await run();assert.equal(uploads.length,2);assert.deepEqual(uploads.map(upload=>upload.role).sort(),['design','mockup']);assert.ok(uploads.every(upload=>upload.lines.length===2&&upload.bytes===8));
});

test('edited artwork is quoted and checked out with manual items; exported files reach the correct production lines',async()=>{
  const editorId='bd7410a7-0592-4abc-8eae-5c866bf65333',source=structuredClone(record),svg='<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10v10z"/></svg>';
  source.items.push({...source.items[0],id:editorId,printMode:'auto',project:{prints:[{id:'art',type:'image',side:'front',design:{xIn:1,yIn:1,wIn:3,hIn:3,rotation:0},asset:{assetId:'a'.repeat(64),mime:'image/png'}}]}});
  const env={R2_BUCKET:bucket(),SHOPIFY_SHOP_DOMAIN:'test.myshopify.com'},snapshotId='a'.repeat(64),key='admin-prepared-orders/v1/test.myshopify.com/published/'+linkId+'/'+snapshotId+'.json';
  const items=source.items.map(item=>({id:item.id,title:item.title,color:'Navy',variants:[{id:variant,size:'S',priceCents:1000}],prints:[{side:'front',label:'Chest Print',variantId:46714190168312,priceCents:500}],images:[]}));
  await env.R2_BUCKET.put(key,JSON.stringify({record:source,items}));
  const original=globalThis.fetch,uploads=[];let mutation;
  globalThis.fetch=async()=>Response.json({preparedOrder:{id:linkId,template:{purchase:{kind:'order_manager_prepared',snapshotId}}}});
  const service={product:async()=>product};
  const deps={graphql:async(_,query,variables)=>{
    if(query.includes('Prices'))return {data:{nodes:variables.ids.map(id=>({id,price:id.endsWith('46714190201080')?'8.00':'5.00'}))}};
    if(query.includes('Scopes'))return {data:{currentAppInstallation:{accessScopes:[{handle:'write_draft_orders'}]}}};
    mutation=variables.input;return {data:{draftOrderCreate:{draftOrder:{id:'gid://shopify/DraftOrder/2',invoiceUrl:'https://test.myshopify.com/invoice/test'},userErrors:[]}}};
  },drafts:{detail:async()=>({items:source.items.map((item,index)=>({id:'line-'+index,customAttributes:[{key:'_preparedItemId',value:item.id},{key:'_group_role',value:'garment'}]}))}),handle:async request=>{const form=await request.formData();uploads.push({lines:JSON.parse(form.get('lineItemIds')),text:await form.get('file').text(),role:form.get('role')})}}};
  const base='https://test/order-manager/v1/prepared-orders/public/'+linkId;
  const designs={[editorId]:{revision:'b'.repeat(64),prints:[{type:'image',side:'front',design:{xIn:1,yIn:2,wIn:12,hIn:12,rotation:5}}]}};
  try{
    const quote=await handlePublicPreparedLinkRequest(new Request(base+'/quote',{method:'POST',body:JSON.stringify({snapshotId,designs})}),env,deps,service);
    assert.equal(quote.items[1].prints[0].label,'Full Front Print');
    const body={sessionId:id,snapshotId,quoteId:quote.quoteId,designs,quantities:{[itemId]:{[variant]:2},[editorId]:{[variant]:1}},artwork:{[editorId]:{front:svg}}};
    const result=await handlePublicPreparedLinkRequest(new Request(base+'/checkout',{method:'POST',body:JSON.stringify(body)}),env,deps,service);
    assert.equal(result.checkoutUrl,'https://test.myshopify.com/invoice/test');
    assert.deepEqual(mutation.lineItems.map(line=>line.quantity),[2,2,1,1]);
    assert.equal(mutation.lineItems[3].variantId,'gid://shopify/ProductVariant/46714190201080');
    assert.deepEqual(uploads,[{lines:['line-1'],text:svg,role:'design'}]);
    await assert.rejects(handlePublicPreparedLinkRequest(new Request(base+'/checkout',{method:'POST',body:JSON.stringify({...body,quoteId:'stale'})}),env,deps,service),error=>error.code==='PRICE_CHANGED');
  }finally{globalThis.fetch=original}
});
test('publish, public review and idempotent Shopify checkout work without imagery and never expose private notes',async()=>{
  const env={R2_BUCKET:bucket(),SHOPIFY_SHOP_DOMAIN:'test.myshopify.com',PREPARED_ORDER_ADMIN_TOKEN:'fixture-token'};let template,creates=0,revoked=false,printPrice='5.00';const original=globalThis.fetch;
  globalThis.fetch=async(url,options={})=>{
    const path=new URL(url).pathname;
    if(path.endsWith('/revoke')){revoked=true;return Response.json({revoked:true})}
    if(path.includes('/public/'))return revoked?Response.json({error:'revoked'},{status:410}):Response.json({preparedOrder:{id:linkId,reference:'PM-TEST',expiresAt:'2099-01-01T00:00:00Z',template}});
    if(path.endsWith('/edit'))return Response.json({revision:'edit-1'});
    if(path.endsWith('/'+linkId))return Response.json({preparedOrder:{id:linkId,status:revoked?'revoked':'active',expiresAt:'2099-01-01T00:00:00Z'}});
    if(path.endsWith('/finalize')||path.endsWith('/revise')){template=JSON.parse(options.body).template;return Response.json({id:linkId,reference:'PM-TEST',createdAt:new Date().toISOString(),expiresAt:'2099-01-01T00:00:00Z'})}
    return Response.json({id:linkId,status:'uploading'});
  };
  const deps={graphql:async(_,query)=>{
    if(query.includes('PreparedCheckoutScopes'))return {ok:true,data:{currentAppInstallation:{accessScopes:[{handle:'write_draft_orders'}]}}};
    if(query.includes('PreparedCheckoutPrices'))return {ok:true,data:{nodes:[{id:'gid://shopify/ProductVariant/46714190168312',price:printPrice}]}};
    if(query.includes('PreparedCheckoutCreate')){creates++;return {ok:true,data:{draftOrderCreate:{draftOrder:{id:'gid://shopify/DraftOrder/1',invoiceUrl:'https://test.myshopify.com/invoice/test'},userErrors:[]}}}}
    throw Error('Unexpected query');
  },drafts:{detail:async()=>({items:[{id:'gid://shopify/DraftOrderLineItem/1',customAttributes:[{key:'_preparedItemId',value:itemId},{key:'group_role',value:'garment'}]}]})}};
  const service={read:async()=>structuredClone(record),product:async()=>structuredClone(product)};
  try{
    const published=await handlePreparedLinkRequest(new Request('https://test',{method:'POST',body:JSON.stringify({expectedRevision:record.revision})}),env,deps,service,id,'publish');assert.equal(published.link.url,'https://print-mo.com/pages/designer-studio?preparedOrder='+linkId);
    const publicRequest=new Request('https://test/order-manager/v1/prepared-orders/public/'+linkId);
    const viewed=await handlePublicPreparedLinkRequest(publicRequest,env,deps,service);assert.equal(viewed.order.items[0].variants[0].size,'S');assert.equal(viewed.order.items[0].prints[0].priceCents,500);assert.equal(JSON.stringify(viewed).includes('PRIVATE STAFF NOTE'),false);
    const body={sessionId:id,snapshotId:viewed.order.snapshotId,quantities:{[itemId]:{[variant]:2}}};
    const checkoutRequest=()=>new Request(publicRequest.url+'/checkout',{method:'POST',body:JSON.stringify(body)});
    const first=await handlePublicPreparedLinkRequest(checkoutRequest(),env,deps,service);const second=await handlePublicPreparedLinkRequest(checkoutRequest(),env,deps,service);assert.equal(creates,1);assert.equal(first.checkoutUrl,second.checkoutUrl);
    printPrice='6.00';
    await handlePreparedLinkRequest(new Request('https://test',{method:'POST',body:JSON.stringify({expectedRevision:record.revision,refresh:true})}),env,deps,service,id,'publish');
    const refreshed=await handlePublicPreparedLinkRequest(publicRequest,env,deps,service);
    assert.notEqual(refreshed.order.snapshotId,viewed.order.snapshotId);
    assert.equal(refreshed.order.items[0].prints[0].priceCents,600);
    const oldSnapshot=[...env.R2_BUCKET.objects].find(([key])=>key.endsWith('/'+viewed.order.snapshotId+'.json'))[1].body;
    assert.equal(oldSnapshot.items[0].prints[0].priceCents,500);
    await handlePreparedLinkRequest(new Request('https://test',{method:'POST'}),env,deps,service,id,'revoke');await assert.rejects(handlePublicPreparedLinkRequest(publicRequest,env,deps,service),error=>error.status===410);
    const inactive=await handlePreparedLinkRequest(new Request('https://test'),env,deps,service,id,'link');assert.equal(inactive.link.status,'revoked');
  }finally{globalThis.fetch=original}
});

test('only concurrent identical quotes coalesce; later quotes and checkout validate current commerce again',async()=>{
  const snapshotId='c'.repeat(64),env={SHOPIFY_SHOP_DOMAIN:'coalescing.myshopify.com',R2_BUCKET:bucket(),PREPARED_ORDER_SERVICE:{fetch:async()=>Response.json({preparedOrder:{id:linkId,expiresAt:'2099-01-01',template:{purchase:{kind:'order_manager_prepared',snapshotId}}}})}};
  await env.R2_BUCKET.put('admin-prepared-orders/v1/coalescing.myshopify.com/published/'+linkId+'/'+snapshotId+'.json',JSON.stringify({record,items:[{id:itemId,variants:[{id:variant,size:'S',priceCents:1000}],prints:[],images:[]}]}));
  let reads=0;const service={priceProducts:async()=>{reads++;await new Promise(resolve=>setTimeout(resolve,2));return new Map([[record.items[0].productId,product]])}},deps={graphql:async()=>({data:{nodes:[{id:'gid://shopify/ProductVariant/46714190168312',price:'5.00',product:{handle:'printing'}}]}})};
  const request=(path,extra={})=>new Request('https://worker.test/order-manager/v1/prepared-orders/public/'+linkId+'/'+path,{method:'POST',body:JSON.stringify({snapshotId,...extra})});
  const first=await Promise.all([handlePublicPreparedLinkRequest(request('quote'),env,deps,service),handlePublicPreparedLinkRequest(request('quote'),env,deps,service)]);
  assert.equal(reads,1);assert.equal(first[0].quoteId,first[1].quoteId);
  await handlePublicPreparedLinkRequest(request('quote'),env,deps,service);assert.equal(reads,2);
  await assert.rejects(handlePublicPreparedLinkRequest(request('checkout',{designs:{},sessionId:id,quoteId:'stale',quantities:{[itemId]:{[variant]:1}}}),env,deps,service),error=>error.code==='PRICE_CHANGED');assert.equal(reads,3);
});
