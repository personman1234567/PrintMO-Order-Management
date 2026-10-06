// Hosted operations for the product-scoped CLI. Secrets remain in the existing Worker.
import {requireValue, SyncError, makePlan} from './core.mjs';
import {shopDomain, shopifyToken, shopifyRead, requestJson, readSupplierGateway, verifyDraftSkuDuplicates} from './clients.mjs';

export const SHOP = '429cc0-3.myshopify.com';
export const SUPPLIER = 'gid://shopify/Location/95240290552';
export const HQ = 'gid://shopify/Location/72791752952';
export const BATCH_SIZE = 25;
export const FIELDS = `id sku inventoryPolicy availableForSale sellableOnlineQuantity product { id status }
 inventoryItem { id tracked duplicateSkuCount inventoryLevels(first:10, includeInactive:true) {
 nodes { isActive location { id } quantities(names:["available","committed","on_hand"]) { name quantity } }
 pageInfo { hasNextPage } } }`;
export const quantity = (level, name) => level?.quantities?.find(q => q.name === name)?.quantity;
const supplierLevel = v => v.inventoryItem.inventoryLevels.nodes.find(l => l.location.id === SUPPLIER);
const others = v => v.inventoryItem.inventoryLevels.nodes.filter(l => l.location.id !== SUPPLIER);
const fingerprint = v => JSON.stringify(others(v));

export async function discoverProduct(env, selector, deps) {
 requireValue(shopDomain(env) === SHOP && typeof selector === 'string' && /^[A-Za-z0-9_:/.-]{1,150}$/.test(selector), 'INVALID_PRODUCT_SELECTOR');
 const token = await shopifyToken(env, deps);
 let id = /^gid:\/\/shopify\/Product\/\d+$/.test(selector) ? selector : null;
 if (!id) {
  const d = await shopifyRead(env, token, `query ResolveInventoryProduct($query:String!){products(first:20,query:$query){nodes{id handle title status}pageInfo{hasNextPage}}}`, {query:selector}, deps);
  const nodes = d.products.nodes.filter(p => ['ACTIVE','UNLISTED'].includes(p.status));
  const exact = nodes.filter(p => p.handle === selector || p.title.toUpperCase().split(/[^A-Z0-9]+/).includes(selector.toUpperCase()));
  const candidates = exact.length ? exact : nodes;
  requireValue(!d.products.pageInfo.hasNextPage && candidates.length === 1, candidates.length ? 'PRODUCT_AMBIGUOUS_USE_HANDLE' : 'PRODUCT_NOT_FOUND');
  id = candidates[0].id;
 }
 const variants=[]; let cursor=null, product;
 do {
  const d = await shopifyRead(env, token, `query InventoryProduct($id:ID!,$cursor:String){product(id:$id){id handle title status variants(first:250,after:$cursor){nodes{${FIELDS}}pageInfo{hasNextPage endCursor}}}}`, {id,cursor}, deps);
  requireValue(d.product && ['ACTIVE','UNLISTED'].includes(d.product.status), 'PRODUCT_NOT_SELLABLE');
  product=d.product; variants.push(...product.variants.nodes);
  requireValue(variants.length<=2000, 'PRODUCT_SCOPE_TOO_LARGE');
  cursor=product.variants.pageInfo.hasNextPage ? product.variants.pageInfo.endCursor : null;
  requireValue(!product.variants.pageInfo.hasNextPage || cursor, 'PRODUCT_PAGINATION_INCOMPLETE');
 } while(cursor);
 validateVariants(variants, id, await verifyDraftSkuDuplicates(env,token,variants,deps));
 return {id,handle:product.handle,title:product.title,status:product.status,variants};
}

export function validateVariants(variants, productId, verifiedDraftDuplicates = new Set()) {
 requireValue(variants.length>0 && new Set(variants.map(v=>v.id)).size===variants.length, 'INVALID_PRODUCT_VARIANTS');
 requireValue(new Set(variants.map(v=>v.sku)).size===variants.length, 'SHARED_SUPPLIER_SKU');
 for(const v of variants){
  requireValue(v.product?.id===productId && ['ACTIVE','UNLISTED'].includes(v.product.status), 'PRODUCT_IDENTITY_CHANGED');
  requireValue(/^[A-Za-z0-9_-]{1,64}$/.test(v.sku), 'INVALID_SUPPLIER_SKU');
  requireValue(v.inventoryItem?.duplicateSkuCount===0 || verifiedDraftDuplicates.has(v.id), 'SHARED_SUPPLIER_SKU');
  requireValue(v.inventoryPolicy==='DENY', 'OVERSELL_POLICY');
  requireValue(v.inventoryItem.inventoryLevels?.pageInfo.hasNextPage===false, 'SHOPIFY_LEVELS_UNVERIFIED');
  for(const l of v.inventoryItem.inventoryLevels.nodes){
   const a=quantity(l,'available'),c=quantity(l,'committed'),h=quantity(l,'on_hand');
   requireValue([a,c,h].every(Number.isSafeInteger) && c>=0, 'INVENTORY_STATES_UNVERIFIED');
   if(l.location.id===SUPPLIER) requireValue(a>=0 && h===a+c, 'SUPPLIER_INVENTORY_STATES_INVALID');
   else requireValue(!l.isActive || a===0 || (a<0 && h===0), 'OTHER_LOCATION_HAS_STOCK');
  }
 }
}

export function initializeMutation(variants, updates, observedAt, key) {
 const variables={location:SUPPLIER,key,input:{name:'available',reason:'correction',referenceDocumentUri:`printmo://supplier-inventory/enroll/${encodeURIComponent(observedAt)}`,quantities:updates}};
 const declarations=['$input:InventorySetQuantitiesInput!','$key:String!'];
 const operations=variants.map((v,i)=>{
  variables['id'+i]=v.inventoryItem.id;declarations.push(`$id${i}:ID!`);
  return `track${i}:inventoryItemUpdate(id:$id${i},input:{tracked:true}){inventoryItem{id tracked}userErrors{field message}}`;
 });
 delete variables.location;
 return {query:`mutation InitializeSupplierInventory(${declarations.join(',')}){${operations.join('\n')}
 inventorySetQuantities(input:$input) @idempotent(key:$key){inventoryAdjustmentGroup{id}userErrors{code}}}`,variables};
}

async function mutate(env,token,operation,deps){
 const d=await requestJson(`https://${SHOP}/admin/api/2026-07/graphql.json`,{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token},body:JSON.stringify(operation)},deps);
 requireValue(!d.errors?.length && d.data, 'ENROLLMENT_WRITE_UNCONFIRMED');
 const errors=Object.values(d.data).flatMap(p=>p?.userErrors||[]);
 requireValue(!errors.length, errors.some(e=>e.code==='CHANGE_FROM_QUANTITY_STALE') ? 'SHOPIFY_QUANTITY_CHANGED' : 'ENROLLMENT_WRITE_REJECTED');
 return d.data;
}

export async function enrollBatch(env,input,deps){
 requireValue(shopDomain(env)===SHOP && env.SUPPLIER_LOCATION_ID===SUPPLIER
  && JSON.parse(env.PROTECTED_LOCATION_IDS||'[]').includes(HQ), 'INVALID_WRITE_DESTINATION');
 requireValue(['plan','apply','verify'].includes(input.mode) && /^gid:\/\/shopify\/Product\/\d+$/.test(input.productId), 'INVALID_ENROLLMENT_OPERATION');
 const entries=input.entries;
 requireValue(Array.isArray(entries) && entries.length>0 && entries.length<=BATCH_SIZE
  && entries.every(e=>/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(e.id)&&/^[A-Za-z0-9_-]{1,64}$/.test(e.sku)), 'INVALID_ENROLLMENT_BATCH');
 const token=await shopifyToken(env,deps);
 const read=async()=>{
  const d=await shopifyRead(env,token,`query EnrollmentBatch($ids:[ID!]!,$location:ID!){nodes(ids:$ids){... on ProductVariant{${FIELDS}}}location(id:$location){id isActive fulfillsOnlineOrders}currentAppInstallation{accessScopes{handle}}}`,{ids:entries.map(e=>e.id),location:SUPPLIER},deps);
  requireValue(d.nodes.length===entries.length && d.nodes.every((v,i)=>v?.id===entries[i].id&&v.sku===entries[i].sku), 'PRODUCT_IDENTITY_CHANGED');
  validateVariants(d.nodes,input.productId,await verifyDraftSkuDuplicates(env,token,d.nodes,deps));
  requireValue(d.location?.isActive&&d.location.fulfillsOnlineOrders, 'SUPPLIER_LOCATION_NOT_ONLINE');
  requireValue(d.currentAppInstallation.accessScopes.some(s=>s.handle==='write_inventory'), 'INVENTORY_WRITE_SCOPE_MISSING');
  return d;
 };
 const before=await read();
 const supplier=await readSupplierGateway(env,entries.map(e=>e.sku),deps);
 const plan=makePlan({variants:before.nodes,inventory:supplier.items,observedAt:supplier.observedAt,warehouses:['*'],safetyBuffer:Number(env.SS_SAFETY_BUFFER),supplierLocationId:SUPPLIER,supplierLocation:before.location,protectedLocationIds:[HQ]});
 const rows=before.nodes.map((v,i)=>{
  const source=plan.rows[i].capacityBeforeCommitments;
  requireValue(Number.isSafeInteger(source)&&source>=0, 'SUPPLIER_SKU_MISSING_OR_UNKNOWN');
  const l=supplierLevel(v),current=l ? quantity(l,'available') : 0;
  const committed=v.inventoryItem.inventoryLevels.nodes.reduce((n,l)=>n+quantity(l,'committed'),0);
  if(!v.inventoryItem.tracked) requireValue(committed===0 && current===0, 'UNTRACKED_ITEM_HAS_STOCK_OR_COMMITMENTS');
  const target=!v.inventoryItem.tracked ? source : source<current ? source : Math.max(current,Math.max(0,source-committed));
  return {id:v.id,sku:v.sku,source,target,current,tracked:v.inventoryItem.tracked,supplierActive:!!l?.isActive,committed};
 });
 if(input.mode!=='apply') return {mode:input.mode,observedAt:supplier.observedAt,rows,ready:rows.every(r=>r.tracked&&r.supplierActive&&r.current===r.target)};
 const fresh=before.nodes.filter(v=>!v.inventoryItem.tracked);
 const activate=before.nodes.filter(v=>!supplierLevel(v)?.isActive);
 if(activate.length){
  const variables={location:SUPPLIER};const declarations=['$location:ID!'];
  const operations=activate.map((v,i)=>{variables['id'+i]=v.inventoryItem.id;variables['key'+i]=crypto.randomUUID();declarations.push(`$id${i}:ID!`,`$key${i}:String!`);return `a${i}:inventoryActivate(inventoryItemId:$id${i},locationId:$location) @idempotent(key:$key${i}){inventoryLevel{id}userErrors{field message}}`;});
  await mutate(env,token,{query:`mutation ActivateSupplierLevels(${declarations.join(',')}){${operations.join('\n')}}`,variables},deps);
  const activated=await read();
  requireValue(activated.nodes.every((v,i)=>supplierLevel(v)?.isActive && quantity(supplierLevel(v),'available')===rows[i].current && fingerprint(v)===fingerprint(before.nodes[i])), 'ACTIVATION_READBACK_FAILED');
 }
 const updates=before.nodes.flatMap((v,i)=>!v.inventoryItem.tracked||rows[i].target!==rows[i].current ? [{inventoryItemId:v.inventoryItem.id,locationId:SUPPLIER,quantity:rows[i].target,changeFromQuantity:rows[i].current}] : []);
 if(updates.length){
  try { await mutate(env,token,initializeMutation(fresh,updates,supplier.observedAt,crypto.randomUUID()),deps); }
  catch(error){
   // A mutation is serial, not transactional. Requery; restore only new zero-stock
   // tracking where a positive seed failed and no customer commitment appeared.
   const current=await read();
   for(const v of current.nodes){const index=before.nodes.findIndex(b=>b.id===v.id);
    if(!before.nodes[index].inventoryItem.tracked && v.inventoryItem.tracked && rows[index].target>0
     && quantity(supplierLevel(v),'available')===0 && v.inventoryItem.inventoryLevels.nodes.every(l=>quantity(l,'committed')===0))
     await mutate(env,token,{query:'mutation RestoreTracking($id:ID!){inventoryItemUpdate(id:$id,input:{tracked:false}){inventoryItem{id tracked}userErrors{field message}}}',variables:{id:v.inventoryItem.id}},deps);
   }
   throw error;
  }
 }
 const after=await read();
 requireValue(after.nodes.every((v,i)=>v.inventoryItem.tracked&&supplierLevel(v)?.isActive&&quantity(supplierLevel(v),'available')===rows[i].target&&fingerprint(v)===fingerprint(before.nodes[i])), 'ENROLLMENT_READBACK_CHANGED_REQUERY');
 return {mode:'apply',observedAt:supplier.observedAt,rows:rows.map(r=>({...r,current:r.target,tracked:true,supplierActive:true})),ready:true,writes:updates.length};
}

export function enrollmentHandler({productId,keyHash,expiresAt}){
 return async(request,env)=>{
  const key=request.headers.get('Authorization')?.replace(/^Bearer /,'')||'';
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)))).map(b=>b.toString(16).padStart(2,'0')).join('');
  if(!Number.isSafeInteger(expiresAt)||Date.now()>expiresAt||request.method!=='POST'||new URL(request.url).pathname!=='/inventory/enroll'||digest!==keyHash) return new Response('Not found',{status:404});
  try{
   const input=await request.json();
   requireValue(input.productId===productId,'PRODUCT_OUTSIDE_ENROLLMENT_SCOPE');
   return Response.json(await enrollBatch(env,input),{headers:{'Cache-Control':'no-store'}});
  }catch(e){return Response.json({error:e instanceof SyncError?e.code:'ENROLLMENT_FAILED'},{status:409,headers:{'Cache-Control':'no-store'}});}
 };
}
