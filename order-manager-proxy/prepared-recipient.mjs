// Bridge private admin preparation to the existing website's workspace contract.
const SIDES = ['front','back','breast','left','right'];
const fail = message => { throw Object.assign(new Error(message), {code:'INVALID_DESIGN',status:400}); };
export function recipientDesigns(record, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('The edited designs could not be read.');
  const next = structuredClone(record), normalized = {};
  for (const [id, value] of Object.entries(input)) {
    const item = next.items.find(item => item.id === id);
    if (!item?.project?.prints?.length) fail('This item has a supplied mockup and cannot be edited in Designer.');
    if (!value || !/^[a-f0-9]{64}$/.test(value.revision || '') || !Array.isArray(value.prints) || value.prints.length > 40) fail('The edited design is invalid.');
    const prints = value.prints.map(print => {
      if (!SIDES.includes(print.side) || !['image','text'].includes(print.type)) fail('This design has an unsupported layer.');
      const d = print.design;
      if (!d || !['xIn','yIn','wIn','hIn','rotation'].every(key => Number.isFinite(d[key]) && Math.abs(d[key]) <= 200)
        || d.wIn <= 0 || d.hIn <= 0) fail('Check the artwork size and placement.');
      // Pricing needs geometry and ink crop only. Never fetch customer-submitted URLs.
      const trim = print.trim || print.asset?.trim;
      if (trim && (!trim.crop || !['x','y','width','height'].every(key => Number.isFinite(trim.crop[key]) && trim.crop[key] >= 0)
        || !Number.isFinite(trim.naturalWidth) || !Number.isFinite(trim.naturalHeight) || trim.naturalWidth <= 0 || trim.naturalHeight <= 0)) fail('Check the artwork crop.');
      return {type:print.type,side:print.side,design:Object.fromEntries(['xIn','yIn','wIn','hIn','rotation'].map(key=>[key,d[key]])),...(trim?{trim}:{}),asset:{}};
    });
    // Retain physical calibration; customer edits cannot replace staff pricing overrides.
    const bySide = {};
    for (const side of SIDES) {
      const area = value.canvasCalibration?.bySide?.[side];
      if (!area) continue;
      if (!['referenceWidthIn','safeWidthIn','safeHeightIn'].every(key=>Number.isFinite(area[key])&&area[key]>0&&area[key]<=200)) fail('Check the design calibration.');
      bySide[side] = {referenceWidthIn:area.referenceWidthIn,safeWidthIn:area.safeWidthIn,safeHeightIn:area.safeHeightIn};
    }
    const project = {...item.project,prints,canvasCalibration:{bySide}};
    item.project = project;
    normalized[id] = {revision:value.revision,prints,canvasCalibration:project.canvasCalibration};
  }
  return {record:next,designs:normalized};
}

export function recipientColorPresentation(product, item, color) {
  const same = value => String(value || '').trim().toLowerCase() === String(color || '').trim().toLowerCase();
  const native = Object.entries(product.swatches || {}).find(([name]) => same(name))?.[1];
  const configured = product.config?.colors?.find(value => same(value.name));
  const saved = same(item.color) ? item.swatch : null;
  return {name:color,tintHex:native?.color || saved?.color || configured?.tintHex || '',
    ...((native?.image || saved?.image || configured?.swatchImage) ? {swatchImage:native?.image || saved?.image || configured?.swatchImage} : {})};
}

// Old published alternative definitions predate native swatch transport. Repair
// their presentation from the saved exact color without fetching inactive stock.
export function recipientChoicePresentations(groups, record, template) {
  return (groups || []).map(group=>({...group,options:group.options.map(option=>{
    const fresh=template.workspaces.find(workspace=>workspace.id===option.id);
    const item=record.items.find(item=>item.id===option.id) || {};
    return {...option,config:{...option.config,colors:fresh?.config?.colors || [recipientColorPresentation({config:option.config},item,option.color)]}};
  })}));
}

export async function recipientTemplate(record, items, service, sourceTemplate,{preferPublished=false}={}) {
  const workspaces = [];
  const products=new Map(),publishedProducts=new Map();
  if(preferPublished)for(const item of record.items){
    const saved=sourceTemplate?.workspaces?.find(value=>value.id===item.id),commerce=items.find(value=>value.id===item.id);
    if(saved?.config&&saved.handle&&Array.isArray(saved.variants)&&commerce?.variants.every(variant=>saved.variants.some(value=>String(value.id)===variant.id.split('/').pop()))){
      publishedProducts.set(item.id,{title:saved.title||item.title,handle:saved.handle,image:saved.image||'',config:saved.config,
        variants:saved.variants.map(variant=>({id:'gid://shopify/ProductVariant/'+variant.id,image:variant.image,selectedOptions:[{name:'Color',value:variant.color||saved.color||item.color||''},{name:'Size',value:variant.size||'One size'}]}))});
    }
  }
  // Older snapshots fall back to bounded, deduplicated reads; modern ones need none.
  const missing=[...new Set(record.items.filter(item=>!publishedProducts.has(item.id)).map(item=>item.productId))];let next=0;
  await Promise.all(Array.from({length:Math.min(3,missing.length)},async()=>{while(next<missing.length){const id=missing[next++];products.set(id,await service.product(id));}}));
  for (const item of record.items) {
    const commerce = items.find(value=>value.id===item.id), product = publishedProducts.get(item.id)||products.get(item.productId);
    const selected = product.variants.find(value=>value.id===item.variantId);
    const color = selected?.selectedOptions.find(option=>/^colou?r$/i.test(option.name))?.value || item.color || commerce.color || '';
    const originals = sourceTemplate?.workspaces?.find(value=>value.id===item.id)?.design?.prints || [];
    const prints = (item.project?.prints || []).map(print=>({...print,asset:{...print.asset,url:originals.find(value=>value.id===print.id)?.asset?.url || ''}}));
    if (prints.some(print=>!print.asset.url)) throw Object.assign(new Error('The saved artwork could not load. Refresh this customer link in Order Manager.'),{code:'ARTWORK_UNAVAILABLE',status:409});
    const variants = commerce.variants.map(variant=>{const image=product.variants.find(value=>value.id===variant.id)?.image;return {id:Number(variant.id.split('/').pop()),color,size:variant.size==='One size'?'':variant.size,priceCents:variant.priceCents,available:true,image:(typeof image==='string'?image:image?.url)||product.image||''}});
    const images = commerce.images || [];
    workspaces.push({id:item.id,handle:product.handle||item.handle,title:product.title,image:product.image||'',
      variants,config:{...product.config,colors:[recipientColorPresentation(product,item,color)],...(variants.every(v=>!v.size)?{oneSize:true}:{})},
      selectedVariantId:Number(item.variantId.split('/').pop()),color,activeVariantColor:color,customerInstructions:item.instructions||'',
      preparedItem:{editable:prints.length>0,images,printMode:item.printMode||'auto',prefilledQuantities:Object.values(item.sizeQty||{}).some(quantity=>quantity>0),prints:commerce.prints},
      design:{...item.project,prints,selectedIds:[],panelView:'none',textValue:'',rotationInput:0,activeSide:item.project?.activeSide||'front',selectedColor:color,selectedSize:variants[0]?.size||'',selectedVariantId:Number(item.variantId.split('/').pop()),sizeQty:{...(item.sizeQty||{})}}
    });
  }
  return {version:1,activeHandle:workspaces[0]?.handle||null,activeWorkspaceId:workspaces[0]?.id,workspaces};
}

export function recipientArtwork(record, designs, input, selectedIds, previews={}) {
  const files = [];
  for (const item of record.items) {
    if (!selectedIds.has(item.id) || !designs[item.id]) continue;
    const sides = [...new Set(designs[item.id].prints.map(print=>print.side))];
    for (const side of sides) {
      const svg = input?.[item.id]?.[side];
      if (typeof svg !== 'string' || svg.length > 12*1024*1024 || !/<svg[\s>]/i.test(svg)
        || /<script|<foreignObject|on[a-z]+\s*=|(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/)/i.test(svg)) fail('The edited artwork could not be exported safely. Return to the review and retry.');
      files.push({itemId:item.id,side,svg});
    }
    const preview = previews[item.id];
    if (typeof preview === 'string' && preview.length <= 8*1024*1024) {
      const match = preview.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
      if (match) files.push({itemId:item.id,side:'other',mime:match[1],base64:match[2]});
    }
  }
  return files;
}
