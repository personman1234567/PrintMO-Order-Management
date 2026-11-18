import { fulfillmentRateFor, FULFILLMENT_REQUIRED_FROM } from './storefront-fulfillment-pricing.mjs';
// Query-only, transient storefront report reader. No projection, asset, or financial writes.
// Shopify Admin 2026-07: LineItem money includes removed/refunded quantities;
// discountAllocations includes order-level allocations. Reports are current-restated cohorts.
export const STOREFRONT_REPORT_TIME_ZONE = 'America/Chicago';
const PILOT = Object.freeze({ id: 'dr-dallas', name: 'The Dr. Dallas Show', partnerId: 'gid://shopify/Metaobject/241830428920', collectionId: 'gid://shopify/Collection/481089487096', logoUrl: './report-assets/dr-dallas-logo.png' });
const LIMITS = Object.freeze({ calls: 150, orders: 500, collections: 500, nested: 2500 });
const ALL_TIME_LIMITS = Object.freeze({ ...LIMITS, calls: 250, orders: 2500 });
const PAGE = 'pageInfo { hasNextPage endCursor }';
const MONEY = 'shopMoney { amount currencyCode }';
const LINE = `id title variantTitle sku quantity currentQuantity unfulfilledQuantity originalTotalSet { ${MONEY} } discountAllocations { allocatedAmountSet { ${MONEY} } } product { id fulfillmentPricing:metafield(namespace:"printmo_reports",key:"fulfillment_pricing"){value} partnerReference: metafield(namespace:"custom",key:"partner_reference") { value } partnerCollection: metafield(namespace:"custom",key:"partner_collection") { value } } variant { id selectedOptions { name value } }`;
const QUERIES = Object.freeze({
  StorefrontReportHistoryAccess: 'query StorefrontReportHistoryAccess { currentAppInstallation { accessScopes { handle } } }',
  StorefrontReportOwners: `query StorefrontReportOwners($after:String) { collections(first:50,after:$after) { nodes { id title partnerReference:metafield(namespace:"custom",key:"partner_reference") { value } } ${PAGE} } }`,
  StorefrontReportBrand: `query StorefrontReportBrand($id:ID!) { metaobject(id:$id) { name:field(key:"name") { value } logo:field(key:"logo") { reference { ... on MediaImage { image { url } } } } } }`,
  StorefrontReportOrders: `query StorefrontReportOrders($after:String,$query:String!) { orders(first:25,after:$after,query:$query,sortKey:CREATED_AT) { nodes { id name createdAt updatedAt cancelledAt test currencyCode displayFinancialStatus lineItems(first:25) { nodes { ${LINE} } ${PAGE} } fulfillments(first:100) { id status } fulfillmentsCount { count precision } refunds { id } } ${PAGE} } }`,
  StorefrontReportLines: `query StorefrontReportLines($id:ID!,$after:String) { order(id:$id) { id lineItems(first:50,after:$after) { nodes { ${LINE} } ${PAGE} } } }`,
  StorefrontReportFulfillment: `query StorefrontReportFulfillment($id:ID!,$after:String) { node(id:$id) { ... on Fulfillment { id status fulfillmentLineItems(first:50,after:$after) { nodes { id quantity lineItem { id } } ${PAGE} } } } }`,
  StorefrontReportRefund: `query StorefrontReportRefund($id:ID!,$after:String) { node(id:$id) { ... on Refund { id refundLineItems(first:50,after:$after) { nodes { quantity subtotalSet { ${MONEY} } lineItem { id } } ${PAGE} } } } }`,
  StorefrontReportCatalogVariants: `query StorefrontReportCatalogVariants($id:ID!,$after:String) { shop { currencyCode } product(id:$id) { id variants(first:50,after:$after) { nodes { id sku price selectedOptions { name value } } ${PAGE} } } }`,
  StorefrontReportRevalidate: 'query StorefrontReportRevalidate($ids:[ID!]!) { nodes(ids:$ids) { ... on Order { id updatedAt } } }'
});
function failure(code, message, status = 422) { return Object.assign(new Error(message), { code, status }); }
function validDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value; }
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: STOREFRONT_REPORT_TIME_ZONE, year:'numeric',month:'2-digit',day:'2-digit' });
function centralDate(now) { const p = Object.fromEntries(dayFormatter.formatToParts(now).map(p=>[p.type,p.value])); return `${p.year}-${p.month}-${p.day}`; }
function midnight(date) {
  const target = Date.parse(`${date}T00:00:00Z`);
  const formatter = new Intl.DateTimeFormat('en-US',{timeZone:STOREFRONT_REPORT_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  let instant = target + 6*3600000;
  for (let i=0;i<3;i++) { const p=Object.fromEntries(formatter.formatToParts(new Date(instant)).map(p=>[p.type,p.value])); const represented=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second); instant += target-represented; }
  return new Date(instant).toISOString();
}
export function storefrontReportPeriod({start,end}, now = new Date(), {allowLongRange=false}={}) {
  if (!validDate(start)||!validDate(end)||start>end||end>centralDate(now)) throw failure('REPORT_PERIOD_INVALID','Choose valid dates in order, ending no later than today in Central time.',400);
  if (!allowLongRange&&(Date.parse(end)-Date.parse(start))/86400000+1>366) throw failure('REPORT_PERIOD_TOO_LONG','Choose at most 366 calendar days.',400);
  const next = new Date(Date.parse(end)+86400000).toISOString().slice(0,10);
  return { start,end,timeZone:STOREFRONT_REPORT_TIME_ZONE,startISO:midnight(start),endExclusiveISO:end===centralDate(now)?now.toISOString():midnight(next),cutoffISO:now.toISOString() };
}
function safeNumber(value) { if (value>BigInt(Number.MAX_SAFE_INTEGER)||value<BigInt(Number.MIN_SAFE_INTEGER)) throw failure('REPORT_MONEY_OVERFLOW','An amount exceeds safe report limits.'); return Number(value); }
export function storefrontReportMoney(bag) {
  const money=bag?.shopMoney;
  if (money?.currencyCode!=='USD'||typeof money.amount!=='string'||! /^-?\d+(?:\.\d{1,2})?$/.test(money.amount)) throw failure('REPORT_MONEY_UNKNOWN','A USD merchandise amount is missing or unsupported.');
  const negative=money.amount.startsWith('-'), [whole,fraction='']=money.amount.replace(/^-/,'').split('.');
  return (negative?-1n:1n)*(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
}
// Largest-remainder allocation, stable fulfilled-before-pending tie break; sum equals source cents.
export function allocateReportCents(total, quantities) {
  const sum=quantities.reduce((a,b)=>a+b,0);
  if (!Number.isSafeInteger(sum)||sum<=0||quantities.some(q=>!Number.isSafeInteger(q)||q<0)||total<0n) throw failure('REPORT_ALLOCATION_INVALID','The line quantities cannot be reconciled.');
  const denominator=BigInt(sum), parts=quantities.map(q=>total*BigInt(q)/denominator);
  let remaining=total-parts.reduce((a,b)=>a+b,0n);
  const priority=quantities.map((q,i)=>({i,remainder:total*BigInt(q)%denominator})).sort((a,b)=>a.remainder===b.remainder?a.i-b.i:a.remainder>b.remainder?-1:1);
  for (const {i} of priority) { if (!remaining) break; parts[i]++; remaining--; }
  return parts;
}
function connection(value, label) {
  if (!value||!Array.isArray(value.nodes)||typeof value.pageInfo?.hasNextPage!=='boolean') throw failure('REPORT_READ_INCOMPLETE',`${label} did not return a complete page contract.`);
  if (value.nodes.some(node=>!node)) throw failure('REPORT_READ_INCOMPLETE',`${label} contains an unavailable record.`);
  return value;
}
function nextCursor(page, seen, label) {
  if (!page.pageInfo.hasNextPage) return null;
  const cursor=page.pageInfo.endCursor;
  if (typeof cursor!=='string'||!cursor||seen.has(cursor)||!page.nodes.length) throw failure('REPORT_CURSOR_INVALID',`${label} pagination could not advance.`);
  seen.add(cursor); return cursor;
}
function valueOf(field) { return typeof field?.value==='string'?field.value:null; }
function safeLogo(url) { try { const parsed=new URL(url); return parsed.protocol==='https:'&&parsed.hostname==='cdn.shopify.com'&&/\.(png|jpe?g|webp)(?:$|\?)/i.test(parsed.pathname+parsed.search)?url:null; } catch { return null; } }
function configuredOwners(profiles) {
  const supplied=Array.isArray(profiles?.owners)?profiles.owners:[];
  const configured=supplied.find(owner=>owner.id===PILOT.id);
  if(configured&&(configured.partnerId!==PILOT.partnerId||configured.collectionId!==PILOT.collectionId))throw failure('REPORT_OWNER_CONFIG_INVALID','The configured owner references conflict with the approved Dallas identity.');
  const result=[{...PILOT,...configured,rates:Array.isArray(configured?.rates)?configured.rates:[]}], ids=new Set([PILOT.id]),partners=new Set([PILOT.partnerId]),collections=new Set([PILOT.collectionId]);
  for(const owner of supplied.filter(o=>o.id!==PILOT.id && o.enabled===true)) {
    if(!/^storefront-[A-Za-z0-9-]{1,80}$/.test(owner.id||'') || !/^gid:\/\/shopify\/Metaobject\/[1-9][0-9]*$/.test(owner.partnerId||'') || !/^gid:\/\/shopify\/Collection\/[1-9][0-9]*$/.test(owner.collectionId||'') || typeof owner.name!=='string' || !owner.name.trim() || ids.has(owner.id) || partners.has(owner.partnerId) || collections.has(owner.collectionId))throw failure('REPORT_OWNER_CONFIG_INVALID','Reporting owners require unique explicit Shopify identities.');
    ids.add(owner.id);partners.add(owner.partnerId);collections.add(owner.collectionId);result.push({...owner,logoUrl:safeLogo(owner.logoUrl),rates:Array.isArray(owner.rates)?owner.rates:[]});
  }
  return result;
}
function matchingRates(owner,line,date) {
  const candidates=owner.rates.filter(rate=>rate.approved===true&&typeof rate.source==='string'&&rate.source.trim()&&validDate(rate.effectiveFrom)&&(!rate.effectiveTo||validDate(rate.effectiveTo))&&rate.effectiveFrom<=date&&(!rate.effectiveTo||date<=rate.effectiveTo))
    .filter(rate=>(!rate.productId||rate.productId===line.product?.id)&&(!rate.variantId||rate.variantId===line.variant?.id)&&(!rate.sku||rate.sku===line.sku)&&(rate.productId||rate.variantId||rate.sku));
  const specificity=rate=>rate.variantId?3:rate.sku?2:1;
  const top=candidates.length?Math.max(...candidates.map(specificity)):0, matches=candidates.filter(rate=>specificity(rate)===top);
  return matches;
}
function rateFor(owner,line,date,except,orderLabel,fallback=null) {
  const matches=matchingRates(owner,line,date);
  if(!matches.length&&fallback) return fallback;
  if (matches.length!==1||!Number.isSafeInteger(matches[0]?.unitBaseCents)||matches[0].unitBaseCents<0) {
    except(matches.length>1?'RATE_CONFLICT':'RATE_MISSING',matches.length>1?'Overlapping approved rates require review.':'An approved effective-dated base rate is missing.',line.title,orderLabel); return null;
  }
  return matches[0];
}

function approvedCatalogPricing(config) {
  return config?.approved===true&&typeof config.source==='string'&&!!config.source.trim()&&Number.isSafeInteger(config.printingCents)&&config.printingCents>=0&&config.productLinks&&typeof config.productLinks==='object'&&!Array.isArray(config.productLinks);
}
function allOptions(options) {
  if(!Array.isArray(options))return null;
  const map=new Map();
  for(const option of options) {
    if(typeof option?.name!=='string'||typeof option.value!=='string'||!option.name||map.has(option.name))return null;
    map.set(option.name,option.value);
  }
  return map;
}
function nonColorOptions(options) {
  if(!Array.isArray(options))return null;
  const map=new Map();
  for(const option of options) {
    if(typeof option?.name!=='string'||typeof option.value!=='string')return null;
    const name=option.name.trim().toLowerCase();if(name==='color'||name==='colour')continue;
    if(!name||map.has(name))return null;map.set(name,option.value.trim().toLowerCase());
  }
  return map;
}
function sameOptions(left,right) {return right&&left.size===right.size&&[...left].every(([name,value])=>right.get(name)===value);}
function createCatalogPricingResolver(config,read,retrievedAt,except) {
  const products=new Map(),evidence=new Map();
  const basis=config?.printingCents===0?'current-catalog-price':'current-catalog-plus-printing';
  async function blankVariants(id) {
    if(products.has(id))return products.get(id);
    const flight=(async()=>{
      const variants=[],cursors=new Set();let after=null;
      do {
        const data=await read('StorefrontReportCatalogVariants',{id,after});
        if(data.shop?.currencyCode!=='USD')throw failure('RATE_CATALOG_CURRENCY','The normal catalog currency is not verified USD.');
        if(data.product?.id!==id)throw failure('RATE_CATALOG_PRODUCT_MISSING','The explicitly linked normal catalog product is unavailable.');
        const page=connection(data.product.variants,'Normal catalog variants');variants.push(...page.nodes);
        if(variants.length>LIMITS.nested)throw failure('REPORT_NESTED_LIMIT','The normal catalog product has too many variants.');
        after=nextCursor(page,cursors,'Normal catalog variants');
      }while(after);
      if(new Set(variants.map(v=>v.id)).size!==variants.length||variants.some(v=>!v.id))throw failure('RATE_CATALOG_VARIANTS_INVALID','Normal catalog variants are duplicated or unavailable.');
      return variants;
    })();
    products.set(id,flight);return flight;
  }
  return {
    evidence,
    basis,
    async resolve(line,date,orderLabel) {
      if(!approvedCatalogPricing(config))return null;
      const blankProductId=Object.hasOwn(config.productLinks,line.product?.id)?config.productLinks[line.product.id]:null;
      if(typeof blankProductId!=='string'||!/^gid:\/\/shopify\/Product\/\d+$/.test(blankProductId))return null;
      try {
        const variants=await blankVariants(blankProductId),exact=typeof line.sku==='string'&&line.sku.length?variants.filter(variant=>variant.sku===line.sku):[];
        let matched,match;
        if(exact.length===1){matched=exact;match='exact-sku';}
        else if(exact.length>1)throw failure('RATE_CATALOG_AMBIGUOUS','More than one normal catalog variant has the exact source SKU.');
        else {
          const wantedAll=allOptions(line.variant?.selectedOptions);
          const exactOptions=wantedAll?.size?variants.filter(variant=>sameOptions(wantedAll,allOptions(variant.selectedOptions))):[];
          if(exactOptions.length===1){matched=exactOptions;match='exact-options';}
          else if(exactOptions.length>1)throw failure('RATE_CATALOG_AMBIGUOUS','More than one normal catalog variant has the exact source option tuple.');
          else {
            const wanted=nonColorOptions(line.variant?.selectedOptions);
            if(!wanted?.size)throw failure('RATE_CATALOG_OPTIONS_MISSING','The historical SKU is unavailable and its non-color options cannot be verified.');
            matched=variants.filter(variant=>sameOptions(wanted,nonColorOptions(variant.selectedOptions)));match='uniform-non-color-options';
            if(!matched.length)throw failure('RATE_CATALOG_VARIANT_MISSING','No normal catalog variants match the source non-color options.');
          }
        }
        const prices=matched.map(variant=>storefrontReportMoney({shopMoney:{amount:variant.price,currencyCode:'USD'}}));
        if(prices.some(price=>price<0n))throw failure('RATE_CATALOG_PRICE_UNKNOWN','A normal catalog variant price is invalid.');
        if(new Set(prices.map(String)).size!==1)throw failure('RATE_CATALOG_AMBIGUOUS','Normal catalog variants with the same non-color options have different prices.');
        const catalogPriceCents=safeNumber(prices[0]),unitBaseCents=safeNumber(prices[0]+BigInt(config.printingCents));
        const key=JSON.stringify([line.product.id,line.variant?.id||null,line.sku||null,blankProductId,match]);
        evidence.set(key,{partnerProductId:line.product.id,sourceVariantId:line.variant?.id||null,sourceSku:line.sku||null,blankProductId,matchedVariantIds:matched.map(v=>v.id),match,catalogPriceCents,printingCents:config.printingCents,unitBaseCents,basis,effectiveBasis:'current-catalog-at-generation',retrievedAt,source:config.source});
        return {unitBaseCents,source:config.printingCents===0?config.source+'; current normal catalog price':config.source+'; current normal catalog price plus approved printing',effectiveFrom:date,approved:true,basis};
      } catch(error) {
        if(['REPORT_BUDGET_EXCEEDED','REPORT_NESTED_LIMIT','REPORT_CURSOR_INVALID','REPORT_MONEY_OVERFLOW'].includes(error.code))throw error;
        except(error.code?.startsWith('RATE_')?error.code:'RATE_CATALOG_READ_INCOMPLETE','The linked normal catalog price could not be verified: '+(error.code?.startsWith('RATE_')?error.message:'current price evidence is missing.'),line.title,orderLabel);
        return null;
      }
    }
  };
}

function summarize(rows) {
  const totals={salesCents:0,baseCents:0,earningsCents:0,fulfilledEarningsCents:0,pendingEarningsCents:0,fulfilledItems:0,pendingItems:0,itemCount:0,orderCount:0,fulfilledOrders:0,pendingOrders:0,knownSalesCents:0,knownBaseCents:0,knownEarningsCents:0,knownFulfilledEarningsCents:0,knownPendingEarningsCents:0};
  const products=new Map(), all=new Set(), fulfilled=new Set(), pending=new Set();
  const add=(obj,key,value)=>{ if(obj[key]===null||value===null) obj[key]=null; else obj[key]=safeNumber(BigInt(obj[key])+BigInt(value)); };
  for (const row of rows) {
    all.add(row.id); const prefix=row.status==='fulfilled'?'fulfilled':'pending'; (prefix==='fulfilled'?fulfilled:pending).add(row.id);
    totals.itemCount+=row.quantity;totals[`${prefix}Items`]+=row.quantity;
    for(const key of ['salesCents','baseCents','earningsCents']) add(totals,key,row[key]);
    add(totals,`${prefix}EarningsCents`,row.earningsCents);
    if(row.salesCents!==null) add(totals,'knownSalesCents',row.salesCents);
    if(row.baseCents!==null) add(totals,'knownBaseCents',row.baseCents);
    if(row.earningsCents!==null) { add(totals,'knownEarningsCents',row.earningsCents); add(totals,prefix==='fulfilled'?'knownFulfilledEarningsCents':'knownPendingEarningsCents',row.earningsCents); }
    const productKey=row.productId||row.productName||row.product;
    if(!products.has(productKey)) products.set(productKey,{name:row.productName||row.product,quantity:0,salesCents:0,baseCents:0,earningsCents:0});
    const product=products.get(productKey); product.quantity+=row.quantity;
    for(const key of ['salesCents','baseCents','earningsCents']) add(product,key,row[key]);
  }
  totals.orderCount=all.size;totals.fulfilledOrders=fulfilled.size;totals.pendingOrders=pending.size;
  return {totals,products:[...products.values()]};
}
export function createStorefrontReportsService({graphql,shopDomain,profiles={},now=()=>new Date()}) {
  if(typeof graphql!=='function'||typeof shopDomain!=='string'||!shopDomain) throw new TypeError('A shop-scoped read-only GraphQL adapter is required.');
  const enabled=configuredOwners(profiles);
  function reader(limits=LIMITS) {
    let calls=0;
    return async (operation,variables={})=>{
      if(++calls>limits.calls) throw failure('REPORT_BUDGET_EXCEEDED',`The report exceeded ${limits.calls} Shopify reads. Choose a shorter period.`);
      let result; try { result=await graphql(QUERIES[operation],variables,operation); } catch { throw failure('REPORT_UPSTREAM_FAILED','Shopify could not complete the report read.',502); }
      if(result?.errors?.length||!result?.data) throw failure('REPORT_UPSTREAM_FAILED','Shopify returned an incomplete report read. Check app access and retry.',502);
      if(result.extensions?.search?.some(search=>search.warnings?.length)) throw failure('REPORT_SEARCH_INVALID','Shopify could not apply the complete placed-date filter.');
      return result.data;
    };
  }
  async function discover(read, requestedOwner = null) {
    const collections=[],seen=new Set();let after=null;
    do { const data=await read('StorefrontReportOwners',{after});const page=connection(data.collections,'Owner collections');collections.push(...page.nodes); if(collections.length>LIMITS.collections) throw failure('REPORT_OWNER_LIMIT','Owner discovery exceeds the supported collection limit.');after=nextCursor(page,seen,'Owner collections'); } while(after);
    const verified=enabled.filter(owner=>!requestedOwner||owner.id===requestedOwner).filter(owner=>{const collection=collections.find(c=>c.id===owner.collectionId);return collection&&valueOf(collection.partnerReference)===owner.partnerId;});
    if(!verified.length)throw failure('REPORT_OWNER_UNVERIFIED','The storefront collection must explicitly reference its configured partner.');
    return verified;
  }

  async function owners() {
    const read=reader(), list=await discover(read), result=[];
    for(const owner of list) {
      const warnings=[];let brand=null;
      try { brand=(await read('StorefrontReportBrand',{id:owner.partnerId})).metaobject; } catch(error) { if(error.code==='REPORT_BUDGET_EXCEEDED') throw error; warnings.push('Partner branding could not be read; configured branding is shown.'); }
      result.push({id:owner.id,name:valueOf(brand?.name)||owner.name,logoUrl:safeLogo(brand?.logo?.reference?.image?.url)||safeLogo(owner.logoUrl)||(owner.id===PILOT.id?PILOT.logoUrl:null),capabilityWarnings:warnings});
    }
    return result;
  }
  async function generate({ownerId,start,end,preset}={}) {
    const began=now(),allTime=preset==='all-time',limits=allTime?ALL_TIME_LIMITS:LIMITS,read=reader(limits);
    let period=allTime?{end:centralDate(began),timeZone:STOREFRONT_REPORT_TIME_ZONE,endExclusiveISO:began.toISOString(),cutoffISO:began.toISOString(),preset:'all-time'}:storefrontReportPeriod({start,end},began);
    const owner=enabled.find(owner=>owner.id===ownerId);if(!owner) throw failure('REPORT_OWNER_INVALID','Choose an enabled storefront owner.',400);
    await discover(read,owner.id);
    if(allTime){const access=await read('StorefrontReportHistoryAccess');if(!access.currentAppInstallation?.accessScopes?.some(scope=>scope.handle==='read_all_orders'))throw failure('REPORT_HISTORY_ACCESS_REQUIRED','All time requires access to the full Shopify order history.',403);}
    const exceptions=[],rows=[],source=[],seenOrders=new Set(),orderCursors=new Set(),linkedOrders=new Set();let after=null,attributionUnknown=false,unavailableProductLines=0,unlinkedSourceDrift=0;
    const except=(code,message,product,orderLabel)=>{ exceptions.push({code,message,...(product?{product}:{}),...(orderLabel?{orderLabel}:{})}); };
    const catalog=createCatalogPricingResolver(profiles.catalogPricing,read,began.toISOString(),except);
    const query=allTime?`created_at:<'${period.endExclusiveISO}'`:`created_at:>='${period.startISO}' created_at:<'${period.endExclusiveISO}'`;
    do {
      const data=await read('StorefrontReportOrders',{after,query});const page=connection(data.orders,'Placed orders');
      for(const order of page.nodes) {
        if(!order.id||seenOrders.has(order.id)||!Number.isFinite(Date.parse(order.createdAt))||(!allTime&&Date.parse(order.createdAt)<Date.parse(period.startISO))||Date.parse(order.createdAt)>=Date.parse(period.endExclusiveISO)||!order.updatedAt) throw failure('REPORT_ORDER_READ_INVALID','Shopify order enumeration did not reconcile with the requested cohort.');
        seenOrders.add(order.id);if(seenOrders.size>limits.orders) throw failure('REPORT_ORDER_LIMIT',`The period includes over ${limits.orders} orders. Choose a shorter period.`);
        source.push(order);
      }
      after=nextCursor(page,orderCursors,'Placed orders');
    } while(after);
    if(allTime){const first=source.reduce((earliest,order)=>!earliest||Date.parse(order.createdAt)<Date.parse(earliest)?order.createdAt:earliest,null);period={...storefrontReportPeriod({start:first?centralDate(new Date(first)):period.end,end:period.end},began,{allowLongRange:true}),preset:'all-time'};}
    const exclusions={testOrders:0,cancelledOrders:0,unpaidOrders:0,unlinkedProductLines:0,otherOwnerLines:0,unattributedProductLines:0,unlinkedChangedOrders:0};
    for(const order of source) {
      if(order.test===true){exclusions.testOrders++;continue;}if(order.cancelledAt){exclusions.cancelledOrders++;continue;}
      if(typeof order.test!=='boolean'||!Object.hasOwn(order,'cancelledAt')||!order.displayFinancialStatus) throw failure('REPORT_ORDER_STATE_UNKNOWN','An order payment/exclusion state is unavailable.');
      const first=connection(order.lineItems,'Order lines'),lines=[...first.nodes],seen=new Set();let cursor=nextCursor(first,seen,'Order lines');
      while(cursor) {const data=await read('StorefrontReportLines',{id:order.id,after:cursor});const page=connection(data.order?.lineItems,'Order lines');lines.push(...page.nodes);if(lines.length>LIMITS.nested)throw failure('REPORT_LINE_LIMIT','An order has too many lines for this report.');cursor=nextCursor(page,seen,'Order lines');}
      if(new Set(lines.map(line=>line.id)).size!==lines.length||lines.some(line=>!line.id))throw failure('REPORT_LINE_DUPLICATE','An order line was duplicated or unavailable.');
      const own=[];let unknownLines=0;
      for(const line of lines) {
        if(!line.product){unknownLines++;continue;}
        const partner=valueOf(line.product.partnerReference),collection=valueOf(line.product.partnerCollection);
        const matchesPartner=partner===owner.partnerId,matchesCollection=collection===owner.collectionId;
        if((matchesPartner&&collection&&!matchesCollection)||(matchesCollection&&partner&&!matchesPartner)) {except('ATTRIBUTION_CONFLICT','Product partner and collection references conflict.',line.title,order.name);attributionUnknown=true;continue;}
        if(matchesPartner||matchesCollection) {
          if(!partner||!collection) {except('ATTRIBUTION_INCOMPLETE','Both explicit product owner references are required.',line.title,order.name);attributionUnknown=true;}
          else own.push(line);
        } else if(!partner&&!collection) {
          // The explicit linked-product report scope excludes ordinary known products.
          // Their titles and order labels do not belong in another owner's report.
          exclusions.unlinkedProductLines++;
        } else exclusions.otherOwnerLines++;
      }
      if(!own.length){exclusions.unattributedProductLines+=unknownLines;continue;}
      if(unknownLines){unavailableProductLines+=unknownLines;attributionUnknown=true;}
      linkedOrders.add(order.id);
      let nestedComplete=true;const fulfilled=new Map(),refunds=new Map();
      if(!Array.isArray(order.fulfillments)||!Number.isSafeInteger(order.fulfillmentsCount?.count)||order.fulfillmentsCount.precision!=='EXACT'||order.fulfillmentsCount.count!==order.fulfillments.length||!Array.isArray(order.refunds))nestedComplete=false;
      const getNested=async(operation,id,field)=>{
        const records=[],cursors=new Set();let after=null;
        do {const data=await read(operation,{id,after});const page=connection(data.node?.[field],field);records.push(...page.nodes);if(records.length>LIMITS.nested)throw failure('REPORT_NESTED_LIMIT','Nested report evidence exceeds the supported limit.');after=nextCursor(page,cursors,field);}while(after);
        return records;
      };
      try {
        for(const fulfillment of order.fulfillments||[]) {
          if(fulfillment.status==='CANCELLED'||fulfillment.status==='FAILURE'||fulfillment.status==='ERROR')continue;
          if(fulfillment.status!=='SUCCESS'){nestedComplete=false;continue;}
          for(const entry of await getNested('StorefrontReportFulfillment',fulfillment.id,'fulfillmentLineItems')) {
            if(!entry.lineItem?.id||!Number.isSafeInteger(entry.quantity)||entry.quantity<0)throw failure('REPORT_FULFILLMENT_UNKNOWN','Fulfillment quantities are unavailable.');
            fulfilled.set(entry.lineItem.id,(fulfilled.get(entry.lineItem.id)||0)+entry.quantity);
          }
        }
        if((order.refunds||[]).length>100)throw failure('REPORT_NESTED_LIMIT','An order has too many refund records.');
        for(const refund of order.refunds||[]) {
          const entries=await getNested('StorefrontReportRefund',refund.id,'refundLineItems');
          if(!entries.length){nestedComplete=false;except('REFUND_ALLOCATION_UNKNOWN','An order-level refund cannot be allocated to merchandise owners.',undefined,order.name);}
          for(const entry of entries) {
            if(!entry.lineItem?.id||!Number.isSafeInteger(entry.quantity)||entry.quantity<0)throw failure('REPORT_REFUND_UNKNOWN','Refund line evidence is unavailable.');
            const amount=storefrontReportMoney(entry.subtotalSet);if(amount<0n)throw failure('REPORT_REFUND_UNKNOWN','A refund subtotal is invalid.');
            const previous=refunds.get(entry.lineItem.id)||{quantity:0,cents:0n};previous.quantity+=entry.quantity;previous.cents+=amount;refunds.set(entry.lineItem.id,previous);
          }
        }
      } catch(error) {
        if(['REPORT_BUDGET_EXCEEDED','REPORT_NESTED_LIMIT','REPORT_CURSOR_INVALID'].includes(error.code))throw error;
        nestedComplete=false;except('NESTED_EVIDENCE_INCOMPLETE','Refund or fulfillment details could not be verified.',undefined,order.name);
      }
      if(['PARTIALLY_REFUNDED','REFUNDED'].includes(order.displayFinancialStatus)&&!order.refunds?.length) nestedComplete=false;
      if(!nestedComplete)except('ORDER_EVIDENCE_INCOMPLETE','This order needs complete refund and fulfillment evidence.',undefined,order.name);
      const paid=['PAID','PARTIALLY_REFUNDED','REFUNDED'].includes(order.displayFinancialStatus);
      if(!paid){exclusions.unpaidOrders++;except('PAYMENT_PENDING','Unpaid or partially paid merchandise is excluded from earned amounts.',undefined,order.name);}
      const date=centralDate(new Date(order.createdAt));
      for(const line of own) {
        const refunded=refunds.get(line.id)||{quantity:0,cents:0n};let sales=null,quantity=line.currentQuantity,fulfilledQuantity=fulfilled.get(line.id)||0,amountsValid=true;
        if(!Number.isSafeInteger(line.quantity)||!Number.isSafeInteger(quantity)||!Number.isSafeInteger(line.unfulfilledQuantity)||line.quantity<0||quantity<0||quantity>line.quantity||fulfilledQuantity>line.quantity||line.unfulfilledQuantity<0) {except('QUANTITY_UNKNOWN','Line quantities cannot be reconciled.',line.title,order.name);quantity=Number.isSafeInteger(quantity)&&quantity>=0?quantity:0;amountsValid=false;}
        const refundAffected=refunded.quantity>0||refunded.cents>0n;
        const removed=line.quantity-quantity-refunded.quantity;
        if(removed!==0){except('ORDER_EDIT_REVIEW','Removed or edited quantities need an approved financial adjustment.',line.title,order.name);amountsValid=false;}
        if(refundAffected)except('REFUND_COST_POLICY_UNKNOWN','Refunded merchandise needs approved base-cost reversal and fulfillment allocation rules.',line.title,order.name);
        if(!refundAffected&&amountsValid&&fulfilledQuantity+line.unfulfilledQuantity!==quantity){except('FULFILLMENT_RECONCILIATION','Fulfillment and outstanding quantities do not reconcile.',line.title,order.name);amountsValid=false;}
        try {
          if(!Array.isArray(line.discountAllocations))throw failure('REPORT_MONEY_UNKNOWN','Discount allocations are missing.');
          const gross=storefrontReportMoney(line.originalTotalSet),discount=line.discountAllocations.reduce((sum,a)=>sum+storefrontReportMoney(a.allocatedAmountSet),0n);
          const net=gross-discount-refunded.cents;if(gross<0n||discount<0n||net<0n)throw failure('REPORT_MONEY_UNKNOWN','Discounts or refunds exceed merchandise sales.');
          if(paid&&nestedComplete&&amountsValid&&order.currencyCode==='USD')sales=net;
          if(order.currencyCode!=='USD')except('CURRENCY_UNSUPPORTED','Only verified USD shop-money reports are supported.',line.title,order.name);
        } catch {except('MONEY_UNKNOWN','A merchandise or refund amount is missing or unsupported.',line.title,order.name);}
        let saved=null,pricingFailed=false;
        try { if(!matchingRates(owner,line,date).length) saved=fulfillmentRateFor(line.product?.fulfillmentPricing?.value,line,order.createdAt,owner); }
        catch(error){pricingFailed=true;except('FULFILLMENT_PRICING_REVIEW',error.message,line.title,order.name);}
        if(!saved&&!pricingFailed&&order.createdAt>=FULFILLMENT_REQUIRED_FROM){pricingFailed=true;except('FULFILLMENT_PRICING_MISSING','Set the product fulfillment price before reporting new orders.',line.title,order.name);}
        const fallback=saved||pricingFailed||matchingRates(owner,line,date).length?null:await catalog.resolve(line,date,order.name);
        const rate=pricingFailed?null:saved&&saved.basis!=='protected-pre-change-price'?saved:rateFor(owner,line,date,except,order.name,saved||fallback);
        const financialKnown=sales!==null&&rate!==null&&!refundAffected&&nestedComplete&&amountsValid;
        // Without a refund allocation policy, quantity/status evidence remains inspectable; no cost reversal is invented.
        fulfilledQuantity=Math.min(quantity,Math.max(0,fulfilledQuantity));
        const pendingQuantity=quantity-fulfilledQuantity;
        const quantities=quantity?[fulfilledQuantity,pendingQuantity]:[0,0];
        const allocated=sales!==null&&quantity?allocateReportCents(sales,quantities):[sales===0n?0n:null,sales===0n?0n:null];
        for(let i=0;i<2;i++) {
          if(!quantities[i]&&(quantity||i))continue;
          const base=financialKnown?BigInt(rate.unitBaseCents)*BigInt(quantities[i]):null;
          const earning=financialKnown&&allocated[i]!==null?allocated[i]-base:null;
          rows.push({id:order.id,label:order.name,date,product:[line.title,line.variantTitle].filter(Boolean).join(' · '),productId:line.product?.id||null,productName:line.title,variantTitle:line.variantTitle||null,quantity:quantities[i],salesCents:allocated[i]===null?null:safeNumber(allocated[i]),baseCents:base===null?null:safeNumber(base),earningsCents:earning===null?null:safeNumber(earning),status:i===0?'fulfilled':'pending',lineId:line.id,sku:line.sku||null,variantId:line.variant?.id||null,...(rate?{rateSource:rate.source,effectiveFrom:rate.effectiveFrom,...(rate.basis?{rateBasis:rate.basis}:{}),...(rate.pricingVersion?{pricingVersion:rate.pricingVersion,unitBlankCents:rate.blankCents,unitPrintingCents:rate.printingCents}:{})}:{}),...(refundAffected?{fulfillmentAllocation:'needs-review'}:{})});
        }
      }
    }
    // Revalidate the cohort; linked-record drift affects financial completeness.
    // Changes outside linked storefront orders are count-only scope coverage.
    for(let offset=0;offset<source.length;offset+=50) {
      const batch=source.slice(offset,offset+50),data=await read('StorefrontReportRevalidate',{ids:batch.map(order=>order.id)});
      if(!Array.isArray(data.nodes)||data.nodes.length!==batch.length||new Set(data.nodes.filter(Boolean).map(order=>order.id)).size!==data.nodes.filter(Boolean).length)throw failure('REPORT_REVALIDATION_INCOMPLETE','Shopify could not revalidate the full report cohort.');
      const current=new Map(data.nodes.filter(Boolean).map(order=>[order.id,order.updatedAt]));
      for(const order of batch)if(current.get(order.id)!==order.updatedAt) {
        if(linkedOrders.has(order.id))except('SOURCE_DRIFT','The order changed or became unavailable during retrieval. Regenerate to reconcile.',undefined,order.name);
        else unlinkedSourceDrift++;
      }
    }
    if(unavailableProductLines)except('ATTRIBUTION_UNKNOWN',`${unavailableProductLines} order lines reference deleted or unavailable products; their owner attribution could not be verified.`);
    exclusions.unlinkedChangedOrders=unlinkedSourceDrift;
    const coverageWarnings=[];
    if(exclusions.unattributedProductLines)coverageWarnings.push('Unlinked or deleted items outside linked storefront orders were excluded from this report scope.');
    if(unlinkedSourceDrift)coverageWarnings.push('Changes outside linked storefront orders were excluded from this report scope.');
    const summary=summarize(rows),complete=!attributionUnknown&&!exceptions.some(e=>['SOURCE_DRIFT','NESTED_EVIDENCE_INCOMPLETE','ORDER_EVIDENCE_INCOMPLETE','ORDER_EDIT_REVIEW','QUANTITY_UNKNOWN','FULFILLMENT_RECONCILIATION'].includes(e.code));
    if(attributionUnknown){summary.totals.salesCents=null;summary.totals.baseCents=null;summary.totals.earningsCents=null;summary.totals.fulfilledEarningsCents=null;summary.totals.pendingEarningsCents=null;}
    const financialComplete=complete&&exceptions.length===0&&rows.every(row=>row.salesCents!==null&&row.baseCents!==null&&row.earningsCents!==null);
    const ended=now().toISOString();
    return {id:`live-${globalThis.crypto.randomUUID()}`,owner:{id:owner.id,name:owner.name,logoUrl:owner.logoUrl},period,generatedAt:ended,retrievalStartedAt:began.toISOString(),retrievalEndedAt:ended,mode:'live',status:financialComplete?'complete':'needs-review',completeness:{complete,financialComplete},exceptions,coverageWarnings,currency:'USD',orders:rows,...summary,noActivity:complete&&financialComplete&&rows.length===0,templateVersion:'redesign-live-v1',exclusions,attributionBasis:'linked-product-partner-reference',statusBasis:'current-restated',fulfillmentRateBasis:rows.some(r=>r.pricingVersion)?'versioned-fulfillment-prices':approvedCatalogPricing(profiles.catalogPricing)?catalog.basis:'approved-effective-dated-rate',pricingRetrievedAt:approvedCatalogPricing(profiles.catalogPricing)?began.toISOString():null,rateEvidence:[...catalog.evidence.values()],fulfillmentRateBasisNote:typeof profiles.reportBasisNote==='string'?profiles.reportBasisNote:null,configurationVersion:typeof profiles.version==='string'?profiles.version:approvedCatalogPricing(profiles.catalogPricing)?'unversioned-approved-catalog-pricing':'unversioned-no-approved-rate-source',queryVersion:'2026-07-report-v1'};
  }
  return Object.freeze({owners,generate});
}
