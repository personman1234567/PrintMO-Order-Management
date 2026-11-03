/* One explicit order target, shared by Board, List and mobile Actions. */
(() => {
  const model = window.OrderBoardModel;
  if (!model || !window.OrderActionModel) return;
  const details = new Map();
  let menu, primary, submenu, heading, status, context = null, page = '', pending = false;
  let hoverTimer, flyoutExitTimer, flyoutTrigger = null;
  const editableTarget = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
  const nativeTarget = 'a, img, svg, video, audio, canvas, input, textarea, select, button, label, [contenteditable]:not([contenteditable="false"])';
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const mobile = () => matchMedia('(max-width: 600px)').matches;
  const snapshot = () => window.getOrderManagerBoardSnapshot?.() || [];
  const resolve = key => snapshot().find(order => model.orderKey(order) === key);
  const stamp = order => JSON.stringify([order?.canonical?.shopifyUpdatedAt, order?.canonical?.updatedAt, order?.canonical?.sourceUpdatedAt,
    (order?.canonical?.commerce?.lineItems || []).map(item => [item.id, item.currentQuantity ?? item.quantity, item.variantTitle])]);
  const loaded = order => {
    const cached = details.get(model.orderKey(order));
    return cached?.stamp === stamp(order) ? cached.detail : null;
  };
  function announce(message, error = false) {
    if (!status) {
      status = el('p', '', 'order-action-status');
      status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      document.body.append(status);
    }
    status.textContent = message; status.hidden = !message;
    status.classList.toggle('is-error', error);
    if (context && error) {
      const panel = page ? submenu : primary;
      let feedback = panel.querySelector('.order-action-feedback');
      if (!feedback) { feedback = el('p', '', 'order-action-feedback'); feedback.setAttribute('role', 'status'); panel.append(feedback); }
      feedback.textContent = message; position();
    }
    clearTimeout(announce.timer);
    if (!error) announce.timer = setTimeout(() => { status.hidden = true; }, 5000);
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
  function focusFirst(panel) { panel.querySelector('[role="menuitem"]')?.focus(); }
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
      submenu.style.top = `${Math.max(12, Math.min(trigger.top, height - submenu.offsetHeight - 12)) - main.top}px`;
    }
  }
  function close(restore = true) {
    if (!context) return;
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
    if (restore) trigger?.focus();
  }
  function cancelHoverClose() { clearTimeout(hoverTimer); hoverTimer = null; }
  function scheduleHoverClose() {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => { hoverTimer = null; if (context && page && !mobile()) panelBack(false, true); }, 140);
  }
  function action(label, callback, { enabled = true, reason = '', panel = primary, danger = false } = {}) {
    const button = el('button', undefined, danger ? 'order-action-item is-danger' : 'order-action-item');
    button.type = 'button'; button.setAttribute('role', 'menuitem'); button.tabIndex = -1;
    button.append(el('span', label));
    button.setAttribute('aria-disabled', String(!enabled));
    if (reason) button.append(el('small', reason));
    button.addEventListener('click', event => {
      event.stopPropagation();
      if (button.getAttribute('aria-disabled') === 'true') return;
      callback(button);
    });
    panel.append(button); return button;
  }
  function showSub(kind, focus = true) {
    const order = resolve(context?.key);
    if (!order || busy()) return;
    cancelHoverClose(); clearTimeout(flyoutExitTimer);
    if (page === kind && !submenu.hidden && submenu.dataset.state === 'open') { if (focus) focusFirst(submenu); return; }
    flyoutTrigger = primary.querySelector(`[data-submenu="${kind}"]`);
    page = kind; submenu.replaceChildren(); submenu.hidden = false;
    submenu.dataset.state = 'open';
    primary.hidden = mobile();
    submenu.setAttribute('aria-label', kind === 'copy' ? 'Copy order information' : 'Move production stage');
    if (mobile()) { const back = action('Back', () => panelBack(), { panel: submenu }); back.classList.add('order-action-back'); }
    if (kind === 'copy') {
      for (const field of window.OrderActionModel.copyFields(order, { detail: loaded(order) })) {
        action(field.label, () => copy(field.id), { ...field, panel: submenu });
      }
    } else {
      const choices = window.OrderManagerViews?.actions([context.key]) || [];
      for (const item of choices.filter(item => item.value.startsWith('move:') && !item.hidden)) {
        action(item.label, () => move(item.value), { ...item, panel: submenu });
      }
      if (!choices.length) action('Stage actions unavailable', () => {}, { enabled: false, reason: 'Refresh the app and try again.', panel: submenu });
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
    if (!value.enabled) { showSub('copy'); announce(value.reason, true); return; }
    try {
      if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('Clipboard access is unavailable.');
      // Keep the clipboard call inside this explicit user activation.
      await navigator.clipboard.writeText(value.text);
      if (context === sourceContext) close();
      announce('Copied.');
    } catch { announce('Could not copy. Try again, or open the order and copy the text manually.', true); }
  }
  async function move(value) {
    const saved = context, order = resolve(saved?.key);
    if (!order || !writable(order) || busy()) return;
    const choice = window.OrderManagerViews?.actions([saved.key]).find(item => item.value === value);
    if (!choice?.enabled) { announce(choice?.reason || 'This stage move is unavailable.', true); return; }
    close(); pending = true;
    try {
      const result = await window.OrderManagerViews.reviewOrders([saved.key], value, saved.opener);
      if (result) {
        const outcomes = result.results || [];
        const unresolved = outcomes.filter(item => item.outcome !== 'saved');
        announce(result.notice || outcomes.map(item => item.message || item.outcome).join(' ') || 'Review the action result.', unresolved.length > 0);
      }
    } catch (error) { announce(error.message || 'The stage move failed. Review the order and try again.', true); }
    finally { pending = false; }
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
  async function remove() {
    const order = resolve(context?.key);
    if (!order || !writable(order) || !window.OrderActionModel.canRemoveFromBoard(order) || busy() || typeof removeOrderFromBoard !== 'function') return;
    close(); pending = true;
    try { await removeOrderFromBoard(order); }
    catch (error) { announce(`Could not remove order: ${error.message || error}`, true); }
    finally { pending = false; }
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
    document.addEventListener('pointerdown', event => { if (context && !menu.contains(event.target) && !context.opener?.contains(event.target)) close(false); }, true);
    document.addEventListener('keydown', event => {
      if (!context) return;
      menu.dataset.input = 'keyboard';
      cancelHoverClose(); clearTimeout(flyoutExitTimer);
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation();
        if (page) panelBack(); else close(); return;
      }
      if (event.key === 'Tab') { close(); return; }
      if (!menu.contains(document.activeElement)) return;
      const panel = document.activeElement.closest('[role="menu"]');
      const items = [...panel.querySelectorAll('[role="menuitem"]')];
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
    window.addEventListener('resize', () => { if (context) { close(); } });
    window.addEventListener('blur', () => close(false));
    document.addEventListener('printmo:board-updated', () => { if (context) close(); });
    new MutationObserver(records => {
      close(false);
      if (records.some(record => record.attributeName === 'data-order-source')) details.clear();
    }).observe(document.body, { attributes: true, attributeFilter: ['data-order-source', 'data-active-view'] });
  }
  function open(key, opener, point, { input = 'pointer' } = {}) {
    if (document.body.dataset.orderSource !== 'shopify' || busy()) return;
    const order = resolve(key);
    if (!order?._candidate) return;
    setup(); close(false); context = { key, opener, point };
    menu.dataset.input = input;
    primary.hidden = false; primary.replaceChildren(heading); submenu.hidden = true;
    primary.dataset.state = 'open';
    const number = window.OrderActionModel.copyField(order, 'orderNumber');
    heading.textContent = `${order._provider === 'etsy' ? 'Etsy' : 'Shopify'} ${number.enabled ? number.text : 'order'}`;
    const copyButton = branch('Copy', 'copy');
    copyButton.dataset.copyTrigger = 'true'; copyButton.setAttribute('aria-haspopup', 'menu'); copyButton.setAttribute('aria-expanded', 'false');
    const choices = window.OrderManagerViews?.actions([key]) || [];
    const moves = choices.filter(item => item.value.startsWith('move:') && !item.hidden);
    const moveEnabled = writable(order) && moves.some(item => item.enabled);
    branch('Move production stage\u2026', 'move', { enabled: moveEnabled,
      reason: moveEnabled ? '' : !writable(order) ? 'This order is read-only.' : moves[0]?.reason || 'Stage actions are unavailable. Refresh the app and try again.' });
    const count = countState(order);
    if (count.visible) action('Edit printed count\u2026', () => void editCount(), count);
    if (writable(order) && window.OrderActionModel.canRemoveFromBoard(order)) { primary.append(el('hr')); action('Remove from board\u2026', () => void remove(), { danger: true }); }
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
