(function initShopifyPreview() {
  const state = {
    active: false,
    loading: false,
    loaded: false,
    detailLoading: false,
    detailOrderId: null,
  };

  const els = {};

  function formatDate(value) {
    const date = new Date(value || '');
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  }

  function formatMoney(amount, currencyCode) {
    const value = Number(amount);
    if (!Number.isFinite(value)) return '—';
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currencyCode || 'USD',
      }).format(value);
    } catch (_) {
      return `${currencyCode || 'USD'} ${value.toFixed(2)}`;
    }
  }

  function moneyLabel(money) {
    return money ? formatMoney(money.amount, money.currencyCode) : '—';
  }

  function humanize(value) {
    if (value === undefined || value === null || value === '') return '—';
    return String(value).replaceAll('_', ' ').toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
  }

  function statusTone(status) {
    const value = String(status || '').toUpperCase();
    if (['PAID', 'FULFILLED', 'SUCCESS', 'DELIVERED'].includes(value)) return 'is-positive';
    if (['REFUNDED', 'VOIDED', 'CANCELLED', 'RESTOCKED', 'FAILURE', 'ERROR'].includes(value)) return 'is-negative';
    if (value && !['UNFULFILLED', 'OPEN'].includes(value)) return 'is-warning';
    return '';
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function statusPill(value) {
    const pill = element('span', `shopify-preview-pill ${statusTone(value)}`.trim(), humanize(value || 'Unknown'));
    return pill;
  }

  function appendTextCell(row, value, className = '') {
    const cell = element('td', className, value ?? '—');
    row.appendChild(cell);
    return cell;
  }

  function appendStatusCell(row, value) {
    const cell = element('td');
    cell.appendChild(statusPill(value));
    row.appendChild(cell);
  }

  function appendOrderCell(row, order) {
    const cell = element('td', 'shopify-preview-order');
    const button = element('button', 'shopify-preview-order-button', order.displayName || 'View order');
    button.type = 'button';
    button.addEventListener('click', () => openOrderDetail(order));
    cell.appendChild(button);
    row.appendChild(cell);
  }

  function renderOrders(orders) {
    els.rows.replaceChildren();
    const fragment = document.createDocumentFragment();

    for (const order of orders) {
      const row = document.createElement('tr');
      row.dataset.shopifyOrderId = order.id || '';
      appendOrderCell(row, order);
      appendTextCell(row, order.customer?.displayName || 'Not returned', 'shopify-preview-customer');
      appendTextCell(row, formatDate(order.createdAt));
      appendTextCell(row, String(order.commerce?.currentLineItemQuantity ?? 0), 'shopify-preview-count');
      appendTextCell(row, formatMoney(order.commerce?.total, order.commerce?.currencyCode), 'shopify-preview-money');
      appendStatusCell(row, order.commerce?.cancelledAt ? 'CANCELLED' : order.commerce?.financialStatus);
      appendStatusCell(row, order.commerce?.fulfillmentStatus);
      appendTextCell(row, formatDate(order.shopifyUpdatedAt));
      fragment.appendChild(row);
    }

    els.rows.appendChild(fragment);
    els.empty.hidden = orders.length !== 0;
    els.table.hidden = orders.length === 0;
  }

  function detailSection(title, description) {
    const section = element('section', 'shopify-detail-section');
    const header = element('header', 'shopify-detail-section-header');
    header.appendChild(element('h3', '', title));
    if (description) header.appendChild(element('p', '', description));
    section.appendChild(header);
    return section;
  }

  function keyValueGrid(entries) {
    const grid = element('dl', 'shopify-detail-grid');
    for (const [label, value, node] of entries) {
      const item = element('div', 'shopify-detail-field');
      item.appendChild(element('dt', '', label));
      const description = element('dd');
      if (node) description.appendChild(node);
      else description.textContent = value === undefined || value === null || value === '' ? '—' : String(value);
      item.appendChild(description);
      grid.appendChild(item);
    }
    return grid;
  }

  function safeLink(value, label) {
    if (!value) return null;
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      const link = element('a', 'shopify-detail-link', label || url.hostname);
      link.href = url.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      return link;
    } catch (_) {
      return null;
    }
  }

  function formatAddress(address) {
    if (!address) return [];
    return [
      address.name,
      address.company,
      address.address1,
      address.address2,
      [address.city, address.provinceCode || address.province, address.zip].filter(Boolean).join(', '),
      address.country,
      address.phone,
    ].filter(Boolean);
  }

  function renderAddress(title, address) {
    const card = element('div', 'shopify-detail-address');
    card.appendChild(element('h4', '', title));
    const lines = formatAddress(address);
    if (!lines.length) card.appendChild(element('p', 'shopify-detail-muted', 'Not returned by Shopify'));
    else lines.forEach((line) => card.appendChild(element('p', '', line)));
    return card;
  }

  function renderSummary(order) {
    const section = detailSection('Order summary');
    const payment = statusPill(order.cancelledAt ? 'CANCELLED' : order.commerce?.financialStatus);
    const fulfillment = statusPill(order.commerce?.fulfillmentStatus);
    section.appendChild(keyValueGrid([
      ['Payment', null, payment],
      ['Fulfillment', null, fulfillment],
      ['Received', formatDate(order.createdAt)],
      ['Processed', formatDate(order.processedAt)],
      ['Last updated', formatDate(order.shopifyUpdatedAt)],
      ['Channel', humanize(order.sourceName)],
      ['Items', order.commerce?.lineItemQuantity ?? 0],
      ['Test order', order.test ? 'Yes' : 'No'],
    ]));

    if (order.note) {
      const note = element('div', 'shopify-detail-note');
      note.appendChild(element('strong', '', 'Order note'));
      note.appendChild(element('p', '', order.note));
      section.appendChild(note);
    }
    if (order.tags?.length) section.appendChild(element('p', 'shopify-detail-tags', `Tags: ${order.tags.join(', ')}`));
    return section;
  }

  function renderFinancials(order) {
    const commerce = order.commerce || {};
    const section = detailSection('Payment & totals', 'Current Shopify amounts after edits, returns, and refunds.');
    section.appendChild(keyValueGrid([
      ['Subtotal', moneyLabel(commerce.subtotal)],
      ['Shipping', moneyLabel(commerce.shipping)],
      ['Discounts', moneyLabel(commerce.discounts)],
      ['Tax', moneyLabel(commerce.tax)],
      ['Order total', moneyLabel(commerce.total)],
      ['Received', moneyLabel(commerce.received)],
      ['Refunded', moneyLabel(commerce.refunded)],
      ['Outstanding', moneyLabel(commerce.outstanding)],
    ]));

    const transactions = commerce.transactions || [];
    if (transactions.length) {
      const list = element('div', 'shopify-detail-list');
      transactions.forEach((transaction) => {
        const item = element('div', 'shopify-detail-list-item');
        const main = element('div');
        main.appendChild(element('strong', '', `${humanize(transaction.kind)} · ${transaction.gateway || 'Payment'}`));
        main.appendChild(element('span', 'shopify-detail-muted', formatDate(transaction.processedAt || transaction.createdAt)));
        const trailing = element('div', 'shopify-detail-list-trailing');
        trailing.appendChild(element('strong', '', moneyLabel(transaction.amount)));
        trailing.appendChild(statusPill(transaction.status));
        item.append(main, trailing);
        list.appendChild(item);
      });
      section.appendChild(list);
    } else {
      section.appendChild(element('p', 'shopify-detail-muted', 'No payment transactions were returned.'));
    }
    return section;
  }

  function renderCustomer(order) {
    const section = detailSection('Customer');
    const customer = order.customer || {};
    if (order.protectedCustomerData?.possiblyRestricted) {
      section.appendChild(element(
        'div',
        'shopify-detail-notice',
        'Shopify did not return some identity or contact fields. This can mean guest checkout or that protected customer data access is not approved for this app.'
      ));
    }
    section.appendChild(keyValueGrid([
      ['Name', customer.displayName || 'Not returned'],
      ['Email', customer.email || 'Not returned'],
      ['Phone', customer.phone || 'Not returned'],
      ['Locale', customer.locale || 'Not returned'],
    ]));
    return section;
  }

  function renderDelivery(order) {
    const delivery = order.delivery || {};
    const section = detailSection('Delivery, shipping & pickup');
    const methods = delivery.fulfillmentOrders || [];
    if (methods.length) {
      const list = element('div', 'shopify-detail-list');
      methods.forEach((fulfillmentOrder) => {
        const method = fulfillmentOrder.method;
        const item = element('div', 'shopify-detail-list-item');
        const main = element('div');
        main.appendChild(element('strong', '', method?.presentedName || humanize(method?.type || 'Delivery method not returned')));
        const detail = [method?.type && humanize(method.type), method?.serviceCode].filter(Boolean).join(' · ');
        if (detail) main.appendChild(element('span', 'shopify-detail-muted', detail));
        const trailing = element('div', 'shopify-detail-list-trailing');
        trailing.appendChild(statusPill(fulfillmentOrder.status));
        if (method?.minDeliveryAt || method?.maxDeliveryAt) {
          trailing.appendChild(element('span', 'shopify-detail-muted', `${formatDate(method.minDeliveryAt)} – ${formatDate(method.maxDeliveryAt)}`));
        }
        item.append(main, trailing);
        list.appendChild(item);
      });
      section.appendChild(list);
    }

    if (delivery.shippingLines?.length) {
      const shipping = delivery.shippingLines.map((line) => {
        const price = moneyLabel(line.currentPrice);
        return `${line.title}${line.code ? ` (${line.code})` : ''} · ${price}`;
      });
      section.appendChild(element('p', 'shopify-detail-shipping-lines', `Shipping selection: ${shipping.join('; ')}`));
    }

    const addresses = element('div', 'shopify-detail-addresses');
    addresses.append(renderAddress('Ship to / delivery destination', delivery.shippingAddress));
    addresses.append(renderAddress('Billing address', delivery.billingAddress));
    section.appendChild(addresses);

    if (delivery.fulfillments?.length) {
      const list = element('div', 'shopify-detail-list');
      delivery.fulfillments.forEach((fulfillment) => {
        const item = element('div', 'shopify-detail-list-item');
        const main = element('div');
        main.appendChild(element('strong', '', fulfillment.name || 'Fulfillment'));
        const tracking = fulfillment.tracking || [];
        if (tracking.length) {
          tracking.forEach((entry) => {
            const link = safeLink(entry.url, [entry.company, entry.number].filter(Boolean).join(' · ') || 'Track package');
            if (link) main.appendChild(link);
            else main.appendChild(element('span', 'shopify-detail-muted', [entry.company, entry.number].filter(Boolean).join(' · ')));
          });
        } else main.appendChild(element('span', 'shopify-detail-muted', `${fulfillment.totalQuantity} item(s) · No tracking returned`));
        const trailing = element('div', 'shopify-detail-list-trailing');
        trailing.appendChild(statusPill(fulfillment.displayStatus || fulfillment.status));
        if (fulfillment.deliveredAt) trailing.appendChild(element('span', 'shopify-detail-muted', `Delivered ${formatDate(fulfillment.deliveredAt)}`));
        item.append(main, trailing);
        list.appendChild(item);
      });
      section.appendChild(list);
    }
    return section;
  }

  function visitGrid(title, visit) {
    const card = element('div', 'shopify-detail-address');
    card.appendChild(element('h4', '', title));
    if (!visit) {
      card.appendChild(element('p', 'shopify-detail-muted', 'Not returned'));
      return card;
    }
    card.appendChild(keyValueGrid([
      ['When', formatDate(visit.occurredAt)],
      ['Source', visit.sourceDescription || visit.source || 'Unknown'],
      ['Tactic', humanize(visit.sourceType)],
      ['Referral code', visit.referralCode || '—'],
      ['Landing page', visit.landingPage || '—', safeLink(visit.landingPage, 'Open landing page')],
      ['Referrer', visit.referrerUrl || '—', safeLink(visit.referrerUrl, 'Open referrer')],
    ]));
    return card;
  }

  function renderConversion(order) {
    const conversion = order.conversion;
    const section = detailSection('Conversion summary', 'Shopify’s attributed visits leading up to this order.');
    if (!conversion) {
      section.appendChild(element('p', 'shopify-detail-muted', 'No conversion summary was returned for this order.'));
      return section;
    }
    section.appendChild(keyValueGrid([
      ['Attribution ready', conversion.ready ? 'Yes' : 'Still processing'],
      ['Customer order number', conversion.customerOrderIndex ? `#${conversion.customerOrderIndex}` : 'Not returned'],
      ['Days to conversion', conversion.daysToConversion ?? 'Not returned'],
    ]));
    const visits = element('div', 'shopify-detail-addresses');
    visits.append(visitGrid('First attributed visit', conversion.firstVisit));
    visits.append(visitGrid('Last attributed visit', conversion.lastVisit));
    section.appendChild(visits);
    return section;
  }

  function renderDiscounts(order) {
    const section = detailSection('Discounts');
    const discounts = order.discounts || [];
    if (!discounts.length) {
      section.appendChild(element('p', 'shopify-detail-muted', 'No order-level discount applications were returned.'));
      return section;
    }
    const list = element('div', 'shopify-detail-list');
    discounts.forEach((discount) => {
      const item = element('div', 'shopify-detail-list-item');
      const value = discount.value?.type === 'money'
        ? moneyLabel(discount.value)
        : discount.value?.type === 'percentage'
          ? `${Math.abs(discount.value.percentage)}%`
          : '—';
      const main = element('div');
      main.appendChild(element('strong', '', discount.label));
      main.appendChild(element('span', 'shopify-detail-muted', `${humanize(discount.type)} · ${humanize(discount.targetType)}`));
      item.append(main, element('strong', '', value));
      list.appendChild(item);
    });
    section.appendChild(list);
    return section;
  }

  function renderLineItems(order) {
    const items = order.lineItems || [];
    const section = detailSection('Line items', `${items.length} Shopify line${items.length === 1 ? '' : 's'} loaded${order.lineItemsComplete ? '' : ' (partial)'}.`);
    if (!items.length) {
      section.appendChild(element('p', 'shopify-detail-muted', 'No line items were returned.'));
      return section;
    }
    const wrap = element('div', 'shopify-detail-table-wrap');
    const table = element('table', 'shopify-detail-table');
    const head = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['Item', 'SKU', 'Qty', 'Unit', 'Discount', 'Current total'].forEach((label) => headerRow.appendChild(element('th', '', label)));
    head.appendChild(headerRow);
    const body = document.createElement('tbody');
    items.forEach((item) => {
      const row = document.createElement('tr');
      const itemCell = element('td');
      itemCell.appendChild(element('strong', '', item.title || 'Untitled item'));
      if (item.variantTitle) itemCell.appendChild(element('span', 'shopify-detail-muted', item.variantTitle));
      if (item.customAttributes?.length) {
        itemCell.appendChild(element('span', 'shopify-detail-attributes', item.customAttributes.map((attribute) => `${attribute.key}: ${attribute.value}`).join(' · ')));
      }
      row.appendChild(itemCell);
      row.appendChild(element('td', '', item.sku || '—'));
      row.appendChild(element('td', 'shopify-detail-number', `${item.currentQuantity}/${item.quantity}`));
      row.appendChild(element('td', 'shopify-detail-number', moneyLabel(item.unitPrice)));
      row.appendChild(element('td', 'shopify-detail-number', moneyLabel(item.totalDiscount)));
      row.appendChild(element('td', 'shopify-detail-number', moneyLabel(item.currentTotal)));
      body.appendChild(row);
    });
    table.append(head, body);
    wrap.appendChild(table);
    section.appendChild(wrap);
    return section;
  }

  function cleanTimelineMessage(value) {
    return String(value || '').replace(/<[^>]+>/g, '').replaceAll('&nbsp;', ' ').replaceAll('&amp;', '&').trim();
  }

  function renderTimeline(order) {
    const section = detailSection('Recent Shopify timeline', 'The 25 most recent order events.');
    const events = order.timeline || [];
    if (!events.length) {
      section.appendChild(element('p', 'shopify-detail-muted', 'No timeline events were returned.'));
      return section;
    }
    const list = element('ol', 'shopify-detail-timeline');
    events.forEach((event) => {
      const item = element('li', event.critical ? 'is-critical' : '');
      const marker = element('span', 'shopify-detail-timeline-marker');
      const content = element('div');
      const heading = cleanTimelineMessage(event.message) || humanize(event.action || event.type);
      content.appendChild(element('strong', '', heading));
      const byline = [formatDate(event.createdAt), event.author || event.appTitle].filter(Boolean).join(' · ');
      content.appendChild(element('span', 'shopify-detail-muted', byline));
      if (event.secondaryMessage) content.appendChild(element('p', '', cleanTimelineMessage(event.secondaryMessage)));
      item.append(marker, content);
      list.appendChild(item);
    });
    section.appendChild(list);
    return section;
  }

  function renderOrderDetail(order, result) {
    els.detailTitle.textContent = `${order.displayName || 'Order'} · Shopify live`;
    const cacheLabel = result?.cached ? '5-minute detail cache' : 'live Shopify response';
    els.detailMeta.textContent = `${cacheLabel} · Fetched ${formatDate(result?.fetchedAt)} · Redis queue not read`;
    const content = document.createDocumentFragment();
    content.append(
      renderSummary(order),
      renderFinancials(order),
      renderCustomer(order),
      renderDelivery(order),
      renderConversion(order),
      renderDiscounts(order),
      renderLineItems(order),
      renderTimeline(order)
    );
    els.detailContent.replaceChildren(content);
    els.detailContent.hidden = false;
  }

  function showDetailDialog() {
    if (typeof els.detail.showModal === 'function') {
      if (!els.detail.open) els.detail.showModal();
    } else {
      els.detail.setAttribute('open', '');
    }
    document.body.classList.add('shopify-preview-detail-open');
  }

  function closeOrderDetail() {
    if (typeof els.detail.close === 'function' && els.detail.open) els.detail.close();
    else els.detail.removeAttribute('open');
    document.body.classList.remove('shopify-preview-detail-open');
  }

  async function openOrderDetail(order) {
    if (!order?.id || state.detailLoading) return;
    state.detailOrderId = order.id;
    state.detailLoading = true;
    els.detailTitle.textContent = `${order.displayName || 'Order'} · Shopify live`;
    els.detailMeta.textContent = 'Loading directly from Shopify…';
    els.detailLoading.hidden = false;
    els.detailError.hidden = true;
    els.detailContent.hidden = true;
    els.detailContent.replaceChildren();
    showDetailDialog();

    try {
      const result = await window.api.getShopifyPreviewOrderDetail(order.id);
      if (state.detailOrderId !== order.id) return;
      renderOrderDetail(result?.data || {}, result);
    } catch (error) {
      els.detailError.textContent = `Shopify order details could not load: ${error?.message || error}`;
      els.detailError.hidden = false;
      els.detailMeta.textContent = 'The Redis production board remains safe and unchanged.';
    } finally {
      state.detailLoading = false;
      els.detailLoading.hidden = true;
    }
  }

  async function loadPreview({ refresh = false } = {}) {
    if (state.loading || !state.active) return;
    state.loading = true;
    els.error.hidden = true;
    els.status.textContent = refresh ? 'Refreshing directly from Shopify…' : 'Loading recent Shopify orders…';
    setRefreshBusy(true);

    try {
      const result = await window.api.getShopifyPreviewOrders({ limit: 50, refresh });
      const orders = Array.isArray(result?.data) ? result.data : [];
      renderOrders(orders);
      state.loaded = true;
      const fetched = formatDate(result?.fetchedAt);
      const cacheLabel = result?.cached ? '30-second Shopify cache' : 'live Shopify response';
      const moreLabel = result?.pageInfo?.hasNextPage ? ' · More older orders exist' : '';
      els.status.textContent = `${orders.length} recent orders · ${cacheLabel} · Fetched ${fetched}${moreLabel}`;
      els.source.textContent = `Source: Shopify Admin GraphQL ${result?.apiVersion || ''} · Redis queue not read`;
    } catch (error) {
      els.error.textContent = `Shopify preview could not load: ${error?.message || error}`;
      els.error.hidden = false;
      els.status.textContent = 'Shopify preview unavailable. Redis board is still safe and unchanged.';
      els.source.textContent = 'Switch back to Redis board to continue production work.';
    } finally {
      state.loading = false;
      setRefreshBusy(false);
    }
  }

  function setRefreshBusy(busy) {
    for (const button of [els.refresh, els.mobileRefresh]) {
      if (!button) continue;
      button.disabled = Boolean(busy);
      button.setAttribute('aria-busy', busy ? 'true' : 'false');
    }
    if (els.refresh) els.refresh.textContent = busy ? 'Refreshing…' : (state.active ? 'Refresh Shopify' : 'Refresh');
    const mobileLabel = els.mobileRefresh?.querySelector('.mobile-refresh-label');
    if (mobileLabel) mobileLabel.textContent = busy ? 'Loading' : (state.active ? 'Shopify' : 'Sync');
  }

  function syncSourceButtons(source) {
    document.querySelectorAll('[data-order-source-target]').forEach((button) => {
      const selected = button.dataset.orderSourceTarget === source;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
  }

  function setPrimaryOrderNav() {
    document.body.dataset.activeView = 'orders';
    document.querySelectorAll('.app-nav-tab').forEach((button) => {
      const selected = button.dataset.view === 'orders';
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    els.storageView?.setAttribute('aria-hidden', 'true');
  }

  function setPreviewActive(active, { preserveActiveView = false } = {}) {
    state.active = Boolean(active);
    document.body.dataset.orderSource = state.active ? 'shopify' : 'redis';
    syncSourceButtons(state.active ? 'shopify' : 'redis');
    els.preview.hidden = !state.active;
    els.preview.setAttribute('aria-hidden', state.active ? 'false' : 'true');
    els.orders.hidden = state.active;
    els.orders.setAttribute('aria-hidden', state.active ? 'true' : 'false');

    if (!state.active) closeOrderDetail();
    if (!preserveActiveView) setPrimaryOrderNav();
    setRefreshBusy(false);
    if (state.active) loadPreview({ refresh: state.loaded });
  }

  function handleRefresh(event) {
    if (!state.active) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    loadPreview({ refresh: true });
  }

  document.addEventListener('DOMContentLoaded', () => {
    els.preview = document.getElementById('shopify-preview-view');
    els.orders = document.getElementById('orders-view');
    els.storageView = document.getElementById('storage-view');
    els.rows = document.getElementById('shopify-preview-rows');
    els.table = document.querySelector('.shopify-preview-table');
    els.empty = document.getElementById('shopify-preview-empty');
    els.error = document.getElementById('shopify-preview-error');
    els.status = document.getElementById('shopify-preview-status');
    els.source = document.getElementById('shopify-preview-source');
    els.refresh = document.getElementById('order-manager-refresh-btn');
    els.mobileRefresh = document.getElementById('mobile-refresh-btn');
    els.detail = document.getElementById('shopify-preview-detail');
    els.detailTitle = document.getElementById('shopify-preview-detail-title');
    els.detailMeta = document.getElementById('shopify-preview-detail-meta');
    els.detailLoading = document.getElementById('shopify-preview-detail-loading');
    els.detailError = document.getElementById('shopify-preview-detail-error');
    els.detailContent = document.getElementById('shopify-preview-detail-content');

    document.body.dataset.orderSource = 'redis';
    document.querySelectorAll('[data-order-source-target]').forEach((button) => {
      button.addEventListener('click', () => setPreviewActive(button.dataset.orderSourceTarget === 'shopify'));
    });
    document.querySelectorAll('.app-nav-tab').forEach((button) => {
      button.addEventListener('click', () => {
        if (state.active) setPreviewActive(false, { preserveActiveView: true });
      });
    });
    els.refresh?.addEventListener('click', handleRefresh, true);
    els.mobileRefresh?.addEventListener('click', handleRefresh, true);
    document.getElementById('shopify-preview-detail-close')?.addEventListener('click', closeOrderDetail);
    els.detail?.addEventListener('cancel', () => document.body.classList.remove('shopify-preview-detail-open'));
    els.detail?.addEventListener('click', (event) => {
      if (event.target === els.detail) closeOrderDetail();
    });
    setPreviewActive(false);
  });
})();
