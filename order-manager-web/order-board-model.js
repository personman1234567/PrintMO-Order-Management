(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OrderBoardModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const STAGES = Object.freeze([
    { id: 'received', label: 'Pipeline' },
    { id: 'to_order', label: 'Build Order' },
    { id: 'blanks_cart', label: 'In S&S Cart' },
    { id: 'blanks_ordered', label: 'Ordered' },
    { id: 'print', label: 'To Print' },
    { id: 'completed', label: 'Printed' }
  ].map(Object.freeze));
  const flag = value => Boolean(Number(value || 0));
  const quantity = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;

  function orderKey(order) {
    const provider = String(order?._provider || order?.source?.provider || (order?._candidate ? 'shopify' : 'legacy')).toLowerCase();
    const id = order?._orderKey || order?._gid || order?.canonical?.orderKey || order?.canonical?.id;
    // Candidate display names can change or collide across providers.
    if (order?._candidate && !id) return null;
    return JSON.stringify([provider, String(id || order?.name || '')]);
  }

  function stageForOrder(order) {
    if (order?.productionStage) return order.productionStage;
    if (order?.status === 'toOrder') return 'to_order';
    if (order?.status === 'blanks') return flag(order.blanksOrdered) ? 'blanks_ordered' : 'blanks_cart';
    if (order?.status === 'print') return 'print';
    return order?.status || 'received';
  }

  function materialState(ordered, ready) {
    // Preserve the recorded milestones independently; do not infer approval.
    return Object.freeze({ ordered: flag(ordered), ready: flag(ready),
      label: flag(ready) ? 'Ready' : flag(ordered) ? 'Ordered' : 'Not ordered' });
  }

  function quantities(order, { isPrintItem = () => false, isGarmentItem = () => false } = {}) {
    return (order?.items || []).reduce((totals, item) => {
      const qty = quantity(item?.qty);
      if (isPrintItem(item)) totals.prints += qty;
      else if (isGarmentItem(item)) totals.garments += qty;
      else totals.other += qty;
      totals.pieces += qty;
      totals.lines += 1;
      return totals;
    }, { garments: 0, prints: 0, other: 0, pieces: 0, lines: 0 });
  }

  function printableTotal(order, { isGarmentItem = () => false } = {}) {
    const overrides = order?._candidate ? order.printEligibility || {} : {};
    return (order?.items || []).reduce((total, item) => {
      const included = Object.hasOwn(overrides, item.id) ? overrides[item.id] : isGarmentItem(item);
      return total + (included ? quantity(item.qty) : 0);
    }, 0);
  }

  function progress(order, total) {
    const printed = quantity(order?.progress);
    const printable = quantity(total);
    return { printed, printable, percent: printable ? Math.round(printed / printable * 100) : 0 };
  }

  // This is the existing Pipeline triage heuristic, not a production gate or
  // canonical exception record. Both presentations can use the same rule.
  function evaluateTriage(order, { totals, designCount = 0, hasMockup = false, now = Date.now() }) {
    const received = Date.parse(order?.receivedAt || '');
    const age = Number.isFinite(received) ? Math.max(0, (Number(now) - received) / 36e5) : 0;
    const ready = flag(order?.blanksStatus) && flag(order?.printsStatus);
    const stale = age >= 48;
    const aging = age >= 24;
    const missingMockup = !hasMockup;
    const missingFiles = totals.prints > 0 && designCount === 0;
    const needsBlanks = totals.apparel > 0 && !flag(order?.blanksOrdered);
    const needsPrints = totals.prints > 0 && !flag(order?.printsOrdered);
    const partialReady = !ready && (flag(order?.blanksStatus) || flag(order?.printsStatus));
    let score = stale ? 45 : aging ? 20 : 0;
    if (missingFiles) score += 32;
    if (missingMockup) score += 18;
    if (needsBlanks) score += 18;
    if (needsPrints) score += 14;
    if (partialReady) score += 10;
    if (ready) score -= 40;
    const tags = ['all'];
    if (!ready && score >= 30) tags.push('attention');
    if (stale) tags.push('stale');
    if (missingMockup) tags.push('missing-mockup');
    if (missingFiles) tags.push('missing-files');
    if (ready) tags.push('ready');
    let label = 'Queued', tone = 'neutral';
    if (ready) { label = 'Ready'; tone = 'ready'; }
    else if (missingFiles) { label = 'Missing files'; tone = 'danger'; }
    else if (stale) { label = 'Stale'; tone = 'danger'; }
    else if (missingMockup) { label = 'No mockup'; tone = 'warning'; }
    else if (needsBlanks) { label = 'Needs blanks'; tone = 'warning'; }
    else if (needsPrints) { label = 'Needs prints'; tone = 'warning'; }
    else if (partialReady) { label = 'Partly ready'; tone = 'progress'; }
    return { age, designCount, label, missingFiles, missingMockup, needsBlanks,
      needsPrints, score: Math.max(0, score), stale, tags, tone, totals, ready };
  }

  function indicators(row) {
    const result = [];
    const add = (label, tone = 'warning', needsAttention = true) => result.push({ label, tone, needsAttention });
    if (row.attention.required) {
      if (row.attention.reasons.length) row.attention.reasons.forEach(reason => add(reason, 'danger'));
      else add('Review needed', 'danger');
    }
    if (row.accounting?.lines?.some(line => line.allocationPending)) add('Allocation needs review');
    if (row.accounting?.missingGarments > 0) add(`${row.accounting.missingGarments} blanks missing`);
    if (row.stage === 'print' && !row.materials.prints.ready) add('Prints pending · do not press', 'danger');
    if (row.stage === 'received' && row.triage && !['Queued', 'Ready'].includes(row.triage.label)) {
      add(row.triage.label, row.triage.tone, row.triage.tags.includes('attention'));
    }
    if (row.partial) add('Some data unavailable');
    if (row.stage === 'completed') add('Awaiting handoff', 'neutral', false);
    else if (!result.length && row.materials.blanks.ready && row.materials.prints.ready) add('Materials marked ready', 'neutral', false);
    if (row.hasItemInstructions) add('Item instructions', 'neutral', false);
    if (row.stale) add('Cached data', 'neutral', false);
    return result;
  }

  function summarize(order, options = {}) {
    const key = orderKey(order);
    if (!key) return null;
    const stage = stageForOrder(order);
    const name = String(order.name || '');
    const separator = name.includes(' – ') ? ' – ' : ' - ';
    const parts = name.split(separator);
    const materials = {
      blanks: materialState(order.blanksOrdered, order.blanksStatus),
      prints: materialState(order.printsOrdered, order.printsStatus)
    };
    const attention = order.canonical?.attention || order.canonical?.production?.attention || order.attention;
    const commerce = order.canonical?.commerce || {};
    const rawTotal = commerce.total;
    const amount = (typeof rawTotal === 'number' || (typeof rawTotal === 'string' && rawTotal.trim() !== ''))
      && Number.isFinite(Number(rawTotal)) ? Number(rawTotal) : null;
    const currency = typeof commerce.currencyCode === 'string' && /^[A-Z]{3}$/.test(commerce.currencyCode)
      ? commerce.currencyCode : null;
    const target = options.targetDatePresentation?.(order, options.now ? new Date(options.now) : undefined) || null;
    // Date filters describe the calendar date even when Printed presentation is neutral.
    const targetFilter = options.targetDatePresentation?.({ ...order, productionStage: 'received' }, options.now ? new Date(options.now) : undefined) || null;
    return Object.freeze({
      key, stage, stageLabel: STAGES.find(value => value.id === stage)?.label || 'Unknown stage',
      number: parts[0] || 'Order', customer: parts.slice(1).join(separator) || 'Name unavailable',
      provider: String(order._provider || order.source?.provider || 'shopify').toLowerCase(),
      synthetic: Boolean(order._synthetic), bundle: order.bundle || '', receivedAt: order.receivedAt || null,
      quantities: quantities(order, options), materials,
      progress: progress(order, printableTotal(order, options)),
      target, targetDate: target ? order.targetDate : null, targetFilter,
      triage: options.evaluateTriage?.(order) || null,
      attention: { required: Boolean(attention?.required), reasons: (Array.isArray(attention?.reasons) ? attention.reasons : []).filter(value => typeof value === 'string' && value.trim()) },
      accounting: options.accountingForOrder?.(order.name) || null,
      supplier: options.supplierSummaryForOrder?.(order.name) || null,
      money: { amount, currency },
      partial: commerce.lineItemsComplete === false || Boolean(order.canonical?.sync?.partial),
      stale: Boolean(order.canonical?.sync?.stale),
      hasItemInstructions: Boolean(options.hasItemInstructions?.(order)),
      financialStatus: order.displayFinancialStatus || null,
      fulfillmentStatus: order.displayFulfillmentStatus || null
    });
  }

  function snapshot(orders, options = {}) {
    const counts = Object.fromEntries(STAGES.map(stage => [stage.id, 0]));
    counts.unknown = 0;
    const rows = [], keys = new Set();
    let identityErrors = 0;
    for (const order of orders || []) {
      if (!order?._candidate || order._historyReadOnly) continue;
      if (options.isVisible && !options.isVisible(order)) continue;
      if (String(order.displayFulfillmentStatus || '').trim().toUpperCase() === 'FULFILLED') continue;
      const row = summarize(order, options);
      if (!row || keys.has(row.key)) { identityErrors += 1; continue; }
      keys.add(row.key);
      rows.push(row);
      counts[Object.hasOwn(counts, row.stage) ? row.stage : 'unknown'] += 1;
    }
    return { rows, counts, total: rows.length, identityErrors };
  }

  const FILTER_DEFAULTS = Object.freeze({ source: 'all', blanks: 'all', prints: 'all', payment: 'all', attention: 'all', target: 'all' });
  const SORTS = new Set(['newest', 'oldest', 'target', 'customer']);
  const normalized = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();

  function filteredRows(data, state) {
    const query = normalized(state.query);
    const filters = state.filters || FILTER_DEFAULTS;
    return data.rows.filter(row => {
      if (query && !normalized(`${row.number} ${row.customer} ${row.bundle}`).includes(query)) return false;
      if (filters.source !== 'all' && filters.source !== row.provider) return false;
      if (filters.blanks !== 'all' && row.materials.blanks.ready !== (filters.blanks === 'ready')) return false;
      if (filters.prints !== 'all' && row.materials.prints.ready !== (filters.prints === 'ready')) return false;
      if (filters.payment !== 'all' && filters.payment !== String(row.financialStatus || 'UNKNOWN').trim().replace(/\s+/g, '_').toUpperCase()) return false;
      if (filters.attention === 'needed' && !indicators(row).some(item => item.needsAttention)) return false;
      if (filters.attention === 'handoff' && row.stage !== 'completed') return false;
      if (filters.target === 'none' && row.targetDate) return false;
      if (filters.target === 'late' && row.targetFilter?.tone !== 'late') return false;
      if (filters.target === 'today' && row.targetFilter?.label !== 'Today') return false;
      if (filters.target === 'tomorrow' && row.targetFilter?.label !== 'Tomorrow') return false;
      return true;
    });
  }

  function browse(data, state) {
    const filtered = filteredRows(data, state);
    const counts = Object.fromEntries([...STAGES.map(stage => stage.id), 'unknown'].map(id => [id, 0]));
    filtered.forEach(row => counts[Object.hasOwn(counts, row.stage) ? row.stage : 'unknown']++);
    const isKnown = stage => STAGES.some(item => item.id === stage);
    const rows = filtered.filter(row => state.stage === 'all' || row.stage === state.stage || (state.stage === 'unknown' && !isKnown(row.stage)));
    const date = row => Number.isFinite(Date.parse(row.receivedAt)) ? Date.parse(row.receivedAt) : null;
    const newest = (a, b) => (date(b) ?? -Infinity) - (date(a) ?? -Infinity) || a.key.localeCompare(b.key);
    rows.sort((a, b) => {
      if (state.sort === 'oldest') return (date(a) ?? Infinity) - (date(b) ?? Infinity) || newest(a, b);
      if (state.sort === 'target') return (a.targetDate || '9999-99-99').localeCompare(b.targetDate || '9999-99-99') || newest(a, b);
      if (state.sort === 'customer') return a.customer.localeCompare(b.customer, 'en', { sensitivity: 'base', numeric: true }) || newest(a, b);
      return newest(a, b);
    });
    return { rows, counts, total: data.total, matched: filtered.length, shown: rows.length };
  }

  function createViewState() {
    let layout = 'board', stage = 'all', query = '', sort = 'newest';
    let filters = { ...FILTER_DEFAULTS };
    return Object.freeze({
      get: () => Object.freeze({ layout, stage, query, sort, filters: Object.freeze({ ...filters }) }),
      setLayout(value) { if (value === 'board' || value === 'list') layout = value; return this.get(); },
      setStage(value) { if (value === 'all' || value === 'unknown' || STAGES.some(item => item.id === value)) stage = value; return this.get(); },
      setQuery(value) { query = String(value || ''); return this.get(); },
      setSort(value) { if (SORTS.has(value)) sort = value; return this.get(); },
      setFilters(value = {}) {
        const allowed = { source: ['all', 'shopify', 'etsy'], blanks: ['all', 'ready', 'not-ready'], prints: ['all', 'ready', 'not-ready'],
          attention: ['all', 'needed', 'handoff'], target: ['all', 'late', 'today', 'tomorrow', 'none'] };
        for (const key of Object.keys(FILTER_DEFAULTS)) {
          if (key === 'payment') { if (typeof value[key] === 'string' && (value[key] === 'all' || /^[A-Z_]+$/.test(value[key]))) filters[key] = value[key]; }
          else if (allowed[key]?.includes(value[key])) filters[key] = value[key];
        }
        return this.get();
      },
      resetFilters() { stage = 'all'; query = ''; filters = { ...FILTER_DEFAULTS }; return this.get(); },
      visibleRows(data) { return browse(data, this.get()).rows; },
      browse(data) { return browse(data, this.get()); }
    });
  }

  function reconcileSelection(selected, visibleKeys) {
    const visible = new Set(visibleKeys);
    const kept = Array.from(new Set(selected)).filter(key => visible.has(key));
    return { selected: kept, removed: Array.from(new Set(selected)).filter(key => !visible.has(key)) };
  }

  function actionEligibility(action, selectedKeys, orders, destination) {
    const selected = Array.from(new Set(selectedKeys));
    const active = snapshot(orders).rows;
    const activeKeys = new Set(active.map(row => row.key));
    const resolved = selected.map(key => orders.filter(order => orderKey(order) === key));
    const deny = reason => ({ enabled: false, reason });
    if (!selected.length) return deny('Select orders first.');
    if (resolved.some(matches => matches.length !== 1) || selected.some(key => !activeKeys.has(key))) return deny('An order is no longer available or its identity is ambiguous. Refresh and review.');
    const jobs = resolved.map(matches => matches[0]);
    if (new Set(jobs.map(order => order._provider)).size !== 1) return deny('Select orders from one source.');
    if (jobs.some(order => order._capabilities?.productionWrite === false || (order._provider !== 'shopify' && order._capabilities?.productionWrite !== true))) return deny('Production changes are not available for every selected order.');
    const stages = jobs.map(stageForOrder);
    if (stages.some(stage => !STAGES.some(item => item.id === stage))) return deny('Review the unknown stage in detail before changing this order.');
    if (action === 'supplier' || action === 'ordered') {
      if (jobs.some(order => order._provider !== 'shopify' || order._capabilities?.supplierBatch === false)) return deny('This list supplier workflow is available for Shopify orders only.');
      if (stages.some(stage => stage !== (action === 'supplier' ? 'to_order' : 'blanks_cart'))) return deny(action === 'supplier' ? 'Select only Build Order jobs.' : 'Select only In S&S Cart jobs.');
      if (action === 'supplier' && jobs.length > 50) return deny('Select up to 50 orders for one S&S submission.');
      if (jobs.some(order => !(order.items || []).some(item => String(item.sku || '').trim() && Number(item.qty) > 0))) return deny('Every order needs supplier garments. Review the items in detail.');
    } else if (action === 'bundle') {
      if (jobs.length < 2) return deny('Select at least two orders to create a bundle.');
      if (jobs.some(order => order.bundle)) return deny('Select unbundled orders to create a new bundle.');
      if (new Set(stages).size !== 1) return deny('Select orders in the same stage to create a bundle.');
    } else if (action === 'unbundle') {
      if (jobs.some(order => !order.bundle)) return deny('Every selected order must belong to a bundle.');
    } else if (action === 'move') {
      if (!['received', 'to_order', 'blanks_cart', 'print'].includes(destination)) return deny('Choose an existing manual destination.');
      if (stages.includes(destination)) return deny('Some selected orders are already in this stage.');
    } else return deny('This action is unavailable.');
    return { enabled: true, reason: '' };
  }

  return Object.freeze({ STAGES, orderKey, stageForOrder, materialState, quantities,
    printableTotal, progress, evaluateTriage, summarize, snapshot, indicators, browse, FILTER_DEFAULTS, createViewState, reconcileSelection, actionEligibility });
});
