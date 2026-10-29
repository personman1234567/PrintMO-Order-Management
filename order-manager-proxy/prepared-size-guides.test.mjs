import test from 'node:test';
import assert from 'node:assert/strict';
import {publicSizeGuide,recipientSizeGuides} from './prepared-size-guides.mjs';
const product=(fields)=>({id:'gid://shopify/Product/123',guide:{reference:{fields:Object.entries(fields).map(([key,value])=>({key,value}))}}});
const fields={name:'Real size guide',default_unit:'in',review_status:'approved',reviewed_by:'Staff',reviewed_at:'2026-10-28',review_due:'2099-10-28',columns:JSON.stringify([{key:'m',label:'M',shopify_labels:['M','Medium']}]),rows:JSON.stringify([{label:'Chest',unit:'in',values:{m:'20 1/2'}}])};
test('only exposes approved current guide measurements and safe public fields, with legacy Page fallback',()=>{
  const guide=publicSizeGuide(product(fields));assert.equal(guide.rows[0].values.m,'20 1/2');assert.equal(guide.reviewed_by,undefined);
  assert.equal(publicSizeGuide(product({...fields,review_status:'draft'})),null);
  assert.equal(publicSizeGuide(product({...fields,review_due:'2020-01-01'})),null);
  assert.deepEqual(publicSizeGuide({chart:{reference:{title:'Shirt chart',body:'<table><tr><td>M</td></tr></table>'}}}),{title:'Shirt chart',html:'<table><tr><td>M</td></tr></table>'});
});
test('reads authorized snapshot products once and keeps unavailable chart failures independent of purchasing',async()=>{
  const record={items:[{id:'first',productId:'gid://shopify/Product/123'},{id:'second',productId:'gid://shopify/Product/123'}]};let calls=0;
  const result=await recipientSizeGuides({}, {graphql:async(_env,_query,variables)=>{calls++;assert.deepEqual(variables.ids,['gid://shopify/Product/123']);return {data:{nodes:[product(fields)]}}}},record);
  assert.equal(calls,1);assert.deepEqual(result.guides.first,result.guides.second);
  assert.deepEqual(await recipientSizeGuides({}, {graphql:async()=>{throw Error('Optional scope unavailable')}},{items:[{id:'other',productId:'gid://shopify/Product/999'}]}),{guides:{}});
});
