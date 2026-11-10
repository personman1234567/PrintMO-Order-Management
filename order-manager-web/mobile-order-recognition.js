/* Mobile-only recognition. Canonical board and detail preview selection stays untouched. */
((root, factory) => {
  const api = factory(root, typeof module === 'object' && module.exports ? require('./order-garment-summary') : root.OrderGarmentSummary);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MobileOrderRecognition = api;
})(typeof window === 'undefined' ? globalThis : window, (root, garmentModel) => {
  const deliveryLabels = { pickup: 'Pickup', shipping: 'Shipping', 'local-delivery': 'Local delivery',
    'pickup-point': 'Pickup point', 'in-store': 'In-store', none: 'No delivery', mixed: 'Mixed delivery', unknown: 'Check delivery' };
  const identity = asset => String(asset?.assetId || asset?.id || asset?.url || '');
  const imageUrl = value => /^(?:https?:\/\/|blob:|data:image\/)/i.test(String(value || '')) ? String(value) : '';
  const assetsFor = order => {
    const found = new Map();
    for (const asset of [...(order?.assets || []), ...(order?.items || []).flatMap(item => item.assets || [])]) {
      if (asset && asset.role !== 'mobile-preview' && asset.previewKind !== 'mobile-front') found.set(identity(asset), asset);
    }
    return [...found.values()];
  };
  function attributes(item) {
    return { ...(item?.properties || {}), ...Object.fromEntries((item?.customAttributes || []).map(value => [value.key, value.value])) };
  }
  function validFront(order) {
    const asset = order?.mobilePreview || order?.canonical?.production?.mobilePreview;
    if (!order?._candidate || asset?.role !== 'mobile-preview' || asset.side !== 'front' || asset.previewKind !== 'mobile-front') return null;
    const item = (order.items || []).find(value => value.id && value.id === asset.lineItemId && Number(value.qty) > 0);
    if (!item) return null;
    const values = attributes(item), designRef = values._designRef || values._design_ref;
    if (asset.designRef && designRef && asset.designRef !== designRef) return null;
    return asset;
  }
  function preview(order) {
    // A staff-supplied replacement keeps the existing canonical override priority.
    const manual = typeof root.getManualMockupsForOrder === 'function' ? root.getManualMockupsForOrder(order) : [];
    const replacement = manual.find(asset => asset._previewState !== 'failed' && imageUrl(asset.url));
    if (replacement) return { url: imageUrl(replacement.url), kind: 'mockup', state: 'ready', identity: identity(replacement), side: replacement.side || '' };
    const front = validFront(order);
    const assets = assetsFor(order);
    const mockups = assets.filter(asset => asset.role === 'mockup' || /(?:^|[/_-])side\.(?:png|jpe?g|webp)(?:$|\?)/i.test(asset.name || asset.filename || asset.url || ''));
    const catalog = (order?.items || []).map(item => item.catalogPreview).filter(Boolean);
    const artwork = assets.filter(asset => asset.role === 'design');
    // The wide phone proof preserves the complete combined mockup; an associated
    // front derivative remains a fallback when no combined proof is available.
    for (const [kind, choices] of [['mockup', [...manual, ...mockups]], ['front', front ? [front] : []], ['artwork', artwork], ['catalog', catalog]]) {
      const asset = choices.find(value => value._previewState !== 'failed' && imageUrl(value.url));
      if (asset) return { url: imageUrl(asset.url), kind, state: 'ready', identity: identity(asset), side: asset.side || '' };
    }
    const candidates = [front, ...manual, ...mockups, ...artwork, ...catalog].filter(Boolean);
    const state = candidates.some(asset => asset._previewState !== 'failed' && !imageUrl(asset.url)) ? 'loading'
      : candidates.some(asset => asset._previewState === 'failed') ? 'failed'
        : typeof root.getProductionMockupState === 'function' ? root.getProductionMockupState(order, false) : 'unavailable';
    return { url: '', kind: 'garment', state, identity: '', side: '' };
  }
  function describe(order = {}) {
    const groups = garmentModel?.models(order) || [];
    const partial = order.canonical?.commerce?.lineItemsComplete === false || Boolean(order.canonical?.sync?.partial);
    const garments = groups.slice(0, 2).map(group => ({ label: group.label, qty: group.qty }));
    const ids = new Set();
    for (const group of groups) for (const line of group.lines || []) {
      const values = attributes(line), id = values._group_id || values.group_id;
      if (id) ids.add(id);
    }
    const moreLabel = partial ? 'Item details may be incomplete' : groups.length > 2
      ? `${groups.length - 2} more garment/color ${groups.length === 3 ? 'combination' : 'combinations'} · View items`
      : ids.size > 1 ? 'Multiple item groups · View items' : '';
    const method = order.canonical?.commerce?.deliveryMethod || order.deliveryMethod;
    const kind = method?.complete === true && Object.hasOwn(deliveryLabels, method.kind) ? method.kind : 'unknown';
    return { preview: preview(order), garments, moreLabel, partial,
      delivery: { kind, label: deliveryLabels[kind] } };
  }
  function markPreviewFailed(order, key) {
    const candidates = [validFront(order), ...assetsFor(order), ...(order?.items || []).map(item => item.catalogPreview),
      ...(typeof root.getManualMockupsForOrder === 'function' ? root.getManualMockupsForOrder(order) : [])].filter(Boolean);
    for (const asset of candidates) if (identity(asset) === key) asset._previewState = 'failed';
  }
  return { describe, markPreviewFailed, validFront };
});
