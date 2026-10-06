import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {loadEnvFile} from './cli.mjs';
import {BATCH_SIZE} from './enrollment.mjs';
import {requireValue,SyncError} from './core.mjs';
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
   throw new SyncError(d.error||'INVENTORY_SERVICE_FAILED');
  }
 };
}
export async function main(args=process.argv.slice(2)){
 if(!args.length||args.includes('--help')){console.log('Usage: npm run repo -- inventory enroll|sync PRODUCT [execute]\n       npm run repo -- inventory status|health\nDefault enrollment is a read-only plan. execute automatically disables overselling, tracks supplier inventory, verifies both locations and registers ongoing refresh. Repeating resumes from live state. No per-product deployment. Credentials: INVENTORY_SERVICE_URL and INVENTORY_ADMIN_KEY in root .env.');return 0;}
 const [command,selector,...rest]=args;
 let envFile=path.join(root,'.env'),execute=selector==='execute';
 for(let i=0;i<rest.length;i++){if(['execute','--execute'].includes(rest[i]))execute=true;else if(rest[i]==='--')continue;else if(rest[i]==='--env-file'&&rest[i+1])envFile=path.resolve(rest[++i]);else throw new SyncError('INVALID_ARGUMENT');}
 const env=loadEnvFile(envFile,{...process.env}),invoke=serviceClient(env);
 if(['status','health'].includes(command)){console.log(JSON.stringify(await invoke('/inventory/'+command),null,2));return 0;}
 requireValue(['enroll','sync'].includes(command)&&selector,'INVALID_ARGUMENT');
 const started=Date.now(),product=await invoke('/inventory/product',{selector});
 const batches=Array.from({length:Math.ceil(product.variants.length/BATCH_SIZE)},(_,i)=>product.variants.slice(i*BATCH_SIZE,(i+1)*BATCH_SIZE));
 const report={product:{id:product.id,handle:product.handle,title:product.title},mode:execute?'execute':'plan',startedAt:new Date(started).toISOString(),variantCount:product.variants.length,batches:[],status:'started'};
 const directory=path.join(root,'backups','inventory-enrollment');fs.mkdirSync(directory,{recursive:true});const file=path.join(directory,product.handle+'.json');const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));save();
 try{
  if(!execute)for(const [i,entries] of batches.entries()){
   const input={productId:product.id,entries,offset:i*BATCH_SIZE,total:product.variants.length};
   const plan=await invoke('/inventory/enroll',{...input,mode:'plan'});report.batches[i]={index:i,plan};save();
  }
  if(execute)for(const [i,entries] of batches.entries()){
   const input={productId:product.id,entries,offset:i*BATCH_SIZE,total:product.variants.length};
   try{(report.batches[i]??={index:i}).result=await invoke('/inventory/enroll',{...input,mode:'apply'});}
   catch(e){
    requireValue(/^(ENROLLMENT_REQUEST_UNCERTAIN_REQUERY|ENROLLMENT_READBACK_CHANGED_REQUERY|SHOPIFY_QUANTITY_CHANGED|UPSTREAM_HTTP_5|UPSTREAM_TRANSPORT_FAILED)/.test(e.code||''),e.code||'ENROLLMENT_FAILED');
    await invoke('/inventory/enroll',{...input,mode:'verify'});
    report.batches[i].result=await invoke('/inventory/enroll',{...input,mode:'apply'});
   }
   requireValue(report.batches[i].result.ready,'ENROLLMENT_NOT_VERIFIED');save();
  }
  const status=await invoke('/inventory/status');const resolved=execute?await invoke('/inventory/product',{selector:product.id}):product;
  if(execute)requireValue(resolved.alreadyRegistered===product.variants.length,'REGISTRY_READBACK_FAILED');
  report.status=execute?'verified':'planned';report.finishedAt=new Date().toISOString();save();
  const rows=report.batches.flatMap(b=>(b.result||b.plan).rows);
  console.log(JSON.stringify({status:report.status,product:product.handle,variants:rows.length,inStock:rows.filter(r=>r.current>0).length,sourceInStock:rows.filter(r=>r.source>0).length,policyChanges:report.batches.reduce((n,b)=>n+(b.result||b.plan).policyChanges,0),alreadyEnrolled:product.alreadyRegistered===product.variants.length,scheduled:status.scheduled,elapsedSeconds:Math.round((Date.now()-started)/1000),report:file}));return 0;
 }catch(e){report.status='blocked';report.error=e.code||'ENROLLMENT_FAILED';save();throw e;}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().then(c=>process.exitCode=c).catch(e=>{console.error(JSON.stringify({error:e.code||'ENROLLMENT_FAILED'}));process.exitCode=e instanceof SyncError?2:1;});
