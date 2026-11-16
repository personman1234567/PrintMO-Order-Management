import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {loadEnvFile} from './cli.mjs';
import {BATCH_SIZE} from './enrollment.mjs';
import {requireValue,SyncError} from './core.mjs';
import {supplierBatchSize,isSupplierDeferred} from './clients.mjs';
import {PRIORITY_SHARED_6400_SKUS} from './priority-shared-6400.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const scopeHash=entries=>createHash('sha256').update(JSON.stringify(entries.map(({id,sku,missingPolicy,cohort})=>[id,sku,missingPolicy,cohort]))).digest('hex');
export function parseLiveEntries(source){
 const block=source.match(/(?:var|const) SCHEDULED_VARIANTS = Object\.freeze\(\[([\s\S]*?)\n\]\.map/);requireValue(block,'LIVE_SCOPE_UNREADABLE');
 try{return JSON.parse('['+block[1]+']').map(([id,sku,missingPolicy,cohort])=>({id,sku,missingPolicy,cohort}));}catch{throw new SyncError('LIVE_SCOPE_UNREADABLE');}
}
export function checkScope(live,local,variants){
 const byId=new Map(local.map(e=>[e.id,e])),bySku=new Map(local.map(e=>[e.sku,e]));
 requireValue(live.every(e=>JSON.stringify(byId.get(e.id))===JSON.stringify(e)),'DEPLOYMENT_DRIFT_FETCH_SOURCE_FIRST');
 for(const v of variants){requireValue(!PRIORITY_SHARED_6400_SKUS.has(v.sku),'HELD_SHARED_6400_SKU');requireValue(!byId.has(v.id)||byId.get(v.id).sku===v.sku,'PINNED_SKU_CHANGED');requireValue(!bySku.has(v.sku)||bySku.get(v.sku).id===v.id,'SHARED_SUPPLIER_SKU');}
 const additions=variants.filter(v=>!byId.has(v.id)).map(v=>({id:v.id,sku:v.sku,missingPolicy:'hold',cohort:v.product.id}));
 return {combined:[...local,...additions],additions,scheduled:[...local,...additions].filter(e=>!PRIORITY_SHARED_6400_SKUS.has(e.sku)).length};
}
export function serviceClient(env,{fetchImpl=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const base=env.INVENTORY_SERVICE_URL||'https://printmo-inventory-sync.printmobusiness.workers.dev';
 requireValue(new URL(base).protocol==='https:'&&env.INVENTORY_ADMIN_KEY?.length>=32,'INVENTORY_SERVICE_CREDENTIALS_MISSING');
 return async(endpoint,input)=>{
  const deadline=Date.now()+90000;
  while(true){
   let r;try{r=await fetchImpl(base+endpoint,{method:input===undefined?'GET':'POST',headers:{Authorization:'Bearer '+env.INVENTORY_ADMIN_KEY,'Content-Type':'application/json'},...(input===undefined?{}:{body:JSON.stringify(input)}),redirect:'manual',signal:AbortSignal.timeout(90000)});}catch{throw new SyncError('ENROLLMENT_REQUEST_UNCERTAIN_REQUERY');}
   requireValue(r.headers.get('content-type')?.includes('application/json'),'INVENTORY_SERVICE_HTTP_'+r.status);
   const d=await r.json();if(r.ok)return d;
   if(d.error==='INVENTORY_BUSY'&&Date.now()<deadline){await sleep(1500);continue;}
   const error=new SyncError(d.error||'INVENTORY_SERVICE_FAILED',r.status);
   const retry=Number(r.headers.get('Retry-After')||d.retryAfterSeconds);
   if(Number.isFinite(retry)&&retry>0)error.retryAfterSeconds=retry;
   throw error;
  }
 };
}
// Prefetch only provider reads. Every apply/verify still resolves live Shopify
// quantities, commitments, policy and protected locations in batches of 25.
export async function enrollProductBatches(product,{execute,invoke,report,save=()=>{}}){
 const health=await invoke('/inventory/health');
 const size=supplierBatchSize({INVENTORY_SUPPLIER_BATCH_SIZE:health.supplierBatchSize||25});
 for(let offset=0;offset<product.variants.length;offset+=size){
  const group=product.variants.slice(offset,offset+size);
  if(size>25)await invoke('/inventory/prefetch',{productId:product.id,entries:group});
  for(let local=0;local<group.length;local+=BATCH_SIZE){
   const index=(offset+local)/BATCH_SIZE,entries=group.slice(local,local+BATCH_SIZE);
   const input={productId:product.id,entries,offset:offset+local,total:product.variants.length};
   report.batches[index]={index};
   if(!execute)report.batches[index].plan=await invoke('/inventory/enroll',{...input,mode:'plan'});
   else{
    try{report.batches[index].result=await invoke('/inventory/enroll',{...input,mode:'apply'});}
    catch(e){
     if(isSupplierDeferred(e))throw e;
     requireValue(/^(ENROLLMENT_REQUEST_UNCERTAIN_REQUERY|ENROLLMENT_READBACK_CHANGED_REQUERY|SHOPIFY_QUANTITY_CHANGED|UPSTREAM_TRANSPORT_FAILED)$/.test(e.code||''),e.code||'ENROLLMENT_FAILED');
     await invoke('/inventory/enroll',{...input,mode:'verify'});
     report.batches[index].result=await invoke('/inventory/enroll',{...input,mode:'apply'});
    }
    requireValue(report.batches[index].result.ready,'ENROLLMENT_NOT_VERIFIED');
   }
   save();
  }
 }
}
export async function main(args=process.argv.slice(2)){
 if(!args.length||args.includes('--help')){console.log('Usage: npm run repo -- inventory enroll|sync PRODUCT [execute]\n       npm run repo -- inventory status|health\n       npm run repo -- inventory costs status|export\n       npm run repo -- inventory costs preview|enable|disable execute [PRODUCT_GID]\nDefault enrollment is a read-only plan. execute automatically disables overselling, tracks supplier inventory, verifies both locations and registers ongoing refresh. Repeating resumes from live state. No per-product deployment. Credentials: INVENTORY_SERVICE_URL and INVENTORY_ADMIN_KEY in root .env.');return 0;}
 const [command,selector,...rest]=args;
 let envFile=path.join(root,'.env'),execute=selector==='execute';
 for(let i=0;i<rest.length;i++){if(['execute','--execute'].includes(rest[i]))execute=true;else if(rest[i]==='--'||command==='costs'&&/^gid:\/\/shopify\/Product\/\d+$/.test(rest[i]))continue;else if(rest[i]==='--env-file'&&rest[i+1])envFile=path.resolve(rest[++i]);else throw new SyncError('INVALID_ARGUMENT');}
 const env=loadEnvFile(envFile,{...process.env}),invoke=serviceClient(env);
 if(['status','health'].includes(command)){console.log(JSON.stringify(await invoke('/inventory/'+command),null,2));return 0;}
 if(command==='costs'){
  if(['status','export'].includes(selector)){
   const result=await invoke('/inventory/costs/'+selector);
   if(selector==='export'){
    const directory=path.join(root,'backups','inventory-costs');fs.mkdirSync(directory,{recursive:true});
    const file=path.join(directory,'costs-'+Date.now()+'.json');fs.writeFileSync(file,JSON.stringify(result,null,2));
    console.log(JSON.stringify({rows:result.rows.length,report:file}));
   }else console.log(JSON.stringify(result,null,2));return 0;
  }
  requireValue(['preview','enable','disable'].includes(selector)&&execute,'COST_CONFIG_REQUIRES_EXECUTE');
  const mode={preview:'preview',enable:'enabled',disable:'disabled'}[selector];
  const productId=rest.find(a=>a.startsWith('gid://shopify/Product/'));
  console.log(JSON.stringify(await invoke('/inventory/costs/config',{mode,productId}),null,2));return 0;
 }
 requireValue(['enroll','sync'].includes(command)&&selector,'INVALID_ARGUMENT');
 const started=Date.now(),product=await invoke('/inventory/product',{selector});
 const report={product:{id:product.id,handle:product.handle,title:product.title},mode:execute?'execute':'plan',startedAt:new Date(started).toISOString(),variantCount:product.variants.length,batches:[],status:'started'};
 const directory=path.join(root,'backups','inventory-enrollment');fs.mkdirSync(directory,{recursive:true});const file=path.join(directory,product.handle+'.json');const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));save();
 try{
  await enrollProductBatches(product,{execute,invoke,report,save});
  const status=await invoke('/inventory/status');const resolved=execute?await invoke('/inventory/product',{selector:product.id}):product;
  if(execute)requireValue(resolved.alreadyRegistered===product.variants.length,'REGISTRY_READBACK_FAILED');
  report.status=execute?'verified':'planned';report.finishedAt=new Date().toISOString();save();
  const rows=report.batches.flatMap(b=>(b.result||b.plan).rows);
  console.log(JSON.stringify({status:report.status,product:product.handle,variants:rows.length,inStock:rows.filter(r=>r.current>0).length,sourceInStock:rows.filter(r=>r.source>0).length,policyChanges:report.batches.reduce((n,b)=>n+(b.result||b.plan).policyChanges,0),alreadyEnrolled:product.alreadyRegistered===product.variants.length,scheduled:status.scheduled,elapsedSeconds:Math.round((Date.now()-started)/1000),report:file}));return 0;
 }catch(e){report.status='blocked';report.error=e.code||'ENROLLMENT_FAILED';if(e.retryAfterSeconds)report.retryAfterSeconds=e.retryAfterSeconds;save();throw e;}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().then(c=>process.exitCode=c).catch(e=>{console.error(JSON.stringify({error:e.code||'ENROLLMENT_FAILED',...(e.retryAfterSeconds?{retryAfterSeconds:e.retryAfterSeconds}:{})}));process.exitCode=e instanceof SyncError?2:1;});
