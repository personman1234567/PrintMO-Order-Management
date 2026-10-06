import {SyncError,requireValue} from './core.mjs';
import {shopifyToken} from './clients.mjs';
import {runGuardedBatch} from './writer.mjs';
import {PRIORITY_SHARED_6400_SKUS} from './priority-shared-6400.mjs';
import {BATCH_SIZE} from './enrollment.mjs';

export const database=env=>{requireValue(env.INVENTORY_DB,'INVENTORY_DATABASE_UNCONFIGURED');return env.INVENTORY_DB;};
export async function acquireLease(env,now=Date.now()){
 const token=crypto.randomUUID();
 const row=await database(env).prepare(`INSERT INTO inventory_sync_jobs(name,lease_token,lease_until,state,updated_at)
 VALUES('operation',?,?, 'running',?) ON CONFLICT(name) DO UPDATE SET lease_token=excluded.lease_token,
 lease_until=excluded.lease_until,state='running',updated_at=excluded.updated_at WHERE inventory_sync_jobs.lease_until<=? RETURNING lease_token`)
 .bind(token,now+120000,now,now).first();
 return row?.lease_token===token ? token : null;
}
export async function releaseLease(env,token){
 await database(env).prepare("UPDATE inventory_sync_jobs SET lease_token=NULL,lease_until=0,state='idle' WHERE name='operation' AND lease_token=?").bind(token).run();
}
export async function renewLease(env,token,now=Date.now()){
 const r=await database(env).prepare("UPDATE inventory_sync_jobs SET lease_until=?,updated_at=? WHERE name='operation' AND lease_token=? AND lease_until>?").bind(now+120000,now,token,now).run();
 requireValue(r.meta.changes===1,'INVENTORY_LEASE_EXPIRED');
}
export async function saveJob(env,name,state,result=null,error=null,now=Date.now()){
 await database(env).prepare(`INSERT INTO inventory_sync_jobs(name,state,updated_at,result_json,error) VALUES(?,?,?,?,?)
 ON CONFLICT(name) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at,result_json=excluded.result_json,error=excluded.error`)
 .bind(name,state,now,result ? JSON.stringify(result) : null,error).run();
}
export async function registerEntries(env,entries,{productId='',now=Date.now(),verified=false}={}){
 requireValue(entries.length>0&&entries.length<=BATCH_SIZE,'INVALID_REGISTRY_BATCH');
 await assertRegistryIdentity(env,entries);
 const db=database(env);
 const statements=entries.map(e=>{
  requireValue(/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(e.id)&&/^[A-Za-z0-9_-]{1,64}$/.test(e.sku)&&['hold','block'].includes(e.missingPolicy||'hold'),'INVALID_REGISTRY_ENTRY');
  const enabled=PRIORITY_SHARED_6400_SKUS.has(e.sku)?0:1;
  return db.prepare(`INSERT INTO inventory_sync_variants(variant_id,sku,product_id,missing_policy,enabled,registered_at,last_success_at,next_due_at)
   VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(variant_id) DO UPDATE SET product_id=CASE WHEN excluded.product_id='' THEN inventory_sync_variants.product_id ELSE excluded.product_id END,
   missing_policy=CASE WHEN ? THEN excluded.missing_policy ELSE inventory_sync_variants.missing_policy END,enabled=excluded.enabled,last_success_at=COALESCE(excluded.last_success_at,inventory_sync_variants.last_success_at),
   next_due_at=CASE WHEN excluded.last_success_at IS NULL THEN inventory_sync_variants.next_due_at ELSE excluded.next_due_at END,
   last_error=CASE WHEN excluded.last_success_at IS NULL THEN inventory_sync_variants.last_error ELSE NULL END
   WHERE inventory_sync_variants.sku=excluded.sku`)
   .bind(e.id,e.sku,productId||e.cohort||'',e.missingPolicy||'hold',enabled,now,verified?now:null,verified?now+refreshInterval(env):0,e.missingPolicy?1:0);
 });
 const results=await db.batch(statements);requireValue(results.every(r=>r.success&&r.meta.changes===1),'PINNED_SKU_CHANGED');
}
export async function assertRegistryIdentity(env,entries){
 requireValue(Array.isArray(entries)&&entries.length>0&&entries.length<=BATCH_SIZE,'INVALID_REGISTRY_BATCH');
 const mismatch=await database(env).prepare(`SELECT COUNT(*) AS count FROM inventory_sync_variants r JOIN json_each(?) e
 ON r.variant_id=json_extract(e.value,'$.id') OR r.sku=json_extract(e.value,'$.sku')
 WHERE r.variant_id!=json_extract(e.value,'$.id') OR r.sku!=json_extract(e.value,'$.sku')`).bind(JSON.stringify(entries)).first();
 requireValue(mismatch.count===0,'PINNED_SKU_CHANGED');
}
export function refreshInterval(env){
 const seconds=Number(env.INVENTORY_REFRESH_SECONDS||300);requireValue(Number.isSafeInteger(seconds)&&seconds>=60,'INVALID_REFRESH_INTERVAL');return seconds*1000;
}
export async function registeredCount(env,ids){
 return (await database(env).prepare('SELECT COUNT(*) AS count FROM inventory_sync_variants WHERE enabled=1 AND variant_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).first()).count;
}
export async function registryStatus(env,now=Date.now()){
 const db=database(env);
 const totals=await db.prepare(`SELECT COUNT(*) AS entries,SUM(enabled) AS scheduled,SUM(1-enabled) AS excluded,
  SUM(CASE WHEN enabled=1 AND last_error IS NOT NULL THEN 1 ELSE 0 END) AS failed,
  SUM(CASE WHEN enabled=1 AND last_success_at IS NULL THEN 1 ELSE 0 END) AS awaitingFirstRefresh,
  MIN(CASE WHEN enabled=1 THEN COALESCE(last_success_at,registered_at) END) AS oldest,
  MAX(last_success_at) AS latest FROM inventory_sync_variants`).first();
 const failures=(await db.prepare('SELECT variant_id AS id,sku,last_error AS error FROM inventory_sync_variants WHERE enabled=1 AND last_error IS NOT NULL ORDER BY next_due_at LIMIT 25').all()).results;
 const jobs=(await db.prepare("SELECT name,state,updated_at AS updatedAt,error,result_json AS result FROM inventory_sync_jobs WHERE name!='operation' ORDER BY updated_at DESC LIMIT 10").all()).results.map(j=>({...j,result:j.result?JSON.parse(j.result):null}));
 return {...totals,oldestRefreshAgeSeconds:totals.oldest===null?null:Math.max(0,Math.floor((now-totals.oldest)/1000)),warning:totals.oldest!==null&&now-totals.oldest>refreshInterval(env)*3,failures,jobs};
}

export async function runRegistrySchedule(env,deps={},scheduledTime=Date.now()){
 const now=deps.now||Date.now;
 const lease=await acquireLease(env,now());if(!lease)return {mode:'registry-refresh',busy:true,variants:0,writes:0};
 const started=now(),deadline=started+Number(env.INVENTORY_RUN_SECONDS||45)*1000;
 const summary={mode:'registry-refresh',variants:0,batches:0,writes:0,held:0,failures:0};
 try{
  const token=await shopifyToken(env,deps);
  while(now()<deadline){
   const rows=(await database(env).prepare('SELECT variant_id AS id,sku,missing_policy AS missingPolicy FROM inventory_sync_variants WHERE enabled=1 AND next_due_at<=? ORDER BY next_due_at,variant_id LIMIT ?').bind(now(),BATCH_SIZE).all()).results;
   if(!rows.length)break;
   await renewLease(env,lease,now());
   let error=null;
   try{
    const result=await (deps.runBatch||runGuardedBatch)({...env,SHOPIFY_ACCESS_TOKEN:token,PILOT_VARIANT_IDS:JSON.stringify(rows.map(r=>r.id)),PILOT_VARIANT_SKUS:JSON.stringify(rows.map(r=>r.sku)),PILOT_MISSING_SKU_POLICIES:JSON.stringify(rows.map(r=>r.missingPolicy))},deps);
    summary.writes+=result.writes||0;summary.held+=result.held||0;summary.variants+=rows.length;
   }catch(e){error=e instanceof SyncError?e.code:'INVENTORY_BATCH_FAILED';summary.failures++;}
   const checked=now();
   await database(env).batch(rows.map(r=>database(env).prepare(`UPDATE inventory_sync_variants SET next_due_at=?,last_error=?,
    last_success_at=CASE WHEN ? IS NULL THEN ? ELSE last_success_at END WHERE variant_id=?`)
    .bind(checked+(error?60000:refreshInterval(env)),error,error,checked,r.id)));
   summary.batches++;
  }
  await saveJob(env,'schedule',summary.failures?'partial':'verified',{...summary,elapsedMs:now()-started,scheduledTime},null,now());
  return summary;
 }catch(e){await saveJob(env,'schedule','failed',summary,e instanceof SyncError?e.code:'INVENTORY_SCHEDULE_FAILED',now());throw e;}
 finally{await releaseLease(env,lease);}
}
