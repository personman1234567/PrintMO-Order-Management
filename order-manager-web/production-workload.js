/* Read-only garment-type disclosure for the cached To Print workload. */
(() => {
  function setup() {
    const trigger = document.getElementById('production-workload-toggle');
    if (!trigger) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const panel = document.createElement('div');
    panel.id = 'production-workload-popover'; panel.className = 'production-workload-popover';
    panel.setAttribute('popover', 'manual'); panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', 'production-workload-title');
    panel.setAttribute('aria-describedby', 'production-workload-scope');
    panel.innerHTML = '<div class="production-workload-heading"><h3 id="production-workload-title" tabindex="-1">Garments in To Print</h3><button type="button" aria-label="Close garment breakdown"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button></div><p id="production-workload-scope">Full order quantities across all sizes and colors. Counts change when orders leave To Print.</p><p class="production-workload-message" role="status"></p><dl></dl><div class="production-workload-total"><span>Total garments</span><span></span></div>';
    document.body.append(panel);
    const nativePopover = typeof panel.showPopover === 'function';
    const heading = panel.querySelector('h3'), list = panel.querySelector('dl');
    const message = panel.querySelector('.production-workload-message');
    const total = panel.querySelector('.production-workload-total');
    const plan = document.createElement('button'); plan.type = 'button';
    plan.className = 'production-workload-plan'; plan.textContent = 'Plan production';
    plan.addEventListener('click', () => { close(false, false); window.productionPlanner?.open(); });
    panel.append(plan);
    let open = false, closing = false, animation = null, lastRows = '';
    const format = value => value.toLocaleString('en-US');
    const active = () => document.body.dataset.orderSource === 'shopify' && trigger.getClientRects().length > 0;

    function position() {
      if (!open) return;
      if (!active()) return close(false, false);
      const bounds = trigger.getBoundingClientRect(), margin = 12, gap = 6;
      const below = window.innerHeight - bounds.bottom - margin - gap;
      const above = bounds.top - margin - gap;
      panel.style.maxHeight = `${Math.max(0, window.innerHeight - margin * 2)}px`;
      const upward = panel.offsetHeight > below && above > below;
      panel.style.maxHeight = `${Math.max(0, upward ? above : below)}px`;
      const left = Math.max(margin, Math.min(bounds.right - panel.offsetWidth,
        document.documentElement.clientWidth - panel.offsetWidth - margin));
      panel.style.left = `${left}px`;
      panel.style.top = `${upward ? bounds.top - gap - panel.offsetHeight : bounds.bottom + gap}px`;
      const origin = Math.max(0, Math.min(panel.offsetWidth, bounds.left + bounds.width / 2 - left));
      panel.style.transformOrigin = `${origin}px ${upward ? '100%' : '0'}`;
      panel.dataset.direction = upward ? 'up' : 'down';
    }

    function render() {
      const data = window.getOrderManagerProductionWorkload?.();
      const available = data?.available === true;
      const rows = available ? data.types : [];
      const signature = JSON.stringify(rows.map(type => [type, window.productionPlanner?.typeOrderCount(type.id)]));
      if (signature !== lastRows) {
        const fragment = document.createDocumentFragment();
        for (const type of rows) {
          const row = document.createElement('div'); row.className = 'production-workload-row';
          const label = document.createElement('dt');
          const action = document.createElement('button'); action.type = 'button'; action.append(document.createTextNode(type.label));
          const orderCount = window.productionPlanner?.typeOrderCount(type.id);
          if (Number.isInteger(orderCount)) {
            const hint = document.createElement('small'); hint.textContent = `${format(orderCount)} ${orderCount === 1 ? 'order' : 'orders'}`; action.append(hint);
          }
          action.setAttribute('aria-label', `View orders containing ${type.label.toLowerCase()}`);
          action.addEventListener('click', () => { close(false, false); window.productionPlanner?.filterType(type.id); });
          label.append(action);
          const value = document.createElement('dd'); value.textContent = format(type.quantity);
          row.append(label, value); fragment.append(row);
        }
        list.replaceChildren(fragment); lastRows = signature;
      }
      message.hidden = available && data.total > 0;
      const copy = !available ? data?.loading !== false ? 'Loading garment quantities…'
        : 'Garment quantities are unavailable. Refresh orders to retry.'
        : 'No garments in To Print.';
      if (message.textContent !== copy) message.textContent = copy;
      total.hidden = !available;
      const text = available ? format(data.total) : '';
      if (total.lastElementChild.textContent !== text) total.lastElementChild.textContent = text;
      position();
    }

    function finishClose() {
      open = false; closing = false;
      animation?.cancel(); animation = null;
      if (nativePopover && panel.matches(':popover-open')) panel.hidePopover();
      panel.classList.remove('is-open', 'is-closing');
      trigger.setAttribute('aria-expanded', 'false');
    }

    function close(restoreFocus = false, animate = true) {
      if (!open && !closing) return;
      const focusedInside = panel.contains(document.activeElement);
      const current = getComputedStyle(panel);
      const start = { opacity: current.opacity, transform: current.transform };
      animation?.cancel(); animation = null;
      open = false; closing = true;
      trigger.setAttribute('aria-expanded', 'false');
      panel.classList.add('is-closing');
      if ((restoreFocus || focusedInside) && active()) trigger.focus({ preventScroll: true });
      if (!animate || reduced.matches || typeof panel.animate !== 'function') return finishClose();
      const shift = panel.dataset.direction === 'up' ? 3 : -3;
      const currentAnimation = panel.animate([start, { opacity: 0, transform: `translateY(${shift}px) scale(.98)` }],
        { duration: 110, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' });
      animation = currentAnimation;
      currentAnimation.onfinish = () => { if (animation === currentAnimation) finishClose(); };
    }

    trigger.addEventListener('click', event => {
      if (open) return close(true);
      if (!active()) return;
      const current = closing ? getComputedStyle(panel) : null;
      const start = current ? { opacity: current.opacity, transform: current.transform } : null;
      animation?.cancel(); animation = null;
      open = true; closing = false;
      panel.classList.remove('is-closing'); panel.classList.add('is-open');
      if (nativePopover && !panel.matches(':popover-open')) panel.showPopover();
      trigger.setAttribute('aria-expanded', 'true');
      render();
      if (!reduced.matches && typeof panel.animate === 'function') {
        const shift = panel.dataset.direction === 'up' ? 4 : -4;
        const currentAnimation = panel.animate([start || { opacity: 0, transform: `translateY(${shift}px) scale(.98)` },
          { opacity: 1, transform: 'translateY(0) scale(1)' }],
          { duration: 180, easing: 'cubic-bezier(.16, 1, .3, 1)' });
        animation = currentAnimation;
        currentAnimation.onfinish = () => { if (animation === currentAnimation) { animation = null; currentAnimation.cancel(); } };
      }
      if (!event.detail) heading.focus({ preventScroll: true });
    });
    panel.querySelector('button').addEventListener('click', () => close(true));
    panel.addEventListener('toggle', event => { if (event.newState === 'closed' && (open || closing)) finishClose(); });
    document.addEventListener('pointerdown', event => {
      if (open && !panel.contains(event.target) && !trigger.contains(event.target)) close();
    });
    document.addEventListener('focusin', event => {
      if (open && !panel.contains(event.target) && !trigger.contains(event.target)) close();
    });
    document.addEventListener('keydown', event => {
      if (open && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(true); }
    }, true);
    document.addEventListener('printmo:production-workload-updated', () => { if (open) render(); });
    document.addEventListener('printmo:board-updated', () => { if (open) render(); });
    document.addEventListener('scroll', event => { if (!panel.contains(event.target)) position(); }, true);
    window.addEventListener('resize', position);
    const contextKey = () => ['orderSource', 'orderLayout', 'activeView', 'activeTab']
      .map(key => document.body.dataset[key] || '').join('|');
    let context = contextKey();
    new MutationObserver(() => {
      const next = contextKey();
      if (next !== context) { context = next; close(false, false); }
    }).observe(document.body, { attributes: true,
      attributeFilter: ['data-order-source', 'data-order-layout', 'data-active-view', 'data-active-tab'] });
    reduced.addEventListener('change', () => {
      if (closing) finishClose();
      else { animation?.cancel(); animation = null; }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, { once: true });
  else setup();
})();
