// Code releases only. Ordinary enrollment never invokes Wrangler or deployment.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {loadEnvFile} from './cli.mjs';
import {requireValue,SyncError} from './core.mjs';
import {SCHEDULED_VARIANTS} from './scheduled-variants.mjs';
import {PRIORITY_SHARED_6400_SKUS} from './priority-shared-6400.mjs';
import {parseLiveEntries,checkScope,scopeHash,serviceClient} from './enroll-cli.mjs';
const directory=path.dirname(fileURLToPath(import.meta.url)),root=path.dirname(directory);
const account='74199fe95754f474f49f509e327cef0f',worker='printmo-inventory-sync';
function wrangler(args,input){
 requireValue(process.env.npm_execpath,'RUN_RELEASE_THROUGH_REPO_COMMAND');
 const r=spawnSync(process.execPath,[process.env.npm_execpath,'exec','--','wrangler',...args],{cwd:directory,encoding:'utf8',input,maxBuffer:8*1024*1024,env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
 // Never print secret bulk input or provider error bodies.
 if(r.error||r.status!==0){const dir=path.join(root,'backups','inventory-release');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'wrangler-error.txt'),String(r.stderr||r.stdout||r.error));throw new SyncError('WRANGLER_RELEASE_FAILED');}return r.stdout;
}
function cloudflareToken(){
 if(process.env.CLOUDFLARE_API_TOKEN)return process.env.CLOUDFLARE_API_TOKEN;
 for(const base of [process.env.APPDATA&&path.join(process.env.APPDATA,'xdg.config'),process.env.XDG_CONFIG_HOME,path.join(os.homedir(),'.config'),os.homedir()].filter(Boolean)){
  const file=path.join(base,'.wrangler','config','default.toml');if(!fs.existsSync(file))continue;
  const token=fs.readFileSync(file,'utf8').match(/oauth_token\s*=\s*"([^"]+)"/);if(token)return token[1];
 }
 throw new SyncError('CLOUDFLARE_AUTH_REQUIRED');
}
export async function main(args=process.argv.slice(2)){
 if(!args.includes('execute')){console.log('Usage: npm run repo -- inventory release execute [POLICY_ENV_FILE]\nCode release/migration only: preserves live enrollments, provisions the permanent endpoint key, deploys, and verifies registry coverage. Routine enrollment needs no deployment.');return 0;}
 const token=cloudflareToken(),base=`https://api.cloudflare.com/client/v4/accounts/${account}`;
 const cf=async(suffix,options={})=>{const r=await fetch(base+suffix,{...options,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}});const d=await r.json();requireValue(r.ok&&d.success,'CLOUDFLARE_READ_FAILED');return d.result;};
 const deployment=async()=>{const d=await cf(`/workers/scripts/${worker}/deployments`);const latest=d.deployments[0];requireValue(latest?.versions.length===1&&latest.versions[0].percentage===100,'SPLIT_DEPLOYMENT_UNSUPPORTED');return latest.versions[0].version_id;};
 const receiptFile=path.join(directory,'deployment.json'),receipt=JSON.parse(fs.readFileSync(receiptFile,'utf8'));
 requireValue(await deployment()===receipt.version,'DEPLOYMENT_DRIFT_FETCH_SOURCE_FIRST');
 const settings=await cf(`/workers/scripts/${worker}/settings`);requireValue(['standard','unbound'].includes(settings.usage_model),'WORKERS_PAID_PLAN_REQUIRED');
 if(!receipt.registryEnabled){
  const r=await fetch(base+`/workers/scripts/${worker}/content/v2`,{headers:{Authorization:'Bearer '+token}});requireValue(r.ok,'LIVE_SOURCE_READ_FAILED');
  const form=await r.formData();let source='';for(const value of form.values())if(typeof value!=='string')source+=await value.text();
  checkScope(parseLiveEntries(source),SCHEDULED_VARIANTS,[]);
 }
 const envFile=path.join(root,'.env'),env=loadEnvFile(envFile,{...process.env});
 if(!env.INVENTORY_ADMIN_KEY){env.INVENTORY_ADMIN_KEY=randomBytes(32).toString('hex');fs.appendFileSync(envFile,'\nINVENTORY_ADMIN_KEY='+env.INVENTORY_ADMIN_KEY+'\n');}
 requireValue(env.INVENTORY_ADMIN_KEY.length>=32,'INVALID_ADMIN_KEY');
 const secrets={INVENTORY_ADMIN_KEY:env.INVENTORY_ADMIN_KEY};
 const policyArg=args.indexOf('--policy-env-file'),policyFile=policyArg>=0?args[policyArg+1]:args.find(a=>a!=='execute');
 if(policyFile){const p=loadEnvFile(path.resolve(policyFile),{});
  requireValue(p.SHOPIFY_STOREFRONT_MANAGER_CLIENT_ID&&p.SHOPIFY_STOREFRONT_MANAGER_CLIENT_SECRET,'POLICY_CREDENTIALS_MISSING');
  secrets.SHOPIFY_POLICY_CLIENT_ID=p.SHOPIFY_STOREFRONT_MANAGER_CLIENT_ID;secrets.SHOPIFY_POLICY_CLIENT_SECRET=p.SHOPIFY_STOREFRONT_MANAGER_CLIENT_SECRET;
 }
 const before=receipt.registryEnabled?await serviceClient(env)('/inventory/export'):null;
 const backup=path.join(root,'backups','inventory-release');fs.mkdirSync(backup,{recursive:true});
 if(before)fs.writeFileSync(path.join(backup,'registry-before.json'),JSON.stringify(before));
 if(!receipt.registryEnabled){
  const quoted=s=>"'"+String(s).replaceAll("'","''")+"'",now=Date.now();
  const values=SCHEDULED_VARIANTS.map(e=>`(${[e.id,e.sku,e.cohort||'',e.missingPolicy].map(quoted).join(',')},${PRIORITY_SHARED_6400_SKUS.has(e.sku)?0:1},${now})`);
  const sql=fs.readFileSync(path.join(directory,'migrations','0001_inventory_registry.sql'),'utf8')+'\nINSERT INTO inventory_sync_variants(variant_id,sku,product_id,missing_policy,enabled,registered_at) VALUES\n'+values.join(',\n')+'\nON CONFLICT(variant_id) DO NOTHING;\n';
  const file=path.join(backup,'registry-migration.sql');fs.writeFileSync(file,sql);
  const query=async sql=>{const result=await cf('/d1/database/7fce58d5-d3f3-4f42-b084-6f3715cc48cc/query',{method:'POST',body:JSON.stringify({sql})});requireValue(result.every(r=>r.success),'REGISTRY_MIGRATION_FAILED');};
  await query(fs.readFileSync(path.join(directory,'migrations','0001_inventory_registry.sql'),'utf8'));
  for(let i=0;i<values.length;i+=100)await query('INSERT INTO inventory_sync_variants(variant_id,sku,product_id,missing_policy,enabled,registered_at) VALUES '+values.slice(i,i+100).join(',')+' ON CONFLICT(variant_id) DO NOTHING;');
 }
 // Deploy reviewed code first: older uploaded preview versions can otherwise block secret updates.
 wrangler(['deploy','-c','wrangler.jsonc']);
 wrangler(['secret','bulk','-c','wrangler.jsonc'],JSON.stringify(secrets));
 const version=await deployment(),invoke=serviceClient(env);let health;
 // A normal code release can take a few seconds to reach the stable hostname.
 for(let i=0;i<6;i++){try{health=await invoke('/inventory/health');break;}catch(e){if(i===5)throw e;await new Promise(r=>setTimeout(r,2000));}}
 requireValue(health.service==='inventory-registry-v1'&&health.registryEnabled&&health.scopes.includes('write_inventory')&&health.policyWriteAvailable,'RELEASE_HEALTH_FAILED');
 const exported=await invoke('/inventory/export'),byId=new Map(exported.entries.map(e=>[e.variant_id,e]));
 for(const e of before?.entries||SCHEDULED_VARIANTS){const row=byId.get(e.variant_id||e.id);requireValue(row&&row.sku===e.sku&&row.missing_policy===(e.missing_policy||e.missingPolicy)&&row.enabled===(e.enabled??(PRIORITY_SHARED_6400_SKUS.has(e.sku)?0:1)),'REGISTRY_MIGRATION_READBACK_FAILED');}
 requireValue((await fetch((env.INVENTORY_SERVICE_URL||'https://printmo-inventory-sync.printmobusiness.workers.dev')+'/inventory/health')).status===404,'UNAUTHENTICATED_ENDPOINT_EXPOSED');
 fs.writeFileSync(receiptFile,JSON.stringify({version,registryEnabled:true,bootstrapScopeHash:receipt.bootstrapScopeHash||scopeHash(SCHEDULED_VARIANTS)},null,2)+'\n');
 console.log(JSON.stringify({status:'deployed',version,registry:await invoke('/inventory/status')}));return 0;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().then(c=>process.exitCode=c).catch(e=>{console.error(JSON.stringify({error:e.code||'INVENTORY_RELEASE_FAILED'}));process.exitCode=1;});
