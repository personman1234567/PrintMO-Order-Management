import test from 'node:test';
import assert from 'node:assert/strict';
import {recipientTemplate,recipientDesigns,recipientArtwork,recipientColorPresentation,recipientChoicePresentations} from './prepared-recipient.mjs';
import {resolveItemPrints} from './prepared-order-links.mjs';
const art={id:'art',type:'image',side:'front',design:{xIn:2,yIn:3,wIn:4,hIn:4,rotation:15},asset:{assetId:'a'.repeat(64),mime:'image/png'}};
const record={items:[{id:'image',handle:'unlisted',productId:'p',variantId:'gid://shopify/ProductVariant/1',project:null,printMode:'manual'},
  {id:'editor',handle:'listed',productId:'p',variantId:'gid://shopify/ProductVariant/1',project:{prints:[art],canvasCalibration:{bySide:{front:{referenceWidthIn:14,safeWidthIn:14,safeHeightIn:20}}}}}]};
const product={title:'Shirt',handle:'shirt',config:{placements:{}},variants:[{id:'gid://shopify/ProductVariant/1',selectedOptions:[{name:'Color',value:'Navy'}]}]};

test('recipient swatches use exact Shopify solids and textures with saved/configured fallback, never fabricated gray',async()=>{
  const native={...product,swatches:{NAVY:{color:'#172840',image:'https://cdn.shopify.com/navy.png'}},config:{placements:{},colors:[{name:'Navy',tintHex:'#000000'}]}};
  const commerce=record.items.map(item=>({id:item.id,variants:[{id:item.variantId,size:'M',priceCents:1000}],prints:[],images:[]}));
  const template=await recipientTemplate(record,commerce,{product:async()=>native},{workspaces:[{id:'editor',design:{prints:[{...art,asset:{url:'https://art.test/art.png'}}]}}]});
  assert.deepEqual(template.workspaces[0].config.colors,[{name:'Navy',tintHex:'#172840',swatchImage:'https://cdn.shopify.com/navy.png'}]);
  assert.equal(recipientColorPresentation(product,{color:'Navy',swatch:{color:'#123456'}},'navy').tintHex,'#123456');
  assert.equal(recipientColorPresentation({...product,config:{colors:[{name:'Navy',tintHex:'#142536'}]}},{},'Navy').tintHex,'#142536');
  assert.deepEqual(recipientColorPresentation(product,{},'Unknown'),{name:'Unknown',tintHex:''});
});

test('previously published alternatives recover saved swatches without querying unavailable inactive products',()=>{
  const groups=[{rootId:'image',options:[{id:'image',color:'Navy',config:{colors:[{name:'Navy',tintHex:'#808080'}]}},{id:'alt',color:'Bone',config:{colors:[{name:'Bone',tintHex:'#808080'}]}}]}];
  const saved={items:[...record.items,{id:'alt',color:'Bone',swatch:{color:'#E6DDC6',image:''}}]};
  const result=recipientChoicePresentations(groups,saved,{workspaces:[{id:'image',config:{colors:[{name:'Navy',tintHex:'#172840'}]}}]});
  assert.equal(result[0].options[0].config.colors[0].tintHex,'#172840');
  assert.equal(result[0].options[1].config.colors[0].tintHex,'#E6DDC6');
  assert.equal(groups[0].options[1].config.colors[0].tintHex,'#808080');
});

test('transparent WebP proofs remain associated with the edited production item',()=>{
  const designs={editor:{prints:[art]}},files=recipientArtwork(record,designs,{editor:{front:'<svg xmlns="http://www.w3.org/2000/svg"/>'}},new Set(['editor']),{editor:'data:image/webp;base64,UklGRg=='})
  assert.deepEqual(files.map(file=>[file.itemId,file.side,file.mime]),[['editor','front',undefined],['editor','other','image/webp']])
  assert.equal(recipientArtwork(record,designs,{editor:{front:'<svg/>'}},new Set(),{editor:'data:image/webp;base64,UklGRg=='}).length,0)
});
test('mixed recipient workspaces retain per-item pasted proofs, editable art, calibration and real variants without storefront images',async()=>{
  const items=record.items.map(item=>({id:item.id,variants:[{id:item.variantId,size:'M',priceCents:1000}],prints:[],images:[`https://proof.test/${item.id}.png`]}));
  const result=await recipientTemplate(record,items,{product:async()=>product},{workspaces:[{id:'editor',design:{prints:[{...art,asset:{url:'https://art.test/art.png'}}]}}]});
  assert.equal(result.workspaces[0].preparedItem.editable,false);
  assert.equal(result.workspaces[1].preparedItem.editable,true);
  assert.equal(result.workspaces[0].preparedItem.images[0],'https://proof.test/image.png');
  assert.deepEqual(result.workspaces[1].design.prints[0].design,art.design);
  assert.deepEqual(result.workspaces[1].design.canvasCalibration,record.items[1].project.canvasCalibration);
  assert.equal(result.workspaces[1].design.prints[0].asset.url,'https://art.test/art.png');
  assert.equal(result.workspaces[0].variants[0].id,1);
});
test('customer edits are isolated, recalculated with canonical print classes and cannot modify mockup-only items',()=>{
  const input={editor:{revision:'b'.repeat(64),prints:[{...art,design:{...art.design,wIn:12,hIn:12}}],canvasCalibration:record.items[1].project.canvasCalibration}};
  const edited=recipientDesigns(record,input);
  assert.equal(resolveItemPrints(edited.record.items[1],product)[0].label,'Full Front Print');
  assert.equal(record.items[1].project.prints[0].design.wIn,4);
  assert.throws(()=>recipientDesigns(record,{image:input.editor}),/cannot be edited/);
  assert.throws(()=>recipientDesigns(record,{editor:{...input.editor,prints:[{...art,design:{...art.design,wIn:-1}}]}}));
  const svg='<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h2v2z"/></svg>';
  assert.equal(recipientArtwork(record,edited.designs,{editor:{front:svg}},new Set(['editor']))[0].svg,svg);
  assert.throws(()=>recipientArtwork(record,edited.designs,{editor:{front:'<svg><script>bad()</script></svg>'}},new Set(['editor'])));
  assert.throws(()=>recipientArtwork(record,edited.designs,{},new Set(['editor'])));
});

test('known sizes hydrate for editable and mockup items without changing artwork or variants',async()=>{
  const prepared={items:record.items.map(item=>({...item,sizeQty:{M:3}}))},commerce=record.items.map(item=>({id:item.id,variants:[{id:item.variantId,size:'M',priceCents:1000}],prints:[],images:[]}));
  const template=await recipientTemplate(prepared,commerce,{product:async()=>product},{workspaces:[{id:'editor',design:{prints:[{...art,asset:{url:'https://art.test/art.png'}}]}}]});
  assert.deepEqual(template.workspaces.map(ws=>ws.design.sizeQty),[{M:3},{M:3}]);
  assert.ok(template.workspaces.every(ws=>ws.preparedItem.prefilledQuantities));
  assert.equal(template.workspaces[0].preparedItem.editable,false);assert.equal(template.workspaces[1].preparedItem.editable,true);
});

test('modern recipient hydration reuses per-item published colors and artwork with no Shopify product reads',async()=>{
  const commerce=record.items.map(item=>({id:item.id,variants:[{id:item.variantId,size:'M',priceCents:1000}],prints:[],images:[]}));
  const full=await recipientTemplate(record,commerce,{product:async()=>product},{workspaces:[{id:'editor',design:{prints:[{...art,asset:{url:'https://art.test/art.png'}}]}}]});
  full.workspaces[0].config.colors=[{name:'Navy',tintHex:'#172840'}];full.workspaces[0].image='navy.png';full.workspaces[1].image='other-color.png';
  const loaded=await recipientTemplate(record,commerce,{product:async()=>{throw Error('Catalog must stay off boot')}},full,{preferPublished:true});
  assert.equal(loaded.workspaces[0].image,'navy.png');assert.equal(loaded.workspaces[1].image,'other-color.png');
  assert.equal(loaded.workspaces[1].design.prints[0].asset.url,'https://art.test/art.png');
});
