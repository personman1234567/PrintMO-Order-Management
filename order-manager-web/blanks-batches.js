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
    document.getElementById('blanks-receive-mark-all')?.classList.toggle('hidden', !isDetail);
    document.getElementById('blanks-receive-save')?.classList.toggle('hidden', !isDetail);
    syncSaveState();
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
      draftReceived = new Map((activeBatch.manifest || []).map(line => [
        line.itemKey,
        Number(line.receivedQty) || 0
      ]));
      dirty = false;
      await loadBatchIndex();
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
    saveBatchForOrders,
    openReceiveOverlay
  };

  document.addEventListener('DOMContentLoaded', () => {
    ensureReceiveButton();
    ensureReceiveOverlay();
  });

  if (!patchMarkInCartOrdered()) {
    document.addEventListener('DOMContentLoaded', patchMarkInCartOrdered, { once: true });
  }
})();
