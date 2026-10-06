import {SyncError,requireValue} from './core.mjs';
import {shopifyToken,shopifyRead} from './clients.mjs';
import {discoverProduct,enrollBatch,SHOP} from './enrollment.mjs';
import {acquireLease,releaseLease,saveJob,registerEntries,registeredCount,registryStatus,database,assertRegistryIdentity} from './registry.mjs';
import {PRIORITY_SHARED_6400_SKUS} from './priority-shared-6400.mjs';

export const SERVICE_VERSION='inventory-registry-v1';
async function authorized(request,env){
 const actual=request.headers.get('Authorization')?.replace(/^Bearer /,'')||'';
 if(!env.INVENTORY_ADMIN_KEY||env.INVENTORY_ADMIN_KEY.length<32||!actual)return false;
 const digest=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
 const [a,b]=await Promise.all([digest(actual),digest(env.INVENTORY_ADMIN_KEY)]);let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;
}
export async function inventoryService(request,env,deps){
 const path=new URL(request.url).pathname;
 if(!path.startsWith('/inventory/')||!await authorized(request,env))return new Response('Not found',{status:404});
 const respond=value=>Response.json(value,{headers:{'Cache-Control':'no-store'}});
 let lease=null,input=null;
 try{
  if(path==='/inventory/health'&&request.method==='GET'){
   const token=await shopifyToken(env,deps);const data=await shopifyRead(env,token,'query InventoryServiceHealth{currentAppInstallation{accessScopes{handle}}}',{},deps);
   const scopes=data.currentAppInstallation.accessScopes.map(s=>s.handle);
   return respond({ok:true,service:SERVICE_VERSION,shop:SHOP,registryEnabled:env.INVENTORY_REGISTRY_ENABLED==='true',policyWriteAvailable:scopes.includes('write_products')||!!(env.SHOPIFY_POLICY_CLIENT_ID&&env.SHOPIFY_POLICY_CLIENT_SECRET),scopes});
  }
  if(path==='/inventory/status'&&request.method==='GET')return respond(await registryStatus(env));
  if(path==='/inventory/export'&&request.method==='GET')return respond({entries:(await database(env).prepare('SELECT * FROM inventory_sync_variants ORDER BY variant_id').all()).results});
  requireValue(request.method==='POST','METHOD_NOT_ALLOWED');input=await request.json();
  if(path==='/inventory/product'){
   const product=await discoverProduct(env,input.selector,deps,{allowOversell:true});
   requireValue(product.variants.every(v=>!PRIORITY_SHARED_6400_SKUS.has(v.sku)),'HELD_SHARED_6400_SKU');
   return respond({id:product.id,handle:product.handle,title:product.title,status:product.status,
    alreadyRegistered:await registeredCount(env,product.variants.map(v=>v.id)),variants:product.variants.map(v=>({id:v.id,sku:v.sku}))});
  }
  requireValue(path==='/inventory/enroll','ENDPOINT_NOT_FOUND');
  lease=await acquireLease(env);requireValue(lease,'INVENTORY_BUSY');
  requireValue(env.INVENTORY_REGISTRY_ENABLED==='true','REGISTRY_NOT_ENABLED');
  requireValue(input.entries?.every(e=>!PRIORITY_SHARED_6400_SKUS.has(e.sku)),'HELD_SHARED_6400_SKU');
  await assertRegistryIdentity(env,input.entries);
  const result=await enrollBatch(env,input,deps);
  if(input.mode==='apply'&&result.ready){
   await registerEntries(env,input.entries,{productId:input.productId,verified:true});
   const complete=Number.isSafeInteger(input.offset)&&Number.isSafeInteger(input.total)&&input.offset+input.entries.length===input.total;
   await saveJob(env,'product:'+input.productId,complete?'verified':'partial',{completed:input.offset+input.entries.length,total:input.total,variants:result.rows.length});
  }
  return respond(result);
 }catch(e){
  const error=e instanceof SyncError?e.code:'INVENTORY_SERVICE_FAILED';
  if(lease&&path==='/inventory/enroll'&&input?.mode==='apply')await saveJob(env,'product:'+input.productId,'failed',null,error);
  return Response.json({error},{status:error==='INVENTORY_BUSY'?409:422,headers:{'Cache-Control':'no-store'}});
 }finally{if(lease)await releaseLease(env,lease);}
}
