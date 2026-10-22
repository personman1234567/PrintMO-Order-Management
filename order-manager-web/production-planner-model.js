((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ProductionPlannerModel = api;
})(typeof window === 'undefined' ? globalThis : window, () => {
  const quantity = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  const identity = order => ({ provider: order._provider || 'shopify', id: order._orderKey || order._gid });
  const key = order => JSON.stringify([order.provider || order._provider || 'shopify', order.id || order._orderKey || order._gid]);
  const categories = { tee: 'T-shirts', hoodie: 'Hoodies', polo: 'Polos', sweatshirt: 'Sweatshirts',
    longsleeve: 'Long-sleeve shirts', tank: 'Tanks', hat: 'Hats', pants: 'Pants & shorts', bag: 'Bags', other: 'Other / unclassified' };
  const queued = orders => (orders || []).filter(order => order._candidate && !order._historyReadOnly
    && order.status === 'print' && order.productionStage !== 'completed'
    && String(order.displayFulfillmentStatus || '').trim().toUpperCase() !== 'FULFILLED');
  const typeId = (item, garment) => {
    const id = garment.garmentType(item)?.id;
    return id === 'pocket-tee' ? 'tee' : Object.hasOwn(categories, id) ? id : 'other';
  };
  function compareSizes(a, b) {
    const rank = value => {
      const normalized = String(value).toLowerCase().replace(/\s+/g, '');
      const values = [['xxs', '2xs'], ['xs', 'extrasmall'], ['s', 'small'], ['m', 'medium'], ['l', 'large'],
        ['xl', 'extralarge'], ['xxl', '2xl', '2xlarge'], ['xxxl', '3xl', '3xlarge'], ['4xl'], ['5xl'], ['6xl']];
      return values.findIndex(names => names.includes(normalized));
    };
    const first = rank(a), second = rank(b);
    return first >= 0 && second >= 0 ? first - second : String(a).localeCompare(String(b), undefined, { numeric: true });
  }
  function build(orders, { garment, variant, isGarmentItem, accountingForOrder = () => null } = {}) {
    const jobs = [], lines = [], seen = new Set();
    for (const order of queued(orders)) {
      const orderKey = key(order);
      if (!identity(order).id || seen.has(orderKey)) continue;
      seen.add(orderKey);
      const accounting = accountingForOrder(order.name);
      const recognized = garment.models(order);
      const job = { key: orderKey, identity: identity(order), order, name: order.name, quantity: 0,
        targetDate: order.targetDate || '', lines: [], printsReady: Boolean(Number(order.printsStatus)) };
      for (const item of order.items || []) {
        const eligible = Object.hasOwn(order.printEligibility || {}, item.id) ? order.printEligibility[item.id] : isGarmentItem(item);
        const qty = quantity(item.qty);
        if (!eligible || !qty) continue;
        const facts = variant(item), type = typeId(item, garment);
        const receipts = (accounting?.lines || []).filter(line => item.id && line.lineId === item.id);
        const uncertain = receipts.some(line => line.allocationPending);
        const ready = uncertain ? 0 : receipts.length
          ? Math.min(qty, receipts.reduce((sum, line) => sum + quantity(line.accountedQty), 0))
          : Number(order.blanksStatus) ? qty : 0;
        const waiting = uncertain ? 0 : receipts.length || Number(order.blanksOrdered) ? qty - ready : 0;
        const locations = recognized.find(group => group.lines.some(line => line === item || (item.id && line.id === item.id)))?.locations || [];
        const setup = [...locations].sort().join('|') || 'unspecified';
        const setupLabel = locations.length ? [...locations].sort().map(id => garment.placementLabels[id] || id).join(' + ') : 'Placement not recorded';
        const line = { itemId: item.id, jobKey: job.key, title: item.title || 'Untitled garment',
          color: facts.color, size: facts.size, type, typeLabel: categories[type], setup, setupLabel,
          quantity: qty, ready, waiting, unknown: qty - ready - waiting };
        lines.push(line); job.lines.push(line); job.quantity += qty;
      }
      jobs.push(job);
    }
    return { jobs, lines, total: lines.reduce((sum, line) => sum + line.quantity, 0) };
  }
  function browse(data, { query = '', material = 'all', scope = 'queue', run = [], groupBy = 'garment' } = {}) {
    const selected = new Set(run.map(key));
    const needle = String(query).trim().toLowerCase().slice(0, 120);
    const jobs = data.jobs.filter(job => (scope !== 'run' || selected.has(job.key))
      && (!needle || `${job.name} ${job.lines.map(line => `${line.title} ${line.color} ${line.size} ${line.typeLabel}`).join(' ')}`.toLowerCase().includes(needle))
      && (material === 'all' || job.lines.some(line => line[material] > 0)));
    const keys = new Set(jobs.map(job => job.key));
    const lines = data.lines.filter(line => keys.has(line.jobKey));
    const groups = new Map();
    for (const line of lines) {
      const id = groupBy === 'setup' ? line.setup : line.type;
      if (!groups.has(id)) groups.set(id, { id, label: groupBy === 'setup' ? line.setupLabel : line.typeLabel,
        quantity: 0, ready: 0, waiting: 0, unknown: 0, jobKeys: new Set(), styles: new Map() });
      const group = groups.get(id);
      for (const field of ['quantity', 'ready', 'waiting', 'unknown']) group[field] += line[field];
      group.jobKeys.add(line.jobKey);
      const styleKey = JSON.stringify([line.title, line.color]);
      if (!group.styles.has(styleKey)) group.styles.set(styleKey, { key: styleKey, title: line.title,
        color: line.color, quantity: 0, sizes: new Map(), jobKeys: new Set() });
      const style = group.styles.get(styleKey);
      style.quantity += line.quantity; style.jobKeys.add(line.jobKey);
      style.sizes.set(line.size, (style.sizes.get(line.size) || 0) + line.quantity);
    }
    const rank = Object.keys(categories);
    const result = [...groups.values()].sort((a, b) => groupBy === 'setup'
      ? a.label.localeCompare(b.label) : rank.indexOf(a.id) - rank.indexOf(b.id));
    for (const group of result) group.styles = [...group.styles.values()].sort((a, b) => a.title.localeCompare(b.title) || a.color.localeCompare(b.color));
    return { jobs, groups: result, total: lines.reduce((sum, line) => sum + line.quantity, 0) };
  }
  return { identity, key, queued, typeId, build, browse, categories, compareSizes };
});
