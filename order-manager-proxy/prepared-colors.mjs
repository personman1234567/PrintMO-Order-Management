import {colorFamilies} from '../order-manager-web/prepared-catalog-model.mjs';
// Recipient configuration changes are scoped to an existing published garment.
const fail = (message, code='COLOR_UNAVAILABLE') => { throw Object.assign(new Error(message), {code,status:409}); };
const colorOption = option => /^colou?r$/i.test(option.name);
const sizeOption = option => /^size$/i.test(option.name);
const colorOf = variant => variant.selectedOptions.find(colorOption)?.value || '';
const key = value => String(value || '').trim().toLowerCase();

export async function preparedColorOptions(record, itemId, service) {
  const item=record.items.find(item=>item.id===itemId);
  if(!item?.project?.prints?.length) fail('This supplied mockup needs Print-MO’s help to change color.');
  const product=await service.product(item.productId);
  const reference=product.variants.find(variant=>variant.id===item.variantId);
  if(!reference) fail('This garment configuration changed. Contact Print-MO.');
  const fixed=reference.selectedOptions.filter(option=>!colorOption(option)&&!sizeOption(option));
  const hidden=new Set((product.config?.hiddenColors || []).map(key));
  const variants=product.variants.filter(variant=>fixed.every(option=>variant.selectedOptions.some(value=>value.name===option.name&&value.value===option.value)));
  const names=[...new Set(variants.map(colorOf).filter(name=>name&&!hidden.has(key(name))))];
  return {itemId,config:product.config,colors:names.map(name=>{
    const swatch=product.swatches?.[name] || {}, configured=product.config?.colors?.find(value=>value.name===name);
    const tintHex=swatch.color || configured?.tintHex || '';
    return {name,tintHex,families:colorFamilies(name,tintHex),swatchImage:swatch.image || configured?.swatchImage,
      variants:variants.filter(variant=>colorOf(variant)===name).map(variant=>({
        id:Number(variant.id.split('/').pop()),color:name,size:variant.selectedOptions.find(sizeOption)?.value || '',
        priceCents:Math.round(Number(variant.price)*100),available:variant.availableForSale===true,
        image:variant.image?.url || ''
      }))};
  })};
}

export async function recipientConfigurations(record, input, service) {
  if(input===undefined)return record;
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length>record.items.length)fail('The garment colors could not be verified.');
  const next=structuredClone(record);
  for(const [id,variantId] of Object.entries(input)){
    const item=next.items.find(item=>item.id===id);
    const options=await preparedColorOptions(record,id,service);
    const color=options.colors.find(color=>color.variants.some(variant=>'gid://shopify/ProductVariant/'+variant.id===variantId&&variant.available));
    if(!item||!color)fail('This color is no longer available. Choose another color.');
    item.variantId=variantId;item.color=color.name;item.recipientConfiguration=true;
    // Fixed options remain in the canonical reference; label reflects selected Color.
    const product=await service.product(item.productId),variant=product.variants.find(variant=>variant.id===variantId);
    item.optionLabel=variant.selectedOptions.filter(option=>!sizeOption(option)).map(option=>option.value).join(' · ');
    item.swatch={color:color.tintHex,image:color.swatchImage||''};
  }
  return next;
}
