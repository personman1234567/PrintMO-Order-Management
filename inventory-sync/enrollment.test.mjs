import test from 'node:test';
import assert from 'node:assert/strict';
import {enrollBatch,validateVariants,SUPPLIER,HQ,SHOP} from './enrollment.mjs';
import {checkScope,parseLiveEntries} from './enroll-cli.mjs';
import {isUniqueSellableSku} from './clients.mjs';
const productId='gid://shopify/Product/100';
const levels=(id,a=0,c=0)=>({isActive:true,location:{id},quantities:[{name:'available',quantity:a},{name:'committed',quantity:c},{name:'on_hand',quantity:a+c}]});
function fixture({tracked=false,available=0,committed=0,missing=false,failSeed=false,race=false,draftCopy=null,oversell=false}={}){
 const variant={id:'gid://shopify/ProductVariant/100',sku:'B123',inventoryPolicy:'DENY',availableForSale:true,sellableOnlineQuantity:0,product:{id:productId,status:'ACTIVE'},inventoryItem:{id:'gid://shopify/InventoryItem/100',tracked,duplicateSkuCount:0,inventoryLevels:{nodes:[levels(HQ),...(tracked?[levels(SUPPLIER,available,committed)]:[])],pageInfo:{hasNextPage:false}}}};
 if(oversell)variant.inventoryPolicy="CONTINUE";
 const env={SHOPIFY_SHOP_DOMAIN:SHOP,SHOPIFY_ACCESS_TOKEN:'test',SUPPLIER_LOCATION_ID:SUPPLIER,PROTECTED_LOCATION_IDS:JSON.stringify([HQ]),SS_SAFETY_BUFFER:'0',SUPPLIER_INVENTORY_URL:'https://example.com/order-manager/v1/supplier/ss/inventory',INVENTORY_READ_KEY:'test'};
 const requests=[];
 const deps={fetchImpl:async(url,options)=>{
  if(String(url).includes('/supplier/ss/inventory'))return Response.json({observedAt:new Date().toISOString(),items:missing?[]:[{sku:'B123',warehouses:[{warehouseAbbr:'TX',qty:40,dropship:false},{warehouseAbbr:'DS',qty:999,dropship:true}]}]});
  const {query,variables}=JSON.parse(options.body);requests.push({query,variables});
  if(query.includes('VerifyDraftSkuDuplicates'))return Response.json({data:{sku0:{nodes:[structuredClone(variant),structuredClone(draftCopy)],pageInfo:{hasNextPage:false}}}});
  if(query.startsWith('query'))return Response.json({data:{nodes:[structuredClone(variant)],location:{id:SUPPLIER,isActive:true,fulfillsOnlineOrders:true},currentAppInstallation:{accessScopes:[{handle:'write_inventory'},{handle:'write_products'}]}}});
  if(query.includes('DisableInventoryOverselling')){variant.inventoryPolicy='DENY';return Response.json({data:{productVariantsBulkUpdate:{productVariants:[{id:variant.id,inventoryPolicy:'DENY'}],userErrors:[]}}});}
  if(query.includes('ActivateSupplierLevels')){variant.inventoryItem.inventoryLevels.nodes.push(levels(SUPPLIER));return Response.json({data:{a0:{inventoryLevel:{id:'level'},userErrors:[]}}});}
  if(query.includes('RestoreTracking')){variant.inventoryItem.tracked=false;return Response.json({data:{inventoryItemUpdate:{inventoryItem:{tracked:false},userErrors:[]}}});}
  const data={};if(query.includes('track0:')){variant.inventoryItem.tracked=true;data.track0={inventoryItem:{id:variant.inventoryItem.id,tracked:true},userErrors:[]};}
  const level=variant.inventoryItem.inventoryLevels.nodes.find(l=>l.location.id===SUPPLIER);
  if(race){level.quantities=levels(SUPPLIER,39,1).quantities;}
  const update=variables.input.quantities[0];
  const stale=update.changeFromQuantity!==level.quantities[0].quantity;
  if(!failSeed&&!stale)level.quantities=levels(SUPPLIER,update.quantity,committed).quantities;
  data.inventorySetQuantities={inventoryAdjustmentGroup:failSeed||stale?null:{id:'adjustment'},userErrors:failSeed?[{code:'OTHER'}]:stale?[{code:'CHANGE_FROM_QUANTITY_STALE'}]:[]};
  return Response.json({data});
 }};
 return {env,variant,deps,requests,input:{mode:'apply',productId,entries:[{id:variant.id,sku:variant.sku}]}};
}
test('enroll activates at zero then serially tracks and seeds physical-only quantities; HQ unchanged',async()=>{
 const f=fixture(),hq=structuredClone(f.variant.inventoryItem.inventoryLevels.nodes[0]);
 const result=await enrollBatch(f.env,f.input,f.deps);
 assert.equal(result.ready,true);assert.equal(result.rows[0].current,40);assert.equal(f.variant.inventoryItem.tracked,true);
 assert.deepEqual(f.variant.inventoryItem.inventoryLevels.nodes[0],hq);
 const op=f.requests.find(r=>r.query.includes('InitializeSupplierInventory'));
 assert.ok(op.query.indexOf('track0:')<op.query.indexOf('inventorySetQuantities'));
 assert.equal(op.variables.input.quantities[0].changeFromQuantity,0);
});
test('a repeated enrollment is a no-op and never blindly reseeds',async()=>{
 const f=fixture({tracked:true,available:40});const r=await enrollBatch(f.env,f.input,f.deps);
 assert.equal(r.writes,0);assert.equal(f.requests.filter(r=>r.query.startsWith('mutation')).length,0);
});
test('existing tracking subtracts commitments on reopen',async()=>{
 const f=fixture({tracked:true,available:20,committed:3});const r=await enrollBatch(f.env,f.input,f.deps);
 assert.equal(r.rows[0].current,37);
});
test('a missing source row stops before activation or tracking; never writes zero',async()=>{
 const f=fixture({missing:true});await assert.rejects(enrollBatch(f.env,f.input,f.deps),/SUPPLIER_SKU_MISSING_OR_UNKNOWN/);
 assert.equal(f.variant.inventoryItem.tracked,false);assert.equal(f.requests.filter(r=>r.query.startsWith('mutation')).length,0);
});
test('failed positive initialization restores new zero-stock tracking after requery',async()=>{
 const f=fixture({failSeed:true});await assert.rejects(enrollBatch(f.env,f.input,f.deps),/ENROLLMENT_WRITE_REJECTED/);
 assert.equal(f.variant.inventoryItem.tracked,false);
});
test('compare-and-set race preserves customer commitment and does not blindly retry or untrack',async()=>{
 const f=fixture({race:true});await assert.rejects(enrollBatch(f.env,f.input,f.deps),/SHOPIFY_QUANTITY_CHANGED/);
 assert.equal(f.variant.inventoryItem.tracked,true);assert.equal(f.variant.inventoryItem.inventoryLevels.nodes[1].quantities[1].quantity,1);
 assert.equal(f.requests.filter(r=>r.query.includes('InitializeSupplierInventory')).length,1);
});
test('catalog fast path rejects live duplicates and oversell without CSV scans',()=>{
 const f=fixture();f.variant.inventoryItem.duplicateSkuCount=1;assert.throws(()=>validateVariants([f.variant],productId),/SHARED_SUPPLIER_SKU/);
 f.variant.inventoryItem.duplicateSkuCount=0;f.variant.inventoryPolicy='CONTINUE';assert.throws(()=>validateVariants([f.variant],productId),/OVERSELL_POLICY/);
});
test('plan is read-only and protected-location stock produces a specific blocker',async()=>{
 const f=fixture();await enrollBatch(f.env,{...f.input,mode:'plan'},f.deps);
 assert.equal(f.requests.filter(r=>r.query.startsWith('mutation')).length,0);
 f.variant.inventoryItem.inventoryLevels.nodes[0]=levels(HQ,1);await assert.rejects(enrollBatch(f.env,f.input,f.deps),/OTHER_LOCATION_HAS_STOCK/);
 f.variant.inventoryItem.inventoryLevels.nodes[0]=levels(HQ,-1,1);f.variant.inventoryItem.tracked=true;assert.doesNotThrow(()=>validateVariants([f.variant],productId));
});
test('migration checks deployment drift and accepts more than 2000 variants',()=>{
 const entry={id:'gid://shopify/ProductVariant/1',sku:'B1',missingPolicy:'hold',cohort:'x'};
 assert.throws(()=>checkScope([entry],[],[]),/DEPLOYMENT_DRIFT/);
 const rows=Array.from({length:21000},(_,i)=>({...entry,id:entry.id+i,sku:'B'+i}));
 assert.equal(checkScope([],rows,[]).scheduled,21000);
 const source='var SCHEDULED_VARIANTS = Object.freeze([\n["gid://shopify/ProductVariant/1","B1","hold","x"]\n].map';
 assert.deepEqual(parseLiveEntries(source),[entry]);
});
test('overselling is planned read-only then automatically disabled before inventory setup',async()=>{
 const f=fixture({oversell:true});const plan=await enrollBatch(f.env,{...f.input,mode:'plan'},f.deps);
 assert.equal(plan.policyChanges,1);assert.equal(plan.ready,false);assert.equal(f.requests.filter(r=>r.query.startsWith('mutation')).length,0);
 const r=await enrollBatch(f.env,f.input,f.deps);assert.equal(r.ready,true);assert.equal(f.variant.inventoryPolicy,'DENY');
 assert.ok(f.requests.findIndex(r=>r.query.includes('DisableInventoryOverselling'))<f.requests.findIndex(r=>r.query.includes('ActivateSupplierLevels')));
 const missing=fixture({oversell:true,missing:true});await assert.rejects(enrollBatch(missing.env,missing.input,missing.deps),/SUPPLIER_SKU_MISSING_OR_UNKNOWN/);
 assert.equal(missing.variant.inventoryPolicy,'CONTINUE');
});
test('enrollment accepts a zero-commitment draft SKU copy and writes only the selected product',async()=>{
 const draft={id:'gid://shopify/ProductVariant/200',sku:'B123',product:{status:'DRAFT'},inventoryItem:{inventoryLevels:{nodes:[levels(HQ)],pageInfo:{hasNextPage:false}}}};
 const before=structuredClone(draft),f=fixture({draftCopy:draft});f.variant.inventoryItem.duplicateSkuCount=1;
 const r=await enrollBatch(f.env,f.input,f.deps);assert.equal(r.ready,true);assert.deepEqual(draft,before);
 const writes=f.requests.filter(r=>r.query.startsWith('mutation'));
 assert.ok(writes.length);assert.ok(writes.every(r=>!JSON.stringify(r.variables).includes(draft.id)));
});
test('shared-SKU verification blocks sellable copies, draft commitments, missing levels, and pagination',()=>{
 const target={id:'target',sku:'B123'},draft={id:'draft',sku:'B123',product:{status:'DRAFT'},inventoryItem:{inventoryLevels:{nodes:[levels(HQ)],pageInfo:{hasNextPage:false}}}};
 const check=(copy,hasNextPage=false)=>isUniqueSellableSku({nodes:[target,copy],pageInfo:{hasNextPage}},target);
 assert.equal(check(draft),true);
 for(const status of ['ACTIVE','UNLISTED','ARCHIVED'])assert.equal(check({...draft,product:{status}}),false);
 const committed=structuredClone(draft);committed.inventoryItem.inventoryLevels.nodes=[levels(HQ,0,1)];assert.equal(check(committed),false);
 assert.equal(check({...draft,inventoryItem:{}}),false);assert.equal(check(draft,true),false);
 const paginated=structuredClone(draft);paginated.inventoryItem.inventoryLevels.pageInfo.hasNextPage=true;assert.equal(check(paginated),false);
});
