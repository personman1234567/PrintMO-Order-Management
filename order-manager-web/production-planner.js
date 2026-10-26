/* Optional planning only. All production mutations remain with the order board. */
(() => {
  function setup() {
    const model = window.ProductionPlannerModel, section = document.getElementById('print-section');
    if (!model || !section) return;
    const el = (tag, copy = '', className = '') => {
      const node = document.createElement(tag); node.className = className; node.textContent = copy; return node;
    };
    const button = (copy, action, className = '') => {
      const node = el('button', copy, className); node.type = 'button'; node.addEventListener('click', action); return node;
    };
    const format = value => Number(value).toLocaleString('en-US');
    const countOrders = value => `${format(value)} ${value === 1 ? 'order' : 'orders'}`;
    const candidate = () => document.body.dataset.orderSource === 'shopify';
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const options = () => ({ garment: window.OrderGarmentSummary, variant: window.CartGarmentModel.variant,
      isGarmentItem: window.isGarmentItem, accountingForOrder: window.blanksBatchFoundation?.accountingForOrder });
    const data = () => model.build(window.getOrderManagerBoardSnapshot?.() || [], options());
    const available = () => window.getOrderManagerProductionWorkload?.()?.available === true;
    const context = el('div', '', 'production-planning-context'); context.hidden = true;
    const runLink = button('', () => open('run'), 'production-run-link'); runLink.hidden = true;
    const filterLabel = el('span');
    const clearFilterButton = button('Show all', clearFilter); clearFilterButton.hidden = true;
    context.append(runLink, filterLabel, clearFilterButton);
    document.getElementById('col-print').before(context);

    const dialog = document.createElement('dialog'); dialog.id = 'production-planner';
    dialog.setAttribute('aria-labelledby', 'production-planner-title');
    dialog.innerHTML = '<header class="production-planner-heading"><div><h2 id="production-planner-title" tabindex="-1">Production planner</h2><p>Full order quantities in To Print</p></div><button type="button" data-close>Close</button></header><div class="production-planner-toolbar"><div class="production-planner-tabs" role="tablist" aria-label="Planning scope"><button type="button" role="tab" data-scope="queue" aria-controls="production-planner-body" aria-selected="true">All queued</button><button type="button" role="tab" data-scope="run" aria-controls="production-planner-body" aria-selected="false" tabindex="-1">Today’s run</button></div><label>Group by<select data-group><option value="garment">Garment type</option><option value="setup">Print placements</option></select></label><label>Blanks status<select data-material><option value="all">All statuses</option><option value="ready">Ready / received</option><option value="waiting">Pending</option><option value="unknown">Unknown</option></select></label><label class="production-planner-search">Find orders or garments<input type="search" maxlength="120" data-query placeholder="Order, customer, garment, color…"></label></div><p class="production-planner-status" role="status" aria-live="polite"></p><div id="production-planner-body" class="production-planner-body" role="tabpanel"><section class="production-planner-garments" aria-label="Garment quantities"><div class="production-planner-summary"></div><div class="production-planner-groups"></div></section><aside class="production-planner-orders" aria-label="Orders for the shared run"><div class="production-planner-order-heading"><h3>Orders</h3><span data-matched></span></div><div class="production-planner-bulk"><button type="button" data-select-all>Select matching</button><button type="button" data-deselect>Clear selection</button></div><div class="production-planner-order-list"></div><div class="production-planner-selection"><p data-selection></p><button type="button" data-add>Add selected to today’s run</button><button type="button" data-remove>Remove selected from run</button><button type="button" data-clear-run>Clear shared run</button><button type="button" data-retry hidden>Retry shared run</button></div></aside></div>';
    document.body.append(dialog);
    const $ = selector => dialog.querySelector(selector);
    const groups = $('.production-planner-groups'), orders = $('.production-planner-order-list');
    const status = $('.production-planner-status'), summary = $('.production-planner-summary');
    const state = { scope: 'queue', groupBy: 'garment', material: 'all', query: '' };
    const chosen = new Set(), expanded = new Set();
    let run = { revision: 0, orders: [], updatedAt: null }, known = false, runError = '', busy = false;
    let filter = null, pendingMutation = null, fetchPromise = null, lastRead = 0, frame = 0, opener = null;
    let currentBrowse = { jobs: [], groups: [], total: 0 }, animation;
    const runKeys = () => new Set(run.orders.map(model.key));
    const dateLabel = order => window.OrderDetailState?.targetDatePresentation(order);
    function report(copy, error = false) { status.textContent = copy; status.dataset.error = String(error); }
    function matchesOrder(order) {
      if (!candidate() || !filter || order.productionStage === 'completed') return true;
      if (filter.run) return runKeys().has(model.key(order));
      return (order.items || []).some(item => {
        const eligible = Object.hasOwn(order.printEligibility || {}, item.id) ? order.printEligibility[item.id] : window.isGarmentItem(item);
        if (!eligible || !(Number(item.qty) > 0)) return false;
        if (filter.type) return model.typeId(item, window.OrderGarmentSummary) === filter.type;
        const facts = window.CartGarmentModel.variant(item);
        return JSON.stringify([item.title || 'Untitled garment', facts.color]) === filter.style;
      });
    }
    function repaintBoard() {
      window.setActivePrintView?.('toPrint', { render: false });
      window.renderStatusColumn?.('print'); updateContext();
      const cards = document.getElementById('col-print');
      if (filter && cards) cards.dataset.emptyMessage = 'No orders match this selection. Choose Show all to restore the queue.';
      document.dispatchEvent(new CustomEvent('printmo:production-planning-filter'));
    }
    function clearFilter() { filter = null; repaintBoard(); }
    function applyFilter(next) { filter = next; close(); repaintBoard(); }
    function filterType(type) {
      applyFilter({ type, label: `Orders containing ${String(model.categories[type] || 'other garments').toLowerCase()}` });
    }
    function updateContext() {
      const snapshot = data(), saved = runKeys();
      const activeJobs = snapshot.jobs.filter(job => saved.has(job.key));
      runLink.hidden = !candidate() || !activeJobs.length;
      runLink.textContent = `Today’s run · ${countOrders(activeJobs.length)}${available()
        ? ` · ${format(activeJobs.reduce((sum, job) => sum + job.quantity, 0))} garments` : ''}`;
      runLink.title = runError ? 'Last saved shared run. Open the planner to refresh.' : 'Open the shared production run';
      filterLabel.textContent = filter?.label || '';
      clearFilterButton.hidden = !filter;
      context.hidden = !candidate() || (runLink.hidden && !filter);
    }
    async function refreshRun(force = false) {
      if (!candidate() || document.hidden || !window.api?.getProductionRun) return;
      if (fetchPromise) return fetchPromise;
      if (!force && known && Date.now() - lastRead < 20000) return;
      fetchPromise = (async () => {
        try {
          const next = await window.api.getProductionRun();
          if (!next || !Array.isArray(next.orders) || !Number.isInteger(next.revision)) throw new Error('Shared run unavailable.');
          if (next.revision >= run.revision) run = next;
          known = true; runError = ''; lastRead = Date.now();
        } catch (error) { runError = error.message || 'The shared run could not load.'; }
        finally {
          fetchPromise = null;
          if (candidate()) { updateContext(); if (dialog.open) render(); }
        }
      })();
      return fetchPromise;
    }
    async function save(operation) {
      if (busy || !known) return;
      const snapshot = data();
      const selection = operation === 'clear' ? [] : snapshot.jobs.filter(job => chosen.has(job.key)).map(job => job.identity);
      if (operation !== 'clear' && !selection.length) return;
      const signature = JSON.stringify([operation, selection]);
      if (!pendingMutation || pendingMutation.signature !== signature) pendingMutation = { signature, body: {
        expectedVersion: run.revision, operation, orders: selection, idempotencyKey: crypto.randomUUID()
      } };
      busy = true; renderSelection(); report('Saving shared run…');
      try {
        let next;
        try { next = await window.api.updateProductionRun(pendingMutation.body); }
        catch (error) {
          if (error.code !== 'VERSION_CONFLICT') throw error;
          await refreshRun(true);
          if (runError || operation === 'clear') throw new Error('The shared run changed. Review its latest selection before trying again.');
          pendingMutation.body = { ...pendingMutation.body, expectedVersion: run.revision, idempotencyKey: crypto.randomUUID() };
          next = await window.api.updateProductionRun(pendingMutation.body);
        }
        if (next.revision >= run.revision) run = next;
        known = true; runError = ''; lastRead = Date.now(); pendingMutation = null;
        for (const id of selection) chosen.delete(model.key(id));
        if (operation === 'clear') chosen.clear();
        report(operation === 'clear' ? 'Shared run cleared.' : 'Shared run saved for the shop.');
        if (filter?.run) repaintBoard();
      } catch (error) { report(`${error.message} Your selection is kept. You can close the planner and continue working.`, true); }
      finally { busy = false; updateContext(); if (dialog.open) render(); }
    }
    function renderSelection() {
      const jobs = data().jobs.filter(job => chosen.has(job.key));
      $('[data-selection]').textContent = jobs.length
        ? `${countOrders(jobs.length)} selected${available() ? ` · ${format(jobs.reduce((sum, job) => sum + job.quantity, 0))} garments` : ''}`
        : 'Select whole orders to add or remove from the shared run.';
      $('[data-add]').disabled = busy || !known || !jobs.length;
      $('[data-remove]').disabled = busy || !known || !jobs.some(job => runKeys().has(job.key));
      $('[data-clear-run]').hidden = !run.orders.length;
      $('[data-clear-run]').disabled = busy || !known;
      $('[data-retry]').hidden = !runError;
      $('[data-select-all]').disabled = !currentBrowse.jobs.length;
      $('[data-deselect]').disabled = !chosen.size;
    }
    function readiness(group) {
      return [[group.ready, 'blanks ready'], [group.waiting, 'blanks pending'], [group.unknown, 'status unknown']]
        .filter(([qty]) => qty > 0).map(([qty, label]) => `${format(qty)} ${label}`).join(' · ');
    }
    function detailRow(id, title, quantity, className) {
      const detail = el('details', '', className); detail.open = expanded.has(id);
      detail.addEventListener('toggle', () => detail.open ? expanded.add(id) : expanded.delete(id));
      const heading = el('summary'); heading.append(el('span', title), el('strong', format(quantity)));
      detail.append(heading); return detail;
    }
    function render() {
      const snapshot = data(), saved = runKeys();
      for (const id of chosen) if (!snapshot.jobs.some(job => job.key === id)) chosen.delete(id);
      const focused = document.activeElement?.dataset.plannerOrder;
      currentBrowse = model.browse(snapshot, { ...state, run: run.orders });
      for (const tab of dialog.querySelectorAll('[data-scope]')) {
        const active = tab.dataset.scope === state.scope;
        tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
      }
      summary.replaceChildren();
      summary.append(el('h3', state.scope === 'run' ? 'Today’s shared run' : 'Garments in queue'),
        el('span', `${available() ? format(currentBrowse.total) : '—'} garments · ${countOrders(currentBrowse.jobs.length)}`));
      const note = el('p', state.groupBy === 'setup'
        ? 'Recorded print placements only. Review artwork and press settings on the order.'
        : 'Blanks readiness uses receiving records or explicitly marked readiness. Print readiness remains separate.');
      summary.append(note);
      if (runError && !status.textContent) report(`Shared run unavailable. ${runError} Garment browsing is still available.`, true);
      groups.replaceChildren();
      if (!available()) groups.append(el('p', 'Complete garment quantities are not available yet. Refresh orders to retry.', 'production-planner-empty'));
      else if (!currentBrowse.groups.length) groups.append(el('p', state.scope === 'run' && !run.orders.length
        ? 'No run is set. Choose All queued and select orders whenever you want to plan one.'
        : 'No matching garments. Adjust the search or blanks filter.', 'production-planner-empty'));
      else for (const group of currentBrowse.groups) {
        const detail = detailRow(`${state.groupBy}:${group.id}`, group.label, group.quantity, 'production-planner-group');
        const info = el('p', `${countOrders(group.jobKeys.size)} · ${readiness(group)}`, 'production-planner-group-facts');
        const dated = currentBrowse.jobs.filter(job => group.jobKeys.has(job.key) && job.targetDate)
          .sort((a, b) => a.targetDate.localeCompare(b.targetDate));
        const target = dated.length && dateLabel(dated[0].order);
        if (target) { const due = el('span', ` · Earliest: ${target.label}`); due.dataset.tone = target.tone; info.append(due); }
        detail.append(info);
        for (const style of group.styles) {
          const inner = detailRow(`${state.groupBy}:${group.id}:${style.key}`, `${style.title} · ${style.color}`, style.quantity, 'production-planner-style');
          const sizes = [...style.sizes.entries()].sort((a, b) => model.compareSizes(a[0], b[0]));
          inner.append(el('p', sizes.map(([size, qty]) => `${size} ${format(qty)}`).join(' · '), 'production-planner-sizes'));
          inner.append(button(`View ${countOrders(style.jobKeys.size)}`, () => applyFilter({ style: style.key,
            label: `Orders containing ${style.title} · ${style.color}` }), 'production-planner-text-action'));
          detail.append(inner);
        }
        if (state.groupBy === 'garment') detail.append(button(`View ${countOrders(group.jobKeys.size)}`, () => filterType(group.id), 'production-planner-text-action'));
        groups.append(detail);
      }
      orders.replaceChildren();
      for (const job of currentBrowse.jobs) {
        const row = el('div', '', 'production-planner-order');
        const label = el('label'), checkbox = document.createElement('input');
        checkbox.type = 'checkbox'; checkbox.checked = chosen.has(job.key); checkbox.dataset.plannerOrder = job.key;
        checkbox.setAttribute('aria-label', `Select ${job.name}`);
        checkbox.addEventListener('change', () => { checkbox.checked ? chosen.add(job.key) : chosen.delete(job.key); renderSelection(); });
        const copy = el('span'); copy.append(el('strong', job.name));
        const partial = job.order.canonical?.commerce?.lineItemsComplete === false || job.order.canonical?.sync?.partial;
        copy.append(el('span', `${partial ? 'Quantity unavailable' : `${format(job.quantity)} garments`} · ${job.printsReady ? 'Prints marked ready' : 'Prints not marked ready'}`));
        const due = dateLabel(job.order);
        if (due) { const target = el('span', due.label); target.dataset.tone = due.tone; copy.append(target); }
        if (saved.has(job.key)) copy.append(el('span', 'In today’s run', 'production-planner-in-run'));
        label.append(checkbox, copy); row.append(label);
        row.append(button('Open order', () => { close(); window.openDetail?.(job.order); }, 'production-planner-text-action'));
        orders.append(row);
      }
      if (!currentBrowse.jobs.length) orders.append(el('p', 'No matching orders.', 'production-planner-empty'));
      $('[data-matched]').textContent = `${format(currentBrowse.jobs.length)} shown`;
      renderSelection();
      if (focused) [...orders.querySelectorAll('input')].find(node => node.dataset.plannerOrder === focused)?.focus({ preventScroll: true });
    }
    function open(scope = 'queue') {
      if (!candidate()) return;
      opener = document.activeElement;
      state.scope = scope; state.query = ''; state.material = 'all'; chosen.clear();
      $('[data-query]').value = ''; $('[data-material]').value = 'all'; report(''); render();
      if (!dialog.open) dialog.showModal();
      if (!reduced.matches) { animation?.cancel(); animation = dialog.animate([
        { opacity: .6, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }
      ], { duration: 180, easing: 'cubic-bezier(.16, 1, .3, 1)' }); }
      $('#production-planner-title').focus();
      void refreshRun(true); void window.blanksBatchFoundation?.hydrateAccounting?.();
    }
    function close() {
      if (!dialog.open) return;
      animation?.cancel(); dialog.close();
      if (opener?.isConnected && opener.getClientRects().length) opener.focus({ preventScroll: true });
      else document.getElementById('production-workload-toggle')?.focus({ preventScroll: true });
    }
    $('[data-close]').addEventListener('click', close);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close();
    });
    for (const tab of dialog.querySelectorAll('[data-scope]')) {
      tab.addEventListener('click', () => { state.scope = tab.dataset.scope; report(''); render(); });
      tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); state.scope = event.key === 'Home' ? 'queue' : event.key === 'End' ? 'run' : state.scope === 'queue' ? 'run' : 'queue';
        render(); $(`[data-scope="${state.scope}"]`).focus();
      });
    }
    $('[data-group]').addEventListener('change', event => { state.groupBy = event.target.value; render(); });
    $('[data-material]').addEventListener('change', event => { state.material = event.target.value; render(); });
    $('[data-query]').addEventListener('input', event => { state.query = event.target.value; render(); });
    $('[data-select-all]').addEventListener('click', () => { currentBrowse.jobs.forEach(job => chosen.add(job.key));
      orders.querySelectorAll('input').forEach(node => { node.checked = true; }); renderSelection(); });
    $('[data-deselect]').addEventListener('click', () => { chosen.clear(); orders.querySelectorAll('input').forEach(node => { node.checked = false; }); renderSelection(); });
    $('[data-add]').addEventListener('click', () => save('add'));
    $('[data-remove]').addEventListener('click', () => save('remove'));
    $('[data-clear-run]').addEventListener('click', () => save('clear'));
    $('[data-retry]').addEventListener('click', async () => { await refreshRun(true); if (!runError) report('Shared run refreshed.'); });
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; if (!candidate()) return;
        updateContext(); if (dialog.open) render(); void refreshRun(); });
    };
    for (const name of ['printmo:board-updated', 'printmo:production-workload-updated', 'printmo:blanks-accounting-updated']) document.addEventListener(name, schedule);
    document.addEventListener('click', event => { if (event.target.closest('#print-view-printed') && filter) { filter = null; updateContext(); } });
    new MutationObserver(() => {
      if (!candidate() || (document.body.dataset.activeView && document.body.dataset.activeView !== 'orders')) {
        filter = null; close(); context.hidden = true;
      } else schedule();
    }).observe(document.body, { attributes: true, attributeFilter: ['data-order-source', 'data-active-view'] });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshRun(true); });
    window.addEventListener('focus', () => { if (candidate()) void refreshRun(true); });
    setInterval(() => { if (candidate() && (!document.body.dataset.activeView || document.body.dataset.activeView === 'orders')) void refreshRun(); }, 20000);
    reduced.addEventListener('change', () => animation?.cancel());
    window.productionPlanner = { open, filterType, clearFilter, matchesOrder, filterLabel: () => filter?.label || '',
      typeOrderCount: type => data().jobs.filter(job => job.lines.some(line => line.type === type)).length };
    schedule();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, { once: true }); else setup();
})();
