import test from 'node:test';
import assert from 'node:assert/strict';
import {preparedPriceProducts,PREPARED_RECIPIENT_COMMERCE_QUERY} from './prepared-price-products.mjs';
import {preparedCustomerUrl} from '../order-manager-web/prepared-customer-url.mjs';
const productId='gid://shopify/Product/1',variantId='gid://shopify/ProductVariant/2';
test('current pricing batches only snapshot-member variants and current product configuration, without catalog images',async()=>{
  const record={items:[{id:'a',productId,variantId,title:'Unlisted'},{id:'b',productId,variantId,title:'Unlisted'}]},snapshot=[{id:'a',variants:[{id:variantId}],image:''},{id:'b',variants:[{id:variantId}],image:''}];let calls=0;
  const graphql=async(_env,query,{ids})=>{calls++;assert.deepEqual(ids,[productId,variantId]);assert.equal(query,PREPARED_RECIPIENT_COMMERCE_QUERY);return {data:{nodes:[{id:productId,title:'Unlisted',status:'UNLISTED',designerConfig:{value:'{"placements":{}}'}},{id:variantId,price:'15.25',selectedOptions:[{name:'Size',value:'M'}],product:{id:productId,status:'UNLISTED'}}]}}};
  const result=await preparedPriceProducts({},graphql,record,snapshot,JSON.parse);assert.equal(calls,1);assert.equal(result.get(productId).variants[0].price,'15.25');
  assert.doesNotMatch(PREPARED_RECIPIENT_COMMERCE_QUERY,/media|swatch|variants\(/);
  await assert.rejects(preparedPriceProducts({},async()=>({data:{nodes:[]}}),record,snapshot,JSON.parse),error=>error.code==='PRODUCT_UNAVAILABLE');
  await assert.rejects(preparedPriceProducts({},async()=>({errors:[{message:'Throttled'}]}),record,snapshot,JSON.parse),error=>error.code==='SHOPIFY_UNAVAILABLE');
});
test('testing links are explicit and reversible without changing their prepared order identity',()=>{
  const base='https://print-mo.com/pages/designer-studio?preparedOrder=example',testing=preparedCustomerUrl(base,true);
  assert.equal(new URL(testing).searchParams.get('preview_theme_id'),'163707977976');
  assert.equal(preparedCustomerUrl(testing),base);assert.equal(new URL(testing).searchParams.get('preparedOrder'),'example');
  assert.throws(()=>preparedCustomerUrl('https://other.test/path',true));
});
