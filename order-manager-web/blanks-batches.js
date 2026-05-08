(() => {
  const MODULE_FLAG = '__printmoBlanksBatchFoundationLoaded';
  if (window[MODULE_FLAG]) return;
  window[MODULE_FLAG] = true;

  const PRINT_TITLE_FALLBACK = new Set([
    'T-shirt Breast Print',
    'T-shirt Chest Print',
    'T-shirt Full Print',
    'T-shirt Full Back Print',
    'T-shirt Half Back Print',
    'T-shirt Back Tag Print',
    'T-shirt Neck Tag Print',
    'T-shirt Sleeve Print',
    'Full Sleeve Print',
    'Half Sleeve Print',
    'Hood Print',
    'Sweatpants Small Logo Print',
    'Sweatpants Half Leg Print',
    'Sweatpants Full Leg Print',
    'Hat Front Print',
    'Hat Side Print',
    'Hat Back Print',
    'Drawstring Bag Full Print',
    'Drawstring Bag Small Print',
    'Tote Bag Small Print',
    'Tote Bag Half Print',
    'Tote Bag Full Print',
    'DTF Print'
  ]);

  let markOrderedInFlight = false;

  function currentOrders() {
    try {
      if (Array.isArray(allOrders)) return allOrders;
    } catch (error) {
      return [];
    }
    return [];
  }

  function isOrdered(order) {
    try {
      if (typeof isBlanksOrdered === 'function') return isBlanksOrdered(order);
    } catch (error) {
      // Fall through to direct field check.
    }
    return Boolean(Number(order?.blanksOrdered || 0));
  }

  function isPrintLineItem(item) {
    try {
      if (typeof isPrintItem === 'function') return isPrintItem(item);
    } catch (error) {
      // Fall through to the local title list.
    }
    return PRINT_TITLE_FALLBACK.has(item?.title);
  }

  function orderParts(orderName) {
    const [number, customer = ''] = String(orderName || '').split(' \u2013 ');
    return {
      number: number || String(orderName || ''),
      customer
    };
  }

  function cleanText(value) {
    return String(value ?? '').trim();
  }

  function lineItemPayload(item) {
    return {
      id: item?.id ?? '',
      lineItemId: item?.lineItemId ?? '',
      shopifyLineItemId: item?.shopifyLineItemId ?? '',
      admin_graphql_api_id: item?.admin_graphql_api_id ?? '',
      title: cleanText(item?.title || 'Untitled garment'),
      variantTitle: cleanText(item?.variantTitle),
      sku: cleanText(item?.sku),
      qty: Math.max(0, Number(item?.qty) || 0)
    };
  }

  function orderPayload(order) {
    const parts = orderParts(order?.name);
    const items = (Array.isArray(order?.items) ? order.items : [])
      .filter(item => item && !isPrintLineItem(item) && Number(item.qty) > 0)
      .map(lineItemPayload);

    return {
      name: cleanText(order?.name),
      orderNumber: parts.number,
      customer: parts.customer,
      receivedAt: cleanText(order?.receivedAt),
      items
    };
  }

  function buildBlanksBatchPayload(orders) {
    const cleanOrders = (Array.isArray(orders) ? orders : [])
      .map(orderPayload)
      .filter(order => order.name);
    const expectedGarments = cleanOrders.reduce((sum, order) => {
      return sum + order.items.reduce((itemSum, item) => itemSum + item.qty, 0);
    }, 0);

    return {
      source: 'mark-in-cart-ordered',
      expectedGarments,
      orders: cleanOrders
    };
  }

  function capturedOrdersAreMarked(capturedOrders) {
    const byName = new Map(currentOrders().map(order => [order.name, order]));
    return capturedOrders.every(order => {
      const current = byName.get(order.name);
      return current && current.status === 'blanks' && isOrdered(current);
    });
  }

  async function saveBatchForOrders(orders) {
    if (!window.api || typeof window.api.createBlanksBatch !== 'function') return null;

    const payload = buildBlanksBatchPayload(orders);
    if (!payload.orders.length || !payload.expectedGarments) return null;

    const result = await window.api.createBlanksBatch(payload);
    if (result?.batch?.id) {
      console.info(`Created blanks batch ${result.batch.id}`, result.batch);
    }
    return result;
  }

  function patchMarkInCartOrdered() {
    try {
      if (typeof markInCartBlanksOrdered !== 'function') return false;
      if (markInCartBlanksOrdered.__blanksBatchFoundationPatched) return true;

      const originalMarkInCartBlanksOrdered = markInCartBlanksOrdered;
      markInCartBlanksOrdered = async function patchedMarkInCartBlanksOrdered(...args) {
        if (markOrderedInFlight) return undefined;

        const candidateOrders = currentOrders()
          .filter(order => order?.status === 'blanks' && !isOrdered(order));

        markOrderedInFlight = true;
        let result;
        try {
          result = await originalMarkInCartBlanksOrdered.apply(this, args);
        } finally {
          markOrderedInFlight = false;
        }

        if (!candidateOrders.length || !capturedOrdersAreMarked(candidateOrders)) {
          return result;
        }

        try {
          await saveBatchForOrders(candidateOrders);
        } catch (error) {
          console.error('Unable to create blanks batch manifest', error);
          alert(`Orders were marked ordered, but the S&S batch manifest was not saved: ${error?.message || error}`);
        }

        return result;
      };
      markInCartBlanksOrdered.__blanksBatchFoundationPatched = true;
      return true;
    } catch (error) {
      console.warn('Unable to patch Mark In Cart Ordered for blanks batch creation', error);
      return false;
    }
  }

  window.blanksBatchFoundation = {
    buildPayload: buildBlanksBatchPayload,
    saveBatchForOrders
  };

  if (!patchMarkInCartOrdered()) {
    document.addEventListener('DOMContentLoaded', patchMarkInCartOrdered, { once: true });
  }
})();
