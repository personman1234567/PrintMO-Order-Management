/* One explicit order target, shared by Board, List and mobile Actions. */
(() => {
  const model = window.OrderBoardModel;
  if (!model || !window.OrderActionModel) return;
  const details = new Map();
  let menu, primary, submenu, heading, status, context = null, page = '', pending = false;
  let hoverTimer, flyoutExitTimer, flyoutTrigger = null;
  const editableTarget = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
  const nativeTarget = 'a, img, svg, video, audio, canvas, input, textarea, select, button, label, [contenteditable]:not([contenteditable="false"])';
  const menuItems = '[role="menuitem"], [role="menuitemradio"]';
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const iconPaths = {
    copy: 'M6 5V2h8v9h-3M2 5h9v9H2z',
    move: 'M2 5h11m-3-3 3 3-3 3M14 11H3m3-3-3 3 3 3',
    prints: 'M5 2h8v10H5zM2 5v9h8M7 5h4M7 8h4',
    blanks: 'm5 2-4 3 2 3 2-1v7h6V7l2 1 2-3-4-3c0 3-6 3-6 0Z',
    count: 'M6 2 4 14M12 2l-2 12M2 6h12M1 10h12',
    date: 'M3 3h10v11H3zM5 1v4M11 1v4M3 7h10M6 10h1M9 10h1',
    notes: 'M3 2h7l3 3v9H3zM10 2v3h3M5 8h6M5 11h5',
    remove: 'M2 3h12v3H2zM3 6v8h10V6M6 9h4',
    back: 'm7 3-5 5 5 5M2 8h12'
  };
  function actionIcon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false'); svg.classList.add('order-action-icon');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', iconPaths[name]); svg.append(path); return svg;
  }
  const mobile = () => matchMedia('(max-width: 600px)').matches;
  const touchSheet = () => context?.presenter === 'mobile';
  const snapshot = () => window.getOrderManagerBoardSnapshot?.() || [];
  const resolve = key => snapshot().find(order => model.orderKey(order) === key);
  const stamp = order => JSON.stringify([order?.canonical?.shopifyUpdatedAt, order?.canonical?.updatedAt, order?.canonical?.sourceUpdatedAt,
    (order?.canonical?.commerce?.lineItems || []).map(item => [item.id, item.currentQuantity ?? item.quantity, item.variantTitle])]);
  const loaded = order => {
    const cached = details.get(model.orderKey(order));
    return cached?.stamp === stamp(order) ? cached.detail : null;
  };
  function announce(message, error = false, { persist = false } = {}) {
    if (touchSheet()) { window.MobileOrderActions.feedback(message, error); return; }
    if (!status) {
      status = el('p', '', 'order-action-status');
      status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      document.body.append(status);
    }
    status.textContent = message; status.hidden = !message;
    status.classList.toggle('is-error', error);
    if (context && error) {
      const panel = page ? submenu.querySelector('.order-action-scroll') : primary;
      let feedback = panel.querySelector('.order-action-feedback');
      if (!feedback) { feedback = el('p', '', 'order-action-feedback'); feedback.setAttribute('role', 'status'); panel.append(feedback); }
      feedback.textContent = message; position();
    }
    clearTimeout(announce.timer);
    if (!error && !persist) announce.timer = setTimeout(() => { status.hidden = true; }, 5000);
  }
  const writable = order => Boolean(document.body.dataset.orderSource === 'shopify' && order?._candidate && !order._historyReadOnly
    && order._capabilities?.productionWrite !== false
    && String(order.displayFulfillmentStatus).toUpperCase() !== 'FULFILLED'
    && (typeof orderIsVisibleOnOperationalBoard !== 'function' || orderIsVisibleOnOperationalBoard(order)));
  const busy = () => pending || document.body.dataset.orderWorkflowSaving === 'true'
    || window.OrderManagerViews?.workflowState?.().busy;
  function countState(order) {
    if (!writable(order) || !['print', 'completed'].includes(model.stageForOrder(order))) return { visible: false, enabled: false };
    if (order._eligibilityMutationPending) return { visible: true, enabled: false, reason: 'Printable pieces are being updated.' };
    const total = typeof printablePieceTotal === 'function' ? printablePieceTotal(order) : null;
    return { visible: true, enabled: total > 0, reason: total > 0 ? '' : total === null
      ? 'Printable quantity is unavailable. Open order details first.'
      : 'No printable pieces are selected. Review printable pieces in order details.' };
  }
  const countAllowed = order => countState(order).enabled;
  function editorState(order, kind) {
    const api = kind === 'targetDate' ? 'updateTargetDate' : 'updateNotes';
    const enabled = writable(order) && typeof window.api?.[api] === 'function'
      && typeof window.OrderDetailEditors?.edit === 'function';
    return { enabled, reason: enabled ? '' : !writable(order) ? 'This order is read-only.'
      : 'The editor is unavailable. Refresh the app and try again.' };
  }
  function focusFirst(panel) { (panel.querySelector('[role="menuitemradio"][aria-checked="true"]') || panel.querySelector(menuItems))?.focus(); }
  function position() {
    if (!context || !menu) return;
    menu.classList.toggle('is-mobile', mobile());
    const width = document.documentElement.clientWidth, height = window.innerHeight;
    if (mobile()) { menu.style.left = '12px'; menu.style.top = 'auto'; menu.style.bottom = '12px'; return; }
    menu.style.bottom = 'auto';
    const rect = context.opener?.getBoundingClientRect();
    const point = context.point || { x: rect?.left || 12, y: rect?.bottom || 12 };
    if (!context.placed) {
      menu.style.left = `${Math.max(12, Math.min(point.x, width - primary.offsetWidth - 12))}px`;
      menu.style.top = `${Math.max(12, Math.min(point.y, height - primary.offsetHeight - 12))}px`;
      context.placed = true;
    }
    if (page && !submenu.hidden) {
      let main = primary.getBoundingClientRect();
      const gap = 6, subWidth = submenu.offsetWidth;
      let left = main.right + gap + subWidth > width - 12;
      if (left && main.left - gap - subWidth < 12) {
        menu.style.left = `${Math.max(12, width - primary.offsetWidth - subWidth - gap - 12)}px`;
        main = primary.getBoundingClientRect(); left = false;
      }
      submenu.dataset.side = left ? 'left' : 'right';
      submenu.style.left = `${left ? -subWidth - gap : main.width + gap}px`;
      const trigger = flyoutTrigger?.getBoundingClientRect() || main;
      const top = Math.max(12, Math.min(trigger.top, height - submenu.offsetHeight - 12));
      submenu.style.top = `${top - main.top}px`;
      submenu.style.transformOrigin = `${left ? 'right' : 'left'} ${Math.max(0, Math.min(submenu.offsetHeight, trigger.top + trigger.height / 2 - top))}px`;
    }
  }
  function close(restore = true) {
    if (!context) return;
    if (touchSheet()) {
      const saved = context;
      window.MobileOrderActions.close(restore); context = null; page = '';
      if (restore && (!saved.opener?.isConnected || !saved.opener.getClientRects().length)) {
        const row = [...document.querySelectorAll('#mobile-order-workspace .mw-row')].find(node => node.dataset.orderKey === saved.key);
        (row?.querySelector('.mw-row-actions') || document.querySelector('#mobile-order-workspace .mw-search input'))?.focus({ preventScroll: true });
      }
      return;
    }
    const opener = context.opener;
    clearTimeout(hoverTimer); clearTimeout(flyoutExitTimer); hoverTimer = null;
    context = null; page = '';
    menu.hidden = true;
    try { if (menu.matches(':popover-open')) menu.hidePopover(); } catch { /* Fixed fallback. */ }
    opener?.setAttribute('aria-expanded', 'false');
    if (restore && opener?.isConnected) opener.focus({ preventScroll: true });
  }
  function panelBack(restore = true, animate = false) {
    clearTimeout(hoverTimer); clearTimeout(flyoutExitTimer); hoverTimer = null;
    const trigger = flyoutTrigger;
    page = ''; primary.hidden = false;
    primary.querySelectorAll('[data-submenu]').forEach(button => button.setAttribute('aria-expanded', 'false'));
    submenu.dataset.state = 'closed';
    if (animate && !mobile() && menu.dataset.input !== 'keyboard' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      flyoutExitTimer = setTimeout(() => { submenu.hidden = true; }, 80);
    } else submenu.hidden = true;
    if (restore || submenu.contains(document.activeElement)) trigger?.focus({ preventScroll: true });
  }
  function cancelHoverClose() { clearTimeout(hoverTimer); hoverTimer = null; }
  function scheduleHoverClose() {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      hoverTimer = null;
      if (menu.dataset.input === 'keyboard' && submenu.contains(document.activeElement)) return;
      if (context && page && !mobile()) panelBack(false, true);
    }, 140);
  }
  function action(label, callback, { enabled = true, reason = '', panel = primary, danger = false, checked = null, icon = '', value = '', state = '' } = {}) {
    const button = el('button', undefined, danger ? 'order-action-item is-danger' : 'order-action-item');
    button.type = 'button'; button.setAttribute('role', checked === null ? 'menuitem' : 'menuitemradio'); button.tabIndex = -1;
    if (checked !== null) button.setAttribute('aria-checked', String(checked));
    if (icon) { button.classList.add('has-icon'); button.append(actionIcon(icon)); }
    button.append(el('span', label, 'order-action-label'));
    if (value) {
      const current = el('span', value, 'order-action-value'); current.dataset.state = state;
      button.classList.add('has-value'); button.append(current);
      button.setAttribute('aria-label', `${label}: ${value}${reason ? `. ${reason}` : ''}`);
    }
    button.setAttribute('aria-disabled', String(!enabled));
    if (reason) button.append(el('small', reason, 'order-action-reason'));
    button.addEventListener('click', event => {
      event.stopPropagation();
      if (button.getAttribute('aria-disabled') === 'true') return;
      callback(button);
    });
    panel.append(button); return button;
  }
  function showSub(kind, focus = true) {
    const order = resolve(context?.key);
    if (!order || busy() || primary.querySelector(`[data-submenu="${kind}"]`)?.getAttribute('aria-disabled') === 'true') return;
    cancelHoverClose(); clearTimeout(flyoutExitTimer);
    if (page === kind && !submenu.hidden && submenu.dataset.state === 'open') { if (focus) focusFirst(submenu); return; }
    flyoutTrigger = primary.querySelector(`[data-submenu="${kind}"]`);
    if (!focus && submenu.contains(document.activeElement)) flyoutTrigger?.focus({ preventScroll: true });
    const content = el('div', undefined, 'order-action-scroll');
    page = kind; submenu.replaceChildren(content); submenu.hidden = false;
    submenu.dataset.state = 'open';
    primary.hidden = mobile();
    const material = Object.hasOwn(model.MATERIAL_OPTIONS, kind);
    submenu.setAttribute('aria-label', material ? `${kind === 'prints' ? 'Prints' : 'Blanks'} status` : kind === 'copy' ? 'Copy order information' : 'Move production stage');
    if (mobile()) { const back = action('Back', () => panelBack(), { panel: content, icon: 'back' }); back.classList.add('order-action-back'); }
    if (kind === 'copy') {
      for (const field of window.OrderActionModel.copyFields(order, { detail: loaded(order) })) {
        action(field.label, () => copy(field.id), { ...field, panel: content });
      }
    } else if (material) {
      const current = model.materialForOrder(order, kind);
      if (mobile()) content.append(el('p', `${kind === 'prints' ? 'Prints' : 'Blanks'} status`, 'order-action-heading'));
      for (const [value, label] of model.MATERIAL_OPTIONS[kind]) {
        action(label, () => void setMaterial(kind, value), { panel: content, checked: current.value === value,
          enabled: writable(order) && typeof window.api?.updateReady === 'function' });
      }
    } else {
      const choices = window.OrderManagerViews?.actions([context.key]) || [];
      for (const item of choices.filter(item => item.value.startsWith('move:') && !item.hidden)) {
        action(item.label, () => move(item.value), { ...item, panel: content });
      }
      if (!choices.length) action('Stage actions unavailable', () => {}, { enabled: false, reason: 'Refresh the app and try again.', panel: content });
    }
    primary.querySelectorAll('[data-submenu]').forEach(button => button.setAttribute('aria-expanded', String(button === flyoutTrigger)));
    position(); if (focus) focusFirst(submenu);
  }
  function branch(label, kind, options = {}) {
    const button = action(label, () => showSub(kind), options);
    button.dataset.submenu = kind; button.classList.add('has-submenu');
    button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false');
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrow.setAttribute('viewBox', '0 0 16 16'); arrow.setAttribute('aria-hidden', 'true'); arrow.classList.add('order-action-chevron');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'm6 4 4 4-4 4'); arrow.append(path); button.append(arrow);
    button.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'mouse' || mobile() || button.getAttribute('aria-disabled') === 'true') return;
      menu.dataset.input = 'pointer'; showSub(kind, false);
    });
    button.addEventListener('pointerleave', event => {
      if (event.pointerType === 'mouse' && !submenu.contains(event.relatedTarget)) scheduleHoverClose();
    });
    return button;
  }
  async function copy(id) {
    const sourceContext = context;
    const order = resolve(context?.key);
    if (!order) { close(); announce('This order is no longer in the current view.', true); return; }
    const value = window.OrderActionModel.copyField(order, id, { detail: loaded(order) });
    if (!value.enabled) { if (touchSheet()) window.MobileOrderActions.showPage('copy'); else showSub('copy'); announce(value.reason, true); return; }
    try {
      if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('Clipboard access is unavailable.');
      // Keep the clipboard call inside this explicit user activation.
      await navigator.clipboard.writeText(value.text);
      if (context === sourceContext) { if (touchSheet()) window.MobileOrderActions.showPage(''); else close(); }
      announce('Copied.');
    } catch { announce('Could not copy. Try again, or open the order and copy the text manually.', true); }
  }
  async function move(value) {
    const saved = context, order = resolve(saved?.key);
    if (!order || !writable(order) || busy()) return;
    const choice = window.OrderManagerViews?.actions([saved.key]).find(item => item.value === value);
    if (!choice?.enabled) { announce(choice?.reason || 'This stage move is unavailable.', true); return; }
    const inSheet = touchSheet();
    if (inSheet) window.MobileOrderActions.suspend(); else close();
    pending = true;
    try {
      const result = await window.OrderManagerViews.reviewOrders([saved.key], value, saved.opener);
      if (result) {
        const outcomes = result.results || [];
        const unresolved = outcomes.filter(item => item.outcome !== 'saved');
        announce(result.notice || outcomes.map(item => item.message || item.outcome).join(' ') || 'Review the action result.', unresolved.length > 0);
      }
    } catch (error) { announce(error.message || 'The stage move failed. Review the order and try again.', true); }
    finally {
      pending = false;
      if (inSheet && context === saved) { window.MobileOrderActions.resume(); window.MobileOrderActions.refresh(); }
    }
  }
  async function setMaterial(kind, value) {
    const saved = context, order = resolve(saved?.key);
    if (!order || !writable(order) || busy() || typeof window.api?.updateReady !== 'function') return;
    if (model.materialForOrder(order, kind).value === value) { if (touchSheet()) window.MobileOrderActions.showPage(''); else close(); return; }
    const patch = model.materialPatch(kind, value, order);
    const reference = { provider: order._provider, orderKey: order._orderKey || order._gid };
    const label = model.MATERIAL_OPTIONS[kind].find(option => option[0] === value)[1];
    const number = window.OrderActionModel.copyField(order, 'orderNumber');
    const target = number.enabled ? number.text : 'Order';
    const inSheet = touchSheet();
    if (!inSheet) close();
    pending = true;
    if (inSheet) window.MobileOrderActions.refresh();
    document.body.dataset.orderActionSaving = 'true';
    announce(`${target} · Saving ${kind} status…`, false, { persist: true });
    try {
      // The source-aware adapter owns CAS, serialization and the shared board repaint.
      await window.api.updateReady(reference, patch);
      if (inSheet && context === saved) window.MobileOrderActions.showPage('');
      announce(`${target} · ${kind === 'prints' ? 'Prints' : 'Blanks'}: ${label}.`);
    } catch (error) { announce(`${target} · Status was not saved. ${error?.message || 'Try again.'}`, true); }
    finally {
      pending = false; delete document.body.dataset.orderActionSaving;
      if (inSheet && context === saved) window.MobileOrderActions.refresh();
    }
  }
  async function editCount() {
    const order = resolve(context?.key);
    if (!order || !countAllowed(order) || busy()) return;
    close();
    const open = window.openOrderManagerDetail || window.openDetail;
    if (typeof open !== 'function' || open(order) === false) return;
    // Normal detail opening owns hydration; wait for that same promise, never a second fetch.
    let hydration;
    try { hydration = await window.OrderActionsDetailReady?.(order); }
    catch { announce('Current order detail could not load. Open the order and try again.', true); return; }
    if (hydration?.ok !== true || !document.getElementById('detail-overlay')?.classList.contains('visible')
      || (typeof detailOrder !== 'undefined' && detailOrder !== order)) return;
    if (!countAllowed(order)) { announce('Printed count is unavailable for the current order state.', true); return; }
    const control = document.getElementById('progress-custom');
    if (control && !control.disabled) { control.click(); document.getElementById('progress-input')?.focus(); }
  }
  async function editDetail(kind) {
    const order = resolve(context?.key);
    if (!order || busy() || !editorState(order, kind).enabled) return;
    const view = document.body.dataset.activeView;
    close();
    const open = window.openOrderManagerDetail || window.openDetail;
    if (typeof open !== 'function' || open(order) === false) return;
    const ready = window.OrderActionsDetailReady;
    const stillActive = () => writable(order) && document.body.dataset.activeView === view
      && window.OrderActionsDetailReady === ready
      && document.getElementById('detail-overlay')?.classList.contains('visible')
      && (typeof detailOrder === 'undefined' || detailOrder === order);
    try {
      const hydration = typeof ready === 'function' ? await ready(order) : null;
      if (!stillActive()) return;
      if (hydration?.ok !== true) {
        announce('Current order detail could not load. Use Retry in the order before editing.', true);
        return;
      }
      if (!editorState(order, kind).enabled || !window.OrderDetailEditors.edit(kind, order)) {
        announce('This editor is unavailable for the current order. Review its details before editing.', true);
      } else announce('');
    } catch (error) {
      if (stillActive()) announce(`The editor could not open. ${error?.message || 'Retry loading the order.'}`, true);
    }
  }
  async function remove() {
    const order = resolve(context?.key);
    if (!order || !writable(order) || !window.OrderActionModel.canRemoveFromBoard(order) || busy() || typeof removeOrderFromBoard !== 'function') return;
    close(); pending = true;
    try { await removeOrderFromBoard(order); }
    catch (error) { announce(`Could not remove order: ${error.message || error}`, true); }
    finally { pending = false; }
  }
  function sheetPage(kind = '') {
    const order = resolve(context?.key);
    if (!order?._candidate || document.body.dataset.orderSource !== 'shopify') return null;
    const summary = model.summarize(order);
    const number = window.OrderActionModel.copyField(order, 'orderNumber');
    const base = { customer: summary?.customer || 'Order', number: number.enabled ? number.text : summary?.number || 'Order',
      source: order._provider === 'etsy' ? 'Etsy' : 'PrintMO', busy: Boolean(busy()), groups: [] };
    const unavailable = !writable(order) ? 'This order is read-only.' : 'Status actions are unavailable. Refresh the app and try again.';
    const stateEnabled = writable(order) && typeof window.api?.updateReady === 'function';
    const item = (id, label, run, options = {}) => ({ id, label, run, enabled: true, ...options });
    const navigate = next => () => window.MobileOrderActions.showPage(next);
    const moves = (window.OrderManagerViews?.actions([context.key]) || []).filter(choice => choice.value.startsWith('move:'));
    if (kind === 'move') {
      base.title = 'Stage';
      const stage = model.stageForOrder(order), label = model.STAGES.find(value => value.id === stage)?.label || 'Unknown stage';
      base.groups = [{ items: [
        item('current-stage', label, () => window.MobileOrderActions.showPage(''), { checked: true, icon: 'stage' }),
        ...moves.filter(choice => !choice.hidden).map(choice => item(choice.value, choice.label, () => void move(choice.value),
          { enabled: writable(order) && choice.enabled, reason: choice.reason, checked: false, icon: 'stage' }))
      ] }];
    } else if (kind === 'prints' || kind === 'blanks') {
      base.title = kind === 'prints' ? 'Prints' : 'Blanks';
      const current = model.materialForOrder(order, kind);
      base.groups = [{ items: model.MATERIAL_OPTIONS[kind].map(([value, label]) => item(kind + ':' + value, label,
        () => void setMaterial(kind, value), { icon: kind, checked: current.value === value, enabled: stateEnabled, reason: stateEnabled ? '' : unavailable })) }];
    } else if (kind === 'copy') {
      base.title = 'Copy order details';
      base.groups = [{ items: window.OrderActionModel.copyFields(order, { detail: loaded(order) }).map(field =>
        item('copy:' + field.id, field.label, () => void copy(field.id), { enabled: field.enabled, reason: field.reason, icon: 'copy' })) }];
    } else {
      const stageEnabled = writable(order) && moves.some(choice => !choice.hidden && choice.enabled);
      const statusItems = [item('move', 'Stage', navigate('move'), { icon: 'stage', branch: true, value: summary?.stageLabel || 'Unknown stage',
        enabled: stageEnabled, reason: stageEnabled ? '' : !writable(order) ? 'This order is read-only.' : 'Stage actions are unavailable.' })];
      for (const statusKind of ['blanks', 'prints']) {
        statusItems.push(item(statusKind, statusKind === 'prints' ? 'Prints' : 'Blanks', navigate(statusKind),
          { icon: statusKind, branch: true, value: model.materialForOrder(order, statusKind).label, enabled: stateEnabled, reason: stateEnabled ? '' : unavailable }));
      }
      const more = [
        item('targetDate', 'Target date', () => void editDetail('targetDate'), { ...editorState(order, 'targetDate'), icon: 'date', branch: true, value: order.targetDate || 'No target set' }),
        item('notes', 'Instructions', () => void editDetail('notes'), { ...editorState(order, 'notes'), icon: 'notes', branch: true }),
        item('copy', 'Copy order details', navigate('copy'), { icon: 'copy', branch: true })
      ];
      const count = countState(order);
      if (count.visible) more.unshift(item('count', 'Printed count', () => void editCount(), { ...count, icon: 'count', branch: true }));
      base.groups = [{ items: statusItems }, { title: 'More actions', items: more }];
      if (writable(order) && window.OrderActionModel.canRemoveFromBoard(order)) base.groups.push({ items: [
        item('remove', 'Remove from board', () => void remove(), { icon: 'remove', danger: true })
      ] });
    }
    return base;
  }
  function setup() {
    if (menu) return;
    menu = el('div', undefined, 'order-action-menu'); menu.id = 'order-action-menu'; menu.hidden = true;
    menu.setAttribute('popover', 'manual');
    primary = el('div', undefined, 'order-action-panel'); primary.setAttribute('role', 'menu');
    heading = el('p', '', 'order-action-heading'); heading.id = 'order-action-heading';
    primary.setAttribute('aria-labelledby', heading.id);
    submenu = el('div', undefined, 'order-action-panel order-action-submenu'); submenu.setAttribute('role', 'menu'); submenu.hidden = true;
    menu.append(primary, submenu); document.body.append(menu);
    submenu.addEventListener('pointerenter', cancelHoverClose);
    submenu.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse' && !flyoutTrigger?.contains(event.relatedTarget)) scheduleHoverClose(); });
    document.addEventListener('pointermove', event => {
      if (!context || !page || mobile() || event.pointerType !== 'mouse') return;
      const trigger = flyoutTrigger?.getBoundingClientRect(), sub = submenu.getBoundingClientRect();
      const crossingGap = trigger && event.clientX >= Math.min(trigger.right, sub.right)
        && event.clientX <= Math.max(trigger.left, sub.left)
        && event.clientY >= Math.min(trigger.top, sub.top) && event.clientY <= Math.max(trigger.bottom, sub.bottom);
      if (flyoutTrigger?.contains(event.target) || submenu.contains(event.target) || crossingGap) cancelHoverClose();
      else if (!hoverTimer) scheduleHoverClose();
    });
    menu.addEventListener('click', event => event.stopPropagation());
    menu.addEventListener('pointerdown', () => { menu.dataset.input = 'pointer'; cancelHoverClose(); });
    document.addEventListener('pointerdown', event => { if (context && !touchSheet() && !menu.contains(event.target) && !context.opener?.contains(event.target)) close(false); }, true);
    document.addEventListener('keydown', event => {
      if (!context || touchSheet()) return;
      menu.dataset.input = 'keyboard';
      cancelHoverClose(); clearTimeout(flyoutExitTimer);
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation();
        if (page) panelBack(); else close(); return;
      }
      if (event.key === 'Tab') { close(); return; }
      if (!menu.contains(document.activeElement)) return;
      const panel = document.activeElement.closest('[role="menu"]');
      const items = [...panel.querySelectorAll(menuItems)];
      let index = items.indexOf(document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[index]?.focus();
      } else if (event.key === 'ArrowRight' && document.activeElement.dataset.submenu) {
        event.preventDefault(); showSub(document.activeElement.dataset.submenu);
      } else if (event.key === 'ArrowLeft' && page) { event.preventDefault(); panelBack(); }
    }, true);
    window.addEventListener('resize', () => { if (context && !touchSheet()) close(); });
    window.addEventListener('blur', () => { if (!touchSheet()) close(false); });
    document.addEventListener('printmo:board-updated', () => { if (touchSheet()) window.MobileOrderActions.refresh(); else if (context) close(); });
    new MutationObserver(records => {
      close(false);
      if (records.some(record => record.attributeName === 'data-order-source')) details.clear();
    }).observe(document.body, { attributes: true, attributeFilter: ['data-order-source', 'data-active-view', 'data-mobile-area'] });
  }
  function open(key, opener, point, { input = 'pointer', page: initialPage = '' } = {}) {
    if (document.body.dataset.orderSource !== 'shopify' || busy()) return;
    const order = resolve(key);
    if (!order?._candidate) return;
    setup(); close(false); context = { key, opener, point };
    if (matchMedia('(max-width: 900px)').matches && window.MobileOrderActions) {
      context.presenter = 'mobile'; opener?.setAttribute('aria-haspopup', 'dialog');
      window.MobileOrderActions.open({ opener, getPage: sheetPage, onClose: () => close() }, initialPage);
      return;
    }
    opener?.setAttribute('aria-haspopup', 'menu');
    menu.dataset.input = input;
    primary.hidden = false; primary.replaceChildren(heading); submenu.hidden = true;
    primary.dataset.state = 'open';
    const number = window.OrderActionModel.copyField(order, 'orderNumber');
    const identity = el('span', undefined, 'order-action-heading-title');
    identity.append(el('strong', number.enabled ? number.text : 'Order'), el('span', order._provider === 'etsy' ? 'Etsy' : 'Shopify', 'order-action-heading-source'));
    heading.replaceChildren(identity);
    const customer = model.summarize(order)?.customer;
    if (customer && customer !== 'Name unavailable') heading.append(el('span', customer, 'order-action-heading-customer'));
    const copyButton = branch('Copy', 'copy', { icon: 'copy' });
    copyButton.dataset.copyTrigger = 'true'; copyButton.setAttribute('aria-haspopup', 'menu'); copyButton.setAttribute('aria-expanded', 'false');
    const choices = window.OrderManagerViews?.actions([key]) || [];
    const moves = choices.filter(item => item.value.startsWith('move:') && !item.hidden);
    const moveEnabled = writable(order) && moves.some(item => item.enabled);
    branch('Move production stage\u2026', 'move', { icon: 'move', enabled: moveEnabled,
      reason: moveEnabled ? '' : !writable(order) ? 'This order is read-only.' : moves[0]?.reason || 'Stage actions are unavailable. Refresh the app and try again.' });
    primary.append(el('hr'));
    for (const kind of ['prints', 'blanks']) {
      const material = model.materialForOrder(order, kind);
      const enabled = writable(order) && typeof window.api?.updateReady === 'function';
      branch(kind === 'prints' ? 'Prints' : 'Blanks', kind, { icon: kind, value: material.label, state: material.value, enabled,
        reason: enabled ? '' : !writable(order) ? 'This order is read-only.' : 'Status actions are unavailable. Refresh the app and try again.' });
    }
    primary.append(el('hr'));
    action(order.targetDate ? 'Edit target date\u2026' : 'Set target date\u2026', () => void editDetail('targetDate'),
      { ...editorState(order, 'targetDate'), icon: 'date' });
    action('Edit shop instructions\u2026', () => void editDetail('notes'), { ...editorState(order, 'notes'), icon: 'notes' });
    const count = countState(order);
    if (count.visible) action('Edit printed count\u2026', () => void editCount(), { ...count, icon: 'count' });
    if (writable(order) && window.OrderActionModel.canRemoveFromBoard(order)) { primary.append(el('hr')); action('Remove from board\u2026', () => void remove(), { danger: true, icon: 'remove' }); }
    menu.hidden = false; opener?.setAttribute('aria-expanded', 'true');
    try { menu.showPopover(); } catch { /* Fixed-position fallback uses the same menu. */ }
    position(); focusFirst(primary);
  }
  function attach(node, key, { trigger = true } = {}) {
    if (!node || !key || node.dataset.orderActionsAttached) return;
    node.dataset.orderActionsAttached = 'true';
    const card = node.classList.contains('card');
    if (card && !node.hasAttribute('tabindex')) node.tabIndex = 0;
    let opener;
    if (trigger) {
      opener = el('button', 'Actions', 'order-action-trigger'); opener.type = 'button';
      opener.setAttribute('aria-haspopup', 'menu'); opener.setAttribute('aria-expanded', 'false');
      opener.setAttribute('aria-label', 'Order actions'); opener.draggable = false;
      opener.addEventListener('click', event => { event.stopPropagation(); open(key, opener, undefined, { input: event.detail === 0 ? 'keyboard' : 'pointer' }); });
      opener.addEventListener('dragstart', event => { event.preventDefault(); event.stopPropagation(); });
      (node.querySelector('.recognition-identity, .order-list-identity-line') || node).append(opener);
    }
    node.addEventListener('contextmenu', event => {
      if (event.target.closest(card ? editableTarget : nativeTarget) || (!card && String(window.getSelection?.() || '').trim())) return;
      if (document.body.dataset.orderSource !== 'shopify' || !resolve(key)?._candidate) return;
      event.preventDefault(); event.stopPropagation(); open(key, card ? node : opener || node.querySelector('button'), { x: event.clientX, y: event.clientY });
    });
    node.addEventListener('keydown', event => {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
      if (event.target.closest(editableTarget)) return;
      event.preventDefault(); event.stopPropagation(); open(key, event.target, undefined, { input: 'keyboard' });
    });
  }
  window.OrderActions = Object.freeze({ open, attach, close, isOpen: () => Boolean(context), announce,
    rememberDetail(order, detail) {
      const key = model.orderKey(order); if (!key) return;
      details.delete(key); details.set(key, { detail, stamp: stamp(order) });
      if (details.size > 30) details.delete(details.keys().next().value);
    }
  });
})();
