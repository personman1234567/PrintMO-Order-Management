import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,item,gid} from './studio-merchandise.test-support.mjs';
import {recipientQuote} from './prepared-order-links.mjs';
const merchandise=(quantity=1)=>[{id:'retail-a',variantId:gid(1001),quantity}];
const proof=()=>{const f=fixture();f.env.STUDIO_MERCHANDISE_PROOF_ENABLED='true';return f;};
const attrs=line=>Object.fromEntries(line.customAttributes.map(v=>[v.key,v.value]));

test('merchandise-only reaches the existing direct checkout with exact real variants and no artwork/export',async()=>{
  const f=proof(),q=await f.quote({items:[],merchandise:merchandise()});
  assert.deepEqual(q.items,[]);assert.equal(q.merchandise[0].productId,'gid://shopify/Product/1001');
  assert.equal(q.pricing.eligibleQuantity,0);assert.equal(q.pricing.rate,0);
  assert.equal(q.pricing.checkoutSubtotalCents,1997);assert.equal(q.pricing.discountCents,0);
  const result=await f.checkout(q,{artwork:{}});
  assert.match(result.checkoutUrl,/invoice\/1$/);assert.equal(f.created.length,1);assert.equal(f.uploads.length,0);
  const input=f.created[0],line=input.lineItems[0];
  assert.equal(input.lineItems.length,1);assert.equal(line.variantId,gid(1001));assert.equal(line.quantity,1);
  assert.deepEqual(line.priceOverride,{amount:'19.97',currencyCode:'USD'});
  assert.equal(attrs(line)._batch_role,'merchandise');assert.equal(attrs(line)._group_role,'merchandise');
  assert.equal(line.appliedDiscount,undefined);assert.equal(attrs(line)._method,undefined);
  assert.equal(input.acceptAutomaticDiscounts,false);assert.equal(input.allowDiscountCodesInCheckout,false);
  await f.checkout(q,{artwork:{}});assert.equal(f.created.length,1);
});

test('mixed checkout preserves garment-print groups, bulk pricing and artwork association; merchandise stays full price',async()=>{
  const f=proof(),q=await f.quote({items:[item()],merchandise:merchandise()});
  assert.equal(q.pricing.eligibleQuantity,12);assert.equal(q.pricing.rate,.05);
  assert.equal(q.pricing.subtotalCents,19997);assert.equal(q.pricing.discountCents,900);
  assert.equal(q.pricing.checkoutSubtotalCents,19097);
  await f.checkout(q);
  assert.equal(f.created.length,1);
  const lines=f.created[0].lineItems;
  assert.deepEqual(lines.map(l=>attrs(l)._batch_role),['garment','print','merchandise']);
  assert.equal(lines[0].appliedDiscount.value,5);assert.equal(lines[1].appliedDiscount.value,5);assert.equal(lines[2].appliedDiscount,undefined);
  assert.equal(attrs(lines[0])._batch_id,attrs(lines[1])._batch_id);
  assert.notEqual(attrs(lines[0])._batch_id,attrs(lines[2])._batch_id);
  assert.deepEqual(f.uploads.map(v=>v.lines),[['line-0']]);
});

test('eleven custom garments plus merchandise never reach the twelve-garment tier, even if merchandise is eligible in Shopify',async()=>{
  const f=proof(),q=await f.quote({items:[item('a',1,11)],merchandise:merchandise(20)});
  assert.equal(q.pricing.eligibleQuantity,11);assert.equal(q.pricing.discountCents,0);assert.equal(q.pricing.rate,0);
  await f.checkout(q);assert.ok(f.created[0].lineItems.every(line=>!line.appliedDiscount));
});

test('removing the last custom garment before checkout produces a new merchandise-only quote without stale printing',async()=>{
  const f=proof(),mixed=await f.quote({items:[item()],merchandise:merchandise()});
  const retail=await f.quote({items:[],merchandise:merchandise(2)});
  assert.notEqual(mixed.snapshotId,retail.snapshotId);assert.notEqual(mixed.quoteId,retail.quoteId);
  await f.checkout(retail,{artwork:{}});
  assert.equal(f.created[0].lineItems.length,1);assert.equal(f.created[0].lineItems[0].quantity,2);
  assert.equal(retail.pricing.checkoutSubtotalCents,3994);assert.equal(f.uploads.length,0);
});

test('client prices/roles/duplicates and checkout quantity changes cannot bypass the server snapshot',async()=>{
  const f=proof();
  for(const value of [{...merchandise()[0],price:'.01'},{...merchandise()[0],role:'garment'},
    {...merchandise()[0],quantity:0},{...merchandise()[0],quantity:1.5}])
    await assert.rejects(f.quote({items:[],merchandise:[value]}),e=>e.code==='INVALID_MERCHANDISE');
  await assert.rejects(f.quote({items:[],merchandise:[...merchandise(),{...merchandise()[0],id:'b'}]}),e=>e.code==='INVALID_MERCHANDISE');
  const q=await f.quote({items:[],merchandise:merchandise()});
  await assert.rejects(f.checkout(q,{merchandise:merchandise(9),artwork:{}}),e=>e.code==='ORDER_CHANGED');
  assert.equal(f.created.length,0);
});

test('retail price, availability, publication and supported product types are reread before checkout',async()=>{
  for(const change of [f=>f.state.retailPrice='20.00',f=>f.state.retailAvailable=false,
    f=>f.state.retailPublished=false,f=>f.state.retailPartner='',f=>f.state.retailBundle=true,
    f=>f.state.retailSubscription=true]){
    const f=proof(),q=await f.quote({items:[],merchandise:merchandise()});change(f);
    await assert.rejects(f.checkout(q,{artwork:{}}),e=>['PRICE_CHANGED','MERCHANDISE_UNAVAILABLE'].includes(e.code));
    assert.equal(f.created.length,0);
  }
});

test('merchandise is disabled by default and empty/service-only selections still cannot checkout',async()=>{
  const f=fixture();
  await assert.rejects(f.quote({items:[],merchandise:merchandise()}),e=>e.code==='MERCHANDISE_DISABLED');
  const g=proof();
  await assert.rejects(g.quote({items:[],merchandise:[]}),e=>e.code==='ITEMS_REQUIRED');
  const empty=await g.quote({items:[item('a',1,0)]});
  await assert.rejects(g.checkout(empty,{artwork:{}}),e=>e.code==='QUANTITIES_REQUIRED');
});

test('the final expanded checkout line limit also includes merchandise and services',async()=>{
  const extras={items:[{id:'m',kind:'merchandise'}],lines:Array.from({length:201},()=>({quantity:1,customAttributes:[{key:'_batch_role',value:'merchandise'}]}))};
  await assert.rejects(recipientQuote({}, {}, {}, {order:{id:'a'},purchase:{snapshotId:'s'},snapshot:{record:{items:[]},items:[]}}, {snapshotId:'s',quantities:{}},extras),e=>e.code==='ORDER_TOO_LARGE');
});

test('server product classification rejects merchandise disguised as a custom garment',async()=>{
  const f=proof();f.state.price=f.state.retailPrice;
  await assert.rejects(f.quote({items:[item('retail-as-custom',1001,12,'')]}),e=>e.code==='MERCHANDISE_TYPE_REQUIRED');
  assert.equal(f.created.length,0);
});

test('custom classification is reread when an earlier quote reaches checkout',async()=>{
  const f=proof(),q=await f.quote({items:[item()],merchandise:merchandise()});
  f.state.customPartner='gid://shopify/Metaobject/99';
  await assert.rejects(f.checkout(q),error=>error.code==='MERCHANDISE_TYPE_REQUIRED');
  assert.equal(f.created.length,0);
});
