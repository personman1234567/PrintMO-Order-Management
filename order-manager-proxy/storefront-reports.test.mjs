import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorefrontReportsService,storefrontReportPeriod,storefrontReportMoney,allocateReportCents} from './storefront-reports.mjs';
const PARTNER='gid://shopify/Metaobject/241830428920',COLLECTION='gid://shopify/Collection/481089487096';
const stamp='2026-11-11T18:00:00.000Z',money=(amount,currencyCode='USD')=>({shopMoney:{amount,currencyCode}});
const page=(nodes,hasNextPage=false,endCursor=null)=>({nodes,pageInfo:{hasNextPage,endCursor}});
const product=(id='p1',partner=PARTNER,collection=COLLECTION)=>({id,partnerReference:partner?{value:partner}:null,partnerCollection:collection?{value:collection}:null});
const line=(overrides={})=>({id:'l1',title:'Classic tee',variantTitle:'Black / L',sku:'TEE-L',quantity:3,currentQuantity:3,unfulfilledQuantity:1,originalTotalSet:money('60.00'),discountAllocations:[{allocatedAmountSet:money('10.00')}],product:product(),variant:{id:'v1'},...overrides});
const order=(overrides={})=>({id:'o1',name:'#1001',createdAt:'2026-11-05T18:00:00.000Z',updatedAt:'2026-11-06T18:00:00.000Z',cancelledAt:null,test:false,currencyCode:'USD',displayFinancialStatus:'PAID',lineItems:page([line()]),fulfillments:[{id:'f1',status:'SUCCESS'}],fulfillmentsCount:{count:1,precision:'EXACT'},refunds:[],...overrides});
const profile=(rates=[{productId:'p1',effectiveFrom:'2026-01-01',unitBaseCents:700,source:'Approved agreement v1',approved:true}])=>({version:'fixture-v1',owners:[{id:'dr-dallas',partnerId:PARTNER,collectionId:COLLECTION,rates}]});
function harness({orders=[order()],profiles=profile(),override,fulfillments,refunds}={}) {
  const calls=[];
  const graphql=async(query,vars,operation)=>{
    calls.push({query,vars,operation});assert.match(query,new RegExp(`^query ${operation}\\b`));assert.doesNotMatch(query,/\bmutation\b|customer\s*\{|shippingAddress|billingAddress|email|artwork|production_state|inventoryItem/);
    const changed=await override?.(operation,vars,calls);if(changed!==undefined)return changed;
    switch(operation) {
      case 'StorefrontReportHistoryAccess':return {data:{currentAppInstallation:{accessScopes:[{handle:'read_all_orders'}]}}};
      case 'StorefrontReportOwners':return {data:{collections:page([{id:COLLECTION,title:'Untrusted collection title',partnerReference:{value:PARTNER}}])}};
      case 'StorefrontReportBrand':return {data:{metaobject:{name:{value:'The Dr. Dallas Show'},logo:null}}};
      case 'StorefrontReportOrders':return {data:{orders:page(orders)}};
      case 'StorefrontReportFulfillment':return {data:{node:{id:vars.id,status:'SUCCESS',fulfillmentLineItems:page(fulfillments?.[vars.id]||[{id:'fl1',quantity:2,lineItem:{id:'l1'}}])}}};
      case 'StorefrontReportRefund':return {data:{node:{id:vars.id,refundLineItems:page(refunds?.[vars.id]||[])}}};
      case 'StorefrontReportRevalidate':return {data:{nodes:vars.ids.map(id=>{const found=orders.find(o=>o.id===id);return found?{id,updatedAt:found.updatedAt}:null;})}};
      default:throw new Error(`Unexpected operation ${operation}`);
    }
  };
  return {calls,service:createStorefrontReportsService({graphql,shopDomain:'fixture.myshopify.com',profiles,now:()=>new Date(stamp)})};
}
const generate=service=>service.generate({ownerId:'dr-dallas',start:'2026-11-01',end:'2026-11-11'});
test('Central inclusive calendar days become DST-aware half-open intervals',()=>{
  const march=storefrontReportPeriod({start:'2026-03-08',end:'2026-03-08'},new Date(stamp));assert.equal(march.startISO,'2026-03-08T06:00:00.000Z');assert.equal(march.endExclusiveISO,'2026-03-09T05:00:00.000Z');
  const november=storefrontReportPeriod({start:'2026-11-01',end:'2026-11-01'},new Date(stamp));assert.equal(november.startISO,'2026-11-01T05:00:00.000Z');assert.equal(november.endExclusiveISO,'2026-11-02T06:00:00.000Z');
  assert.equal(storefrontReportPeriod({start:'2026-11-11',end:'2026-11-11'},new Date(stamp)).endExclusiveISO,stamp);
  for(const period of [{start:'2026-02-30',end:'2026-03-01'},{start:'2026-11-12',end:'2026-11-12'},{start:'2026-11-10',end:'2026-11-09'},{start:'2025-01-01',end:'2026-11-11'}])assert.throws(()=>storefrontReportPeriod(period,new Date(stamp)));
});
test('exact decimal money and largest remainder allocations reconcile',()=>{
  assert.equal(storefrontReportMoney(money('50000000.01')),5000000001n);assert.deepEqual(allocateReportCents(5000n,[2,1]),[3333n,1667n]);
  for(const bag of [undefined,money('1.234'),money('NaN'),money('2.00','CAD'),money(2)])assert.throws(()=>storefrontReportMoney(bag));
});
test('paid discounted partially fulfilled line produces exact split and unique order counts',async()=>{
  const {service,calls}=harness(),result=await generate(service);assert.equal(result.status,'complete');assert.deepEqual(result.orders.map(r=>[r.quantity,r.salesCents,r.baseCents,r.earningsCents,r.status]),[[2,3333,1400,1933,'fulfilled'],[1,1667,700,967,'pending']]);
  assert.equal(result.totals.salesCents,5000);assert.equal(result.totals.earningsCents,2900);assert.equal(result.totals.orderCount,1);assert.equal(result.totals.fulfilledOrders,1);assert.equal(result.totals.pendingOrders,1);assert.equal(result.totals.itemCount,3);assert.equal(result.products[0].salesCents,5000);
  const query=calls.find(c=>c.operation==='StorefrontReportOrders').vars.query;assert.match(query,/created_at:>='2026-11-01T05:00:00.000Z'/);assert.match(query,/created_at:<'2026-11-11T18:00:00.000Z'/);assert.doesNotMatch(query,/product_id|collection_id/);
});
test('mixed owner orders use explicit product references rather than title or collection discovery membership',async()=>{
  const other=line({id:'l2',title:'Classic tee',product:product('p2','gid://shopify/Metaobject/999','gid://shopify/Collection/888')});
  const {service}=harness({orders:[order({lineItems:page([line(),other])})]});const result=await generate(service);assert.equal(result.totals.itemCount,3);assert.equal(result.exceptions.length,0);
});
test('missing approved rates retain actual sales and null all dependent financial amounts',async()=>{
  const {service}=harness({profiles:profile([])}),result=await generate(service);assert.equal(result.status,'needs-review');assert.equal(result.totals.salesCents,5000);assert.equal(result.totals.baseCents,null);assert.equal(result.totals.earningsCents,null);assert.equal(result.completeness.financialComplete,false);assert.equal(result.totals.knownEarningsCents,0);assert.ok(result.exceptions.some(e=>e.code==='RATE_MISSING'));
});
test('variant rates override product rate and overlapping equally specific rates require review',async()=>{
  const rates=[...profile().owners[0].rates,{variantId:'v1',productId:'p1',effectiveFrom:'2026-01-01',unitBaseCents:800,source:'Approved variant',approved:true}];
  assert.equal((await generate(harness({profiles:profile(rates)}).service)).totals.baseCents,2400);
  const result=await generate(harness({profiles:profile([...rates,{...rates[1],unitBaseCents:900}])}).service);assert.equal(result.totals.baseCents,null);assert.ok(result.exceptions.some(e=>e.code==='RATE_CONFLICT'));
});
test('successful empty period is a complete zero-activity report without requiring a rate',async()=>{
  const {service}=harness({orders:[],profiles:profile([])}),result=await generate(service);assert.equal(result.status,'complete');assert.equal(result.noActivity,true);assert.equal(result.totals.salesCents,0);assert.equal(result.orders.length,0);
});
test('unpaid and partially paid orders do not produce collected merchandise or earnings',async()=>{
  for(const displayFinancialStatus of ['PENDING','PARTIALLY_PAID','AUTHORIZED']) {
    const result=await generate(harness({orders:[order({displayFinancialStatus})]}).service);assert.equal(result.totals.salesCents,null);assert.equal(result.totals.baseCents,null);assert.equal(result.totals.earningsCents,null);assert.ok(result.exceptions.some(e=>e.code==='PAYMENT_PENDING'));
  }
});
test('cancelled and test orders are excluded from all amounts and unique order counts',async()=>{
  const result=await generate(harness({orders:[order({test:true}),order({id:'o2',cancelledAt:stamp})]}).service);assert.equal(result.totals.orderCount,0);assert.equal(result.exclusions.testOrders,1);assert.equal(result.exclusions.cancelledOrders,1);assert.equal(result.totals.salesCents,0);
});
test('refund merchandise subtotal is excluded, but unknown cost reversal never invents earnings',async()=>{
  const result=await generate(harness({orders:[order({displayFinancialStatus:'PARTIALLY_REFUNDED',lineItems:page([line({currentQuantity:2,unfulfilledQuantity:0})]),refunds:[{id:'r1'}]})],refunds:{r1:[{quantity:1,subtotalSet:money('16.67'),lineItem:{id:'l1'}}]}}).service);
  assert.equal(result.totals.salesCents,3333);assert.equal(result.totals.baseCents,null);assert.equal(result.totals.earningsCents,null);assert.ok(result.exceptions.some(e=>e.code==='REFUND_COST_POLICY_UNKNOWN'));
});
test('missing nested refund evidence is review, not zero refund or false earned amount',async()=>{
  const result=await generate(harness({orders:[order({refunds:[{id:'r1'}]})],override:(op)=>op==='StorefrontReportRefund'?{data:{node:null}}:undefined}).service);assert.equal(result.status,'needs-review');assert.equal(result.totals.salesCents,null);assert.equal(result.completeness.complete,false);assert.ok(result.exceptions.some(e=>e.code==='NESTED_EVIDENCE_INCOMPLETE'));
});
test('missing money is unknown, never coerced into zero',async()=>{
  const result=await generate(harness({orders:[order({lineItems:page([line({originalTotalSet:null})])})]}).service);assert.equal(result.totals.salesCents,null);assert.equal(result.totals.earningsCents,null);assert.ok(result.exceptions.some(e=>e.code==='MONEY_UNKNOWN'));
});
test('deleted or conflicting product ownership cannot produce misleading zero-activity',async()=>{
  for(const p of [product('p1',PARTNER,'gid://shopify/Collection/888')]) {
    const result=await generate(harness({orders:[order({lineItems:page([line({product:p})])})]}).service);assert.equal(result.status,'needs-review');assert.equal(result.noActivity,false);assert.equal(result.totals.salesCents,null);assert.equal(result.completeness.complete,false);
  }
});
test('order and nested cursor failures fail rather than label a truncated read zero',async()=>{
  const {service}=harness({orders:[],override:op=>op==='StorefrontReportOrders'?{data:{orders:page([],true,null)}}:undefined});await assert.rejects(generate(service),{code:'REPORT_CURSOR_INVALID'});
  const nested=harness({orders:[order({lineItems:page([line()],true,'c1')})],override:op=>op==='StorefrontReportLines'?{data:{order:{lineItems:page([line({id:'l2'})],true,'c1')}}}:undefined});await assert.rejects(generate(nested.service),{code:'REPORT_CURSOR_INVALID'});
});
test('all nested line and fulfillment pages are read before financial completion',async()=>{
  const extra=line({id:'l2',quantity:1,currentQuantity:1,unfulfilledQuantity:0,originalTotalSet:money('20.00'),discountAllocations:[]});
  const {service,calls}=harness({orders:[order({lineItems:page([line()],true,'line-next')})],override:(op,vars)=>{
    if(op==='StorefrontReportLines')return {data:{order:{id:'o1',lineItems:page([extra])}}};
    if(op==='StorefrontReportFulfillment')return {data:{node:{fulfillmentLineItems:vars.after?page([{id:'fl2',quantity:1,lineItem:{id:'l2'}}]):page([{id:'fl1',quantity:2,lineItem:{id:'l1'}}],true,'fulfillment-next')}}};
  }});
  const result=await generate(service);assert.equal(result.status,'complete');assert.equal(result.totals.itemCount,4);assert.equal(result.totals.salesCents,7000);assert.equal(result.totals.orderCount,1);assert.equal(calls.filter(c=>c.operation==='StorefrontReportFulfillment').length,2);
});
test('updatedAt revalidation flags drift without retry loops or invented atomicity',async()=>{
  const result=await generate(harness({override:op=>op==='StorefrontReportRevalidate'?{data:{nodes:[{id:'o1',updatedAt:stamp}]}}:undefined}).service);assert.equal(result.completeness.complete,false);assert.equal(result.status,'needs-review');assert.ok(result.exceptions.some(e=>e.code==='SOURCE_DRIFT'));
});
test('missing app access, search warnings, and incomplete page contracts fail explicitly',async()=>{
  for(const response of [{errors:[{message:'Access denied'}]},{data:{orders:{nodes:[]}}},{data:{orders:page([])},extensions:{search:[{warnings:[{code:'INVALID_SEARCH_FIELD'}]}]}}]) {
    await assert.rejects(generate(harness({override:op=>op==='StorefrontReportOrders'?response:undefined}).service));
  }
});
test('owner lookup uses explicit collection partner and configured safe branding fallback',async()=>{
  const {service}=harness({override:op=>op==='StorefrontReportBrand'?{errors:[{message:'not allowed'}]}:undefined});const owners=await service.owners();assert.equal(owners.length,1);assert.equal(owners[0].id,'dr-dallas');assert.equal(owners[0].logoUrl,'./report-assets/dr-dallas-logo.png');assert.ok(owners[0].capabilityWarnings.length);
  const invalid=harness({override:op=>op==='StorefrontReportOwners'?{data:{collections:page([{id:COLLECTION,title:'Dr. Dallas',partnerReference:null}])}}:undefined});await assert.rejects(invalid.service.owners(),{code:'REPORT_OWNER_UNVERIFIED'});
});
test('more than 500 cohort orders fails; unsupported owner rejected before Shopify calls',async()=>{
  let counter=0;const big=harness({override:op=>op==='StorefrontReportOrders'?{data:{orders:page(Array.from({length:25},()=>order({id:`o${++counter}`,test:true})),true,`page-${counter}`)}}:undefined});await assert.rejects(generate(big.service),{code:'REPORT_ORDER_LIMIT'});
  const small=harness();await assert.rejects(small.service.generate({ownerId:'sample-owner',start:'2026-11-01',end:'2026-11-11'}),{code:'REPORT_OWNER_INVALID'});assert.equal(small.calls.length,0);
});
test('refunded payment state without refund records is incomplete instead of gross sales',async()=>{
  const result=await generate(harness({orders:[order({displayFinancialStatus:'PARTIALLY_REFUNDED'})]}).service);assert.equal(result.totals.salesCents,null);assert.equal(result.completeness.complete,false);assert.ok(result.exceptions.some(e=>e.code==='ORDER_EVIDENCE_INCOMPLETE'));
});
test('current edited quantities never use original gross without a reviewed adjustment',async()=>{
  const result=await generate(harness({orders:[order({lineItems:page([line({currentQuantity:2,unfulfilledQuantity:0})])})]}).service);assert.equal(result.totals.salesCents,null);assert.ok(result.exceptions.some(e=>e.code==='ORDER_EDIT_REVIEW'));
});
test('bounded Shopify-call budget terminates excessive nested work without false completion',async()=>{
  const fulfillments=Array.from({length:100},(_,i)=>({id:`f${i}`,status:'SUCCESS'}));let counter=0;
  const {service}=harness({orders:[order({fulfillments,fulfillmentsCount:{count:100,precision:'EXACT'},refunds:Array.from({length:100},(_,i)=>({id:`r${i}`}))})],override:(op)=>{
    if(op==='StorefrontReportFulfillment')return {data:{node:{fulfillmentLineItems:page([])}}};
    if(op==='StorefrontReportRefund'){counter++;return {data:{node:{refundLineItems:page([{quantity:0,subtotalSet:money('0.00'),lineItem:{id:'l1'}}])}}};}
  }});await assert.rejects(generate(service),{code:'REPORT_BUDGET_EXCEEDED'});assert.ok(counter<100);
});
test('brand URLs on unapproved hosts fall back and no future owner silently enables',async()=>{
  const {service}=harness({profiles:{owners:[...profile().owners,{id:'future-owner',partnerId:'foreign',collectionId:'foreign'}]},override:op=>op==='StorefrontReportBrand'?{data:{metaobject:{name:{value:'Partner'},logo:{reference:{image:{url:'https://untrusted.example/logo.png'}}}}}}:undefined});assert.deepEqual((await service.owners()).map(owner=>owner.id),['dr-dallas']);assert.equal((await service.owners())[0].logoUrl,'./report-assets/dr-dallas-logo.png');
});
test('ordinary unlinked products are count-only exclusions from the linked owner report',async()=>{
  const ordinary=line({id:'ordinary',title:'PRIVATE UNRELATED PRODUCT',product:product('ordinary',null,null)});
  const result=await generate(harness({orders:[order({lineItems:page([line(),ordinary])})]}).service);
  assert.equal(result.status,'complete');assert.equal(result.completeness.complete,true);assert.equal(result.totals.salesCents,5000);assert.equal(result.totals.itemCount,3);assert.equal(result.exclusions.unlinkedProductLines,1);assert.equal(result.attributionBasis,'linked-product-partner-reference');assert.equal(result.exceptions.length,0);assert.doesNotMatch(JSON.stringify(result),/PRIVATE UNRELATED PRODUCT/);
  const onlyOrdinary=await generate(harness({orders:[order({name:'#UNRELATED',lineItems:page([ordinary])})]}).service);assert.equal(onlyOrdinary.status,'complete');assert.equal(onlyOrdinary.noActivity,true);assert.equal(onlyOrdinary.totals.salesCents,0);assert.equal(onlyOrdinary.exclusions.unlinkedProductLines,1);assert.doesNotMatch(JSON.stringify(onlyOrdinary),/PRIVATE UNRELATED PRODUCT|#UNRELATED/);
});
test('unavailable products outside linked orders are count-only and do not invalidate verified earnings',async()=>{
  const unrelated=Array.from({length:4},(_,i)=>order({id:`unknown-order-${i}`,name:`#PRIVATE-${i}`,lineItems:page(Array.from({length:20},(_,j)=>line({id:`unknown-${i}-${j}`,title:`PRIVATE TITLE ${i} ${j}`,product:null})))}));
  const result=await generate(harness({orders:[order(),...unrelated]}).service);
  assert.equal(result.status,'complete');assert.equal(result.completeness.complete,true);assert.equal(result.totals.salesCents,5000);assert.equal(result.totals.baseCents,2100);assert.equal(result.totals.earningsCents,2900);assert.equal(result.totals.knownSalesCents,5000);assert.equal(result.exclusions.unattributedProductLines,80);assert.equal(result.exceptions.length,0);assert.ok(result.coverageWarnings.length);assert.doesNotMatch(JSON.stringify(result),/PRIVATE TITLE|#PRIVATE/);assert.equal(result.noActivity,false);
});
test('unknown lines within linked storefront orders remain one privacy-safe review exception',async()=>{
  const unknown=Array.from({length:20},(_,j)=>line({id:`unknown-${j}`,title:`PRIVATE TITLE ${j}`,product:null}));
  const result=await generate(harness({orders:[order({lineItems:page([line(),...unknown])})]}).service);
  assert.equal(result.status,'needs-review');assert.equal(result.completeness.complete,false);assert.equal(result.totals.salesCents,null);assert.equal(result.totals.baseCents,null);assert.equal(result.totals.earningsCents,null);assert.equal(result.totals.knownSalesCents,5000);assert.equal(result.totals.knownBaseCents,2100);assert.equal(result.totals.knownEarningsCents,2900);
  const exceptions=result.exceptions.filter(e=>e.code==='ATTRIBUTION_UNKNOWN');assert.equal(exceptions.length,1);assert.match(exceptions[0].message,/20 order lines/);assert.equal(exceptions[0].product,undefined);assert.equal(exceptions[0].orderLabel,undefined);assert.doesNotMatch(JSON.stringify(result),/PRIVATE TITLE/);assert.equal(result.noActivity,false);
});
test('unrelated deleted or custom lines still allow a successful zero linked-activity report',async()=>{
  const result=await generate(harness({orders:[order({name:'#PRIVATE-UNKNOWN',lineItems:page([line({title:'PRIVATE CUSTOM PRODUCT',product:null})])})]}).service);assert.equal(result.status,'complete');assert.equal(result.noActivity,true);assert.equal(result.totals.salesCents,0);assert.equal(result.exclusions.unattributedProductLines,1);assert.equal(result.exceptions.length,0);assert.ok(result.coverageWarnings.length);assert.doesNotMatch(JSON.stringify(result),/#PRIVATE-UNKNOWN|PRIVATE CUSTOM PRODUCT/);
});
test('known sales retain only verified paid amounts when another linked line has missing money',async()=>{
  const missing=line({id:'missing-money',title:'Known product missing amount',quantity:1,currentQuantity:1,unfulfilledQuantity:1,originalTotalSet:null});
  const result=await generate(harness({orders:[order({lineItems:page([line(),missing])})]}).service);assert.equal(result.totals.salesCents,null);assert.equal(result.totals.knownSalesCents,5000);assert.equal(result.totals.knownBaseCents,2100);assert.equal(result.totals.knownEarningsCents,2900);
});
test('source drift outside linked orders stays generic without leaking unrelated order labels',async()=>{
  const other=order({id:'other-order',name:'#PRIVATE-DRIFT',lineItems:page([line({product:product('ordinary',null,null)})])});
  const result=await generate(harness({orders:[order(),other],override:(op,vars)=>op==='StorefrontReportRevalidate'?{data:{nodes:vars.ids.map(id=>({id,updatedAt:id==='o1'?'2026-11-06T18:00:00.000Z':stamp}))}}:undefined}).service);assert.equal(result.completeness.complete,true);assert.equal(result.status,'complete');assert.equal(result.exclusions.unlinkedChangedOrders,1);assert.equal(result.exceptions.length,0);assert.ok(result.coverageWarnings.length);assert.doesNotMatch(JSON.stringify(result),/#PRIVATE-DRIFT/);
});
const BLANK='gid://shopify/Product/123';
const opts=(color='Black',size='L')=>[{name:'Color',value:color},{name:'Size',value:size}];
const blankVariant=(overrides={})=>({id:'bv1',sku:'TEE-L',price:'7.25',selectedOptions:opts(),...overrides});
const catalogProfile=(overrides={})=>({...profile([]),catalogPricing:{approved:true,source:'Owner approved normal catalog price already includes printing',printingCents:0,productLinks:{p1:BLANK},...overrides}});
function catalogHarness({variants=[blankVariant()],config={},orders,override,profiles}={}) {
  return harness({orders:orders||[order({lineItems:page([line({variant:{id:'v1',selectedOptions:opts()}})])})],profiles:profiles||catalogProfile(config),override:async(op,vars,calls)=>{
    const response=await override?.(op,vars,calls);if(response!==undefined)return response;
    if(op==='StorefrontReportCatalogVariants')return {data:{shop:{currencyCode:'USD'},product:{id:BLANK,variants:page(variants)}}};
  }});
}
test('approved zero printing uses exact unique linked SKU catalog price once and captures evidence',async()=>{
  const {service,calls}=catalogHarness(),result=await generate(service);
  assert.equal(result.status,'complete');assert.equal(result.totals.baseCents,2175);assert.equal(result.totals.earningsCents,2825);assert.equal(result.fulfillmentRateBasis,'current-catalog-price');assert.equal(result.pricingRetrievedAt,stamp);assert.equal(result.rateEvidence.length,1);
  assert.equal(result.rateEvidence[0].match,'exact-sku');assert.equal(result.rateEvidence[0].blankProductId,BLANK);assert.equal(result.rateEvidence[0].catalogPriceCents,725);assert.equal(result.rateEvidence[0].printingCents,0);assert.equal(result.rateEvidence[0].effectiveBasis,'current-catalog-at-generation');assert.match(result.orders[0].rateSource,/current normal catalog price/);assert.equal(calls.filter(c=>c.operation==='StorefrontReportCatalogVariants').length,1);
  const query=calls.find(c=>c.operation==='StorefrontReportCatalogVariants').query;assert.match(query,/variants\(first:50,after:\$after\)/);assert.match(query,/shop \{ currencyCode \}/);assert.doesNotMatch(query,/inventory|unitCost|products\(/);
  assert.match(calls.find(c=>c.operation==='StorefrontReportOrders').query,/variant \{ id selectedOptions \{ name value \} \}/);
});
test('removed historical SKU uses uniform current non-color option prices without guessing color',async()=>{
  const variants=[blankVariant({sku:'NEW-NAVY-L',selectedOptions:opts('Navy')}),blankVariant({id:'bv2',sku:'NEW-WHITE-L',selectedOptions:opts('White'),price:'7.25'}),blankVariant({id:'bv3',sku:'NEW-BLACK-XL',selectedOptions:opts('Black','XL'),price:'9.00'})];
  const result=await generate(catalogHarness({variants}).service);assert.equal(result.status,'complete');assert.equal(result.totals.baseCents,2175);assert.equal(result.rateEvidence[0].match,'uniform-non-color-options');assert.deepEqual(result.rateEvidence[0].matchedVariantIds,['bv1','bv2']);
});
test('different prices among matching sizes and duplicate exact SKUs never pick a price',async()=>{
  for(const variants of [[blankVariant({sku:'NEW-NAVY-L',selectedOptions:opts('Navy')}),blankVariant({id:'bv2',sku:'NEW-WHITE-L',selectedOptions:opts('White'),price:'8.00'})],[blankVariant(),blankVariant({id:'bv2',price:'7.25'})]]) {
    const result=await generate(catalogHarness({variants}).service);assert.equal(result.status,'needs-review');assert.equal(result.totals.baseCents,null);assert.equal(result.totals.earningsCents,null);assert.equal(result.totals.salesCents,5000);assert.ok(result.exceptions.some(e=>e.code==='RATE_CATALOG_AMBIGUOUS'));assert.equal(result.rateEvidence.length,0);
  }
});
test('printing must be explicitly approved including zero; missing values do not default to zero',async()=>{
  for(const config of [{printingCents:undefined},{printingCents:null},{printingCents:-1},{printingCents:0.5},{approved:false},{source:''}]) {
    const {service,calls}=catalogHarness({config}),result=await generate(service);assert.equal(result.totals.baseCents,null);assert.ok(result.exceptions.some(e=>e.code==='RATE_MISSING'));assert.equal(calls.filter(c=>c.operation==='StorefrontReportCatalogVariants').length,0);
  }
  const result=await generate(catalogHarness({config:{printingCents:150}}).service);assert.equal(result.totals.baseCents,2625);assert.equal(result.fulfillmentRateBasis,'current-catalog-plus-printing');
});
test('missing normal catalog price, non-USD shop, missing link, and missing option evidence stay unknown',async()=>{
  for(const price of [null,undefined,'NaN','7.255','-1.00']) {const result=await generate(catalogHarness({variants:[blankVariant({price})]}).service);assert.equal(result.totals.baseCents,null);assert.equal(result.status,'needs-review');}
  const noCurrency=catalogHarness({override:op=>op==='StorefrontReportCatalogVariants'?{data:{shop:{currencyCode:'CAD'},product:{id:BLANK,variants:page([blankVariant()])}}}:undefined});assert.equal((await generate(noCurrency.service)).totals.baseCents,null);
  const noLink=catalogHarness({config:{productLinks:{}}});assert.equal((await generate(noLink.service)).totals.baseCents,null);assert.equal(noLink.calls.filter(c=>c.operation==='StorefrontReportCatalogVariants').length,0);
  const noOptions=catalogHarness({orders:[order()],variants:[blankVariant({sku:'NEW-L'})]});assert.equal((await generate(noOptions.service)).totals.baseCents,null);
});
test('all catalog variant pages are consumed before declaring exact SKU unique',async()=>{
  const {service,calls}=catalogHarness({override:(op,vars)=>{
    if(op==='StorefrontReportCatalogVariants')return {data:{shop:{currencyCode:'USD'},product:{id:BLANK,variants:vars.after?page([blankVariant()]):page([blankVariant({id:'early',sku:'ANOTHER'})],true,'catalog-next')}}};
  }});const result=await generate(service);assert.equal(result.status,'complete');assert.equal(result.totals.baseCents,2175);assert.equal(calls.filter(c=>c.operation==='StorefrontReportCatalogVariants').length,2);
});
test('catalog cursor loops and over-limit variant counts fail explicitly',async()=>{
  const looping=catalogHarness({override:op=>op==='StorefrontReportCatalogVariants'?{data:{shop:{currencyCode:'USD'},product:{id:BLANK,variants:page([blankVariant()],true,'same')}}}:undefined});await assert.rejects(generate(looping.service),{code:'REPORT_CURSOR_INVALID'});
  const tooMany=catalogHarness({variants:Array.from({length:2501},(_,i)=>blankVariant({id:`v${i}`,sku:`s${i}`}))});await assert.rejects(generate(tooMany.service),{code:'REPORT_NESTED_LIMIT'});
});
test('catalog variants consume the same 150-call generation budget',async()=>{
  let counter=0;const excessive=catalogHarness({override:op=>op==='StorefrontReportCatalogVariants'?{data:{shop:{currencyCode:'USD'},product:{id:BLANK,variants:page([blankVariant({id:`v${++counter}`,sku:`sku${counter}`})],true,`cursor${counter}`)}}}:undefined});await assert.rejects(generate(excessive.service),{code:'REPORT_BUDGET_EXCEEDED'});assert.ok(counter<150);
});
test('effective explicit rates keep precedence without extra catalog reads or overridden conflicts',async()=>{
  const profiles=catalogProfile();profiles.owners=profile().owners;const {service,calls}=catalogHarness({profiles});const result=await generate(service);assert.equal(result.totals.baseCents,2100);assert.equal(calls.filter(c=>c.operation==='StorefrontReportCatalogVariants').length,0);assert.equal(result.rateEvidence.length,0);
  profiles.owners=profile([...profile().owners[0].rates,...profile().owners[0].rates]).owners;const conflict=catalogHarness({profiles});const conflicting=await generate(conflict.service);assert.equal(conflicting.totals.baseCents,null);assert.ok(conflicting.exceptions.some(e=>e.code==='RATE_CONFLICT'));assert.equal(conflict.calls.filter(c=>c.operation==='StorefrontReportCatalogVariants').length,0);
});
test('changed SKU resolves exact full Color and Size tuple before unlike color prices',async()=>{
  const variants=[blankVariant({sku:'CURRENT-BLACK-L',price:'7.25'}),blankVariant({id:'white',sku:'CURRENT-WHITE-L',selectedOptions:opts('White'),price:'8.50'})];
  const result=await generate(catalogHarness({variants}).service);assert.equal(result.status,'complete');assert.equal(result.totals.baseCents,2175);assert.equal(result.rateEvidence[0].match,'exact-options');assert.deepEqual(result.rateEvidence[0].matchedVariantIds,['bv1']);
});
test('duplicate exact structured option tuples require review even if current SKU differs',async()=>{
  const variants=[blankVariant({sku:'CURRENT-A'}),blankVariant({id:'duplicate',sku:'CURRENT-B',price:'8.00'})];
  const result=await generate(catalogHarness({variants}).service);assert.equal(result.status,'needs-review');assert.equal(result.totals.baseCents,null);assert.ok(result.exceptions.some(e=>e.code==='RATE_CATALOG_AMBIGUOUS'));assert.equal(result.rateEvidence.length,0);
});

test('explicit additional owners are isolated, have their own logo fallback and can report zero activity',async()=>{
 const id='storefront-test-owner',partner='gid://shopify/Metaobject/700',collection='gid://shopify/Collection/701';
 const profiles={owners:[{id,enabled:true,name:'Second owner',partnerId:partner,collectionId:collection,logoUrl:'https://cdn.shopify.com/second-owner.png',rates:[]}]};
 const {service}=harness({orders:[],profiles,override:op=>op==='StorefrontReportOwners'?{data:{collections:page([{id:COLLECTION,partnerReference:{value:'gid://shopify/Metaobject/999'}},{id:collection,partnerReference:{value:partner}}])}}:op==='StorefrontReportBrand'?{errors:[{message:'Unavailable'}]}:undefined});
 const owners=await service.owners();assert.equal(owners.length,1);assert.equal(owners[0].id,id);assert.equal(owners[0].logoUrl,profiles.owners[0].logoUrl);
 const result=await service.generate({ownerId:id,start:'2026-11-01',end:'2026-11-11'});assert.equal(result.noActivity,true);assert.equal(result.totals.earningsCents,0);assert.equal(result.owner.id,id);
 await assert.rejects(service.generate({ownerId:'dr-dallas',start:'2026-11-01',end:'2026-11-11'}),{code:'REPORT_OWNER_UNVERIFIED'});
});
test('duplicate configured owner identities are rejected instead of mixing storefronts',()=>{
 const owners=[1,2].map(n=>({id:'storefront-owner-'+n,enabled:true,name:'Owner',partnerId:'gid://shopify/Metaobject/700',collectionId:'gid://shopify/Collection/'+(701+n)}));
 assert.throws(()=>harness({profiles:{owners}}),{code:'REPORT_OWNER_CONFIG_INVALID'});
});


test('all time reads without a lower date bound and resolves the complete Central-time history',async()=>{
 const old=order({createdAt:'2024-01-01T03:00:00.000Z'}),{service,calls}=harness({orders:[old],profiles:profile([{productId:'p1',effectiveFrom:'2020-01-01',unitBaseCents:700,source:'Fixture agreement',approved:true}])});
 const result=await service.generate({ownerId:'dr-dallas',preset:'all-time',start:'2026-11-01',end:'2026-11-02'});
 assert.equal(result.period.preset,'all-time');assert.equal(result.period.start,'2023-12-31');assert.equal(result.period.end,'2026-11-11');assert.equal(result.period.endExclusiveISO,stamp);assert.equal(result.status,'complete');assert.equal(result.totals.earningsCents,2900);
 const query=calls.find(c=>c.operation==='StorefrontReportOrders').vars.query;assert.doesNotMatch(query,/created_at:>=/);assert.match(query,/created_at:</);assert(calls.some(c=>c.operation==='StorefrontReportHistoryAccess'));assert.throws(()=>storefrontReportPeriod({start:'2023-12-31',end:'2026-11-11'},new Date(stamp)),{code:'REPORT_PERIOD_TOO_LONG'});
});
test('all time refuses limited history access instead of silently reporting sixty days',async()=>{const {service,calls}=harness({override:op=>op==='StorefrontReportHistoryAccess'?{data:{currentAppInstallation:{accessScopes:[{handle:'read_orders'}]}}}:undefined});await assert.rejects(service.generate({ownerId:'dr-dallas',preset:'all-time'}),{code:'REPORT_HISTORY_ACCESS_REQUIRED',status:403});assert(!calls.some(c=>c.operation==='StorefrontReportOrders'));});
test('all time empty history is a successful dated zero, not a failed or missing read',async()=>{const {service}=harness({orders:[]});const result=await service.generate({ownerId:'dr-dallas',preset:'all-time'});assert.equal(result.noActivity,true);assert.equal(result.period.start,'2026-11-11');assert.equal(result.period.end,'2026-11-11');assert.equal(result.totals.earningsCents,0);});
test('all time paginates beyond the ordinary 500-order range while retaining bounded enumeration',async()=>{const source=Array.from({length:601},(_,i)=>order({id:'other-'+i,name:'#'+i,createdAt:'2024-01-02T12:00:00.000Z',lineItems:page([line({id:'line-'+i,product:product('ordinary',null,null)})])}));const {service,calls}=harness({orders:source,override:(op,v)=>{if(op!=='StorefrontReportOrders')return;const offset=Number(v.after||0),next=offset+25;return{data:{orders:page(source.slice(offset,next),next<source.length,next<source.length?String(next):null)}};}});const result=await service.generate({ownerId:'dr-dallas',preset:'all-time'});assert.equal(result.noActivity,true);assert.equal(result.exclusions.unlinkedProductLines,601);assert.equal(calls.filter(c=>c.operation==='StorefrontReportOrders').length,25);});

test('saved garment plus print rates preserve earlier same-day prices, split quantities, and block missing prices',async()=>{const cutoff='2026-11-05T18:00:00.000Z',pricing={schema:1,productId:'p1',partnerId:PARTNER,collectionId:COLLECTION,legacy:{before:cutoff,variants:[{variantId:'v1',sku:'TEE-L',unitBaseCents:700}]},versions:[{id:'approved-v1',effectiveFrom:cutoff,printType:'chest',variants:[{variantId:'v1',sku:'TEE-L',blankCents:700,printingCents:500,unitBaseCents:1200}]}]};for(const[createdAt,base]of[['2026-11-05T17:59:59.999Z',2100],[cutoff,3600]]){const row=line();row.product.fulfillmentPricing={value:JSON.stringify(pricing)};const h=harness({orders:[order({createdAt,lineItems:page([row])})],profiles:profile([])}),r=await generate(h.service);assert.equal(r.status,'complete');assert.equal(r.totals.baseCents,base);assert.equal(r.orders[0].pricingVersion,base===2100?'legacy-before-'+cutoff:'approved-v1');assert.equal(r.totals.salesCents,5000);}const row=line({variant:{id:'unknown'},sku:'unknown'});row.product.fulfillmentPricing={value:JSON.stringify(pricing)};const r=await generate(harness({orders:[order({lineItems:page([row])})],profiles:profile([])}).service);assert.equal(r.status,'needs-review');assert.equal(r.totals.baseCents,null);});
