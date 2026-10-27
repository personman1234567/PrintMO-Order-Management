/* A mobile presentation of the shared order snapshot and existing workflows. */
(() => {
  function setup() {
    const model = window.MobileOrderModel, board = window.OrderBoardModel;
    const navigation = window.OrderManagerNavigation, list = window.OrderManagerViews;
    if (!model || !board || !navigation || !list) return;
    const media = matchMedia('(max-width: 900px)');
    const enabled = () => media.matches && document.body.dataset.orderSource === 'shopify'
      && new URLSearchParams(location.search).get('printmo_list_preview') !== '0';
    let storage; try { storage = localStorage; } catch { /* Optional preferences. */ }
    const state = model.create(storage), records = new Map();
    let area = 'orders', selected = new Set(), selectionMode = false, busy = false, frame = 0;
    let editor = null, origin = null, pendingLeave = null, previousEnabled = false;
    let currentRows = [], lastResults = [], restoredScroll = false, returnFocus = null;
    const titles = { orders: 'Orders', supplies: 'Supplies', print: 'Print', more: 'More' };
    const el = (tag, copy, className) => { const node = document.createElement(tag); if (copy != null) node.textContent = copy; if (className) node.className = className; return node; };
    const button = (copy, action, className = '') => { const node = el('button', copy, className); node.type = 'button'; node.addEventListener('click', action); return node; };
    const icon = path => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
    const paths = { orders: 'M8 4h12v17H4V4h4m0-2h8v4H8zM8 11h8M8 16h5', supplies: 'm3 7 9-4 9 4v11l-9 4-9-4zM3 7l9 4 9-4M12 11v11', print: 'M7 8V3h10v5M7 17H3V8h18v9h-4M7 14h10v7H7zM17 11h1', more: 'M4 6h16M4 12h16M4 18h16' };
    const root = el('section', null, 'mobile-workspace'); root.id = 'mobile-order-workspace'; root.hidden = true;
    root.setAttribute('aria-labelledby', 'mobile-workspace-title');
    root.innerHTML = `<header class="mw-heading"><div><h1 id="mobile-workspace-title">Orders</h1><p class="mw-count"></p></div><button type="button" class="mw-refresh" aria-label="Refresh orders">${icon('M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M18 18A8 8 0 0 1 5 15')}<span>Refresh</span></button></header>
      <div class="mw-subviews" role="group" aria-label="Work area views"></div>
      <div class="mw-toolbar"><label class="mw-search"><span class="visually-hidden">Search this work area</span><input type="search" maxlength="120" placeholder="Search orders or customers" autocomplete="off"></label><button type="button" class="mw-select" aria-pressed="false">Select</button><button type="button" class="mw-filters" aria-haspopup="dialog">Filters</button></div>
      <div class="mw-tools"></div><div class="mw-selection" hidden></div>
      <div class="mw-feedback" role="status" aria-live="polite" hidden></div>
      <details class="mw-results" hidden><summary></summary><ul></ul></details>
      <div class="mw-scroll" tabindex="-1"><div class="mw-rows" role="list" aria-label="Orders"></div><div class="mw-empty" hidden></div><div class="mw-more" hidden></div></div>`;
    document.getElementById('orders-view').prepend(root);
    const $ = selector => root.querySelector(selector);
    const scroll = $('.mw-scroll'), rows = $('.mw-rows'), search = $('.mw-search input'), feedback = $('.mw-feedback');
    const nav = el('nav', null, 'mw-navigation'); nav.hidden = true; nav.setAttribute('aria-label', 'Work areas');
    for (const name of model.AREAS) {
      const item = button('', () => navigation.navigateMobile(name)); item.dataset.mobileAreaTarget = name;
      item.innerHTML = icon(paths[name]) + `<span>${titles[name]}</span>`; nav.append(item);
    }
    document.getElementById('mobile-command-surface').append(nav);

    function sheet(title, className = '') {
      const dialog = el('dialog', null, `mw-sheet ${className}`);
      const id = `mw-sheet-${document.querySelectorAll('.mw-sheet').length}`;
      const heading = el('h2', title); heading.id = id; dialog.setAttribute('aria-labelledby', id);
      const header = el('header'); header.append(heading, button('Close', () => dialog.close()));
      const content = el('div', null, 'mw-sheet-content'); dialog.append(header, content); document.body.append(dialog);
      dialog.addEventListener('close', () => { if (returnFocus?.isConnected && returnFocus.getClientRects().length) returnFocus.focus({ preventScroll: true }); });
      return { dialog, content };
    }
    const filters = sheet('Filters and sort'), actions = sheet('Order actions'), discard = sheet('Discard quantity changes?');
    const discardCopy = el('p', 'Your printed quantity has not been saved.');
    discard.content.append(discardCopy, button('Stay here', () => { pendingLeave = null; discard.dialog.close(); }),
      button('Discard changes', () => { const proceed = pendingLeave; pendingLeave = null; editor = null; discard.dialog.close(); render(); proceed?.(); }));
    function announce(copy, error = false) { feedback.hidden = !copy; feedback.textContent = copy; feedback.classList.toggle('mw-error', error); }
    const dirty = () => editor && String(editor.value) !== String(editor.original);
    function guard(proceed) {
      if (!enabled()) return true;
      if (busy || list.workflowState().busy || list.workflowState().reviewing) { announce('Finish the current action before leaving.'); return false; }
      if (dirty()) {
        pendingLeave = proceed; returnFocus = document.activeElement;
        if (!discard.dialog.open) discard.dialog.showModal();
        return false;
      }
      if (editor) { editor = null; render(); }
      return true;
    }
    navigation.setMobileGuard(guard);
    function guarded(proceed) { if (guard(proceed)) proceed(); }
    const orders = () => window.getOrderManagerBoardSnapshot?.() || [];
    const findOrder = key => orders().find(order => board.orderKey(order) === key);
    const view = () => state.get(area === 'more' ? 'orders' : area);
    function captureAnchor() {
      const top = scroll.getBoundingClientRect().top;
      const nodes = [...rows.children];
      const index = nodes.findIndex(node => node.getBoundingClientRect().bottom > top);
      return { key: nodes[index]?.dataset.orderKey, index: Math.max(0, index), offset: nodes[index] ? nodes[index].getBoundingClientRect().top - top : 0, scrollTop: scroll.scrollTop };
    }
    function restoreAnchor(saved) {
      if (!saved) return;
      const node = records.get(saved.key)?.node || rows.children[Math.min(saved.index, rows.children.length - 1)];
      if (node?.isConnected) scroll.scrollTop += node.getBoundingClientRect().top - scroll.getBoundingClientRect().top - saved.offset;
      else scroll.scrollTop = saved.scrollTop;
    }
    function remember() { if (area !== 'more') state.update(area, { scrollTop: scroll.scrollTop }); }
    function resetSelection() { selected.clear(); selectionMode = false; }
    function changeView(patch) {
      guarded(() => {
        state.update(area, { ...patch, scrollTop: 0 }); resetSelection();
        if (patch.stage) navigation.navigateMobile(area, { subview: patch.stage, guarded: true });
        render(false); scroll.scrollTop = 0; $('.mw-subviews select')?.focus({ preventScroll: true });
      });
    }
    function syncArea() {
      const next = document.body.dataset.mobileArea || 'orders';
      if (next !== area) {
        remember(); area = next; resetSelection(); editor = null; lastResults = []; announce('');
        for (const item of [filters, actions]) if (item.dialog.open) item.dialog.close();
        restoredScroll = true;
      }
      if (area !== 'more' && document.body.dataset.mobileSubview) state.update(area, { stage: document.body.dataset.mobileSubview });
      render();
    }
    function updateEnabled() {
      const active = enabled();
      if (active === previousEnabled) { schedule(); return; }
      previousEnabled = active;
      document.body.dataset.mobileWorkspace = String(active);
      nav.hidden = !active; root.hidden = !active;
      if (active) {
        document.body.dataset.mobileArea = area;
        navigation.navigateMobile(area, { subview: view().stage, destination: document.body.dataset.activeView || 'orders', guarded: true });
      } else {
        for (const item of [filters, actions, discard]) if (item.dialog.open) item.dialog.close();
        if (document.body.dataset.orderSource !== 'shopify') editor = null;
        resetSelection(); root.inert = false;
      }
      render();
    }
    function openOrder(key) {
      guarded(() => {
        const order = findOrder(key); if (!order) return announce('This order is no longer available. Refresh the list.', true);
        origin = { area, key, index: currentRows.findIndex(row => row.key === key), anchor: captureAnchor() };
        records.get(key)?.open.focus({ preventScroll: true });
        window.openDetail?.(order);
      });
    }
    function restoreDetail() {
      if (!origin || document.body.classList.contains('detail-open')) return;
      const saved = origin; origin = null;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!enabled() || area !== saved.area || document.body.classList.contains('detail-open')) return;
        render(); restoreAnchor(saved.anchor);
        const row = records.get(saved.key) || records.get(currentRows[Math.min(saved.index, currentRows.length - 1)]?.key);
        (row?.open || search).focus({ preventScroll: true });
        if (!records.has(saved.key)) announce('The opened order is no longer in this view.');
      }));
    }
    function makeRow(row) {
      const node = el('article', null, 'mw-row'); node.dataset.orderKey = row.key; node.setAttribute('role', 'listitem');
      const checkLabel = el('label', null, 'mw-row-selection'), check = document.createElement('input'); check.type = 'checkbox';
      checkLabel.append(check); check.addEventListener('change', () => { check.checked ? selected.add(row.key) : selected.delete(row.key); renderSelection(); });
      const open = button('', () => openOrder(row.key), 'mw-row-open');
      const identity = el('div', null, 'mw-row-identity'), customer = el('strong'), number = el('span', null, 'mw-row-number'); identity.append(customer, number);
      const meta = el('div', null, 'mw-row-meta'), detail = el('div', null, 'mw-row-detail'), attention = el('div', null, 'mw-row-attention');
      open.append(identity, meta, detail, attention);
      const action = button('Actions', () => openActions([row.key], action), 'mw-row-actions');
      const progress = button('', () => startProgress(row.key), 'mw-progress');
      node.append(checkLabel, open, action, progress);
      node.addEventListener('click', event => { if (!event.target.closest('button, input, label, form')) openOrder(row.key); });
      return { node, checkLabel, check, open, customer, number, meta, detail, attention, action, progress, signature: '' };
    }
    function renderRow(row, record) {
      record.checkLabel.hidden = !selectionMode; record.check.checked = selected.has(row.key);
      record.check.setAttribute('aria-label', `Select ${row.number}, ${row.customer}`); record.check.disabled = busy;
      record.node.classList.toggle('is-selected', selected.has(row.key)); record.action.hidden = selectionMode;
      const signature = JSON.stringify([row, area, selectionMode]);
      if (record.signature !== signature) {
        record.signature = signature;
        record.customer.textContent = row.customer; record.number.textContent = `${row.number} · ${row.provider === 'etsy' ? 'Etsy' : 'PrintMO'}${row.synthetic ? ' · TEST' : ''}`;
        if (row.rush) record.number.append(el('span', 'Rush', 'order-rush-marker'));
        record.open.setAttribute('aria-label', `Open ${row.number}, ${row.customer}`);
        const stage = el('span', row.stageLabel), date = el('span', row.target?.label || 'No date set', row.target?.tone ? `mw-date-${row.target.tone}` : '');
        if (row.target?.accessible) date.setAttribute('aria-label', row.target.accessible);
        record.meta.replaceChildren(stage, date);
        const facts = area === 'supplies'
          ? [`${row.quantities.garments} garments`, row.accounting ? `${row.accounting.accountedGarments}/${row.accounting.expectedGarments} received` : `Blanks ${row.materials.blanks.label.toLowerCase()}`]
          : area === 'print' ? [`Blanks ${row.materials.blanks.label.toLowerCase()}`, `Prints ${row.materials.prints.label.toLowerCase()}`]
            : [`${row.quantities.garments} garments`, `${row.quantities.prints} print items`, `Blanks ${row.materials.blanks.label.toLowerCase()}`, `Prints ${row.materials.prints.label.toLowerCase()}`];
        record.detail.textContent = facts.join(' · ');
        const warnings = board.indicators(row).filter(item => item.label !== 'Materials marked ready');
        if (row.bundle) warnings.push({ label: `Bundle: ${row.bundle}`, tone: 'neutral' });
        if (area === 'supplies' && row.supplier?.label) warnings.push({ label: `${row.supplier.label}${row.supplier.stale ? ' · check overdue' : ''}`, tone: row.supplier.stale ? 'warning' : 'neutral' });
        record.attention.replaceChildren(...warnings.map(item => el('span', item.label, `mw-indicator-${item.tone}`))); record.attention.hidden = !warnings.length;
        record.progress.textContent = `${row.progress.printed}/${row.progress.printable} printed · Update`;
        record.progress.setAttribute('aria-label', `Update printed quantity for ${row.number}, ${row.progress.printed} of ${row.progress.printable}`);
      }
      record.progress.hidden = area !== 'print' || selectionMode;
      record.action.disabled = busy; record.progress.disabled = busy;
      record.open.disabled = busy;
      renderEditor(row, record);
    }
    function renderEditor(row, record) {
      const old = record.node.querySelector('.mw-progress-editor');
      if (editor?.key !== row.key) { old?.remove(); return; }
      if (old) return;
      const form = el('form', null, 'mw-progress-editor');
      const label = el('label', 'Printed quantity'), input = document.createElement('input');
      input.type = 'number'; input.inputMode = 'numeric'; input.min = '0'; input.max = String(row.progress.printable); input.step = '1'; input.value = editor.value;
      input.id = 'mw-progress-input'; label.htmlFor = input.id;
      const hint = el('p', `Out of ${row.progress.printable} printable pieces.`, 'mw-editor-hint');
      const message = el('p', editor.error || '', 'mw-error'); message.id = 'mw-progress-error'; message.setAttribute('role', 'alert'); input.setAttribute('aria-describedby', message.id);
      const save = button('Save quantity', () => {}, 'mw-primary'), cancel = button('Cancel', () => { editor = null; render(); record.progress.focus({ preventScroll: true }); }); save.type = 'submit';
      const update = () => { editor.value = input.value; const result = model.progressInput(findOrder(row.key), input.value, row.progress.printable); save.textContent = result.label || 'Save quantity'; };
      input.addEventListener('input', update); update();
      form.append(label, input, hint, message, save, cancel); form.noValidate = true;
      form.addEventListener('submit', event => { event.preventDefault(); void saveProgress(row, record, form); });
      record.node.append(form); requestAnimationFrame(() => { input.focus({ preventScroll: true }); revealEditorInput(); });
    }
    function startProgress(key) {
      guarded(() => {
        const row = currentRows.find(item => item.key === key), order = findOrder(key);
        if (!row || !order) return;
        const eligibility = model.progressInput(order, order.progress || 0, row.progress.printable);
        if (eligibility.error) return announce(eligibility.error, true);
        editor = { key, original: order.progress || 0, value: String(order.progress || 0), version: order._version, error: '' };
        render();
      });
    }
    async function saveProgress(row, record, form) {
      if (busy || !editor) return;
      const order = findOrder(row.key), latest = list.getSnapshot().rows.find(item => item.key === row.key);
      const result = model.progressInput(order, editor.value, latest?.progress.printable);
      const error = result.error || (order._version !== editor.version ? 'This order changed while you were editing. Cancel and review its current quantity.' : '');
      if (error) { editor.error = error; form.querySelector('[role="alert"]').textContent = error; return; }
      busy = true; document.body.dataset.mobileProgressSaving = 'true'; announce(`Saving ${row.number}…`); const anchor = captureAnchor();
      form.querySelectorAll('button, input').forEach(node => { node.disabled = true; });
      try {
        const saved = await window.saveProductionProgress(order, result.count, schedule);
        if (!saved) throw new Error('Quantity could not be saved. Review the current order and try again.');
        editor = null;
        announce(`${row.number}: ${order.progress}/${latest.progress.printable} saved${order.productionStage !== row.stage ? ` · ${order.productionStage === 'completed' ? 'Moved to Printed' : 'Returned to To Print'}` : ''}.`);
      } catch (error) {
        if (editor) {
          editor.error = `${error.message} Current saved quantity: ${order.progress}.`;
          editor.version = order._version;
          form.querySelector('[role="alert"]').textContent = editor.error;
        }
        announce('Quantity was not saved. Your entry is kept for review.', true);
      } finally {
        delete document.body.dataset.mobileProgressSaving;
        busy = false; form.querySelectorAll('button, input').forEach(node => { node.disabled = false; });
        render(); restoreAnchor(anchor);
        if (!editor) (records.get(row.key)?.progress || records.get(currentRows[Math.min(anchor.index, currentRows.length - 1)]?.key)?.open || search).focus({ preventScroll: true });
      }
    }
    function openActions(keys, opener) {
      guarded(() => {
        actions.content.replaceChildren(); returnFocus = opener;
        actions.dialog.querySelector('h2').textContent = keys.length === 1 ? 'Order actions' : `${keys.length} selected orders`;
        const jobs = keys.map(findOrder).filter(Boolean), stages = jobs.map(board.stageForOrder);
        const relevant = item => !item.hidden
          && (item.value !== 'supplier' || stages.every(stage => stage === 'to_order'))
          && (item.value !== 'ordered' || stages.every(stage => stage === 'blanks_cart'))
          && (item.value !== 'bundle' || keys.length > 1)
          && (item.value !== 'unbundle' || jobs.some(order => order.bundle));
        for (const item of list.actions(keys).filter(relevant)) {
          const control = button(item.label, () => { actions.dialog.close(); void runAction(keys, item.value, opener); });
          control.disabled = !item.enabled;
          actions.content.append(control);
          if (!item.enabled) actions.content.append(el('p', item.reason, 'mw-action-reason'));
        }
        actions.dialog.showModal();
      });
    }
    async function runAction(keys, value, opener, retry = false) {
      if (busy) return;
      const savedAnchor = captureAnchor(), savedArea = area, savedStage = view().stage;
      busy = true;
      render();
      try {
        const result = retry ? await list.retryMobile(opener) : await list.reviewMobile(keys, value, opener);
        if (result) {
          lastResults = result.results || [];
          const successes = new Set(lastResults.filter(item => item.outcome === 'saved').map(item => item.key));
          successes.forEach(key => selected.delete(key));
          const label = board.STAGES.find(stage => stage.id === value.split(':')[1])?.label;
          announce(result.notice || `${successes.size} of ${lastResults.length} orders saved${label ? ` · Moved to ${label}` : ''}.`, lastResults.some(item => item.outcome !== 'saved'));
        }
      } catch (error) { announce(error.message, true); }
      finally {
        busy = false;
        if (enabled()) navigation.navigateMobile(savedArea, { subview: savedStage, guarded: true });
        render(); restoreAnchor(savedAnchor);
        const target = opener?.isConnected && opener.getClientRects().length ? opener : rows.querySelector('button') || search;
        target.focus({ preventScroll: true });
      }
    }
    function renderSelection() {
      const host = $('.mw-selection'); host.hidden = !selectionMode;
      $('.mw-select').setAttribute('aria-pressed', String(selectionMode)); $('.mw-select').textContent = selectionMode ? 'Done' : 'Select';
      if (!selectionMode) return;
      host.replaceChildren(el('strong', `${selected.size} selected`));
      host.append(button('Select matching', () => { selected = new Set(currentRows.map(row => row.key)); render(); }),
        button('Clear', () => { selected.clear(); render(); }));
      const action = button('Actions', () => openActions([...selected], action), 'mw-primary'); action.disabled = !selected.size || busy; host.append(action);
      for (const [key, record] of records) { record.check.checked = selected.has(key); record.node.classList.toggle('is-selected', selected.has(key)); }
    }
    function openFilters() {
      guarded(() => {
        filters.content.replaceChildren(); returnFocus = $('.mw-filters');
        const form = el('form'), current = view();
        const sortLabel = el('label', 'Sort orders'), sort = document.getElementById('order-list-sort').cloneNode(true); sort.removeAttribute('id'); sort.value = current.sort; sortLabel.append(sort); form.append(sortLabel);
        for (const original of document.querySelectorAll('#order-list-filters > label')) {
          const label = original.cloneNode(true), select = label.querySelector('select'), key = select.dataset.listFilter;
          if (key === 'payment') {
            const values = new Set(list.getSnapshot().rows.map(row => String(row.financialStatus || 'UNKNOWN').toUpperCase().replace(/\s+/g, '_'))); values.add(current.filters.payment);
            select.replaceChildren(...['all', ...[...values].filter(value => value !== 'all').sort()].map(value => { const option = el('option', value === 'all' ? 'All statuses' : value.replace(/_/g, ' ').toLowerCase()); option.value = value; return option; }));
          }
          select.value = current.filters[key]; form.append(label);
        }
        const apply = button('Apply filters', () => {}, 'mw-primary'); apply.type = 'submit';
        form.append(apply, button('Clear filters', () => { state.clear(area); filters.dialog.close(); resetSelection(); navigation.navigateMobile(area, { subview: view().stage, guarded: true }); render(false); scroll.scrollTop = 0; }), button('Cancel', () => filters.dialog.close()));
        form.addEventListener('submit', event => {
          event.preventDefault(); const values = Object.fromEntries([...form.querySelectorAll('[data-list-filter]')].map(select => [select.dataset.listFilter, select.value]));
          state.update(area, { sort: sort.value, filters: values, scrollTop: 0 }); resetSelection(); filters.dialog.close(); render(false); scroll.scrollTop = 0;
        });
        filters.content.append(form); filters.dialog.showModal();
      });
    }
    function renderSubviews(snapshot) {
      const host = $('.mw-subviews'), current = view();
      const signature = JSON.stringify([area, current.stage, snapshot.counts, snapshot.total]);
      if (host.dataset.signature === signature) return;
      host.dataset.signature = signature; host.replaceChildren(); host.hidden = area === 'more';
      if (area === 'orders') {
        const label = el('label', 'Stage'), select = document.createElement('select'); select.setAttribute('aria-label', 'Filter orders by stage');
        const stages = [{ id: 'all', label: 'All stages' }, ...board.STAGES, ...(snapshot.counts.unknown ? [{ id: 'unknown', label: 'Unknown stage' }] : [])];
        for (const stage of stages) { const option = el('option', `${stage.label} (${stage.id === 'all' ? snapshot.total : snapshot.counts[stage.id] || 0})`); option.value = stage.id; select.append(option); }
        select.value = current.stage; select.addEventListener('change', () => changeView({ stage: select.value })); label.append(select); host.append(label);
      } else if (area !== 'more') {
        for (const id of model.LOCAL_STAGES[area]) {
          const label = { to_order: 'To order', blanks_cart: 'In cart', blanks_ordered: 'Ordered', print: 'To Print', completed: 'Printed' }[id];
          const control = button(`${label} (${snapshot.counts[id] || 0})`, () => guarded(() => {
            state.update(area, { stage: id, scrollTop: 0 }); resetSelection();
            navigation.navigateMobile(area, { subview: id, guarded: true }); render(false); scroll.scrollTop = 0;
            $('.mw-subviews [aria-pressed="true"]')?.focus({ preventScroll: true });
          }));
          control.setAttribute('aria-pressed', String(current.stage === id)); host.append(control);
        }
      }
    }
    function renderTools() {
      const host = $('.mw-tools');
      const signature = JSON.stringify([area, view().stage, window.productionPlanner?.filterLabel?.(), document.getElementById('ss-last-result')?.classList.contains('hidden')]);
      if (host.dataset.signature === signature) return;
      host.dataset.signature = signature; host.replaceChildren(); host.hidden = !['supplies', 'print'].includes(area);
      if (area === 'supplies') {
        host.append(button('Receive Batches', () => guarded(() => { returnFocus = document.activeElement; void window.blanksBatchFoundation?.openReceiveOverlay(); })),
          button('Supplies tools', () => guarded(() => {
            actions.content.replaceChildren(); actions.dialog.querySelector('h2').textContent = 'Supplies tools'; returnFocus = document.activeElement;
            const entries = [['Manual add checklist', () => document.getElementById('manual-add-checklist-btn')?.click()],
              ['View last S&S result', () => document.getElementById('ss-last-result')?.click()],
              ['Cart garment requirements', () => window.cartGarmentView?.openMobile?.()]];
            for (const [label, act] of entries) {
              const control = button(label, () => { actions.dialog.close(); act(); });
              if (label === 'View last S&S result' && document.getElementById('ss-last-result')?.classList.contains('hidden')) {
                control.disabled = true; control.textContent = 'No saved S&S result';
              }
              actions.content.append(control);
            }
            actions.content.append(el('p', 'Open an order to manage its blank allocations and item details.', 'mw-action-reason'));
            actions.dialog.showModal();
          })));
      } else if (area === 'print') {
        host.append(button('Plan production', () => guarded(() => window.productionPlanner?.open('queue'))),
          button('Today’s run', () => guarded(() => window.productionPlanner?.open('run'))));
        const filter = window.productionPlanner?.filterLabel?.();
        if (filter && view().stage === 'print') host.append(el('span', filter, 'mw-action-reason'), button('Show all', () => window.productionPlanner.clearFilter()));
      }
    }
    function render(preserve = true) {
      if (!enabled()) return;
      const activeView = document.body.dataset.activeView || 'orders';
      root.hidden = activeView !== 'orders';
      for (const control of nav.querySelectorAll('button')) {
        const active = control.dataset.mobileAreaTarget === area;
        control.setAttribute('aria-current', active ? 'page' : 'false');
      }
      if (root.hidden) return;
      const anchor = preserve ? captureAnchor() : null;
      const snapshot = list.getSnapshot();
      $('#mobile-workspace-title').textContent = titles[area];
      const more = area === 'more';
      $('.mw-toolbar').hidden = more; $('.mw-rows').hidden = more; $('.mw-more').hidden = !more;
      $('.mw-count').textContent = more ? 'Other work areas' : '';
      renderSubviews(snapshot); renderTools();
      if (more) {
        $('.mw-selection').hidden = true; $('.mw-empty').hidden = true;
        const host = $('.mw-more');
        if (!host.children.length) for (const [destination, label] of [['prepared', 'Prepared Orders'], ['drafts', 'Draft Orders'], ['inventory', 'Inventory'], ['previous', 'History'], ['storage', 'Storage Browser']]) host.append(button(label, () => navigation.navigateMobile('more', { destination })));
        return;
      }
      const result = state.browse(area, snapshot);
      if (area === 'print' && view().stage === 'print' && window.productionPlanner?.matchesOrder) {
        result.rows = result.rows.filter(row => window.productionPlanner.matchesOrder(findOrder(row.key)));
        result.shown = result.rows.length;
      }
      currentRows = result.rows;
      search.disabled = busy || Boolean(editor);
      $('.mw-refresh').disabled = busy || document.body.dataset.boardLoadState === 'loading';
      $('.mw-refresh span').textContent = document.body.dataset.boardLoadState === 'loading' ? 'Loading' : 'Refresh';
      const keys = new Set(currentRows.map(row => row.key)); selected = new Set([...selected].filter(key => keys.has(key)));
      const filtersCount = Object.values(view().filters).filter(value => value !== 'all').length;
      $('.mw-filters').textContent = filtersCount ? `Filters (${filtersCount})` : 'Filters'; search.value = view().query;
      const loadState = document.body.dataset.boardLoadState;
      $('.mw-count').textContent = !snapshot.total && loadState === 'loading' ? 'Loading orders…'
        : !snapshot.total && loadState === 'error' ? 'Orders unavailable'
          : `${result.shown} ${result.shown === 1 ? 'order' : 'orders'}${view().query || filtersCount ? ' matching' : ''}${snapshot.identityErrors ? ` · ${snapshot.identityErrors} unavailable` : ''}`;
      for (const [key, record] of records) if (!keys.has(key) && editor?.key !== key) { record.node.remove(); records.delete(key); }
      let cursor = rows.firstChild;
      for (const row of currentRows) {
        let record = records.get(row.key); if (!record) { record = makeRow(row); records.set(row.key, record); }
        renderRow(row, record); if (record.node !== cursor) rows.insertBefore(record.node, cursor); cursor = record.node.nextSibling;
      }
      if (editor && !keys.has(editor.key)) {
        const record = records.get(editor.key);
        if (record) { rows.append(record.node); record.node.querySelector('.mw-error').textContent = 'This order left the current view. Cancel and review its current state.'; }
      }
      renderSelection();
      const load = document.body.dataset.boardLoadState, empty = $('.mw-empty'); empty.hidden = result.shown > 0 || Boolean(editor);
        if (!empty.hidden) {
        empty.replaceChildren(el('p', load === 'loading' ? 'Loading orders…' : load === 'error' ? (snapshot.total ? 'No cached orders match. Refresh failed.' : 'Orders could not be loaded.') : snapshot.total ? 'No orders match this view.' : 'No active orders.'));
        if (load === 'error') empty.append(button('Try again', refresh));
        else if (load === 'ready' && (view().query || filtersCount || (area === 'orders' && view().stage !== 'all'))) empty.append(button('Clear filters', () => { state.clear(area); navigation.navigateMobile(area, { subview: view().stage, guarded: true }); render(false); }));
      }
      if (load === 'error' && snapshot.total) announce('Refresh failed. Showing cached orders; use Refresh to try again.', true);
      const results = $('.mw-results'); results.hidden = !lastResults.length;
      if (lastResults.length) {
        results.querySelector('summary').textContent = `${lastResults.filter(item => item.outcome === 'saved').length} of ${lastResults.length} orders saved`;
        results.querySelector('ul').replaceChildren(...lastResults.map(item => el('li', `${item.number}: ${item.message}`)));
        const old = results.querySelector('button'); old?.remove();
        if (list.workflowState().remaining.length) {
          const retry = button('Retry remaining steps', () => void runAction([], '', retry, true)); results.append(retry); results.open = true;
        } else if (lastResults.some(item => item.outcome !== 'saved')) results.open = true;
      }
      root.setAttribute('aria-busy', String(busy));
      if (restoredScroll) { scroll.scrollTop = view().scrollTop; restoredScroll = false; }
      else if (preserve) restoreAnchor(anchor);
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(() => { frame = 0; render(); }); }
    function revealEditorInput() {
      if (!enabled() || !editor || root.hidden) return;
      const input = root.querySelector('#mw-progress-input');
      if (!input || document.activeElement !== input) return;
      const bounds = scroll.getBoundingClientRect(), rect = input.getBoundingClientRect();
      if (rect.bottom > bounds.bottom - 12) scroll.scrollTop += rect.bottom - bounds.bottom + 12;
      else if (rect.top < bounds.top + 12) scroll.scrollTop += rect.top - bounds.top - 12;
    }
    const resizeEditor = () => requestAnimationFrame(() => requestAnimationFrame(revealEditorInput));
    window.addEventListener('resize', resizeEditor);
    window.visualViewport?.addEventListener('resize', resizeEditor);
    function refresh() { guarded(() => document.getElementById('order-manager-refresh-btn')?.click()); }
    $('.mw-refresh').addEventListener('click', refresh);
    $('.mw-filters').addEventListener('click', openFilters);
    $('.mw-select').addEventListener('click', () => guarded(() => { selectionMode = !selectionMode; selected.clear(); render(); }));
    search.addEventListener('input', () => { state.update(area, { query: search.value, scrollTop: 0 }); selected.clear(); render(false); scroll.scrollTop = 0; });
    scroll.addEventListener('scroll', remember, { passive: true });
    document.addEventListener('printmo:mobile-area-changed', syncArea);
    document.addEventListener('printmo:workspace-changed', syncArea);
    document.addEventListener('printmo:detail-closed', restoreDetail);
    document.addEventListener('printmo:production-planning-filter', () => {
      if (enabled() && area === 'print' && window.productionPlanner?.filterLabel?.()) navigation.navigateMobile('print', { subview: 'print', guarded: true });
      schedule();
    });
    for (const name of ['printmo:board-updated', 'printmo:blanks-accounting-updated', 'printmo:progress-save']) document.addEventListener(name, schedule);
    const detail = document.getElementById('detail-overlay');
    if (detail) new MutationObserver(restoreDetail).observe(detail, { attributes: true, attributeFilter: ['class', 'aria-hidden'] });
    new MutationObserver(updateEnabled).observe(document.body, { attributes: true, attributeFilter: ['data-order-source', 'data-board-load-state'] });
    media.addEventListener('change', updateEnabled);
    window.MobileOrderWorkspace = Object.freeze({ refresh: schedule, getState: () => ({ area, ...view(), selected: [...selected], busy }) });
    updateEnabled();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, { once: true }); else setup();
})();
