// Direct Prepared Order checkout only. Shopify owns money allocation and rounding.
export const PREPARED_BULK_POLICY = 'prepared-bulk-v1';
export const PREPARED_BULK_COLLECTION = 'gid://shopify/Collection/482306556152';
export const PREPARED_BULK_COMMERCE = `query PreparedBulkCommerce($ids: [ID!]!) {
  shop { currencyCode }
  nodes(ids: $ids) { ... on ProductVariant { id price product { bulkEligible: inCollection(id: "${PREPARED_BULK_COLLECTION}") } } }
}`;
export const PREPARED_BULK_CALCULATE = `mutation PreparedBulkCalculate($input: DraftOrderInput!) {
  draftOrderCalculate(input: $input) {
    calculatedDraftOrder {
      subtotalPriceSet { presentmentMoney { amount currencyCode } }
      totalDiscountsSet { presentmentMoney { amount currencyCode } }
      platformDiscounts { title }
      lineItems { uuid quantity originalTotalSet { presentmentMoney { amount currencyCode } } discountedTotalSet { presentmentMoney { amount currencyCode } } }
    }
    userErrors { field message }
  }
}`;

const fail = (code, message, status = 502) => { throw Object.assign(new Error(message), {code, status}); };
const attribute = (line, key) => line.customAttributes?.find(value => value.key === key)?.value;
export const preparedBulkRate = quantity => quantity >= 72 ? .20 : quantity >= 48 ? .15 : quantity >= 24 ? .10 : quantity >= 12 ? .05 : 0;
export function preparedMoneyCents(amount) {
  if (typeof amount !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(amount)) fail('PRICE_UNAVAILABLE', 'Current prices could not be verified. Refresh the order price.');
  const [whole, fraction = ''] = amount.split('.'), cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) fail('PRICE_UNAVAILABLE', 'Current prices could not be verified. Refresh the order price.');
  return cents;
}
const money = value => {
  if (value?.presentmentMoney?.currencyCode !== 'USD') fail('CURRENCY_UNSUPPORTED', 'This prepared checkout must be priced in US dollars. Contact Print-MO.');
  return preparedMoneyCents(value.presentmentMoney.amount);
};
export function verifyPreparedBulkTotals(draft, pricing) {
  if (money(draft?.subtotalPriceSet) !== pricing.checkoutSubtotalCents || money(draft?.totalDiscountsSet) !== pricing.discountCents)
    fail('CHECKOUT_PRICE_CHANGED', 'Shopify returned a different checkout price. Contact Print-MO before purchasing.', 409);
}
const data = result => {
  if (result?.ok === false || result?.errors?.length || !result?.data) fail('PRICE_UNAVAILABLE', 'Shopify could not verify the order price. Retry the order price.');
  return result.data;
};

/** Accept only lines constructed from the validated private Prepared Order snapshot. */
export async function calculatePreparedBulk(env, deps, lines, items) {
  const pricing = {policyVersion: PREPARED_BULK_POLICY, currencyCode: 'USD', eligibleQuantity: 0, rate: 0, subtotalCents: 0, discountCents: 0, checkoutSubtotalCents: 0};
  const input = {presentmentCurrencyCode: 'USD', acceptAutomaticDiscounts: false, allowDiscountCodesInCheckout: false, discountCodes: [], lineItems: []};
  if (!lines.length) return {pricing, input};
  const ids = [...new Set(lines.map(line => line.variantId))];
  const commerce = data(await deps.graphql(env, PREPARED_BULK_COMMERCE, {ids}, 'PreparedBulkCommerce'));
  if (commerce.shop?.currencyCode !== 'USD') fail('CURRENCY_UNSUPPORTED', 'This prepared checkout must be priced in US dollars. Contact Print-MO.');
  const variants = new Map((commerce.nodes || []).filter(Boolean).map(variant => [variant.id, variant]));
  const eligibleBatches = new Set();
  for (const line of lines) {
    const variant = variants.get(line.variantId);
    if (!variant || typeof variant.product?.bulkEligible !== 'boolean') fail('PRICE_UNAVAILABLE', 'A selected product could not be verified. Refresh the order price.');
    if (attribute(line, '_batch_role') === 'garment' && variant.product.bulkEligible) {
      pricing.eligibleQuantity += line.quantity;
      eligibleBatches.add(attribute(line, '_batch_id'));
    }
  }
  pricing.rate = preparedBulkRate(pricing.eligibleQuantity);
  input.lineItems = lines.map((line, index) => {
    const item = items.find(value => value.id === attribute(line, '_preparedItemId'));
    const expected = attribute(line, '_batch_role') === 'garment'
      ? item?.variants.find(value => value.id === line.variantId)?.priceCents
      : item?.prints.find(value => 'gid://shopify/ProductVariant/' + value.variantId === line.variantId)?.priceCents;
    const unitCents = preparedMoneyCents(variants.get(line.variantId).price);
    if (unitCents !== expected) fail('PRICE_CHANGED', 'A price changed while checking this order. Refresh the order price.', 409);
    pricing.subtotalCents += unitCents * line.quantity;
    const discounted = pricing.rate > 0 && eligibleBatches.has(attribute(line, '_batch_id'));
    return {...line, uuid: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      // Lock the server-verified base price across calculation, creation and checkout.
      priceOverride: {amount: (unitCents / 100).toFixed(2), currencyCode: 'USD'},
      ...(discounted ? {appliedDiscount: {title: `Bulk discount (${pricing.rate * 100}% off)`, valueType: 'PERCENTAGE', value: pricing.rate * 100}} : {})};
  });
  const result = data(await deps.graphql(env, PREPARED_BULK_CALCULATE, {input}, 'PreparedBulkCalculate')).draftOrderCalculate;
  if (result?.userErrors?.length || !result?.calculatedDraftOrder) fail('PRICE_UNAVAILABLE', 'Shopify could not calculate this order. Retry the order price.');
  const calculated = result.calculatedDraftOrder;
  if (calculated.platformDiscounts?.length || calculated.lineItems?.length !== input.lineItems.length) fail('PRICE_UNAVAILABLE', 'The checkout calculation changed. Retry the order price.');
  const calculatedLines = new Map(calculated.lineItems.map(line => [line.uuid, line]));
  let gross = 0, net = 0;
  for (const line of input.lineItems) {
    const actual = calculatedLines.get(line.uuid);
    const expected = preparedMoneyCents(line.priceOverride.amount) * line.quantity;
    if (!actual || actual.quantity !== line.quantity || money(actual.originalTotalSet) !== expected) fail('PRICE_CHANGED', 'The checkout calculation changed. Refresh the order price.', 409);
    const discounted = money(actual.discountedTotalSet);
    if (discounted > expected || !line.appliedDiscount && discounted !== expected) fail('PRICE_UNAVAILABLE', 'The checkout calculation changed. Retry the order price.');
    gross += expected; net += discounted;
  }
  pricing.discountCents = money(calculated.totalDiscountsSet);
  pricing.checkoutSubtotalCents = money(calculated.subtotalPriceSet);
  if (gross !== pricing.subtotalCents || net !== pricing.checkoutSubtotalCents || gross - net !== pricing.discountCents) fail('PRICE_UNAVAILABLE', 'The checkout totals could not be verified. Retry the order price.');
  return {pricing, input};
}
