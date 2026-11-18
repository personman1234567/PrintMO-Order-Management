// Versioned, per-variant selling-price deductions. Never supplier unit costs.
export const FULFILLMENT_NAMESPACE = 'printmo_reports';
export const FULFILLMENT_KEY = 'fulfillment_pricing';
export const PRINT_TYPES = Object.freeze({
  chest: { label: 'Chest print', variantId: 'gid://shopify/ProductVariant/46714190168312' },
  'full-front': { label: 'Full front print', variantId: 'gid://shopify/ProductVariant/46714190201080' },
  hat: { label: 'Front hat print', variantId: 'gid://shopify/ProductVariant/46714190463224' }
});
export const FULFILLMENT_REQUIRED_FROM = '2026-11-16T23:50:59.000Z';
const fail = message => { throw Object.assign(new Error(message), {code:'FULFILLMENT_PRICING_REVIEW',status:422}); };
export function priceCents(value) {
  if(typeof value!=='string'||!/^\d+(?:\.\d{1,2})?$/.test(value))fail('A fulfillment price is unavailable.');
  const [a,b='']=value.split('.'),n=Number(a)*100+Number(b.padEnd(2,'0'));
  if(!Number.isSafeInteger(n)||n<0||n>100000000)fail('A fulfillment price is outside the supported range.');return n;
}
export function readFulfillmentPricing(value) {
  if(!value)return null;let p;try{p=typeof value==='string'?JSON.parse(value):value;}catch{fail('The saved fulfillment pricing cannot be read.');}
  if(p.schema!==1||!p.productId||!p.partnerId||!p.collectionId||!Array.isArray(p.versions)||!p.versions.length||p.versions.length>100)fail('The fulfillment pricing version is invalid.');
  let last=-Infinity;const ids=new Set();
  for(const v of p.versions){if(typeof v.id!=='string'||ids.has(v.id)||!/^\d{4}-\d\d-\d\dT/.test(v.effectiveFrom)||!Number.isFinite(Date.parse(v.effectiveFrom))||Date.parse(v.effectiveFrom)<=last||!Array.isArray(v.variants)||!v.variants.length||v.variants.length>1000)fail('The fulfillment price history is invalid.');last=Date.parse(v.effectiveFrom);ids.add(v.id);const seen=new Set();for(const r of v.variants){if(!r.variantId||seen.has(r.variantId)||![r.blankCents,r.printingCents,r.unitBaseCents].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=100000000)||r.blankCents+r.printingCents!==r.unitBaseCents)fail('A saved fulfillment amount is invalid.');seen.add(r.variantId);}}
  if(p.legacy){if(p.legacy.before!==p.versions[0].effectiveFrom||!Array.isArray(p.legacy.variants)||p.legacy.variants.some(r=>!r.variantId||!Number.isSafeInteger(r.unitBaseCents)||r.unitBaseCents<0))fail('The protected earlier prices are invalid.');}
  return p;
}
const options=v=>new Map((v.selectedOptions||[]).map(o=>[o.name.toLowerCase(),o.value.toLowerCase()]));
function same(a,b){return a.size===b.size&&[...a].every(([k,v])=>b.get(k)===v);}
export function matchCatalogVariant(variant,catalog){
  let found=variant.sourceVariantId?catalog.filter(v=>v.id===variant.sourceVariantId):[];
  if(!found.length&&variant.sku)found=catalog.filter(v=>v.sku===variant.sku);
  if(!found.length){const wanted=options(variant);if(wanted.size)found=catalog.filter(v=>same(options(v),wanted));}
  if(found.length>1)fail('More than one catalog variant matches the source identity.');if(!found.length){const wanted=options(variant);wanted.delete('color');wanted.delete('colour');if(wanted.size)found=catalog.filter(v=>{const m=options(v);m.delete('color');m.delete('colour');return same(m,wanted);});}if(!found.length||new Set(found.map(v=>v.price)).size!==1)fail('The catalog garment variant is missing or has ambiguous prices.');return found[0];
}
export function appendFulfillmentPricing({existing,productId,partnerId,collectionId,sourceProductId,variants,catalog,printType,printVariant,effectiveFrom,revisionId,preserveLegacy=true}){
  const prior=readFulfillmentPricing(existing);if(prior&&(prior.productId!==productId||prior.partnerId!==partnerId||prior.collectionId!==collectionId))fail('The fulfillment pricing belongs to another storefront.');
  if(prior?.versions.some(v=>v.id===revisionId))return prior;
  if(!PRINT_TYPES[printType]||printVariant?.id!==PRINT_TYPES[printType].variantId)fail('Choose a supported printing setup.');
  const printingCents=priceCents(printVariant.price);if(printingCents<=0)fail('The selected printing charge is missing.');
  if(!Number.isFinite(Date.parse(effectiveFrom))||prior&&effectiveFrom<=prior.versions.at(-1).effectiveFrom)fail('New prices must begin after the saved pricing version.');
  if(!variants.length||variants.length>1000)fail('Choose supported garment variants.');
  const rows=[],unpricedVariants=[];for(const v of variants){try{const source=matchCatalogVariant(v,catalog),blankCents=priceCents(source.price);rows.push({variantId:v.id,sku:v.sku||'',sourceVariantId:source.id,blankCents,printingCents,unitBaseCents:blankCents+printingCents});}catch(error){unpricedVariants.push({variantId:v.id,sku:v.sku||'',title:v.title||'',reason:error.message});}}if(!rows.length)fail('No garment variants have verified fulfillment prices.');
  const result={schema:1,productId,partnerId,collectionId,sourceProductId,...(prior?.legacy?{legacy:prior.legacy}:!prior&&preserveLegacy?{legacy:{before:effectiveFrom,variants:rows.map(r=>({variantId:r.variantId,sku:r.sku,sourceVariantId:r.sourceVariantId,unitBaseCents:r.blankCents}))}}:{}),versions:[...(prior?.versions||[]),{id:revisionId,effectiveFrom,printType,printVariantId:printVariant.id,variants:rows,unpricedVariants}]};return readFulfillmentPricing(result);
}
export function fulfillmentRateFor(value,line,createdAt,owner){
  const p=readFulfillmentPricing(value);if(!p)return null;
  if(p.productId!==line.product?.id||p.partnerId!==owner.partnerId||p.collectionId!==owner.collectionId)fail('The fulfillment pricing owner does not match this order.');
  if(!Number.isFinite(Date.parse(createdAt)))fail('The order date cannot select a fulfillment price.');
  const version=p.versions.filter(v=>Date.parse(v.effectiveFrom)<=Date.parse(createdAt)).at(-1);
  const legacy=!version&&p.legacy&&Date.parse(createdAt)<Date.parse(p.legacy.before);
  const rows=version?.variants||(legacy?p.legacy.variants:[]);
  let matches=line.variant?.id?rows.filter(r=>r.variantId===line.variant.id):[];
  if(!matches.length&&line.sku)matches=rows.filter(r=>r.sku===line.sku);
  if(matches.length!==1)fail('This order needs a recorded fulfillment price for its variant and date.');
  const row=matches[0];return {unitBaseCents:row.unitBaseCents,approved:true,source:legacy?'Protected pre-change catalog deduction':`Saved fulfillment price: ${PRINT_TYPES[version.printType]?.label||version.printType}`,effectiveFrom:legacy?'1970-01-01':version.effectiveFrom.slice(0,10),basis:legacy?'protected-pre-change-price':'saved-fulfillment-price',pricingVersion:legacy?'legacy-before-'+p.legacy.before:version.id,blankCents:legacy?row.unitBaseCents:row.blankCents,printingCents:legacy?0:row.printingCents};
}
