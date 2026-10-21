/* Purchasing requirements only: never reads or changes the supplier cart. */
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CartGarmentModel = api;
})(typeof window === 'undefined' ? globalThis : window, () => {
  const text = value => String(value ?? '').trim();
  const compare = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  const orderKey = order => `${order._provider || 'shopify'}:${order._orderKey || order._gid || order.name}`;
  const fingerprint = order => JSON.stringify([order._version, (order.items || []).map(item =>
    [item.id, item.sku, item.supplierSku, item.qty, item.title, item.variantTitle, item.customAttributes, item.properties])]);
  function variant(item) {
    const attributes = { ...Object.fromEntries((item.customAttributes || []).filter(a => a?.key).map(a => [a.key.toLowerCase(), a.value])), ...item.properties };
    const named = keys => Object.entries(attributes).find(([key]) => keys.includes(key.toLowerCase()))?.[1];
    const parts = text(item.variantTitle).split(/\s*\/\s*/).filter(Boolean);
    const sizePattern = /^(?:(?:youth |adult |women['’]?s? |men['’]?s? )?(?:[2-6]?x[sl]|xx[sl]|xs|s|m|l|xl|small|medium|large|extra large)|\d+(?:-\d+)?[ty]?|one size(?: fits all)?|osfa|os)$/i;
    const sizePart = parts.find(part => sizePattern.test(part));
    const size = text(named(['size', 'garment size'])) || sizePart || '';
    const color = text(named(['color', 'colour', 'garment color', 'garment colour'])) || parts.filter(part => part !== sizePart).join(' / ');
    return { size: size || 'Size unspecified', color: color || 'Color unspecified', raw: text(item.variantTitle) };
  }
  function build(orders, { isPrint = () => false, isVisible = () => true, shelfFor = () => null } = {}) {
    const selected = orders.filter(order => order._candidate && order.status === 'blanks' && !Number(order.blanksOrdered) && isVisible(order));
    const lines = [], issues = [], seen = new Set();
    for (const order of selected) {
      const key = orderKey(order);
      if (seen.has(key)) continue;
      seen.add(key);
      const [number, ...customer] = text(order.name).split(' – ');
      const source = { key, number, customer: customer.join(' – '), name: order.name, order };
      const shelf = (order._provider || 'shopify') === 'shopify' ? shelfFor(order) : { lines: [] };
      for (const [index, item] of (order.items || []).entries()) {
        const quantity = Number(item.qty);
        if (!Number.isFinite(quantity) || quantity <= 0 || isPrint(item)) continue;
        const sku = text(item.supplierSku || item.sku);
        const line = { ...variant(item), key: `${key}:${item.id || index}`, source, title: text(item.title) || 'Untitled item', sku, quantity, shelf: 0, expected: quantity, reason: '' };
        if (!sku) {
          line.expected = null; line.reason = 'Manual / other item · no supplier SKU';
        } else if (!shelf || shelf.status === 'loading') {
          line.expected = null; line.reason = 'Checking shelf allocations';
        } else if (shelf.status === 'unavailable' || !Array.isArray(shelf.lines)) {
          line.expected = null; line.reason = 'Shelf allocation unavailable';
        } else {
          const claim = shelf.lines.find(entry => String(entry.lineItemId) === String(item.id));
          if (shelf.needsReview || claim?.needsReview || (claim && (Number(claim.quantity) !== quantity || !Number.isFinite(Number(claim.claimed)) || Number(claim.claimed) < 0 || Number(claim.claimed) > quantity))) {
            line.expected = null; line.reason = 'Shelf allocation needs review';
          } else {
            line.shelf = Number(claim?.claimed || 0);
            line.expected = quantity - line.shelf;
          }
        }
        if (line.reason) issues.push(line);
        lines.push(line);
      }
    }
    const aggregate = input => {
      const rows = new Map();
      for (const line of input) {
        // Supplier SKU is the purchasing identity. Unmapped items stay separate.
        const key = line.sku ? `sku:${line.sku}` : line.key;
        if (!rows.has(key)) rows.set(key, { key, title: line.title, color: line.color, size: line.size, sku: line.sku,
          quantity: 0, expected: 0, shelf: 0, sources: [], reasons: new Set(), labels: new Set() });
        const row = rows.get(key);
        row.quantity += line.quantity; row.shelf += line.shelf;
        row.expected = row.expected === null || line.expected === null ? null : row.expected + line.expected;
        row.sources.push(line);
        if (line.reason) row.reasons.add(line.reason);
        row.labels.add(`${line.title} · ${line.color} · ${line.size}`);
      }
      return [...rows.values()].sort((a, b) => compare(a.title, b.title) || compare(a.color, b.color) || compare(a.size, b.size) || compare(a.sku, b.sku));
    };
    const rows = aggregate(lines);
    const groups = [...new Map(lines.map(line => [line.source.key, line.source])).values()]
      .sort((a, b) => compare(a.number, b.number))
      .map(source => ({ ...source, rows: aggregate(lines.filter(line => line.source.key === source.key)) }));
    return { rows, groups, issues, orderCount: seen.size, total: lines.reduce((sum, line) => sum + line.quantity, 0),
      expected: lines.filter(line => line.expected !== null).reduce((sum, line) => sum + line.expected, 0),
      shelf: lines.reduce((sum, line) => sum + line.shelf, 0), unresolved: issues.reduce((sum, line) => sum + line.quantity, 0) };
  }
  return { build, orderKey, fingerprint, variant };
});
