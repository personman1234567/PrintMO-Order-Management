/* Precision Workbench extension: the approved eight-column browse view shares
   cached facts, preserves normal detail, and reviews explicit workflow selections. */
(() => {
  const model = window.OrderBoardModel;
  if (!model) return;
  const state = model.createViewState();
  // Normal Shopify launches expose the optional layout; an explicit 0 keeps the rollback escape hatch.
  const preview = new URLSearchParams(window.location.search).get('printmo_list_preview') !== '0';
  const rowNodes = new Map(), stageNodes = new Map();
  const headings = ['Order / Customer', 'Stage', 'Target / Age', 'Quantities', 'Blanks', 'Print materials / Progress', 'Payment / Total', 'Attention'];
  let pending = false, elements, latest, opener, controlsHome, tabsHome, workflows, busy = false;
  let selected = [], visibleKeys = [], workspace = '', lastResults = [], workflowReturn;
  const actionChoices = [
    ['supplier', 'Add to S&S cart'], ['ordered', 'Mark Ordered'],
    ['move:received', 'Move to Pipeline'], ['move:to_order', 'Move to Build Order'],
    ['move:blanks_cart', 'Move to In S&S Cart'], ['move:print', 'Move to To Print'],
    ['bundle', 'Create bundle'], ['unbundle', 'Remove from bundle']
  ];
  const choiceParts = value => { const [action, destination] = value.split(':'); return { action, destination }; };
  const isCandidate = () => document.body.dataset.orderSource === 'shopify';
  const cachedOrders = () => window.getOrderManagerBoardSnapshot?.() || [];
  const paymentKey = value => String(value || 'UNKNOWN').trim().replace(/\s+/g, '_').toUpperCase();
  const humanStatus = value => String(value || 'Unknown').replace(/_/g, ' ').toLowerCase().replace(/^./, letter => letter.toUpperCase());

  function readSnapshot() {
    return model.snapshot(cachedOrders(), {
      isVisible: order => typeof orderIsVisibleOnOperationalBoard !== 'function' || orderIsVisibleOnOperationalBoard(order),
      isPrintItem: item => typeof isPrintItem === 'function' && isPrintItem(item),
      isGarmentItem: item => typeof isGarmentItem === 'function' && isGarmentItem(item),
      targetDatePresentation: window.OrderDetailState?.targetDatePresentation,
      accountingForOrder: window.blanksBatchFoundation?.accountingForOrder,
      supplierSummaryForOrder: window.blanksBatchFoundation?.supplierSummaryForOrder,
      evaluateTriage: window.OrderManagerTriage?.evaluateOrder,
      hasItemInstructions: order => order._provider !== 'etsy' && typeof customerItemInstructionGroups === 'function' && customerItemInstructionGroups(order.items).length > 0
    });
  }

  function text(tag, value, className = '') {
    const element = document.createElement(tag);
    element.textContent = value;
    if (className) element.className = className;
    return element;
  }
  function pill(label, tone = 'neutral') { return text('span', label, `order-list-pill tone-${tone}`); }
  function detailOpen() { return document.getElementById('detail-overlay')?.classList.contains('visible'); }
  function activeFilters() { const current = state.get(); return Boolean(current.query.trim() || current.stage !== 'all' || Object.values(current.filters).some(value => value !== 'all')); }
  function anchor() {
    const top = elements.scroll.getBoundingClientRect().top;
    const node = Array.from(elements.rows.children).find(row => row.getBoundingClientRect().bottom > top);
    return node ? { key: node.dataset.orderKey, offset: node.getBoundingClientRect().top - top, scrollTop: elements.scroll.scrollTop } : null;
  }
  function restoreAnchor(saved) {
    if (!saved) return;
    const node = rowNodes.get(saved.key)?.node;
    if (node?.isConnected) elements.scroll.scrollTop += node.getBoundingClientRect().top - elements.scroll.getBoundingClientRect().top - saved.offset;
    else elements.scroll.scrollTop = saved.scrollTop;
  }

  function updateStages(result) {
    const stages = [{ id: 'all', label: 'All active' }, ...model.STAGES];
    if (latest.counts.unknown || state.get().stage === 'unknown') stages.push({ id: 'unknown', label: 'Unknown stage' });
    const ids = new Set(stages.map(stage => stage.id));
    for (const [id, button] of stageNodes) if (!ids.has(id)) { button.remove(); stageNodes.delete(id); }
    for (const stage of stages) {
      let button = stageNodes.get(stage.id);
      if (!button) {
        button = text('button', '', 'order-list-stage-filter'); button.type = 'button'; button.dataset.listStage = stage.id;
        button.append(text('span', stage.label), text('span', '', 'order-list-stage-count'));
        stageNodes.set(stage.id, button); elements.stages.appendChild(button);
      }
      button.lastChild.textContent = String(stage.id === 'all' ? result.matched : result.counts[stage.id]);
      button.setAttribute('aria-pressed', String(stage.id === state.get().stage));
    }
  }

  function updatePaymentOptions() {
    const select = elements.filters.querySelector('[data-list-filter="payment"]');
    const statuses = new Set(latest.rows.map(row => paymentKey(row.financialStatus)));
    if (state.get().filters.payment !== 'all') statuses.add(state.get().filters.payment);
    const values = ['all', ...Array.from(statuses).sort()];
    if (values.join('|') !== Array.from(select.options).map(option => option.value).join('|')) {
      select.replaceChildren(...values.map(value => {
        const option = text('option', value === 'all' ? 'All statuses' : humanStatus(value)); option.value = value; return option;
      }));
    }
    select.value = state.get().filters.payment;
  }

  function makeRow(key) {
    const node = document.createElement('tr'); node.dataset.orderKey = key;
    const cells = headings.map(heading => { const cell = document.createElement('td'); cell.dataset.label = heading; node.appendChild(cell); return cell; });
    const button = text('button', '', 'order-list-open'); button.type = 'button';
    const customer = text('span', '', 'order-list-customer'), badges = text('div', '', 'order-list-source-line');
    const identity = text('div', '', 'order-list-identity-line'); identity.append(button, badges);
    const customerLine = text('div', '', 'order-list-customer-line'), bundle = text('small', '', 'order-list-bundle');
    customerLine.append(customer, bundle); cells[0].append(identity, customerLine);
    const check = document.createElement('input'); check.type = 'checkbox'; check.dataset.selectOrder = key;
    const checkLabel = text('label', '', 'order-list-row-select'); checkLabel.append(check); identity.prepend(checkLabel);
    const record = { node, cells, button, customer, badges, bundle, check, signature: '' };
    rowNodes.set(key, record); return record;
  }

  function renderRow(row, record) {
    record.check.checked = selected.includes(row.key); record.check.disabled = busy;
    record.check.setAttribute('aria-label', `Select order ${row.number}, ${row.customer}`);
    record.node.classList.toggle('is-selected', record.check.checked);
    const signature = JSON.stringify([row, typeof timeAgo === 'function' && row.receivedAt ? timeAgo(row.receivedAt) : null]);
    if (record.signature === signature) return;
    record.signature = signature;
    const { cells, button, customer, badges, bundle } = record;
    button.textContent = row.number; button.setAttribute('aria-label', `Open order ${row.number}, ${row.customer}`);
    customer.textContent = row.customer;
    badges.replaceChildren(pill(row.provider === 'etsy' ? 'Etsy' : 'PrintMO', row.provider === 'etsy' ? 'etsy' : 'source'));
    if (row.synthetic) badges.append(pill('TEST', 'warning'));
    bundle.textContent = row.bundle ? `Bundle: ${row.bundle}` : '';
    const tones = { received: 'neutral', to_order: 'neutral', blanks_cart: 'warning', blanks_ordered: 'warning', print: 'blue', completed: 'ready' };
    cells[1].replaceChildren(pill(row.stageLabel, tones[row.stage] || 'danger'));
    const target = text('span', row.target?.label || 'No target date', `order-list-target ${row.target?.tone || ''}`);
    if (row.target) target.setAttribute('aria-label', row.target.accessible);
    let age = 'Age unavailable';
    if (Number.isFinite(Date.parse(row.receivedAt)) && typeof timeAgo === 'function') age = timeAgo(row.receivedAt);
    cells[2].replaceChildren(target, text('small', age, 'order-list-muted'));
    cells[3].replaceChildren(text('strong', `${row.quantities.garments} garments`), text('span', `${row.quantities.prints} print items`, 'order-list-muted'));
    if (row.quantities.other) cells[3].append(text('span', `${row.quantities.other} other items`, 'order-list-muted'));
    if (row.partial) cells[3].append(text('small', 'Counts may be incomplete', 'order-list-warning-text'));
    cells[4].replaceChildren(pill(row.materials.blanks.label, row.materials.blanks.ready ? 'ready' : row.materials.blanks.ordered ? 'warning' : 'neutral'));
    if (row.accounting) {
      const allocation = row.accounting.lines?.some(line => line.allocationPending);
      cells[4].append(text('small', `${row.accounting.accountedGarments}/${row.accounting.expectedGarments} supplier garments received`, 'order-list-muted'));
      if (allocation) cells[4].append(pill('Allocation needs review', 'warning'));
    } else cells[4].append(text('small', 'Receiving not available', 'order-list-muted'));
    if (row.supplier?.label) {
      const supplier = text('small', `${row.supplier.multiple ? row.supplier.label : `S&S: ${row.supplier.label}`}${row.supplier.stale ? ' · check overdue' : ''}`, 'order-list-muted');
      supplier.title = `${row.supplier.observedAt ? `Checked ${new Date(row.supplier.observedAt).toLocaleString()}. ` : ''}Carrier delivery does not confirm garment check-in.`;
      cells[4].append(supplier);
    }
    cells[5].replaceChildren(pill(row.materials.prints.label, row.materials.prints.ready ? 'ready' : row.materials.prints.ordered ? 'warning' : 'neutral'));
    const progress = text('div', '', 'order-list-progress');
    if (row.progress.printable > 0) {
      const bar = document.createElement('progress'); bar.max = row.progress.printable; bar.value = row.progress.printed;
      bar.setAttribute('aria-label', `${row.progress.printed} of ${row.progress.printable} pieces printed`); progress.append(bar);
    }
    progress.append(text('small', `${row.progress.printed}/${row.progress.printable} printed`, 'order-list-muted')); cells[5].append(progress);
    cells[6].replaceChildren(pill(humanStatus(row.financialStatus), paymentKey(row.financialStatus) === 'PAID' ? 'ready' : 'neutral'));
    let total = 'Total unavailable';
    if (row.money.amount !== null && row.money.currency) {
      try { total = new Intl.NumberFormat('en-US', { style: 'currency', currency: row.money.currency }).format(row.money.amount); } catch { /* Preserve unknown rather than invent currency. */ }
    }
    cells[6].append(text('strong', total));
    const indicators = model.indicators(row);
    cells[7].replaceChildren(...(indicators.length ? indicators.map(item => pill(item.label, item.tone)) : [text('span', '—', 'order-list-muted')]));
  }

  function reconcileRows(result, preserve = true) {
    const saved = preserve ? anchor() : null;
    const keys = new Set(result.rows.map(row => row.key));
    for (const [key, record] of rowNodes) if (!keys.has(key)) { record.node.remove(); rowNodes.delete(key); }
    let cursor = elements.rows.firstChild;
    for (const row of result.rows) {
      const record = rowNodes.get(row.key) || makeRow(row.key);
      renderRow(row, record);
      if (record.node !== cursor) elements.rows.insertBefore(record.node, cursor);
      cursor = record.node.nextSibling;
    }
    if (preserve) restoreAnchor(saved); else elements.scroll.scrollTop = 0;
  }

  function moveNavigation(layout) {
    const tabs = document.getElementById('pipeline-view-tabs');
    if (layout === 'list') {
      if (elements.controls.parentNode !== elements.layoutMount) elements.layoutMount.append(elements.controls);
      if (tabs && tabs.parentNode !== elements.tabsMount) elements.tabsMount.append(tabs);
    } else {
      if (controlsHome.nextSibling !== elements.controls) controlsHome.after(elements.controls);
      if (tabs && tabsHome && tabsHome.nextSibling !== tabs) tabsHome.after(tabs);
    }
  }

  function render({ preserve = true } = {}) {
    if (!elements) return;
    const candidate = preview && isCandidate();
    const layout = candidate && document.body.dataset.pipelineView !== 'drafts' ? state.get().layout : 'board';
    elements.controls.hidden = !candidate || document.body.dataset.pipelineView === 'drafts';
    document.body.dataset.orderLayout = layout;
    elements.list.hidden = layout !== 'list';
    elements.controls.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.orderLayout === state.get().layout)));
    moveNavigation(layout);
    const nextWorkspace = `${document.body.dataset.orderSource}|${document.body.dataset.pipelineView || 'orders'}|${document.querySelector('.app-nav-tab[aria-pressed="true"]')?.dataset.view || 'orders'}`;
    if (workspace && workspace !== nextWorkspace) { selected = []; workflowReturn = null; }
    workspace = nextWorkspace;
    if (!candidate || layout !== 'list') return;
    latest = readSnapshot();
    const result = state.browse(latest);
    visibleKeys = result.rows.map(row => row.key);
    const reconciled = model.reconcileSelection(selected, visibleKeys);
    selected = reconciled.selected;
    if (reconciled.removed.length) elements.selectionNotice.textContent = `${reconciled.removed.length} selected ${reconciled.removed.length === 1 ? 'order left' : 'orders left'} this view and were deselected.`;
    renderSelection();
    elements.count.textContent = `${latest.total} active`;
    updateStages(result); updatePaymentOptions();
    elements.search.value = state.get().query; elements.sort.value = state.get().sort;
    elements.filters.querySelectorAll('select').forEach(select => { select.value = state.get().filters[select.dataset.listFilter]; });
    elements.clear.hidden = !activeFilters();
    const extra = latest.identityErrors ? ' · Some orders could not be shown; refresh or use Board.' : '';
    const loadState = document.body.dataset.boardLoadState;
    elements.notice.textContent = `Showing ${result.shown} of ${latest.total} active orders${extra}${loadState === 'error' && latest.total ? ' · Refresh failed; showing cached orders.' : ''}`;
    const empty = !result.shown;
    elements.empty.hidden = !empty;
    elements.empty.textContent = latest.total ? 'No matching orders. Clear filters to see all active orders.'
      : loadState === 'loading' ? 'Loading orders…' : loadState === 'error' ? 'Orders could not be loaded. Use Refresh to try again.' : 'No active orders.';
    reconcileRows(result, preserve);
    renderBusy();
    if (!preserve) elements.notice.setAttribute('aria-live', 'polite');
  }

  function schedule() {
    if (pending || !preview) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; render(); });
  }

  function openRow(key) {
    if (busy) return;
    workflowReturn = null;
    const order = cachedOrders().find(value => model.orderKey(value) === key);
    const record = rowNodes.get(key);
    if (!order || !record || !isCandidate()) { schedule(); return; }
    const visible = Array.from(elements.rows.children).map(node => node.dataset.orderKey);
    opener = { key, visible, index: visible.indexOf(key), anchor: anchor(), scrollTop: elements.scroll.scrollTop };
    record.button.focus({ preventScroll: true });
    const open = typeof openDetail === 'function' ? openDetail : window.openOrderManagerDetail;
    if (!open || open(order) === false) opener = null;
  }

  function restoreDetailOrigin() {
    if (!opener || detailOpen()) return;
    const saved = opener; opener = null;
    requestAnimationFrame(() => {
      render();
      if (elements.list.hidden) return;
      // Let the shared modal finish its own focus cleanup before list recovery.
      requestAnimationFrame(() => {
        if (detailOpen() || elements.list.hidden) return;
        const visible = Array.from(elements.rows.children).map(node => node.dataset.orderKey);
        const record = rowNodes.get(saved.key) || rowNodes.get(visible[Math.min(saved.index, visible.length - 1)]);
        restoreAnchor(saved.anchor || { scrollTop: saved.scrollTop });
        if (record) record.button.focus({ preventScroll: true }); else elements.search.focus({ preventScroll: true });
        if (!rowNodes.has(saved.key)) elements.notice.textContent += ' · The opened order is no longer in this view.';
      });
    });
  }

  function renderBusy() {
    if (!elements) return;
    elements.list.setAttribute('aria-busy', String(busy));
    elements.list.querySelectorAll('input, select, button').forEach(control => {
      if (busy) {
        if (!control.hasAttribute('data-before-busy')) control.dataset.beforeBusy = String(control.disabled);
        control.disabled = true;
      } else if (control.hasAttribute('data-before-busy')) {
        control.disabled = control.dataset.beforeBusy === 'true'; delete control.dataset.beforeBusy;
      }
    });
    if (!busy) {
      rowNodes.forEach(record => record.check.disabled = false);
      renderSelection();
    }
  }

  function renderSelection() {
    elements.selection.hidden = !selected.length;
    elements.selectedCount.textContent = `${selected.length} selected`;
    const wideTable = window.matchMedia('(min-width: 1200px)').matches;
    for (const [index, input] of elements.selectAll.entries()) {
      const shown = index === 0 ? wideTable : !wideTable;
      input.setAttribute('aria-hidden', String(!shown)); input.tabIndex = shown ? 0 : -1;
      input.checked = !!visibleKeys.length && selected.length === visibleKeys.length;
      input.indeterminate = selected.length > 0 && selected.length < visibleKeys.length;
      input.disabled = busy || !shown || !visibleKeys.length;
    }
    const reasons = [];
    for (const [value, label] of actionChoices) {
      const { action, destination } = choiceParts(value);
      const eligibility = workflows.eligibility(action, selected, destination);
      const option = elements.action.querySelector(`[value="${value}"]`);
      const sameDestination = action === 'move' && selected.length && selected.every(key => model.stageForOrder(cachedOrders().find(order => model.orderKey(order) === key)) === destination);
      option.hidden = !!sameDestination;
      option.disabled = busy || !eligibility.enabled;
      if (!eligibility.enabled && !sameDestination && !busy) reasons.push(text('li', `${label}: ${eligibility.reason}`));
    }
    if (!busy && (elements.action.selectedOptions[0]?.disabled || elements.action.selectedOptions[0]?.hidden)) elements.action.value = '';
    elements.review.disabled = busy || !elements.action.value;
    elements.reasons.replaceChildren(...reasons);
    elements.availability.hidden = !reasons.length;
    elements.retry.hidden = !workflows.remaining().length;
    elements.retry.disabled = busy;
  }

  function showResults(result) {
    if (result.cancelled) return;
    lastResults = result.results;
    for (const item of lastResults) if (item.outcome === 'saved') selected = selected.filter(key => key !== item.key);
    elements.results.hidden = !lastResults.length;
    const saved = lastResults.filter(item => item.outcome === 'saved').length;
    elements.resultSummary.textContent = `${saved} of ${lastResults.length} orders saved${saved !== lastResults.length ? ' · Review remaining orders' : ''}`;
    elements.resultItems.replaceChildren(...lastResults.map(item => text('li', `${item.number}: ${item.message}`, `result-${item.outcome}`)));
    elements.results.open = saved !== lastResults.length || workflows.remaining().length > 0;
  }

  async function reviewAction(retry = false) {
    if (busy) return;
    const savedAnchor = anchor();
    const source = retry ? elements.retry : elements.review;
    let reviewed;
    try {
      if (!retry) {
        const { action, destination } = choiceParts(elements.action.value);
        reviewed = workflows.review(action, selected, { destination });
      }
    } catch (error) { elements.selectionNotice.textContent = error.message; render(); return; }
    const dialog = elements.dialog, form = dialog.querySelector('form');
    const title = dialog.querySelector('h2'), description = dialog.querySelector('[data-review-description]');
    title.textContent = retry ? 'Retry remaining steps' : actionChoices.find(([value]) => value === elements.action.value)[1];
    description.textContent = retry ? 'Continue only the unsaved steps. Saved receiving records and stage moves will be kept.'
      : reviewed.action === 'supplier' ? 'Send these orders through the existing S&S cart workflow. Review the supplier result before any retry.'
      : reviewed.action === 'ordered' ? 'Record the S&S order number and create a receiving record for these orders. This does not place a supplier order.'
      : reviewed.action === 'unbundle' ? 'Remove only these selected members. Other orders in each bundle will stay bundled.'
      : 'Apply this change only to the orders listed below. Material readiness does not establish artwork approval or production release.';
    const jobs = retry ? workflows.remainingJobs() : reviewed.jobs;
    dialog.querySelector('[data-review-orders]').replaceChildren(...jobs.map(job => text('li', retry ? job.number : `${job.name}${job.bundle ? ` · Bundle: ${job.bundle}` : ''}`)));
    const field = dialog.querySelector('[data-review-field]'), input = field.querySelector('input');
    field.hidden = retry || !['ordered', 'bundle'].includes(reviewed.action);
    field.querySelector('span').textContent = !retry && reviewed.action === 'ordered' ? 'S&S order number' : 'Bundle label';
    input.value = ''; input.required = !field.hidden; input.disabled = field.hidden;
    const errorNode = dialog.querySelector('[data-review-error]'); errorNode.textContent = '';
    dialog.showModal();
    const confirmed = await new Promise(resolve => {
      const finish = value => { form.removeEventListener('submit', onSubmit); dialog.removeEventListener('close', onClose); resolve(value); };
      const onClose = () => finish(false);
      const onSubmit = event => {
        event.preventDefault();
        if (event.submitter?.value === 'cancel') { dialog.close(); return; }
        if (!field.hidden && !input.value.trim()) { errorNode.textContent = 'Enter a value before continuing.'; input.focus(); return; }
        if (reviewed?.action === 'bundle' && cachedOrders().some(order => order.bundle === input.value.trim())) { errorNode.textContent = 'That active bundle label is already in use. Choose a new label.'; input.focus(); return; }
        dialog.removeEventListener('close', onClose); dialog.close(); finish(true);
      };
      form.addEventListener('submit', onSubmit); dialog.addEventListener('close', onClose);
    });
    if (!confirmed) { source.focus({ preventScroll: true }); return; }
    if (!retry) {
      if (reviewed.action === 'bundle') reviewed.args.label = input.value.trim();
      if (reviewed.action === 'ordered') reviewed.args.supplierOrderNumber = input.value.trim();
    }
    busy = true; renderBusy(); elements.selectionNotice.textContent = 'Saving selected orders…';
    try { showResults(retry ? await workflows.retryRemaining(jobs.map(job => job.key)) : await workflows.execute(reviewed)); }
    catch (error) { elements.selectionNotice.textContent = `${error.message} Review the current orders and try again.`; }
    finally {
      busy = false; render(); renderBusy(); restoreAnchor(savedAnchor);
      if (elements.selectionNotice.textContent === 'Saving selected orders…') elements.selectionNotice.textContent = elements.resultSummary.textContent;
      workflowReturn = savedAnchor || { scrollTop: elements.scroll.scrollTop };
      restoreWorkflowOrigin();
    }
  }

  function restoreWorkflowOrigin() {
    if (!workflowReturn || busy) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!workflowReturn || busy || detailOpen() || elements.list.hidden || document.querySelector('dialog[open], #ss-submission-overlay:not(.hidden), .batch-correction-overlay:not(.hidden), #blanks-receive-overlay:not(.hidden)')) return;
      const saved = workflowReturn; workflowReturn = null;
      restoreAnchor(saved);
      const target = !elements.selection.hidden ? elements.action : rowNodes.get(saved.key)?.check || rowNodes.get(visibleKeys[0])?.check || elements.search;
      target.focus({ preventScroll: true });
    }));
  }

  function setup() {
    const byId = id => document.getElementById(id);
    elements = { controls: byId('order-layout-controls'), list: byId('order-list-foundation'), rows: byId('order-list-foundation-rows'),
      count: byId('order-list-foundation-count'), notice: byId('order-list-foundation-notice'), scroll: byId('order-list-scroll'), stages: byId('order-list-stages'),
      search: byId('order-list-search'), sort: byId('order-list-sort'), filters: byId('order-list-filters'), filterToggle: byId('order-list-filters-toggle'),
      clear: byId('order-list-clear'), empty: byId('order-list-empty'), layoutMount: byId('order-list-layout-mount'), tabsMount: byId('order-list-tabs-mount') };
    if (Object.values(elements).some(value => !value)) { elements = null; return; }
    if (!preview) { document.body.dataset.orderLayout = 'board'; return; }
    workflows = window.OrderListWorkflows.create({ getOrders: cachedOrders, api: window.api,
      blanks: window.blanksBatchFoundation, submit: refs => window.submitOrderManagerSupplierOrders(refs),
      showSupplierError: error => window.showOrderManagerSupplierError?.(error), onChange: schedule });
    const selection = text('div', '', 'order-list-selection'); selection.id = 'order-list-selection'; selection.hidden = true;
    const selectedCount = text('strong', '', 'order-list-selected-count');
    const clearSelection = text('button', 'Clear selection'); clearSelection.type = 'button';
    const action = document.createElement('select'); action.id = 'order-list-action'; action.setAttribute('aria-label', 'Action for selected orders');
    const placeholder = text('option', 'Choose action…'); placeholder.value = ''; action.append(placeholder);
    for (const [value, label] of actionChoices) { const option = text('option', label); option.value = value; action.append(option); }
    const review = text('button', 'Review action', 'order-list-primary'); review.type = 'button';
    const selectionControls = text('div', '', 'order-list-selection-controls'); selectionControls.append(selectedCount, clearSelection, action, review);
    const availability = document.createElement('details'), reasons = document.createElement('ul');
    availability.append(text('summary', 'Action availability'), reasons); selection.append(selectionControls, availability);
    const selectAll = [];
    function selectMatching(className) {
      const label = text('label', '', className), input = document.createElement('input'); input.type = 'checkbox'; input.setAttribute('aria-label', 'Select all matching orders');
      label.append(input, text('span', className === 'order-list-select-mobile' ? 'Select matching orders' : 'Order / Customer'));
      selectAll.push(input); input.addEventListener('change', () => { if (busy) return; selected = input.checked ? [...visibleKeys] : []; elements.selectionNotice.textContent = ''; render(); }); return label;
    }
    const heading = elements.list.querySelector('th'); heading.replaceChildren(selectMatching('order-list-select-heading'));
    const globalActions = text('div', '', 'order-list-global-actions'), receive = text('button', 'Receive Batches'); receive.type = 'button';
    globalActions.append(selectMatching('order-list-select-mobile'), receive);
    const selectionNotice = text('p', '', 'order-list-selection-notice'); selectionNotice.setAttribute('role', 'status'); selectionNotice.setAttribute('aria-live', 'polite');
    const results = document.createElement('details'); results.className = 'order-list-action-results'; results.hidden = true;
    const resultSummary = text('summary', ''), resultItems = document.createElement('ul'), retry = text('button', 'Retry remaining steps'); retry.type = 'button'; retry.hidden = true;
    results.append(resultSummary, resultItems, retry);
    elements.scroll.before(globalActions, selection, selectionNotice, results);
    const dialog = document.createElement('dialog'); dialog.className = 'order-list-review'; dialog.setAttribute('aria-labelledby', 'order-list-review-title');
    dialog.innerHTML = '<form><h2 id="order-list-review-title" tabindex="-1" autofocus></h2><p data-review-description></p><ul data-review-orders></ul><label data-review-field><span></span><input maxlength="120" autocomplete="off"></label><p data-review-error role="alert"></p><div class="order-list-review-buttons"><button type="submit" value="cancel" formnovalidate>Cancel</button><button type="submit" value="confirm" class="order-list-primary">Confirm action</button></div></form>';
    document.body.append(dialog);
    Object.assign(elements, { selection, selectedCount, action, review, availability, reasons, selectionNotice, selectAll, results, resultSummary, resultItems, retry, dialog });
    clearSelection.addEventListener('click', () => { if (busy) return; selected = []; elements.selectionNotice.textContent = ''; render(); });
    action.addEventListener('change', renderSelection);
    review.addEventListener('click', () => reviewAction()); retry.addEventListener('click', () => reviewAction(true));
    receive.addEventListener('click', async () => { workflowReturn = anchor() || { scrollTop: elements.scroll.scrollTop }; await window.blanksBatchFoundation.openReceiveOverlay(); });
    elements.rows.addEventListener('change', event => { const key = event.target.dataset.selectOrder; if (!key || busy) return; selected = event.target.checked ? [...selected, key] : selected.filter(value => value !== key); elements.selectionNotice.textContent = ''; render(); });
    document.addEventListener('click', event => { if (event.target.closest('[data-view="previous"], [data-tab="history"]')) { selected = []; renderSelection(); } });
    document.body.dataset.orderLayout = 'board';
    if (!preview) return; // Explicit opt-out leaves every existing Board node in place.
    controlsHome = document.createComment('Board layout controls'); elements.controls.before(controlsHome);
    const tabs = byId('pipeline-view-tabs');
    if (tabs) { tabsHome = document.createComment('Board draft tabs'); tabs.before(tabsHome); }
    elements.controls.addEventListener('click', event => {
      const button = event.target.closest('[data-order-layout]'); if (!button || !isCandidate()) return;
      state.setLayout(button.dataset.orderLayout); render();
    });
    elements.stages.addEventListener('click', event => {
      const button = event.target.closest('[data-list-stage]'); if (!button) return;
      state.setStage(button.dataset.listStage); render({ preserve: false });
    });
    elements.search.addEventListener('input', () => { state.setQuery(elements.search.value); render({ preserve: false }); });
    elements.sort.addEventListener('change', () => { state.setSort(elements.sort.value); render({ preserve: false }); });
    elements.filterToggle.addEventListener('click', () => {
      elements.filters.hidden = !elements.filters.hidden;
      elements.filterToggle.setAttribute('aria-expanded', String(!elements.filters.hidden));
    });
    elements.filters.addEventListener('change', event => {
      const field = event.target.dataset.listFilter; if (!field) return;
      state.setFilters({ [field]: event.target.value }); render({ preserve: false });
    });
    elements.clear.addEventListener('click', () => { state.resetFilters(); render({ preserve: false }); });
    elements.rows.addEventListener('click', event => {
      if (event.target.closest('.order-list-row-select, a, input, select, textarea, button:not(.order-list-open)')) return;
      const row = event.target.closest('tr[data-order-key]'); if (row) openRow(row.dataset.orderKey);
    });
    new MutationObserver(restoreWorkflowOrigin).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class', 'aria-hidden'] });
    window.matchMedia('(min-width: 1200px)').addEventListener('change', schedule);
    document.addEventListener('printmo:board-updated', schedule);
    document.addEventListener('printmo:blanks-accounting-updated', schedule);
    document.addEventListener('printmo:detail-closed', restoreDetailOrigin);
    new MutationObserver(schedule).observe(document.body, { attributes: true,
      attributeFilter: ['data-order-source', 'data-board-load-state', 'data-pipeline-view'] });
    // Also covers existing close paths that hide the overlay directly.
    const overlay = byId('detail-overlay');
    if (overlay) new MutationObserver(restoreDetailOrigin).observe(overlay, { attributes: true, attributeFilter: ['class', 'aria-hidden'] });
    render();
  }

  window.OrderManagerViews = Object.freeze({ getState: () => state.get(), getSnapshot: readSnapshot, refresh: schedule });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, { once: true }); else setup();
})();
