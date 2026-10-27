/* One workspace owner. Destinations register lifecycle hooks; views never move
 * another workspace's controls or create a second order cache. */
(() => {
  const destinations = new Map();
  const views = { orders: 'orders-view', drafts: 'drafts-view', prepared: 'prepared-orders-view', inventory: 'inventory-view',
    previous: 'previous-orders-view', storage: 'storage-view' };
  let ready = false, lastOrdersTab = 'pipeline';
  let mobileGuard = null;
  const mobileTabs = { orders: 'pipeline', supplies: 'blanksCart', print: 'readyToPrint', more: 'pipeline' };
  const mobileSubviews = { orders: 'all', supplies: 'to_order', print: 'print', more: 'all' };
  const mobile = () => window.matchMedia('(max-width: 900px)').matches;
  const mobileWorkspace = () => mobile() && document.body.dataset.mobileWorkspace === 'true';
  function navigate(view, { mobileTab, scrollTop = false, force = false, mobileGuarded = false } = {}) {
    const next = Object.hasOwn(views, view) ? view : 'orders';
    if (!force && !mobileGuarded && mobileWorkspace() && mobileGuard?.(() => navigate(view, { mobileTab, scrollTop, mobileGuarded: true })) === false) return false;
    if (['drafts', 'prepared'].includes(next) && document.body.dataset.orderSource !== 'shopify') return false;
    const previous = document.body.dataset.activeView || 'orders';
    if (!force && previous !== next && destinations.get(previous)?.canLeave?.() === false) return false;
    if (previous === 'orders' && next !== 'orders') lastOrdersTab = document.body.dataset.activeTab || 'pipeline';
    if ((previous !== next || mobileTab) && document.body.classList.contains('detail-open')) document.getElementById('detail-close')?.click();
    if (previous !== next) {
      destinations.get(previous)?.onLeave?.();
    }
    document.body.dataset.activeView = next;
    if (mobileWorkspace() && !mobileGuarded) {
      document.body.dataset.mobileArea = next !== 'orders' ? 'more'
        : mobileTab?.startsWith('blanks') ? 'supplies' : mobileTab === 'readyToPrint' ? 'print' : 'orders';
      document.body.dataset.mobileSubview = mobileSubviews[document.body.dataset.mobileArea];
    }
    // Compatibility for production-only modules; this is derived, never a second navigation owner.
    document.body.dataset.pipelineView = next === 'drafts' ? 'drafts' : 'orders';
    for (const [name, id] of Object.entries(views)) {
      document.getElementById(id)?.setAttribute('aria-hidden', String(name !== next));
    }
    document.querySelectorAll('.app-nav-tab[data-view]').forEach(button => {
      const selected = button.dataset.view === next;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
      if (selected) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (mobile() && typeof window.setActiveMobileTab === 'function' && next !== 'inventory') {
      const tab = next === 'storage' ? 'storage' : next === 'previous' ? 'history'
        : next === 'drafts' ? 'pipeline' : mobileTab || lastOrdersTab;
      window.setActiveMobileTab(tab, { scrollTop, workspaceReady: true });
    }
    if (previous !== next || !ready) destinations.get(next)?.onEnter?.();
    document.dispatchEvent(new CustomEvent('printmo:workspace-changed', { detail: { previous, current: next } }));
    if (previous !== next && !force) window.requestAnimationFrame(() => {
      if (document.body.dataset.activeView !== next) return;
      const heading = document.getElementById(views[next])?.querySelector('h2, h1');
      if (heading?.getClientRects().length) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    });
    return true;
  }
  window.OrderManagerNavigation = Object.freeze({
    navigate,
    navigateMobile(area, { subview, destination = 'orders', guarded = false } = {}) {
      if (!Object.hasOwn(mobileTabs, area) || !mobileWorkspace()) return false;
      const proceed = () => this.navigateMobile(area, { subview, destination, guarded: true });
      if (!guarded && mobileGuard?.(proceed) === false) return false;
      const previous = { area: document.body.dataset.mobileArea || 'orders', subview: document.body.dataset.mobileSubview };
      document.body.dataset.mobileArea = area;
      if (subview) mobileSubviews[area] = subview;
      document.body.dataset.mobileSubview = mobileSubviews[area];
      const mobileTab = area === 'supplies' && mobileSubviews[area] !== 'to_order' ? 'blanksOrdered' : mobileTabs[area];
      if (!navigate(destination, { mobileTab, mobileGuarded: true })) {
        document.body.dataset.mobileArea = previous.area;
        if (previous.subview) document.body.dataset.mobileSubview = previous.subview;
        return false;
      }
      document.dispatchEvent(new CustomEvent('printmo:mobile-area-changed', { detail: { area, subview } }));
      return true;
    },
    setMobileGuard(guard) { mobileGuard = guard; },
    register(name, hooks) {
      if (!Object.hasOwn(views, name)) throw new Error('Unknown order-manager workspace');
      destinations.set(name, hooks);
      if (ready && document.body.dataset.activeView === name) hooks.onEnter?.();
    }
  });
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.app-nav-tab[data-view]').forEach(button => {
      button.addEventListener('click', () => navigate(button.dataset.view));
    });
    document.querySelectorAll('.mobile-tab').forEach(button => {
      button.addEventListener('click', event => {
        if (!mobile()) return;
        event.stopImmediatePropagation();
        const tab = button.dataset.tab || 'pipeline';
        const next = tab === 'storage' ? 'storage' : tab === 'history' ? 'previous' : 'orders';
        const detailWasOpen = document.body.classList.contains('detail-open');
        if (navigate(next, { mobileTab: tab, scrollTop: true }) && detailWasOpen) button.focus({ preventScroll: true });
      }, true);
    });
    navigate(document.body.dataset.activeView || 'orders');
    ready = true;
    new MutationObserver(() => {
      const shopify = document.body.dataset.orderSource === 'shopify';
      document.querySelector('[data-view="drafts"]')?.toggleAttribute('hidden', !shopify);
      if (!shopify && document.body.dataset.activeView === 'drafts') navigate('orders', { force: true });
    }).observe(document.body, { attributes: true, attributeFilter: ['data-order-source'] });
  });
})();
