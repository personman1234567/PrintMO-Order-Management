// Current commerce only. Presentation and all-color catalog media belong to publishing.
export const PREPARED_RECIPIENT_COMMERCE_QUERY = `query PreparedRecipientCommerce($ids:[ID!]!) { nodes(ids:$ids) {
  ... on Product { id title handle status designerConfig:metafield(namespace:"custom",key:"designer_config") { value } }
  ... on ProductVariant { id price selectedOptions { name value } product { id status } }
} }`;
export async function preparedPriceProducts(env,graphql,record,snapshotItems,normalizeConfig) {
  const products=new Map(),variants=new Map(),ids=[...new Set(record.items.flatMap(item=>[item.productId,item.variantId,...(snapshotItems.find(value=>value.id===item.id)?.variants||[]).map(value=>value.id)]))];
  // Shopify node inputs are bounded. Typical orders fit in one request.
  for(let offset=0;offset<ids.length;offset+=200){
    const response=await graphql(env,PREPARED_RECIPIENT_COMMERCE_QUERY,{ids:ids.slice(offset,offset+200)},'PreparedRecipientCommerce');
    if(response?.ok===false||!response?.data||response.errors?.length)throw Object.assign(new Error('Current prices could not load from Shopify. Retry the order price.'),{code:'SHOPIFY_UNAVAILABLE',status:502});
    for(const value of response.data.nodes||[]){if(!value)continue;if(value.id?.startsWith('gid://shopify/ProductVariant/'))variants.set(value.id,value);else if(value.id?.startsWith('gid://shopify/Product/'))products.set(value.id,value);}
  }
  for(const item of record.items){
    const product=products.get(item.productId);
    if(!product||!['ACTIVE','UNLISTED'].includes(product.status))throw Object.assign(new Error(`${item.title} is no longer available. Contact Print-MO.`),{code:'PRODUCT_UNAVAILABLE',status:409});
  }
  return new Map([...products].map(([id,product])=>[id,{...product,
    config:normalizeConfig(product.designerConfig?.value),image:snapshotItems.find(item=>record.items.find(source=>source.id===item.id)?.productId===id)?.image||'',
    variants:[...variants.values()].filter(variant=>variant.product?.id===id)
  }]));
}
