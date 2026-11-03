/* Read-only presentation facts for mobile Detail; no pricing or workflow decisions. */
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MobileDetailSummary = api;
})(typeof window === 'undefined' ? globalThis : window, () => {
  const deliveryLabels = {
    pickup: 'Pickup', shipping: 'Shipping', 'local-delivery': 'Local delivery',
    'pickup-point': 'Pickup point', 'in-store': 'In-store', none: 'No delivery',
    mixed: 'Mixed delivery', unknown: 'Check delivery'
  };
  const paymentLabels = {
    PAID: 'Paid', PARTIALLY_PAID: 'Partially paid', PENDING: 'Payment pending',
    AUTHORIZED: 'Authorized', REFUNDED: 'Refunded', PARTIALLY_REFUNDED: 'Partially refunded',
    VOIDED: 'Voided', EXPIRED: 'Expired', UNPAID: 'Unpaid'
  };
  const fulfillmentLabels = {
    FULFILLED: 'Fulfilled', UNFULFILLED: 'Unfulfilled', PARTIALLY_FULFILLED: 'Partially fulfilled',
    IN_PROGRESS: 'In progress', ON_HOLD: 'On hold', SCHEDULED: 'Scheduled',
    REQUEST_DECLINED: 'Request declined', RESTOCKED: 'Restocked', OPEN: 'Open',
    PENDING_FULFILLMENT: 'Pending fulfillment', SHIPPED: 'Shipped', UNSHIPPED: 'Unshipped'
  };
  const text = value => typeof value === 'string' ? value.trim() : '';
  const has = (value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key);
  // An explicit null from the current response must not revive an older board value.
  function field(sources, key) {
    for (const source of sources) if (has(source, key)) return source[key];
    return undefined;
  }
  function money(value, currency) {
    const raw = value && typeof value === 'object' ? value.amount : value;
    if (!['number', 'string'].includes(typeof raw) || (typeof raw === 'string' && !raw.trim())) return null;
    const amount = Number(raw);
    if (!Number.isFinite(amount)) return null;
    const code = text(value?.currencyCode || currency).toUpperCase();
    return { amount, currencyCode: /^[A-Z]{3}$/.test(code) ? code : null };
  }
  function describe(order = {}, result = order.canonical || {}) {
    const rich = result.data || result.detail?.data || {};
    const commerceSources = [rich.commerce, result.commerce, order];
    const currency = field(commerceSources, 'currencyCode');
    const currentDiscounts = field(commerceSources, 'discounts');
    const discounts = currentDiscounts === undefined ? field(commerceSources, 'discount') : currentDiscounts;
    const customer = rich.customer || result.detail?.customer || result.customer || order.customer;
    const customerLabel = text(typeof customer === 'string' ? customer : customer?.displayName) || 'Customer unavailable';
    const orderLabel = text(rich.displayName) || text(result.displayName) || text(result.detail?.displayName)
      || (order.orderNumber != null ? `#${String(order.orderNumber).replace(/^#/, '')}` : text(order.name)) || 'Order';
    const currentStatus = field(commerceSources, 'financialStatus');
    const rawStatus = currentStatus === undefined ? field(commerceSources, 'displayFinancialStatus') : currentStatus;
    const normalizedStatus = text(rawStatus).toUpperCase();
    const status = has(paymentLabels, normalizedStatus) ? normalizedStatus : 'UNKNOWN';
    const currentFulfillment = field(commerceSources, 'fulfillmentStatus');
    const rawFulfillment = currentFulfillment === undefined
      ? field(commerceSources, 'displayFulfillmentStatus') : currentFulfillment;
    const normalizedFulfillment = text(rawFulfillment).toUpperCase();
    const fulfillmentStatus = has(fulfillmentLabels, normalizedFulfillment) ? normalizedFulfillment : 'UNKNOWN';
    const method = field([rich.commerce, result.commerce, order], 'deliveryMethod');
    // A bounded fulfillment-order array cannot establish completeness by itself.
    const kind = method?.complete === true && has(deliveryLabels, method.kind) ? method.kind : 'unknown';
    return {
      customerLabel, orderLabel,
      total: money(field(commerceSources, 'total'), currency),
      charges: {
        subtotal: money(field(commerceSources, 'subtotal'), currency),
        shipping: money(field(commerceSources, 'shipping'), currency),
        tax: money(field(commerceSources, 'tax'), currency),
        discounts: money(discounts, currency)
      },
      payment: {
        status, label: paymentLabels[status] || 'Payment status unavailable',
        outstanding: money(field(commerceSources, 'outstanding'), currency)
      },
      fulfillment: { status: fulfillmentStatus, label: fulfillmentLabels[fulfillmentStatus] || 'Unknown' },
      delivery: { kind, label: deliveryLabels[kind], complete: kind !== 'unknown' },
      freshness: {
        stale: result.sync?.stale === true,
        partial: result.sync?.partial === true || result.detail?.partial === true || rich.partial === true
      }
    };
  }
  function associatedItems(asset, items = []) {
    const lineItemIds = [...new Set([
      ...(Array.isArray(asset?.lineItemIds) ? asset.lineItemIds : []), asset?.lineItemId
    ].filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];
    const byId = new Map(items.filter(item => item && typeof item.id === 'string').map(item => [item.id, item]));
    const matched = lineItemIds.filter(id => byId.has(id));
    return {
      scope: lineItemIds.length ? 'items' : 'order', lineItemIds,
      items: matched.map(id => byId.get(id)),
      unresolvedLineItemIds: lineItemIds.filter(id => !byId.has(id))
    };
  }
  return { describe, associatedItems };
});
