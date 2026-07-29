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
  let batchIndex = [];
  let activeBatch = null;
  let draftReceived = new Map();
  let dirty = false;
  const batchDetailsById = new Map();
  const orderAccountingByName = new Map();
  let accountingHydratePromise = null;
  let detailAccountingOrderName = '';
  let activeBlanksView = 'cart';
  let activeSuppliesView = 'cart';
  let suppliesHoverTimer = null;

  function currentOrders() {
    try {
      if (Array.isArray(allOrders)) return allOrders;
    } catch (error) {
      return [];
    }
    return [];
  }

  function isShopifyBoard() {
    return document.body?.dataset.orderSource === 'shopify';
  }

  function syncBlanksViewUi() {
    if (!isShopifyBoard()) return;
    const blanksOrders = currentOrders().filter(order => (order.status || 'received') === 'blanks');
    const cartCount = blanksOrders.filter(order => !isOrdered(order)).length;
    const orderedCount = blanksOrders.length - cartCount;
    const section = document.getElementById('blanks-section');
    if (section) section.dataset.blanksView = activeBlanksView;
    [
      ['blanks-view-cart', 'cart'],
      ['blanks-view-ordered', 'ordered'],
      ['supplies-view-cart', 'cart'],
      ['supplies-view-ordered', 'ordered']
    ].forEach(([id, view]) => {
      const button = document.getElementById(id);
      const selected = view === activeBlanksView;
      button?.classList.toggle('active', selected);
      button?.setAttribute('aria-selected', selected ? 'true' : 'false');
      button?.setAttribute('tabindex', selected ? '0' : '-1');
    });
    const cart = document.getElementById('blanks-cart-count');
    const ordered = document.getElementById('blanks-ordered-count');
    const suppliesCart = document.getElementById('supplies-cart-count');
    const suppliesOrdered = document.getElementById('supplies-ordered-count');
    const total = document.getElementById('count-blanks');
    if (cart) cart.textContent = String(cartCount);
    if (ordered) ordered.textContent = String(orderedCount);
    if (suppliesCart) suppliesCart.textContent = String(cartCount);
    if (suppliesOrdered) suppliesOrdered.textContent = String(orderedCount);
    if (total) total.textContent = String(blanksOrders.length);
    syncSuppliesLayout();
  }

  window.setActiveBlanksView = function setActiveBlanksView(view, { render = true } = {}) {
    if (!isShopifyBoard()) return;
    activeBlanksView = view === 'ordered' ? 'ordered' : 'cart';
    activeSuppliesView = activeBlanksView;
    syncBlanksViewUi();
    if (render && typeof renderStatusColumn === 'function') renderStatusColumn('blanks');
  };

  function isSuppliesDesktop() {
    return isShopifyBoard() && window.matchMedia('(min-width: 901px)').matches;
  }

  function syncSuppliesLayout() {
    const panel = document.querySelector('.panel.create');
    const createBody = panel?.querySelector('.create-body');
    const blanksSection = document.getElementById('blanks-section');
    const fulfillmentBody = document.querySelector('.panel.fulfillment > .panel-body');
    const printSection = document.getElementById('print-section');
    if (!panel || !createBody || !blanksSection || !fulfillmentBody || !printSection) return;

    const desktopSupplies = isSuppliesDesktop();
    if (desktopSupplies && blanksSection.parentElement !== panel) {
      panel.appendChild(blanksSection);
    } else if (!desktopSupplies && blanksSection.parentElement !== fulfillmentBody) {
      fulfillmentBody.insertBefore(blanksSection, printSection);
    }

    panel.classList.toggle('supplies-desktop-active', desktopSupplies);
    panel.dataset.suppliesView = desktopSupplies ? activeSuppliesView : '';
    createBody.hidden = desktopSupplies && activeSuppliesView !== 'build';
    blanksSection.hidden = desktopSupplies && activeSuppliesView === 'build';
    createBody.setAttribute('aria-hidden', createBody.hidden ? 'true' : 'false');
    blanksSection.setAttribute('aria-hidden', blanksSection.hidden ? 'true' : 'false');
    blanksSection.setAttribute('aria-labelledby', activeSuppliesView === 'ordered'
      ? 'supplies-view-ordered'
      : 'supplies-view-cart');

    [
      ['supplies-view-build', 'build'],
      ['supplies-view-cart', 'cart'],
      ['supplies-view-ordered', 'ordered']
    ].forEach(([id, view]) => {
      const button = document.getElementById(id);
      if (!button) return;
      const selected = desktopSupplies && view === activeSuppliesView;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.tabIndex = selected ? 0 : -1;
    });
  }

  function setActiveSuppliesView(view) {
    if (!isSuppliesDesktop()) return;
    const nextView = ['build', 'cart', 'ordered'].includes(view) ? view : 'cart';
    if (nextView === 'cart' || nextView === 'ordered') {
      window.setActiveBlanksView(nextView);
      return;
    }
    activeSuppliesView = 'build';
    syncSuppliesLayout();
  }

  function draggedFromPipeline() {
    return Boolean(document.querySelector('#col-received .card.dragging, #col-received .bundle-card.dragging'));
  }

  function setupSuppliesTabs() {
    const panel = document.querySelector('.panel.create');
    if (!panel || panel.dataset.suppliesTabsReady === '1') return;
    panel.dataset.suppliesTabsReady = '1';

    const views = ['build', 'cart', 'ordered'];
    views.forEach((view, index) => {
      const button = document.getElementById(`supplies-view-${view}`);
      if (!button) return;
      button.addEventListener('click', () => setActiveSuppliesView(view));
      button.addEventListener('keydown', event => {
        if (!isSuppliesDesktop() || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        let nextIndex = index;
        if (event.key === 'ArrowLeft') nextIndex = (index + views.length - 1) % views.length;
        if (event.key === 'ArrowRight') nextIndex = (index + 1) % views.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = views.length - 1;
        const nextView = views[nextIndex];
        setActiveSuppliesView(nextView);
        document.getElementById(`supplies-view-${nextView}`)?.focus();
      });
      if (view === 'cart' || view === 'ordered') {
        button.addEventListener('dragover', event => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          button.classList.add('drag-over');
        });
        button.addEventListener('dragleave', () => button.classList.remove('drag-over'));
        button.addEventListener('drop', async event => {
          event.preventDefault();
          button.classList.remove('drag-over');
          document.body.classList.remove('dragging-cursor');
          document.querySelectorAll('.dragging').forEach(card => card.classList.remove('dragging'));
          try {
            await handleBatchAwareDrop(event.dataTransfer.getData('text/plain'), 'blanks', {
              blanksOrdered: view === 'ordered' ? 1 : 0,
              activateBlanksView: view
            });
          } catch (error) {
            console.error('Unable to move order to Supplies view', error);
            showMoveNotice(`Could not move order. ${error?.message || error}`);
          }
        });
      }
    });

    const activateBuildFromPipeline = () => {
      if (!isSuppliesDesktop() || !draggedFromPipeline() || activeSuppliesView === 'build') return;
      window.clearTimeout(suppliesHoverTimer);
      suppliesHoverTimer = window.setTimeout(() => setActiveSuppliesView('build'), 180);
    };
    panel.addEventListener('dragenter', activateBuildFromPipeline);
    panel.addEventListener('dragover', activateBuildFromPipeline);
    panel.addEventListener('dragleave', event => {
      if (event.relatedTarget instanceof Node && panel.contains(event.relatedTarget)) return;
      window.clearTimeout(suppliesHoverTimer);
    });
    document.addEventListener('dragend', () => window.clearTimeout(suppliesHoverTimer));

    const desktopQuery = window.matchMedia('(min-width: 901px)');
    desktopQuery.addEventListener('change', syncSuppliesLayout);
    const sourceObserver = new MutationObserver(syncSuppliesLayout);
    sourceObserver.observe(document.body, { attributes: true, attributeFilter: ['data-order-source'] });
    syncSuppliesLayout();
  }

  window.blanksOrderedValueForActiveView = function blanksOrderedValueForActiveView() {
    return isShopifyBoard() && activeBlanksView === 'ordered' ? 1 : 0;
  };

  function patchBlanksColumnView() {
    try {
      if (typeof renderStatusColumn !== 'function' || renderStatusColumn.__shopifyBlanksViewPatched) return true;
      const original = renderStatusColumn;
      renderStatusColumn = function renderFilteredBlanksColumn(status) {
        if (!isShopifyBoard() || status !== 'blanks') return original(status);
        const fullOrders = allOrders;
        allOrders = fullOrders.filter(order => {
          if ((order.status || 'received') !== 'blanks') return true;
          return activeBlanksView === 'ordered' ? isOrdered(order) : !isOrdered(order);
        });
        try {
          return original(status);
        } finally {
          allOrders = fullOrders;
          syncBlanksViewUi();
        }
      };
      renderStatusColumn.__shopifyBlanksViewPatched = true;
      return true;
    } catch (error) {
      console.warn('Unable to install Shopify blanks view filter', error);
      return false;
    }
  }

  function showMoveNotice(message, tone = 'error') {
    let notice = document.getElementById('order-move-toast');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'order-move-toast';
      notice.className = 'order-move-toast';
      notice.setAttribute('role', 'status');
      notice.setAttribute('aria-live', 'polite');
      document.body.appendChild(notice);
    }
    notice.textContent = message;
    notice.dataset.tone = tone;
    notice.classList.add('visible');
    window.clearTimeout(showMoveNotice.timer);
    showMoveNotice.timer = window.setTimeout(() => notice.classList.remove('visible'), 4200);
  }

  window.applyOptimisticOrderUpdate = async function applyOptimisticOrderUpdate(
    orderNames,
    patch,
    persist,
    failureLabel = 'Could not save order change'
  ) {
    if (!isShopifyBoard()) {
      await persist(orderNames);
      if (typeof renderBoard === 'function') await renderBoard();
      return true;
    }
    const names = new Set(orderNames || []);
    const snapshots = new Map(currentOrders()
      .filter(order => names.has(order.name))
      .map(order => [order.name, {
        status: order.status,
        blanksOrdered: order.blanksOrdered,
        blanksStatus: order.blanksStatus,
        printsStatus: order.printsStatus,
        printsOrdered: order.printsOrdered
      }]));
    const touched = typeof patchLocalOrders === 'function'
      ? patchLocalOrders(orderNames, patch)
      : new Set(['received', 'toOrder', 'blanks', 'print']);
    if (typeof renderBoardFromLocalState === 'function') {
      await renderBoardFromLocalState(touched);
    } else if (typeof renderBoard === 'function') {
      await renderBoard();
    }
    try {
      await persist(orderNames);
      showMoveNotice('Order updated', 'success');
      return true;
    } catch (error) {
      if (typeof patchLocalOrders === 'function') {
        patchLocalOrders(orderNames, order => snapshots.get(order.name) || {});
      }
      if (typeof renderBoardFromLocalState === 'function') {
        await renderBoardFromLocalState(touched);
      } else if (typeof renderBoard === 'function') {
        await renderBoard();
      }
      showMoveNotice(`${failureLabel}. The card was restored. ${error?.message || error}`);
      throw error;
    }
  };

  function isOrdered(order) {
    if (isShopifyBoard() && order?.productionStage) {
      return order.productionStage === 'blanks_ordered';
    }
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

  async function saveBatchForOrders(orders) {
    if (!window.api || typeof window.api.createBlanksBatch !== 'function') return null;

    const payload = buildBlanksBatchPayload(orders);
    if (!payload.orders.length || !payload.expectedGarments) return null;

    const result = await window.api.createBlanksBatch(payload);
    if (result?.batch?.id) {
      batchDetailsById.set(result.batch.id, result.batch);
      buildOrderAccounting();
      annotateAccountingCards();
      console.info(`Created blanks batch ${result.batch.id}`, result.batch);
    }
    return result;
  }

  function visibleOrderNames() {
    return new Set(currentOrders().map(order => order?.name).filter(Boolean));
  }

  function batchTouchesVisibleOrders(batch, orderNames = visibleOrderNames()) {
    const names = Array.isArray(batch?.orderNames) ? batch.orderNames : [];
    return names.some(name => orderNames.has(name));
  }

  async function hydrateAccountingForCurrentOrders(options = {}) {
    const { force = false } = options;
    if (!window.api || typeof window.api.listBlanksBatches !== 'function' || typeof window.api.getBlanksBatch !== 'function') return;
    if (accountingHydratePromise && !force) return accountingHydratePromise;

    accountingHydratePromise = (async () => {
      await loadBatchIndex();
      const orderNames = visibleOrderNames();
      const relevant = batchIndex.filter(batch => batchTouchesVisibleOrders(batch, orderNames));

      await Promise.all(relevant.map(async batch => {
        const cached = batchDetailsById.get(batch.id);
        if (!force && cached?.updatedAt && cached.updatedAt === batch.updatedAt) return;
        const data = await window.api.getBlanksBatch(batch.id);
        if (data?.batch?.id) batchDetailsById.set(data.batch.id, data.batch);
      }));

      buildOrderAccounting();
      annotateAccountingCards();
      renderDetailAccounting(detailAccountingOrderName || currentDetailOrderName());
    })().catch(error => {
      console.warn('Unable to hydrate blanks batch accounting', error);
    }).finally(() => {
      accountingHydratePromise = null;
    });

    return accountingHydratePromise;
  }

  function buildOrderAccounting() {
    orderAccountingByName.clear();
    batchDetailsById.forEach(batch => {
      const batchLabel = batch.label || batch.id;
      const orderSummary = new Map((batch.orders || []).map(order => [order.name, order]));

      (batch.manifest || []).forEach(line => {
        (line.orderLines || []).forEach(orderLine => {
          const orderName = orderLine.orderName;
          if (!orderName) return;
          if (!orderAccountingByName.has(orderName)) {
            const summary = orderSummary.get(orderName) || {};
            orderAccountingByName.set(orderName, {
              orderName,
              expectedGarments: Number(summary.garmentCount) || 0,
              accountedGarments: Number(summary.accountedGarments) || 0,
              missingGarments: Number(summary.missingGarments) || 0,
              fullyAccounted: Boolean(summary.fullyAccounted),
              batches: new Map(),
              lines: []
            });
          }

          const accounting = orderAccountingByName.get(orderName);
          accounting.batches.set(batch.id, batchLabel);
          accounting.lines.push({
            batchId: batch.id,
            batchLabel,
            itemKey: line.itemKey,
            lineId: orderLine.lineId,
            title: orderLine.title || line.title || 'Untitled garment',
            variantTitle: orderLine.variantTitle || line.variantTitle || '',
            sku: orderLine.sku || line.sku || '',
            expectedQty: Number(orderLine.expectedQty) || 0,
            accountedQty: Number(orderLine.accountedQty) || 0
          });
        });
      });
    });

    orderAccountingByName.forEach(accounting => {
      const expected = accounting.lines.reduce((sum, line) => sum + line.expectedQty, 0);
      const accounted = accounting.lines.reduce((sum, line) => sum + line.accountedQty, 0);
      accounting.expectedGarments = expected;
      accounting.accountedGarments = Math.min(expected, accounted);
      accounting.missingGarments = Math.max(0, expected - accounting.accountedGarments);
      accounting.fullyAccounted = expected > 0 && accounting.missingGarments === 0;
    });
  }

  function accountingForOrder(orderName) {
    return orderAccountingByName.get(orderName) || null;
  }

  function currentDetailOrderName() {
    try {
      if (detailOrder?.name) return detailOrder.name;
    } catch (error) {
      return '';
    }
    return '';
  }

  function patchRenderBoardForAccounting() {
    try {
      if (typeof renderBoard !== 'function' || renderBoard.__blanksBatchAccountingPatched) return;
      const originalRenderBoard = renderBoard;
      renderBoard = async function patchedRenderBoard(...args) {
        const result = await originalRenderBoard.apply(this, args);
        hydrateAccountingForCurrentOrders().catch(error => {
          console.warn('Unable to update blanks accounting after board render', error);
        });
        return result;
      };
      renderBoard.__blanksBatchAccountingPatched = true;
    } catch (error) {
      console.warn('Unable to patch board render for blanks accounting', error);
    }
  }

  function patchOpenDetailForAccounting() {
    try {
      if (typeof openDetail !== 'function' || openDetail.__blanksBatchAccountingPatched) return;
      const originalOpenDetail = openDetail;
      openDetail = function patchedOpenDetail(order, ...args) {
        detailAccountingOrderName = order?.name || '';
        const result = originalOpenDetail.call(this, order, ...args);
        renderDetailAccounting(detailAccountingOrderName);
        hydrateAccountingForCurrentOrders().catch(error => {
          console.warn('Unable to update blanks accounting for detail', error);
        });
        return result;
      };
      openDetail.__blanksBatchAccountingPatched = true;
    } catch (error) {
      console.warn('Unable to patch order detail for blanks accounting', error);
    }
  }

  function annotateAccountingCards() {
    document.querySelectorAll('#col-blanks .card[data-order-id], #col-print .card[data-order-id]').forEach(card => {
      const orderName = card.dataset.orderId;
      const accounting = accountingForOrder(orderName);
      upsertAccountingChip(card, accounting);
    });

    document.querySelectorAll('#col-blanks .bundle-card[data-bundle-name], #col-print .bundle-card[data-bundle-name]').forEach(card => {
      const accounting = accountingForBundle(card.dataset.bundleName);
      upsertAccountingChip(card, accounting);
    });
  }

  function accountingForBundle(bundleName) {
    const orders = currentOrders().filter(order => order?.bundle === bundleName);
    const entries = orders.map(order => accountingForOrder(order.name)).filter(Boolean);
    if (!entries.length) return null;

    const expectedGarments = entries.reduce((sum, entry) => sum + entry.expectedGarments, 0);
    const accountedGarments = entries.reduce((sum, entry) => sum + entry.accountedGarments, 0);
    const missingGarments = Math.max(0, expectedGarments - accountedGarments);
    return {
      expectedGarments,
      accountedGarments,
      missingGarments,
      fullyAccounted: expectedGarments > 0 && missingGarments === 0
    };
  }

  function upsertAccountingChip(card, accounting) {
    const existing = card.querySelector('.blanks-accounting-chip');
    if (!accounting || !accounting.expectedGarments) {
      existing?.remove();
      card.classList.remove('supplies-accounted', 'supplies-missing');
      return;
    }

    const chip = existing || document.createElement('span');
    chip.className = `blanks-accounting-chip ${accounting.fullyAccounted ? 'is-complete' : 'is-missing'}`;
    chip.textContent = accounting.fullyAccounted
      ? 'Garments accounted'
      : `Supplies ${accounting.accountedGarments}/${accounting.expectedGarments}`;
    chip.title = accounting.fullyAccounted
      ? 'All garments are accounted for in the S&S batch'
      : `${accounting.missingGarments} garment${accounting.missingGarments === 1 ? '' : 's'} still missing`;

    const body = card.querySelector('.compact-body') || card.querySelector('.card-body') || card;
    const anchor = body.querySelector('.card-status-badge');
    if (!existing) {
      if (anchor?.nextSibling) body.insertBefore(chip, anchor.nextSibling);
      else if (anchor) body.appendChild(chip);
      else body.insertBefore(chip, body.firstChild);
    }
    card.classList.toggle('supplies-accounted', accounting.fullyAccounted);
    card.classList.toggle('supplies-missing', !accounting.fullyAccounted);
  }

  function renderDetailAccounting(orderName) {
    // Clean up the old standalone panel if it still exists in the DOM.
    const oldPanel = document.getElementById('detail-blanks-accounting-section');
    if (oldPanel) oldPanel.remove();

    detailAccountingOrderName = orderName || detailAccountingOrderName || currentDetailOrderName();
    const accounting = accountingForOrder(detailAccountingOrderName);
    const itemsSection = document.getElementById('detail-items-section');
    if (!itemsSection) return;

    // --- Receive Batch button in the Items in Order header ---
    let receiveBatchBtn = document.getElementById('detail-inline-receive-batch-btn');
    if (!accounting || !accounting.expectedGarments || !accounting.batches.size) {
      if (receiveBatchBtn) receiveBatchBtn.remove();
    } else {
      if (!receiveBatchBtn) {
        receiveBatchBtn = document.createElement('button');
        receiveBatchBtn.id = 'detail-inline-receive-batch-btn';
        receiveBatchBtn.className = 'fullscreen-btn';
        receiveBatchBtn.type = 'button';
        receiveBatchBtn.addEventListener('click', () => {
          openBatchForOrder(detailAccountingOrderName || currentDetailOrderName()).catch(error => {
            console.error('Unable to open accounting batch', error);
            alert(`Could not open batch: ${error?.message || error}`);
          });
        });
      }
      receiveBatchBtn.textContent = accounting.batches.size > 1 ? 'Receive Batches' : 'Receive Batch';
      const h4 = itemsSection.querySelector('h4');
      if (h4 && receiveBatchBtn.parentElement !== h4.parentElement) {
        // Wrap header in a flex row if not already wrapped
        let headerRow = itemsSection.querySelector('.detail-items-header-row');
        if (!headerRow) {
          headerRow = document.createElement('div');
          headerRow.className = 'detail-items-header-row';
          h4.parentNode.insertBefore(headerRow, h4);
          headerRow.appendChild(h4);
        }
        headerRow.appendChild(receiveBatchBtn);
      }
    }

    // --- Compact accounting summary chip under header ---
    let summaryChip = itemsSection.querySelector('.inline-accounting-summary');
    if (!accounting || !accounting.expectedGarments) {
      if (summaryChip) summaryChip.remove();
    } else {
      if (!summaryChip) {
        summaryChip = document.createElement('div');
        summaryChip.className = 'inline-accounting-summary';
        const headerRow = itemsSection.querySelector('.detail-items-header-row') || itemsSection.querySelector('h4');
        if (headerRow?.nextSibling) {
          headerRow.parentNode.insertBefore(summaryChip, headerRow.nextSibling);
        } else {
          itemsSection.insertBefore(summaryChip, itemsSection.querySelector('#detail-items-wrapper'));
        }
      }
      const statusClass = accounting.fullyAccounted ? 'is-complete' : 'is-missing';
      summaryChip.className = `inline-accounting-summary ${statusClass}`;
      summaryChip.textContent = accounting.fullyAccounted
        ? `✓ ${accounting.accountedGarments}/${accounting.expectedGarments} garments accounted`
        : `${accounting.accountedGarments}/${accounting.expectedGarments} accounted · ${accounting.missingGarments} missing`;
    }

    // --- Inject accounting pills into each item row ---
    const tbody = document.querySelector('#detail-items tbody');
    if (!tbody) return;

    // Remove any previously injected pills
    tbody.querySelectorAll('.inline-accounting-pill').forEach(el => el.remove());

    if (!accounting || !accounting.expectedGarments) return;

    // Build a lookup map from the accounting lines keyed by title + variant
    const accountingByKey = new Map();
    accounting.lines.forEach(line => {
      const key = `${(line.title || '').trim().toLowerCase()}||${(line.variantTitle || '').trim().toLowerCase()}`;
      // Aggregate in case multiple batch lines map to same item
      if (accountingByKey.has(key)) {
        const existing = accountingByKey.get(key);
        existing.accountedQty += line.accountedQty;
        existing.expectedQty += line.expectedQty;
      } else {
        accountingByKey.set(key, {
          accountedQty: line.accountedQty,
          expectedQty: line.expectedQty
        });
      }
    });

    // Walk each table row and inject a pill if there's matching accounting data
    Array.from(tbody.rows).forEach(row => {
      const cells = row.cells;
      if (cells.length < 3) return;
      const title = (cells[1]?.textContent || '').trim().toLowerCase();
      let variant = (cells[2]?.textContent || '').trim().toLowerCase();
      // Normalize dash placeholders to empty (table may show – or - for missing variants)
      if (variant === '–' || variant === '-' || variant === 'no variant') variant = '';
      const key = `${title}||${variant}`;
      const match = accountingByKey.get(key);
      if (!match) return;

      const pill = document.createElement('span');
      pill.className = `inline-accounting-pill ${match.accountedQty >= match.expectedQty ? 'is-complete' : 'is-missing'}`;
      pill.textContent = `${match.accountedQty}/${match.expectedQty}`;
      pill.title = match.accountedQty >= match.expectedQty
        ? 'All garments accounted for'
        : `${match.expectedQty - match.accountedQty} still missing from batch`;

      // Append the pill to the variant cell (3rd column)
      cells[2].appendChild(pill);
    });
  }

  async function openBatchForOrder(orderName) {
    const accounting = accountingForOrder(orderName);
    if (!accounting || !accounting.batches.size) return;
    if (accounting.batches.size > 1) {
      await openReceiveOverlay();
      return;
    }
    const [batchId] = accounting.batches.keys();
    await openReceiveOverlay();
    await openBatchFromList(batchId);
  }

  function statusLabel(status, blanksOrdered = null) {
    if (status === 'received') return 'Pipeline';
    if (status === 'toOrder') return 'Create Blanks Order';
    if (status === 'print') return 'Ready To Print';
    if (status === 'blanks') return Number(blanksOrdered) ? 'Blanks Ordered' : 'In S&S Cart';
    return 'this stage';
  }

  function movePatchForDropTarget(status, options = {}) {
    const patch = { status };
    if (status === 'blanks') {
      const forced = Object.prototype.hasOwnProperty.call(options, 'blanksOrdered')
        ? options.blanksOrdered
        : (typeof blanksOrderedValueForActiveView === 'function' ? blanksOrderedValueForActiveView() : 0);
      patch.blanksOrdered = forced ? 1 : 0;
    }
    if (status === 'received' || status === 'toOrder') {
      patch.blanksOrdered = 0;
    }
    return patch;
  }

  function orderNamesFromDragId(dragId) {
    const id = String(dragId || '');
    if (!id) return [];
    if (id.startsWith('bundle:')) {
      const bundleName = id.slice(7);
      return currentOrders()
        .filter(order => order?.bundle === bundleName)
        .map(order => order.name)
        .filter(Boolean);
    }
    return [id];
  }

  async function batchRefsForOrders(orderNames) {
    await hydrateAccountingForCurrentOrders();
    const refs = new Map();
    orderNames.forEach(orderName => {
      const accounting = accountingForOrder(orderName);
      accounting?.batches?.forEach((label, id) => {
        refs.set(id, { id, label: label || id });
      });
    });
    return Array.from(refs.values());
  }

  function moveTouchesBatchMembership(status, patch, batchRefs) {
    if (!batchRefs.length) return false;
    if (status === 'received' || status === 'toOrder') return true;
    if (status === 'blanks' && Number(patch.blanksOrdered) === 0) return true;
    return false;
  }

  async function handleBatchAwareDrop(dragId, status, options = {}) {
    const orderNames = orderNamesFromDragId(dragId);
    if (!orderNames.length) {
      console.warn('Drop ignored: no order ID present');
      return;
    }

    if (options.activateBlanksView && typeof setActiveBlanksView === 'function') {
      setActiveBlanksView(options.activateBlanksView, { render: false });
    }

    const patch = movePatchForDropTarget(status, options);
    const batchRefs = await batchRefsForOrders(orderNames);
    let batchChoice = 'keep';

    if (moveTouchesBatchMembership(status, patch, batchRefs)) {
      batchChoice = await resolveBatchCorrection({
        orderNames,
        batchRefs,
        targetLabel: statusLabel(status, patch.blanksOrdered)
      });
      if (batchChoice === 'cancel') return;
    }

    const moved = await applyBatchAwareOrderMove(orderNames, status, patch);
    if (!moved) return;

    if (batchChoice === 'remove') {
      await removeOrderNamesFromBatchRefs(orderNames, batchRefs);
    }
  }

  async function applyBatchAwareOrderMove(orderNames, status, patch) {
    if (typeof applyOptimisticOrderUpdate !== 'function') {
      await persistOrderMove(orderNames, status, patch);
      if (typeof renderBoard === 'function') await renderBoard();
      return true;
    }

    return applyOptimisticOrderUpdate(
      orderNames,
      patch,
      names => persistOrderMove(names, status, patch),
      'Could not move order'
    );
  }

  async function persistOrderMove(orderNames, status, patch) {
    if (isShopifyBoard() && typeof window.api.updateBoardMove === 'function') {
      await Promise.all(orderNames.map(orderName => {
        return window.api.updateBoardMove(orderName, { ...patch, status });
      }));
      return;
    }
    await Promise.all(orderNames.map(orderName => window.api.updateStatus(orderName, status)));
    if (Object.prototype.hasOwnProperty.call(patch, 'blanksOrdered')) {
      if (typeof updateBlanksOrderedForOrders === 'function') {
        await updateBlanksOrderedForOrders(orderNames, Number(patch.blanksOrdered) === 1);
      } else {
        await Promise.all(orderNames.map(orderName => {
          return window.api.updateReady({ name: orderName, blanksOrdered: Number(patch.blanksOrdered) === 1 ? 1 : 0 });
        }));
      }
    }
  }

  async function removeOrderNamesFromBatchRefs(orderNames, batchRefs) {
    if (!batchRefs.length || !window.api || typeof window.api.removeOrdersFromBlanksBatch !== 'function') return;
    const results = await Promise.all(batchRefs.map(batchRef => {
      return window.api.removeOrdersFromBlanksBatch(batchRef.id, orderNames);
    }));

    results.forEach(result => {
      if (result?.batch?.id) {
        batchDetailsById.set(result.batch.id, result.batch);
        if (activeBatch?.id === result.batch.id) activeBatch = result.batch;
      }
    });

    await loadBatchIndex();
    buildOrderAccounting();
    annotateAccountingCards();
    renderDetailAccounting(detailAccountingOrderName || currentDetailOrderName());
    if (isReceiveOverlayOpen()) {
      if (activeBatch?.id) renderBatchDetail();
      else renderBatchList();
    }
  }

  function ensureBatchCorrectionResolver() {
    let overlay = document.getElementById('batch-correction-overlay');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'batch-correction-overlay';
    overlay.className = 'batch-correction-overlay hidden';
    overlay.innerHTML = `
      <div class="batch-correction-dialog" role="dialog" aria-modal="true" aria-labelledby="batch-correction-title">
        <h2 id="batch-correction-title">Move Batch Order</h2>
        <p id="batch-correction-copy"></p>
        <div id="batch-correction-batches" class="batch-correction-batches"></div>
        <div class="batch-correction-actions">
          <button class="batch-correction-primary" type="button" data-batch-choice="remove">Remove From Batch &amp; Move</button>
          <button type="button" data-batch-choice="keep">Move Only</button>
          <button type="button" data-batch-choice="cancel">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  function resolveBatchCorrection({ orderNames, batchRefs, targetLabel }) {
    const overlay = ensureBatchCorrectionResolver();
    const title = overlay.querySelector('#batch-correction-title');
    const copy = overlay.querySelector('#batch-correction-copy');
    const batches = overlay.querySelector('#batch-correction-batches');
    const count = orderNames.length;
    const batchText = batchRefs.map(batchRef => batchRef.label).join(', ');

    if (title) title.textContent = `Move ${count === 1 ? 'Order' : `${count} Orders`} To ${targetLabel}`;
    if (copy) {
      copy.textContent = `${count === 1 ? 'This order is' : 'These orders are'} already part of ${batchText}. Choose what should happen to the saved S&S batch before the card moves.`;
    }
    if (batches) {
      batches.textContent = batchText;
    }

    overlay.classList.remove('hidden');

    return new Promise(resolve => {
      const finish = choice => {
        overlay.classList.add('hidden');
        overlay.removeEventListener('click', onOverlayClick);
        document.removeEventListener('keyup', onKey);
        overlay.querySelectorAll('[data-batch-choice]').forEach(button => {
          button.removeEventListener('click', onChoice);
        });
        resolve(choice);
      };
      const onChoice = event => finish(event.currentTarget.dataset.batchChoice || 'cancel');
      const onOverlayClick = event => {
        if (event.target === overlay) finish('cancel');
      };
      const onKey = event => {
        if (event.key === 'Escape') finish('cancel');
      };

      overlay.querySelectorAll('[data-batch-choice]').forEach(button => {
        button.addEventListener('click', onChoice);
      });
      overlay.addEventListener('click', onOverlayClick);
      document.addEventListener('keyup', onKey);
      requestAnimationFrame(() => {
        overlay.querySelector('[data-batch-choice="remove"]')?.focus();
      });
    });
  }

  function patchDropZonesForBatchCorrections() {
    try {
      if (typeof makeDropZone !== 'function' || makeDropZone.__blanksBatchCorrectionsPatched) return true;

      makeDropZone = function patchedBatchAwareDropZone(el, status) {
        if (!el) return;
        el.addEventListener('dragover', event => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          if (el.classList.contains('drag-area')) el.classList.add('over');
        });
        el.addEventListener('dragleave', () => {
          el.classList.remove('over');
        });
        el.addEventListener('drop', async event => {
          event.preventDefault();
          el.classList.remove('over');
          document.body.classList.remove('dragging-cursor');
          document.querySelectorAll('.dragging').forEach(card => card.classList.remove('dragging'));
          const dragId = event.dataTransfer.getData('text/plain');
          try {
            await handleBatchAwareDrop(dragId, status);
          } catch (error) {
            console.error('Unable to move order', error);
            if (isShopifyBoard()) showMoveNotice(`Could not move order. ${error?.message || error}`);
            else alert(`Could not move order: ${error?.message || error}`);
          }
        });
      };
      makeDropZone.__blanksBatchCorrectionsPatched = true;
      return true;
    } catch (error) {
      console.warn('Unable to patch drop zones for batch corrections', error);
      return false;
    }
  }

  function setupBlanksTabDropTargets() {
    [
      { id: 'blanks-view-cart', blanksOrdered: 0, view: 'cart' },
      { id: 'blanks-view-ordered', blanksOrdered: 1, view: 'ordered' }
    ].forEach(target => {
      const button = document.getElementById(target.id);
      if (!button || button.dataset.batchDropReady === '1') return;
      button.dataset.batchDropReady = '1';
      button.addEventListener('click', () => window.setActiveBlanksView(target.view));
      button.addEventListener('keydown', event => {
        if (!isShopifyBoard() || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
        event.preventDefault();
        const next = target.view === 'cart' ? 'ordered' : 'cart';
        window.setActiveBlanksView(next);
        document.getElementById(next === 'cart' ? 'blanks-view-cart' : 'blanks-view-ordered')?.focus();
      });
      button.addEventListener('dragover', event => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        button.classList.add('drag-over');
      });
      button.addEventListener('dragleave', () => {
        button.classList.remove('drag-over');
      });
      button.addEventListener('drop', async event => {
        event.preventDefault();
        button.classList.remove('drag-over');
        document.body.classList.remove('dragging-cursor');
        document.querySelectorAll('.dragging').forEach(card => card.classList.remove('dragging'));
        const dragId = event.dataTransfer.getData('text/plain');
        try {
          await handleBatchAwareDrop(dragId, 'blanks', {
            blanksOrdered: target.blanksOrdered,
            activateBlanksView: target.view
          });
        } catch (error) {
          console.error('Unable to move order to blanks view', error);
          if (isShopifyBoard()) showMoveNotice(`Could not move order. ${error?.message || error}`);
          else alert(`Could not move order: ${error?.message || error}`);
        }
      });
    });
  }

  function ensureReceiveButton() {
    const actions = document.querySelector('#blanks-section .section-actions');
    if (!actions || document.getElementById('blanks-receive-batches-btn')) return;

    const button = document.createElement('button');
    button.id = 'blanks-receive-batches-btn';
    button.className = 'fullscreen-btn blanks-receive-batches-btn';
    button.type = 'button';
    button.textContent = 'Receive Batches';
    button.addEventListener('click', openReceiveOverlay);
    actions.insertBefore(button, actions.firstChild);
  }

  function ensureReceiveOverlay() {
    if (document.getElementById('blanks-receive-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'blanks-receive-overlay';
    overlay.className = 'manual-add-overlay blanks-receive-overlay hidden';
    overlay.setAttribute('role', 'presentation');
    overlay.innerHTML = `
      <div class="manual-add-dialog blanks-receive-dialog" role="dialog" aria-modal="true" aria-labelledby="blanks-receive-title">
        <header class="manual-add-header">
          <div class="manual-add-heading">
            <span id="blanks-receive-eyebrow" class="manual-add-eyebrow">S&amp;S Batches</span>
            <h2 id="blanks-receive-title">Receive Batches</h2>
          </div>
          <button id="blanks-receive-close" class="manual-add-close" type="button">Close</button>
        </header>
        <section class="manual-add-stats" aria-label="Batch receiving progress">
          <div class="manual-add-stat">
            <span id="blanks-receive-stat-expected" class="manual-add-stat-value">0</span>
            <span class="manual-add-stat-label">Expected</span>
          </div>
          <div class="manual-add-stat">
            <span id="blanks-receive-stat-received" class="manual-add-stat-value">0</span>
            <span class="manual-add-stat-label">Received</span>
          </div>
          <div class="manual-add-stat">
            <span id="blanks-receive-stat-missing" class="manual-add-stat-value">0</span>
            <span class="manual-add-stat-label">Missing</span>
          </div>
        </section>
        <div class="manual-add-progress" aria-hidden="true">
          <div id="blanks-receive-progress-bar" class="manual-add-progress-bar"></div>
        </div>
        <div class="manual-add-actions blanks-receive-actions">
          <button id="blanks-receive-back" class="manual-add-action manual-add-action-secondary hidden" type="button">Back</button>
          <button id="blanks-receive-refresh" class="manual-add-action" type="button">Refresh</button>
          <button id="blanks-receive-add-cart" class="manual-add-action hidden" type="button">Add In-Cart Orders</button>
          <button id="blanks-receive-mark-all" class="manual-add-action hidden" type="button">Mark All Received</button>
          <button id="blanks-receive-save" class="manual-add-action blanks-receive-save hidden" type="button" disabled>Save Receiving</button>
        </div>
        <div class="manual-add-body">
          <div id="blanks-receive-list" class="blanks-receive-list"></div>
          <div id="blanks-receive-empty" class="manual-add-empty" hidden>
            <strong>No S&amp;S batches yet</strong>
            <span>Use Mark In Cart Ordered to create a receiving batch.</span>
          </div>
        </div>
      </div>
    `;

    overlay.addEventListener('click', event => {
      if (event.target === overlay) closeReceiveOverlay();
    });
    overlay.querySelector('#blanks-receive-close')?.addEventListener('click', closeReceiveOverlay);
    overlay.querySelector('#blanks-receive-back')?.addEventListener('click', showBatchList);
    overlay.querySelector('#blanks-receive-refresh')?.addEventListener('click', refreshReceiveOverlay);
    overlay.querySelector('#blanks-receive-add-cart')?.addEventListener('click', addCurrentCartOrdersToActiveBatch);
    overlay.querySelector('#blanks-receive-mark-all')?.addEventListener('click', markAllManifestReceived);
    overlay.querySelector('#blanks-receive-save')?.addEventListener('click', saveReceiving);
    overlay.addEventListener('click', handleReceiveClick);
    overlay.addEventListener('input', handleReceiveInput);
    document.addEventListener('keyup', event => {
      if (event.key === 'Escape' && isReceiveOverlayOpen()) closeReceiveOverlay();
    });

    document.body.appendChild(overlay);
  }

  function isReceiveOverlayOpen() {
    return !document.getElementById('blanks-receive-overlay')?.classList.contains('hidden');
  }

  async function openReceiveOverlay() {
    ensureReceiveOverlay();
    const overlay = document.getElementById('blanks-receive-overlay');
    overlay?.classList.remove('hidden');
    document.body.classList.add('blanks-receive-open', 'manual-add-open');
    try {
      await loadBatchIndex();
      showBatchList();
    } catch (error) {
      console.error('Unable to load blanks batches', error);
      alert(`Could not load batches: ${error?.message || error}`);
    }
    requestAnimationFrame(() => {
      overlay?.querySelector('#blanks-receive-close')?.focus();
    });
  }

  function closeReceiveOverlay() {
    if (!confirmDiscardDraft()) return;
    document.getElementById('blanks-receive-overlay')?.classList.add('hidden');
    document.body.classList.remove('blanks-receive-open', 'manual-add-open');
    document.getElementById('blanks-receive-batches-btn')?.focus();
  }

  async function refreshReceiveOverlay() {
    if (!confirmDiscardDraft()) return;
    const refresh = document.getElementById('blanks-receive-refresh');
    if (refresh) refresh.disabled = true;
    try {
      if (activeBatch?.id) {
        await loadBatch(activeBatch.id);
        renderBatchDetail();
      } else {
        await loadBatchIndex();
        renderBatchList();
      }
    } finally {
      if (refresh) refresh.disabled = false;
    }
  }

  async function loadBatchIndex() {
    if (!window.api || typeof window.api.listBlanksBatches !== 'function') {
      batchIndex = [];
      return;
    }
    const data = await window.api.listBlanksBatches();
    batchIndex = Array.isArray(data?.batches) ? data.batches : [];
  }

  async function loadBatch(id) {
    if (!window.api || typeof window.api.getBlanksBatch !== 'function') return null;
    const data = await window.api.getBlanksBatch(id);
    activeBatch = data?.batch || null;
    if (activeBatch?.id) {
      batchDetailsById.set(activeBatch.id, activeBatch);
      buildOrderAccounting();
      annotateAccountingCards();
      renderDetailAccounting(detailAccountingOrderName || currentDetailOrderName());
    }
    draftReceived = new Map((activeBatch?.manifest || []).map(line => [
      line.itemKey,
      Number(line.receivedQty) || 0
    ]));
    dirty = false;
    return activeBatch;
  }

  function showBatchList() {
    if (!confirmDiscardDraft()) return;
    activeBatch = null;
    draftReceived = new Map();
    dirty = false;
    setHeaderMode('list');
    renderBatchList();
  }

  function setHeaderMode(mode) {
    const isDetail = mode === 'detail';
    document.getElementById('blanks-receive-eyebrow').textContent = isDetail ? 'Batch Manifest' : 'S&S Batches';
    document.getElementById('blanks-receive-title').textContent = isDetail && activeBatch ? activeBatch.label : 'Receive Batches';
    document.getElementById('blanks-receive-back')?.classList.toggle('hidden', !isDetail);
    document.getElementById('blanks-receive-add-cart')?.classList.toggle('hidden', !isDetail);
    document.getElementById('blanks-receive-mark-all')?.classList.toggle('hidden', !isDetail);
    document.getElementById('blanks-receive-save')?.classList.toggle('hidden', !isDetail);
    syncSaveState();
    syncAddCartOrdersState();
  }

  function totalFromIndex(field) {
    return batchIndex.reduce((sum, batch) => sum + (Number(batch?.[field]) || 0), 0);
  }

  function syncStats(expected, received, missing) {
    document.getElementById('blanks-receive-stat-expected').textContent = String(expected);
    document.getElementById('blanks-receive-stat-received').textContent = String(received);
    document.getElementById('blanks-receive-stat-missing').textContent = String(missing);
    const progress = expected ? Math.min(100, Math.round((received / expected) * 100)) : 0;
    document.getElementById('blanks-receive-progress-bar').style.width = `${progress}%`;
  }

  function renderBatchList() {
    const list = document.getElementById('blanks-receive-list');
    const empty = document.getElementById('blanks-receive-empty');
    if (!list || !empty) return;

    const expected = totalFromIndex('expectedGarments');
    const received = totalFromIndex('receivedGarments');
    const missing = totalFromIndex('missingGarments');
    syncStats(expected, received, missing);

    list.replaceChildren();
    const hasBatches = batchIndex.length > 0;
    empty.hidden = hasBatches;
    list.hidden = !hasBatches;

    batchIndex.forEach(batch => {
      list.appendChild(renderBatchCard(batch));
    });
  }

  function renderBatchCard(batch) {
    const card = document.createElement('button');
    card.className = 'blanks-receive-batch-card';
    card.type = 'button';
    card.dataset.batchId = batch.id;

    const expected = Number(batch.expectedGarments) || 0;
    const received = Number(batch.receivedGarments) || 0;
    const missing = Math.max(0, Number(batch.missingGarments) || 0);
    const created = batch.createdAt ? new Date(batch.createdAt).toLocaleDateString() : '';

    card.innerHTML = `
      <span class="blanks-receive-batch-main">
        <strong>${escapeHtml(batch.label || batch.id)}</strong>
        <span>${batch.orderCount || 0} orders${created ? ` · ${escapeHtml(created)}` : ''}</span>
      </span>
      <span class="blanks-receive-batch-counts">
        <span>${received}/${expected}</span>
        <span class="${missing ? 'is-missing' : 'is-complete'}">${missing ? `${missing} missing` : 'Complete'}</span>
      </span>
    `;
    return card;
  }

  async function openBatchFromList(batchId) {
    if (!batchId) return;
    if (!confirmDiscardDraft()) return;
    await loadBatch(batchId);
    renderBatchDetail();
  }

  function renderBatchDetail() {
    setHeaderMode('detail');
    const list = document.getElementById('blanks-receive-list');
    const empty = document.getElementById('blanks-receive-empty');
    if (!list || !empty || !activeBatch) return;

    list.hidden = false;
    empty.hidden = true;
    list.replaceChildren();

    const fragment = document.createDocumentFragment();
    (activeBatch.manifest || []).forEach(line => {
      fragment.appendChild(renderManifestLine(line));
    });
    list.appendChild(fragment);
    syncDraftStats();
    syncAddCartOrdersState();
  }

  function currentCartOrdersForActiveBatch() {
    if (!activeBatch) return [];
    const existing = new Set(Array.isArray(activeBatch.orderNames) ? activeBatch.orderNames : []);
    return currentOrders().filter(order => {
      return order?.status === 'blanks' && !isOrdered(order) && !existing.has(order.name);
    });
  }

  function syncAddCartOrdersState() {
    const button = document.getElementById('blanks-receive-add-cart');
    if (!button || button.classList.contains('hidden')) return;
    const count = currentCartOrdersForActiveBatch().length;
    button.disabled = !activeBatch || dirty || count === 0;
    button.textContent = count ? `Add In-Cart (${count})` : 'Add In-Cart Orders';
    button.title = dirty
      ? 'Save or discard receiving changes before adding orders to this batch'
      : 'Add current In S&S Cart orders to this batch';
  }

  async function addCurrentCartOrdersToActiveBatch() {
    if (!activeBatch || dirty) return;
    if (!window.api || typeof window.api.addOrdersToBlanksBatch !== 'function') return;
    const orders = currentCartOrdersForActiveBatch();
    if (!orders.length) {
      alert('No In S&S Cart orders are available to add to this batch.');
      return;
    }
    const label = activeBatch.label || activeBatch.id;
    const message = `Add ${orders.length} In S&S Cart order${orders.length === 1 ? '' : 's'} to ${label}? This will mark them Ordered and recalculate the batch.`;
    if (!window.confirm(message)) return;

    const button = document.getElementById('blanks-receive-add-cart');
    if (button) {
      button.disabled = true;
      button.textContent = 'Adding...';
    }

    try {
      const payload = buildBlanksBatchPayload(orders);
      const result = await window.api.addOrdersToBlanksBatch(activeBatch.id, payload.orders);
      activeBatch = result?.batch || activeBatch;
      if (activeBatch?.id) batchDetailsById.set(activeBatch.id, activeBatch);

      const orderNames = orders.map(order => order.name).filter(Boolean);
      if (typeof applyOptimisticOrderUpdate === 'function') {
        await applyOptimisticOrderUpdate(
          orderNames,
          { status: 'blanks', blanksOrdered: 1 },
          names => updateBlanksOrderedForOrders(names, true),
          'Batch was updated, but orders could not be marked ordered'
        );
      } else if (typeof updateBlanksOrderedForOrders === 'function') {
        await updateBlanksOrderedForOrders(orderNames, true);
        if (typeof renderBoard === 'function') await renderBoard();
      }

      await loadBatchIndex();
      buildOrderAccounting();
      annotateAccountingCards();
      renderDetailAccounting(detailAccountingOrderName || currentDetailOrderName());
      renderBatchDetail();
    } catch (error) {
      console.error('Unable to add in-cart orders to batch', error);
      alert(`Could not add orders to batch: ${error?.message || error}`);
      syncAddCartOrdersState();
    }
  }

  function renderManifestLine(line) {
    const row = document.createElement('article');
    row.className = 'blanks-receive-line';
    row.dataset.itemKey = line.itemKey;

    const expected = Number(line.expectedQty) || 0;
    const received = draftReceived.get(line.itemKey) ?? Number(line.receivedQty) ?? 0;
    const accounted = Number(line.accountedQty) || 0;
    const missing = Math.max(0, expected - accounted);
    const sku = line.sku ? `SKU ${escapeHtml(line.sku)}` : 'No SKU';

    row.innerHTML = `
      <div class="blanks-receive-line-copy">
        <strong>${escapeHtml(line.title || 'Untitled garment')}</strong>
        <span>${escapeHtml(line.variantTitle || 'No variant')} · ${sku}</span>
      </div>
      <div class="blanks-receive-line-status">
        <span>Expected ${expected}</span>
        <span class="${missing ? 'is-missing' : 'is-complete'}">${accounted}/${expected} accounted</span>
      </div>
      <div class="blanks-receive-stepper" aria-label="Received quantity">
        <button type="button" data-receive-action="decrement" aria-label="Decrease received quantity">-</button>
        <input type="number" min="0" inputmode="numeric" value="${received}" data-receive-input>
        <button type="button" data-receive-action="increment" aria-label="Increase received quantity">+</button>
        <button type="button" data-receive-action="all">All</button>
      </div>
    `;
    return row;
  }

  function handleReceiveClick(event) {
    const batchCard = event.target.closest?.('.blanks-receive-batch-card');
    if (batchCard) {
      openBatchFromList(batchCard.dataset.batchId).catch(error => {
        console.error('Unable to open blanks batch', error);
        alert(`Could not open batch: ${error?.message || error}`);
      });
      return;
    }

    const actionButton = event.target.closest?.('[data-receive-action]');
    if (!actionButton) return;

    const row = actionButton.closest('.blanks-receive-line');
    if (!row) return;
    const line = lineByKey(row.dataset.itemKey);
    if (!line) return;

    const current = draftReceived.get(line.itemKey) ?? Number(line.receivedQty) ?? 0;
    const action = actionButton.dataset.receiveAction;
    let next = current;
    if (action === 'decrement') next = Math.max(0, current - 1);
    if (action === 'increment') next = current + 1;
    if (action === 'all') next = Number(line.expectedQty) || 0;
    setDraftReceived(line.itemKey, next);
  }

  function handleReceiveInput(event) {
    const input = event.target.closest?.('[data-receive-input]');
    if (!input) return;
    const row = input.closest('.blanks-receive-line');
    const line = lineByKey(row?.dataset.itemKey);
    if (!line) return;
    setDraftReceived(line.itemKey, input.value);
  }

  function lineByKey(itemKey) {
    return (activeBatch?.manifest || []).find(line => line.itemKey === itemKey);
  }

  function setDraftReceived(itemKey, value) {
    const numeric = Math.max(0, parseInt(value, 10) || 0);
    draftReceived.set(itemKey, numeric);
    dirty = true;

    const row = document.querySelector(`.blanks-receive-line[data-item-key="${cssEscape(itemKey)}"]`);
    const input = row?.querySelector('[data-receive-input]');
    if (input && document.activeElement !== input) input.value = String(numeric);
    syncDraftStats();
    syncSaveState();
  }

  function syncDraftStats() {
    if (!activeBatch) {
      syncStats(0, 0, 0);
      return;
    }
    const expected = (activeBatch.manifest || []).reduce((sum, line) => sum + (Number(line.expectedQty) || 0), 0);
    const received = (activeBatch.manifest || []).reduce((sum, line) => {
      return sum + (draftReceived.get(line.itemKey) ?? Number(line.receivedQty) ?? 0);
    }, 0);
    const missing = Math.max(0, expected - received);
    syncStats(expected, received, missing);
  }

  function syncSaveState() {
    const save = document.getElementById('blanks-receive-save');
    if (save) save.disabled = !dirty;
    syncAddCartOrdersState();
  }

  function markAllManifestReceived() {
    if (!activeBatch) return;
    (activeBatch.manifest || []).forEach(line => {
      draftReceived.set(line.itemKey, Number(line.expectedQty) || 0);
    });
    dirty = true;
    renderBatchDetail();
    syncSaveState();
  }

  async function saveReceiving() {
    if (!activeBatch || !dirty || !window.api || typeof window.api.updateBlanksBatchReceiving !== 'function') return;
    const save = document.getElementById('blanks-receive-save');
    if (save) {
      save.disabled = true;
      save.textContent = 'Saving...';
    }

    const updates = (activeBatch.manifest || []).map(line => ({
      itemKey: line.itemKey,
      receivedQty: draftReceived.get(line.itemKey) ?? Number(line.receivedQty) ?? 0
    }));

    try {
      const result = await window.api.updateBlanksBatchReceiving(activeBatch.id, updates);
      activeBatch = result?.batch || activeBatch;
      if (activeBatch?.id) batchDetailsById.set(activeBatch.id, activeBatch);
      draftReceived = new Map((activeBatch.manifest || []).map(line => [
        line.itemKey,
        Number(line.receivedQty) || 0
      ]));
      dirty = false;
      await loadBatchIndex();
      buildOrderAccounting();
      annotateAccountingCards();
      renderDetailAccounting(detailAccountingOrderName || currentDetailOrderName());
      renderBatchDetail();
      if (save) save.textContent = 'Saved';
      window.setTimeout(() => {
        const currentSave = document.getElementById('blanks-receive-save');
        if (currentSave) currentSave.textContent = 'Save Receiving';
      }, 900);
    } catch (error) {
      console.error('Unable to save batch receiving', error);
      alert(`Could not save receiving: ${error?.message || error}`);
      syncSaveState();
    } finally {
      const currentSave = document.getElementById('blanks-receive-save');
      if (currentSave) {
        currentSave.textContent = currentSave.textContent === 'Saving...' ? 'Save Receiving' : currentSave.textContent;
        currentSave.disabled = !dirty;
      }
    }
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function confirmDiscardDraft() {
    if (!dirty) return true;
    if (!window.confirm('Discard unsaved receiving changes?')) return false;
    dirty = false;
    syncSaveState();
    return true;
  }

  function setupMarkInCartOrdered() {
    const button = document.getElementById('blanks-mark-ordered-btn');
    if (!button || button.dataset.markInCartOrderedReady === '1') return;
    button.dataset.markInCartOrderedReady = '1';
    const defaultLabel = button.textContent;

    button.addEventListener('click', async () => {
      if (markOrderedInFlight || !isShopifyBoard()) return;

      const cartOrders = currentOrders()
        .filter(order => order?.status === 'blanks' && !isOrdered(order));
      if (!cartOrders.length) {
        showMoveNotice('No orders are currently in In S&S Cart.', 'info');
        return;
      }

      const orderNames = cartOrders.map(order => order.name).filter(Boolean);
      markOrderedInFlight = true;
      button.disabled = true;
      button.textContent = `Marking ${orderNames.length} ordered...`;
      try {
        await applyBatchAwareOrderMove(orderNames, 'blanks', { blanksOrdered: 1 });
        window.setActiveBlanksView?.('ordered');
        try {
          await saveBatchForOrders(cartOrders);
        } catch (error) {
          console.error('Unable to create blanks batch manifest', error);
          alert(`Orders were marked ordered, but the S&S batch manifest was not saved: ${error?.message || error}`);
        }
      } catch (error) {
        // applyBatchAwareOrderMove already restores the optimistic card update
        // and communicates the persistence failure.
        console.error('Unable to mark In S&S Cart orders as ordered', error);
      } finally {
        markOrderedInFlight = false;
        button.disabled = false;
        button.textContent = defaultLabel;
      }
    });
  }

  window.blanksBatchFoundation = {
    buildPayload: buildBlanksBatchPayload,
    saveBatchForOrders,
    openReceiveOverlay,
    hydrateAccounting: hydrateAccountingForCurrentOrders,
    accountingForOrder
  };

  patchRenderBoardForAccounting();
  patchOpenDetailForAccounting();
  patchDropZonesForBatchCorrections();
  patchBlanksColumnView();

  document.addEventListener('DOMContentLoaded', () => {
    setupSuppliesTabs();
    ensureReceiveButton();
    ensureReceiveOverlay();
    setupBlanksTabDropTargets();
    setupMarkInCartOrdered();
    syncBlanksViewUi();
    patchRenderBoardForAccounting();
    patchOpenDetailForAccounting();
    patchDropZonesForBatchCorrections();
    patchBlanksColumnView();
    hydrateAccountingForCurrentOrders().catch(error => {
      console.warn('Unable to hydrate blanks accounting on load', error);
    });
  });

})();
