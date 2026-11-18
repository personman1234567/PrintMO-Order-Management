import {preparedPriceProducts} from './prepared-price-products.mjs';
import {handleStudioCheckoutRequest,studioServiceRequests} from './studio-checkout.mjs';
import {fixtureBulkResponse,fixtureCalculated} from './prepared-order-discounts.test-support.mjs';
export const gid=id=>'gid://shopify/ProductVariant/'+id;
const sessionId='83f0b76a-1f1c-4d00-9fa1-36845d0a7890';
const design=(type='image',side='front')=>({revision:'a'.repeat(64),prints:type?[{type,side,design:{xIn:1,yIn:1,wIn:3,hIn:3,rotation:0}}]:[],canvasCalibration:{bySide:{front:{referenceWidthIn:12,safeWidthIn:12,safeHeightIn:15}}}});
export const item=(id='a',variant=1,quantity=12,type='image',side='front')=>({id,variantId:gid(variant),quantities:{[gid(variant)]:quantity},design:design(type,side),instructions:'Please center.'});
const service=(assetKey='shared',itemId='a')=>({key:'background-removal',variantId:gid(900),assetKey,itemId,side:'front',note:''});
let fixtureNumber=0;
export function fixture(){
  const objects=new Map(),uploads=[],calls=[],created=[],drafts=new Map();let version=0;
  const state={price:'10.00',servicePrice:'7.00',sku:'PM-ART-BG-REMOVE',available:true,eligible:true,failUpload:0,hiddenColors:[],retailPrice:'19.97',retailAvailable:true,retailPublished:true,retailPartner:'gid://shopify/Metaobject/44',retailBundle:false,retailSubscription:false,customPartner:''};
  const bucket={objects,async get(key){const entry=objects.get(key);return entry?{etag:entry.etag,json:async()=>structuredClone(entry.value)}:null;},async put(key,body,options={}){const prev=objects.get(key);if(options.onlyIf?.etagDoesNotMatch==='*'&&prev)return null;if(options.onlyIf?.etagMatches&&prev?.etag!==options.onlyIf.etagMatches)return null;const value={value:JSON.parse(body),etag:String(++version)};objects.set(key,value);return value;}};
  const env={R2_BUCKET:bucket,SHOPIFY_SHOP_DOMAIN:'test.myshopify.com'};
  const product=id=>({id:'gid://shopify/Product/'+id,status:'ACTIVE',title:'Shirt '+id,handle:'shirt-'+id,image:'',config:{placements:{},hiddenColors:state.hiddenColors},variants:[{id:gid(id),price:state.price,availableForSale:state.available,title:'Blue / S',selectedOptions:[{name:'Color',value:'Blue'},{name:'Size',value:'S'}]}]});
  const deps={graphql:async(_env,query,variables)=>{
    calls.push({query,variables});
    if(query.includes('StudioMerchandise'))return {data:{nodes:variables.ids.map(id=>({id,title:'Blue / Small',price:state.retailPrice,availableForSale:state.retailAvailable,requiresComponents:state.retailBundle,product:{id:'gid://shopify/Product/1001',title:'Official merchandise',status:'ACTIVE',onlineStoreUrl:state.retailPublished?'https://print-mo.com/products/merch':null,requiresSellingPlan:state.retailSubscription,partner:{value:state.retailPartner}}}))}};
    if(query.includes('StudioCheckoutVariants'))return {data:{nodes:variables.ids.map(id=>{const n=Number(id.split('/').pop());return {id,price:n===900?state.servicePrice:state.price,sku:n===900?state.sku:'SHIRT',availableForSale:state.available,title:'Default',product:{id:'gid://shopify/Product/'+n,title:n===900?'Background removal':'Shirt '+n,status:'ACTIVE',partner:{value:n===1001?state.retailPartner:state.customPartner}}};})}};
    if(query.includes('PreparedRecipientCommerce'))return {data:{nodes:variables.ids.map(id=>{const n=Number(id.split('/').pop()),p=product(n);return id.includes('/ProductVariant/')?{...p.variants[0],product:{id:p.id,status:p.status}}:{...p,designerConfig:{value:JSON.stringify(p.config)}};})}};
    if(query.includes('PreparedCheckoutPrices'))return {data:{nodes:variables.ids.map(id=>({id,price:'5.00',product:{handle:'printing'}}))}};
    const bulk=fixtureBulkResponse(query,variables,{prices:{[gid(1)]:state.price,[gid(2)]:state.price,[gid(3)]:state.price,[gid(900)]:state.servicePrice,[gid(1001)]:state.retailPrice},eligible:id=>Number(id.split('/').pop())===1?state.eligible:[900,1001].includes(Number(id.split('/').pop()))});
    if(bulk)return bulk;
    if(query.includes('PreparedCheckoutScopes'))return {data:{currentAppInstallation:{accessScopes:[{handle:'write_draft_orders'}]}}};
    if(query.includes('PreparedCheckoutCreate')){created.push(variables.input);const draft={id:'gid://shopify/DraftOrder/'+created.length,invoiceUrl:'https://test.myshopify.com/invoice/'+created.length,status:'OPEN',input:variables.input,...fixtureCalculated(variables.input)};drafts.set(draft.id,draft);return {data:{draftOrderCreate:{draftOrder:draft,userErrors:[]}}};}
    if(query.includes('PreparedCheckoutRecover'))return {data:{draftOrders:{nodes:[...drafts.values()].filter(d=>d.input.tags.includes(variables.query.replace(/^tag:/,'')))}}};
    throw Error('Unexpected query');
  },drafts:{detail:async id=>({items:drafts.get(id).input.lineItems.map((line,index)=>({id:'line-'+index,customAttributes:line.customAttributes}))}),handle:async request=>{const form=await request.formData(),file=form.get('file');if(state.failUpload){state.failUpload--;throw Error('Temporary production upload failure');}uploads.push({role:form.get('role'),placement:form.get('placement'),lines:JSON.parse(form.get('lineItemIds')),name:file.name,text:await file.text()});}}};
  const prepared={priceProducts:(record,items)=>preparedPriceProducts(env,deps.graphql,record,items,JSON.parse),product:async()=>{throw Error('Studio price checks must not load the full catalog');},asset:async()=>{throw Error('Ordinary Studio must use embedded exported artwork');}};
  const ip='fixture-'+(++fixtureNumber);
  const post=(path,body,origin='https://print-mo.com')=>handleStudioCheckoutRequest(new Request('https://worker.test/order-manager/v1/studio-checkout/'+path,{method:'POST',headers:{Origin:origin,'CF-Connecting-IP':ip},body:JSON.stringify(body)}),env,deps,prepared);
  const quote=body=>post('quote',body);
  const checkout=(quoted,body={})=>post(quoted.id+'/checkout',{snapshotId:quoted.snapshotId,quoteId:quoted.quoteId,sessionId,artwork:{a:{front:'<svg>ORDINARY FRONT</svg>'}},...body});
  return {state,env,objects,uploads,calls,created,drafts,post,quote,checkout};
}
