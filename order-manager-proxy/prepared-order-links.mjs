import { derivePrintPricingForDesign, printClassChoices, resolvePrintClasses, placementInkBounds } from './prepared-commerce-pricing.mjs';
import { recipientTemplate, recipientDesigns, recipientArtwork, recipientChoicePresentations } from './prepared-recipient.mjs';
import { selectedPreparedRecord, primaryPreparedTemplate, preparedSelection } from './prepared-choices.mjs';
import { mapConcurrent } from './prepared-publish-progress.mjs';
import {recipientSizeGuides} from './prepared-size-guides.mjs';
const UPSTREAM = 'https://designer-preview-upload.printmobusiness.workers.dev';
const customerUrl = (_env,id) => 'https://print-mo.com/pages/designer-studio?preparedOrder='+id;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const attempts = new Map();
const quoteFlights = new Map();
const ROOT = env => `admin-prepared-orders/v1/${encodeURIComponent(env.SHOPIFY_SHOP_DOMAIN.toLowerCase())}/`;
const fail = (code, message, status = 400) => { throw Object.assign(new Error(message), {code, status}); };
const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2,'0')).join('');
const checked = result => {
  if (result?.ok !== false && result?.data && !result.errors?.length) return result.data;
  if (result?.errors?.some(error => error.extensions?.code === 'ACCESS_DENIED')) fail('CHECKOUT_ACCESS_REQUIRED', 'Shopify needs draft checkout permission. Reopen Order Manager in Shopify and approve the updated app permissions, then retry.', 403);
  fail('SHOPIFY_UNAVAILABLE', 'Shopify could not finish this action. Your order is still here; retry.', 502);
};
export const PREPARED_SCOPE_QUERY = 'query PreparedCheckoutScopes { currentAppInstallation { accessScopes { handle } } }';
export const PREPARED_PRICE_QUERY = 'query PreparedCheckoutPrices($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { id price product { handle } } } }';
export const PREPARED_CHECKOUT_CREATE = `mutation PreparedCheckoutCreate($input: DraftOrderInput!) { draftOrderCreate(input: $input) { draftOrder { id invoiceUrl } userErrors { field message } } }`;
export const PREPARED_CHECKOUT_RECOVER = `query PreparedCheckoutRecover($query: String!) { draftOrders(first: 1, query: $query) { nodes { id invoiceUrl status } } }`;
async function requireCheckoutAccess(env, deps) {
  const data = checked(await deps.graphql(env, PREPARED_SCOPE_QUERY, {}, 'PreparedCheckoutScopes'));
  if (!data.currentAppInstallation.accessScopes.some(scope => scope.handle === 'write_draft_orders')) fail('CHECKOUT_ACCESS_REQUIRED', 'Shopify needs draft checkout permission. Reopen Order Manager in Shopify and approve the updated app permissions, then retry.', 403);
}
async function remote(env, path, {method = 'GET', body, mime = 'application/json', staff = false} = {}) {
  if (staff && !env.PREPARED_ORDER_ADMIN_TOKEN) fail('PUBLISH_NOT_CONFIGURED', 'Customer links are not configured yet. Ask the app owner to finish setup.', 503);
  const transport = env.PREPARED_ORDER_SERVICE ? env.PREPARED_ORDER_SERVICE.fetch.bind(env.PREPARED_ORDER_SERVICE) : fetch;
  const response = await transport(UPSTREAM + '/api/prepared-orders' + path, {method, headers: {Origin:'https://print-mo.com', 'Content-Type': mime, ...(staff ? {'X-PM-Admin-Token':env.PREPARED_ORDER_ADMIN_TOKEN} : {})}, body});
  const result = await response.json().catch(()=>({}));
  if (!response.ok) fail('PREPARED_LINK_UNAVAILABLE', [404,410].includes(response.status) ? 'This order link is unavailable or has expired. Contact Print-MO for a new link.' : 'The order link could not be updated or opened. Try again.', response.status);
  return result;
}
async function readJson(bucket, key) { const stored=await bucket.get(key); return stored ? {value:await stored.json(),etag:stored.etag} : null; }
async function writeJson(bucket,key,value,onlyIf) { return bucket.put(key,JSON.stringify(value),{httpMetadata:{contentType:'application/json'},...(onlyIf?{onlyIf}:{})}); }
const mappingKey=(env,id)=>ROOT(env)+'links/'+id+'.json';
export async function deletePreparedPreparation(env, service, id, body, actor) {
  if (!UUID.test(id)) fail('INVALID_ID', 'Choose a saved prepared order.');
  const key = mappingKey(env, id), existing = await readJson(env.R2_BUCKET, key);
  if (existing?.value?.publishingAt && Date.now() - Date.parse(existing.value.publishingAt) < 120000)
    fail('PUBLISH_PENDING', 'This customer link is being updated. Wait a moment before deleting.', 409);
  // Use the same lease as publishing, so deletion cannot leave a newly-created
  // live link behind. No preparation is deleted unless link revocation succeeds.
  const lease = await writeJson(env.R2_BUCKET, key, { ...(existing?.value || {}), publishingAt: new Date().toISOString() },
    existing ? { etagMatches: existing.etag } : { etagDoesNotMatch: '*' });
  if (!lease) fail('PUBLISH_PENDING', 'This link changed. Refresh before deleting.', 409);
  let revoked = false;
  try {
    return await service.remove(id, body, actor, async () => {
      if (existing?.value?.link) {
        try { await remote(env, '/' + existing.value.link.id + '/revoke', { method: 'POST', body: '{}', staff: true }); }
        catch (error) { if (![404, 410].includes(error.status)) throw error; }
      }
      revoked = true;
    });
  } finally {
    const value = { ...(existing?.value || {}) }; delete value.publishingAt;
    if (revoked && value.link) value.link = { ...value.link, status: 'revoked' };
    const released = await writeJson(env.R2_BUCKET, key, value, { etagMatches: lease.etag });
    if (!released) fail('VERSION_CONFLICT', 'The link state changed. Refresh the list to check this deletion.', 409);
  }
}
async function currentLink(env, mapping) {
  if (!mapping?.link) return null;
  try {
    const {preparedOrder} = await remote(env, '/'+mapping.link.id, {staff:true});
    return {...mapping.link, url:customerUrl(env,mapping.link.id), status:preparedOrder.status, expiresAt:preparedOrder.expiresAt};
  } catch(error) {
    if ([404,410].includes(error.status)) return {...mapping.link,status:'revoked'};
    throw error;
  }
}
function physicalWidths(project, field) { return Object.fromEntries(['front','back','breast','left','right'].map(side=>[side,project?.canvasCalibration?.bySide?.[side]?.[field] || 12])); }
export function resolveItemPrints(item, product) {
  const mode=item.printMode || (item.project?.prints?.length ? 'auto' : '');
  if (!mode) fail('PRINTING_REQUIRED', `Choose printing or “No printing” for ${item.title} before creating its link.`);
  if(mode==='none')return [];
  if(mode==='manual') {
    if(!item.manualPrints?.length)fail('PRINTING_REQUIRED',`Choose at least one print for ${item.title}, or select “No printing”.`);
    const used=new Set();
    return item.manualPrints.map(value=>{const choice=printClassChoices(product.config,value.side).find(c=>c.variantId===value.variantId);if(!choice||used.has(value.side))fail('PRINTING_CHANGED',`Check the print setup for ${item.title}.`);used.add(value.side);return {...choice,side:value.side,mode:'manual'};});
  }
  if(!item.project?.prints?.length)fail('PRINTING_REQUIRED',`Add artwork or choose a manual print setup for ${item.title}.`);
  const decisions=derivePrintPricingForDesign({prints:item.project.prints,placements:product.config.placements,safeAreaWidthInBySide:physicalWidths(item.project,'safeWidthIn'),canvasReferenceWidthInBySide:physicalWidths(item.project,'referenceWidthIn')});
  const classes=resolvePrintClasses(product.config,decisions,item.project.printClassOverrides||{});
  if(!classes.length)fail('PRINTING_REQUIRED',`Check the artwork size or choose a manual print setup for ${item.title}.`);
  const charged=new Set(classes.map(value=>value.side==='breast'?'front':value.side));
  if(item.project.prints.some(print=>!charged.has(print.side==='breast'?'front':print.side)))fail('PRINTING_REQUIRED',`A designed print location on ${item.title} has no print charge. Check its artwork or choose a manual print setup.`);
  return classes;
}
function variantChoices(item, product) {
  const reference=product.variants.find(variant=>variant.id===item.variantId);
  if(!reference)fail('PRODUCT_CHANGED',`${item.title} has changed in Shopify. Choose its garment and color again.`);
  const options=reference.selectedOptions.filter(option=>!/^size$/i.test(option.name));
  return product.variants.filter(variant=>options.every(option=>variant.selectedOptions.some(value=>value.name===option.name&&value.value===option.value))).map(variant=>({id:variant.id,size:variant.selectedOptions.find(option=>/^size$/i.test(option.name))?.value||'One size',priceCents:Math.round(Number(variant.price)*100)}));
}
async function enrich(env,deps,service,record,snapshotItems) {
  if(!record.items.length)fail('ITEMS_REQUIRED','Add a garment before creating a customer link.');
  const products=snapshotItems&&service.priceProducts?await service.priceProducts(record,snapshotItems):new Map(),items=[];
  await mapConcurrent([...new Set(record.items.map(item=>item.productId))].filter(id=>!products.has(id)),3,async id=>products.set(id,await service.product(id)));
  for(const item of record.items){if(!products.has(item.productId))products.set(item.productId,await service.product(item.productId));const product=products.get(item.productId);const dimensions=(item.project?.prints||[]).map(print=>{const bounds=placementInkBounds(print),side=item.project.canvasCalibration?.bySide?.[print.side],scale=side?side.referenceWidthIn/side.safeWidthIn:1;return `${print.side}: ${(bounds.w*scale).toFixed(2)} x ${(bounds.h*scale).toFixed(2)} in, ${print.design.rotation} degrees`;}).join('; ');items.push({id:item.id,title:product.title,color:item.optionLabel||item.color||item.variantTitle,variants:variantChoices(item,product),prints:resolveItemPrints(item,product),dimensions,instructions:item.instructions||'',image:product.image||''});}
  const ids=[...new Set(items.flatMap(item=>item.prints.map(print=>'gid://shopify/ProductVariant/'+print.variantId)))];
  const prices=new Map(),handles=new Map();if(ids.length){const data=checked(await deps.graphql(env,PREPARED_PRICE_QUERY,{ids},'PreparedCheckoutPrices'));for(const value of data.nodes||[])if(value?.id){prices.set(value.id,Math.round(Number(value.price)*100));handles.set(value.id,value.product?.handle||'');}}
  for(const item of items){item.cartHandle=products.get(record.items.find(source=>source.id===item.id).productId)?.handle||'';for(const print of item.prints){print.priceCents=prices.get('gid://shopify/ProductVariant/'+print.variantId);print.cartHandle=handles.get('gid://shopify/ProductVariant/'+print.variantId)||'';if(!Number.isSafeInteger(print.priceCents)||print.priceCents<0)fail('PRINT_UNAVAILABLE',`A print option on ${item.title} is unavailable. Check its printing setup.`);}if(item.variants.some(variant=>!Number.isSafeInteger(variant.priceCents)||variant.priceCents<0))fail('PRICE_UNAVAILABLE',`The price for ${item.title} could not load.`);}
  return items;
}
export async function preparedPrintChoices(service,productId) {const product=await service.product(productId);return Object.fromEntries(['front','back','left','right'].map(side=>[side,printClassChoices(product.config,side)]));}
async function publishedOrder(env,id) {
  if(!UUID.test(id))fail('LINK_UNAVAILABLE','This order link is invalid.',404);
  const result=await remote(env,'/public/'+id);const order=result.preparedOrder;
  const purchase=order?.template?.purchase;
  if(!order||purchase?.kind!=='order_manager_prepared'||!HASH.test(purchase.snapshotId||''))fail('LINK_UNAVAILABLE','This order link is unavailable.',404);
  const stored=await readJson(env.R2_BUCKET,ROOT(env)+'published/'+id+'/'+purchase.snapshotId+'.json');
  if(!stored)fail('LINK_UNAVAILABLE','This order link is unavailable. Contact Print-MO.',410);
  return {order,purchase,snapshot:stored.value};
}
export async function handlePreparedLinkRequest(request,env,deps,service,id,action,onProgress=()=>{}) {
  if(!UUID.test(id))fail('INVALID_ID','Choose a saved prepared order.');
  const key=mappingKey(env,id),existing=await readJson(env.R2_BUCKET,key);
  if(action==='link'&&request.method==='GET')return {link:await currentLink(env,existing?.value)};
  if(action==='print-choices'&&request.method==='GET')return {choices:await preparedPrintChoices(service,new URL(request.url).searchParams.get('productId'))};
  if(action==='revoke'&&request.method==='POST'){
    if(existing?.value?.link){await remote(env,'/'+existing.value.link.id+'/revoke',{method:'POST',body:'{}',staff:true});await writeJson(env.R2_BUCKET,key,{...existing.value,link:{...existing.value.link,status:'revoked'}});}
    return {revoked:true};
  }
  if(action!=='publish'||request.method!=='POST')fail('NOT_FOUND','This customer-link action is unavailable.',404);
  const body=await request.json(),record=await service.read(id);
  if(record.revision!==body.expectedRevision)fail('VERSION_CONFLICT','This order changed. Wait for saving to finish, then create the link again.',409);
  const started=Date.now();
  onProgress({stage:'checking'});
  const activeLink=await currentLink(env,existing?.value);
  if(!body.refresh&&existing?.value?.sourceRevision===record.revision&&activeLink?.status==='active'&&Date.parse(activeLink.expiresAt)>Date.now())return {link:activeLink,publication:{unchanged:true,uploadedAssets:0,reusedAssets:0,durationMs:Date.now()-started}};
  await requireCheckoutAccess(env,deps);
  if(existing?.value?.publishingAt&&Date.now()-Date.parse(existing.value.publishingAt)<120000)fail('PUBLISH_PENDING','This link is already being created. Wait a moment, then retry.',409);
  const lease=await writeJson(env.R2_BUCKET,key,{...(existing?.value||{}),publishingAt:new Date().toISOString()},existing?{etagMatches:existing.etag}:{etagDoesNotMatch:'*'});
  if(!lease)fail('PUBLISH_PENDING','This link is already being created. Retry in a moment.',409);
  let link=activeLink;
  const assetUrls=new Map();
  let uploadedAssets=0,reusedAssets=0;
  try {
    onProgress({stage:'products'});
    // Request-local promises share paginated product reads with recipientTemplate.
    const products=new Map(),publishingService={...service,product:productId=>{
      if(!products.has(productId))products.set(productId,Promise.resolve().then(()=>service.product(productId)));
      return products.get(productId);
    }};
    const items=await enrich(env,deps,publishingService,record),snapshotId=await hash(JSON.stringify({record,items}));
    if(link?.status==='active'&&Date.parse(link.expiresAt)>Date.now()&&existing?.value.snapshotId===snapshotId){
      const saved=await writeJson(env.R2_BUCKET,key,{...existing.value,link},{etagMatches:lease.etag});
      if(!saved)fail('PUBLISH_CHANGED','This link changed while publishing. Reopen the order before retrying.',409);
      return {link,publication:{unchanged:true,uploadedAssets:0,reusedAssets:0,durationMs:Date.now()-started}};
    }
    if(!link||link.status!=='active'||Date.parse(link.expiresAt)<=Date.now())link=await remote(env,'',{method:'POST',body:JSON.stringify({uploadDraft:true,title:record.title.slice(0,120),preparedFor:record.preparedFor,customerMessage:record.customerMessage||'',expiresInDays:30,productHandles:record.items.map(item=>item.handle)}),staff:true});
    const required=new Map();
    for(const mockup of record.mockups)required.set(mockup.assetId,mockup.mime);
    for(const item of record.items){if(item.proofAssetId)required.set(item.proofAssetId,'image/png');for(const print of item.project?.prints||[])required.set(print.asset.assetId,print.asset.mime);}
    if(required.size>64)fail('TOO_MANY_ASSETS','Use up to 64 artwork images and mockups in one customer order.');
    const savedAssets=existing?.value.assetLinkId===link.id?existing.value.assets||{}:{};
    const ownedPrefix=UPSTREAM+'/api/prepared-orders/public/'+link.id+'/assets/';
    for(const [assetId,mime]of required){const saved=savedAssets[assetId];if(saved?.mime===mime&&saved.url?.startsWith(ownedPrefix)&&HASH.test(saved.url.slice(ownedPrefix.length))){assetUrls.set(assetId,saved);reusedAssets++;}}
    const total=required.size;
    const reportAssets=()=>onProgress({stage:'assets',completed:reusedAssets+uploadedAssets,total,reused:reusedAssets});
    reportAssets();
    // Start revision lookup while images copy; publish only after every task settles.
    const edit=link.status==='active'?remote(env,'/'+link.id+'/edit',{staff:true}).then(value=>({value}),error=>({error})):null;
    await mapConcurrent([...required].filter(([assetId])=>!assetUrls.has(assetId)),2,async([assetId,mime])=>{
      const stored=await service.asset(id,assetId),bytes=await stored.arrayBuffer();
      const digest=await crypto.subtle.digest('SHA-256',bytes),sha=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
      const result=await remote(env,'/'+link.id+'/assets/'+sha,{method:'POST',body:bytes,mime,staff:true});
      if(result.url!==ownedPrefix+sha)fail('UPLOAD_UNVERIFIED','An artwork copy could not be verified.',502);
      assetUrls.set(assetId,{url:result.url,mime});uploadedAssets++;reportAssets();
    });
    const copyAsset=(assetId)=>assetUrls.get(assetId).url;
    const workspaces=[];
    for(const [index,item] of record.items.entries()){
      const sourceMockups=record.mockups.filter(mockup=>mockup.itemIds?.includes(item.id));const images=[];
      for(const mockup of sourceMockups)images.push(await copyAsset(mockup.assetId,mockup.mime));
      if(item.proofAssetId)images.push(await copyAsset(item.proofAssetId,'image/png'));
      items[index].images=images.length?images:item.image?[item.image]:[];
      const prints=[];for(const print of item.project?.prints||[])prints.push({...print,asset:{...print.asset,url:await copyAsset(print.asset.assetId,print.asset.mime)}});
      workspaces.push({id:item.id,handle:item.handle,design:{prints}});
    }
    const referenceImages=[];for(const mockup of record.mockups.filter(value=>!value.itemIds?.length))referenceImages.push(await copyAsset(mockup.assetId,mockup.mime));
    // This immutable private snapshot is retained independently of public-link expiry.
    const fullTemplate=await recipientTemplate(record,items,publishingService,{workspaces});
    const choices=record.items.filter(item=>!item.alternativeForItemId&&record.items.some(option=>option.alternativeForItemId===item.id)).map(root=>({rootId:root.id,options:fullTemplate.workspaces.filter(workspace=>workspace.id===root.id||record.items.find(item=>item.id===workspace.id)?.alternativeForItemId===root.id)}));
    await writeJson(env.R2_BUCKET,ROOT(env)+'published/'+link.id+'/'+snapshotId+'.json',{record,items,referenceImages,choices});
    const template={...primaryPreparedTemplate(fullTemplate,record),purchase:{kind:'order_manager_prepared',snapshotId}};
    const presentation={title:record.title.slice(0,120),preparedFor:record.preparedFor,customerMessage:record.customerMessage||'',expiresInDays:30,productHandles:record.items.map(item=>item.handle),template};
    let result;
    onProgress({stage:'publishing'});
    if(link.status==='uploading')result=await remote(env,'/'+link.id+'/finalize',{method:'POST',body:JSON.stringify(presentation),staff:true});
    else {const ready=await edit;if(ready.error)throw ready.error;result=await remote(env,'/'+link.id+'/revise',{method:'POST',body:JSON.stringify({...presentation,expectedRevision:ready.value.revision}),staff:true});}
    const publicLink={...result,id:link.id,status:'active',sourceRevision:record.revision,url:customerUrl(env,link.id)};
    const saved=await writeJson(env.R2_BUCKET,key,{sourceRevision:record.revision,snapshotId,assetLinkId:link.id,assets:{...savedAssets,...Object.fromEntries(assetUrls)},link:publicLink},{etagMatches:lease.etag});
    if(!saved)fail('PUBLISH_CHANGED','This link changed while publishing. Reopen the order before retrying.',409);
    return {link:publicLink,publication:{unchanged:false,uploadedAssets,reusedAssets,durationMs:Date.now()-started}};
  } catch(error){
    // Keep acknowledged copies on failed updates, but never share assets across link IDs.
    const recovered=existing?.value||{};
    if(link?.id===recovered.link?.id){recovered.assetLinkId=link.id;recovered.assets={...(recovered.assets||{}),...Object.fromEntries(assetUrls)};}
    await writeJson(env.R2_BUCKET,key,recovered,{etagMatches:lease.etag});throw error;
  }
}
export function buildPreparedCheckoutLines(items,selections,orderId,snapshotId) {
  const lines=[],chosen=[];
  if(!selections||typeof selections!=='object'||Array.isArray(selections))fail('QUANTITIES_REQUIRED','Choose your sizes and quantities.');
  for(const key of Object.keys(selections))if(!items.some(item=>item.id===key))fail('ORDER_CHANGED','The order changed. Reload this page before checkout.',409);
  let total=0;
  for(const item of items){const values=selections[item.id]||{};if(typeof values!=='object'||Array.isArray(values))fail('INVALID_QUANTITY','Enter whole-number quantities.');
    for(const [variantId,quantity] of Object.entries(values)){
      if(!Number.isInteger(quantity)||quantity<0||quantity>9999)fail('INVALID_QUANTITY','Use whole-number quantities between 0 and 9999.');if(!quantity)continue;
      const variant=item.variants.find(value=>value.id===variantId);if(!variant)fail('VARIANT_UNAVAILABLE','A selected size is unavailable. Reload the order and choose again.',409);
      total+=quantity;if(total>10000)fail('QUANTITY_LIMIT','Contact Print-MO for orders over 10,000 garments.');
      const batch=orderId+':'+item.id+':'+variantId.split('/').pop();
      const base={group_id:orderId+':'+item.id,batch_id:batch,_preparedOrderId:orderId,_preparedConfigId:snapshotId,_preparedItemId:item.id,method:'DTF',garment_color:item.color,garment_size:variant.size,product_title:item.title};
      const customerKeys=new Set(['Printing','Artwork placement','Printing instructions']);
      const attrs=values=>Object.entries(values).filter(([,value])=>value!==undefined&&value!==null&&String(value)!=='').map(([key,value])=>({key:key.startsWith('_')||customerKeys.has(key)?key:'_'+key,value:String(value).slice(0,1000)}));
      lines.push({variantId,quantity,customAttributes:attrs({...base,group_role:'garment',batch_role:'garment',Printing:item.prints.length?item.prints.map(print=>print.label).join(', '):'No printing',...(item.dimensions?{'Artwork placement':item.dimensions}:{}),...(item.instructions?{'Printing instructions':item.instructions}:{}),...(item.images?.[0]?{design_preview_url:item.images[0]}:{})})});
      for(const print of item.prints)lines.push({variantId:'gid://shopify/ProductVariant/'+print.variantId,quantity,customAttributes:attrs({...base,group_role:'print',batch_role:'print',parent_id:variantId.split('/').pop(),side:print.side,Printing:print.label})});
      chosen.push({itemId:item.id,variantId,quantity});
    }
  }
  if(!total)fail('QUANTITIES_REQUIRED','Choose at least one size and quantity to continue.');
  if(lines.length>200)fail('ORDER_TOO_LARGE','This order has too many size and print combinations. Contact Print-MO to split it.');
  return {lines,chosen,total};
}
export async function transferProductionAssets(env,deps,service,snapshot,checkoutId,draftId,chosen,progress) {
  const detail=await deps.drafts.detail(draftId),roles={front:'front',back:'back',breast:'left-chest',left:'left-sleeve',right:'right-sleeve'},jobs=new Map();
  for(const item of snapshot.record.items){
    if(!chosen.some(value=>value.itemId===item.id))continue;
    const lineIds=detail.items.filter(line=>line.customAttributes?.some(value=>value.key==='_preparedItemId'&&value.value===item.id)&&line.customAttributes?.some(value=>['group_role','_group_role'].includes(value.key)&&value.value==='garment')).map(line=>line.id);
    if(!lineIds.length)fail('PRODUCTION_ASSOCIATION_PENDING','Your checkout is being prepared. Retry in a moment.',503);
    const edited=(snapshot.recipientFiles||[]).filter(file=>file.itemId===item.id);
    const files=[...edited.map(file=>({assetId:'recipient-'+item.id+'-'+file.side,mime:file.mime||'image/svg+xml',svg:file.svg,base64:file.base64,role:file.svg?'design':'mockup',placement:roles[file.side]||'other'})),
      ...(!edited.length?item.project?.prints||[]:[]).map(print=>({assetId:print.asset.assetId,mime:print.asset.mime,role:['image/png','image/svg+xml'].includes(print.asset.mime)?'design':'mockup',placement:roles[print.side]||'other'})),
      ...(item.proofAssetId&&!edited.length?[{assetId:item.proofAssetId,mime:'image/png',role:'mockup',placement:roles[item.proofSide]||'other'}]:[]),
      ...snapshot.record.mockups.filter(mockup=>!mockup.itemIds?.length||mockup.itemIds.includes(item.id)).map(mockup=>({...mockup,role:'mockup',placement:'other'}))];
    for(const file of files){const key=file.assetId+file.role+file.placement;if(!jobs.has(key))jobs.set(key,{...file,lineIds:new Set()});for(const lineId of lineIds)jobs.get(key).lineIds.add(lineId);}
  }
  // One shared original/proof is copied once and assigned to every matching line.
  for(const [key,file] of jobs){
    const uploadId='prep-'+await hash(checkoutId+key);if(progress.completedUploads.includes(uploadId))continue;
    const bytes=file.svg?new TextEncoder().encode(file.svg):file.base64?Uint8Array.from(atob(file.base64),value=>value.charCodeAt(0)):await (await service.asset(snapshot.record.id,file.assetId)).arrayBuffer(),extension={'image/png':'.png','image/svg+xml':'.svg','image/jpeg':'.jpg','image/webp':'.webp'}[file.mime];if(!extension)fail('ARTWORK_FORMAT','An artwork file format needs attention. Contact Print-MO.');
    const form=new FormData();form.set('role',file.role);form.set('placement',file.placement);form.set('lineItemIds',JSON.stringify([...file.lineIds]));form.set('uploadId',uploadId);form.set('file',new File([bytes],'prepared-'+file.assetId.slice(0,32)+extension,{type:file.mime}));
    await deps.drafts.handle(new Request('https://internal/order-manager/v1/drafts/'+encodeURIComponent(draftId)+'/assets',{method:'POST',body:form}),'prepared-checkout');
    progress.completedUploads.push(uploadId);await writeJson(env.R2_BUCKET,ROOT(env)+'checkouts/'+checkoutId+'.json',progress);
  }
}
async function recipientQuote(env,deps,service,document,body) {
  if(body.snapshotId!==document.purchase.snapshotId)fail('ORDER_CHANGED','Print-MO updated this order. Reload it before continuing.',409);
  const selected=selectedPreparedRecord(document.snapshot.record,body.selection);
  const edited=recipientDesigns(selected,body.designs);
  const items=await enrich(env,deps,service,edited.record,document.snapshot.items);
  for(const item of items){const saved=document.snapshot.items.find(value=>value.id===item.id);item.images=saved.images||[];}
  const quoteId=await hash(JSON.stringify({snapshotId:body.snapshotId,designs:edited.designs,items,...(body.selection?{selection:body.selection}:{})}));
  return {...edited,items,quoteId};
}
async function checkout(request,env,deps,service,id,document,isQuote=false) {
  if(Number(request.headers.get('Content-Length'))>24*1024*1024)fail('REQUEST_TOO_LARGE','This order selection is too large.',413);
  const raw=await request.text();if(new TextEncoder().encode(raw).length>24*1024*1024)fail('REQUEST_TOO_LARGE','This order selection is too large.',413);
  let body;try{body=JSON.parse(raw)}catch{fail('INVALID_JSON','Your quantities could not be read. Try again.');}
  if(body.snapshotId!==document.purchase.snapshotId)fail('ORDER_CHANGED','Print-MO updated this order. Reload it to review the changes before checkout.',409);
  const selectedIds=new Set(preparedSelection(document.snapshot.record,body.selection));
  for(const [itemId,values] of Object.entries(body.quantities||{}))if(!selectedIds.has(itemId)&&Object.values(values||{}).some(quantity=>Number(quantity)>0))fail('INVALID_SELECTION','An unselected option cannot be purchased. Review your order.');
  let quote=null;
  if(isQuote){
    const key=await hash(JSON.stringify({shop:env.SHOPIFY_SHOP_DOMAIN,id,snapshotId:body.snapshotId,designs:body.designs,selection:body.selection}));
    let job=quoteFlights.get(key);
    if(!job){job=recipientQuote(env,deps,service,document,body);if(quoteFlights.size<100)quoteFlights.set(key,job);}
    try{quote=await job}finally{if(quoteFlights.get(key)===job)quoteFlights.delete(key);}
  }else if(body.designs||body.selection)quote=await recipientQuote(env,deps,service,document,body);
  if(isQuote)return {quoteId:quote.quoteId,items:quote.items};
  if(!UUID.test(body.sessionId||''))fail('INVALID_SESSION','Reload this order, then try checkout again.');
  if(quote&&body.quoteId!==quote.quoteId)fail('PRICE_CHANGED','The price or design changed. Return to the review and retry checkout.',409);
  const chosen=buildPreparedCheckoutLines(quote?.items||document.snapshot.items.filter(item=>selectedIds.has(item.id)),body.quantities,id,body.snapshotId);
  const files=recipientArtwork(document.snapshot.record,quote?.designs||{},body.artwork,new Set(chosen.chosen.map(value=>value.itemId)),body.previews);
  const checkoutId=await hash(JSON.stringify({id,snapshotId:body.snapshotId,sessionId:body.sessionId,chosen:chosen.chosen,...(quote?{quoteId:quote.quoteId,artworkHash:await hash(JSON.stringify(files))}:{})})),key=ROOT(env)+'checkouts/'+checkoutId+'.json';
  const existing=await readJson(env.R2_BUCKET,key);
  if(existing?.value.state==='ready')return {checkoutUrl:existing.value.url};
  let progress=existing?.value;
  if(!progress?.draftId&&progress?.state==='pending'){
    const recovered=checked(await deps.graphql(env,PREPARED_CHECKOUT_RECOVER,{query:'tag:pm-prepared-'+checkoutId.slice(0,40)},'PreparedCheckoutRecover')).draftOrders.nodes[0];
    if(recovered){if(recovered.status==='COMPLETED')fail('CHECKOUT_COMPLETE','This checkout has already been completed. Contact Print-MO if you need another order.',409);progress={...progress,draftId:recovered.id,url:recovered.invoiceUrl,completedUploads:[],state:'attaching'};}
    else if(Date.now()-Date.parse(progress.startedAt)<120000)fail('CHECKOUT_PENDING','Shopify is preparing your checkout. Retry in a moment.',409);
  }
  if(!progress?.draftId){
    const fresh=quote?.items||await enrich(env,deps,service,selectedPreparedRecord(document.snapshot.record,body.selection));
    for(const item of document.snapshot.items){const current=fresh.find(value=>value.id===item.id);for(const selection of chosen.chosen.filter(value=>value.itemId===item.id)){const old=item.variants.find(value=>value.id===selection.variantId),now=current.variants.find(value=>value.id===selection.variantId);if(!now||now.priceCents!==old.priceCents||(!quote&&JSON.stringify(current.prints)!==JSON.stringify(item.prints)))fail('PRICE_CHANGED','This order’s products or prices have changed. Ask Print-MO to update your link before purchasing.',409);}}
    await requireCheckoutAccess(env,deps);
    const lease=await writeJson(env.R2_BUCKET,key,{state:'pending',startedAt:new Date().toISOString()},existing?{etagMatches:existing.etag}:{etagDoesNotMatch:'*'});if(!lease)fail('CHECKOUT_PENDING','Your checkout is already being prepared. Retry in a moment.',409);
    const result=checked(await deps.graphql(env,PREPARED_CHECKOUT_CREATE,{input:{lineItems:chosen.lines,tags:['pm-prepared-checkout','pm-prepared-'+checkoutId.slice(0,40)],acceptAutomaticDiscounts:true,allowDiscountCodesInCheckout:true,customAttributes:[{key:'_preparedOrderId',value:id},{key:'_preparedConfigId',value:body.snapshotId}]}},'PreparedCheckoutCreate')).draftOrderCreate;
    if(result.userErrors?.length){await writeJson(env.R2_BUCKET,key,{state:'failed'});fail('CHECKOUT_REJECTED',result.userErrors.map(error=>error.message).join(' ').slice(0,500),422);}
    if(!result.draftOrder?.invoiceUrl)fail('CHECKOUT_PENDING','Shopify has not returned the checkout yet. Retry in a moment.',503);
    progress={draftId:result.draftOrder.id,url:result.draftOrder.invoiceUrl,state:'attaching',completedUploads:[]};await writeJson(env.R2_BUCKET,key,progress);
  }
  if(quote){progress.recipientDesigns=quote.designs;await writeJson(env.R2_BUCKET,key,progress);}
  await transferProductionAssets(env,deps,service,{...document.snapshot,recipientFiles:files},checkoutId,progress.draftId,chosen.chosen,progress);
  const url=new URL(progress.url);if(url.protocol!=='https:'||!(url.hostname==='print-mo.com'||url.hostname==='www.print-mo.com'||url.hostname.endsWith('.myshopify.com')||url.hostname.endsWith('.shopify.com')))fail('CHECKOUT_UNAVAILABLE','The checkout address could not be verified. Contact Print-MO.',502);
  progress.state='ready';await writeJson(env.R2_BUCKET,key,progress);return {checkoutUrl:progress.url};
}
export async function handlePublicPreparedLinkRequest(request,env,deps,service) {
  const match=new URL(request.url).pathname.match(/^\/order-manager\/v1\/prepared-orders\/public\/([a-f0-9-]{36})(?:\/(checkout|quote|size-guides))?$/i);
  if(!match)fail('LINK_UNAVAILABLE','This order link is unavailable.',404);
  const document=await publishedOrder(env,match[1]);
  if(request.method==='GET'&&match[2]==='size-guides')return recipientSizeGuides(env,deps,document.snapshot.record);
  if(request.method==='GET'&&!match[2]){
    const template=await recipientTemplate(selectedPreparedRecord(document.snapshot.record),document.snapshot.items,service,document.order.template,{preferPublished:true});
    return {order:{id:document.order.id,url:customerUrl(env,match[1]),reference:document.order.reference,title:document.snapshot.record.title,preparedFor:document.snapshot.record.preparedFor,customerMessage:document.snapshot.record.customerMessage,expiresAt:document.order.expiresAt,snapshotId:document.purchase.snapshotId,items:document.snapshot.items,choices:recipientChoicePresentations(document.snapshot.choices,document.snapshot.record,template),referenceImages:document.snapshot.referenceImages||[],template:{...template,purchase:document.purchase}}};
  }
  if(request.method==='POST'&&['checkout','quote'].includes(match[2])){
    const key=(request.headers.get('CF-Connecting-IP')||'unknown')+':'+match[1]+':'+match[2],minute=Math.floor(Date.now()/60000),previous=attempts.get(key),count=previous?.minute===minute?previous.count+1:1;
    if(attempts.size>5000)attempts.clear();attempts.set(key,{minute,count});if(count>(match[2]==='quote'?60:12))fail('CHECKOUT_RATE_LIMIT','Too many checkout attempts. Wait a minute, then retry.',429);
    return checkout(request,env,deps,service,match[1],document,match[2]==='quote');
  }
  fail('METHOD_NOT_ALLOWED','This action is unavailable.',405);
}
