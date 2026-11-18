// Private, bounded live proof. Never deploy this entry as order-manager-proxy.
import {handleStudioCheckoutRequest} from './studio-checkout.mjs';
import {createDraftOrderService} from './draft-orders.mjs';
export const PROOF_TAG='pm-studio-checkout-proof-20261113';
export const CATALOG_QUERY=`query StudioProofCatalog {
  shop { plan { displayName shopifyPlus } }
  merchandise:collection(id:"gid://shopify/Collection/481089487096") {products(first:8){nodes{id title
    partner:metafield(namespace:"custom",key:"partner_reference"){value}
    variants(first:30){nodes{id title price availableForSale requiresComponents}}}}}
  blanks:collection(id:"gid://shopify/Collection/482306556152"){products(first:8){nodes{id title
    partner:metafield(namespace:"custom",key:"partner_reference"){value}
    config:metafield(namespace:"custom",key:"designer_config"){value}
    variants(first:30){nodes{id title price availableForSale requiresComponents}}}}}
}`;
export const STATE_QUERY=`query StudioProofState($id:ID!){draftOrder(id:$id){id status tags invoiceUrl order{id} subtotalPriceSet{presentmentMoney{amount currencyCode}} totalDiscountsSet{presentmentMoney{amount currencyCode}} lineItems(first:20){nodes{id quantity variant{id} customAttributes{key value}}}}}`;
const ROOT='isolated-studio-proof/20261113/';
const fail=(code,message,status=400)=>{throw Object.assign(new Error(message),{code,status});};
const scenarios=new Set(['merchandise','mixed']);
const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),v=>v.toString(16).padStart(2,'0')).join('');
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><rect x="30" y="30" width="240" height="240" fill="#e81777"/><path d="M90 225V75h60a45 45 0 0 1 0 90h-30v60z" fill="#ffffff"/></svg>';
async function graphql(env,query,variables,operationName){
  const stub=env.ORDER_SYNC_COORDINATOR.get(env.ORDER_SYNC_COORDINATOR.idFromName(env.SHOPIFY_SHOP_DOMAIN));
  const response=await stub.fetch(new Request('https://internal/graphql',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,variables,operationName})}));
  if(!response.ok)fail('UPSTREAM_UNAVAILABLE','Shopify transport is unavailable.',502);
  return response.json();
}
const checked=result=>{if(result?.ok===false||!result?.data||result?.errors?.length)fail('SHOPIFY_UNAVAILABLE','Shopify could not verify this proof.',502);return result.data;};
async function load(bucket,key){const v=await bucket.get(ROOT+key);return v?{value:await v.json(),etag:v.etag}:null;}
async function save(bucket,key,value,onlyIf){return bucket.put(ROOT+key,JSON.stringify(value),{httpMetadata:{contentType:'application/json'},...(onlyIf?{onlyIf}:{})});}
function privateBucket(bucket){return {get:key=>bucket.get(ROOT+'core/'+key),put:(key,body,opts)=>bucket.put(ROOT+'core/'+key,body,opts)};}
async function scenarioInput(env,scenario){
  const data=checked(await graphql(env,CATALOG_QUERY,{},'StudioProofCatalog'));
  const retail=(data.merchandise?.products.nodes||[]).find(p=>p.partner?.value&&p.variants.nodes.some(v=>v.availableForSale&&!v.requiresComponents));
  const custom=(data.blanks?.products.nodes||[]).find(p=>!p.partner?.value&&p.config?.value&&p.variants.nodes.some(v=>v.availableForSale&&!v.requiresComponents));
  if(!retail||(scenario==='mixed'&&!custom))fail('PROOF_PRODUCTS_UNAVAILABLE','The fixed proof products could not be found.',409);
  const rv=retail.variants.nodes.find(v=>v.availableForSale&&!v.requiresComponents);
  const cv=custom?.variants.nodes.find(v=>v.availableForSale&&!v.requiresComponents);
  const design={revision:await hash(svg),prints:[{type:'image',side:'front',design:{xIn:1,yIn:1,wIn:3,hIn:3,rotation:0}}],canvasCalibration:{bySide:{front:{referenceWidthIn:12,safeWidthIn:12,safeHeightIn:15}}}};
  return {items:scenario==='mixed'?[{id:'proof-custom',variantId:cv.id,quantities:{[cv.id]:12},design,instructions:'Checkout proof only; do not produce.'}]:[],merchandise:[{id:'proof-retail',variantId:rv.id,quantity:1}]};
}
async function ownState(env,ledger){
  if(!ledger.draftId)return {status:'REVIEW'};
  const draft=checked(await graphql(env,STATE_QUERY,{id:ledger.draftId},'StudioProofState')).draftOrder;
  if(!draft||!draft.tags.includes(PROOF_TAG))fail('PROOF_OWNERSHIP_CHANGED','The proof checkout cannot be verified.',409);
  return {status:draft.order||draft.status==='COMPLETED'?'COMPLETED':draft.status,checkoutUrl:draft.invoiceUrl,audit:{draftId:draft.id,subtotal:draft.subtotalPriceSet?.presentmentMoney,discounts:draft.totalDiscountsSet?.presentmentMoney,lines:draft.lineItems?.nodes||[]}};
}
function json(value,status=200){return Response.json(value,{status,headers:{'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});}
export default {async fetch(request,rawEnv){
  try {
    if(!rawEnv.PROOF_ACCESS_TOKEN||!Number.isFinite(Date.parse(rawEnv.PROOF_EXPIRES_AT||''))||Date.now()>Date.parse(rawEnv.PROOF_EXPIRES_AT||''))return json({error:{code:'PROOF_CLOSED',message:'This private proof is closed.'}},403);
    const auth=request.headers.get('Authorization')||'';
    if(auth!=='Bearer '+rawEnv.PROOF_ACCESS_TOKEN)return json({error:{code:'AUTH_REQUIRED',message:'Private checkout proof.'}},401);
    const url=new URL(request.url);
    if(request.method==='GET'&&url.pathname==='/health')return json({proof:'checkout-only',run:PROOF_TAG});
    if(request.method!=='POST'||!['/quote','/checkout','/state','/catalog'].includes(url.pathname))return json({error:{code:'NOT_FOUND',message:'Not found.'}},404);
    const raw=await request.text();if(raw.length>2048)fail('REQUEST_TOO_LARGE','Proof request too large.',413);
    let body;try{body=JSON.parse(raw);}catch{fail('INVALID_REQUEST','Choose a proof scenario.');}
    if(!body||Array.isArray(body)||Object.keys(body).some(k=>k!=='scenario')||!scenarios.has(body.scenario))fail('INVALID_REQUEST','Choose merchandise or mixed.');
    if(url.pathname==='/catalog')return json(checked(await graphql(rawEnv,CATALOG_QUERY,{},'StudioProofCatalog')));
    const key='scenarios/'+body.scenario+'.json',existing=await load(rawEnv.R2_BUCKET,key);
    if(url.pathname==='/quote'){
      if(existing?.value.quote)return json({quote:existing.value.quote,...await ownState(rawEnv,existing.value)});
      if(existing)fail('PROOF_PENDING','This scenario is being prepared. Retry shortly.',409);
      const lease=await save(rawEnv.R2_BUCKET,key,{state:'quoting',startedAt:new Date().toISOString(),sessionId:crypto.randomUUID()},{etagDoesNotMatch:'*'});
      if(!lease)fail('PROOF_PENDING','This scenario is being prepared. Retry shortly.',409);
      try{
        const input=await scenarioInput(rawEnv,body.scenario);
        const env={...rawEnv,R2_BUCKET:privateBucket(rawEnv.R2_BUCKET),STUDIO_MERCHANDISE_PROOF_ENABLED:'true'};
        const quote=await handleStudioCheckoutRequest(new Request('https://proof/order-manager/v1/studio-checkout/quote',{method:'POST',headers:{Origin:'https://print-mo.com','CF-Connecting-IP':'private-proof-'+body.scenario},body:JSON.stringify(input)}),env,{graphql});
        await save(rawEnv.R2_BUCKET,key,{state:'quoted',sessionId:existing?.value.sessionId||crypto.randomUUID(),quote}, {etagMatches:lease.etag});
        return json({quote,status:'REVIEW'});
      }catch(error){await rawEnv.R2_BUCKET.delete(ROOT+key);throw error;}
    }
    if(!existing?.value.quote)fail('QUOTE_REQUIRED','Review the scenario first.',409);
    const ledger=existing.value;
    if(url.pathname==='/state')return json({quote:ledger.quote,...await ownState(rawEnv,ledger),editingReady:false});
    if(ledger.draftId&&ledger.state==='ready'){
      const state=await ownState(rawEnv,ledger);
      if(state.status==='COMPLETED')fail('CHECKOUT_COMPLETE','This proof was completed. No new checkout will be created.',409);
      return json({...state,editingReady:false});
    }
    const env={...rawEnv,R2_BUCKET:privateBucket(rawEnv.R2_BUCKET),STUDIO_MERCHANDISE_PROOF_ENABLED:'true'};
    const owner=async()=>{const row=await rawEnv.ORDER_DB.prepare('SELECT id,shop_domain,uninstalled_at FROM shops WHERE shop_domain=?').bind(rawEnv.SHOPIFY_SHOP_DOMAIN).first();if(!row||row.uninstalled_at)fail('SHOP_UNAVAILABLE','The installed shop could not be verified.',503);return row;};
    const liveGraphql=async(_env,query,variables,name)=>{
      if(name==='PreparedCheckoutCreate')variables={...variables,input:{...variables.input,note:'Private functional checkout proof. Leave unpaid; do not produce.',tags:[...variables.input.tags,PROOF_TAG,'pm-proof-'+body.scenario]}};
      const result=await graphql(rawEnv,query,variables,name);
      const draft=result?.data?.draftOrderCreate?.draftOrder;
      if(draft?.id){ledger.draftId=draft.id;ledger.state='attaching';await save(rawEnv.R2_BUCKET,key,ledger);}
      return result;
    };
    const drafts=createDraftOrderService({...rawEnv,DRAFT_ORDERS_ENABLED:'1'},{shop:owner,graphql:liveGraphql});
    const assertOwn=async id=>{if(id===ledger.draftId)return;const draft=checked(await graphql(rawEnv,STATE_QUERY,{id},'StudioProofState')).draftOrder;if(ledger.draftId||!draft?.tags.includes(PROOF_TAG)||!draft.tags.includes('pm-proof-'+body.scenario))fail('PROOF_OWNERSHIP_CHANGED','Unknown proof draft.',409);ledger.draftId=id;ledger.state='attaching';await save(rawEnv.R2_BUCKET,key,ledger);};
    const deps={graphql:liveGraphql,drafts:{detail:async id=>{await assertOwn(id);return drafts.detail(id);},handle:async(req,actor)=>{const id=decodeURIComponent(new URL(req.url).pathname.split('/')[4]);await assertOwn(id);return drafts.handle(req,actor);}}};
    const q=ledger.quote;
    const result=await handleStudioCheckoutRequest(new Request('https://proof/order-manager/v1/studio-checkout/'+q.id+'/checkout',{method:'POST',headers:{Origin:'https://print-mo.com','CF-Connecting-IP':'private-proof-'+body.scenario},body:JSON.stringify({snapshotId:q.snapshotId,quoteId:q.quoteId,sessionId:ledger.sessionId,artwork:body.scenario==='mixed'?{'proof-custom':{front:svg}}:{}})}),env,deps);
    ledger.state='ready';ledger.checkoutUrl=result.checkoutUrl;await save(rawEnv.R2_BUCKET,key,ledger);
    return json({...result,editingReady:false});
  }catch(error){return json({error:{code:error.code||'PROOF_UNAVAILABLE',message:error.code?error.message:'The proof could not finish. Retry after checking its state.'}},error.status||503);}
}};
