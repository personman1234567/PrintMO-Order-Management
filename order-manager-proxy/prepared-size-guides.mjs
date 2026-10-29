// Optional product information: never put this request on the quote/checkout path.
export const PREPARED_SIZE_GUIDES_QUERY = `query PreparedRecipientSizeGuides($ids:[ID!]!) { nodes(ids:$ids) { ... on Product { id
  guide:metafield(namespace:"custom",key:"garment_size_guide") { reference { ... on Metaobject { fields { key value } } } }
  chart:metafield(namespace:"custom",key:"size_chart") { reference { ... on Page { title body } } }
} } }`;
const cache=new Map();
const clean=value=>typeof value==='string'?value.trim().slice(0,180):'';
export function publicSizeGuide(product,now=Date.now()) {
  const fields=Object.fromEntries((product.guide?.reference?.fields||[]).map(field=>[field.key,field.value]));
  if(fields.review_status==='approved'&&fields.reviewed_by&&fields.reviewed_at&&(!fields.review_due||Date.parse(fields.review_due+'T23:59:59Z')>=now)) {
    try {
      const columns=JSON.parse(fields.columns),rows=JSON.parse(fields.rows);
      if(Array.isArray(columns)&&columns.length&&columns.length<=20&&Array.isArray(rows)&&rows.length&&rows.length<=12){
        const result={title:clean(fields.name)||'Size guide',unit:clean(fields.default_unit),fitSummary:clean(fields.fit_summary),
          columns:columns.map(col=>({key:clean(col.key),label:clean(col.label),shopify_labels:(col.shopify_labels||[]).map(clean)})),
          rows:rows.map(row=>({label:clean(row.label),unit:clean(row.unit),tolerance:clean(row.tolerance),values:Object.fromEntries(columns.map(col=>[col.key,clean(row.values?.[col.key])]))}))};
        if(result.columns.every(col=>col.key&&col.label)&&result.rows.every(row=>row.label&&result.columns.every(col=>row.values[col.key])))return result;
      }
    }catch{/* A malformed optional chart must not affect purchasing. */}
  }
  const page=product.chart?.reference;
  return page?.body&&page.body.length<=100000?{title:clean(page.title)||'Size guide',html:page.body}:null;
}
export async function recipientSizeGuides(env,deps,record) {
  const ids=[...new Set(record.items.map(item=>item.productId))],missing=ids.filter(id=>!cache.has(id)||cache.get(id).expires<Date.now());
  if(missing.length){
    try {
      const result=await deps.graphql(env,PREPARED_SIZE_GUIDES_QUERY,{ids:missing},'PreparedRecipientSizeGuides');
      // Optional reference access can be denied without denying the product itself.
      for(const product of result?.data?.nodes||[])if(product?.id){if(cache.size>500)cache.clear();cache.set(product.id,{guide:publicSizeGuide(product),expires:Date.now()+300000});}
    }catch{/* Hide unavailable guides; the customer order stays usable. */}
  }
  return {guides:Object.fromEntries(record.items.flatMap(item=>{const saved=cache.get(item.productId),guide=saved?.expires>=Date.now()?saved.guide:null;return guide?[[item.id,guide]]:[]}))};
}
