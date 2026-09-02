// previous-orders.js
(() => {
  const PAGE_SIZE = 25;
  const state = {
    records: [],
    cursor: '',
    total: 0,
    query: '',
    loaded: false,
    loading: false,
    error: '',
    requestId: 0,
  };
  const elements = {};

  const stageLabels = {
    received: 'Received',
    to_order: 'To order',
    blanks_cart: 'Blanks cart',
    blanks_ordered: 'Blanks ordered',
    print: 'To print',
    completed: 'Printed',
  };

  function customerName(order = {}) {
    return String(order.customer?.displayName || '').trim() || 'Name unavailable';
  }

  function money(order = {}) {
    const amount = Number(order.commerce?.total || 0);
    const currency = order.commerce?.currencyCode || 'USD';
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
    } catch (_) {
      return `$${amount.toFixed(2)}`;
    }
  }

  function updatedLabel(order = {}) {
    const value = order.shopifyUpdatedAt || order.sync?.fetchedAt || order.createdAt;
    if (!value) return 'Update time unavailable';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Update time unavailable' : date.toLocaleString();
  }

  function createText(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = text;
    return element;
  }

  function renderRecord(order) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'previous-order-row';
    button.setAttribute('role', 'listitem');
    button.dataset.orderId = order.id || '';
    button.setAttribute('aria-label', `Open ${order.displayName || 'fulfilled order'} for ${customerName(order)} in view-only mode`);

    const identity = document.createElement('span');
    identity.className = 'previous-order-identity';
    identity.append(
      createText('strong', 'previous-order-number', order.displayName || 'Shopify order'),
      createText('span', 'previous-order-customer', customerName(order))
    );

    const total = createText('span', 'previous-order-total', money(order));
    const fulfillment = createText('span', 'previous-order-fulfillment', 'Fulfilled');
    const stage = createText(
      'span',
      'previous-order-stage',
      stageLabels[order.production?.stage] || 'Received'
    );
    const updated = createText('time', 'previous-order-updated', updatedLabel(order));
    updated.dateTime = order.shopifyUpdatedAt || order.sync?.fetchedAt || order.createdAt || '';
    const affordance = createText('span', 'previous-order-open', 'View order');

    button.append(identity, total, fulfillment, stage, updated, affordance);
    button.addEventListener('click', () => openPreviousOrder(order, button));
    return button;
  }

  function render() {
    elements.list.replaceChildren(...state.records.map(renderRecord));
    const shown = state.records.length;
    if (!state.loading) {
      elements.status.textContent = shown
        ? `Showing ${shown} of ${state.total} fulfilled ${state.total === 1 ? 'order' : 'orders'}.`
        : state.error || (state.query ? `No fulfilled orders match “${state.query}”.` : 'No fulfilled Shopify orders yet.');
    }
    elements.loadMore.hidden = !state.cursor;
    elements.loadMore.disabled = state.loading;
    elements.clear.hidden = !state.query;
  }

  async function load({ reset = false, refresh = false } = {}) {
    if (state.loading && !reset) return;
    const requestId = ++state.requestId;
    state.loading = true;
    state.error = '';
    if (reset) {
      state.records = [];
      state.cursor = '';
      state.total = 0;
    }
    elements.status.textContent = reset ? 'Loading fulfilled orders…' : 'Loading more fulfilled orders…';
    elements.loadMore.disabled = true;
    try {
      const page = await window.api.getPreviousOrders({
        limit: PAGE_SIZE,
        cursor: state.cursor,
        q: state.query,
        refresh,
      });
      if (requestId !== state.requestId) return;
      const records = Array.isArray(page?.data) ? page.data : [];
      state.records.push(...records);
      state.cursor = page?.pageInfo?.nextCursor || '';
      state.total = Number(page?.pageInfo?.total || state.records.length);
      state.loaded = true;
    } catch (error) {
      if (requestId !== state.requestId) return;
      state.error = `Previous orders could not load. ${error?.message || 'Try Refresh.'}`;
      state.cursor = '';
    } finally {
      if (requestId === state.requestId) {
        state.loading = false;
        render();
      }
    }
  }

  async function openPreviousOrder(order, button) {
    if (!order?.id || button.disabled) return;
    button.disabled = true;
    const priorStatus = elements.status.textContent;
    elements.status.textContent = `Loading ${order.displayName || 'order'} details and artwork…`;
    try {
      const detail = await window.api.getOrderDetail(order.id);
      const mapped = window.mapCandidateOrderForDetail(detail);
      mapped._historyReadOnly = true;
      mapped._capabilities = {
        ...(mapped._capabilities || {}),
        commerceWrite: false,
        productionWrite: false,
        artworkUpload: false,
      };
      window.openOrderManagerDetail(mapped);
      elements.status.textContent = priorStatus;
    } catch (error) {
      elements.status.textContent = `${order.displayName || 'Order'} could not open. ${error?.message || 'Try again.'}`;
    } finally {
      button.disabled = false;
    }
  }

  function init() {
    elements.view = document.getElementById('previous-orders-view');
    elements.form = document.getElementById('previous-orders-search');
    elements.input = document.getElementById('previous-orders-search-input');
    elements.clear = document.getElementById('previous-orders-search-clear');
    elements.status = document.getElementById('previous-orders-status');
    elements.list = document.getElementById('previous-orders-list');
    elements.loadMore = document.getElementById('previous-orders-load-more');
    if (!elements.view || !window.api?.getPreviousOrders) return;

    elements.form.addEventListener('submit', event => {
      event.preventDefault();
      state.query = elements.input.value.trim();
      load({ reset: true });
    });
    elements.clear.addEventListener('click', () => {
      elements.input.value = '';
      state.query = '';
      load({ reset: true });
      elements.input.focus();
    });
    elements.loadMore.addEventListener('click', () => load());
  }

  window.loadPreviousOrders = () => {
    if (!state.loaded && !state.loading) return load({ reset: true });
    render();
    return Promise.resolve();
  };
  window.refreshPreviousOrders = () => load({ reset: true, refresh: true });

  // Keep mobile History navigation independent of the operational-board tab
  // lifecycle. It must be reachable even when the active board itself failed
  // to authenticate or render.
  document.addEventListener('click', event => {
    const button = event.target?.closest?.('.mobile-tab[data-tab="history"]');
    if (!button || !window.matchMedia('(max-width: 900px)').matches) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (document.body.classList.contains('detail-open')) document.getElementById('detail-close')?.click();
    document.body.dataset.activeTab = 'history';
    document.body.dataset.activeView = 'previous';
    document.querySelectorAll('.mobile-tab').forEach(tab => {
      const active = tab === button;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    document.querySelectorAll('.app-nav-tab').forEach(tab => {
      const active = tab.dataset.view === 'previous';
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    document.getElementById('orders-view')?.setAttribute('aria-hidden', 'true');
    document.getElementById('storage-view')?.setAttribute('aria-hidden', 'true');
    document.getElementById('previous-orders-view')?.setAttribute('aria-hidden', 'false');
    window.loadPreviousOrders();
  }, true);

  document.addEventListener('DOMContentLoaded', init);
})();
