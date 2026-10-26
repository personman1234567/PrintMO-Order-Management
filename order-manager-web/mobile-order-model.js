/* Mobile-only browsing state. Orders always come from the shared board snapshot. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./order-board-model'));
  else root.MobileOrderModel = factory(root.OrderBoardModel);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (board) {
  const AREAS = Object.freeze(['orders', 'supplies', 'print', 'more']);
  const LOCAL_STAGES = Object.freeze({ supplies: ['to_order', 'blanks_cart', 'blanks_ordered'], print: ['print', 'completed'] });
  const SORT_KEY = 'printmo:order-manager:mobile-sorts:v1';
  const SORTS = new Set(['newest', 'oldest', 'target', 'rush', 'customer']);
  function create(storage) {
    let saved;
    try { saved = JSON.parse(storage?.getItem(SORT_KEY) || '{}'); } catch { saved = {}; }
    const views = Object.fromEntries(AREAS.slice(0, 3).map(area => [area, {
      query: '', stage: area === 'orders' ? 'all' : LOCAL_STAGES[area][0],
      sort: SORTS.has(saved?.[area]) ? saved[area] : 'newest',
      filters: { ...board.FILTER_DEFAULTS }, scrollTop: 0
    }]));
    const get = area => ({ ...views[area], filters: { ...views[area].filters } });
    return Object.freeze({
      get,
      update(area, patch) {
        const view = views[area];
        if (!view) throw new Error('Unknown mobile work area.');
        if ('query' in patch) view.query = board.normalizeSearchQuery(patch.query);
        if (SORTS.has(patch.sort)) view.sort = patch.sort;
        const allowed = area === 'orders' ? ['all', 'unknown', ...board.STAGES.map(stage => stage.id)] : LOCAL_STAGES[area];
        if (allowed.includes(patch.stage)) view.stage = patch.stage;
        if (Number.isFinite(patch.scrollTop)) view.scrollTop = Math.max(0, patch.scrollTop);
        if (patch.filters) {
          const state = board.createViewState(); state.setFilters(patch.filters);
          view.filters = state.get().filters;
        }
        if ('sort' in patch) {
          try { storage?.setItem(SORT_KEY, JSON.stringify(Object.fromEntries(Object.entries(views).map(([key, value]) => [key, value.sort])))); } catch { /* Optional preference. */ }
        }
        return get(area);
      },
      clear(area) { views[area].query = ''; views[area].filters = { ...board.FILTER_DEFAULTS }; if (area === 'orders') views[area].stage = 'all'; },
      browse(area, snapshot) {
        const state = board.createViewState(), view = views[area];
        state.setStage(view.stage); state.setQuery(view.query); state.setSort(view.sort); state.setFilters(view.filters);
        return state.browse(snapshot);
      }
    });
  }
  function progressInput(order, value, total) {
    if (!order || order._historyReadOnly || order._capabilities?.productionWrite === false) return { error: 'This order is read only.' };
    if (!['print', 'completed'].includes(board.stageForOrder(order))) return { error: 'This order is no longer in Print. Review its current stage.' };
    if (order.canonical?.commerce?.lineItemsComplete === false || order.canonical?.sync?.partial || !Number.isInteger(total) || total <= 0) return { error: 'The printable total is unavailable. Refresh and review the order.' };
    if (order._eligibilityMutationPending || order._progressMutationPending) return { error: 'Wait for the current production change to finish.' };
    if (String(value).trim() === '' || !Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > total) return { error: `Enter a whole number from 0 to ${total}.` };
    const count = Number(value), stage = board.stageForOrder(order);
    return { count, label: count === total ? 'Save and move to Printed' : stage === 'completed' ? 'Save and return to To Print' : 'Save quantity' };
  }
  return Object.freeze({ AREAS, LOCAL_STAGES, SORT_KEY, create, progressInput });
});
