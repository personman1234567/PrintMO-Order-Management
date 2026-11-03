/* Copy commands read loaded canonical facts only; they never fetch or mutate an order. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OrderActionModel = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const own = (value, key) => Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
  const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  const text = value => typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim() : '';
  const unavailable = reason => ({ enabled: false, reason, text: '' });
  const available = value => ({ enabled: true, reason: '', text: value });
  const COPY_FIELDS = Object.freeze([
    ['orderNumber', 'Order number'], ['customerName', 'Customer name'], ['lineItems', 'Line items'],
    ['shippingAddress', 'Shipping address'], ['email', 'Email']
  ].map(([id, label]) => Object.freeze({ id, label })));

  function context(order = {}, options = {}) {
    const summary = object(order.canonical) || (order.commerce || order.source ? order : {});
    const detail = object(own(options, 'detail') ? options.detail : order.canonicalDetail);
    const info = object(detail?.detail) || detail;
    const rich = object(detail?.data) || object(info?.data);
    const source = rich?.source || detail?.source || summary.source || order._source || {};
    const provider = text(source.provider || order._provider).toLowerCase();
    return { order, summary, detail, info, rich, source, provider };
  }

  function firstField(objects, key) {
    for (const value of objects) if (own(value, key)) return { present: true, value: value[key] };
    return { present: false, value: undefined };
  }

  function usableName(value) {
    const name = text(value);
    return /^(?:name unavailable|customer name unavailable|no customer name|unknown|unavailable|redacted(?: by shopify)?)$/i.test(name) ? '' : name;
  }

  function nameFor(ctx) {
    // A fresh detail response replaces earlier customer facts, including explicit nulls.
    const holder = ctx.detail ? ctx.info : ctx.summary;
    const delivery = ctx.detail ? ctx.rich?.delivery : ctx.summary;
    const shipping = firstField([delivery, holder], 'shippingAddress').value;
    const billing = firstField([delivery, holder], 'billingAddress').value;
    const customer = firstField(ctx.detail ? [ctx.rich, ctx.info, ctx.detail] : [ctx.summary], 'customer').value;
    return usableName(shipping?.name) || usableName(billing?.name)
      || usableName([text(customer?.firstName), text(customer?.lastName)].filter(Boolean).join(' '))
      || usableName(customer?.displayName);
  }

  function numberFor(ctx) {
    const raw = text(ctx.rich?.displayName || ctx.detail?.displayName || ctx.source.displayNumber || ctx.summary.displayName);
    const backendIds = [ctx.summary.id, ctx.summary.orderKey, ctx.order._gid, ctx.order._orderKey].map(text).filter(Boolean);
    if (!raw || backendIds.includes(raw) || /^(?:gid:\/\/|\[|\{|etsy:|shopify:)/i.test(raw)
      || /^(?:shopify order|order|unknown|unavailable)$/i.test(raw)) return '';
    return raw;
  }

  function lineSource(ctx) {
    if (ctx.detail) {
      const found = firstField([ctx.info, ctx.rich, ctx.detail?.commerce], 'lineItems');
      return found.present ? found.value : null;
    }
    return ctx.summary.commerce?.lineItems;
  }

  function linesComplete(ctx) {
    const flags = ctx.detail
      ? [ctx.rich, ctx.info, ctx.detail?.commerce, ctx.rich?.commerce, ctx.info?.summary?.commerce]
      : [ctx.summary.commerce];
    // Explicit incompleteness always wins, including on provider contracts.
    if (flags.some(value => value?.lineItemsComplete === false)) return false;
    if (ctx.provider === 'shopify') return firstField(flags, 'lineItemsComplete').value === true;
    if (ctx.provider !== 'etsy') return false;
    // Etsy has no Shopify pagination flag: its loaded persisted contract reports partial/errors.
    const sync = ctx.detail ? ctx.detail.sync : ctx.summary.sync;
    const partial = firstField(ctx.detail ? [ctx.info, sync] : [sync], 'partial');
    if (partial.value !== false || sync?.partial === true) return false;
    return ![ctx.info?.errors, sync?.errors].some(errors => Array.isArray(errors) && errors.length);
  }

  const attributeKey = value => text(value).toLowerCase().replace(/^_/, '').replace(/[\s_-]+/g, ' ');
  function optionsFor(item, provider) {
    const attributes = Array.isArray(item.customAttributes) ? item.customAttributes : [];
    const variations = Array.isArray(item.variations) ? item.variations : [];
    const safeVariations = variations.filter(value => !value?.questionId && !/personal/i.test(text(value?.name)));
    const named = provider === 'etsy' && variations.length ? safeVariations
      : [...attributes.map(value => ({ name: value?.key, value: value?.value })), ...safeVariations];
    const color = named.find(value => ['color', 'colour', 'garment color', 'garment colour'].includes(attributeKey(value.name)));
    const size = named.find(value => ['size', 'garment size'].includes(attributeKey(value.name)));
    const colorText = text(color?.value), sizeText = text(size?.value);
    // Source Etsy variations explicitly exclude personalization; never dump custom attributes.
    let variant = provider === 'etsy' && variations.length
      ? safeVariations.map(value => text(value.value)).filter(Boolean).join(' / ')
      : text(item.variantTitle);
    if (/^default title$/i.test(variant)) variant = '';
    const parts = [colorText ? `Color: ${colorText}` : '', sizeText ? `Size: ${sizeText}` : ''].filter(Boolean);
    if (variant && !(colorText && sizeText) && ![colorText, sizeText].includes(variant)) {
      parts.push(parts.length ? `Variant: ${variant}` : variant);
    }
    return parts.join('; ');
  }

  function copyLines(ctx) {
    const items = lineSource(ctx);
    if (!Array.isArray(items) || !linesComplete(ctx)) {
      return unavailable('Complete line items are not loaded. Open order details first.');
    }
    const lines = [];
    for (const item of items) {
      const rawQuantity = item?.currentQuantity ?? item?.quantity ?? item?.qty;
      const quantity = Number(rawQuantity);
      if (rawQuantity == null || !Number.isFinite(quantity) || quantity < 0 || !Number.isInteger(quantity)) {
        return unavailable('A line-item quantity is unavailable.');
      }
      if (!quantity) continue;
      const title = text(item.title);
      if (!title) return unavailable('A line-item product name is unavailable.');
      const variant = optionsFor(item, ctx.provider);
      lines.push(`${quantity} × ${title}${variant ? ` — ${variant}` : ''}`);
    }
    return lines.length ? available(lines.join('\n')) : unavailable('No current line items.');
  }

  function isExplicitPickup(ctx) {
    const method = firstField([ctx.rich?.commerce, ctx.detail?.commerce, ctx.info?.summary?.commerce,
      ctx.summary.commerce], 'deliveryMethod').value;
    if (!object(method) || method.complete !== true) return false;
    if (['pickup', 'pickup-point'].includes(text(method.kind).toLowerCase())) return true;
    // Use the normalized delivery contract, never missing-address or title heuristics.
    const types = Array.isArray(method.types) ? method.types : [method.type || method.methodType].filter(Boolean);
    return !text(method.kind) && types.length > 0
      && types.every(type => ['PICK_UP', 'PICKUP', 'PICKUP_POINT'].includes(text(type).toUpperCase()));
  }

  function copyAddress(ctx) {
    if (isExplicitPickup(ctx)) return unavailable('Shipping address is not applicable for pickup.');
    if (!ctx.detail) return unavailable(ctx.provider === 'etsy'
      ? 'Shipping address is unavailable from Etsy.' : 'Shipping address is not loaded. Open order details first.');
    const address = firstField([ctx.rich?.delivery, ctx.info], 'shippingAddress').value;
    if (!object(address) || ![address.address1, address.address2, address.city, address.zip].some(value => text(value))) {
      return unavailable(ctx.provider === 'etsy' ? 'Shipping address is unavailable from Etsy.'
        : 'Shipping address is unavailable or restricted.');
    }
    const regionPostal = [text(address.provinceCode || address.province), text(address.zip)].filter(Boolean).join(' ');
    const locality = [text(address.city), regionPostal].filter(Boolean).join(', ');
    return available([
      text(address.name), text(address.company), text(address.address1), text(address.address2), locality,
      text(address.country || address.countryCode || address.countryCodeV2)
    ].filter(Boolean).join('\n'));
  }

  function copyEmail(ctx) {
    if (!ctx.detail) return unavailable(ctx.provider === 'etsy'
      ? 'Email is unavailable from Etsy.' : 'Email is not loaded. Open order details first.');
    const customer = firstField([ctx.rich, ctx.info, ctx.detail], 'customer').value;
    const email = text(customer?.email);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ? available(email) : unavailable(ctx.provider === 'etsy' ? 'Email is unavailable from Etsy.'
        : 'Email is unavailable or restricted.');
  }

  function copyField(order, id, options = {}) {
    const ctx = context(order || {}, options);
    if (id === 'orderNumber') {
      const value = numberFor(ctx);
      return value ? available(value) : unavailable('Order number is unavailable.');
    }
    if (id === 'customerName') {
      const value = nameFor(ctx);
      return value ? available(value) : unavailable('Customer name is unavailable or restricted.');
    }
    if (id === 'lineItems') return copyLines(ctx);
    if (id === 'shippingAddress') return copyAddress(ctx);
    if (id === 'email') return copyEmail(ctx);
    return unavailable('This copy action is unavailable.');
  }

  function canRemoveFromBoard(order) {
    const key = text(order?._orderKey || order?._gid);
    const sourceProvider = order?.canonical?.source?.provider;
    return Boolean(order?._candidate && order._provider === 'etsy'
      && /^etsy:[^:\s]+:[^:\s]+$/.test(key)
      && (!sourceProvider || sourceProvider === 'etsy')
      && !order._historyReadOnly && order._capabilities?.productionWrite === true
      && text(order.displayFulfillmentStatus).toUpperCase() !== 'FULFILLED');
  }

  const copyFields = (order, options = {}) => COPY_FIELDS.map(field => ({ ...field, ...copyField(order, field.id, options) }));
  return Object.freeze({ COPY_FIELDS, copyField, copyFields, canRemoveFromBoard });
});
