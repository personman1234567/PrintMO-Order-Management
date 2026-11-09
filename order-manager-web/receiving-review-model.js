/* Receiving suggestions use saved usable quantities, never carrier delivery as receipt. */
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReceivingReviewModel = api;
})(typeof window === 'undefined' ? globalThis : window, () => {
  const whole = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '')
    && Number.isSafeInteger(Number(value)) && Number(value) >= 0;
  function fullAllocations(batch) {
    return (batch?.manifest || []).flatMap(line => {
      if (!line.itemKey || line.allocationConfirmed || !whole(line.expectedQty) || !whole(line.receivedQty)
        || Number(line.expectedQty) <= 0 || Number(line.receivedQty) < Number(line.expectedQty)) return [];
      const quantities = new Map();
      for (const entry of line.orderLines || []) {
        if (!entry.orderName || !whole(entry.expectedQty)) return [];
        quantities.set(entry.orderName, (quantities.get(entry.orderName) || 0) + Number(entry.expectedQty));
      }
      if (quantities.size < 2 || [...quantities.values()].reduce((sum, qty) => sum + qty, 0) !== Number(line.expectedQty)) return [];
      const entries = [...quantities].sort(([a], [b]) => a.localeCompare(b));
      return [{ itemKey: line.itemKey, label: line.title || line.sku || line.itemKey,
        allocations: Object.fromEntries(entries),
        signature: JSON.stringify([line.itemKey, Number(line.expectedQty), Number(line.receivedQty), entries]) }];
    });
  }
  function attentionReasons(batch) {
    const reasons = [];
    const missing = Math.max(0, Number(batch?.missingGarments) || 0);
    const pending = Math.max(0, Number(batch?.pendingAllocationLines) || 0);
    const state = batch?.supplierStatus?.state;
    if (missing) reasons.push(state === 'delivered' ? `Delivered · ${missing} still to check in` : `${missing} garments still to check in`);
    if (pending) reasons.push(`${pending} ${pending === 1 ? 'line needs' : 'lines need'} allocation confirmation`);
    if (['exception', 'canceled', 'not_found'].includes(state)) reasons.push({
      exception: 'Delivery exception', canceled: 'Supplier order canceled', not_found: 'Supplier order not found'
    }[state]);
    return reasons;
  }
  return { fullAllocations, attentionReasons };
});
