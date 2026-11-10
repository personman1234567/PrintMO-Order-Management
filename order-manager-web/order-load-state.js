/* Initial availability, enumeration and manual refresh are deliberately distinct. */
(() => {
  let hasSnapshot = false, fetching = false, complete = false, manual = false, flight = null, shellReady = false;
  let message = '', error = false, slowTimer = null, clearTimer = null, restoreRetryFocus = false;
  const candidate = () => document.body.dataset.orderSource === 'shopify';
  const byId = id => document.getElementById(id);
  const queueGates = new Map();
  let provider = document.body.dataset.orderSource;
  function gateQueue(blocked) {
    if (blocked) for (const element of document.querySelectorAll('.panel.create, #supplies-actions-popover')) {
      if (!queueGates.has(element)) queueGates.set(element, { inert: element.inert, busy: element.getAttribute('aria-busy') });
      element.inert = true; element.setAttribute('aria-busy', 'true');
    }
    else for (const [element, previous] of queueGates) {
      element.inert = previous.inert;
      if (previous.busy === null) element.removeAttribute('aria-busy'); else element.setAttribute('aria-busy', previous.busy);
      queueGates.delete(element);
    }
  }
  function announce(copy, failed = false) {
    message = copy; error = failed;
    const status = byId('order-refresh-status');
    if (status) { status.textContent = copy; status.setAttribute('role', failed ? 'alert' : 'status'); }
    const live = byId('order-load-announcement');
    if (live) { live.setAttribute('role', failed ? 'alert' : 'status'); live.textContent = hasSnapshot ? copy : ''; }
    document.body.dataset.orderRefreshError = String(failed);
    document.dispatchEvent(new CustomEvent('printmo:refresh-status'));
  }
  function sync() {
    if (!candidate()) {
      gateQueue(false);
      const control = byId('order-manager-refresh-btn');
      if (control?.dataset.refreshBusy !== undefined) { control.disabled = false; control.removeAttribute('aria-busy'); delete control.dataset.refreshBusy; }
      return;
    }
    const opening = !hasSnapshot || !shellReady;
    document.body.dataset.orderStartup = opening ? (error ? 'error' : 'loading') : 'ready';
    document.body.dataset.orderQueueState = complete ? 'complete' : error ? 'incomplete' : 'partial';
    const activity = manual ? (fetching ? 'refreshing' : 'queued') : fetching ? 'updating' : 'idle';
    document.body.dataset.orderRefreshState = activity;
    const panel = byId('order-startup');
    if (panel) {
      const retryFocused = !opening && (document.activeElement === byId('order-startup-retry') || restoreRetryFocus && document.activeElement === document.body);
      if (!opening) restoreRetryFocus = false;
      panel.hidden = !opening || document.body.dataset.activeView !== 'orders';
      if (retryFocused) { const orders = byId('orders-view'); orders.tabIndex = -1; orders.focus({ preventScroll: true }); }
      panel.setAttribute('role', error ? 'alert' : 'status');
      const robot = panel.querySelector('img');
      const robotSource = './Assets/prepared-order-robot' + (error ? '-still' : '') + '.svg';
      if (robot?.getAttribute('src') !== robotSource) robot?.setAttribute('src', robotSource);
      byId('order-startup-title').textContent = error ? 'Orders couldn’t load' : 'Loading your orders…';
      byId('order-startup-message').textContent = error ? message : '';
      byId('order-startup-retry').hidden = !error;
    }
    byId('orders-view')?.setAttribute('aria-busy', String(fetching));
    gateQueue(!complete);
    const control = byId('order-manager-refresh-btn');
    if (control) {
      control.disabled = opening || fetching || manual;
      control.setAttribute('aria-busy', String(fetching || manual));
      control.dataset.refreshBusy = String(fetching || manual);
      const label = control.querySelector('[data-refresh-label]');
      if (label) label.textContent = activity === 'queued' ? 'Queued' : fetching ? 'Refreshing…' : 'Refresh';
    }
  }
  function begin() {
    if (!candidate()) return;
    clearTimeout(clearTimer); clearTimeout(slowTimer);
    fetching = true; error = false;
    if (manual) announce('Refreshing orders…');
    else if (!hasSnapshot) announce('');
    sync();
    if (!hasSnapshot) slowTimer = setTimeout(() => {
      if (!hasSnapshot && fetching) byId('order-startup-message').textContent = 'This is taking longer than usual. Your orders are still loading.';
    }, 8000);
  }
  function snapshot({ loaded = 0, hasMore = false } = {}) {
    if (!candidate()) return;
    if (loaded > 0 || !hasMore) { hasSnapshot = true; clearTimeout(slowTimer); }
    if (hasMore) announce('Loading more orders…');
    sync();
  }
  function finish() {
    if (!candidate()) return;
    const requested = manual;
    hasSnapshot = true; fetching = false; complete = true; manual = false; error = false;
    clearTimeout(slowTimer);
    announce(requested ? 'Orders updated.' : ''); sync();
    if (requested) clearTimer = setTimeout(() => announce(''), 4000);
  }
  function fail(detail = {}) {
    if (!candidate()) return;
    fetching = false; manual = false; clearTimeout(slowTimer);
    const copy = hasSnapshot ? (complete ? 'Couldn’t refresh. Your last loaded orders are still shown.' : 'Some orders could not load. Refresh to try again.')
      : detail.message || 'Check your connection and try again.';
    announce(copy, true); sync();
  }
  async function refresh() {
    if (flight || manual || fetching) return flight;
    manual = true; error = false; announce('Refreshing orders…'); sync();
    flight = (async () => {
      try {
        const result = await window.refreshOrderManagerNow();
        if (result?.deferred) { fetching = false; announce('Refresh queued until the current action finishes.'); sync(); }
        // Only the renderer that applies the latest generation can complete this refresh.
        return result;
      } catch (failure) { if (manual || fetching) fail(); throw failure; }
      finally { flight = null; }
    })();
    return flight;
  }
  window.OrderManagerLoadUi = Object.freeze({ begin, snapshot, complete: finish, fail, refresh,
    get message() { return message; }, get busy() { return fetching || manual; }, get manualRequested() { return manual; } });
  byId('order-startup-retry')?.addEventListener('click', () => {
    restoreRetryFocus = document.activeElement === byId('order-startup-retry');
    void refresh().catch(() => {});
  });
  new MutationObserver(() => {
    const next = document.body.dataset.orderSource;
    if (next !== provider) {
      provider = next; hasSnapshot = false; complete = false; fetching = false; manual = false; error = false;
      clearTimeout(slowTimer); clearTimeout(clearTimer); announce('');
    }
    sync();
  }).observe(document.body, { attributes: true, attributeFilter: ['data-order-source', 'data-active-view'] });
  document.addEventListener('DOMContentLoaded', () => {
    requestAnimationFrame(() => { shellReady = true; document.body.dataset.orderShellReady = 'true'; sync(); });
  }, { once: true });
})();