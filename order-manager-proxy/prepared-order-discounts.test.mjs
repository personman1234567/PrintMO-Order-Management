import test from 'node:test';
import assert from 'node:assert/strict';
import {calculatePreparedBulk,preparedMoneyCents,verifyPreparedBulkTotals} from './prepared-order-discounts.mjs';
import {buildPreparedCheckoutLines} from './prepared-order-links.mjs';
import {fixtureBulkResponse,fixtureCalculated,fixtureMoney} from './prepared-order-discounts.test-support.mjs';
const garment='gid://shopify/ProductVariant/1',excluded='gid://shopify/ProductVariant/2',print=46714190168312;
const item=(id,variant=garment)=>({id,title:id,variants:[{id:variant,priceCents:1000}],prints:[{variantId:print,priceCents:500,side:'front',label:'Chest Print'}]});
const run=async(items,quantities,options={})=>{
  const calls=[],lines=buildPreparedCheckoutLines(items,quantities,'order','snapshot',true).lines;
  const result=await calculatePreparedBulk({}, {graphql:async(_,query,variables)=>{calls.push({query,variables});return fixtureBulkResponse(query,variables,options);}},lines,items);
  return {...result,calls};
};
test('tier boundaries count garments once and apply the selected percentage to garments AND printing',async()=>{
  for(const [quantity,rate,net] of [[11,0,16500],[12,.05,17100],[23,.05,32775],[24,.10,32400],[47,.10,63450],[48,.15,61200],[71,.15,90525],[72,.20,86400],[99,.20,118800],[100,.20,120000],[101,.20,121200]]){
    const result=await run([item('a')],{a:{[garment]:quantity}});
    assert.equal(result.pricing.eligibleQuantity,quantity);assert.equal(result.pricing.rate,rate);assert.equal(result.pricing.checkoutSubtotalCents,net);
    assert.deepEqual(result.input.lineItems.map(line=>line.appliedDiscount?.value||0),[rate*100,rate*100]);
    assert.equal(result.input.acceptAutomaticDiscounts,false);assert.equal(result.input.allowDiscountCodesInCheckout,false);assert.deepEqual(result.input.discountCodes,[]);
    assert.ok(result.input.lineItems.every(line=>line.priceOverride.currencyCode==='USD'));
  }
});
test('mixed eligible garments combine; excluded garments and THEIR printing never qualify or receive discounts',async()=>{
  const items=[item('a'),item('b',excluded),item('c','gid://shopify/ProductVariant/3')];
  const result=await run(items,{a:{[garment]:6},b:{[excluded]:99},c:{'gid://shopify/ProductVariant/3':6}},{eligible:id=>id!==excluded&&Number(id.split('/').pop())<100});
  assert.equal(result.pricing.eligibleQuantity,12);assert.equal(result.pricing.rate,.05);
  assert.deepEqual(result.input.lineItems.map(line=>!!line.appliedDiscount),[true,true,false,false,true,true]);
  assert.equal(result.pricing.discountCents,900); // 5% of 12 x ($10 + $5), excluding the other 99.
});
test('extra print locations never increase garment qualification',async()=>{
  const source=item('a');source.prints.push({...source.prints[0],side:'back'});
  const result=await run([source],{a:{[garment]:11}});
  assert.equal(result.input.lineItems.length,3);assert.equal(result.pricing.eligibleQuantity,11);assert.equal(result.pricing.discountCents,0);
});
test('zero selections produce a valid empty quote without a Shopify calculation',async()=>{
  const result=await run([item('a')],{});assert.equal(result.pricing.checkoutSubtotalCents,0);assert.equal(result.calls.length,0);
});
test('Shopify-returned line rounding is authoritative instead of rounding the aggregate locally',async()=>{
  const source=item('a');source.variants[0].priceCents=597;
  const result=await run([source],{a:{[garment]:12}},{prices:{[garment]:'5.97'}});
  assert.equal(result.pricing.subtotalCents,13164);assert.equal(result.pricing.discountCents,658);assert.equal(result.pricing.checkoutSubtotalCents,12506);
});
test('price changes, missing eligibility and unsupported currency fail closed',async()=>{
  await assert.rejects(run([item('a')],{a:{[garment]:12}},{prices:{[garment]:'11.00'}}),error=>error.code==='PRICE_CHANGED');
  await assert.rejects(run([item('a')],{a:{[garment]:12}},{eligible:()=>undefined}),error=>error.code==='PRICE_UNAVAILABLE');
  await assert.rejects(run([item('a')],{a:{[garment]:12}},{currency:'CAD'}),error=>error.code==='CURRENCY_UNSUPPORTED');
  assert.throws(()=>preparedMoneyCents('5.971'));assert.throws(()=>preparedMoneyCents('-1.00'));
});
test('unexpected automatic discounts, mismatched totals and altered line quantities are rejected',async()=>{
  for(const mutate of [value=>value.platformDiscounts.push({title:'Old native tier'}),value=>value.totalDiscountsSet=fixtureMoney(999),value=>value.lineItems[0].quantity++]){
    const lines=buildPreparedCheckoutLines([item('a')],{a:{[garment]:12}},'order','snapshot').lines;
    await assert.rejects(calculatePreparedBulk({}, {graphql:async(_,query,variables)=>{const response=fixtureBulkResponse(query,variables);if(query.includes('Calculate'))mutate(response.data.draftOrderCalculate.calculatedDraftOrder);return response;}},lines,[item('a')]));
  }
});
test('created and recovered checkout totals must match the reviewed calculation',async()=>{
  const result=await run([item('a')],{a:{[garment]:12}}),draft=fixtureCalculated(result.input);
  verifyPreparedBulkTotals(draft,result.pricing);
  assert.throws(()=>verifyPreparedBulkTotals({...draft,subtotalPriceSet:fixtureMoney(1)},result.pricing),error=>error.code==='CHECKOUT_PRICE_CHANGED');
});
