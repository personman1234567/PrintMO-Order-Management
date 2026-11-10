// Synthetic Shopify calculation responses; never connects to a shop.
export const fixtureMoney = cents => ({presentmentMoney:{amount:(cents/100).toFixed(2),currencyCode:'USD'}});
export function fixtureCalculated(input) {
  const lineItems=input.lineItems.map(line=>{
    const gross=Math.round(Number(line.priceOverride.amount)*100)*line.quantity;
    const discount=line.appliedDiscount?Math.floor(gross*line.appliedDiscount.value/100):0;
    return {uuid:line.uuid,quantity:line.quantity,originalTotalSet:fixtureMoney(gross),discountedTotalSet:fixtureMoney(gross-discount)};
  });
  const gross=lineItems.reduce((sum,line)=>sum+Math.round(Number(line.originalTotalSet.presentmentMoney.amount)*100),0);
  const net=lineItems.reduce((sum,line)=>sum+Math.round(Number(line.discountedTotalSet.presentmentMoney.amount)*100),0);
  return {lineItems,subtotalPriceSet:fixtureMoney(net),totalDiscountsSet:fixtureMoney(gross-net),platformDiscounts:[]};
}
export function fixtureBulkResponse(query,variables,{prices={},eligible=id=>!Number(id.split('/').pop())||Number(id.split('/').pop())<100,currency='USD'}={}) {
  if(query.includes('PreparedBulkCommerce'))return {data:{shop:{currencyCode:currency},nodes:variables.ids.map(id=>({id,price:prices[id]??(id.endsWith('/46714190201080')?'8.00':Number(id.split('/').pop())<100?'10.00':'5.00'),product:{bulkEligible:eligible(id)}}))}};
  if(query.includes('PreparedBulkCalculate'))return {data:{draftOrderCalculate:{calculatedDraftOrder:fixtureCalculated(variables.input),userErrors:[]}}};
  return null;
}
