(function () {
  const checkboxIds = [
    'chk-blanks',
    'chk-prints',
    'chk-blanks-ordered',
    'chk-prints-ordered'
  ];
  const readinessSequences = [
    {
      key: 'blanks',
      orderedId: 'chk-blanks-ordered',
      readyId: 'chk-blanks',
      orderedLabel: 'Blanks ordered',
      readyLabel: 'Blanks ready'
    },
    {
      key: 'prints',
      orderedId: 'chk-prints-ordered',
      readyId: 'chk-prints',
      orderedLabel: 'Prints ordered',
      readyLabel: 'Prints ready'
    }
  ];
  let mockupObserver = null;
  let mockupFrameResizeObserver = null;
  let mockupFrameResizeScheduled = false;
  let itemTableObserver = null;
  let designFilesObserver = null;
  let readyApplyObserver = null;
  let designFilesEnhanceScheduled = false;
  let currentDetailOrder = null;
  let savedNotesText = '';
  const noteDraftStore = window.OrderDetailState.createNoteDraftStore();
  let activeNotesOrderKey = '';
  let notesSavedFlashTimer = null;
  let selectedMockupIndex = 0;
  let assetViewerCloseTimer = null;
  let detailTabControllerWired = false;
  let detailHydrationGeneration = 0;
  let detailHydrationController = null;
  let overviewProgressObserver = null;

  function normalizedStatusClass(value) {
    return `is-${String(value || 'unknown')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')}`;
  }

  function setStatusBadge(element, value, fallback) {
    if (!element) return;
    const label = String(value || fallback || 'Unknown').trim();
    element.textContent = label;
    element.className = `status-badge ${normalizedStatusClass(label)}`;
  }

  function money(value, currencyCode = 'USD') {
    const amount = value && typeof value === 'object' ? value.amount : value;
    const currency = (value && typeof value === 'object' && value.currencyCode)
      || currencyCode
      || 'USD';
    return (Number(amount) || 0).toLocaleString(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function setText(id, value, fallback = '—') {
    const element = document.getElementById(id);
    if (element) element.textContent = value === undefined || value === null || value === '' ? fallback : String(value);
  }

  function formatDetailDate(value, fallback = '—') {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return fallback;
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  function normalizedStageLabel(value) {
    const stage = String(value || '').trim();
    if (!stage) return 'Received';
    return stage
      .replace(/_/g, ' ')
      .replace(/\b\w/g, character => character.toUpperCase());
  }

  function detailResponseData(result) {
    return result?.data || result?.detail?.data || null;
  }

  function canonicalLineItems(result) {
    const detailItems = result?.detail?.lineItems;
    if (Array.isArray(detailItems)) return detailItems;
    const richItems = detailResponseData(result)?.lineItems;
    if (Array.isArray(richItems)) return richItems;
    const summaryItems = result?.commerce?.lineItems;
    return Array.isArray(summaryItems) ? summaryItems : [];
  }

  function mergeCatalogPreview(existingPreview, incomingPreview) {
    if (!incomingPreview?.previewId) return existingPreview || null;
    const samePreview = String(existingPreview?.previewId || '') === String(incomingPreview.previewId);
    return {
      ...(samePreview ? existingPreview : {}),
      ...incomingPreview,
      // Detail reads intentionally return only opaque preview identities. Keep
      // the still-valid signed URL already loaded for this exact card preview
      // until the client refreshes it, so canonical detail hydration cannot
      // make a visible catalog thumbnail flash away.
      url: incomingPreview.url || (samePreview ? existingPreview?.url : '') || '',
      _previewState: incomingPreview._previewState || (samePreview ? existingPreview?._previewState : '') || undefined,
    };
  }

  function isInternalItemAttribute(attribute) {
    const key = String(attribute?.key || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    return key === 'group_id' || key === 'batch_id' || key === 'role';
  }

  function isOptionalPermissionError(error) {
    const code = String(error?.code || error?.extensions?.code || '').toUpperCase();
    const message = String(error?.message || error || '').toUpperCase();
    return code === 'ACCESS_DENIED' || message.includes('ACCESS_DENIED');
  }

  function dedupeDetailErrors(errors) {
    const seen = new Set();
    return errors.filter(error => {
      const key = `${error?.code || error?.extensions?.code || ''}|${error?.message || String(error)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function mergeCanonicalDetail(order, result) {
    if (!order || !result) return order;
    const detail = result.detail || {};
    const rich = detailResponseData(result) || {};
    const commerce = rich.commerce || result.commerce || {};
    const delivery = rich.delivery || {};
    const production = result.production || {};
    const customer = rich.customer || detail.customer || result.customer || {};
    const existingItems = new Map((order.items || []).map(item => [item.id, item]));
    const lineItems = canonicalLineItems(result);
    const canonicalAssets = Array.isArray(production.assets) ? production.assets : [];
    const assetsByLine = new Map();
    const unassignedAssets = [];
    canonicalAssets.forEach(asset => {
      if (!asset?.lineItemId) {
        unassignedAssets.push(asset);
        return;
      }
      const linked = assetsByLine.get(asset.lineItemId) || [];
      linked.push(asset);
      assetsByLine.set(asset.lineItemId, linked);
    });

    order.displayFinancialStatus = commerce.financialStatus || result.commerce?.financialStatus || order.displayFinancialStatus;
    order.displayFulfillmentStatus = commerce.fulfillmentStatus || result.commerce?.fulfillmentStatus || order.displayFulfillmentStatus;
    order.financialStatus = order.displayFinancialStatus;
    order.fulfillmentStatus = order.displayFulfillmentStatus;
    order.currencyCode = commerce.currencyCode || result.commerce?.currencyCode || order.currencyCode || 'USD';
    order.subtotal = commerce.subtotal?.amount ?? commerce.subtotal ?? result.commerce?.subtotal ?? order.subtotal;
    order.discount = commerce.discounts?.amount ?? commerce.discount ?? result.commerce?.discount ?? order.discount;
    order.total = commerce.total?.amount ?? commerce.total ?? result.commerce?.total ?? order.total;
    order.shopifyUpdatedAt = rich.shopifyUpdatedAt || result.shopifyUpdatedAt || order.shopifyUpdatedAt;
    order.shopifyNote = rich.note ?? detail.orderNote ?? order.shopifyNote ?? '';
    order.shippingAddress = delivery.shippingAddress || detail.shippingAddress || order.shippingAddress || null;
    order.billingAddress = delivery.billingAddress || detail.billingAddress || order.billingAddress || null;
    order.fulfillments = delivery.fulfillments || detail.fulfillments || order.fulfillments || [];
    order.email = customer.email || order.email || '';
    order.phone = customer.phone || order.phone || '';
    order.customer = customer;
    order.attention = result.attention || production.attention || order.attention || { required: false, reasons: [] };
    window.OrderDetailState.mergeCanonicalProductionState(order, production);
    order.productionStage = order.productionStage || order.status || 'received';
    if (Object.prototype.hasOwnProperty.call(production, 'internalNotes')) {
      order.notes = cleanNoteValue(production.internalNotes);
    }
    order.sync = result.sync || order.sync || {};
    order.canonicalDetail = result;

    if (lineItems.length) {
      order.items = lineItems.map(item => {
        const existing = existingItems.get(item.id) || {};
        const unitPrice = item.unitPrice?.amount ?? item.unitPrice ?? existing.unitPrice ?? existing.price ?? 0;
        const customAttributes = Array.isArray(item.customAttributes)
          ? item.customAttributes
          : existing.customAttributes || [];
        return {
          ...existing,
          id: item.id || existing.id,
          title: item.title || existing.title || '',
          variantTitle: item.variantTitle || existing.variantTitle || '',
          sku: item.sku || existing.sku || '',
          qty: Number(item.currentQuantity ?? item.quantity ?? existing.qty ?? 0),
          price: Number(unitPrice) || 0,
          unitPrice: Number(unitPrice) || 0,
          customAttributes,
          catalogPreview: mergeCatalogPreview(existing.catalogPreview, item.catalogPreview),
          assets: assetsByLine.get(item.id) || existing.assets || [],
          discountAllocations: item.discountAllocations || [],
          originalQuantity: Number(item.quantity ?? existing.originalQuantity ?? 0),
          currentQuantity: Number(item.currentQuantity ?? item.quantity ?? existing.qty ?? 0),
          originalTotal: item.originalTotal || null,
          currentTotal: item.currentTotal || null,
          totalDiscount: item.totalDiscount || null,
          vendor: item.vendor || null,
          unfulfilledQuantity: Number(item.unfulfilledQuantity || 0),
          requiresShipping: Boolean(item.requiresShipping)
        };
      });
      if (order.items.length && unassignedAssets.length) {
        order.items[0].assets = [...(order.items[0].assets || []), ...unassignedAssets];
      }
    }
    order.assets = canonicalAssets;

    const firstTracking = (order.fulfillments || [])
      .flatMap(fulfillment => fulfillment.tracking || fulfillment.trackingInfo || [])
      .find(tracking => tracking?.number || tracking?.url);
    if (firstTracking) {
      order.tracking = firstTracking;
      order.trackingNumber = firstTracking.number || '';
      order.trackingUrl = firstTracking.url || '';
    }
    return order;
  }

  function appendAddressLines(container, address, fallbackName) {
    if (!container) return;
    container.replaceChildren();
    const lines = addressLines(address, fallbackName);
    if (lines.length) {
      lines.forEach((line, index) => {
        const element = document.createElement(index === 0 ? 'strong' : 'span');
        element.textContent = line;
        container.appendChild(element);
      });
      return;
    }
    const unavailable = document.createElement('span');
    unavailable.className = 'redacted-info-badge';
    unavailable.textContent = 'Unavailable or restricted';
    container.appendChild(unavailable);
  }

  function createRichListItem(title, details = [], options = {}) {
    const item = document.createElement('article');
    item.className = `detail-rich-list-item${options.warning ? ' is-warning' : ''}`;
    const heading = document.createElement('strong');
    heading.textContent = title;
    item.appendChild(heading);
    const usableDetails = details.filter(Boolean);
    if (usableDetails.length) {
      const meta = document.createElement('div');
      meta.className = 'detail-rich-list-meta';
      usableDetails.forEach(value => {
        const span = document.createElement('span');
        span.textContent = value;
        meta.appendChild(span);
      });
      item.appendChild(meta);
    }
    return item;
  }

  function setDetailDataState(state, message = '', options = {}) {
    const container = document.getElementById('detail-data-status');
    const copy = document.getElementById('detail-data-status-copy');
    const retry = document.getElementById('detail-data-retry');
    if (!container || !copy || !retry) return;
    container.classList.remove('is-loading', 'is-warning', 'is-error', 'is-success');
    container.classList.toggle('hidden', state === 'ready' && !message);
    if (state !== 'ready') container.classList.add(`is-${state}`);
    copy.textContent = message;
    retry.classList.toggle('hidden', !options.retry);
    retry.disabled = Boolean(options.loading);
  }

  function renderCanonicalItems(order, result) {
    const rawLineItems = canonicalLineItems(result);
    const lineItems = typeof consolidateLineItemsForDisplay === 'function'
      ? consolidateLineItemsForDisplay(rawLineItems)
      : rawLineItems;
    const tbody = document.querySelector('#detail-items tbody');
    if (!tbody || !lineItems.length) return;
    const detailData = detailResponseData(result) || {};
    const commerce = detailData.commerce || result?.commerce || {};
    const delivery = detailData.delivery || result?.delivery || {};
    const currency = commerce.currencyCode || order.currencyCode || 'USD';
    const moneyOrUnavailable = value => value == null || (typeof value === 'object' && value.amount == null)
      ? 'Not returned'
      : money(value, currency);
    const fragment = document.createDocumentFragment();

    lineItems.forEach(item => {
      const row = document.createElement('tr');
      const quantity = Number(item.currentQuantity ?? item.quantity ?? 0);
      const unitPrice = item.unitPrice?.amount ?? item.unitPrice ?? 0;
      const allocatedDiscount = (item.discountAllocations || []).reduce((total, allocation) => {
        const allocationMoney = allocation?.allocatedAmountSet?.shopMoney || allocation;
        return total + (Number(allocationMoney?.amount) || 0);
      }, 0);
      const currentTotal = Number.isFinite(item._displayCurrentTotal)
        ? item._displayCurrentTotal
        : item.currentTotal?.amount
        ?? Math.max(0, (Number(unitPrice) * quantity) - allocatedDiscount);
      [
        String(quantity),
        item.title || 'Untitled item',
        item.sku || '—',
        item.variantTitle || '—',
        money(currentTotal, item.currentTotal?.currencyCode || currency)
      ].forEach((value, index) => {
        const cell = document.createElement('td');
        cell.textContent = value;
        cell.dataset.label = ['Qty', 'Item', 'SKU', 'Variant', 'Current total'][index];
        if (index === 4) cell.className = 'detail-money-cell';
        row.appendChild(cell);
      });
      fragment.appendChild(row);

    });
    tbody.replaceChildren(fragment);

    const shippingLine = Array.isArray(delivery.shippingLines) ? delivery.shippingLines[0] : null;
    const fulfillmentOrder = Array.isArray(delivery.fulfillmentOrders) ? delivery.fulfillmentOrders[0] : null;
    const shippingName = shippingLine?.title || fulfillmentOrder?.method?.presentedName || '';
    const deliveryType = String(shippingLine?.deliveryCategory || fulfillmentOrder?.method?.type || '').toUpperCase();
    const isPickup = /PICK|LOCAL/.test(deliveryType) || /PICKUP|LOCAL PICKUP/i.test(shippingName);
    const shippingLabel = isPickup
      ? `Local pickup · ${moneyOrUnavailable(commerce.shipping)}`
      : shippingName ? `${shippingName} · ${moneyOrUnavailable(commerce.shipping)}` : moneyOrUnavailable(commerce.shipping);
    const discount = commerce.discounts ?? commerce.discount ?? order.discount;
    const discountAmount = Number(discount?.amount ?? discount ?? 0);

    setText('detail-subtotal', moneyOrUnavailable(commerce.subtotal), money(order.subtotal, currency));
    setText('detail-shipping', shippingLabel, 'Not returned');
    setText('detail-discount', `-${money(discount, currency)}`, `-${money(order.discount, currency)}`);
    setText('detail-tax', moneyOrUnavailable(commerce.tax), 'Not returned');
    setText('detail-total', moneyOrUnavailable(commerce.total), money(order.total, currency));
    document.getElementById('detail-discount-row')?.classList.toggle('hidden', discountAmount === 0);

    const discountSection = document.getElementById('detail-item-discounts');
    const discountList = document.getElementById('detail-item-discounts-list');
    const discounts = Array.isArray(detailData.discounts) ? detailData.discounts : [];
    discountSection?.classList.toggle('hidden', discounts.length === 0);
    setText('detail-item-discounts-count', discounts.length, '0');
    if (discountList) {
      const items = discounts.map(discount => {
        const value = discount?.value?.type === 'percentage'
          ? `${Math.abs(Number(discount.value.percentage || 0))}% off`
          : discount?.value ? `${money(discount.value, currency)} off` : null;
        return createRichListItem(
          discount.label || discount.code || 'Discount',
          [value, normalizedStageLabel(discount.type), discount.description].filter(Boolean)
        );
      });
      discountList.replaceChildren(...items);
    }

    const taxSection = document.getElementById('detail-tax-details');
    const taxList = document.getElementById('detail-tax-details-list');
    const taxLines = rawLineItems.flatMap(item => item.taxLines || []);
    const taxGroups = Array.from(taxLines.reduce((groups, taxLine) => {
      const rate = Number(taxLine.rate || 0);
      const key = `${taxLine.title || 'Tax'}|${rate}`;
      const current = groups.get(key) || { title: taxLine.title || 'Tax', rate, amount: 0 };
      current.amount += Number(taxLine.amount?.amount ?? taxLine.amount ?? 0);
      groups.set(key, current);
      return groups;
    }, new Map()).values());
    taxSection?.classList.toggle('hidden', taxGroups.length === 0);
    setText('detail-tax-details-count', taxGroups.length, '0');
    if (taxList) taxList.replaceChildren(...taxGroups.map(taxLine =>
      createRichListItem(taxLine.title, [
        taxLine.rate ? `${(Number(taxLine.rate) * 100).toLocaleString(undefined, { maximumFractionDigits: 3 })}%` : null,
        money(taxLine.amount, currency)
      ].filter(Boolean))
    ));
  }

  function renderProductionContext(result) {
    const production = result?.production || {};
    const attention = result?.attention || production.attention || {};
    setText('production-stage-val', normalizedStageLabel(production.stage), 'Received');
    setText('production-bundle-val', production.bundleId || 'None', 'None');
    setText('production-revision-val', production.revision ?? production.version, '—');
    setText('production-updated-val', formatDetailDate(production.updatedAt), '—');
    const attentionBadge = document.getElementById('production-attention-badge');
    attentionBadge?.classList.toggle('hidden', !attention.required);
  }

  function canonicalDesignAssets(result) {
    const assets = Array.isArray(result?.production?.assets) ? result.production.assets : [];
    return assets.filter(asset => asset?.role !== 'mockup');
  }

  function applyCanonicalDesignMetadata(result) {
    const lineItemSizes = new Map(canonicalLineItems(result).map(item => {
      const size = (item.customAttributes || []).find(attribute => String(attribute?.key || '').trim().toLowerCase() === 'size_inches')?.value;
      return [item.id, String(size || '').trim()];
    }));
    const bySide = {
      front: canonicalDesignAssets(result).filter(asset => asset.side === 'front'),
      back: canonicalDesignAssets(result).filter(asset => asset.side === 'back'),
      extras: canonicalDesignAssets(result).filter(asset => !['front', 'back'].includes(asset.side))
    };
    [
      ['front', 'design-front-list', 'Front'],
      ['back', 'design-back-list', 'Back'],
      ['extras', 'design-extras-list', 'Extra']
    ].forEach(([side, listId, fallback]) => {
      const rows = Array.from(document.getElementById(listId)?.querySelectorAll('.design-tile, .design-file-row') || []);
      rows.forEach((row, index) => {
        const asset = bySide[side][index];
        if (!asset) return;
        const filename = String(asset.name || `${fallback} design ${index + 1}`).trim();
        const label = row.querySelector('.design-label');
        if (label) {
          label.textContent = filename;
          label.title = filename;
        }
        let meta = row.querySelector('.design-file-meta');
        if (!meta) {
          meta = document.createElement('div');
          meta.className = 'design-file-meta';
          row.appendChild(meta);
        }
        const dimensions = lineItemSizes.get(asset.lineItemId)
          || asset.dimensionsIn
          || asset.metadata?.dimensionsIn
          || asset.meta?.dimensionsIn
          || '';
        meta.textContent = [fallback, dimensions].filter(Boolean).join(' · ');
        meta.title = meta.textContent;
      });
    });
  }

  function fulfillmentTracking(fulfillment) {
    return fulfillment?.tracking || fulfillment?.trackingInfo || [];
  }

  function renderFulfillmentDetail(order, result) {
    const rich = detailResponseData(result) || {};
    const delivery = rich.delivery || {};
    const detail = result?.detail || {};
    const customerName = result?.customer?.displayName || orderContextParts(order.name).customer;
    appendAddressLines(
      document.getElementById('logistics-address-text'),
      delivery.shippingAddress || detail.shippingAddress || order.shippingAddress,
      customerName
    );
    appendAddressLines(
      document.getElementById('logistics-billing-text'),
      delivery.billingAddress || detail.billingAddress || order.billingAddress,
      customerName
    );

    const fulfillments = delivery.fulfillments || detail.fulfillments || [];
    const trackingContainer = document.getElementById('logistics-tracking-link');
    if (trackingContainer) {
      trackingContainer.replaceChildren();
      const tracking = fulfillments.flatMap(fulfillment => fulfillmentTracking(fulfillment));
      if (!tracking.length) {
        trackingContainer.textContent = 'No tracking number';
      } else {
        tracking.forEach((entry, index) => {
          const label = [entry.company, entry.number].filter(Boolean).join(' · ') || `Tracking ${index + 1}`;
          if (entry.url && /^https?:\/\//i.test(entry.url)) {
            const link = document.createElement('a');
            link.href = entry.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = label;
            trackingContainer.appendChild(link);
          } else {
            const text = document.createElement('span');
            text.textContent = label;
            trackingContainer.appendChild(text);
          }
        });
      }
    }

    const list = document.getElementById('logistics-fulfillments-list');
    setText('logistics-fulfillments-count', fulfillments.length, '0');
    if (list) {
      if (!fulfillments.length) {
        const empty = document.createElement('p');
        empty.className = 'detail-inline-empty';
        empty.textContent = 'No fulfillments have been created.';
        list.replaceChildren(empty);
      } else {
        list.replaceChildren(...fulfillments.map((fulfillment, index) => {
          const trackingCount = fulfillmentTracking(fulfillment).length;
          return createRichListItem(
            fulfillment.name || `Fulfillment ${index + 1}`,
            [
              normalizedStageLabel(fulfillment.displayStatus || fulfillment.status),
              trackingCount ? `${trackingCount} tracking ${trackingCount === 1 ? 'entry' : 'entries'}` : 'No tracking',
              fulfillment.updatedAt ? `Updated ${formatDetailDate(fulfillment.updatedAt)}` : null
            ]
          );
        }));
      }
    }

    const serviceList = document.getElementById('logistics-service-list');
    if (serviceList) {
      const services = [
        ...(delivery.fulfillmentOrders || []).map(fulfillmentOrder => {
          const method = fulfillmentOrder.method || {};
          const window = method.maxDeliveryAt
            ? `Deliver by ${formatDetailDate(method.maxDeliveryAt)}`
            : method.minDeliveryAt ? `Delivery starts ${formatDetailDate(method.minDeliveryAt)}` : null;
          return createRichListItem(
            method.presentedName || normalizedStageLabel(method.type) || 'Delivery method',
            [method.serviceCode, normalizedStageLabel(method.type), window].filter(Boolean)
          );
        }),
        ...(delivery.shippingLines || []).map(line =>
          createRichListItem(
            line.title || 'Checkout shipping service',
            [line.code, normalizedStageLabel(line.deliveryCategory), line.currentPrice ? money(line.currentPrice) : null].filter(Boolean)
          )
        )
      ];
      if (!services.length) {
        const empty = document.createElement('p');
        empty.className = 'detail-inline-empty';
        empty.textContent = 'No shipping service was returned.';
        serviceList.replaceChildren(empty);
      } else {
        serviceList.replaceChildren(...services);
      }
    }
  }

  function renderCustomerAndOrder(order, result) {
    const rich = detailResponseData(result) || {};
    const customer = rich.customer || result?.detail?.customer || result?.customer || {};
    const detail = result?.detail || {};
    setText('customer-name-val', operationalDetailCustomerName(order), 'Unavailable');
    setText('customer-email-val', customer.email || order.email, 'Unavailable or restricted');
    setText('customer-phone-val', customer.phone || order.phone, 'Unavailable or restricted');
    setText('customer-locale-val', customer.locale, 'Not available');
    setText('customer-order-created-val', formatDetailDate(rich.createdAt || result?.createdAt || order.receivedAt), '—');
    setText('customer-order-updated-val', formatDetailDate(rich.shopifyUpdatedAt || result?.shopifyUpdatedAt), '—');
    setText('customer-order-note-val', rich.note ?? detail.orderNote, 'No customer checkout note');
    const conversion = rich.conversion;
    const conversionContainer = document.getElementById('customer-conversion-summary');
    if (conversionContainer) {
      if (!conversion) {
        const empty = document.createElement('p');
        empty.className = 'detail-inline-empty';
        empty.textContent = 'No conversion summary was returned for this order.';
        conversionContainer.replaceChildren(empty);
      } else {
        const visitDetails = visit => visit
          ? [
              visit.sourceDescription || visit.source,
              visit.sourceType ? normalizedStageLabel(visit.sourceType) : null,
              visit.occurredAt ? formatDetailDate(visit.occurredAt) : null
            ].filter(Boolean).join(' · ')
          : 'Not returned';
        conversionContainer.replaceChildren(
          createRichListItem('Conversion', [
            conversion.ready ? 'Attribution ready' : 'Attribution still processing',
            conversion.customerOrderIndex ? `Customer order #${conversion.customerOrderIndex}` : null,
            conversion.daysToConversion !== null && conversion.daysToConversion !== undefined ? `${conversion.daysToConversion} days to conversion` : null
          ].filter(Boolean)),
          createRichListItem('First attributed visit', [visitDetails(conversion.firstVisit)]),
          createRichListItem('Last attributed visit', [visitDetails(conversion.lastVisit)])
        );
      }
    }
  }

  function renderActivityAndExceptions(order, result) {
    const provider = String(result?.source?.provider || order?._provider || 'shopify').toLowerCase();
    const sourceLabel = provider === 'etsy' ? 'Etsy' : 'Shopify';
    const attention = result?.attention || result?.production?.attention || {};
    const sync = result?.sync || {};
    const detail = result?.detail || {};
    const reasons = Array.isArray(attention.reasons) ? attention.reasons.filter(Boolean) : [];
    const errors = dedupeDetailErrors([
      ...(Array.isArray(sync.errors) ? sync.errors : []),
      ...(Array.isArray(detail.errors) ? detail.errors : [])
    ]);
    const actionableErrors = errors.filter(error => !isOptionalPermissionError(error));
    const cancelledAt = result?.commerce?.cancelledAt || null;
    const attentionCount = reasons.length + actionableErrors.length + (cancelledAt ? 1 : 0);
    const badge = document.getElementById('tab-badge-attention');
    if (badge) {
      badge.textContent = String(attentionCount);
      badge.classList.toggle('hidden', attentionCount === 0);
    }
    const attentionState = document.getElementById('detail-attention-state');
    if (attentionState) {
      attentionState.textContent = attentionCount ? `${attentionCount} open` : 'Clear';
      attentionState.dataset.state = attentionCount ? 'attention' : 'clear';
    }

    const list = document.getElementById('detail-attention-list');
    if (list) {
      const entries = [
        ...(cancelledAt
          ? [createRichListItem(
              `${sourceLabel} order canceled`,
              [`Canceled ${formatDetailDate(cancelledAt)}`],
              { warning: true }
            )]
          : []),
        ...reasons.map(reason => createRichListItem('Production attention', [reason], { warning: true })),
        ...actionableErrors.map(error => createRichListItem(
          error.code || `${sourceLabel} detail warning`,
          [error.message || String(error)],
          { warning: true }
        ))
      ];
      if (!entries.length) {
        const empty = document.createElement('p');
        empty.className = 'detail-inline-empty';
        empty.textContent = 'No production exceptions require attention.';
        list.replaceChildren(empty);
      } else {
        list.replaceChildren(...entries);
      }
    }

    const timeline = document.getElementById('timeline-stream-container');
    if (timeline) {
      const events = [
        {
          title: 'Canonical detail loaded',
          meta: detail.fetchedAt || sync.fetchedAt,
          description: detail.partial || sync.partial
            ? `Available order data loaded with partial ${sourceLabel} results.`
            : `Current ${sourceLabel} commerce and PrintMO production data loaded.`
        },
        {
          title: `${sourceLabel} order updated`,
          meta: result?.shopifyUpdatedAt,
          description: `Latest ${sourceLabel} order modification time.`
        },
        {
          title: 'Production state updated',
          meta: result?.production?.updatedAt,
          description: result?.production?.updatedBy
            ? `Last changed by ${result.production.updatedBy}.`
            : 'Latest PrintMO production state.'
        }
      ].filter(event => event.meta);
      timeline.replaceChildren(...events.map(event => {
        const item = document.createElement('div');
        item.className = 'timeline-item';
        const dot = document.createElement('div');
        dot.className = 'timeline-icon-dot';
        dot.setAttribute('aria-hidden', 'true');
        const title = document.createElement('strong');
        title.textContent = event.title;
        const description = document.createElement('span');
        description.textContent = `${formatDetailDate(event.meta)} · ${event.description}`;
        item.append(dot, title, description);
        return item;
      }));
    }
    const liveTimeline = document.getElementById('timeline-stream-container');
    const sourceEvents = Array.isArray(detailResponseData(result)?.timeline) ? detailResponseData(result).timeline : [];
    if (liveTimeline) {
      if (!sourceEvents.length) {
        const empty = document.createElement('p');
        empty.className = 'detail-inline-empty';
        empty.textContent = `No ${sourceLabel} timeline events were returned.`;
        liveTimeline.replaceChildren(empty);
      } else liveTimeline.replaceChildren(...sourceEvents.map(event => {
        const item = document.createElement('div');
        item.className = 'timeline-item';
        const dot = document.createElement('div');
        dot.className = 'timeline-icon-dot';
        dot.setAttribute('aria-hidden', 'true');
        const title = document.createElement('strong');
        title.textContent = String(event.message || event.action || event.type || `${sourceLabel} order event`).replace(/<[^>]+>/g, '').trim();
        const description = document.createElement('span');
        description.textContent = [
          formatDetailDate(event.createdAt),
          event.author || event.appTitle,
          event.secondaryMessage ? String(event.secondaryMessage).replace(/<[^>]+>/g, '').trim() : null
        ].filter(Boolean).join(' · ');
        item.append(dot, title, description);
        return item;
      }));
    }

    const productionTimeline = document.getElementById('production-history-container');
    const productionEvents = Array.isArray(result?.productionEvents) ? result.productionEvents : [];
    if (productionTimeline) {
      if (!productionEvents.length) {
        const empty = document.createElement('p');
        empty.className = 'detail-inline-empty';
        empty.textContent = 'No PrintMO production changes have been recorded.';
        productionTimeline.replaceChildren(empty);
      } else productionTimeline.replaceChildren(...productionEvents.map(event => {
        const item = document.createElement('div');
        item.className = 'timeline-item';
        const dot = document.createElement('div');
        dot.className = 'timeline-icon-dot';
        dot.setAttribute('aria-hidden', 'true');
        const title = document.createElement('strong');
        title.textContent = 'Production status updated';
        const description = document.createElement('span');
        description.textContent = [
          formatDetailDate(event.createdAt),
          event.fields?.length ? `Changed ${event.fields.join(', ')}` : null,
          event.actor ? `by ${event.actor}` : null
        ].filter(Boolean).join(' · ');
        item.append(dot, title, description);
        return item;
      }));
    }

    setText(
      'detail-sync-state',
      detail.partial || sync.partial ? 'Partial' : sync.stale ? 'Stale' : 'Current',
      'Current'
    );
  }

  function renderCanonicalDetail(order, result) {
    mergeCanonicalDetail(order, result);
    syncCanonicalProductionControls(order);
    if (typeof renderOrderAssets === 'function') renderOrderAssets(order);
    syncDetailHeader(order);
    syncCommerceDetail(order);
    renderCanonicalItems(order, result);
    renderProductionContext(result);
    applyCanonicalDesignMetadata(result);
    renderFulfillmentDetail(order, result);
    renderCustomerAndOrder(order, result);
    renderActivityAndExceptions(order, result);
    renderOverview(order, result);
    enhanceItemsTable(order);
    document.dispatchEvent(new CustomEvent('printmo:detail-items-rendered', {
      detail: { orderName: order?.name || '' }
    }));
    enhanceDesignFilesPanel();
    const partial = Boolean(result?.detail?.partial || result?.sync?.partial);
    const hasOptionalPermissionGap = dedupeDetailErrors([
      ...(Array.isArray(result?.sync?.errors) ? result.sync.errors : []),
      ...(Array.isArray(result?.detail?.errors) ? result.detail.errors : [])
    ]).some(isOptionalPermissionError);
    if (partial) {
      const sourceLabel = String(result?.source?.provider || order?._provider || 'shopify').toLowerCase() === 'etsy'
        ? 'Etsy'
        : 'Shopify';
      setDetailDataState(
        'warning',
        hasOptionalPermissionGap
          ? `Some optional ${sourceLabel} details are unavailable. Available order and production data are shown.`
          : `Some ${sourceLabel} fields could not be loaded. Available order data is still shown.`
      );
    } else {
      setDetailDataState('ready');
    }
  }

  function canonicalDetailStillActive(order, generation) {
    const overlay = document.getElementById('detail-overlay');
    return generation === detailHydrationGeneration
      && Boolean(overlay?.classList.contains('visible'))
      && document.body?.dataset.orderSource === 'shopify'
      && currentDetailOrder === order
      && order?._gid
      && currentDetailOrder?._gid === order._gid;
  }

  async function hydrateCanonicalDetail(order, options = {}) {
    detailHydrationController?.abort();
    detailHydrationController = null;
    const generation = ++detailHydrationGeneration;
    const eligible = order?._candidate === true
      && order?._gid
      && typeof window.api?.getOrderDetail === 'function';

    if (!eligible) {
      setDetailDataState('ready');
      const localResult = { production: {
        stage: order?.status,
        version: order?._version,
        bundleId: order?.bundle
      } };
      renderProductionContext(localResult);
      renderOverview(order, localResult);
      return;
    }

    const controller = new AbortController();
    detailHydrationController = controller;
    setDetailDataState(
      'loading',
      options.retry ? 'Retrying current Shopify order detail…' : 'Loading current Shopify order detail…',
      { loading: true }
    );
    try {
      const result = await window.api.getOrderDetail(order._gid, { signal: controller.signal });
      if (!canonicalDetailStillActive(order, generation)) return;
      renderCanonicalDetail(order, result);
    } catch (error) {
      if (error?.name === 'AbortError' || !canonicalDetailStillActive(order, generation)) return;
      setDetailDataState(
        'error',
        `Current Shopify detail could not load: ${error?.message || error}`,
        { retry: true }
      );
      const retry = document.getElementById('detail-data-retry');
      if (retry) retry.onclick = () => hydrateCanonicalDetail(order, { retry: true });
    } finally {
      if (generation === detailHydrationGeneration) detailHydrationController = null;
    }
  }

  function itemCounts(order) {
    return (order.items || []).reduce((totals, item) => {
      const qty = Number(item.qty) || 0;
      const printItem = typeof isPrintItem === 'function' && isPrintItem(item);
      const garmentItem = typeof isGarmentItem === 'function'
        ? isGarmentItem(item)
        : !printItem && Boolean(String(item?.sku || '').trim());
      if (printItem) totals.prints += qty;
      else if (garmentItem) totals.apparel += qty;
      else totals.other += qty;
      totals.all += qty;
      return totals;
    }, { all: 0, apparel: 0, prints: 0, other: 0 });
  }

  function overviewAttentionReasons(order, result) {
    const attention = result?.attention || result?.production?.attention || order?.attention || {};
    const reasons = Array.isArray(attention.reasons)
      ? attention.reasons.map(reason => String(reason || '').trim()).filter(Boolean)
      : [];
    if (attention.required && !reasons.length) reasons.push('This production order is marked as needing attention.');
    if (result?.commerce?.cancelledAt) reasons.unshift('The commerce order is canceled.');
    return [...new Set(reasons)];
  }

  function overviewMaterialCount() {
    return checkboxIds.filter(id => document.getElementById(id)?.checked).length;
  }

  function setOverviewMilestone(id, state) {
    const milestone = document.getElementById(id);
    if (milestone) milestone.dataset.state = state;
  }

  function overviewRecommendation(snapshot) {
    if (snapshot.reasons.length) {
      return {
        title: `Review ${snapshot.reasons.length} recorded ${snapshot.reasons.length === 1 ? 'exception' : 'exceptions'}`,
        description: 'Open Activity & exceptions to inspect the current reason before changing production state.',
        action: 'Open exceptions',
        target: 'tab-activity'
      };
    }
    if (snapshot.materialCount < checkboxIds.length) {
      return {
        title: 'Review material readiness',
        description: `${snapshot.materialCount} of ${checkboxIds.length} existing material milestones are marked.`,
        action: 'Open production',
        target: 'tab-production',
        mobileAnchor: 'ready-controls'
      };
    }
    if (snapshot.apparel > 0 && snapshot.progress < snapshot.apparel) {
      return {
        title: 'Update print progress',
        description: `${snapshot.progress} of ${snapshot.apparel} garment pieces are currently recorded as printed.`,
        action: 'Open production',
        target: 'tab-production',
        mobileAnchor: 'progress-section'
      };
    }
    if (snapshot.fulfillment !== 'FULFILLED') {
      return {
        title: 'Review fulfillment',
        description: 'Materials and print progress are recorded; fulfillment is not marked complete in commerce.',
        action: 'Open fulfillment',
        target: 'tab-logistics'
      };
    }
    return {
      title: 'Review completed order',
      description: 'Current material, print, and fulfillment fields show no remaining recorded work.',
      action: 'Open activity',
      target: 'tab-activity'
    };
  }

  function renderOverview(order, result = null) {
    if (!order || !document.getElementById('tab-overview')) return;
    const counts = itemCounts(order);
    const progress = Math.max(0, Number(order.progress || 0));
    const materialCount = overviewMaterialCount();
    const stage = String(result?.production?.stage || order.productionStage || order.status || 'received').toLowerCase();
    const fulfillment = String(
      result?.commerce?.fulfillmentStatus
        || order.displayFulfillmentStatus
        || order.fulfillmentStatus
        || 'UNFULFILLED'
    ).toUpperCase();
    const reasons = overviewAttentionReasons(order, result || order.canonicalDetail);
    const recommendation = overviewRecommendation({
      apparel: counts.apparel,
      progress,
      materialCount,
      fulfillment,
      reasons
    });
    const stageLabel = normalizedStageLabel(stage);

    setText('overview-stage-label', stageLabel, 'Received');
    setText('overview-command-title', recommendation.title, 'Review current production details');
    setText('overview-command-description', recommendation.description, 'Open the current production workspace.');
    const primaryAction = document.getElementById('overview-primary-action');
    if (primaryAction) {
      primaryAction.textContent = recommendation.action;
      primaryAction.dataset.overviewTarget = recommendation.target;
      if (recommendation.mobileAnchor) primaryAction.dataset.overviewMobileAnchor = recommendation.mobileAnchor;
      else delete primaryAction.dataset.overviewMobileAnchor;
    }

    setText('overview-order-state', stageLabel, 'Received');
    setText('overview-materials-state', `${materialCount} of ${checkboxIds.length} marked`);
    setText('overview-printing-state', `${progress} of ${counts.apparel} pieces`);
    setText('overview-fulfillment-state', normalizedStageLabel(fulfillment.toLowerCase()), 'Unfulfilled');
    setOverviewMilestone('overview-milestone-order', stage === 'completed' ? 'complete' : 'current');
    setOverviewMilestone(
      'overview-milestone-materials',
      materialCount === checkboxIds.length ? 'complete' : materialCount > 0 ? 'current' : 'pending'
    );
    setOverviewMilestone(
      'overview-milestone-printing',
      counts.apparel > 0 && progress >= counts.apparel ? 'complete' : progress > 0 || stage === 'print' ? 'current' : 'pending'
    );
    setOverviewMilestone(
      'overview-milestone-fulfillment',
      fulfillment === 'FULFILLED' ? 'complete' : fulfillment.includes('PARTIAL') ? 'current' : 'pending'
    );

    const updatedAt = result?.production?.updatedAt
      || order.canonicalDetail?.production?.updatedAt
      || result?.commerce?.updatedAt
      || order.shopifyUpdatedAt;
    const receivedAt = order.receivedAt || order.createdAt;
    setText(
      'overview-freshness',
      updatedAt ? `Updated ${formatDetailDate(updatedAt)}` : receivedAt ? `Received ${formatDetailDate(receivedAt)}` : 'Current detail loaded'
    );
    setText('overview-garment-count', counts.apparel);
    setText('overview-print-count', counts.prints);
    setText('overview-order-total', money(order.total, order.currencyCode), '$0.00');
    setText('overview-received-at', formatDetailDate(order.receivedAt || order.createdAt), '—');

    const attentionCount = document.getElementById('overview-attention-count');
    if (attentionCount) {
      attentionCount.textContent = `${reasons.length} open`;
      attentionCount.dataset.state = reasons.length ? 'attention' : 'clear';
    }
    const attentionList = document.getElementById('overview-attention-list');
    if (attentionList) {
      if (!reasons.length) {
        const empty = document.createElement('p');
        empty.className = 'detail-inline-empty';
        empty.textContent = 'No production attention reasons are currently recorded.';
        attentionList.replaceChildren(empty);
      } else {
        attentionList.replaceChildren(...reasons.map(reason => {
          const item = document.createElement('p');
          item.className = 'overview-attention-item';
          item.textContent = reason;
          return item;
        }));
      }
    }
  }

  function syncCanonicalProductionControls(order) {
    if (!order) return;
    const counts = itemCounts(order);
    order.totalApparel = counts.apparel;

    const progress = Math.max(0, Number(order.progress || 0));
    const progressText = document.getElementById('progress-text');
    const progressBar = document.getElementById('progress-bar');
    if (progressText) progressText.textContent = `${progress} / ${counts.apparel} pieces printed`;
    if (progressBar) {
      const percentage = counts.apparel ? Math.min(100, (progress / counts.apparel) * 100) : 0;
      progressBar.style.width = `${percentage}%`;
    }

    const canonicalValues = {
      'chk-blanks': Boolean(Number(order.blanksStatus || 0)),
      'chk-prints': Boolean(Number(order.printsStatus || 0)),
      'chk-blanks-ordered': Boolean(Number(order.blanksOrdered || 0)),
      'chk-prints-ordered': Boolean(Number(order.printsOrdered || 0))
    };
    Object.entries(canonicalValues).forEach(([id, checked]) => {
      const input = document.getElementById(id);
      if (input) input.checked = checked;
    });
    document.getElementById('ready-apply')?.classList.add('hidden');
    setReadyBaselines();
    syncReadyPendingState();
    syncProductionTimeline();
  }

  function orderContextParts(name) {
    const rawName = String(name || '').trim();
    if (typeof splitOrderName === 'function') {
      const [number = '', customer = ''] = splitOrderName(rawName);
      return {
        number: number || rawName || '-',
        customer: customer || ''
      };
    }
    const match = rawName.match(/^(.+?)\s+[–-]\s+(.+)$/);
    return {
      number: match ? match[1] : rawName || '-',
      customer: match ? match[2] : ''
    };
  }

  function operationalDetailCustomerName(order) {
    return String(
      order?.shippingAddress?.name
      || order?.billingAddress?.name
      || order?.customer?.displayName
      || orderContextParts(order?.name).customer
      || ''
    ).trim();
  }

  function formatContextDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  function cleanNoteValue(value) {
    const text = String(value || '').replace(/\r\n/g, '\n').trim();
    return text === 'No special instructions' ? '' : text;
  }

  function noteLineCount(text) {
    if (!text) return 0;
    return text.split('\n').filter(line => line.trim()).length || 1;
  }

  function syncCustomerContext(order) {
    if (!order) return;
    currentDetailOrder = order;
    const parts = orderContextParts(order.name);
    const counts = itemCounts(order);
    const orderNumber = document.getElementById('detail-context-order');
    const received = document.getElementById('detail-context-received');
    const items = document.getElementById('detail-context-items');

    if (orderNumber) {
      orderNumber.textContent = parts.number;
      orderNumber.title = String(order.name || parts.number);
    }
    if (received) {
      received.textContent = formatContextDate(order.receivedAt);
      received.title = order.receivedAt ? new Date(order.receivedAt).toLocaleString() : '';
    }
    if (items) {
      items.textContent = `${counts.apparel} garments / ${counts.prints} prints${counts.other ? ` / ${counts.other} other` : ''}`;
      items.title = `${counts.all} total line-item quantity`;
    }
  }

  function autoGrowNotesInput() {
    const input = document.getElementById('detail-notes-input');
    if (!input || input.classList.contains('hidden')) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 220)}px`;
  }

  function updateNotesPreview(text) {
    const preview = document.getElementById('detail-notes');
    if (!preview) return;
    preview.textContent = text || 'No special instructions';
    preview.classList.toggle('is-empty-note', !text);
    preview.title = text || '';
  }

  function syncNotesSummary(text) {
    const card = document.getElementById('detail-notes-wrapper');
    const summary = document.getElementById('detail-notes-summary');
    const hasNotes = Boolean(text);
    const lines = noteLineCount(text);

    if (card) {
      card.classList.toggle('has-notes', hasNotes);
      card.classList.toggle('is-empty-note-card', !hasNotes);
    }
    if (summary) {
      summary.textContent = hasNotes
        ? `${lines} ${lines === 1 ? 'line' : 'lines'} of instructions`
        : 'No notes';
    }
  }

  function detailOrderDraftKey(order) {
    return noteDraftStore.keyFor(order);
  }

  function rememberCurrentNotesDraft() {
    const input = document.getElementById('detail-notes-input');
    if (!input || !activeNotesOrderKey) return;
    const text = cleanNoteValue(input.value);
    noteDraftStore.remember(activeNotesOrderKey, text, savedNotesText);
  }

  function discardCurrentNotesDraft() {
    const input = document.getElementById('detail-notes-input');
    noteDraftStore.discard(activeNotesOrderKey);
    if (input) input.value = savedNotesText;
  }

  function syncNotesEditState() {
    const card = document.getElementById('detail-notes-wrapper');
    const input = document.getElementById('detail-notes-input');
    const status = document.getElementById('detail-notes-edit-status');
    const save = document.getElementById('detail-notes-save-btn');
    if (!card || !input) return;

    const currentText = cleanNoteValue(input.value);
    const hasUnsaved = currentText !== savedNotesText;
    if (activeNotesOrderKey) {
      noteDraftStore.remember(activeNotesOrderKey, currentText, savedNotesText);
    }
    card.classList.toggle('has-unsaved-notes', hasUnsaved);
    if (save) save.disabled = !hasUnsaved;
    if (status) {
      if (hasUnsaved) {
        status.textContent = card.classList.contains('is-editing-notes')
          ? 'Unsaved changes'
          : 'Unsaved draft for this order';
      }
      else if (currentText) status.textContent = `${noteLineCount(currentText)} ${noteLineCount(currentText) === 1 ? 'line' : 'lines'}`;
      else status.textContent = 'No changes';
    }
    autoGrowNotesInput();
  }

  function setNotesEditing(editing) {
    const card = document.getElementById('detail-notes-wrapper');
    const preview = document.querySelector('.detail-notes-preview');
    const input = document.getElementById('detail-notes-input');
    const edit = document.getElementById('detail-edit-notes-btn');
    if (!card || !preview || !input) return;

    card.classList.toggle('is-editing-notes', editing);
    preview.classList.toggle('hidden', editing);
    input.classList.toggle('hidden', !editing);
    if (edit) {
      edit.textContent = editing ? 'Editing' : 'Edit';
      edit.setAttribute('aria-pressed', editing ? 'true' : 'false');
    }

    if (editing) {
      input.value = noteDraftStore.read(activeNotesOrderKey)?.text ?? savedNotesText;
      requestAnimationFrame(() => {
        autoGrowNotesInput();
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      });
    } else {
      card.classList.remove('has-unsaved-notes', 'is-saving-notes');
      input.classList.add('hidden');
      preview.classList.remove('hidden');
    }
    syncNotesEditState();
  }

  function syncNotesContext(order) {
    const nextOrder = order || currentDetailOrder || (typeof detailOrder !== 'undefined' ? detailOrder : null);
    const nextOrderKey = detailOrderDraftKey(nextOrder);
    if (activeNotesOrderKey && nextOrderKey !== activeNotesOrderKey) rememberCurrentNotesDraft();
    if (order) currentDetailOrder = order;
    const activeOrder = order || currentDetailOrder || (typeof detailOrder !== 'undefined' ? detailOrder : null);
    const text = cleanNoteValue(activeOrder?.notes);
    const card = document.getElementById('detail-notes-wrapper');
    const input = document.getElementById('detail-notes-input');

    if (nextOrderKey !== activeNotesOrderKey) {
      activeNotesOrderKey = nextOrderKey;
      card?.classList.remove('is-editing-notes', 'is-saving-notes');
      document.querySelector('.detail-notes-preview')?.classList.remove('hidden');
      input?.classList.add('hidden');
      const edit = document.getElementById('detail-edit-notes-btn');
      if (edit) {
        edit.textContent = 'Edit';
        edit.setAttribute('aria-pressed', 'false');
      }
    }
    savedNotesText = text;
    const draft = noteDraftStore.read(activeNotesOrderKey);
    if (draft?.text === savedNotesText) noteDraftStore.discard(activeNotesOrderKey);
    updateNotesPreview(text);
    if (input) input.value = noteDraftStore.read(activeNotesOrderKey)?.text ?? text;
    syncNotesSummary(text);
    syncNotesEditState();
  }

  function updateStoredOrderNotes(order, notes) {
    if (!order) return;
    order.notes = notes;
    if (typeof detailOrder !== 'undefined' && detailOrder) detailOrder.notes = notes;
    if (typeof allOrders !== 'undefined' && Array.isArray(allOrders)) {
      const stored = allOrders.find(item => item.name === order.name);
      if (stored) stored.notes = notes;
    }
  }

  async function saveInlineNotes() {
    const card = document.getElementById('detail-notes-wrapper');
    const input = document.getElementById('detail-notes-input');
    const save = document.getElementById('detail-notes-save-btn');
    const order = currentDetailOrder || (typeof detailOrder !== 'undefined' ? detailOrder : null);
    if (!card || !input || !order) return;

    const nextNotes = cleanNoteValue(input.value);
    card.classList.add('is-saving-notes');
    if (save) save.disabled = true;
    try {
      await window.api.updateNotes(order.name, nextNotes);
      updateStoredOrderNotes(order, nextNotes);
      savedNotesText = nextNotes;
      noteDraftStore.discard(activeNotesOrderKey);
      updateNotesPreview(nextNotes);
      syncNotesSummary(nextNotes);
      setNotesEditing(false);
      card.classList.add('is-saved-notes');
      clearTimeout(notesSavedFlashTimer);
      notesSavedFlashTimer = setTimeout(() => card.classList.remove('is-saved-notes'), 900);
    } catch (error) {
      const status = document.getElementById('detail-notes-edit-status');
      card.classList.add('has-unsaved-notes');
      syncNotesEditState();
      if (status) status.textContent = `Could not save: ${error?.message || error}`;
    } finally {
      card.classList.remove('is-saving-notes');
    }
  }

  function wireCustomerNotesControls() {
    const edit = document.getElementById('detail-edit-notes-btn');
    const cancel = document.getElementById('detail-notes-cancel-btn');
    const save = document.getElementById('detail-notes-save-btn');
    const input = document.getElementById('detail-notes-input');

    if (edit && !edit.dataset.detailInlineNotesWired) {
      edit.dataset.detailInlineNotesWired = 'true';
      edit.addEventListener('click', event => {
        if (window.matchMedia('(max-width: 900px)').matches) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        syncNotesContext();
        setNotesEditing(true);
      }, true);
    }
    if (cancel && !cancel.dataset.detailInlineNotesWired) {
      cancel.dataset.detailInlineNotesWired = 'true';
      cancel.addEventListener('click', event => {
        event.preventDefault();
        discardCurrentNotesDraft();
        setNotesEditing(false);
        updateNotesPreview(savedNotesText);
        syncNotesSummary(savedNotesText);
      });
    }
    if (save && !save.dataset.detailInlineNotesWired) {
      save.dataset.detailInlineNotesWired = 'true';
      save.addEventListener('click', event => {
        event.preventDefault();
        saveInlineNotes();
      });
    }
    if (input && !input.dataset.detailInlineNotesWired) {
      input.dataset.detailInlineNotesWired = 'true';
      input.addEventListener('input', syncNotesEditState);
      input.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          rememberCurrentNotesDraft();
          setNotesEditing(false);
        }
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault();
          saveInlineNotes();
        }
      });
    }
  }

  function readyStateFromInputs() {
    const checked = checkboxIds.filter(id => document.getElementById(id)?.checked).length;
    if (checked === checkboxIds.length) return { label: 'Materials marked ready', state: 'ready' };
    if (checked > 0) return { label: `${checked} of 4 material milestones`, state: 'partial' };
    return { label: 'Materials not marked ready', state: 'missing' };
  }

  function syncReadySummary() {
    const state = readyStateFromInputs();
    syncProductionTimeline(state);
    if (currentDetailOrder) renderOverview(currentDetailOrder);
  }

  function syncProductionTimeline(readyState = readyStateFromInputs()) {
    if (!readyState || typeof readyState.label !== 'string') readyState = readyStateFromInputs();
    const card = document.getElementById('detail-production-card');
    const pill = document.getElementById('production-status-pill');
    const apply = document.getElementById('ready-apply');
    const completed = checkboxIds.filter(id => document.getElementById(id)?.checked).length;

    if (card) {
      card.dataset.readyState = readyState.state;
      card.classList.toggle('has-pending-ready', Boolean(apply && !apply.classList.contains('hidden')));
    }
    if (pill) {
      pill.textContent = readyState.label;
      pill.dataset.state = readyState.state;
      pill.title = `${completed} of ${checkboxIds.length} material readiness milestones marked`;
    }

    readinessSequences.forEach(sequence => {
      const orderedInput = document.getElementById(sequence.orderedId);
      const readyInput = document.getElementById(sequence.readyId);
      if (!orderedInput || !readyInput) return;

      const orderedStep = orderedInput.closest('.production-step');
      const readyStep = readyInput.closest('.production-step');
      const orderedComplete = orderedInput.checked;
      const readyComplete = readyInput.checked;
      const readyBlocked = !orderedComplete && !readyComplete;

      readyInput.disabled = readyBlocked;
      readyStep?.setAttribute('aria-disabled', String(readyBlocked));

      [
        {
          input: orderedInput,
          step: orderedStep,
          complete: orderedComplete,
          next: !orderedComplete,
          blocked: false,
          label: sequence.orderedLabel,
          stateText: orderedComplete ? 'Done' : 'Next'
        },
        {
          input: readyInput,
          step: readyStep,
          complete: readyComplete,
          next: orderedComplete && !readyComplete,
          blocked: readyBlocked,
          label: sequence.readyLabel,
          stateText: readyComplete ? 'Done' : readyBlocked ? 'Order first' : 'Next'
        }
      ].forEach(stepState => {
        if (!stepState.step) return;
        stepState.step.classList.remove('is-complete', 'is-next', 'is-waiting', 'is-blocked');
        stepState.step.classList.add(
          stepState.complete
            ? 'is-complete'
            : stepState.blocked
              ? 'is-blocked'
              : stepState.next
                ? 'is-next'
                : 'is-waiting'
        );
        stepState.step.dataset.state = stepState.complete
          ? 'done'
          : stepState.blocked
            ? 'blocked'
            : stepState.next
              ? 'next'
              : 'waiting';
        stepState.step.title = `${stepState.label}: ${stepState.stateText}`;
        stepState.input.setAttribute('aria-label', `${stepState.label}, ${stepState.stateText}`);
        const stateLabel = stepState.step.querySelector('.production-step-state');
        if (stateLabel) stateLabel.textContent = stepState.stateText;
      });
    });
  }

  function setReadyBaselines() {
    checkboxIds.forEach(id => {
      const input = document.getElementById(id);
      if (input) input.dataset.persistedChecked = String(input.checked);
    });
  }

  function pendingReadyCount() {
    return checkboxIds.filter(id => {
      const input = document.getElementById(id);
      return input && String(input.checked) !== input.dataset.persistedChecked;
    }).length;
  }

  function syncReadyPendingState() {
    const apply = document.getElementById('ready-apply');
    const status = document.getElementById('detail-save-status');
    const pending = pendingReadyCount();
    if (apply && !apply.dataset.saving) {
      apply.classList.toggle('hidden', pending === 0);
      apply.textContent = apply.dataset.retry === 'true'
        ? 'Retry saving statuses'
        : pending
          ? `Save ${pending} status ${pending === 1 ? 'change' : 'changes'}`
        : 'Save status changes';
    }
    if (status && !status.classList.contains('is-success') && !status.classList.contains('is-error')) {
      status.textContent = pending ? `${pending} unsaved ${pending === 1 ? 'change' : 'changes'}` : '';
    }
    syncReadySummary();
  }

  function enforceReadinessSequence(changedInput) {
    const sequence = readinessSequences.find(candidate =>
      candidate.orderedId === changedInput?.id || candidate.readyId === changedInput?.id
    );
    if (!sequence) return;
    const orderedInput = document.getElementById(sequence.orderedId);
    const readyInput = document.getElementById(sequence.readyId);
    if (!orderedInput || !readyInput) return;
    if (changedInput.id === sequence.orderedId && !orderedInput.checked && readyInput.checked) {
      readyInput.checked = false;
      const status = document.getElementById('detail-save-status');
      if (status) status.textContent = `${sequence.readyLabel} was cleared because ordering is required first.`;
    }
  }

  function wireReadyApplyFeedback() {
    const apply = document.getElementById('ready-apply');
    const status = document.getElementById('detail-save-status');
    if (!apply || typeof apply.onclick !== 'function' || apply.onclick.__detailFeedbackWrapped) return;
    const originalApply = apply.onclick;
    const wrappedApply = async function wrappedReadyApply(event) {
      if (apply.dataset.saving === 'true') return;
      apply.dataset.saving = 'true';
      apply.disabled = true;
      apply.textContent = 'Saving statuses...';
      status?.classList.remove('is-success', 'is-error');
      if (status) status.textContent = 'Saving production statuses...';
      try {
        await originalApply.call(this, event);
        delete apply.dataset.retry;
        setReadyBaselines();
        status?.classList.add('is-success');
        if (status) status.textContent = 'Production statuses saved.';
      } catch (error) {
        apply.dataset.retry = 'true';
        status?.classList.add('is-error');
        if (status) status.textContent = `Could not save statuses: ${error?.message || error}`;
      } finally {
        delete apply.dataset.saving;
        apply.disabled = false;
        syncReadyPendingState();
      }
    };
    wrappedApply.__detailFeedbackWrapped = true;
    apply.onclick = wrappedApply;
  }

  function wireProgressFeedback() {
    const button = document.getElementById('progress-plus1');
    if (!button) return;
    delete button.dataset.saving;
    button.removeAttribute('aria-busy');
  }

  function wireReadyApplyObserver() {
    const apply = document.getElementById('ready-apply');
    if (!apply || readyApplyObserver) return;

    readyApplyObserver = new MutationObserver(syncProductionTimeline);
    readyApplyObserver.observe(apply, {
      attributes: true,
      attributeFilter: ['class']
    });
    apply.addEventListener('click', () => {
      requestAnimationFrame(syncProductionTimeline);
      setTimeout(syncProductionTimeline, 300);
      setTimeout(syncProductionTimeline, 1000);
    });
  }

  function syncDetailHeader(order) {
    if (!order) return;
    const counts = itemCounts(order);
    const customer = document.getElementById('detail-header-customer');
    const pieces = document.getElementById('detail-header-pieces');
    const total = document.getElementById('detail-header-total');

    const customerName = operationalDetailCustomerName(order);
    if (customer) customer.textContent = customerName || 'No customer name';
    const recipient = document.getElementById('detail-cust-name');
    if (recipient && customerName) recipient.textContent = customerName;
    if (pieces) {
      pieces.textContent = `${counts.apparel} garments / ${counts.prints} prints${counts.other ? ` / ${counts.other} other` : ''}`;
      pieces.title = `${counts.all} total line-item quantity`;
    }
    if (total) total.textContent = money(order.total, order.currencyCode);
    setStatusBadge(
      document.getElementById('badge-financial'),
      order.displayFinancialStatus || order.financialStatus,
      'Payment pending'
    );
    setStatusBadge(
      document.getElementById('badge-fulfillment'),
      order.displayFulfillmentStatus || order.fulfillmentStatus,
      'Unfulfilled'
    );
    const productionCompleteBadge = document.getElementById('badge-production-complete');
    productionCompleteBadge?.classList.toggle('hidden', order.productionStage !== 'completed');
    syncCustomerContext(order);
    syncNotesContext(order);
    syncCommerceDetail(order);
    syncReadySummary();
    renderOverview(order);
  }

  function addressLines(address, fallbackName) {
    if (!address) return [];
    return [
      address.name || fallbackName,
      [address.address1, address.address2].filter(Boolean).join(' '),
      [address.city, address.provinceCode || address.province, address.zip].filter(Boolean).join(', '),
      address.country || address.countryCode
    ].filter(Boolean);
  }

  function syncCommerceDetail(order) {
    const noteBanner = document.getElementById('customer-checkout-note-banner');
    const noteText = document.getElementById('customer-checkout-note-text');
    const checkoutNote = String(order?.shopifyNote || '').trim();
    if (noteText) noteText.textContent = checkoutNote;
    noteBanner?.classList.toggle('hidden', !checkoutNote);

    const displayItems = typeof consolidateLineItemsForDisplay === 'function'
      ? consolidateLineItemsForDisplay(order?.items || [])
      : order?.items || [];
    const itemCount = displayItems.length;
    const itemsBadge = document.getElementById('tab-badge-items');
    if (itemsBadge) {
      itemsBadge.textContent = String(itemCount);
      itemsBadge.setAttribute('aria-label', `${itemCount} displayed ${itemCount === 1 ? 'line item' : 'line items'}`);
    }

    const customerName = document.getElementById('detail-cust-name')?.textContent?.trim() || '';
    const address = document.getElementById('logistics-address-text');
    if (address) {
      address.replaceChildren();
      const lines = addressLines(order?.shippingAddress, customerName);
      if (lines.length) {
        lines.forEach((line, index) => {
          const lineElement = document.createElement(index === 0 ? 'strong' : 'span');
          lineElement.textContent = line;
          address.appendChild(lineElement);
        });
      } else {
        const unavailable = document.createElement('span');
        unavailable.className = 'redacted-info-badge';
        unavailable.textContent = 'Customer data unavailable or redacted by Shopify';
        address.appendChild(unavailable);
      }
    }

    const tracking = document.getElementById('logistics-tracking-link');
    if (tracking) {
      tracking.replaceChildren();
      const trackingNumber = String(order?.trackingNumber || order?.tracking?.number || '').trim();
      const trackingUrl = String(order?.trackingUrl || order?.tracking?.url || '').trim();
      if (trackingUrl && /^https?:\/\//i.test(trackingUrl)) {
        const link = document.createElement('a');
        link.href = trackingUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = trackingNumber || 'Open tracking';
        tracking.appendChild(link);
      } else {
        tracking.textContent = trackingNumber || 'No tracking number';
      }
    }

    const email = document.getElementById('customer-email-val');
    const phone = document.getElementById('customer-phone-val');
    if (email) email.textContent = order?.email || 'Redacted or unavailable';
    if (phone) phone.textContent = order?.phone || 'Redacted or unavailable';
  }

  function wireReadyInputs() {
    checkboxIds.forEach(id => {
      const input = document.getElementById(id);
      if (!input || input.dataset.detailSummaryWired) return;
      input.dataset.detailSummaryWired = 'true';
      input.addEventListener('change', () => {
        const status = document.getElementById('detail-save-status');
        const apply = document.getElementById('ready-apply');
        if (apply) delete apply.dataset.retry;
        status?.classList.remove('is-success', 'is-error');
        enforceReadinessSequence(input);
        syncReadyPendingState();
      });
    });
    wireReadyApplyObserver();
    syncProductionTimeline();
  }

  function activateDetailTab(panelId, options = {}) {
    const tabs = Array.from(document.querySelectorAll('#detail-tabs-header .detail-tab-item'));
    const panels = Array.from(document.querySelectorAll('#detail-tab-panels .detail-tab-panel'));
    const targetTab = tabs.find(tab => tab.dataset.tab === panelId) || tabs[0];
    if (!targetTab) return;

    tabs.forEach(tab => {
      const active = tab === targetTab;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    panels.forEach(panel => {
      const active = panel.id === targetTab.dataset.tab;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
      panel.setAttribute('aria-hidden', String(!active));
    });
    targetTab.scrollIntoView?.({
      block: 'nearest',
      inline: 'nearest',
      behavior: options.focus && !window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 'smooth' : 'auto'
    });
    if (options.focus) targetTab.focus();
  }

  function wireDetailTabs() {
    const tablist = document.getElementById('detail-tabs-header');
    if (!tablist || detailTabControllerWired) return;
    detailTabControllerWired = true;
    tablist.addEventListener('click', event => {
      const tab = event.target.closest('.detail-tab-item');
      if (!tab || !tablist.contains(tab)) return;
      event.preventDefault();
      activateDetailTab(tab.dataset.tab);
    });
    tablist.addEventListener('keydown', event => {
      const tabs = Array.from(tablist.querySelectorAll('.detail-tab-item'));
      const current = event.target.closest('.detail-tab-item');
      const index = tabs.indexOf(current);
      if (index < 0) return;
      let nextIndex = index;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = tabs.length - 1;
      else return;
      event.preventDefault();
      activateDetailTab(tabs[nextIndex].dataset.tab, { focus: true });
    });
  }

  function wireOverview() {
    const overview = document.getElementById('tab-overview');
    if (overview && !overview.dataset.overviewWired) {
      overview.dataset.overviewWired = 'true';
      overview.addEventListener('click', event => {
        const action = event.target.closest('[data-overview-target]');
        if (!action || !overview.contains(action)) return;
        event.preventDefault();
        activateDetailTab(action.dataset.overviewTarget, { focus: true });
        const mobileAnchor = action.dataset.overviewMobileAnchor;
        if (mobileAnchor && window.matchMedia?.('(max-width: 900px)')?.matches) {
          requestAnimationFrame(() => {
            const target = document.getElementById(mobileAnchor);
            if (!target) return;
            target.scrollIntoView({
              block: 'start',
              behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 'auto' : 'smooth'
            });
            const focusTarget = target.querySelector('button:not([disabled]), input:not([disabled])');
            focusTarget?.focus({ preventScroll: true });
          });
        }
      });
    }
    const progressText = document.getElementById('progress-text');
    if (progressText && !overviewProgressObserver) {
      overviewProgressObserver = new MutationObserver(() => {
        if (currentDetailOrder) renderOverview(currentDetailOrder);
      });
      overviewProgressObserver.observe(progressText, {
        childList: true,
        characterData: true,
        subtree: true
      });
    }
  }

  function mockupThumbs() {
    return Array.from(document.querySelectorAll('#detail-mockups-track .mockup-thumb'));
  }

  function setMainMockupMessage(message) {
    const content = document.getElementById('detail-mockup-main-content');
    if (!content) return;
    content.innerHTML = '';
    const text = document.createElement('span');
    text.textContent = message;
    content.appendChild(text);
  }

  function setAssetViewerCaption(text) {
    const caption = document.getElementById('asset-viewer-caption');
    if (!caption) return;
    caption.textContent = text || '';
  }

  function assetLabelFromTarget(target) {
    const thumb = target?.closest?.('.mockup-thumb');
    if (thumb) {
      const thumbs = mockupThumbs();
      const index = thumbs.indexOf(thumb);
      return index >= 0 ? `Mockup ${index + 1} of ${thumbs.length}` : 'Mockup preview';
    }
    const designRow = target?.closest?.('.design-file-row, .design-tile');
    if (designRow) {
      return designRow.querySelector('.design-label')?.textContent?.trim() || 'Design file preview';
    }
    return '';
  }

  function fileNameParts(name) {
    const clean = String(name || '').trim();
    const match = clean.match(/\.([a-z0-9]{2,6})(?:$|\?)/i);
    return {
      name: clean,
      extension: match ? match[1].toUpperCase() : 'FILE'
    };
  }

  function designRows() {
    return Array.from(document.querySelectorAll('#detail-design-panel .design-file-row, #detail-design-panel .design-tile'));
  }

  function setDesignEmptyState() {
    const placeholder = document.getElementById('detail-designs-placeholder');
    if (!placeholder || placeholder.dataset.detailPolished) return;
    placeholder.dataset.detailPolished = 'true';
    placeholder.innerHTML = `
      <span class="design-empty-icon" aria-hidden="true"></span>
      <span class="design-empty-copy">
        <strong>No design files found</strong>
        <span>Files will appear here when synced or attached.</span>
      </span>
    `;
  }

  function ensurePreviewButton(row, labelButton, thumb, previewUrl, filename) {
    const actions = row.querySelector('.design-actions');
    if (!actions) return;
    const existing = actions.querySelector('.detail-asset-preview');
    if (existing) {
      existing.setAttribute('aria-label', `Preview ${filename}`);
      existing.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        setAssetViewerCaption(filename);
        if (typeof openAssetViewer === 'function') openAssetViewer(previewUrl);
      };
      return;
    }

    const previewButton = document.createElement('button');
    previewButton.type = 'button';
    previewButton.className = 'detail-asset-preview';
    previewButton.textContent = 'Preview';
    previewButton.setAttribute('aria-label', `Preview ${filename}`);
    previewButton.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      setAssetViewerCaption(filename);
      if (typeof openAssetViewer === 'function') openAssetViewer(previewUrl);
    };
    actions.prepend(previewButton);

    [labelButton, thumb].filter(Boolean).forEach(target => {
      target.setAttribute('aria-label', `Preview ${filename}`);
    });
  }

  function enhanceDesignFileRow(row) {
    if (!row) return;
    const firstPass = !row.dataset.detailDesignPolished;
    row.dataset.detailDesignPolished = 'true';

    const labelButton = row.querySelector('.design-label');
    const thumb = row.querySelector('.design-thumb');
    const image = thumb?.querySelector('img');
    const meta = row.querySelector('.design-file-meta');
    const type = row.querySelector('.design-print-type');
    const download = row.querySelector('.detail-asset-download');
    const status = row.querySelector('.detail-asset-status');
    const filename = labelButton?.textContent?.trim() || image?.alt || 'Design file';
    const parts = fileNameParts(filename);

    row.title = filename;
    row.dataset.fileExtension = parts.extension;
    row.classList.toggle('has-preview', Boolean(image?.src));

    if (labelButton && firstPass) {
      labelButton.title = filename;
      labelButton.addEventListener('click', () => setAssetViewerCaption(filename), true);
    }
    if (thumb && firstPass) {
      thumb.setAttribute('title', `Preview ${filename}`);
      thumb.addEventListener('click', () => setAssetViewerCaption(filename), true);
    }
    if (image) image.alt = `${filename} preview`;
    if (meta) meta.title = meta.textContent.trim();
    if (type) type.title = type.textContent.trim();
    if (download) {
      download.setAttribute('aria-label', `Download ${filename}`);
      download.title = `Download ${filename}`;
    }
    if (status) status.setAttribute('role', 'status');

    let extBadge = row.querySelector('.design-file-extension');
    if (!extBadge) {
      extBadge = document.createElement('span');
      extBadge.className = 'design-file-extension';
      (row.querySelector('.design-file-info') || meta || labelButton)?.appendChild(extBadge);
    }
    extBadge.textContent = parts.extension;
    extBadge.title = `${parts.extension} file`;

    const previewUrl = image?.src || image?.getAttribute('src') || '';
    if (previewUrl) ensurePreviewButton(row, labelButton, thumb, previewUrl, filename);
  }

  function enhanceDesignGroups() {
    const groups = [
      ['design-group-front', 'Front Prints'],
      ['design-group-back', 'Back Prints'],
      ['design-group-extras', 'Extras']
    ];

    groups.forEach(([id, label]) => {
      const group = document.getElementById(id);
      if (!group) return;
      const title = group.querySelector('.design-group-title');
      const rows = Array.from(group.querySelectorAll('.design-file-row, .design-tile'));
      const count = rows.length;
      const countLabel = group.querySelector('.design-group-count');
      group.dataset.fileCount = String(count);
      group.classList.toggle('has-files', count > 0);
      group.classList.toggle('is-empty', count === 0);
      if (countLabel) countLabel.textContent = String(count);
      if (title) {
        title.setAttribute('aria-label', `${label}, ${count} ${count === 1 ? 'file' : 'files'}`);
        title.title = `${label}: ${count} ${count === 1 ? 'file' : 'files'}`;
        if (title instanceof HTMLButtonElement && !title.dataset.detailGroupWired) {
          title.dataset.detailGroupWired = 'true';
          title.addEventListener('click', () => {
            const collapsed = group.classList.toggle('is-collapsed');
            title.setAttribute('aria-expanded', String(!collapsed));
          });
        }
      }
    });
  }

  function enhanceDesignFilesPanel() {
    setDesignEmptyState();
    const panel = document.getElementById('detail-design-panel');
    const rows = designRows();
    const count = document.getElementById('design-files-count');
    if (!panel) return;

    panel.classList.toggle('has-design-files', rows.length > 0);
    panel.classList.toggle('has-many-design-files', rows.length > 8);
    document.getElementById('detail-main-column')?.classList.toggle('has-many-design-files', rows.length > 8);
    if (count) {
      count.textContent = `${rows.length} ${rows.length === 1 ? 'file' : 'files'}`;
      count.title = `${rows.length} design ${rows.length === 1 ? 'file' : 'files'}`;
    }

    rows.forEach(enhanceDesignFileRow);
    enhanceDesignGroups();
  }

  function scheduleDesignFilesEnhancement() {
    if (designFilesEnhanceScheduled) return;
    designFilesEnhanceScheduled = true;
    requestAnimationFrame(() => {
      designFilesEnhanceScheduled = false;
      enhanceDesignFilesPanel();
    });
  }

  function wireDesignFilesPanel() {
    enhanceDesignFilesPanel();
    const panel = document.getElementById('detail-design-panel');
    if (!panel || designFilesObserver) return;

    designFilesObserver = new MutationObserver(scheduleDesignFilesEnhancement);
    designFilesObserver.observe(panel, {
      childList: true,
      subtree: true
    });
    setTimeout(scheduleDesignFilesEnhancement, 250);
    setTimeout(scheduleDesignFilesEnhancement, 1000);
  }

  function mockupItemSize(item) {
    const explicitSize = (item?.customAttributes || []).find(attribute =>
      /^(size|garment size)$/i.test(String(attribute?.key || '').trim())
    )?.value;
    if (explicitSize) return String(explicitSize).trim();
    const options = String(item?.variantTitle || '')
      .split('/')
      .map(value => value.trim())
      .filter(Boolean);
    return options.at(-1) || 'Size not specified';
  }

  function mockupItemArtworkScopeKey(item) {
    const product = String(item?.title || '').trim().toLowerCase();
    const explicitColor = (item?.customAttributes || []).find(attribute =>
      /^(color|colour|garment color|garment colour)$/i.test(String(attribute?.key || '').trim())
    )?.value;
    const variantParts = String(item?.variantTitle || '')
      .split('/')
      .map(value => value.trim())
      .filter(Boolean);
    const color = String(explicitColor || (variantParts.length > 1 ? variantParts[0] : ''))
      .trim()
      .toLowerCase();
    return product && color ? `${product}\u0000${color}` : '';
  }

  function renderSelectedMockupContext(thumb) {
    const context = document.getElementById('detail-mockup-context');
    if (!context) return;
    context.replaceChildren();
    context.classList.add('hidden');

    const order = currentDetailOrder;
    if (!order?._candidate) return;

    const linkedIds = new Set(String(thumb?.dataset?.lineItemIds || '')
      .split('|')
      .map(value => value.trim())
      .filter(Boolean));
    if (!linkedIds.size) {
      const label = document.createElement('span');
      label.className = 'detail-mockup-context-order-level';
      label.textContent = 'Order-level artwork · not linked to a specific garment';
      context.appendChild(label);
      context.classList.remove('hidden');
      return;
    }

    const linkedItems = (order.items || [])
      .filter(item => linkedIds.has(String(item?.id || '')));
    const artworkScopes = new Set(linkedItems
      .map(mockupItemArtworkScopeKey)
      .filter(Boolean));
    const groups = new Map();
    (order.items || [])
      .filter(item => {
        if (linkedIds.has(String(item?.id || ''))) return true;
        return artworkScopes.has(mockupItemArtworkScopeKey(item));
      })
      .forEach(item => {
        const product = String(item.title || 'Linked item').trim();
        const size = mockupItemSize(item);
        const key = `${product}\u0000${size}`;
        const current = groups.get(key) || { product, size, qty: 0 };
        current.qty += Number(item.qty) || 0;
        groups.set(key, current);
      });
    if (!groups.size) return;

    const heading = document.createElement('span');
    heading.className = 'detail-mockup-context-label';
    heading.textContent = 'Applies to';
    const list = document.createElement('div');
    list.className = 'detail-mockup-context-list';
    const productGroups = new Map();
    groups.forEach(group => {
      const entries = productGroups.get(group.product) || [];
      entries.push(group);
      productGroups.set(group.product, entries);
    });
    productGroups.forEach((entries, product) => {
      const group = document.createElement('div');
      group.className = 'detail-mockup-context-product';
      const productName = document.createElement('span');
      productName.className = 'detail-mockup-context-product-name';
      productName.textContent = product;
      const quantities = document.createElement('span');
      quantities.className = 'detail-mockup-context-quantities';
      entries.forEach(entry => {
        const quantity = document.createElement('span');
        quantity.className = 'detail-mockup-quantity';
        quantity.textContent = `${entry.size} × ${entry.qty}`;
        quantities.appendChild(quantity);
      });
      group.append(productName, quantities);
      list.appendChild(group);
    });
    context.append(heading, list);
    context.classList.remove('hidden');
  }

  function resetMockupFrame(mainButton = document.getElementById('detail-mockup-main')) {
    if (!mainButton) return;
    mainButton.style.removeProperty('width');
    mainButton.style.removeProperty('height');
    mainButton.style.removeProperty('aspect-ratio');
  }

  function sizeMockupFrame(image, mainButton = document.getElementById('detail-mockup-main')) {
    const isDesktopShopifyBoard = document.body?.dataset.orderSource === 'shopify'
      && window.matchMedia?.('(min-width: 901px)').matches;
    const naturalWidth = Number(image?.naturalWidth);
    const naturalHeight = Number(image?.naturalHeight);
    if (!mainButton || !isDesktopShopifyBoard || !naturalWidth || !naturalHeight) {
      resetMockupFrame(mainButton);
      return;
    }

    const feature = mainButton.closest('.detail-mockup-feature');
    const availableWidth = feature?.clientWidth || mainButton.parentElement?.clientWidth || 0;
    if (!availableWidth) return;

    const ratio = naturalWidth / naturalHeight;
    const maximumWorkingHeight = Math.min(400, Math.max(260, Math.round(window.innerHeight * 0.38)));
    const frameWidth = Math.round(Math.min(availableWidth, maximumWorkingHeight * ratio));
    const ratioValue = `${naturalWidth} / ${naturalHeight}`;
    const widthValue = `${frameWidth}px`;
    if (mainButton.style.width !== widthValue) mainButton.style.width = widthValue;
    if (mainButton.style.aspectRatio !== ratioValue) mainButton.style.aspectRatio = ratioValue;
    if (mainButton.style.height) mainButton.style.removeProperty('height');
  }

  function scheduleMockupFrameSize() {
    if (mockupFrameResizeScheduled) return;
    mockupFrameResizeScheduled = true;
    requestAnimationFrame(() => {
      mockupFrameResizeScheduled = false;
      const image = mockupThumbs()[selectedMockupIndex]?.querySelector('img');
      sizeMockupFrame(image);
    });
  }

  function wireMockupFrameSize() {
    const browser = document.querySelector('.detail-mockups-browser');
    if (!browser || mockupFrameResizeObserver || typeof ResizeObserver !== 'function') return;
    mockupFrameResizeObserver = new ResizeObserver(scheduleMockupFrameSize);
    mockupFrameResizeObserver.observe(browser);
  }

  function syncSelectedMockup(index = selectedMockupIndex) {
    const strip = document.getElementById('detail-mockups-strip');
    const feature = document.getElementById('detail-mockup-feature');
    const mainButton = document.getElementById('detail-mockup-main');
    const content = document.getElementById('detail-mockup-main-content');
    const count = document.getElementById('detail-mockup-count');
    const hint = document.getElementById('detail-mockup-hint');
    const thumbs = mockupThumbs();
    if (!feature || !mainButton || !content || !count) return;

    if (!thumbs.length) {
      selectedMockupIndex = 0;
      strip?.classList.add('no-mockups');
      strip?.classList.remove('has-mockups');
      feature.classList.add('hidden');
      count.textContent = '0 mockups';
      resetMockupFrame(mainButton);
      setMainMockupMessage('No mockup previews available');
      return;
    }

    selectedMockupIndex = Math.max(0, Math.min(index, thumbs.length - 1));
    strip?.classList.add('has-mockups');
    strip?.classList.remove('no-mockups');
    feature.classList.remove('hidden');
    count.textContent = `${selectedMockupIndex + 1} of ${thumbs.length} mockup${thumbs.length === 1 ? '' : 's'}`;
    if (hint) hint.textContent = 'Open full-size preview';

    thumbs.forEach((thumb, thumbIndex) => {
      const selected = thumbIndex === selectedMockupIndex;
      thumb.classList.toggle('is-selected', selected);
      thumb.tabIndex = selected ? 0 : -1;
      thumb.setAttribute('aria-selected', String(selected));
      thumb.setAttribute('role', 'option');
      thumb.setAttribute('aria-label', `Select mockup ${thumbIndex + 1}`);
    });

    const activeThumb = thumbs[selectedMockupIndex];
    const activeImg = activeThumb.querySelector('img');
    const activeStatus = activeThumb.querySelector('.detail-asset-status');
    content.innerHTML = '';

    if (activeImg?.src) {
      const img = activeImg.cloneNode(false);
      img.alt = activeImg.alt || `Mockup ${selectedMockupIndex + 1}`;
      img.addEventListener('load', () => sizeMockupFrame(img, mainButton), { once: true });
      content.appendChild(img);
      sizeMockupFrame(activeImg, mainButton);
      requestAnimationFrame(() => sizeMockupFrame(activeImg, mainButton));
    } else if (activeStatus) {
      resetMockupFrame(mainButton);
      setMainMockupMessage(activeStatus.textContent || 'Preview unavailable');
    } else {
      resetMockupFrame(mainButton);
      setMainMockupMessage('Loading preview...');
    }
    renderSelectedMockupContext(activeThumb);

    mainButton.onclick = () => {
      const currentThumb = mockupThumbs()[selectedMockupIndex];
      const currentImage = currentThumb?.querySelector('img');
      if (currentThumb && currentImage?.src) {
        setAssetViewerCaption(assetLabelFromTarget(currentThumb));
        if (typeof openAssetViewer === 'function') openAssetViewer(currentImage.src);
      }
    };
  }

  function wireMockupBrowser() {
    const track = document.getElementById('detail-mockups-track');
    if (!track) return;
    wireMockupFrameSize();
    track.setAttribute('role', 'listbox');
    track.setAttribute('aria-label', 'Available order mockups');

    if (!track.dataset.detailBrowserCaptureWired) {
      track.dataset.detailBrowserCaptureWired = 'true';
      track.addEventListener('click', event => {
        if (event.target?.closest?.('.manual-mockup-delete')) return;
        const thumb = event.target?.closest?.('.mockup-thumb');
        if (!thumb || !track.contains(thumb)) return;
        const index = mockupThumbs().indexOf(thumb);
        if (index < 0) return;
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
        selectedMockupIndex = index;
        syncSelectedMockup(index);
      }, true);
    }

    track.querySelectorAll('.mockup-thumb').forEach((thumb, index) => {
      thumb.querySelectorAll('.manual-mockup-delete').forEach(button => {
        button.setAttribute('aria-label', 'Remove mockup');
        button.setAttribute('title', 'Remove mockup');
      });
      if (!thumb.dataset.detailBrowserWired) {
        thumb.dataset.detailBrowserWired = 'true';
        thumb.addEventListener('keydown', event => {
          const thumbs = mockupThumbs();
          const currentIndex = thumbs.indexOf(thumb);
          let nextIndex = currentIndex;
          if (event.key === 'ArrowRight') nextIndex = Math.min(thumbs.length - 1, currentIndex + 1);
          else if (event.key === 'ArrowLeft') nextIndex = Math.max(0, currentIndex - 1);
          else if (event.key === 'Home') nextIndex = 0;
          else if (event.key === 'End') nextIndex = thumbs.length - 1;
          else if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          selectedMockupIndex = nextIndex;
          syncSelectedMockup(nextIndex);
          if (nextIndex !== currentIndex) thumbs[nextIndex]?.focus();
        });
      }
    });

    if (!mockupObserver) {
      mockupObserver = new MutationObserver(() => {
        wireMockupBrowser();
        syncSelectedMockup();
      });
      mockupObserver.observe(track, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'class']
      });
    }

    syncSelectedMockup();
  }

  function cellText(cell) {
    return cell?.textContent?.replace(/\s+/g, ' ').trim() || '';
  }

  function wrapCellText(cell, className) {
    if (!cell) return;
    cell.classList.add(className);
    const text = cellText(cell);
    if (text) cell.title = text;
    if (cell.querySelector('.detail-cell-copy') || cell.querySelector('.inline-accounting-pill')) return;

    cell.textContent = '';
    const copy = document.createElement('span');
    copy.className = 'detail-cell-copy';
    copy.textContent = text;
    cell.appendChild(copy);
  }

  function enhanceItemsTable(order) {
    const table = document.getElementById('detail-items');
    const wrapper = document.getElementById('detail-items-wrapper');
    const count = document.getElementById('detail-items-count');
    const body = table?.querySelector('tbody');
    if (!table || !body) return;

    const rows = Array.from(body.rows);
    const itemRows = rows.filter(row => row.cells.length >= 4);
    const quantity = order?.items
      ? order.items.reduce((total, item) => total + (Number(item.qty) || 0), 0)
      : itemRows.reduce((total, row) => total + (Number(cellText(row.cells[0])) || 0), 0);

    if (count) {
      const itemLabel = itemRows.length === 1 ? 'grouped item' : 'grouped items';
      const pieceLabel = quantity === 1 ? 'piece' : 'pieces';
      count.textContent = `${itemRows.length} ${itemLabel} · ${quantity} ${pieceLabel}`;
      count.title = 'Batch-split lines are combined by item, SKU, and variant';
    }

    wrapper?.classList.toggle('has-many-items', itemRows.length > 12);
    table.dataset.lineCount = String(itemRows.length);

    rows.forEach((row, index) => {
      const cells = row.cells;
      if (cells.length < 4) {
        row.classList.add('detail-item-attributes-row');
        return;
      }
      row.classList.add('detail-item-row');
      row.dataset.rowNumber = String(index + 1);
      ['Qty', 'Item', 'SKU', 'Variant', 'Current total'].forEach((label, cellIndex) => {
        if (!cells[cellIndex]) return;
        cells[cellIndex].dataset.label = label;
        cells[cellIndex].classList.add([
          'detail-item-qty-cell',
          'detail-item-description-cell',
          'detail-item-sku-cell',
          'detail-item-variant-cell',
          'detail-money-cell'
        ][cellIndex]);
      });
      wrapCellText(cells[1], 'detail-item-description-cell');
      wrapCellText(cells[2], 'detail-item-sku-cell');
      wrapCellText(cells[3], 'detail-item-variant-cell');

      const skuText = cellText(cells[2]);
      cells[2]?.classList.toggle('is-placeholder', !skuText || /^[–—-]$/.test(skuText));

      const description = cellText(cells[1]);
      const isPrint = typeof isPrintItem === 'function'
        ? isPrintItem({ title: description })
        : /print/i.test(description);
      const isGarment = typeof isGarmentItem === 'function'
        ? isGarmentItem({ title: description, sku: skuText })
        : !isPrint && Boolean(skuText && !/^[â€“â€”-]$/.test(skuText));
      row.classList.toggle('is-print-item', isPrint);
      row.classList.toggle('is-apparel-item', isGarment);
      row.classList.toggle('is-other-item', !isPrint && !isGarment);

      if (cells[0]) cells[0].title = `Quantity ${cellText(cells[0]) || '0'}`;
      if (cells[4]) cells[4].title = cellText(cells[4]);
    });
  }

  function wireItemsTable(order) {
    enhanceItemsTable(order);
    const body = document.querySelector('#detail-items tbody');
    if (!body || itemTableObserver) return;

    itemTableObserver = new MutationObserver(() => {
      const activeOrder = typeof detailOrder !== 'undefined' && detailOrder ? detailOrder : order;
      enhanceItemsTable(activeOrder);
    });
    itemTableObserver.observe(body, {
      childList: true,
      subtree: true
    });
  }

  function wireAssetViewerCaptions() {
    if (document.body?.dataset.detailCaptionWired) return;
    document.body.dataset.detailCaptionWired = 'true';
    document.addEventListener('click', event => {
      const label = assetLabelFromTarget(event.target);
      if (label) setAssetViewerCaption(label);
    }, true);
  }

  function patchAssetViewerClose() {
    const currentOpenAssetViewer = typeof openAssetViewer === 'function' ? openAssetViewer : window.openAssetViewer;
    if (typeof currentOpenAssetViewer === 'function' && !currentOpenAssetViewer.__detailOpenPatched) {
      const originalOpenAssetViewer = currentOpenAssetViewer;
      const enhancedOpenAssetViewer = function enhancedOpenAssetViewer(...args) {
        clearTimeout(assetViewerCloseTimer);
        const overlay = document.getElementById('asset-viewer');
        overlay?.classList.remove('asset-viewer-closing');
        return originalOpenAssetViewer.apply(this, args);
      };
      enhancedOpenAssetViewer.__detailOpenPatched = true;
      openAssetViewer = enhancedOpenAssetViewer;
      window.openAssetViewer = enhancedOpenAssetViewer;
    }

    const currentCloseAssetViewer = typeof closeAssetViewer === 'function' ? closeAssetViewer : window.closeAssetViewer;
    if (typeof currentCloseAssetViewer !== 'function' || currentCloseAssetViewer.__detailAnimatedClosePatched) return;
    const originalCloseAssetViewer = currentCloseAssetViewer;
    const animatedCloseAssetViewer = function animatedCloseAssetViewer(...args) {
      const overlay = document.getElementById('asset-viewer');
      if (!overlay || overlay.classList.contains('hidden')) {
        return originalCloseAssetViewer.apply(this, args);
      }

      clearTimeout(assetViewerCloseTimer);
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      if (reducedMotion) {
        return originalCloseAssetViewer.apply(this, args);
      }

      overlay.classList.add('asset-viewer-closing');
      assetViewerCloseTimer = setTimeout(() => {
        overlay.classList.remove('asset-viewer-closing');
        originalCloseAssetViewer.apply(this, args);
      }, 180);
      return undefined;
    };
    animatedCloseAssetViewer.__detailAnimatedClosePatched = true;
    closeAssetViewer = animatedCloseAssetViewer;
    window.closeAssetViewer = animatedCloseAssetViewer;
  }

  function invalidateCanonicalDetailLoad() {
    detailHydrationGeneration += 1;
    detailHydrationController?.abort();
    detailHydrationController = null;
  }

  function preserveNotesDraftForClose() {
    rememberCurrentNotesDraft();
    setNotesEditing(false);
    currentDetailOrder = null;
    activeNotesOrderKey = '';
  }

  function wireNotesCloseLifecycle() {
    const overlay = document.getElementById('detail-overlay');
    if (!overlay || overlay.dataset.notesCloseLifecycleWired) return;
    overlay.dataset.notesCloseLifecycleWired = 'true';
    overlay.addEventListener('click', event => {
      if (event.target === overlay || event.target.closest?.('#detail-close, #detail-close-btn')) {
        preserveNotesDraftForClose();
      }
    }, true);
  }

  function wireCanonicalDetailLifecycle() {
    const overlay = document.getElementById('detail-overlay');
    if (overlay && !overlay.dataset.canonicalLifecycleWired) {
      overlay.dataset.canonicalLifecycleWired = 'true';
      const observer = new MutationObserver(() => {
        const closed = !overlay.classList.contains('visible')
          || overlay.getAttribute('aria-hidden') === 'true';
        if (closed) {
          preserveNotesDraftForClose();
          invalidateCanonicalDetailLoad();
        }
      });
      observer.observe(overlay, {
        attributes: true,
        attributeFilter: ['class', 'aria-hidden']
      });
    }
    if (document.body && !document.body.dataset.canonicalSourceLifecycleWired) {
      document.body.dataset.canonicalSourceLifecycleWired = 'true';
      const sourceObserver = new MutationObserver(() => {
        if (document.body.dataset.orderSource !== 'shopify') invalidateCanonicalDetailLoad();
      });
      sourceObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ['data-order-source']
      });
    }
  }

  function patchDetailOpen() {
    const currentOpenDetail = typeof openDetail === 'function' ? openDetail : window.openDetail;
    if (typeof currentOpenDetail !== 'function' || currentOpenDetail.__detailSummaryPatched) return;
    const originalOpenDetail = currentOpenDetail;
    const enhancedOpenDetail = function enhancedOpenDetail(order, ...args) {
      const result = originalOpenDetail.call(this, order, ...args);
      const overlay = document.getElementById('detail-overlay');
      overlay?.setAttribute('aria-hidden', 'false');
      activateDetailTab('tab-overview');
      syncDetailHeader(order);
      wireCustomerNotesControls();
      wireReadyInputs();
      setReadyBaselines();
      syncReadyPendingState();
      wireReadyApplyFeedback();
      wireProgressFeedback();
      wireDetailTabs();
      wireOverview();
      wireAssetViewerCaptions();
      patchAssetViewerClose();
      wireItemsTable(order);
      wireDesignFilesPanel();
      wireCanonicalDetailLifecycle();
      wireNotesCloseLifecycle();
      requestAnimationFrame(wireMockupBrowser);
      requestAnimationFrame(() => enhanceItemsTable(order));
      requestAnimationFrame(scheduleDesignFilesEnhancement);
      setTimeout(scheduleDesignFilesEnhancement, 250);
      setTimeout(scheduleDesignFilesEnhancement, 1000);
      hydrateCanonicalDetail(order);
      return result;
    };
    enhancedOpenDetail.__detailSummaryPatched = true;
    openDetail = enhancedOpenDetail;
    window.openDetail = enhancedOpenDetail;
  }

  document.addEventListener('DOMContentLoaded', () => {
    patchDetailOpen();
    wireDetailTabs();
    wireOverview();
    wireCustomerNotesControls();
    wireReadyInputs();
    wireAssetViewerCaptions();
    patchAssetViewerClose();
    wireCanonicalDetailLifecycle();
    wireNotesCloseLifecycle();
    wireMockupBrowser();
    wireItemsTable();
    wireDesignFilesPanel();
  });

  patchDetailOpen();
  wireDetailTabs();
  wireOverview();
  wireCustomerNotesControls();
  wireAssetViewerCaptions();
  patchAssetViewerClose();
  wireCanonicalDetailLifecycle();
  wireNotesCloseLifecycle();
  wireItemsTable();
  wireDesignFilesPanel();
})();
