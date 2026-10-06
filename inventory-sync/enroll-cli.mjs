import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {loadEnvFile} from './cli.mjs';
import {discoverProduct,BATCH_SIZE} from './enrollment.mjs';
import {SCHEDULED_VARIANTS} from './scheduled-variants.mjs';
import {PRIORITY_SHARED_6400_SKUS} from './priority-shared-6400.mjs';
import {requireValue,SyncError} from './core.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const inventory=path.join(root,'inventory-sync');
const hash=value=>createHash('sha256').update(value).digest('hex');
export const scopeHash=entries=>hash(JSON.stringify(entries.map(({id,sku,missingPolicy,cohort})=>[id,sku,missingPolicy,cohort])));
export function parseLiveEntries(source){
 const block=source.match(/(?:var|const) SCHEDULED_VARIANTS = Object\.freeze\(\[([\s\S]*?)\n\]\.map/);
 requireValue(block,'LIVE_SCOPE_UNREADABLE');
 try{return JSON.parse('['+block[1]+']').map(([id,sku,missingPolicy,cohort])=>({id,sku,missingPolicy,cohort}));}
 catch{throw new SyncError('LIVE_SCOPE_UNREADABLE');}
}
export function checkScope(live,local,variants){
 const byId=new Map(local.map(e=>[e.id,e]));
 requireValue(live.every(e=>JSON.stringify(byId.get(e.id))===JSON.stringify(e)), 'DEPLOYMENT_DRIFT_FETCH_SOURCE_FIRST');
 const bySku=new Map(local.map(e=>[e.sku,e]));
 for(const v of variants){
  requireValue(!PRIORITY_SHARED_6400_SKUS.has(v.sku),'HELD_SHARED_6400_SKU');
  requireValue(!byId.has(v.id)||byId.get(v.id).sku===v.sku,'PINNED_SKU_CHANGED');
  requireValue(!bySku.has(v.sku)||bySku.get(v.sku).id===v.id,'SHARED_SUPPLIER_SKU');
 }
 const additions=variants.filter(v=>!byId.has(v.id)).map(v=>({id:v.id,sku:v.sku,missingPolicy:'hold',cohort:v.product.id}));
 const combined=[...local,...additions];
 const scheduled=combined.filter(e=>!PRIORITY_SHARED_6400_SKUS.has(e.sku)).length;
 requireValue(Math.ceil(Math.ceil(scheduled/5)/BATCH_SIZE)<=16, 'SCHEDULE_CAPACITY_EXCEEDED');
 return {combined,additions,scheduled,maxRequests:1+3*Math.ceil(Math.ceil(scheduled/5)/BATCH_SIZE)};
}

function wrangler(args){
 const npmCli=process.env.npm_execpath;
 requireValue(npmCli&&fs.existsSync(npmCli),'RUN_THROUGH_NPM_REPO_COMMAND');
 const r=spawnSync(process.execPath,[npmCli,'exec','--','wrangler',...args],{cwd:inventory,encoding:'utf8',env:{...process.env,WRANGLER_SEND_METRICS:'false'},maxBuffer:8*1024*1024});
 requireValue(r.status===0,'WRANGLER_OPERATION_FAILED');
 return r.stdout;
}
function authToken(){
 if(process.env.CLOUDFLARE_API_TOKEN)return process.env.CLOUDFLARE_API_TOKEN;
 const directories=[process.env.APPDATA&&path.join(process.env.APPDATA,'xdg.config'),process.env.XDG_CONFIG_HOME,path.join(os.homedir(),'.config'),os.homedir()].filter(Boolean);
 for(const dir of directories){const file=path.join(dir,'.wrangler','config','default.toml');if(fs.existsSync(file)){const token=fs.readFileSync(file,'utf8').match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];if(token)return token;}}
 throw new SyncError('CLOUDFLARE_AUTH_MISSING_RUN_WRANGLER_LOGIN');
}
function pinnedSource(entries){return '// Exact Shopify identities enrolled by the product-scoped inventory command.\nexport const SCHEDULED_VARIANTS = Object.freeze([\n'+entries.map(e=>'  '+JSON.stringify([e.id,e.sku,e.missingPolicy,e.cohort])).join(',\n')+'\n].map(([id, sku, missingPolicy, cohort]) => Object.freeze({ id, sku, missingPolicy, cohort })));\n';}

export async function main(args=process.argv.slice(2)){
 if(!args.length||args.includes('--help')){
  console.log('Usage: npm run repo -- inventory enroll|sync PRODUCT_HANDLE_OR_STYLE [execute] [--env-file PATH]\nDefault: product-scoped plan; no Shopify quantity writes or production deployment. execute (or --execute) enrolls/refreshes with live supplier data and preserves the existing schedule. Already enrolled variants are reconciled, never blindly reseeded. Credentials stay in the hosted app. Reports/checkpoints: backups/inventory-enrollment/. Exit 0 verified, 2 blocked, 1 operational failure.');return 0;
 }
 const [command,selector,...flags]=args;
 requireValue(['enroll','sync'].includes(command)&&selector,'INVALID_ARGUMENT');
 let execute=false,envFile=path.join(root,'.env');
 for(let i=0;i<flags.length;i++){if(['--execute','execute'].includes(flags[i]))execute=true;else if(flags[i]==='--')continue;else if(flags[i]==='--env-file'&&flags[i+1])envFile=path.resolve(flags[++i]);else throw new SyncError('INVALID_ARGUMENT');}
 const env=loadEnvFile(envFile,{SHOPIFY_SHOP_DOMAIN:'429cc0-3.myshopify.com'});
 const product=await discoverProduct(env,selector);
 const scope=checkScope([],SCHEDULED_VARIANTS,product.variants);
 const reportDir=path.join(root,'backups','inventory-enrollment');fs.mkdirSync(reportDir,{recursive:true});
 const reportPath=path.join(reportDir,product.handle+'.json');
 const report={product:{id:product.id,handle:product.handle,title:product.title},mode:execute?'execute':'plan',startedAt:new Date().toISOString(),variantCount:product.variants.length,additions:scope.additions.length,scheduled:scope.scheduled,maxRequests:scope.maxRequests,batches:[],status:'started'};
 const save=()=>fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
 const lock=path.join(reportDir,'.lock');let lockHandle;
 if(fs.existsSync(lock)){
  let prior;try{prior=JSON.parse(fs.readFileSync(lock,'utf8'));}catch{throw new SyncError('ENROLLMENT_LOCK_INVALID_REVIEW');}
  requireValue(Number.isSafeInteger(prior.pid)&&prior.pid>0,'ENROLLMENT_LOCK_INVALID_REVIEW');
  try{process.kill(prior.pid,0);throw new SyncError('ENROLLMENT_ALREADY_RUNNING');}
  catch(error){if(error.code!=='ESRCH')throw error;fs.unlinkSync(lock);}
 }
 try{lockHandle=fs.openSync(lock,'wx');fs.writeFileSync(lockHandle,JSON.stringify({pid:process.pid,startedAt:report.startedAt}));}catch{throw new SyncError('ENROLLMENT_ALREADY_RUNNING');}
 save();
 const temp=fs.mkdtempSync(path.join(inventory,'.enrollment-'));
 const config=JSON.parse(fs.readFileSync(path.join(inventory,'wrangler.jsonc'),'utf8'));
 let previousPreview,previewChanged=false,base,cf,summary;
 try{
  const identity=JSON.parse(wrangler(['whoami','--json']));
  const account=process.env.CLOUDFLARE_ACCOUNT_ID||config.account_id||(identity.accounts.length===1&&identity.accounts[0].id);
  requireValue(account,'CLOUDFLARE_ACCOUNT_AMBIGUOUS');
  const token=authToken();
  cf=async(endpoint,options={})=>{
   const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/${endpoint}`,{...options,headers:{Authorization:'Bearer '+token,...options.headers},signal:AbortSignal.timeout(30000)});
   requireValue(response.ok,'CLOUDFLARE_HTTP_'+response.status);return response;
  };
  base='scripts/'+config.name;
  const activeVersion=async()=>{
   const result=(await (await cf(base+'/deployments')).json()).result;
   const latest=[...(result.deployments||result)].sort((a,b)=>Date.parse(b.created_on)-Date.parse(a.created_on))[0];
   requireValue(latest?.versions?.length===1&&latest.versions[0].percentage===100,'MULTI_VERSION_DEPLOYMENT_REVIEW_REQUIRED');
   return latest.versions[0].version_id;
  };
  const content=async()=>{const r=await cf(base+'/content/v2');if(r.headers.get('content-type')?.includes('multipart')){const f=await r.formData();return [...f.values()].filter(v=>typeof v!=='string')[0].text();}return r.text();};
  const receiptPath=path.join(inventory,'deployment.json');
  const receipt=JSON.parse(fs.readFileSync(receiptPath,'utf8'));
  const originalVersion=await activeVersion();
  requireValue(receipt.version===originalVersion && receipt.scopeHash===scopeHash(SCHEDULED_VARIANTS),'DEPLOYMENT_DRIFT_FETCH_SOURCE_FIRST');
  if(execute&&scope.additions.length){
   const dirty=spawnSync('git',['status','--porcelain','--','inventory-sync'],{cwd:root,encoding:'utf8'});
   requireValue(dirty.status===0&&!dirty.stdout.trim(),'COMMIT_INVENTORY_IMPLEMENTATION_BEFORE_ENROLLMENT');
  }
  previousPreview=(await (await cf(base+'/subdomain')).json()).result;
  requireValue(!previousPreview.enabled&&!previousPreview.previews_enabled,'PUBLIC_PREVIEWS_ALREADY_ENABLED_REVIEW_ACCESS');
  const subdomain=(await (await cf('subdomain')).json()).result.subdomain;
  const key=randomBytes(32).toString('hex');
  const entry=`import worker from '../worker.mjs';import {enrollmentHandler} from '../enrollment.mjs';export default {...worker,fetch:enrollmentHandler(${JSON.stringify({productId:product.id,keyHash:hash(key),expiresAt:Date.now()+15*60000})})};`;
  fs.writeFileSync(path.join(temp,'entry.mjs'),entry);
  const uploadConfig={...config,main:'entry.mjs',preview_urls:true,workers_dev:false,triggers:{crons:[]}};
  const configPath=path.join(temp,'wrangler.json');fs.writeFileSync(configPath,JSON.stringify(uploadConfig));
  await cf(base+'/subdomain',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:false,previews_enabled:true})});previewChanged=true;
  const uploaded=wrangler(['versions','upload','-c',configPath,'--message','Product-scoped inventory enrollment']);
  const version=uploaded.match(/Version ID:\s*([a-f0-9-]{36})/i)?.[1];requireValue(version,'ENROLLMENT_PREVIEW_VERSION_MISSING');
  await cf(base+'/subdomain',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:false,previews_enabled:true})});
  const preview=uploaded.match(/https:\/\/[a-f0-9]{8}-[^\s]+\.workers\.dev/)?.[0];
  const url=(preview||`https://${version.slice(0,8)}-${config.name}.${subdomain}.workers.dev`)+'/inventory/enroll';
  report.previewVersion=version;report.previewUrl=url;save();
  // Cloudflare's route enablement can propagate after the upload has completed.
  // Only wait on the provider's HTML 404; the authenticated handler's 404 is final.
  for(let attempt=0;attempt<6;attempt++){
   const r=await fetch(url,{method:'POST',body:'{}',signal:AbortSignal.timeout(15000)});
   if(r.status===404&&r.headers.get('content-type')?.startsWith('text/plain'))break;
   requireValue(attempt<5,'ENROLLMENT_PREVIEW_NOT_READY');
   await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));
  }
  const invoke=async(input)=>{
   for(let attempt=0;attempt<2;attempt++){
    let r,d;
    try{r=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(60000)});}
    catch(e){if(attempt===0&&input.mode!=='apply')continue;throw new SyncError(e.cause?.code==='ENOTFOUND'?'ENROLLMENT_PREVIEW_DNS_FAILED':'ENROLLMENT_REQUEST_UNCERTAIN_REQUERY');}
    if(!r.headers.get('content-type')?.includes('application/json'))throw new SyncError('ENROLLMENT_PREVIEW_HTTP_'+r.status);
    d=await r.json();
    if(r.ok)return d;
    if(attempt===0&&input.mode!=='apply'&&/^(UPSTREAM_HTTP_5|UPSTREAM_TRANSPORT_FAILED)/.test(d.error))continue;
    throw new SyncError(d.error||'ENROLLMENT_FAILED');
   }
  };
  const batches=Array.from({length:Math.ceil(product.variants.length/BATCH_SIZE)},(_,i)=>product.variants.slice(i*BATCH_SIZE,(i+1)*BATCH_SIZE).map(v=>({id:v.id,sku:v.sku})));
  // Check every batch before changing any variant. This replaces agent-side audits.
  for(const [i,entries] of batches.entries()){
   const result=await invoke({mode:'plan',productId:product.id,entries});report.batches[i]={index:i,plan:result};save();
  }
  if(execute){
   for(const [i,entries] of batches.entries()){
    let result;
    if(report.batches[i].plan.ready){report.batches[i].result={...report.batches[i].plan,writes:0};save();continue;}
    try{result=await invoke({mode:'apply',productId:product.id,entries});}
    catch(error){
     requireValue(/^(ENROLLMENT_REQUEST_UNCERTAIN_REQUERY|ENROLLMENT_PREVIEW_HTTP_5|UPSTREAM_HTTP_5|UPSTREAM_TRANSPORT_FAILED|SHOPIFY_QUANTITY_CHANGED)/.test(error.code||''),error.code||'ENROLLMENT_FAILED');
     const current=await invoke({mode:'verify',productId:product.id,entries});
     result=current.ready ? {...current,recoveredAfterRequery:true} : await invoke({mode:'apply',productId:product.id,entries});
    }
    report.batches[i].result=result;save();
   }
   requireValue(await activeVersion()===originalVersion,'PRODUCTION_CHANGED_REPLAN_BEFORE_DEPLOY');
   if(scope.additions.length){
    fs.writeFileSync(path.join(inventory,'scheduled-variants.mjs'),pinnedSource(scope.combined));
    const deployed=wrangler(['deploy','-c',path.join(inventory,'wrangler.jsonc')]);
    report.deployment=deployed.match(/Current Version ID:\s*([a-f0-9-]{36})/i)?.[1];requireValue(report.deployment,'PRODUCTION_DEPLOYMENT_UNCONFIRMED');
    const live=parseLiveEntries(await content());requireValue(scope.combined.every(e=>live.some(l=>JSON.stringify(l)===JSON.stringify(e)))&&await activeVersion()===report.deployment,'DEPLOYED_SCOPE_READBACK_FAILED');
    fs.writeFileSync(receiptPath,JSON.stringify({version:report.deployment,scopeHash:scopeHash(scope.combined)},null,2)+'\n');
   }else report.deployment=originalVersion;
  }
  report.status=execute?'verified':'planned';report.finishedAt=new Date().toISOString();save();
  const rows=report.batches.flatMap(b=>(b.result||b.plan).rows);
  summary={status:report.status,product:product.handle,variants:rows.length,inStock:rows.filter(r=>r.current>0).length,sourceInStock:rows.filter(r=>r.source>0).length,alreadyEnrolled:scope.additions.length===0,scheduled:scope.scheduled,elapsedSeconds:Math.round((Date.now()-Date.parse(report.startedAt))/1000),report:reportPath};
 }catch(error){report.status='blocked';report.error=error.code||'ENROLLMENT_OPERATION_FAILED';save();throw error;}
 finally{
  try{if(previewChanged)await cf(base+'/subdomain',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:false,previews_enabled:false})});}
  catch{report.status='cleanup-blocked';report.error='ENROLLMENT_PREVIEW_CLEANUP_REQUIRED';save();throw new SyncError(report.error);}
  finally{requireValue(path.dirname(path.resolve(temp))===inventory&&path.basename(temp).startsWith('.enrollment-'),'TEMP_CLEANUP_SCOPE_INVALID');fs.rmSync(temp,{recursive:true,force:true});fs.closeSync(lockHandle);fs.unlinkSync(lock);}
 }
 console.log(JSON.stringify(summary));return 0;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().then(code=>process.exitCode=code).catch(e=>{console.error(JSON.stringify({error:e.code||'ENROLLMENT_OPERATION_FAILED'}));process.exitCode=e instanceof SyncError?2:1;});
