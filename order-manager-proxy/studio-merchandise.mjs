// Isolated proof adapter. No theme/UI wiring or production flag enables this module.
import {preparedMoneyCents} from './prepared-order-discounts.mjs';

export const STUDIO_MERCHANDISE_QUERY = `query StudioMerchandise($ids:[ID!]!) {
  nodes(ids:$ids) { ... on ProductVariant {
    id title price availableForSale requiresComponents
    product { id title status onlineStoreUrl requiresSellingPlan
      partner:metafield(namespace:"custom",key:"partner_reference"){value}
    }
  } }
}`;
const fail=(code,message,status=400)=>{throw Object.assign(new Error(message),{code,status});};
const GID=/^gid:\/\/shopify\/ProductVariant\/[1-9]\d{0,19}$/;
export function studioMerchandiseRequests(env,input) {
  if(input===undefined)return [];
  if(env.STUDIO_MERCHANDISE_PROOF_ENABLED!=='true')fail('MERCHANDISE_DISABLED','Combined order checkout is not enabled.',409);
  if(!Array.isArray(input)||input.length>50)fail('INVALID_MERCHANDISE','Choose up to 50 merchandise variants.');
  const ids=new Set(),variants=new Set();let count=0;
  return input.map(value=>{
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['id','variantId','quantity'].includes(key))
      ||typeof value.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(value.id)||ids.has(value.id)
      ||!GID.test(value.variantId||'')||variants.has(value.variantId)
      ||!Number.isInteger(value.quantity)||value.quantity<1||value.quantity>9999||(count+=value.quantity)>10000)
      fail('INVALID_MERCHANDISE','Review merchandise variants and quantities.');
    ids.add(value.id);variants.add(value.variantId);
    return {id:value.id,variantId:value.variantId,quantity:value.quantity};
  }).sort((a,b)=>a.id.localeCompare(b.id));
}
export async function studioMerchandiseLines(env,deps,requests,id,snapshotId) {
  if(!requests.length)return {lines:[],items:[],merchandise:[]};
  // Requests are private snapshot values, revalidated on each quote/checkout.
  requests=studioMerchandiseRequests(env,requests);
  const result=await deps.graphql(env,STUDIO_MERCHANDISE_QUERY,{ids:requests.map(v=>v.variantId)},'StudioMerchandise');
  if(result?.ok===false||result?.errors?.length||!result?.data)fail('PRICE_UNAVAILABLE','Merchandise could not be verified. Refresh the order price.',502);
  const variants=new Map((result.data.nodes||[]).filter(Boolean).map(v=>[v.id,v]));
  const lines=[],items=[],merchandise=[];
  for(const request of requests){
    const v=variants.get(request.variantId),p=v?.product;
    // Proof scope is published, one-time, standalone partner merchandise only.
    if(v?.availableForSale!==true||v.requiresComponents!==false||p?.status!=='ACTIVE'||!p.onlineStoreUrl
      ||p.requiresSellingPlan!==false||!/^gid:\/\/shopify\/Metaobject\/[1-9]\d*$/.test(p.partner?.value||''))
      fail('MERCHANDISE_UNAVAILABLE','A merchandise variant is unavailable. Review this item.',409);
    const priceCents=preparedMoneyCents(v.price),itemId='merch:'+request.id;
    items.push({id:itemId,kind:'merchandise',productId:p.id,partnerReference:p.partner.value,variants:[{id:v.id,priceCents}],quantity:request.quantity});
    merchandise.push({...request,productId:p.id,title:p.title,variantTitle:v.title,partnerReference:p.partner.value,priceCents});
    const attributes={_preparedOrderId:id,_preparedConfigId:snapshotId,_preparedItemId:itemId,
      _batch_id:id+':'+itemId,_batch_role:'merchandise',_group_role:'merchandise'};
    lines.push({variantId:v.id,quantity:request.quantity,customAttributes:Object.entries(attributes).map(([key,value])=>({key,value}))});
  }
  return {lines,items,merchandise};
}
