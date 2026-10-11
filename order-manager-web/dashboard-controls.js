/* Dashboard composition only: retain the existing supplier/receiving handlers. */
(() => {
  function setup() {
    const actions = document.querySelector('#blanks-section .section-actions');
    const section = document.getElementById('blanks-section');
    const tools = document.querySelector('.order-workspace-tools');
    const refresh = document.getElementById('order-manager-refresh-btn');
    const mark = document.getElementById('blanks-mark-ordered-btn');
    const receive = document.getElementById('blanks-receive-batches-btn');
    const manual = document.getElementById('manual-add-checklist-btn');
    if (!actions || !section || !tools || !refresh || !mark || !receive || !manual) return;

    const homes = new Map();
    [refresh, mark, manual, receive].forEach(button => {
      const home = document.createComment('Dashboard control home');
      button.before(home); homes.set(button, home);
    });
    const trigger = document.createElement('button');
    trigger.id = 'supplies-actions-toggle'; trigger.type = 'button';
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-controls', 'supplies-actions-popover');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML = 'Cart actions <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    actions.append(trigger);
    const popover = document.createElement('div');
    popover.id = 'supplies-actions-popover'; popover.setAttribute('popover', 'auto');
    popover.setAttribute('role', 'dialog'); popover.setAttribute('aria-labelledby', 'supplies-actions-title');
    const title = document.createElement('h3'); title.id = 'supplies-actions-title'; title.textContent = 'Cart actions';
    const scope = document.createElement('p'); scope.className = 'supplies-actions-scope';
    popover.append(title, scope); document.body.append(popover);
    const nativePopover = typeof popover.showPopover === 'function';
    let open = false, context = '';
    const available = () => [...popover.querySelectorAll('button')].filter(button => !button.hidden && !button.disabled);
    function position() {
      if (!open) return;
      const bounds = trigger.getBoundingClientRect(), margin = 12;
      popover.style.maxHeight = `${Math.max(0, window.innerHeight - margin * 2)}px`;
      popover.style.left = `${Math.max(margin, Math.min(bounds.right - popover.offsetWidth, document.documentElement.clientWidth - popover.offsetWidth - margin))}px`;
      popover.style.top = `${Math.max(margin, Math.min(bounds.bottom + 6, window.innerHeight - popover.offsetHeight - margin))}px`;
    }
    function close(restoreFocus = false) {
      if (!open) return;
      window.dashboardMotion?.cancelPopover(popover);
      const focusInside = popover.contains(document.activeElement);
      open = false;
      if (nativePopover) popover.hidePopover();
      popover.classList.remove('is-open'); trigger.setAttribute('aria-expanded', 'false');
      if ((restoreFocus || focusInside) && trigger.getClientRects().length) trigger.focus({ preventScroll: true });
    }
    function sync() {
      const candidate = document.body.dataset.orderSource === 'shopify';
      const cart = section.dataset.blanksView !== 'ordered';
      const next = [candidate, cart, document.body.dataset.orderLayout, document.body.dataset.activeView,
        document.body.dataset.activeTab, document.body.dataset.pipelineView, document.querySelector('.panel.create')?.dataset.suppliesView].join('|');
      if (next !== context) { close(); context = next; }
      trigger.hidden = !candidate || !cart;
      if (!candidate) {
        homes.forEach((home, button) => { if (home.nextSibling !== button) home.after(button); });
        return;
      }
      if (refresh.parentNode !== tools) tools.append(refresh);
      if (mark.parentNode !== popover) popover.append(mark);
      if (manual.parentNode !== popover) popover.append(manual);
      // Cart users can still link a subset to a shipment instead of marking every cart order.
      const receiveHome = cart ? popover : actions;
      if (receive.parentNode !== receiveHome) receiveHome.append(receive);
      const count = document.getElementById('blanks-cart-count')?.textContent || '0';
      scope.textContent = `Mark ordered applies to all ${count} cart orders. Link separate shipments with Receive Batches.`;
    }
    trigger.addEventListener('click', event => {
      if (open) return close(true);
      sync();
      if (trigger.hidden) return;
      open = true;
      if (nativePopover) popover.showPopover();
      popover.classList.add('is-open'); trigger.setAttribute('aria-expanded', 'true');
      position(); window.dashboardMotion?.enterPopover(popover, trigger, event);
      available()[0]?.focus({ preventScroll: true });
    });
    // Restore a visible opener before existing handlers show a prompt or receiving dialog.
    popover.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (button && !button.disabled) close(true);
    }, true);
    popover.addEventListener('toggle', event => { if (event.newState === 'closed' && open) close(); });
    popover.addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const buttons = available(); if (!buttons.length) return;
      event.preventDefault();
      const current = buttons.indexOf(document.activeElement);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[index].focus();
    });
    document.addEventListener('keydown', event => {
      if (open && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(true); }
    }, true);
    document.addEventListener('pointerdown', event => {
      if (open && !popover.contains(event.target) && !trigger.contains(event.target)) close();
    });
    document.addEventListener('focusin', event => {
      if (open && !popover.contains(event.target) && !trigger.contains(event.target)) close();
    });
    window.addEventListener('resize', position);
    document.addEventListener('scroll', position, true);
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-order-source', 'data-order-layout', 'data-active-view', 'data-active-tab', 'data-pipeline-view'] });
    observer.observe(section, { attributes: true, attributeFilter: ['data-blanks-view'] });
    const supplies = document.querySelector('.panel.create');
    if (supplies) observer.observe(supplies, { attributes: true, attributeFilter: ['data-supplies-view'] });
    document.addEventListener('printmo:board-updated', sync);
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, { once: true });
  else setup();
})();
