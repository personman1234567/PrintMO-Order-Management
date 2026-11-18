import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{PROOF_TAG} from './studio-checkout-proof-worker.mjs';
const env=()=>({SHOPIFY_SHOP_DOMAIN:'429cc0-3.myshopify.com',PROOF_ACCESS_TOKEN:'private-test-key',PROOF_EXPIRES_AT:'2999-01-01T00:00:00Z'});
const request=(path,body={},token='private-test-key')=>new Request('https://proof.test'+path,{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify(body)});
test('private proof fails closed without a secret, on wrong secret and on missing/expired deadline',async()=>{
  for(const settings of [{},{...env(),PROOF_ACCESS_TOKEN:''},{...env(),PROOF_EXPIRES_AT:''},{...env(),PROOF_EXPIRES_AT:'2000-01-01T00:00:00Z'}])
    assert.ok([401,403].includes((await worker.fetch(request('/quote',{scenario:'mixed'}),settings)).status));
  assert.equal((await worker.fetch(request('/quote',{scenario:'mixed'},'wrong'),env())).status,401);
});
test('proof permits only fixed scenarios, methods and bounded bodies, with no arbitrary GraphQL or draft access',async()=>{
  for(const body of [{scenario:'other'},{scenario:'mixed',query:'mutation bad'},{scenario:'merchandise',draftId:'1'},{scenario:'mixed',variantId:'1'},null,[]])
    assert.equal((await worker.fetch(request('/quote',body),env())).status,400);
  assert.equal((await worker.fetch(request('/quote',{scenario:'x'.repeat(2050)}),env())).status,413);
  assert.equal((await worker.fetch(request('/graphql',{}),env())).status,404);
});
test('readiness health reveals no configuration, credentials or storage keys',async()=>{
  const res=await worker.fetch(new Request('https://proof.test/health',{headers:{Authorization:'Bearer private-test-key'}}),env());
  assert.equal(res.status,200);assert.deepEqual(await res.json(),{proof:'checkout-only',run:PROOF_TAG});
});
test('an attaching draft cannot be returned as ready before its required artwork finishes',async()=>{
  const ledger={state:'attaching',draftId:'gid://shopify/DraftOrder/1',sessionId:'83f0b76a-1f1c-4d00-9fa1-36845d0a7890',quote:{id:'83f0b76a-1f1c-4d00-9fa1-36845d0a7890',snapshotId:'a'.repeat(64),quoteId:'b'.repeat(64)}};
  const settings={...env(),R2_BUCKET:{get:async key=>key.endsWith('/scenarios/mixed.json')?{etag:'1',json:async()=>ledger}:null}};
  const res=await worker.fetch(request('/checkout',{scenario:'mixed'}),settings);
  assert.equal(res.status,410);assert.equal((await res.json()).error.code,'QUOTE_EXPIRED');
});
test('completed or foreign-tagged proof drafts cannot return a payable checkout URL',async()=>{
  for(const tags of [[PROOF_TAG],['foreign']]){
    const ledger={state:'ready',draftId:'gid://shopify/DraftOrder/1',quote:{}};
    const settings={...env(),R2_BUCKET:{get:async()=>({etag:'1',json:async()=>ledger})},
      ORDER_SYNC_COORDINATOR:{idFromName:v=>v,get:()=>({fetch:async()=>Response.json({data:{draftOrder:{status:'COMPLETED',tags,order:{id:'order'},invoiceUrl:'https://shop/invoice'}}})})}};
    const res=await worker.fetch(request('/checkout',{scenario:'mixed'}),settings);
    assert.equal(res.status,409);assert.equal((await res.json()).error.code,tags.includes(PROOF_TAG)?'CHECKOUT_COMPLETE':'PROOF_OWNERSHIP_CHANGED');
  }
});
