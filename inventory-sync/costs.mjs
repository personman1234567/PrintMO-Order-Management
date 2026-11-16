import {measure} from './timing.mjs';
import {SyncError,requireValue} from './core.mjs';
import {requestJson,shopDomain,shopifyToken} from './clients.mjs';

export const COST_MUTATION=`mutation SyncSupplierCosts($productId:ID!,$variants:[ProductVariantsBulkInput!]!){
 productVariantsBulkUpdate(productId:$productId,variants:$variants,allowPartialUpdates:false){
  productVariants{id inventoryItem{unitCost{amount currencyCode}}} userErrors{field message}
 }
}`;

export function costOperation(groups){
 const entries=[...groups.entries()];
 requireValue(entries.length>0&&entries.length<=25&&entries.flatMap(([,rows])=>rows).length<=250,'INVALID_COST_BATCH');
 if(entries.length===1){const [productId,rows]=entries[0];return {query:COST_MUTATION,variables:{productId,variants:rows.map(r=>({id:r.id,inventoryItem:{cost:r.source}}))},results:[{key:'productVariantsBulkUpdate',rows}]};}
 const variables={},declarations=[],results=[];
 const fields=entries.map(([productId,rows],i)=>{
  variables['product'+i]=productId;variables['variants'+i]=rows.map(r=>({id:r.id,inventoryItem:{cost:r.source}}));
  declarations.push('$product'+i+':ID!','$variants'+i+':[ProductVariantsBulkInput!]!');results.push({key:'cost'+i,rows});
  return 'cost'+i+':productVariantsBulkUpdate(productId:$product'+i+',variants:$variants'+i+',allowPartialUpdates:false){productVariants{id inventoryItem{unitCost{amount currencyCode}}}userErrors{field message}}';
 });
 return {query:'mutation SyncSupplierCosts('+declarations.join(',')+'){'+fields.join('\n')+'}',variables,results};
}
export function money(value,{positive=false}={}){
 if(!['string','number'].includes(typeof value))return null;
 const text=String(value).trim();
 if(!/^\d{1,7}(?:\.\d{1,2}0*)?$/.test(text)||positive&&Number(text)<=0)return null;
 const [whole,fraction='']=text.split('.');
 return String(Number(whole))+'.'+(fraction+'00').slice(0,2);
}
export async function costConfig(env){
 const row=await env.INVENTORY_DB.prepare("SELECT result_json FROM inventory_sync_jobs WHERE name='cost-config'").first();
 const config=row?.result_json?JSON.parse(row.result_json):{mode:'disabled',productId:null,since:0};
 requireValue(['disabled','preview','enabled'].includes(config.mode),'INVALID_COST_MODE');return config;
}
export async function configureCosts(env,input,now=Date.now()){
 requireValue(['disabled','preview','enabled'].includes(input.mode),'INVALID_COST_MODE');
 requireValue(!input.productId||/^gid:\/\/shopify\/Product\/\d+$/.test(input.productId),'INVALID_COST_PRODUCT');
 const config={mode:input.mode,productId:input.productId||null,since:now};
 await env.INVENTORY_DB.prepare(`INSERT INTO inventory_sync_jobs(name,state,updated_at,result_json) VALUES('cost-config',?,?,?)
 ON CONFLICT(name) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at,result_json=excluded.result_json`)
 .bind(config.mode,now,JSON.stringify(config)).run();return config;
}
export async function costStatus(env){
 const config=await costConfig(env),db=env.INVENTORY_DB;
 const totals=await db.prepare(`SELECT COUNT(*) AS eligible,
 SUM(CASE WHEN c.checked_at>=? THEN 1 ELSE 0 END) AS checked,
 SUM(CASE WHEN c.checked_at>=? AND c.state='matched' THEN 1 ELSE 0 END) AS matched,
 SUM(CASE WHEN c.checked_at>=? AND c.state='preview' THEN 1 ELSE 0 END) AS changes,
 SUM(CASE WHEN c.checked_at>=? AND c.state='skipped' THEN 1 ELSE 0 END) AS skipped,
 SUM(CASE WHEN c.checked_at>=? AND c.state IN ('failed','pending','deferred') THEN 1 ELSE 0 END) AS pending,
 MAX(c.checked_at) AS latestCheck,MAX(c.written_at) AS latestWrite
 FROM inventory_sync_variants r LEFT JOIN inventory_sync_costs c ON c.variant_id=r.variant_id
 WHERE r.enabled=1 AND (? IS NULL OR c.product_id=? OR r.product_id=?)`)
 .bind(...Array(5).fill(config.since),config.productId,config.productId,config.productId).first();
 const exceptions=(await db.prepare(`SELECT c.variant_id AS id,r.sku,c.state,c.error,c.source_cost,c.shopify_cost FROM inventory_sync_costs c
 JOIN inventory_sync_variants r ON r.variant_id=c.variant_id WHERE r.enabled=1 AND c.state!='matched'
 AND (? IS NULL OR c.product_id=?) ORDER BY c.checked_at DESC LIMIT 25`).bind(config.productId,config.productId).all()).results;
 return {config,...totals,exceptions};
}
function record(env,row,now){
 return env.INVENTORY_DB.prepare(`INSERT INTO inventory_sync_costs
 (variant_id,product_id,sku,checked_at,observed_at,source_cost,shopify_cost,state,error,before_cost,written_cost,written_at)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(variant_id) DO UPDATE SET product_id=excluded.product_id,sku=excluded.sku,
 checked_at=excluded.checked_at,observed_at=excluded.observed_at,source_cost=excluded.source_cost,
 shopify_cost=excluded.shopify_cost,state=excluded.state,error=excluded.error,
 before_cost=CASE WHEN excluded.state='pending' THEN excluded.before_cost ELSE inventory_sync_costs.before_cost END,
 written_cost=CASE WHEN excluded.state='pending' THEN excluded.written_cost ELSE inventory_sync_costs.written_cost END,
 written_at=COALESCE(excluded.written_at,inventory_sync_costs.written_at)`)
 .bind(row.id,row.productId,row.sku,now,row.observedAt||null,row.source??null,row.current??null,row.state,row.error||null,
 row.state==='pending'?(row.current??null):null,row.state==='pending'?(row.source??null):null,row.writtenAt||null);
}
async function recordRows(env,rows,now,deps){for(let i=0;i<rows.length;i+=100)await measure(deps,'detail','costRecords',()=>env.INVENTORY_DB.batch(rows.slice(i,i+100).map(row=>record(env,row,now))));}
export async function syncCosts(env,input,config,deps={}){
 const summary={checked:0,changed:0,writes:0,unchanged:0,skipped:0,failed:0,deferred:0};
 if(config.mode==='disabled')return summary;
 const now=deps.now||Date.now,deadline=deps.costDeadline||Infinity;
 const source=new Map(input.supplier.items.map(r=>[r.sku,r.customerPrice])),groups=new Map(),checks=[];
 for(const [index,v] of input.variants.entries()){
  if(config.productId&&v.product?.id!==config.productId)continue;
  summary.checked++;
  const row={id:v.id,productId:v.product?.id||'',sku:v.sku,observedAt:input.supplier.observedAt,
   source:money(source.get(v.sku),{positive:true}),current:money(v.inventoryItem?.unitCost?.amount),state:'matched'};
  const age=now()-Date.parse(row.observedAt);
  if(input.costUnavailable)row.error='SHOPIFY_COST_READ_UNAVAILABLE';
  else if(!input.matches[index]||!/^gid:\/\/shopify\/Product\/\d+$/.test(row.productId))row.error='COST_IDENTITY_UNVERIFIED';
  else if(input.currencyCode!=='USD'||v.inventoryItem?.unitCost&&v.inventoryItem.unitCost.currencyCode!=='USD')row.error='COST_CURRENCY_MISMATCH';
  else if(!Number.isFinite(age)||age < -30000||age>300000)row.error='COST_SOURCE_STALE';
  else if(row.source===null)row.error='SUPPLIER_COST_MISSING_OR_INVALID';
  else if(v.inventoryItem?.unitCost!==null&&row.current===null)row.error='SHOPIFY_COST_INVALID';
  if(row.error){row.state='skipped';summary.skipped++;checks.push(row);continue;}
  if(row.current===row.source){summary.unchanged++;checks.push(row);continue;}
  summary.changed++;row.state=config.mode==='preview'?'preview':'deferred';
  checks.push(row);
  if(config.mode==='preview')continue;
  if(!groups.has(row.productId))groups.set(row.productId,[]);groups.get(row.productId).push(row);
 }
 await recordRows(env,checks,now(),deps);
 const grouped=[...groups.entries()];
 for(let offset=0;offset<grouped.length;offset+=25){
 const operationGroups=new Map(grouped.slice(offset,offset+25)),updates=[...operationGroups.values()].flat();
 if(now()>=deadline||deps.costAuth?.blocked)continue;
 try{
  requireValue(shopDomain(env)==='429cc0-3.myshopify.com','INVALID_COST_DESTINATION');
  requireValue(env.SHOPIFY_POLICY_CLIENT_ID&&env.SHOPIFY_POLICY_CLIENT_SECRET,'PRODUCT_COST_WRITE_SCOPE_MISSING');
  const operation=costOperation(operationGroups);
  const token=deps.costAuth?.token||await shopifyToken({...env,SHOPIFY_ACCESS_TOKEN:undefined,SHOPIFY_API_KEY:env.SHOPIFY_POLICY_CLIENT_ID,SHOPIFY_API_SECRET:env.SHOPIFY_POLICY_CLIENT_SECRET},deps);
  if(deps.costAuth)deps.costAuth.token=token;
  // Cost work follows completed 25-variant stock checkpoints; combine up to
  // 250 observed variants and 25 product groups in one cost-only request.
  // Persist recovery values before a possibly ambiguous network write.
  await recordRows(env,updates.map(row=>({...row,state:'pending'})),now(),deps);
  const age=now()-Date.parse(input.supplier.observedAt);
  requireValue(age>=-30000&&age<=300000,'COST_SOURCE_STALE');
  const response=await requestJson(`https://${shopDomain(env)}/admin/api/2026-07/graphql.json`,{
   method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token},
   body:JSON.stringify({query:operation.query,variables:operation.variables})
  },{...deps,retryHttp:false,requestKind:'costWrite'});
  requireValue(response.data,'SHOPIFY_COST_WRITE_FAILED');
  const recorded=[];let writes=0,failed=0;
  for(const {key,rows} of operation.results){
   const result=response.data[key],returned=new Map((result?.productVariants||[]).map(v=>[v.id,v.inventoryItem?.unitCost]));
   const error=!result||result.userErrors?.length?'SHOPIFY_COST_WRITE_REJECTED':
    rows.every(row=>returned.get(row.id)?.currencyCode==='USD'&&money(returned.get(row.id).amount)===row.source)?null:'SHOPIFY_COST_WRITE_UNCONFIRMED';
   if(error){failed+=rows.length;recorded.push(...rows.map(row=>({...row,state:'failed',error})));}
   else{writes+=rows.length;recorded.push(...rows.map(row=>({...row,state:'matched',current:row.source,writtenAt:now()})));}
  }
  await recordRows(env,recorded,now(),deps);summary.writes+=writes;summary.failed+=failed;
  if(response.errors?.length&&deps.costAuth)deps.costAuth.blocked=true;
 }catch(e){
  await recordRows(env,updates.map(row=>({...row,state:'failed',error:e instanceof SyncError?e.code:'COST_BATCH_FAILED'})),now(),deps);
  summary.failed+=updates.length;
  if(deps.costAuth)deps.costAuth.blocked=true;
 }
 }
 if(config.mode==='enabled')summary.deferred=summary.changed-summary.writes-summary.failed;
 return summary;
}
