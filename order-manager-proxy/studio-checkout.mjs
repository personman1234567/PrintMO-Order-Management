// Ordinary Studio is an adapter to Prepared's validated quote and checkout core.
import {createPreparedDraftService} from './prepared-order-drafts.mjs';
import {recipientDesigns} from './prepared-recipient.mjs';
import {recipientQuote,completePreparedCheckout} from './prepared-order-links.mjs';
import {readPreparedBody} from './prepared-artwork-transport.mjs';
import {studioMerchandiseRequests,studioMerchandiseLines} from './studio-merchandise.mjs';

export const STUDIO_VARIANTS_QUERY = `query StudioCheckoutVariants($ids: [ID!]!) {
  nodes(ids:$ids) { ... on ProductVariant { id sku title price availableForSale product { id title status partner:metafield(namespace:"custom",key:"partner_reference"){value} } } }
}`;
export const STUDIO_SNAPSHOT_TTL_MS=30*60*1000;
const SERVICE_SKUS={'background-removal':'PM-ART-BG-REMOVE'};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const GID=/^gid:\/\/shopify\/ProductVariant\/[1-9]\d{0,19}$/;
const SIDES=['front','back','breast','left','right'];
const attempts=new Map();
const fail=(code,message,status=400)=>{throw Object.assign(new Error(message),{code,status});};
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
const prefix=env=>`studio-checkout/v1/${encodeURIComponent(env.SHOPIFY_SHOP_DOMAIN.toLowerCase())}/`;
const key=(env,id)=>prefix(env)+id+'.json';
const checked=result=>{if(!result?.data||result.ok===false||result.errors?.length)fail('PRICE_UNAVAILABLE','Current products could not be verified. Refresh the order price.',502);return result.data;};
const text=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';

function rateLimit(request,action) {
  const minute=Math.floor(Date.now()/60000),key=(request.headers.get('CF-Connecting-IP')||'unknown')+':'+action;
  const previous=attempts.get(key),count=previous?.minute===minute?previous.count+1:1;
  if(attempts.size>5000)attempts.clear();attempts.set(key,{minute,count});
  if(count>(action==='quote'?30:12))fail('CHECKOUT_RATE_LIMIT','Too many checkout attempts. Wait a minute, then retry.',429);
}
export function studioServiceRequests(input,itemIds) {
  if(input===undefined)return [];
  if(!Array.isArray(input)||input.length>120)fail('INVALID_SERVICE','The artwork services could not be verified.');
  const unique=new Map();
  for(const value of input){
    if(!object(value)||!Object.hasOwn(SERVICE_SKUS,value.key)||!GID.test(value.variantId||'')
      ||typeof value.assetKey!=='string'||!value.assetKey.trim()||value.assetKey.length>200
      ||(value.itemId!==undefined&&!itemIds.has(value.itemId))||(value.side!==undefined&&!SIDES.includes(value.side)))fail('INVALID_SERVICE','Choose an available artwork service.');
    const normalized={key:value.key,variantId:value.variantId,assetKey:value.assetKey.trim(),note:text(value.note,1000),
      ...(value.itemId?{itemId:value.itemId}:{}),...(value.side?{side:value.side}:{})};
    const identity=JSON.stringify([normalized.assetKey,normalized.key,normalized.variantId]);
    if(!unique.has(identity))unique.set(identity,normalized);
  }
  return [...unique.values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
async function serviceLines(env,deps,requests,id,snapshotId,quantities) {
  if(!requests.length)return {lines:[],items:[],services:[]};
  const ids=[...new Set(requests.map(value=>value.variantId))];
  const variants=new Map((checked(await deps.graphql(env,STUDIO_VARIANTS_QUERY,{ids},'StudioCheckoutVariants')).nodes||[]).filter(Boolean).map(value=>[value.id,value]));
  const lines=[],items=[],services=[];
  for(const [index,request]of requests.entries()){
    const variantId=request.variantId,variant=variants.get(variantId);
    if(!variant||variant.sku!==SERVICE_SKUS[request.key]||variant.availableForSale!==true||variant.product?.status!=='ACTIVE')fail('SERVICE_UNAVAILABLE','An artwork service is no longer available. Refresh the order price.',409);
    const priceCents=Math.round(Number(variant.price)*100);if(!Number.isSafeInteger(priceCents)||priceCents<0)fail('PRICE_UNAVAILABLE','The artwork service price could not load.',502);
    const itemId='studio-service-'+index,label=variant.title&&!/^default(?: title)?$/i.test(variant.title)?variant.title:variant.product.title;
    const owner=request.itemId||Object.keys(quantities).find(item=>Object.values(quantities[item]).some(value=>value>0));
    const parent=Object.entries(quantities[owner]||{}).find(([,quantity])=>quantity>0)?.[0];
    if(!parent)fail('INVALID_SERVICE','An artwork service must belong to a selected garment.');
    services.push({...request,label,priceCents,quantity:1});
    items.push({id:itemId,prints:[{variantId:request.variantId.split('/').pop(),priceCents}]});
    const attrs={_preparedOrderId:id,_preparedConfigId:snapshotId,_preparedItemId:itemId,_batch_id:id+':service:'+index,_batch_role:'service',_group_role:'artwork_service',_group_id:id+':'+owner,_parent_id:parent.split('/').pop(),_artwork_service:request.key,_artwork_asset:request.assetKey,
      ...(request.side?{_side:request.side}:{}),...(request.note?{'Artwork service instructions':request.note}:{})};
    lines.push({variantId,quantity:1,customAttributes:Object.entries(attrs).map(([key,value])=>({key,value:String(value)}))});
  }
  return {lines,items,services};
}
async function validatedSource(env,deps,service,body,id) {
  const merchandise=studioMerchandiseRequests(env,body.merchandise);
  if(!Array.isArray(body.items)||(!body.items.length&&!merchandise.length)||body.items.length>30)fail('ITEMS_REQUIRED','Choose between 1 and 30 garments, or add merchandise.');
  const used=new Set(),quantities={},designs={},items=[];
  for(const source of body.items){
    if(!object(source)||typeof source.id!=='string'||!source.id||source.id.length>100||['__proto__','constructor','prototype'].includes(source.id)||/[\x00-\x1f]/.test(source.id)||used.has(source.id)||!GID.test(source.variantId||'')||!object(source.quantities)||!object(source.design))fail('INVALID_ITEM','Your garment details could not be verified.');
    if(merchandise.length&&source.id.startsWith('merch:'))fail('INVALID_ITEM','This garment identifier is reserved.');
    used.add(source.id);
    if(Object.keys(source.quantities).length>100||Object.keys(source.quantities).some(v=>!GID.test(v)))fail('INVALID_QUANTITY','Choose valid garment sizes.');
    quantities[source.id]=source.quantities;
    designs[source.id]=source.design;
    items.push({id:source.id,variantId:source.variantId,instructions:text(source.instructions,1000),recipientConfiguration:true,
      // Seed allows the existing descriptor validator to normalize empty designs too.
      project:{prints:[{}]}});
  }
  const ids=[...new Set(items.map(item=>item.variantId))];
  const variants=new Map((checked(await deps.graphql(env,STUDIO_VARIANTS_QUERY,{ids},'StudioCheckoutVariants')).nodes||[]).filter(Boolean).map(value=>[value.id,value]));
  for(const item of items){
    const variant=variants.get(item.variantId);
    if(!variant||variant.availableForSale!==true||!['ACTIVE','UNLISTED'].includes(variant.product?.status))fail('VARIANT_UNAVAILABLE','A garment is no longer available. Choose another size or color.',409);
    if(env.STUDIO_MERCHANDISE_PROOF_ENABLED==='true'&&variant.product.partner?.value)fail('MERCHANDISE_TYPE_REQUIRED','Add storefront merchandise as merchandise, not a custom garment.',409);
    item.productId=variant.product.id;
  }
  // Read only the requested sizes and canonical configuration, once per quote.
  const products=await service.priceProducts({items},items.map(item=>({id:item.id,variants:Object.keys(quantities[item.id]).map(id=>({id}))})));
  for(const item of items){
    const variant=variants.get(item.variantId);
    if(!variant||variant.availableForSale!==true||!['ACTIVE','UNLISTED'].includes(variant.product?.status))fail('VARIANT_UNAVAILABLE','A garment is no longer available. Choose another size or color.',409);
    item.productId=variant.product.id;
    const product=products.get(item.productId),actual=product.variants.find(v=>v.id===item.variantId);
    if(!actual||actual.availableForSale!==true)fail('VARIANT_UNAVAILABLE','A garment is no longer available. Refresh the order price.',409);
    item.title=product.title;item.handle=product.handle;item.color=actual.selectedOptions.find(o=>/^colou?r$/i.test(o.name))?.value||'';
    // Missing inventory data is unavailable, including every selected size.
    product.variants=product.variants.map(v=>({...v,availableForSale:v.availableForSale===true}));
    const hidden=(product.config?.hiddenColors||[]).some(v=>String(v).trim().toLowerCase()===item.color.trim().toLowerCase());
    if(hidden)fail('VARIANT_UNAVAILABLE','This garment color is no longer available.',409);
  }
  const normalized=recipientDesigns({id,title:'Studio order',mockups:[],items},designs);
  for(const item of normalized.record.items)item.printMode=item.project.prints.length?'auto':'none';
  const services=studioServiceRequests(body.services,used);
  return {record:normalized.record,designs:normalized.designs,quantities,services,products,...(merchandise.length?{merchandise}:{})};
}
async function freshQuote(env,deps,service,snapshot,preloadedProducts) {
  if(env.STUDIO_MERCHANDISE_PROOF_ENABLED==='true'&&!preloadedProducts&&snapshot.record.items.length){
    const ids=[...new Set(snapshot.record.items.map(item=>item.variantId))];
    const variants=checked(await deps.graphql(env,STUDIO_VARIANTS_QUERY,{ids},'StudioCheckoutVariants')).nodes||[];
    if(variants.some(variant=>variant?.product?.partner?.value))fail('MERCHANDISE_TYPE_REQUIRED','This product is now storefront merchandise. Refresh the order.',409);
  }
  // Initial validation shares this request's reads. Checkout always reads afresh.
  const [products,services,merchandise]=await Promise.all([
    preloadedProducts || service.priceProducts(snapshot.record,snapshot.items),
    serviceLines(env,deps,snapshot.services,snapshot.id,snapshot.snapshotId,snapshot.quantities),
    studioMerchandiseLines(env,deps,snapshot.merchandise||[],snapshot.id,snapshot.snapshotId)
  ]);
  const extras={lines:[...services.lines,...merchandise.lines],items:[...services.items,...merchandise.items]};
  for(const [id,value]of products){
    for(const item of snapshot.record.items.filter(item=>item.productId===id))if((value.config?.hiddenColors||[]).some(color=>String(color).trim().toLowerCase()===item.color.trim().toLowerCase()))fail('VARIANT_UNAVAILABLE','This garment color is no longer available.',409);
    products.set(id,{...value,variants:value.variants.map(v=>({...v,availableForSale:v.availableForSale===true}))});
  }
  const freshService={...service,priceProducts:async()=>products};
  const document={order:{id:snapshot.id},purchase:{snapshotId:snapshot.snapshotId},snapshot:{record:snapshot.record,items:snapshot.items||[]}};
  // A blank Studio design is a valid no-printing selection, while Prepared's
  // editor intentionally refuses edits to its separate mockup-only items.
  const designs=Object.fromEntries(Object.entries(snapshot.designs).filter(([,value])=>value.prints.length));
  const quote=await recipientQuote(env,deps,freshService,document,{snapshotId:snapshot.snapshotId,quantities:snapshot.quantities,designs},extras);
  return {quote,document,services:services.services,...(merchandise.merchandise.length?{merchandise:merchandise.merchandise}:{})};
}

export async function handleStudioCheckoutRequest(request,env,deps,providedService) {
  if(!['https://print-mo.com','https://www.print-mo.com'].includes(request.headers.get('Origin')))fail('ORIGIN_FORBIDDEN','Open Studio on print-mo.com to continue.',403);
  const match=new URL(request.url).pathname.match(/^\/order-manager\/v1\/studio-checkout\/(quote|([a-f0-9-]{36})\/checkout)$/i);
  if(!match)fail('NOT_FOUND','This checkout is unavailable.',404);
  if(request.method!=='POST')fail('METHOD_NOT_ALLOWED','Use the Studio checkout controls.',405);
  if(!env.R2_BUCKET||!env.SHOPIFY_SHOP_DOMAIN)fail('CHECKOUT_UNAVAILABLE','Checkout storage is unavailable.',503);
  const isQuote=match[1]==='quote';rateLimit(request,isQuote?'quote':'checkout');
  const body=await readPreparedBody(request),service=providedService||createPreparedDraftService(env,deps);
  if(isQuote){
    if(new TextEncoder().encode(JSON.stringify(body)).length>512*1024)fail('REQUEST_TOO_LARGE','Your garment details are too large.',413);
    const id=crypto.randomUUID(),{products,...source}=await validatedSource(env,deps,service,body,id);
    const snapshotId=await hash(JSON.stringify(source)),expiresAt=new Date(Date.now()+STUDIO_SNAPSHOT_TTL_MS).toISOString();
    const snapshot={id,snapshotId,expiresAt,...source,items:source.record.items.map(item=>({id:item.id,images:[]}))};
    const fresh=await freshQuote(env,deps,service,snapshot,products);snapshot.items=fresh.quote.items;snapshot.quoteId=fresh.quote.quoteId;
    await env.R2_BUCKET.put(key(env,id),JSON.stringify(snapshot),{httpMetadata:{contentType:'application/json'}});
    return {id,snapshotId,quoteId:snapshot.quoteId,expiresAt,items:fresh.quote.items.map(item=>({...item,variantId:snapshot.record.items.find(v=>v.id===item.id).variantId,quantities:snapshot.quantities[item.id],design:snapshot.designs[item.id]})),services:fresh.services,...(fresh.merchandise?{merchandise:fresh.merchandise}:{}),pricing:fresh.quote.pricing};
  }
  const id=match[2];if(!UUID.test(id))fail('CHECKOUT_UNAVAILABLE','This checkout is unavailable.',404);
  const stored=await env.R2_BUCKET.get(key(env,id)),snapshot=stored?await stored.json():null;
  if(!snapshot||Date.parse(snapshot.expiresAt)<=Date.now())fail('QUOTE_EXPIRED','Refresh the order price before checkout.',410);
  if(body.snapshotId!==snapshot.snapshotId||body.quoteId!==snapshot.quoteId)fail('ORDER_CHANGED','Your design or quantities changed. Refresh the order price.',409);
  // Checkout accepts export media only. Design/quantity/service changes require a new quote.
  if(['items','quantities','designs','services','merchandise','selection','configurations'].some(k=>body[k]!==undefined))fail('ORDER_CHANGED','Refresh the order price after changing the order.',409);
  const fresh=await freshQuote(env,deps,service,snapshot);
  if(fresh.quote.quoteId!==snapshot.quoteId)fail('PRICE_CHANGED','The price or print setup changed. Refresh the order price.',409);
  return completePreparedCheckout(request,env,deps,service,id,fresh.document,{...body,quantities:snapshot.quantities},fresh.quote,{studioActivity:true});
}
