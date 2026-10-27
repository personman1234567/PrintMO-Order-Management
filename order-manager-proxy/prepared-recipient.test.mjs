import test from 'node:test';
import assert from 'node:assert/strict';
import {recipientTemplate,recipientDesigns,recipientArtwork} from './prepared-recipient.mjs';
import {resolveItemPrints} from './prepared-order-links.mjs';
const art={id:'art',type:'image',side:'front',design:{xIn:2,yIn:3,wIn:4,hIn:4,rotation:15},asset:{assetId:'a'.repeat(64),mime:'image/png'}};
const record={items:[{id:'image',handle:'unlisted',productId:'p',variantId:'gid://shopify/ProductVariant/1',project:null,printMode:'manual'},
  {id:'editor',handle:'listed',productId:'p',variantId:'gid://shopify/ProductVariant/1',project:{prints:[art],canvasCalibration:{bySide:{front:{referenceWidthIn:14,safeWidthIn:14,safeHeightIn:20}}}}}]};
const product={title:'Shirt',handle:'shirt',config:{placements:{}},variants:[{id:'gid://shopify/ProductVariant/1',selectedOptions:[{name:'Color',value:'Navy'}]}]};
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
