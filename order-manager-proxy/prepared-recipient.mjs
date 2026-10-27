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

export async function recipientTemplate(record, items, service, sourceTemplate) {
  const workspaces = [];
  for (const item of record.items) {
    const commerce = items.find(value=>value.id===item.id), product = await service.product(item.productId);
    const selected = product.variants.find(value=>value.id===item.variantId);
    const color = selected?.selectedOptions.find(option=>/^colou?r$/i.test(option.name))?.value || item.color || commerce.color || '';
    const originals = sourceTemplate?.workspaces?.find(value=>value.id===item.id)?.design?.prints || [];
    const prints = (item.project?.prints || []).map(print=>({...print,asset:{...print.asset,url:originals.find(value=>value.id===print.id)?.asset?.url || ''}}));
    if (prints.some(print=>!print.asset.url)) throw Object.assign(new Error('The saved artwork could not load. Refresh this customer link in Order Manager.'),{code:'ARTWORK_UNAVAILABLE',status:409});
    const variants = commerce.variants.map(variant=>{const image=product.variants.find(value=>value.id===variant.id)?.image;return {id:Number(variant.id.split('/').pop()),color,size:variant.size==='One size'?'':variant.size,priceCents:variant.priceCents,available:true,image:(typeof image==='string'?image:image?.url)||product.image||''}});
    const images = commerce.images || [];
    workspaces.push({id:item.id,handle:product.handle||item.handle,title:product.title,image:product.image||'',
      variants,config:{...product.config,colors:[product.config.colors?.find(value=>value.name===color)||{name:color,tintHex:'#808080'}],...(variants.every(v=>!v.size)?{oneSize:true}:{})},
      selectedVariantId:Number(item.variantId.split('/').pop()),color,activeVariantColor:color,customerInstructions:item.instructions||'',
      preparedItem:{editable:prints.length>0,images,printMode:item.printMode||'auto',prints:commerce.prints},
      design:{...item.project,prints,selectedIds:[],panelView:'none',textValue:'',rotationInput:0,activeSide:item.project?.activeSide||'front',selectedColor:color,selectedSize:variants[0]?.size||'',selectedVariantId:Number(item.variantId.split('/').pop()),sizeQty:{}}
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
      const match = preview.match(/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/);
      if (match) files.push({itemId:item.id,side:'other',mime:match[1],base64:match[2]});
    }
  }
  return files;
}
