// renderer.js

let allOrders = [];
let renderTimer = null;
let boardFetchGeneration = 0;
let boardHasRendered = false;
window.getOrderManagerBoardSnapshot = () => {
  const snapshot = allOrders.slice();
  window.orderManagerPerformanceDebug?.log?.('board-snapshot-read', {
    orders: snapshot.length
  });
  return snapshot;
};
function scheduleRender() {
  if (renderTimer) return;
  renderTimer = setTimeout(async () => {
    renderTimer = null;
    await renderBoard();
  }, 200);
}
let bundleMode = null; // {status, selected:Set<string>}
let detailOrder = null;
let fileRemoveMode = false;
const selectedFiles = new Set();
let notesResizeHandler = null;
let detailAssetRenderToken = 0;
const detailAssetBlobUrls = new Set();
const manualMockupsByOrderNumber = new Map();
const manualMockupsHydratedOrderNumbers = new Set();
const manualMockupsHydratingOrderNumbers = new Set();
let manualMockupHydrationRun = 0;
let activeCardDrag = null;

const APPAREL_ICON = typeof window.getAssetPath === 'function'
  ? window.getAssetPath('ApparelCount.svg')
  : 'Assets/ApparelCount.svg';
const PRINT_ICON   = typeof window.getAssetPath === 'function'
  ? window.getAssetPath('PrintCount.svg')
  : 'Assets/PrintCount.svg';
const APPAREL_ICON_GREEN = typeof window.getAssetPath === 'function'
  ? window.getAssetPath('ApparelCountGreen.svg')
  : 'Assets/ApparelCountGreen.svg';
const PRINT_ICON_GREEN   = typeof window.getAssetPath === 'function'
  ? window.getAssetPath('PrintCountGreen.svg')
  : 'Assets/PrintCountGreen.svg';
// utility to detect “print” items by SKU or title
function isPrintItem(li) {
  return PRINT_TITLES.has(li.title);
}

function hasSupplierSku(li) {
  return Boolean(String(li?.sku || '').trim());
}

function isGarmentItem(li) {
  return !isPrintItem(li) && hasSupplierSku(li);
}

const PRINT_TITLES = new Set([
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

const MOBILE_TAB_BREAKPOINT = 900;
const MOBILE_TABS = ['pipeline', 'blanksCart', 'blanksOrdered', 'readyToPrint'];
const PRINT_VIEWS = ['toPrint', 'printed'];
let activeMobileTab = MOBILE_TABS[0];
let activePrintView = PRINT_VIEWS[0];
let isMobileViewport = false;
let mobileMediaQuery = null;

/**
 * Apply the current mobile tab so CSS can scope visibility without re-rendering.
 * This keeps tab switches instant while providing a single hook for future
 * selection-mode UI to anchor itself to the active stage.
 * @param {string} tab - One of MOBILE_TABS to activate.
 * @param {{scrollTop?: boolean}} [opts] - Allows skipping scroll reset when the tab is applied programmatically.
 */
function setActiveMobileTab(tab, opts = {}) {
  const { scrollTop = true } = opts;
  const nextTab = MOBILE_TABS.includes(tab) ? tab : MOBILE_TABS[0];
  activeMobileTab = nextTab;
  if (document.body) {
    document.body.dataset.activeTab = nextTab;
  }
  document.querySelectorAll('.mobile-tab').forEach(btn => {
    const isActive = btn.dataset.tab === nextTab;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
  if (scrollTop && isMobileViewport) {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
}

/**
 * Sync a cached mobile flag with the breakpoint so other behaviors (such as
 * future selection mode) can branch cleanly without re-querying media state.
 * @param {boolean} matches - Whether the mobile media query currently matches.
 */
function updateMobileViewportFlag(matches) {
  isMobileViewport = matches;
  if (document.body) {
    document.body.classList.toggle('mobile-mode', matches);
  }
  if (matches) {
    setActiveMobileTab(activeMobileTab, { scrollTop: false });
  }
}

/**
 * Initialize the mobile tab bar so only one stage renders at a time on small
 * screens. The layout is handled by mobile.css; this just tracks state and
 * wires up taps.
 */
function initMobileTabs() {
  mobileMediaQuery = window.matchMedia(`(max-width: ${MOBILE_TAB_BREAKPOINT}px)`);
  updateMobileViewportFlag(mobileMediaQuery.matches);
  mobileMediaQuery.addEventListener('change', ev => updateMobileViewportFlag(ev.matches));

  const initialTab = document.body?.dataset.activeTab || activeMobileTab;
  setActiveMobileTab(initialTab, { scrollTop: false });

  document.querySelectorAll('.mobile-tab').forEach(btn => {
    btn.addEventListener('click', () => setActiveMobileTab(btn.dataset.tab));
  });
}

function isShopifyBoardView() {
  return document.body?.dataset.orderSource === 'shopify';
}

function printViewForOrder(order) {
  return order?.productionStage === 'completed' ? 'printed' : 'toPrint';
}

function visibleShopifyPrintOrders(view = activePrintView) {
  return allOrders.filter(order => {
    if ((order.status || 'received') !== 'print' || !order._candidate) return false;
    const orderView = printViewForOrder(order);
    if (orderView !== view) return false;
    if (orderView === 'printed') return true;
    return String(order.displayFulfillmentStatus || '').toUpperCase() !== 'FULFILLED';
  });
}

function syncPrintViewUi() {
  const section = document.getElementById('print-section');
  const container = document.getElementById('col-print');
  if (!section || !container) return;

  section.dataset.printView = activePrintView;
  const counts = {
    toPrint: visibleShopifyPrintOrders('toPrint').length,
    printed: visibleShopifyPrintOrders('printed').length
  };

  PRINT_VIEWS.forEach(view => {
    const button = document.getElementById(`print-view-${view === 'toPrint' ? 'to-print' : 'printed'}`);
    const selected = view === activePrintView;
    button?.classList.toggle('active', selected);
    button?.setAttribute('aria-selected', selected ? 'true' : 'false');
    if (button) button.tabIndex = selected ? 0 : -1;
  });

  const toPrintCount = document.getElementById('print-to-print-count');
  const printedCount = document.getElementById('print-printed-count');
  if (toPrintCount) toPrintCount.textContent = String(counts.toPrint);
  if (printedCount) printedCount.textContent = String(counts.printed);

  const activeTabId = activePrintView === 'printed' ? 'print-view-printed' : 'print-view-to-print';
  container.setAttribute('aria-labelledby', activeTabId);
  container.dataset.emptyMessage = activePrintView === 'printed'
    ? 'No printed orders awaiting handoff'
    : 'No orders waiting to be printed';
}

function setActivePrintView(view, { render = true } = {}) {
  if (!isShopifyBoardView()) return;
  const nextView = PRINT_VIEWS.includes(view) ? view : PRINT_VIEWS[0];
  const viewChanged = nextView !== activePrintView;
  activePrintView = nextView;
  syncPrintViewUi();
  if (render) renderStatusColumn('print');
  if (viewChanged) {
    const container = document.getElementById('col-print');
    if (container) container.scrollTop = 0;
  }
}

function initPrintTabs() {
  const tabIds = ['print-view-to-print', 'print-view-printed'];
  tabIds.forEach((id, index) => {
    const button = document.getElementById(id);
    if (!button) return;
    button.addEventListener('click', () => {
      setActivePrintView(index === 0 ? 'toPrint' : 'printed');
    });
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let nextIndex = index;
      if (event.key === 'ArrowLeft') nextIndex = (index + tabIds.length - 1) % tabIds.length;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabIds.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = tabIds.length - 1;
      setActivePrintView(nextIndex === 0 ? 'toPrint' : 'printed');
      document.getElementById(tabIds[nextIndex])?.focus();
    });
  });

  const sourceObserver = new MutationObserver(() => {
    if (isShopifyBoardView()) {
      syncPrintViewUi();
      renderStatusColumn('print');
    }
  });
  sourceObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['data-order-source']
  });
  syncPrintViewUi();
}

window.setActivePrintView = setActivePrintView;


function timeAgo(isoDate) {
  const then = new Date(isoDate);
  const now  = new Date();
  const diff = now - then;               // ms
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function sortBundlesByOldest(entries) {
  return entries.sort(([, a], [, b]) => {
    const aOldest = Math.min(...a.map(o => new Date(o.receivedAt).getTime()));
    const bOldest = Math.min(...b.map(o => new Date(o.receivedAt).getTime()));
    return aOldest - bOldest;
  });
}

const BOARD_STATUSES = ['received', 'toOrder', 'blanks', 'print'];
const STATUS_COLUMN_CONFIG = {
  received: {
    containerId: 'col-received',
    cardStyle: 'pipeline',
    bundleStyle: 'pipeline',
    countId: 'pipeline-count'
  },
  toOrder: {
    containerId: 'picked-cards',
    cardStyle: 'picked',
    bundleStyle: 'picked'
  },
  blanks: {
    containerId: 'col-blanks',
    cardStyle: 'pipeline',
    bundleStyle: 'pipeline'
  },
  print: {
    containerId: 'col-print',
    cardStyle: 'printProgress',
    bundleStyle: 'pipeline'
  }
};

/**
 * Collapse status input into known board columns so callers can pass one status,
 * a Set from a mutation, or nothing for a full board paint.
 * @param {Iterable<string>|string|null|undefined} statuses - Statuses to render.
 * @returns {string[]} Stable list of status columns to refresh.
 */
function normalizeBoardStatuses(statuses) {
  if (!statuses) return BOARD_STATUSES.slice();
  const list = typeof statuses === 'string' ? [statuses] : Array.from(statuses);
  return Array.from(new Set(list)).filter(status => STATUS_COLUMN_CONFIG[status]);
}

function candidateAssetRenderFingerprint(asset) {
  if (typeof asset === 'string') return asset;
  if (!asset || typeof asset !== 'object') return '';
  return {
    assetId: asset.assetId || '',
    contentType: asset.contentType || '',
    filename: asset.filename || asset.name || '',
    lineItemId: asset.lineItemId || '',
    role: asset.role || '',
    side: asset.side || '',
    state: asset.state || ''
  };
}

function candidateOrderRenderFingerprint(order) {
  return JSON.stringify({
    id: order._gid || order.name || '',
    provider: order._provider || 'shopify',
    synthetic: Boolean(order._synthetic),
    name: order.name || '',
    receivedAt: order.receivedAt || '',
    status: order.status || 'received',
    productionStage: order.productionStage || '',
    items: (order.items || []).map(item => ({
      id: item.id || '',
      title: item.title || '',
      variantTitle: item.variantTitle || '',
      sku: item.sku || '',
      qty: Number(item.qty || 0),
      price: Number(item.unitPrice ?? item.price ?? 0),
      properties: item.properties || {},
      assets: (item.assets || []).map(candidateAssetRenderFingerprint)
    })),
    subtotal: Number(order.subtotal || 0),
    discount: Number(order.discount || 0),
    total: Number(order.total || 0),
    notes: order.notes || '',
    bundle: order.bundle || '',
    progress: Number(order.progress || 0),
    blanksStatus: Number(order.blanksStatus || 0),
    printsStatus: Number(order.printsStatus || 0),
    blanksOrdered: Number(order.blanksOrdered || 0),
    printsOrdered: Number(order.printsOrdered || 0),
    displayFulfillmentStatus: order.displayFulfillmentStatus || '',
    assets: (order.assets || []).map(candidateAssetRenderFingerprint)
  });
}

function changedCandidateBoardStatuses(previousOrders, nextOrders) {
  if (!boardHasRendered) return new Set(BOARD_STATUSES);
  if (
    previousOrders.some(order => !order?._candidate)
    || nextOrders.some(order => !order?._candidate)
  ) {
    return new Set(BOARD_STATUSES);
  }

  const keyed = orders => new Map(orders.map((order, index) => [
    order._gid || order.name || `candidate-${index}`,
    order
  ]));
  const previous = keyed(previousOrders);
  const next = keyed(nextOrders);
  const changed = new Set();
  new Set([...previous.keys(), ...next.keys()]).forEach(key => {
    const before = previous.get(key);
    const after = next.get(key);
    if (
      before
      && after
      && candidateOrderRenderFingerprint(before) === candidateOrderRenderFingerprint(after)
    ) {
      return;
    }
    if (before) changed.add(before.status || 'received');
    if (after) changed.add(after.status || 'received');
  });
  return changed;
}

function refreshVisibleRelativeTimes() {
  const ordersByName = new Map(allOrders.map(order => [order.name, order]));
  document.querySelectorAll('.card[data-order-id] .time-ago-pill').forEach(pill => {
    const orderName = pill.closest('.card')?.dataset.orderId;
    const order = ordersByName.get(orderName);
    if (order?.receivedAt) pill.textContent = timeAgo(order.receivedAt);
  });
}

/**
 * Render one status column from the cached allOrders array.
 * @param {string} status - Queue status represented by the target column.
 */
function orderIsVisibleOnOperationalBoard(order) {
  if (!order?._candidate) return true;
  const fulfillment = String(order.displayFulfillmentStatus || '').trim().toUpperCase();
  if (fulfillment !== 'FULFILLED') return true;
  // Intentionally completed production remains visible in Printed until the
  // operator archives it. Fulfilled commerce records with a default workflow
  // stage must not re-enter the active pipeline.
  return order.productionStage === 'completed';
}

function renderStatusColumn(status) {
  const config = STATUS_COLUMN_CONFIG[status];
  if (!config) return;

  const container = document.getElementById(config.containerId);
  if (!container) return;

  const orders = allOrders.filter(order => {
    if (!orderIsVisibleOnOperationalBoard(order)) return false;
    if ((order.status || 'received') !== status) return false;
    if (status !== 'print' || !order._candidate) return true;
    if (printViewForOrder(order) !== activePrintView) return false;
    return order.productionStage === 'completed'
      || String(order.displayFulfillmentStatus || '').toUpperCase() !== 'FULFILLED';
  });
  const groups = {};
  const singles = [];
  orders.forEach(order => {
    if (order.bundle) {
      if (!groups[order.bundle]) groups[order.bundle] = [];
      groups[order.bundle].push(order);
    } else {
      singles.push(order);
    }
  });

  const fragment = document.createDocumentFragment();
  sortBundlesByOldest(Object.entries(groups))
    .forEach(([name, bundleOrders]) => {
      fragment.appendChild(makeBundleCard(name, bundleOrders, config.bundleStyle));
    });
  singles.forEach(order => {
    fragment.appendChild(makeCard(order, config.cardStyle));
  });
  container.replaceChildren(fragment);

  if (config.countId) {
    document.getElementById(config.countId).textContent = orders.length;
  }
  if (status === 'toOrder') {
    updateSummary();
  }
  if (status === 'print') {
    syncPrintViewUi();
  }
}

/**
 * Refresh only the visible bundle modal body when its underlying orders change.
 * The board columns own their own DOM, so the modal needs a small parallel patch.
 */
function refreshOpenBundleModal() {
  const overlay = document.getElementById('bundle-overlay');
  if (!overlay || overlay.classList.contains('hidden')) return;

  const bundleName = document.getElementById('bundle-title')?.textContent || '';
  const container = document.getElementById('bundle-cards');
  if (!bundleName || !container) return;

  const bundleOrders = allOrders.filter(order =>
    order.bundle === bundleName && orderIsVisibleOnOperationalBoard(order)
  );
  const fragment = document.createDocumentFragment();
  bundleOrders.forEach(order => fragment.appendChild(makeCard(order, 'pipeline')));
  container.replaceChildren(fragment);
}

/**
 * Patch cached orders and return the board statuses that need to be repainted.
 * @param {string[]} orderNames - Names as they existed before the patch.
 * @param {Record<string, any>|((order: Record<string, any>) => Record<string, any>|void)} patcher
 * @returns {Set<string>} Statuses touched before or after the patch.
 */
function patchLocalOrders(orderNames, patcher) {
  const names = new Set((orderNames || []).filter(Boolean));
  const touchedStatuses = new Set();
  if (!names.size) return touchedStatuses;

  allOrders.forEach(order => {
    if (!names.has(order.name)) return;
    touchedStatuses.add(order.status || 'received');
    const patch = typeof patcher === 'function' ? patcher(order) : patcher;
    if (patch && typeof patch === 'object') {
      Object.assign(order, patch);
    }
    touchedStatuses.add(order.status || 'received');
  });

  return touchedStatuses;
}

/**
 * Remove orders from local state and return only the columns that lost cards.
 * @param {string[]} orderNames - Queue order names to remove.
 * @returns {Set<string>} Statuses requiring a repaint.
 */
function removeLocalOrders(orderNames) {
  const names = new Set((orderNames || []).filter(Boolean));
  const touchedStatuses = new Set();
  if (!names.size) return touchedStatuses;

  allOrders = allOrders.filter(order => {
    if (!names.has(order.name)) return true;
    touchedStatuses.add(order.status || 'received');
    return false;
  });

  return touchedStatuses;
}

/**
 * Repaint only mutated columns from already-cached order data.
 * @param {Iterable<string>|string} statuses - Board statuses impacted by a mutation.
 * @param {{invalidateQueueLoads?: boolean}} [options] - Asset-only repaints preserve the active hydration run.
 */
async function renderBoardFromLocalState(statuses, { invalidateQueueLoads = true } = {}) {
  await renderBoard({ useLocalOrders: true, statuses, invalidateQueueLoads });
}

/**
 * Capture enough pointer and layout data to animate an invalid desktop drop
 * back to the original card slot after the browser's native drag image vanishes.
 * @param {HTMLElement} card - Card or bundle card being dragged.
 * @param {DragEvent} event - Native drag start event with pointer coordinates.
 */
function beginCardDrag(card, event) {
  const rect = card.getBoundingClientRect();
  const fallbackX = rect.left + rect.width / 2;
  const fallbackY = rect.top + rect.height / 2;
  const hasPointer = Number.isFinite(event.clientX)
    && Number.isFinite(event.clientY)
    && !(event.clientX === 0 && event.clientY === 0);
  const pointerX = hasPointer ? event.clientX : fallbackX;
  const pointerY = hasPointer ? event.clientY : fallbackY;

  activeCardDrag = {
    card,
    startRect: rect,
    offsetX: pointerX - rect.left,
    offsetY: pointerY - rect.top,
    currentX: pointerX,
    currentY: pointerY,
    validDrop: false
  };
}

/**
 * Track the latest cursor position while dragging so invalid drops can animate
 * from the user's actual release point instead of from the original card slot.
 * @param {DragEvent} event - Drag or dragover event carrying cursor coordinates.
 */
function updateActiveCardDragPosition(event) {
  const hasPointer = Number.isFinite(event?.clientX)
    && Number.isFinite(event?.clientY)
    && !(event.clientX === 0 && event.clientY === 0);
  if (!activeCardDrag || !hasPointer) return;
  activeCardDrag.currentX = event.clientX;
  activeCardDrag.currentY = event.clientY;
}

/**
 * Mark the current drag as handled by a real drop zone so dragend cleanup skips
 * the invalid-drop return animation.
 */
function markActiveDragDropAccepted() {
  if (activeCardDrag) {
    activeCardDrag.validDrop = true;
  }
}

/**
 * Draw a temporary copy at the release point and animate it to the card's
 * starting rectangle. The real card is restored immediately for interaction.
 */
function animateInvalidDropReturn() {
  if (!activeCardDrag?.card?.isConnected) return;

  const { card, startRect, offsetX, offsetY, currentX, currentY } = activeCardDrag;
  const ghost = card.cloneNode(true);
  ghost.removeAttribute('id');
  ghost.draggable = false;
  ghost.setAttribute('aria-hidden', 'true');
  ghost.classList.remove('dragging');
  ghost.classList.add('drop-return-ghost');

  const fromLeft = (currentX || startRect.left + offsetX) - offsetX;
  const fromTop = (currentY || startRect.top + offsetY) - offsetY;
  ghost.style.left = '0';
  ghost.style.top = '0';
  ghost.style.width = `${startRect.width}px`;
  ghost.style.height = `${startRect.height}px`;
  ghost.style.transform = `translate3d(${fromLeft}px, ${fromTop}px, 0) scale(1.03)`;
  document.body.appendChild(ghost);

  requestAnimationFrame(() => {
    ghost.style.transform = `translate3d(${startRect.left}px, ${startRect.top}px, 0) scale(1)`;
    ghost.style.opacity = '0';
  });

  window.setTimeout(() => ghost.remove(), 260);
}

/**
 * Clear drag styling and optionally play the invalid-drop return animation.
 * @param {HTMLElement|null} card - Card whose drag just ended.
 */
function finishCardDrag(card = null) {
  if (!activeCardDrag && !card) return;
  const draggedCard = card || activeCardDrag?.card;
  if (draggedCard) draggedCard.classList.remove('dragging');
  document.body.classList.remove('dragging-cursor');

  if (activeCardDrag && !activeCardDrag.validDrop) {
    animateInvalidDropReturn();
  }

  activeCardDrag = null;
}

// shrink the font size of `el` until its text fits on one line
function shrinkTextToFit(el, min = 8) {
  if (!el) return;
  let size = parseFloat(getComputedStyle(el).fontSize);
  while (el.scrollWidth > el.offsetWidth && size > min) {
    size -= 0.5;
    el.style.fontSize = size + 'px';
  }
}

// shorten name to first name + last initial if it wraps
function shortenNameIfWrapped(el) {
  if (!el) return;
  const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
  if (el.scrollHeight > lineHeight * 1.1) {
    const txt = el.textContent.trim();
    const idx = txt.indexOf(' ');
    if (idx > 0 && idx < txt.length - 1) {
      el.textContent = `${txt.slice(0, idx)} ${txt[idx + 1]}.`;
    }
  }
}

// Legacy queue records predate the current money-field contract and can retain
// string values such as "50.00". Rendering must never turn that data-shape
// issue into a post-save failure after the mutation has already succeeded.
function formatCardMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toFixed(2) : '0.00';
}

function sourceBadgeMarkup(order) {
  const provider = String(order?._provider || order?.source?.provider || 'shopify').toLowerCase();
  const label = provider === 'etsy' ? 'Etsy' : 'PrintMO';
  const test = order?._synthetic ? '<span class="order-test-badge">TEST</span>' : '';
  return `<span class="source-badge-group"><span class="order-source-badge source-${provider}">${label}</span>${test}</span>`;
}

// build a card from the record’s `items` array
function makeCard(o, style = 'default') {
  const card = document.createElement('div');
  card.className   = 'card';
  card.draggable   = true;
  card.dataset.orderId = o.name;
  card.dataset.orderKey = o._orderKey || o._gid || o.name;
  card.dataset.provider = o._provider || 'shopify';
  card.classList.add(`source-${o._provider || 'shopify'}`);
  if (o._synthetic) card.classList.add('synthetic-order');

  // split “#1234 – John Smith”
  const [orderNum, custNameRaw] = o.name.split(' – ');
  const custName = custNameRaw || '';

  // count apparel vs prints
  let apparel = 0, prints = 0, other = 0;
  (o.items || []).forEach(it => {
    if (isPrintItem(it)) prints += it.qty;
    else if (isGarmentItem(it)) apparel += it.qty;
    else other += it.qty;
  });
  const firstMockupUrl = getFirstMockupUrl(o);
  const hasMockup = !!firstMockupUrl;
  const showBoardPreview = hasMockup || Boolean(o._candidate);
  const boardPreviewState = getProductionMockupState(o, hasMockup);
  const productionCompleteBadge = o.productionStage === 'completed'
    ? '<span class="card-status-badge production-complete">Production complete</span>'
    : '';

  if (style === 'pipeline') {
    // PIPELINE style
    card.classList.add('pipeline-card');
    card.innerHTML = `
      <div class="card-header">
        <span class="order-number">${orderNum}</span>
        ${sourceBadgeMarkup(o)}
        ${productionCompleteBadge}
        <span class="time-ago-pill">${timeAgo(o.receivedAt)}</span>
      </div>
      <div class="card-body ${showBoardPreview ? 'has-mockup' : 'no-mockup'} production-preview-${boardPreviewState}">
        ${showBoardPreview ? productionMockupSlotMarkup(firstMockupUrl, boardPreviewState, orderNum) : ''}
        <div class="production-card-statuses"></div>
        <div class="cust-name">${custName}</div>
        <div class="counts">
          <span class="apparel-count"><img class="count-icon" src="${o.blanksOrdered ? APPAREL_ICON_GREEN : APPAREL_ICON}" alt="" /> ${apparel}</span>
          <span class="prints-count"><img class="count-icon" src="${o.printsOrdered ? PRINT_ICON_GREEN : PRINT_ICON}" alt="" /> ${prints}</span>
          ${other ? `<span class="other-count">Other ${other}</span>` : ''}
        </div>
      </div>
      <div class="card-footer">
        <span class="footer-label">Subtotal</span>
        <span class="footer-value">$${formatCardMoney(o.subtotal)}</span>
      </div>
    `;
    requestAnimationFrame(() => {
      card.querySelectorAll('.cust-name').forEach(shortenNameIfWrapped);
    });
    const hdr = card.querySelector('.card-header');
    const ftr = card.querySelector('.card-footer');
    let cls = '';
    if (o.blanksStatus && o.printsStatus) cls = 'status-green';
    else if (o.blanksStatus || o.printsStatus) cls = 'status-yellow';
    if (cls) {
      hdr.classList.add(cls);
      if (ftr) ftr.classList.add(cls);
    }
  } else if (style === 'printProgress') {
    // Ready to Print style with progress percentage
    const totalApparel = (o.items || []).reduce((sum, it) => sum + (isGarmentItem(it) ? it.qty : 0), 0);
    const prog = typeof o.progress === 'number' ? o.progress : 0;
    const pct = totalApparel ? Math.round((prog / totalApparel) * 100) : 0;
    const showProductionPreview = Boolean(o._candidate);
    const productionMockupState = getProductionMockupState(o, hasMockup);
    card.classList.add('pipeline-card', 'print-card');
    card.innerHTML = `
      <div class="card-header">
        <span class="order-number">${orderNum}</span>
        ${sourceBadgeMarkup(o)}
        <span class="time-ago-pill">${timeAgo(o.receivedAt)}</span>
      </div>
      <div class="card-body ${showProductionPreview ? 'has-mockup' : 'no-mockup'} production-preview-${productionMockupState}">
        ${showProductionPreview ? productionMockupSlotMarkup(firstMockupUrl, productionMockupState, orderNum) : ''}
        <div class="print-card-details">
          <div class="print-card-statuses production-card-statuses">
            ${productionCompleteBadge}
          </div>
          <div class="progress-view">
            <div class="cust-name">${custName}</div>
            <div class="progress-row">
              <div class="progress-pct">${pct}%</div>
              <div class="progress-count">${prog} / ${totalApparel}</div>
            </div>
          </div>
        </div>
        <div class="normal-view">
          <div class="cust-name">${custName}</div>
          <div class="counts">
            <span class="apparel-count"><img class="count-icon" src="${o.blanksOrdered ? APPAREL_ICON_GREEN : APPAREL_ICON}" alt="" /> ${apparel}</span>
            <span class="prints-count"><img class="count-icon" src="${o.printsOrdered ? PRINT_ICON_GREEN : PRINT_ICON}" alt="" /> ${prints}</span>
            ${other ? `<span class="other-count">Other ${other}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="card-footer">
        <span class="footer-label">Subtotal</span>
        <span class="footer-value">$${formatCardMoney(o.subtotal)}</span>
      </div>
    `;
    requestAnimationFrame(() => {
      card.querySelectorAll('.cust-name').forEach(shortenNameIfWrapped);
    });
    const hdr = card.querySelector('.card-header');
    const ftr = card.querySelector('.card-footer');
    let cls = '';
    if (o.blanksStatus && o.printsStatus) cls = 'status-green';
    else if (o.blanksStatus || o.printsStatus) cls = 'status-yellow';
    if (cls) {
      hdr.classList.add(cls);
      if (ftr) ftr.classList.add(cls);
    }
  } else if (style === 'picked') {
    // picked card style for middle section
    card.classList.add('pipeline-card');
    card.innerHTML = `
      <div class="card-header"><span class="cust-name">${custName}</span>${sourceBadgeMarkup(o)}</div>
      <div class="card-body picked-body">
        <div class="counts"><strong>${apparel}</strong></div>
      </div>
    `;
    requestAnimationFrame(() => {
      const nameEl = card.querySelector('.cust-name');
      shrinkTextToFit(nameEl);
      shortenNameIfWrapped(nameEl);
      shrinkTextToFit(card.querySelector('.counts strong'), 10);
    });
    const hdr = card.querySelector('.card-header');
    let cls = '';
    if (o.blanksStatus && o.printsStatus) cls = 'status-green';
    else if (o.blanksStatus || o.printsStatus) cls = 'status-yellow';
    if (cls) hdr.classList.add(cls);
  } else {
    // DEFAULT style (your existing square card)
    card.innerHTML = `
      <div class="order-number">${orderNum}</div>
      ${sourceBadgeMarkup(o)}
      <div class="order-cust">${custName}</div>
      <div class="counts">Apparel: ${apparel}, Prints: ${prints}</div>
    `;
    requestAnimationFrame(() => {
      card.querySelectorAll('.order-cust').forEach(shortenNameIfWrapped);
    });
  }

  const mockupSlot = card.querySelector('.mockup-slot');
  const mockupAssetIdentity = getFirstMockupAssetIdentity(o);
  if (mockupSlot && mockupAssetIdentity) mockupSlot.dataset.assetId = mockupAssetIdentity;
  trackBoardMockupImage(mockupSlot?.querySelector('img'));

  card.style.position = 'relative';

  const del = document.createElement('button');
  del.className   = 'delete-btn';
  del.textContent = '×';
  del.title       = 'Delete this order';
  del.addEventListener('click', async e => {
    e.stopPropagation();
    if (confirm(`Delete ${o.name}?`)) {
      await window.api.deleteOrder(o.name);
      const touchedStatuses = removeLocalOrders([o.name]);
      if (detailOrder?.name === o.name) closeDetail();
      await renderBoardFromLocalState(touchedStatuses);
    }
  });
  card.appendChild(del);

  // drag handlers
  card.addEventListener('dragstart', e => {
    document.body.classList.add('dragging-cursor');
    card.classList.add('dragging');
    beginCardDrag(card, e);
    e.dataTransfer.setData('text/plain', o.name);
  });

  card.addEventListener('drag', updateActiveCardDragPosition);
  card.addEventListener('dragend', () => finishCardDrag(card));

  if (card.classList.contains('pipeline-card')) {
    const delay = (Math.random() * 3).toFixed(2) + 's';
    card.style.setProperty('--shimmer-delay', delay);
  }

  card.addEventListener('click', () => openDetail(o));

  return card;
}

function makeBundleCard(name, orders, style = 'pipeline') {
  const card = document.createElement('div');
  card.className = 'card bundle-card pipeline-card';
  card.dataset.bundleName = name;
  card.draggable = true;

  let allReady = true,
      anyReady = false;
  orders.forEach(o => {
    if (!(o.blanksStatus && o.printsStatus)) allReady = false;
    if (o.blanksStatus || o.printsStatus) anyReady = true;
  });

  let bodyHtml = `<div class="counts"><strong>${orders.length} Orders</strong></div>`;
  if (style === 'picked') {
    let apparel = 0;
    orders.forEach(o => (o.items || []).forEach(it => {
      if (isGarmentItem(it)) apparel += it.qty;
    }));
    bodyHtml = `<div class="counts"><strong>${apparel}</strong></div>`;
  }
  card.innerHTML = `
    <div class="card-header"><span class="cust-name">${name}</span></div>
    <div class="card-body">${bodyHtml}</div>
  `;

  if (allReady) card.classList.add('status-green');
  else if (anyReady) card.classList.add('status-yellow');

  card.addEventListener('click', () => openBundleModal(name, orders));

  card.addEventListener('dragstart', e => {
    document.body.classList.add('dragging-cursor');
    card.classList.add('dragging');
    beginCardDrag(card, e);
    e.dataTransfer.setData('text/plain', `bundle:${name}`);
  });

  card.addEventListener('drag', updateActiveCardDragPosition);
  card.addEventListener('dragend', () => finishCardDrag(card));

  return card;
}

function openBundleModal(name, orders) {
  const overlay = document.getElementById('bundle-overlay');
  document.getElementById('bundle-title').textContent = name;
  const container = document.getElementById('bundle-cards');
  container.innerHTML = '';
  orders.forEach(o => container.appendChild(makeCard(o, 'pipeline')));
  const destroyBtn = document.getElementById('bundle-destroy');
  destroyBtn.onclick = async () => {
    if (!confirm(`Destroy bundle "${name}"?`)) return;
    const ids = orders.map(o => o.name);
    await window.api.setBundle(ids, '');
    const touchedStatuses = patchLocalOrders(ids, { bundle: '' });
    closeBundleModal();
    await renderBoardFromLocalState(touchedStatuses);
  };
  const onOverlayClick = e => {
    if (e.target.id === 'bundle-overlay') closeBundleModal();
  };
  overlay.classList.remove('hidden');
  overlay.onclick = onOverlayClick;
}

function closeBundleModal() {
  const overlay = document.getElementById('bundle-overlay');
  overlay.classList.add('hidden');
  overlay.onclick = null;
}

const ASSET_PREVIEW_MAX_ATTEMPTS = 3;
const ASSET_PREVIEW_RETRY_DELAY = 800;

function cleanupDetailAssetPreviews() {
  detailAssetBlobUrls.forEach(url => URL.revokeObjectURL(url));
  detailAssetBlobUrls.clear();
}

function detailAssetFilename(url, idx) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  } catch (err) {
    // ignore parse issues
  }
  return `order-asset-${idx + 1}`;
}

function assetLabelFromUrl(url, idx) {
  const base = detailAssetFilename(url, idx);
  const noQuery = base.split('?')[0];
  const trimmed = noQuery.replace(/\.(png|svg|jpe?g)$/i, '');
  return trimmed || base;
}

function getAssetUrlValue(asset) {
  if (typeof asset === 'string') return asset;
  if (asset && typeof asset.url === 'string') return asset.url;
  return '';
}

function getAssetDimensionsIn(asset) {
  const url = getAssetUrlValue(asset);
  const meta = asset && typeof asset === 'object'
    ? (typeof asset.metadata === 'object' && asset.metadata) || (typeof asset.meta === 'object' && asset.meta) || null
    : null;
  const candidates = [
    // query param on the asset URL if present
    (() => {
      if (!url) return '';
      try {
        const params = new URL(url).searchParams;
        return params.get('dimensionsin') || params.get('dimensionsIn') || '';
      } catch (err) {
        return '';
      }
    })(),
    asset && typeof asset === 'object' ? asset.dimensionsIn : undefined,
    asset && typeof asset === 'object' ? asset.dimensionsin : undefined,
    meta && meta.dimensionsIn,
    meta && meta.dimensionsin,
  ];
  for (const val of candidates) {
    if (typeof val === 'string' && val.trim()) return val.trim();
    if (typeof val === 'number' && Number.isFinite(val)) return String(val);
  }
  const findByKey = obj => {
    if (!obj || typeof obj !== 'object') return '';
    for (const [k, v] of Object.entries(obj)) {
      if (typeof k === 'string' && k.toLowerCase() === 'dimensionsin') {
        if (typeof v === 'string' && v.trim()) return v.trim();
        if (typeof v === 'number' && Number.isFinite(v)) return String(v);
      }
    }
    return '';
  };
  const metaKey = findByKey(meta);
  if (metaKey) return metaKey;
  const directKey = asset && typeof asset === 'object' ? findByKey(asset) : '';
  if (directKey) return directKey;
  return '';
}

function designLabelFromAsset(assetEntry, idx) {
  const dims = getAssetDimensionsIn(assetEntry);
  if (dims) return dims;
  const url = getAssetUrlValue(assetEntry);
  return assetLabelFromUrl(url, idx);
}

function orderNumberFromOrder(order) {
  const explicit = String(order?.orderNumber || '').replace(/^#/, '').trim();
  if (explicit) return explicit;
  const match = String(order?.name || '').match(/^#?(\d+)/);
  return match ? match[1] : '';
}

function normalizeManualMockupAsset(asset) {
  if (!asset || typeof asset !== 'object' || typeof asset.url !== 'string' || !asset.url) return null;
  return { ...asset, isManual: true, isSvg: false };
}

function manualMockupSignature(assets) {
  return (assets || []).map(asset => [
    asset.id || '',
    asset.key || '',
    asset.uploadedAt || '',
    asset.filename || ''
  ].join(':')).join('|');
}

function setManualMockups(orderNumber, assets) {
  const next = (Array.isArray(assets) ? assets : []).map(normalizeManualMockupAsset).filter(Boolean);
  const changed = manualMockupSignature(manualMockupsByOrderNumber.get(orderNumber)) !== manualMockupSignature(next);
  manualMockupsByOrderNumber.set(orderNumber, next);
  return changed;
}

function getManualMockupsForOrder(order) {
  return manualMockupsByOrderNumber.get(orderNumberFromOrder(order)) || [];
}

async function refreshManualMockupsForOrder(order) {
  const orderNumber = orderNumberFromOrder(order);
  if (!orderNumber || typeof window.api?.listManualMockups !== 'function') return false;
  manualMockupHydrationRun += 1;
  const manifest = await window.api.listManualMockups(orderNumber);
  manualMockupsHydratedOrderNumbers.add(orderNumber);
  return setManualMockups(orderNumber, manifest?.assets || []);
}

function reconcileManualMockupCard(order, changed, wasHydrated) {
  if (!order || (!changed && wasHydrated)) return;
  if (typeof window.updateBoardMockupPreview === 'function') {
    window.updateBoardMockupPreview(order, { resolvePlaceholder: true });
    return;
  }
  // Compatibility fallback for hosts that have not loaded the shared card
  // updater. Only actual asset changes warrant rebuilding a status column.
  if (changed) void renderBoardFromLocalState([order.status || 'received'], { invalidateQueueLoads: false });
}

async function hydrateManualMockupsForOrders(orders, { refresh = false } = {}) {
  if (typeof window.api?.bulkListManualMockups !== 'function') return;
  const knownOrderNumbers = Array.from(new Set((orders || []).map(orderNumberFromOrder).filter(Boolean)));
  if (refresh) {
    knownOrderNumbers.forEach(orderNumber => manualMockupsHydratedOrderNumbers.delete(orderNumber));
  }
  const orderNumbers = knownOrderNumbers
    .filter(orderNumber =>
      !manualMockupsHydratedOrderNumbers.has(orderNumber)
      && !manualMockupsHydratingOrderNumbers.has(orderNumber)
    );
  if (!orderNumbers.length) return;
  orderNumbers.forEach(orderNumber => manualMockupsHydratingOrderNumbers.add(orderNumber));
  const ordersByNumber = new Map((orders || []).map(order => [orderNumberFromOrder(order), order]));
  const run = ++manualMockupHydrationRun;
  try {
    const result = await window.api.bulkListManualMockups(orderNumbers, {
      onOrder: (orderNumber, manifest) => {
        if (run !== manualMockupHydrationRun || !orderNumber) return;
        const wasHydrated = manualMockupsHydratedOrderNumbers.has(orderNumber);
        const changed = setManualMockups(orderNumber, manifest?.assets || []);
        manualMockupsHydratedOrderNumbers.add(orderNumber);
        manualMockupsHydratingOrderNumbers.delete(orderNumber);
        const order = ordersByNumber.get(orderNumber);
        reconcileManualMockupCard(order, changed, wasHydrated);
      }
    });
    if (run !== manualMockupHydrationRun) return;
    (orders || []).forEach(order => {
      const orderNumber = orderNumberFromOrder(order);
      const wasHydrated = manualMockupsHydratedOrderNumbers.has(orderNumber);
      const changed = setManualMockups(orderNumber, result?.orders?.[orderNumber]?.assets || []);
      manualMockupsHydratedOrderNumbers.add(orderNumber);
      manualMockupsHydratingOrderNumbers.delete(orderNumber);
      reconcileManualMockupCard(order, changed, wasHydrated);
    });
  } catch (err) {
    console.warn('Unable to load manual mockups', err);
  } finally {
    orderNumbers.forEach(orderNumber => manualMockupsHydratingOrderNumbers.delete(orderNumber));
  }
}

function splitOrderAssets(order) {
  const seen = new Set();
  const buckets = { mockups: [], front: [], back: [], extras: [] };
  (order.items || []).forEach(item => {
    const assets = Array.isArray(item?.assets) ? item.assets : [];
    assets.forEach(asset => {
      const url = getAssetUrlValue(asset);
      if (typeof url !== 'string') return;
      const isPrivateManifest = Boolean(asset && typeof asset === 'object' && asset.assetId);
      if (!url.toLowerCase().includes('/orders/') && !isPrivateManifest) return;
      const norm = [
        url.toLowerCase(),
        String(asset?.role || '').toLowerCase(),
        String(asset?.side || '').toLowerCase()
      ].join('|');
      if (seen.has(norm)) return;
      seen.add(norm);

      const assetName = asset && typeof asset === 'object' ? String(asset.name || '') : '';
      const classify = `${assetName} ${url}`.toLowerCase();
      const isSvg = String(asset?.contentType || '').toLowerCase() === 'image/svg+xml' || /\.svg(\?|$)/i.test(classify);
      const isMockup = asset?.role === 'mockup' || /side\.png(\?|$)/i.test(classify);
      const isFront = asset?.side === 'front' || /(front\.(svg|png|jpe?g)|_front(?:\.[a-z0-9]+)?)(\?|$)/i.test(classify);
      const isBack = asset?.side === 'back' || /(back\.(svg|png|jpe?g)|_back(?:\.[a-z0-9]+)?)(\?|$)/i.test(classify);

      const metadata = asset && typeof asset === 'object'
        ? (typeof asset.metadata === 'object' && asset.metadata) || (typeof asset.meta === 'object' && asset.meta) || undefined
        : undefined;
      const dimensionsIn = getAssetDimensionsIn(asset);
      const entry = asset && typeof asset === 'object'
        ? { ...asset, url, isSvg }
        : { url, isSvg };
      if (metadata) entry.metadata = metadata;
      if (dimensionsIn) entry.dimensionsIn = dimensionsIn;
      if (isMockup) {
        buckets.mockups.push(entry);
      } else if (isFront) {
        buckets.front.push(entry);
      } else if (isBack) {
        buckets.back.push(entry);
      } else {
        buckets.extras.push(entry);
      }
    });
  });
  return buckets;
}

function getFirstMockupUrl(order) {
  const manual = getManualMockupsForOrder(order)[0];
  if (manual?.url) return manual.url;
  const assets = splitOrderAssets(order);
  const entry = assets.mockups[0];
  if (entry) return getAssetUrlValue(entry);
  const catalogPreview = (order?.items || []).map(item => item?.catalogPreview).find(preview => preview?.url);
  return catalogPreview?.url || '';
}

function candidateMockupManifests(order) {
  const assets = [
    ...(Array.isArray(order?.assets) ? order.assets : []),
    ...(order?.items || []).flatMap(item => Array.isArray(item?.assets) ? item.assets : [])
  ];
  const seen = new Set();
  return assets.filter(asset => {
    if (!asset || typeof asset !== 'object') return false;
    const key = asset.assetId || asset.id || `${asset.name || asset.filename || ''}:${asset.lineItemId || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (asset.role === 'mockup') return true;
    return /(?:^|[/_-])side\.(?:png|jpe?g|webp)(?:$|\?)/i.test(String(asset.name || asset.filename || ''));
  });
}

function getFirstMockupAssetIdentity(order) {
  const manual = getManualMockupsForOrder(order)[0];
  if (manual?.url) {
    const manualIdentity = manual.id || manual.key || manual.uploadedAt || manual.filename || manual.name;
    return manualIdentity ? `manual:${manualIdentity}` : '';
  }
  const asset = candidateMockupManifests(order)[0];
  if (asset?.assetId || asset?.id) return String(asset.assetId || asset.id);
  const catalogPreview = (order?.items || []).map(item => item?.catalogPreview).find(preview => preview?.previewId);
  return catalogPreview?.previewId ? `catalog:${catalogPreview.previewId}` : '';
}

function trackBoardMockupImage(image) {
  if (!image || image.dataset.previewLoadTracked === 'true') return;
  image.dataset.previewLoadTracked = 'true';
  image.addEventListener('load', () => {
    delete image.dataset.previewLoadFailed;
  });
  image.addEventListener('error', () => {
    image.dataset.previewLoadFailed = 'true';
    window.orderManagerPerformanceDebug?.log?.('tile-image-failed');
  });
}

function getProductionMockupState(order, hasMockup) {
  if (hasMockup) return 'ready';
  if (!order?._candidate) return 'unavailable';
  const catalogPreviews = (order?.items || []).map(item => item?.catalogPreview).filter(Boolean);
  if (catalogPreviews.length) {
    return catalogPreviews.some(preview => preview._previewState !== 'failed') ? 'loading' : 'unavailable';
  }
  const pendingDesignerMockup = candidateMockupManifests(order)
    .some(asset => asset._previewState !== 'failed');
  const manualHydrated = manualMockupsHydratedOrderNumbers.has(orderNumberFromOrder(order));
  return pendingDesignerMockup || !manualHydrated ? 'loading' : 'unavailable';
}

function productionMockupSlotMarkup(url, state, orderNumber) {
  if (state === 'ready' && url) {
    return `
      <div class="mockup-slot mockup-slot-ready">
        <img src="${url}" alt="Mockup preview for order ${orderNumber}" loading="eager" decoding="async" fetchpriority="high" />
      </div>
    `;
  }
  const label = state === 'loading' ? 'Loading preview' : 'No preview';
  const ariaLabel = state === 'loading'
    ? `Preview image for order ${orderNumber} is loading`
    : `No preview image is available for order ${orderNumber}`;
  return `
    <div class="mockup-slot mockup-slot-${state}" aria-label="${ariaLabel}">
      <span class="mockup-placeholder-label" aria-hidden="true">${label}</span>
    </div>
  `;
}

function updateBoardMockupPreview(order, { resolvePlaceholder = false } = {}) {
  if (!order?.name) return false;
  const url = getFirstMockupUrl(order);
  if (!url && !resolvePlaceholder) return false;
  const orderNumber = String(order.orderNumber || order.name.match(/^#?(\d+)/)?.[1] || order.name).replace(/^#/, '');
  const state = getProductionMockupState(order, Boolean(url));
  const assetIdentity = getFirstMockupAssetIdentity(order);
  let updated = false;
  let preservedSources = 0;

  document.querySelectorAll('.card[data-order-id]').forEach(card => {
    if (card.dataset.orderId !== order.name) return;
    const body = card.querySelector('.card-body');
    if (!body) return;
    if (!url && !card.classList.contains('print-card')) return;

    let slot = body.querySelector('.mockup-slot');
    if (!slot) {
      slot = document.createElement('div');
      body.insertBefore(slot, body.firstChild);
      updated = true;
    }
    const existingImage = slot.querySelector('img');
    const existingSource = existingImage?.getAttribute('src') || '';
    const existingIdentity = slot.dataset.assetId || '';
    const preserveExistingSource = Boolean(
      existingImage
      && existingSource
      && assetIdentity
      && existingIdentity === assetIdentity
      && existingImage.dataset.previewLoadFailed !== 'true'
    );
    const renderedState = preserveExistingSource ? 'ready' : state;
    slot.className = `mockup-slot mockup-slot-${renderedState}`;
    if (assetIdentity) slot.dataset.assetId = assetIdentity;
    else delete slot.dataset.assetId;

    if (preserveExistingSource) {
      slot.removeAttribute('aria-label');
      trackBoardMockupImage(existingImage);
      existingImage.setAttribute('alt', `Mockup preview for order ${orderNumber}`);
      if (url && existingSource !== url) preservedSources += 1;
    } else if (url) {
      slot.removeAttribute('aria-label');
      let image = existingImage;
      if (!image) {
        image = document.createElement('img');
        slot.replaceChildren(image);
        updated = true;
      }
      trackBoardMockupImage(image);
      if (image.getAttribute('src') !== url) {
        image.setAttribute('src', url);
        updated = true;
      }
      image.setAttribute('alt', `Mockup preview for order ${orderNumber}`);
      image.setAttribute('loading', 'eager');
      image.setAttribute('decoding', 'async');
      image.setAttribute('fetchpriority', 'high');
    } else {
      const loading = state === 'loading';
      slot.setAttribute('aria-label', loading
        ? `Preview image for order ${orderNumber} is loading`
        : `No preview image is available for order ${orderNumber}`);
      const label = document.createElement('span');
      label.className = 'mockup-placeholder-label';
      label.setAttribute('aria-hidden', 'true');
      label.textContent = loading ? 'Loading preview' : 'No preview';
      slot.replaceChildren(label);
      updated = true;
    }

    body.classList.remove('no-mockup', 'production-preview-ready', 'production-preview-loading', 'production-preview-unavailable');
    body.classList.add('has-mockup');
    if (card.classList.contains('print-card')) body.classList.add(`production-preview-${renderedState}`);
  });

  if (preservedSources) {
    window.orderManagerPerformanceDebug?.log?.('tile-preview-source-preserved', {
      count: preservedSources
    });
  }

  return updated;
}

window.updateBoardMockupPreview = updateBoardMockupPreview;

function addCacheBustParam(url, attempt) {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}cb=${Date.now()}_${attempt}`;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchAssetBlobWithRetry(url, attempts = ASSET_PREVIEW_MAX_ATTEMPTS, delayMs = ASSET_PREVIEW_RETRY_DELAY) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const resp = await fetch(url, { cache: 'no-store' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.blob();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await delay(delayMs);
      }
    }
  }
  throw lastErr;
}

async function loadSvgPreview(url, token) {
  const blob = await fetchAssetBlobWithRetry(url);
  const objectUrl = URL.createObjectURL(blob);
  if (token !== detailAssetRenderToken) {
    URL.revokeObjectURL(objectUrl);
    return null;
  }
  detailAssetBlobUrls.add(objectUrl);
  return objectUrl;
}

function loadRasterPreview(img, url, token, onFail) {
  let attempt = 0;
  const setSrc = () => {
    if (token !== detailAssetRenderToken) return;
    attempt += 1;
    img.src = attempt === 1 ? url : addCacheBustParam(url, attempt);
  };
  const handleError = () => {
    if (token !== detailAssetRenderToken) return;
    if (attempt < ASSET_PREVIEW_MAX_ATTEMPTS) {
      setTimeout(setSrc, ASSET_PREVIEW_RETRY_DELAY);
    } else if (typeof onFail === 'function') {
      onFail();
    }
  };
  img.addEventListener('error', handleError);
  img.addEventListener('load', () => {
    img.dataset.loaded = 'true';
  }, { once: true });
  setSrc();
}

function openAssetViewer(url) {
  const overlay = document.getElementById('asset-viewer');
  const img = document.getElementById('asset-viewer-img');
  if (!overlay || !img) return;
  img.src = url;
  overlay.classList.remove('hidden');
}

function closeAssetViewer() {
  const overlay = document.getElementById('asset-viewer');
  const img = document.getElementById('asset-viewer-img');
  if (!overlay || !img) return;
  img.src = '';
  overlay.classList.add('hidden');
}

async function handleAssetDownload(asset, filename, btn) {
  if (!window.api || typeof window.api.downloadAsset !== 'function') {
    alert('Download is not available in this build.');
    return;
  }
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Downloading...';
  try {
    await window.api.downloadAsset(
      getAssetUrlValue(asset),
      filename,
      asset && typeof asset === 'object' ? asset.assetId : undefined
    );
  } catch (err) {
    console.error('Failed to download asset', err);
    alert(`Download failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function renderOrderAssets(order) {
  const mockupTrack = document.getElementById('detail-mockups-track');
  const mockupPlaceholder = document.getElementById('detail-mockups-placeholder');
  const designPlaceholder = document.getElementById('detail-designs-placeholder');
  const lists = {
    front: document.getElementById('design-front-list'),
    back: document.getElementById('design-back-list'),
    extras: document.getElementById('design-extras-list'),
  };
  const groups = {
    front: document.getElementById('design-group-front'),
    back: document.getElementById('design-group-back'),
    extras: document.getElementById('design-group-extras'),
  };
  const mockupFeature = document.getElementById('detail-mockup-feature');
  const mockupMain = document.getElementById('detail-mockup-main');
  const mockupMainContent = document.getElementById('detail-mockup-main-content');
  const mockupCount = document.getElementById('detail-mockup-count');
  const mockupDots = document.getElementById('detail-mockup-dots');

  if (!mockupTrack || !mockupPlaceholder || !designPlaceholder ||
      !lists.front || !lists.back || !lists.extras ||
      !groups.front || !groups.back || !groups.extras) return;

  const token = ++detailAssetRenderToken;
  cleanupDetailAssetPreviews();
  mockupTrack.innerHTML = '';
  if (mockupDots) mockupDots.innerHTML = '';
  Object.values(lists).forEach(list => { list.innerHTML = ''; });
  Object.values(groups).forEach(g => g.classList.remove('hidden'));

  const assets = splitOrderAssets(order);
  const catalogPreviews = (order?.items || [])
    .map(item => ({
      preview: item?.catalogPreview,
      label: item?.variantTitle || item?.properties?.Color || '',
      lineItemId: item?.id || ''
    }))
    .filter(entry => entry.preview?.previewId && entry.preview?.url)
    .map(entry => ({
      id: `catalog:${entry.preview.previewId}`,
      url: entry.preview.url,
      isCatalogPreview: true,
      catalogLabel: entry.label,
      lineItemIds: entry.lineItemId ? [entry.lineItemId] : [],
    }));
  const mockupSources = [
    ...getManualMockupsForOrder(order),
    ...assets.mockups.map(asset => ({ ...asset, isManual: false })),
    ...catalogPreviews,
  ];
  const mockupsByIdentity = new Map();
  mockupSources.forEach((asset, index) => {
    const identity = asset.isCatalogPreview
      ? asset.id
      : asset.isManual
        ? `manual:${asset.id || asset.url || index}`
        : asset.assetId || asset.id || asset.url || `mockup:${index}`;
    const lineItemIds = [
      ...(Array.isArray(asset.lineItemIds) ? asset.lineItemIds : []),
      asset.lineItemId
    ].filter(Boolean);
    const existing = mockupsByIdentity.get(identity);
    if (existing) {
      existing.lineItemIds = [...new Set([...existing.lineItemIds, ...lineItemIds])];
      return;
    }
    mockupsByIdentity.set(identity, { ...asset, lineItemIds: [...new Set(lineItemIds)] });
  });
  const mockups = [...mockupsByIdentity.values()];

  if (!mockups.length) {
    if (mockupFeature) mockupFeature.classList.add('hidden');
    if (mockupDots) mockupDots.classList.add('hidden');
    mockupTrack.classList.remove('left-align', 'center-align');
    mockupPlaceholder.classList.remove('hidden');
    if (mockupCount) mockupCount.textContent = '0 mockups';
  } else {
    if (mockupFeature) mockupFeature.classList.remove('hidden');
    mockupPlaceholder.classList.add('hidden');
    mockupTrack.classList.remove('left-align', 'center-align');
    mockupTrack.classList.add(mockups.length >= 4 ? 'left-align' : 'center-align');

    let activeIndex = 0;
    const loadedUrls = new Array(mockups.length).fill(null);
    const thumbElements = [];
    const dotElements = [];

    const updateStage = (index) => {
      activeIndex = index;
      const targetUrl = loadedUrls[index] || mockups[index].url;
      if (mockupMainContent) {
        const featuredImage = document.createElement('img');
        featuredImage.src = targetUrl;
        const entry = mockups[index];
        featuredImage.alt = entry.isCatalogPreview
          ? `Etsy catalog preview${entry.catalogLabel ? ` — ${entry.catalogLabel}` : ''}`
          : `Mockup ${index + 1} of ${mockups.length}`;
        mockupMainContent.replaceChildren(featuredImage);
      }
      if (mockupMain) {
        mockupMain.onclick = () => openAssetViewer(targetUrl);
      }
      if (mockupCount) {
        mockupCount.textContent = `${index + 1} of ${mockups.length} mockup${mockups.length === 1 ? '' : 's'}`;
      }
      thumbElements.forEach((el, i) => {
        const isSelected = i === index;
        el.classList.toggle('is-selected', isSelected);
        el.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
      });
      dotElements.forEach((dot, i) => {
        const isActive = i === index;
        dot.classList.toggle('is-active', isActive);
        dot.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
    };

    if (mockupDots) {
      if (mockups.length > 1) {
        mockupDots.classList.remove('hidden');
        mockups.forEach((_, idx) => {
          const dot = document.createElement('button');
          dot.type = 'button';
          dot.className = `mockup-dot${idx === 0 ? ' is-active' : ''}`;
          dot.setAttribute('aria-label', `Show mockup ${idx + 1} of ${mockups.length}`);
          dot.setAttribute('aria-pressed', idx === 0 ? 'true' : 'false');
          dot.onclick = () => updateStage(idx);
          mockupDots.appendChild(dot);
          dotElements.push(dot);
        });
      } else {
        mockupDots.classList.add('hidden');
      }
    }

    mockups.forEach((asset, idx) => {
      const { url, isSvg, isManual } = asset;
      if (token !== detailAssetRenderToken) return;
      const thumb = document.createElement('div');
      thumb.className = `mockup-thumb${isManual ? ' manual-mockup-thumb' : ''}${idx === 0 ? ' is-selected' : ''}`;
      thumb.tabIndex = 0;
      thumb.setAttribute('role', 'button');
      thumb.setAttribute('aria-label', asset.isCatalogPreview
        ? `Show Etsy catalog preview${asset.catalogLabel ? ` — ${asset.catalogLabel}` : ''}`
        : `Show mockup ${idx + 1} of ${mockups.length}`);
      thumb.setAttribute('aria-pressed', idx === 0 ? 'true' : 'false');
      thumb.dataset.lineItemIds = (asset.lineItemIds || []).join('|');
      thumb.dataset.mockupScope = asset.isCatalogPreview ? 'catalog-preview' : asset.isManual ? 'order-level' : 'linked-artwork';

      const img = document.createElement('img');
      img.alt = asset.isCatalogPreview
        ? `Etsy catalog preview${asset.catalogLabel ? ` — ${asset.catalogLabel}` : ''}`
        : `Mockup ${idx + 1}`;
      img.loading = 'lazy';
      thumb.appendChild(img);
      thumbElements.push(thumb);

      thumb.addEventListener('click', () => updateStage(idx));
      thumb.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        updateStage(idx);
      });
      if (isManual) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'manual-mockup-delete';
        remove.dataset.assetId = asset.id || '';
        remove.title = 'Remove mockup';
        remove.setAttribute('aria-label', 'Remove mockup');
        remove.textContent = '×';
        remove.addEventListener('click', async event => {
          event.preventDefault();
          event.stopPropagation();
          if (!confirm(`Remove "${asset.filename || 'this mockup'}"?`)) return;
          try {
            await window.api.deleteManualMockup(orderNumberFromOrder(order), asset.id);
            await refreshManualMockupsForOrder(order);
            renderOrderAssets(order);
            await renderBoardFromLocalState([order.status || 'received']);
          } catch (err) {
            alert(`Delete failed: ${err?.message || err}`);
          }
        });
        thumb.appendChild(remove);
      }

      const showUnavailable = () => {
        if (!thumb.querySelector('.detail-asset-status')) {
          const status = document.createElement('div');
          status.className = 'detail-asset-status';
          status.textContent = 'Preview unavailable';
          thumb.appendChild(status);
        }
      };

      if (isSvg) {
        loadSvgPreview(url, token)
          .then(objectUrl => {
            if (objectUrl && token === detailAssetRenderToken) {
              img.src = objectUrl;
              loadedUrls[idx] = objectUrl;
              if (idx === activeIndex) updateStage(idx);
            } else if (objectUrl) {
              URL.revokeObjectURL(objectUrl);
            }
          })
          .catch(err => {
            console.warn('Unable to load SVG preview', err);
            if (token === detailAssetRenderToken) {
              img.remove();
              showUnavailable();
            }
          });
      } else {
        loadRasterPreview(img, url, token, () => {
          if (token !== detailAssetRenderToken) return;
          img.remove();
          showUnavailable();
        });
        loadedUrls[idx] = url;
        if (idx === 0) updateStage(0);
      }

      mockupTrack.appendChild(thumb);
    });
  }

  const totalDesigns = assets.front.length + assets.back.length + assets.extras.length;
  designPlaceholder.classList.toggle('hidden', totalDesigns > 0);

  const renderDesignGroup = (listEl, wrapEl, items) => {
    wrapEl.classList.toggle('hidden', !items.length);
    if (!items.length) return;
    items.forEach((item, idx) => {
      const { url, isSvg } = item;
      if (token !== detailAssetRenderToken) return;
      const tile = document.createElement('div');
      tile.className = 'design-tile';

      const thumb = document.createElement('div');
      thumb.className = 'design-thumb';
      const img = document.createElement('img');
      const labelText = designLabelFromAsset(item, idx);
      img.alt = labelText;
      img.loading = 'lazy';
      thumb.appendChild(img);
      thumb.addEventListener('click', () => openAssetViewer(img.src || url));
      tile.appendChild(thumb);

      const label = document.createElement('div');
      label.className = 'design-label';
      label.textContent = labelText;
      tile.appendChild(label);

      const actions = document.createElement('div');
      actions.className = 'design-actions';
      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'detail-asset-download';
      downloadBtn.textContent = 'Download';
      const filename = item.name || item.filename || detailAssetFilename(url, idx);
      downloadBtn.addEventListener('click', () => handleAssetDownload(item, filename, downloadBtn));
      actions.appendChild(downloadBtn);
      if (item?.removable && item?.assetId) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'detail-asset-remove';
        removeBtn.type = 'button';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', async () => {
          if (!confirm(`Remove "${filename}" from this order?`)) return;
          const originalText = removeBtn.textContent;
          removeBtn.disabled = true;
          removeBtn.textContent = 'Removing…';
          try {
            await window.api.deleteOrderDesignAsset(item.assetId, item.side || 'extra');
            await window.refreshCanonicalOrderDetail?.();
          } catch (err) {
            alert(`Remove failed: ${err?.message || err}`);
            removeBtn.disabled = false;
            removeBtn.textContent = originalText;
          }
        });
        actions.appendChild(removeBtn);
      }
      tile.appendChild(actions);

      const status = document.createElement('div');
      status.className = 'detail-asset-status hidden';
      status.textContent = 'Preview unavailable';
      tile.appendChild(status);

      const showUnavailable = () => {
        status.classList.remove('hidden');
      };

      if (isSvg) {
        loadSvgPreview(url, token)
          .then(objectUrl => {
            if (objectUrl && token === detailAssetRenderToken) {
              img.src = objectUrl;
            } else if (objectUrl) {
              URL.revokeObjectURL(objectUrl);
            }
          })
          .catch(err => {
            console.warn('Unable to load SVG preview', err);
            if (token === detailAssetRenderToken) {
              img.remove();
              showUnavailable();
            }
          });
      } else {
        loadRasterPreview(img, url, token, () => {
          if (token !== detailAssetRenderToken) return;
          img.remove();
          showUnavailable();
        });
      }

      listEl.appendChild(tile);
    });
  };

  renderDesignGroup(lists.front, groups.front, assets.front);
  renderDesignGroup(lists.back, groups.back, assets.back);
  renderDesignGroup(lists.extras, groups.extras, assets.extras);
}

async function uploadManualMockupFiles(files) {
  const order = detailOrder;
  if (order?._capabilities?.artworkUpload === false) {
    alert('Artwork uploads are unavailable for this Etsy test order.');
    return;
  }
  const orderNumber = orderNumberFromOrder(order);
  const accepted = Array.from(files || []).filter(file =>
    ['image/png', 'image/jpeg', 'image/webp'].includes(String(file?.type || '').toLowerCase())
  );
  if (!order || !orderNumber || !accepted.length) {
    if (files?.length) alert('Only PNG, JPG, and WebP mockups can be uploaded.');
    return;
  }
  const upload = document.getElementById('manual-mockup-upload-btn');
  const original = upload?.textContent || 'Upload mockup';
  if (upload) upload.textContent = 'Uploading...';
  try {
    for (const file of accepted) await window.api.uploadManualMockup(orderNumber, file);
    await refreshManualMockupsForOrder(order);
    renderOrderAssets(order);
    await renderBoardFromLocalState([order.status || 'received']);
  } catch (err) {
    alert(`Upload failed: ${err?.message || err}`);
  } finally {
    if (upload) upload.textContent = original;
    const input = document.getElementById('manual-mockup-file-input');
    if (input) input.value = '';
  }
}

async function pasteManualMockupFromClipboard() {
  try {
    const clipboardItems = await navigator.clipboard.read();
    const files = [];
    for (const item of clipboardItems) {
      const imageType = item.types.find(type => type.startsWith('image/'));
      if (imageType) {
        const blob = await item.getType(imageType);
        files.push(new File([blob], `pasted-mockup.${imageType.split('/')[1] || 'png'}`, { type: imageType }));
      }
    }
    if (!files.length) return alert('No image was found in the clipboard.');
    await uploadManualMockupFiles(files);
  } catch (err) {
    alert('Could not read an image from the clipboard. Use Upload mockup instead.');
  }
}

function setupManualMockupControls() {
  const input = document.getElementById('manual-mockup-file-input');
  const paste = document.getElementById('manual-mockup-paste-btn');
  if (input) input.addEventListener('change', () => uploadManualMockupFiles(input.files));
  if (paste) paste.addEventListener('click', pasteManualMockupFromClipboard);
}

function canUploadManualDesign(order) {
  const provider = String(order?._provider || order?.source?.provider || 'shopify').toLowerCase();
  return order?._candidate === true
    && provider === 'shopify'
    && Boolean(order?._gid)
    && order?._capabilities?.artworkUpload !== false;
}

function setManualDesignUploadStatus(message, state = '') {
  const status = document.getElementById('manual-design-upload-status');
  if (!status) return;
  status.textContent = message || '';
  status.dataset.state = state;
}

async function uploadManualDesignFiles(files) {
  const order = detailOrder;
  const input = document.getElementById('manual-design-file-input');
  const upload = document.getElementById('manual-design-upload-btn');
  const placementControl = document.getElementById('manual-design-side');
  const tools = document.querySelector('.manual-design-tools');
  const side = placementControl?.value || 'extra';
  const acceptedTypes = new Set(['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp']);
  const selected = Array.from(files || []);
  const accepted = selected.filter(file => acceptedTypes.has(String(file?.type || '').toLowerCase())
    || /\.(svg|png|jpe?g|webp)$/i.test(String(file?.name || '')));
  if (!canUploadManualDesign(order)) {
    if (selected.length) setManualDesignUploadStatus('Design uploads require a current Shopify order.', 'error');
    if (input) input.value = '';
    return;
  }
  if (!accepted.length || accepted.length !== selected.length) {
    setManualDesignUploadStatus('Choose SVG, PNG, JPG, or WebP files.', 'error');
    if (input) input.value = '';
    return;
  }

  const originalText = upload?.textContent || 'Add design';
  if (upload) {
    upload.textContent = `Uploading 0/${accepted.length}`;
    upload.setAttribute('aria-disabled', 'true');
  }
  if (input) input.disabled = true;
  if (placementControl) placementControl.disabled = true;
  if (tools) tools.setAttribute('aria-busy', 'true');
  setManualDesignUploadStatus(`Uploading ${accepted.length} ${accepted.length === 1 ? 'file' : 'files'}…`, 'busy');
  try {
    for (let index = 0; index < accepted.length; index += 1) {
      if (upload) upload.textContent = `Uploading ${index + 1}/${accepted.length}`;
      await window.api.uploadOrderDesignAsset(order._gid, accepted[index], side);
    }
    await window.refreshCanonicalOrderDetail?.();
    setManualDesignUploadStatus(`${accepted.length} ${accepted.length === 1 ? 'design' : 'designs'} added.`, 'success');
  } catch (err) {
    setManualDesignUploadStatus(`Upload failed: ${err?.message || err}`, 'error');
  } finally {
    if (upload) {
      upload.textContent = originalText;
      upload.removeAttribute('aria-disabled');
    }
    if (input) {
      input.disabled = false;
      input.value = '';
    }
    if (placementControl) placementControl.disabled = false;
    if (tools) tools.removeAttribute('aria-busy');
  }
}

function setupManualDesignControls() {
  const input = document.getElementById('manual-design-file-input');
  if (input) input.addEventListener('change', () => uploadManualDesignFiles(input.files));
}

/**
 * Collapse Shopify's batch-split lines into the commercial rows an operator
 * needs to read. The underlying order items and their IDs remain untouched;
 * this helper is presentation-only.
 */
function consolidateLineItemsForDisplay(items = []) {
  const groups = new Map();
  const amount = value => Number(value?.amount ?? value ?? 0) || 0;
  const quantity = item => Number(item?.currentQuantity ?? item?.qty ?? item?.quantity ?? 0) || 0;
  const normalizedAttributeKey = attribute => String(attribute?.key || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const hiddenAttributeKeys = new Set([
    'group_id', 'batch_id', 'role', 'group_role', 'batch_role'
  ]);

  (Array.isArray(items) ? items : []).forEach(item => {
    const key = JSON.stringify([
      String(item?.title || '').trim().toLowerCase(),
      String(item?.sku || '').trim().toLowerCase(),
      String(item?.variantTitle || '').trim().toLowerCase()
    ]);
    const qty = quantity(item);
    const unitPrice = amount(item?.unitPrice ?? item?.price);
    const allocatedDiscount = (item?.discountAllocations || []).reduce((total, allocation) => {
      const allocationMoney = allocation?.allocatedAmountSet?.shopMoney || allocation;
      return total + amount(allocationMoney);
    }, 0);
    const currentTotal = item?.currentTotal == null
      ? Math.max(0, (unitPrice * qty) - allocatedDiscount)
      : amount(item.currentTotal);
    let group = groups.get(key);
    if (!group) {
      group = {
        ...item,
        qty: 0,
        quantity: 0,
        currentQuantity: 0,
        _displayCurrentTotal: 0,
        _displayLineCount: 0,
        customAttributes: [],
        _displayAttributeKeys: new Set()
      };
      groups.set(key, group);
    }
    group.qty += qty;
    group.quantity += qty;
    group.currentQuantity += qty;
    group._displayCurrentTotal += currentTotal;
    group._displayLineCount += 1;
    (item?.customAttributes || []).forEach(attribute => {
      const attributeKey = normalizedAttributeKey(attribute);
      if (!attributeKey || hiddenAttributeKeys.has(attributeKey)) return;
      const signature = `${attributeKey}\u0000${String(attribute?.value || '')}`;
      if (group._displayAttributeKeys.has(signature)) return;
      group._displayAttributeKeys.add(signature);
      group.customAttributes.push(attribute);
    });
  });

  return Array.from(groups.values(), group => {
    delete group._displayAttributeKeys;
    return group;
  });
}

function openDetail(o) {
  detailOrder = o;
  renderOrderAssets(o);
  if (o?._capabilities?.artworkUpload !== false) {
    refreshManualMockupsForOrder(o).then(changed => {
      if (changed && detailOrder === o) renderOrderAssets(o);
    }).catch(err => console.warn('Unable to refresh manual mockups', err));
  }
  // fill header & badges
  document.getElementById('detail-timestamp').textContent = new Date(o.receivedAt || o.createdAt).toLocaleString();
  const finBadge = document.getElementById('badge-financial');
  if (finBadge) finBadge.textContent = o.displayFinancialStatus || 'PAID';
  const fulBadge = document.getElementById('badge-fulfillment');
  if (fulBadge) fulBadge.textContent = o.displayFulfillmentStatus || 'UNFULFILLED';
  const sourceBadge = document.getElementById('badge-source');
  const provider = String(o._provider || o.source?.provider || 'shopify').toLowerCase();
  if (sourceBadge) {
    sourceBadge.textContent = provider === 'etsy' ? 'Etsy' : 'PrintMO';
    sourceBadge.className = `order-source-badge source-${provider}`;
  }
  const testBadge = document.getElementById('badge-test-order');
  if (testBadge) testBadge.classList.toggle('hidden', !o._synthetic);
  const mockupActions = document.querySelector('.manual-mockup-actions');
  if (mockupActions) {
    mockupActions.classList.toggle('hidden', o?._capabilities?.artworkUpload === false);
  }
  const designActions = document.querySelector('.manual-design-upload-actions');
  if (designActions) designActions.classList.toggle('hidden', !canUploadManualDesign(o));
  setManualDesignUploadStatus('');

  // customer & notes
  const [orderNum, custName = ''] = (o.name || '').split(' – ');
  document.getElementById('detail-order-id').textContent = `Order ${orderNum}`;
  const headerCust = document.getElementById('detail-header-customer');
  if (headerCust) headerCust.textContent = custName;
  document.getElementById('detail-cust-name').textContent = custName || 'No customer name';
  document.getElementById('detail-notes').textContent = o.notes || 'No special instructions';
  const editNameButton = document.getElementById('detail-edit-name-btn');
  const nameSourceNote = document.getElementById('detail-cust-name-source-note');
  const canEditCustomerName = o?._candidate !== true && o?._capabilities?.commerceWrite !== false;
  if (editNameButton) {
    editNameButton.classList.toggle('hidden', !canEditCustomerName);
    editNameButton.disabled = !canEditCustomerName;
    editNameButton.onclick = canEditCustomerName ? () => openNameModal(o) : null;
  }
  if (nameSourceNote) {
    const sourceLabel = provider === 'etsy' ? 'Etsy' : 'Shopify';
    nameSourceNote.textContent = canEditCustomerName ? '' : `Managed by ${sourceLabel}`;
    nameSourceNote.classList.toggle('hidden', canEditCustomerName);
  }
  document.getElementById('detail-edit-notes-btn').onclick = () => openNotesModal(o);
  document.getElementById('detail-view-notes-btn').onclick = () => openViewNotesModal(o);

  // Customer Checkout Note Banner
  const custNoteBanner = document.getElementById('customer-checkout-note-banner');
  const custNoteText = document.getElementById('customer-checkout-note-text');
  if (o.shopifyNote && custNoteBanner && custNoteText) {
    custNoteText.textContent = o.shopifyNote;
    custNoteBanner.classList.remove('hidden');
  } else if (custNoteBanner) {
    custNoteBanner.classList.add('hidden');
  }

  // progress
  const totalApparel = (o.items || []).reduce((sum, it) => sum + (isGarmentItem(it) ? it.qty : 0), 0);
  o.totalApparel = totalApparel;
  if (typeof o.progress !== 'number') o.progress = 0;
  const progressText = document.getElementById('progress-text');
  const progressBar = document.getElementById('progress-bar');
  const updateProgressUI = () => {
    const currentTotal = Math.max(0, Number(o.totalApparel) || 0);
    progressText.textContent = `${o.progress} / ${currentTotal} pieces printed`;
    const pct = currentTotal ? Math.min(100, (o.progress / currentTotal) * 100) : 0;
    progressBar.style.width = pct + '%';
    progressPlusOne.disabled = currentTotal === 0 || o.progress >= currentTotal;
  };
  const progressPlusOne = document.getElementById('progress-plus1');
  updateProgressUI();
  progressPlusOne.onclick = async () => {
    const currentTotal = Math.max(0, Number(o.totalApparel) || 0);
    if (o.progress >= currentTotal) return false;
    return saveProductionProgress(o, o.progress + 1, updateProgressUI);
  };
  document.getElementById('progress-custom').onclick = () => openProgressModal(o, updateProgressUI);

  // tab badge items count
  const badgeItems = document.getElementById('tab-badge-items');
  const displayItems = consolidateLineItemsForDisplay(o.items || []);
  if (badgeItems) badgeItems.textContent = displayItems.length;

  // line items with custom attributes sub-rows
  const tbody = document.querySelector('#detail-items tbody');
  const itemColumnCount = document.querySelectorAll('#detail-items thead th').length || 4;
  const separateSkuColumn = itemColumnCount >= 5;
  tbody.innerHTML = displayItems.map(i => {
    const p = Number(i.unitPrice) || 0;
    const lineTotal = Number.isFinite(i._displayCurrentTotal)
      ? i._displayCurrentTotal.toFixed(2)
      : (p * i.qty).toFixed(2) || 0;
    const skuLabel = !separateSkuColumn && i.sku
      ? `<br><small style="color:#64748b;">SKU: ${i.sku}</small>`
      : '';
    const skuCell = separateSkuColumn
      ? `<td style="padding:8px;">${i.sku || '–'}</td>`
      : '';
    let attrsHtml = '';
    if (Array.isArray(i.customAttributes) && i.customAttributes.length > 0) {
      const chips = i.customAttributes.map(a => `<span class="attribute-chip"><strong>${a.key}:</strong> ${a.value}</span>`).join('');
      attrsHtml = `<tr><td colspan="${itemColumnCount}" class="line-item-attributes">${chips}</td></tr>`;
    }
    return `
      <tr>
        <td style="padding:8px;">${i.qty}</td>
        <td style="padding:8px;"><strong>${i.title}</strong>${skuLabel}</td>
        ${skuCell}
        <td style="padding:8px;">${i.variantTitle || '–'}</td>
        <td style="padding:8px; text-align:right;">$${lineTotal}</td>
      </tr>
      ${attrsHtml}`;
  }).join('');

  // discount & total
  const disc = Number(o.discount) || 0;
  const tot  = Number(o.total)    || 0;
  
  document.getElementById('detail-discount').textContent = `-$${disc.toFixed(2)}`;
  document.getElementById('detail-total').textContent    = `$${tot.toFixed(2)}`;

  // Logistics & Customer Tabs Population
  const addrText = document.getElementById('logistics-address-text');
  if (addrText) {
    addrText.replaceChildren();
    if (o.shippingAddress) {
      const a = o.shippingAddress;
      [
        { tag: 'strong', text: a.name || custName },
        { tag: 'span', text: [a.address1, a.address2].filter(Boolean).join(' ') },
        { tag: 'span', text: [a.city, a.provinceCode, a.zip].filter(Boolean).join(', ') }
      ].filter(line => line.text).forEach(line => {
        const element = document.createElement(line.tag);
        element.textContent = line.text;
        addrText.appendChild(element);
      });
    } else {
      const unavailable = document.createElement('span');
      unavailable.className = 'redacted-info-badge';
      unavailable.textContent = 'Customer data unavailable or redacted by Shopify';
      addrText.appendChild(unavailable);
    }
  }

  const emailVal = document.getElementById('customer-email-val');
  if (emailVal) emailVal.textContent = o.email || '🔒 Redacted by Shopify';
  const phoneVal = document.getElementById('customer-phone-val');
  if (phoneVal) phoneVal.textContent = o.phone || '🔒 Redacted by Shopify';

  const chkBlanks = document.getElementById('chk-blanks');
  const chkPrints = document.getElementById('chk-prints');
  const chkBlanksOrd = document.getElementById('chk-blanks-ordered');
  const chkPrintsOrd = document.getElementById('chk-prints-ordered');
  const applyBtn  = document.getElementById('ready-apply');
  chkBlanks.checked = !!o.blanksStatus;
  chkPrints.checked = !!o.printsStatus;
  chkBlanksOrd.checked = !!o.blanksOrdered;
  chkPrintsOrd.checked = !!o.printsOrdered;
  applyBtn.classList.add('hidden');

  const updateApply = () => {
    const b  = chkBlanks.checked ? 1 : 0;
    const p  = chkPrints.checked ? 1 : 0;
    const bo = chkBlanksOrd.checked ? 1 : 0;
    const po = chkPrintsOrd.checked ? 1 : 0;
    if (b !== (o.blanksStatus || 0) || p !== (o.printsStatus || 0) ||
        bo !== (o.blanksOrdered || 0) || po !== (o.printsOrdered || 0)) {
      applyBtn.classList.remove('hidden');
    } else {
      applyBtn.classList.add('hidden');
    }
  };
  [chkBlanks, chkPrints, chkBlanksOrd, chkPrintsOrd].forEach(el => {
    el.onchange = updateApply;
  });
  applyBtn.onclick = async () => {
    const blanks = chkBlanks.checked ? 1 : 0;
    const prints = chkPrints.checked ? 1 : 0;
    const blanksOrd = chkBlanksOrd.checked ? 1 : 0;
    const printsOrd = chkPrintsOrd.checked ? 1 : 0;
    await window.api.updateReady(o.name, blanks, prints, blanksOrd, printsOrd);
    const touchedStatuses = patchLocalOrders([o.name], {
      blanksStatus: blanks,
      printsStatus: prints,
      blanksOrdered: blanksOrd,
      printsOrdered: printsOrd
    });
    await renderBoardFromLocalState(touchedStatuses);
    applyBtn.classList.add('hidden');
  };

  // The desktop detail surface still exposes the legacy aggregate Files button.
  // The Shopify web detail surface renders mockups/design files inline instead,
  // so this control is intentionally absent there.
  const detailFilesBtn = document.getElementById('detail-files-btn');
  if (detailFilesBtn) detailFilesBtn.onclick = () => openFilesModal(o);

  // The mobile detail is a fixed app viewport. Reset its only scroll owner
  // before opening, then once again after layout has settled.
  const detailContent = document.getElementById('detail-content');
  detailContent?.scrollTo({ top: 0, behavior: 'auto' });

  // show overlay
  document.getElementById('detail-overlay')
    .classList.replace('hidden', 'visible');

  document.getElementById('detail-overlay').classList.add('visible');
  document.body.classList.add('detail-open');

  document.querySelector('.pipeline').classList.add('no-delete');
  requestAnimationFrame(() => detailContent?.scrollTo({ top: 0, behavior: 'auto' }));

  const notesWrapper = document.getElementById('detail-notes-wrapper');
  const detailCard = document.getElementById('detail-card');
  const updateNotesLimit = () => {
    notesWrapper.style.maxHeight = Math.round(detailCard.clientHeight * 0.15) + 'px';
  };
  setTimeout(updateNotesLimit, 0);
  window.addEventListener('resize', updateNotesLimit);
  notesResizeHandler = updateNotesLimit;
}

function closeDetail() {
  const overlay = document.getElementById('detail-overlay');
  overlay.classList.replace('visible', 'hidden');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('detail-open');
  cleanupDetailAssetPreviews();
  const mockupTrack = document.getElementById('detail-mockups-track');
  if (mockupTrack) mockupTrack.innerHTML = '';
  const mockupPlaceholder = document.getElementById('detail-mockups-placeholder');
  if (mockupPlaceholder) mockupPlaceholder.classList.remove('hidden');
  const designPlaceholder = document.getElementById('detail-designs-placeholder');
  if (designPlaceholder) designPlaceholder.classList.remove('hidden');
  ['design-front-list', 'design-back-list', 'design-extras-list'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
  ['design-group-front', 'design-group-back', 'design-group-extras'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
  });
  closeAssetViewer();
  document.querySelector('.pipeline').classList.remove('no-delete');
  if (notesResizeHandler) {
    window.removeEventListener('resize', notesResizeHandler);
    notesResizeHandler = null;
  }
}

function renderFileList(order) {
  const container = document.getElementById('file-list');
  const files = order.attachments || [];
  container.innerHTML = files.map(f => {
    let thumb = '';
    if (/png|jpe?g/i.test(f.mime)) {
      thumb = `<img src="data:${f.mime};base64,${f.data}" />`;
    } else {
      thumb = '<div class="svg-placeholder"></div>';
    }
    const sel = selectedFiles.has(f.name) ? ' file-selected' : '';
    return `<div class="file-item${sel}" data-name="${f.name}">${thumb}<div>${f.name}</div></div>`;
  }).join('');
  container.querySelectorAll('.file-item').forEach(el => {
    el.onclick = () => {
      const name = el.dataset.name;
      if (fileRemoveMode) {
        if (selectedFiles.has(name)) {
          selectedFiles.delete(name);
          el.classList.remove('file-selected');
        } else {
          selectedFiles.add(name);
          el.classList.add('file-selected');
        }
        return;
      }
      const f = files.find(x => x.name === name);
      if (!f) return;
      const a = document.createElement('a');
      a.href = `data:${f.mime};base64,${f.data}`;
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    };
  });
}

function openFilesModal(order) {
  cancelFileRemoval();
  renderFileList(order);
  const overlay = document.getElementById('files-overlay');
  overlay.classList.remove('hidden');

  const drop = document.getElementById('file-drop');
  drop.classList.remove('over');
  const onDragOver = e => { e.preventDefault(); drop.classList.add('over'); };
  const onDragLeave = () => drop.classList.remove('over');
  const onDrop = async e => {
    e.preventDefault();
    drop.classList.remove('over');
    for (const file of e.dataTransfer.files) {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1];
        const obj = { name: file.name, mime: file.type || 'application/octet-stream', data: base64 };
        await window.api.addFile(order.name, obj);
        if (!Array.isArray(order.attachments)) order.attachments = [];
        order.attachments.push(obj);
        renderFileList(order);
      };
      reader.readAsDataURL(file);
    }
  };
  drop.addEventListener('dragover', onDragOver);
  drop.addEventListener('dragleave', onDragLeave);
  drop.addEventListener('drop', onDrop);

  document.getElementById('files-remove-btn').onclick = () => startFileRemoval(order);
  document.getElementById('files-cancel-btn').onclick = cancelFileRemoval;
  document.getElementById('files-delete-btn').onclick = () => confirmFileRemoval(order);

  overlay.onclick = e => { if (e.target.id === 'files-overlay') { closeFilesModal(onDragOver,onDragLeave,onDrop); } };
}

function closeFilesModal(ov, lv, dp) {
  cancelFileRemoval();
  const overlay = document.getElementById('files-overlay');
  overlay.classList.add('hidden');
  const drop = document.getElementById('file-drop');
  drop.removeEventListener('dragover', ov);
  drop.removeEventListener('dragleave', lv);
  drop.removeEventListener('drop', dp);
  overlay.onclick = null;
}

function startFileRemoval(order) {
  fileRemoveMode = true;
  selectedFiles.clear();
  document.getElementById('files-remove-btn').classList.add('hidden');
  document.getElementById('files-delete-btn').classList.remove('hidden');
  document.getElementById('files-cancel-btn').classList.remove('hidden');
  renderFileList(order);
}

function cancelFileRemoval() {
  fileRemoveMode = false;
  selectedFiles.clear();
  document.getElementById('files-remove-btn').classList.remove('hidden');
  document.getElementById('files-delete-btn').classList.add('hidden');
  document.getElementById('files-cancel-btn').classList.add('hidden');
  if (detailOrder) renderFileList(detailOrder);
}

async function confirmFileRemoval(order) {
  const names = Array.from(selectedFiles);
  if (!names.length) { cancelFileRemoval(); return; }
  await window.api.removeFiles(order.name, names);
  order.attachments = order.attachments.filter(f => !selectedFiles.has(f.name));
  cancelFileRemoval();
  renderFileList(order);
}

function openNotesModal(order) {
  const overlay = document.getElementById('notes-overlay');
  const input = document.getElementById('notes-input');
  const confirmBtn = document.getElementById('notes-confirm');
  const cancelBtn = document.getElementById('notes-cancel');
  const status = document.getElementById('notes-modal-status');

  input.value = order.notes || 'No special instructions';
  if (status) status.textContent = '';

  const cleanup = () => {
    overlay.classList.add('hidden');
    confirmBtn.onclick = null;
    cancelBtn.onclick = null;
    overlay.onclick = null;
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Confirm';
    if (status) status.textContent = '';
  };

  confirmBtn.onclick = async () => {
    const val = input.value;
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Saving…';
    if (status) status.textContent = 'Saving notes…';
    try {
      await window.api.updateNotes(order.name, val);
      order.notes = val;
      document.getElementById('detail-notes').textContent = val || 'No special instructions';
      cleanup();
    } catch (error) {
      console.error('Unable to save order notes', error);
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Try again';
      if (status) status.textContent = `Notes were not saved: ${error?.message || 'Please try again.'}`;
      input.focus();
    }
  };

  cancelBtn.onclick = () => cleanup();
  overlay.onclick = e => { if (e.target.id === 'notes-overlay') cleanup(); };

  overlay.classList.remove('hidden');
  input.focus();
}

function openNameModal(order) {
  if (order?._candidate === true || order?._capabilities?.commerceWrite === false) return;
  const overlay = document.getElementById('name-overlay');
  const input = document.getElementById('name-input');
  const confirmBtn = document.getElementById('name-confirm');
  const cancelBtn = document.getElementById('name-cancel');

  const [orderNum, custName = ''] = (order.name || '').split(' – ');
  input.value = custName;

  const cleanup = () => {
    overlay.classList.add('hidden');
    confirmBtn.onclick = null;
    cancelBtn.onclick = null;
    overlay.onclick = null;
  };

  confirmBtn.onclick = async () => {
    const val = input.value.trim();
    const oldName = order.name;
    const newName = `${orderNum} – ${val}`;
    await window.api.updateName(oldName, val);
    const touchedStatuses = patchLocalOrders([oldName], { name: newName });
    document.getElementById('detail-cust-name').textContent = val;
    cleanup();
    await renderBoardFromLocalState(touchedStatuses);
  };

  cancelBtn.onclick = () => cleanup();
  overlay.onclick = e => { if (e.target.id === 'name-overlay') cleanup(); };

  overlay.classList.remove('hidden');
  input.focus();
}

function openViewNotesModal(order) {
  const overlay = document.getElementById('view-notes-overlay');
  const text = document.getElementById('view-notes-text');

  text.textContent = order.notes || 'No special instructions';

  const cleanup = () => {
    overlay.classList.add('hidden');
    overlay.onclick = null;
  };

  overlay.onclick = e => { if (e.target.id === 'view-notes-overlay') cleanup(); };

  overlay.classList.remove('hidden');
}

function openProgressModal(order, updateFn) {
  const overlay = document.getElementById('progress-overlay');
  const input = document.getElementById('progress-input');
  const confirmBtn = document.getElementById('progress-confirm');
  const cancelBtn = document.getElementById('progress-cancel');
  const decrementBtn = document.getElementById('progress-decrement');
  const incrementBtn = document.getElementById('progress-increment');
  const completeBtn = document.getElementById('progress-complete');
  const summary = document.getElementById('progress-modal-summary');
  const validation = document.getElementById('progress-validation');
  const total = Math.max(0, Number(order.totalApparel) || 0);

  input.value = order.progress;
  input.max = String(total);
  summary.textContent = `${order.progress} of ${total} pieces currently printed`;
  completeBtn.textContent = total ? `Mark all ${total} printed` : 'No garments to mark';
  completeBtn.disabled = total === 0;
  validation.textContent = '';

  const setControlsDisabled = disabled => {
    input.disabled = disabled;
    confirmBtn.disabled = disabled;
    decrementBtn.disabled = disabled;
    incrementBtn.disabled = disabled;
    completeBtn.disabled = disabled || total === 0;
  };

  const validatedValue = () => {
    const raw = input.value.trim();
    const val = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isInteger(val) || val < 0 || val > total) {
      validation.textContent = `Enter a whole number from 0 to ${total}.`;
      input.setAttribute('aria-invalid', 'true');
      return null;
    }
    validation.textContent = '';
    input.removeAttribute('aria-invalid');
    return val;
  };

  const setInputValue = value => {
    input.value = String(Math.min(total, Math.max(0, Number(value) || 0)));
    validation.textContent = '';
    input.removeAttribute('aria-invalid');
  };

  const cleanup = () => {
    overlay.classList.add('hidden');
    confirmBtn.onclick = null;
    cancelBtn.onclick = null;
    decrementBtn.onclick = null;
    incrementBtn.onclick = null;
    completeBtn.onclick = null;
    input.oninput = null;
    input.onkeydown = null;
    overlay.onclick = null;
    setControlsDisabled(false);
    confirmBtn.textContent = 'Save count';
    validation.textContent = '';
    input.removeAttribute('aria-invalid');
  };

  const commitValue = async val => {
    if (val === null) {
      input.focus();
      return false;
    }
    setControlsDisabled(true);
    confirmBtn.textContent = 'Saving…';
    validation.textContent = `Saving ${val} of ${total}…`;
    const saved = await saveProductionProgress(order, val, updateFn);
    if (saved) {
      cleanup();
      return true;
    }
    setControlsDisabled(false);
    confirmBtn.textContent = 'Try again';
    validation.textContent = 'The print count was not saved. Check the count and try again.';
    input.focus();
    input.select();
    return false;
  };

  confirmBtn.onclick = () => commitValue(validatedValue());
  decrementBtn.onclick = () => setInputValue((Number(input.value) || 0) - 1);
  incrementBtn.onclick = () => setInputValue((Number(input.value) || 0) + 1);
  completeBtn.onclick = () => {
    setInputValue(total);
    return commitValue(total);
  };
  input.oninput = () => {
    validation.textContent = '';
    input.removeAttribute('aria-invalid');
  };
  input.onkeydown = event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    confirmBtn.click();
  };
  cancelBtn.onclick = () => cleanup();
  overlay.onclick = e => { if (e.target.id === 'progress-overlay') cleanup(); };

  overlay.classList.remove('hidden');
  input.focus();
  input.select();
}

function showProductionNotice(message, tone = 'success') {
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
  window.clearTimeout(showProductionNotice.timer);
  showProductionNotice.timer = window.setTimeout(() => notice.classList.remove('visible'), 4200);
}

function productionProgressErrorMessage(error) {
  if (error?.code === 'INVALID_PRINTED_COUNT') {
    return 'The print count is higher than Shopify’s current garment total. Refresh Shopify and try again.';
  }
  if (error?.code === 'GARMENT_COUNT_UNAVAILABLE' || error?.code === 'GARMENT_COUNT_INCOMPLETE') {
    return 'Shopify’s garment total is temporarily unavailable. Refresh Shopify and try again.';
  }
  return 'Print progress could not be saved. Please try again.';
}

let productionProgressCoordinator = null;

function progressSaveStatus(message, tone = '') {
  const status = document.getElementById('progress-save-status');
  if (!status) return;
  status.classList.remove('is-success', 'is-error');
  if (tone) status.classList.add(`is-${tone}`);
  status.textContent = message;
}

function getProductionProgressCoordinator() {
  if (productionProgressCoordinator) return productionProgressCoordinator;
  if (typeof window.OrderDetailState?.createProgressSaveCoordinator !== 'function') {
    throw new Error('Order Detail progress state is unavailable.');
  }
  productionProgressCoordinator = window.OrderDetailState.createProgressSaveCoordinator({
    commit: (order, progress, stage) => window.api.updateProgress({
      name: order.name,
      progress,
      ...(stage ? { stage } : {})
    }),
    notify: ({ phase, order, state, error, stageChanged }) => {
      if (phase === 'optimistic' || phase === 'saving') {
        progressSaveStatus(`Saving ${state.desiredProgress} / ${state.total}…`);
        return;
      }
      if (phase === 'saved') {
        progressSaveStatus(`${state.confirmedProgress} / ${state.total} saved`, 'success');
        document.getElementById('badge-production-complete')
          ?.classList.toggle('hidden', order.productionStage !== 'completed');
        void renderBoardFromLocalState([order.status || 'received']);
        if (stageChanged) {
          showProductionNotice(order.productionStage === 'completed'
            ? 'Order moved to Printed'
            : 'Order returned to To Print');
        }
        return;
      }
      if (phase === 'error') {
        console.error('Unable to save print progress', error);
        progressSaveStatus(productionProgressErrorMessage(error), 'error');
        showProductionNotice(productionProgressErrorMessage(error), 'error');
        if (order._candidate) {
          void renderBoard().catch(() => renderBoardFromLocalState([order.status || 'received']));
        } else {
          void renderBoardFromLocalState([order.status || 'received']);
        }
      }
    }
  });
  return productionProgressCoordinator;
}

function saveProductionProgress(order, nextProgress, updateFn) {
  return getProductionProgressCoordinator().request(order, nextProgress, {
    total: order.totalApparel,
    update: updateFn
  });
}

// close handlers
document.getElementById('detail-close').addEventListener('click', closeDetail);
const closeSplitBtn = document.getElementById('detail-close-btn');
if (closeSplitBtn) closeSplitBtn.addEventListener('click', closeDetail);

document.getElementById('detail-overlay')
  .addEventListener('click', e => {
    if (e.target.id === 'detail-overlay') {
      closeDetail();
    }
  });

document.addEventListener('dragover', updateActiveCardDragPosition);
document.addEventListener('dragend', () => finishCardDrag());
window.addEventListener('blur', () => finishCardDrag());

// fetch & render every zone
/**
 * Render the order board from Redis or from the cached order array.
 * Full refreshes still fetch the queue, while mutation paths pass
 * useLocalOrders/statuses so only impacted columns are rebuilt.
 * @param {{useLocalOrders?: boolean, statuses?: Iterable<string>|string, invalidateQueueLoads?: boolean}} [options]
 */
async function renderBoard(options = {}) {
  const { useLocalOrders = false, statuses = null, invalidateQueueLoads = true } = options;
  let statusesToRender = normalizeBoardStatuses(statuses);
  let renderedAnySnapshot = false;
  const renderedStatuses = new Set();
  if (useLocalOrders) {
    // A local mutation or asset hydration is newer than any queue read that
    // started before it. Prevent that older response from repainting stale data.
    boardFetchGeneration += 1;
    if (invalidateQueueLoads && typeof window.api.invalidateQueueLoads === 'function') {
      window.api.invalidateQueueLoads();
    }
  } else {
    const fetchGeneration = ++boardFetchGeneration;
    const allowProgressivePaint = isShopifyBoardView() && !boardHasRendered;
    const applyQueueSnapshot = (nextOrders, { page = null, hasMore = false } = {}) => {
      if (fetchGeneration !== boardFetchGeneration) return false;
      const changedStatuses = changedCandidateBoardStatuses(allOrders, nextOrders);
      allOrders = nextOrders;
      const snapshotStatuses = statuses
        ? normalizeBoardStatuses(statuses)
        : normalizeBoardStatuses(changedStatuses);
      if (boardHasRendered && snapshotStatuses.length === 0) {
        refreshVisibleRelativeTimes();
        return false;
      }
      snapshotStatuses.forEach(status => {
        renderStatusColumn(status);
        renderedStatuses.add(status);
      });
      boardHasRendered = true;
      renderedAnySnapshot = true;
      refreshOpenBundleModal();
      window.orderManagerPerformanceDebug?.log?.("board-snapshot-painted", {
        generation: fetchGeneration,
        page,
        hasMore,
        orders: nextOrders.length,
        statuses: snapshotStatuses,
      });
      return true;
    };

    const nextOrders = await window.api.getQueue({
      onPage: allowProgressivePaint
        ? (pageOrders, pageInfo) => {
          const painted = applyQueueSnapshot(pageOrders, pageInfo);
          if (painted) void hydrateManualMockupsForOrders(pageOrders, { refresh: true });
          return painted;
        }
        : undefined,
    });
    if (fetchGeneration !== boardFetchGeneration) {
      return { rendered: false, stale: true, statuses: [] };
    }
    applyQueueSnapshot(nextOrders);
    if (!allowProgressivePaint) void hydrateManualMockupsForOrders(allOrders, { refresh: true });
    return {
      rendered: renderedAnySnapshot,
      stale: false,
      statuses: Array.from(renderedStatuses),
    };
  }

  statusesToRender.forEach(renderStatusColumn);
  boardHasRendered = true;
  refreshOpenBundleModal();
  return { rendered: true, stale: false, statuses: statusesToRender };
}

// recalc summary from “toOrder” items
function updateSummary() {
  const picks = allOrders.filter(x => x.status === 'toOrder' && orderIsVisibleOnOperationalBoard(x));
  const summary = { Garments: 0, Prints: 0 };
  picks.forEach(o =>
    (o.items || []).forEach(it => {
      if (isPrintItem(it)) summary.Prints += it.qty;
      else if (isGarmentItem(it)) summary.Garments += it.qty;
    })
  );
  const ul = document.getElementById('summary-list');
  ul.innerHTML = Object.entries(summary)
    .map(([k, v]) => `<li>${k}: ${v}</li>`)
    .join('');
  document.getElementById('cart-total').textContent =
    `Total garments: ${summary.Garments}`;
}

function startBundle(status) {
  if (bundleMode) return;
  const colId = status === 'received' ? 'col-received'
               : status === 'blanks' ? 'col-blanks'
               : 'col-print';
  const container = document.getElementById(colId);
  bundleMode = { status, container, selected: new Set() };
  container.querySelectorAll('.pipeline-card:not(.bundle-card)').forEach(c => {
    c.addEventListener('click', toggleBundleSelect, true);
  });
}

function toggleBundleSelect(e) {
  e.stopPropagation();
  e.stopImmediatePropagation();
  const card = e.currentTarget;
  const id = card.dataset.orderId;
  if (bundleMode.selected.has(id)) {
    bundleMode.selected.delete(id);
    card.classList.remove('bundle-selected');
  } else {
    bundleMode.selected.add(id);
    card.classList.add('bundle-selected');
  }
}

function cancelBundle() {
  if (!bundleMode) return;
  bundleMode.container.querySelectorAll('.pipeline-card:not(.bundle-card)').forEach(c => {
    c.removeEventListener('click', toggleBundleSelect, true);
    c.classList.remove('bundle-selected');
  });
  bundleMode = null;
}

async function confirmBundle(name) {
  if (!bundleMode) return;
  const ids = Array.from(bundleMode.selected);
  await window.api.setBundle(ids, name);
  const touchedStatuses = patchLocalOrders(ids, { bundle: name });
  cancelBundle();
  await renderBoardFromLocalState(touchedStatuses);
}

function promptBundleName() {
  return new Promise(resolve => {
    const overlay = document.getElementById('bundle-name-overlay');
    const input = document.getElementById('bundle-name-input');
    const confirmBtn = document.getElementById('bundle-name-confirm');
    const cancelBtn = document.getElementById('bundle-name-cancel');

    function cleanup() {
      overlay.classList.add('hidden');
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
    }

    function onConfirm() {
      const val = input.value.trim();
      cleanup();
      resolve(val);
    }

    function onCancel() {
      cleanup();
      resolve('');
    }

    function onKey(e) {
      if (e.key === 'Enter') onConfirm();
      if (e.key === 'Escape') onCancel();
    }

    overlay.classList.remove('hidden');
    input.value = '';
    input.focus();

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
  });
}

function makeDropZone(el, status) {
  el.addEventListener('dragover', e => {
    e.preventDefault();
    // highlight only the drag‐area if desired:
    e.dataTransfer.dropEffect = 'move';  // show move cursor instead of “no‐drop”
    if (el.classList.contains('drag-area')) {
      el.classList.add('over');
    }
  });

  el.addEventListener('dragleave', () => {
    el.classList.remove('over');
  });

  el.addEventListener('drop', async e => {
    e.preventDefault();
    el.classList.remove('over');
    markActiveDragDropAccepted();

    // 1) Grab the ID that was set on dragstart
    const id = e.dataTransfer.getData('text/plain');
    console.log(`→ drop: id="${id}" status="${status}"`);

    if (!id) {
      console.warn('Drop ignored: no order ID present');
      return;
    }

    try {
      if (id.startsWith('bundle:')) {
        const name = id.slice(7);
        const orderNames = allOrders
          .filter(order => order.bundle === name)
          .map(order => order.name);
        await window.api.updateBundleStatus(name, status);
        const touchedStatuses = patchLocalOrders(orderNames, { status });
        await renderBoardFromLocalState(touchedStatuses);
      } else {
        await window.api.updateStatus(id, status);
        const touchedStatuses = patchLocalOrders([id], { status });
        await renderBoardFromLocalState(touchedStatuses);
      }
    } catch (err) {
      console.error('Error updating status on drop:', err);
    }
  });
}

function setupDropZones() {
  // Order Pipeline → you can drop back as ‘received’
  makeDropZone(document.getElementById('col-received'), 'received');
  // Drag area itself ⇒ toOrder
  const dragArea = document.getElementById('col-toOrder');
  makeDropZone(dragArea, 'toOrder');
  // Blanks Ordered
  makeDropZone(document.getElementById('col-blanks'), 'blanks');
  // Ready To Print
  makeDropZone(document.getElementById('col-print'), 'print');
}

let lastSupplierSubmissionReport = null;

function normalizedSupplierSubmissionReport(value, fallbackMessage = '') {
  const source = value && typeof value === 'object' ? value : {};
  const outcome = ['confirmed', 'partial', 'rejected', 'unknown'].includes(source.outcome)
    ? source.outcome
    : source.ok === true
      ? 'confirmed'
      : 'unknown';
  const acceptedLines = Array.isArray(source.acceptedLines) ? source.acceptedLines : [];
  const rejectedLines = Array.isArray(source.rejectedLines) ? source.rejectedLines : [];
  const orderResults = Array.isArray(source.orderResults) ? source.orderResults : [];
  const orderCount = Number(source.orderCount ?? source.count ?? orderResults.length) || 0;
  const acceptedOrderCount = Number(source.acceptedOrderCount ?? orderResults.filter(order => order?.outcome === 'confirmed').length) || 0;
  return {
    ...source,
    outcome,
    acceptedLines,
    rejectedLines,
    orderResults,
    orderCount,
    acceptedOrderCount: outcome === 'confirmed' && !acceptedOrderCount ? orderCount : acceptedOrderCount,
    supplierOrderNumbers: Array.isArray(source.supplierOrderNumbers)
      ? source.supplierOrderNumbers.filter(Boolean)
      : [source.supplierOrderNumber].filter(Boolean),
    summary: source.summary || fallbackMessage || (
      outcome === 'confirmed'
        ? 'S&S accepted the submission.'
        : outcome === 'partial'
          ? 'S&S accepted part of the submission. Review the rejected garments.'
          : outcome === 'rejected'
            ? 'S&S rejected the submission.'
            : 'S&S did not return a definite result. Do not retry until it is reconciled.'
    )
  };
}

function supplierSubmissionReportFromError(error) {
  const report = error?.details?.report
    || error?.payload?.error?.details?.report
    || error?.payload?.report;
  if (report) return normalizedSupplierSubmissionReport(report, error?.message);
  const rejected = error?.code === 'SUPPLIER_REJECTED' || Number(error?.status) === 422;
  return normalizedSupplierSubmissionReport({
    outcome: rejected ? 'rejected' : 'unknown',
    summary: error?.message || String(error || 'S&S submission failed.'),
    batchId: error?.payload?.error?.details?.batchId || null,
    rejectedLines: rejected ? [{ reason: error?.message || 'S&S rejected the submission.' }] : []
  });
}

function supplierOutcomePresentation(outcome) {
  if (outcome === 'confirmed') return { title: 'All items accepted', lineLabel: 'accepted', status: 'Submitted to S&S.' };
  if (outcome === 'partial') return { title: 'Some items need attention', lineLabel: 'accepted', status: 'Partially submitted. Review the S&S feedback.' };
  if (outcome === 'rejected') return { title: 'Submission rejected', lineLabel: 'accepted', status: 'S&S rejected the submission.' };
  return { title: 'Result needs reconciliation', lineLabel: 'confirmed', status: 'S&S returned an uncertain result. Do not retry yet.' };
}

function appendSupplierResultRow(body, result) {
  const row = document.createElement('tr');
  const statusCell = document.createElement('td');
  const status = document.createElement('span');
  status.className = `ss-line-status ${result.status}`;
  status.textContent = result.status === 'accepted' ? 'Accepted' : result.status === 'rejected' ? 'Rejected' : 'Unknown';
  statusCell.appendChild(status);

  const orderCell = document.createElement('td');
  orderCell.textContent = (result.orderNames || []).join(', ') || 'Selected batch';
  const itemCell = document.createElement('td');
  itemCell.className = 'ss-line-item';
  const itemName = document.createElement('span');
  itemName.className = 'ss-line-item-name';
  itemName.textContent = (result.itemNames || []).join(', ') || (result.sku ? 'Supplier item' : 'Selected batch');
  const sku = document.createElement('code');
  sku.className = 'ss-line-sku';
  sku.textContent = result.sku || 'No line identifier returned';
  itemCell.append(itemName, sku);
  const requestedCell = document.createElement('td');
  requestedCell.textContent = result.requestedQty ?? '—';
  const acceptedCell = document.createElement('td');
  acceptedCell.textContent = result.acceptedQty ?? (result.status === 'rejected' ? '0' : '—');
  const feedbackCell = document.createElement('td');
  feedbackCell.className = 'ss-line-feedback';
  feedbackCell.textContent = result.reason || (result.status === 'accepted' ? 'Accepted by S&S.' : 'No line-level feedback was returned.');
  row.append(statusCell, orderCell, itemCell, requestedCell, acceptedCell, feedbackCell);
  body.appendChild(row);
}

function showSupplierSubmissionReport(value) {
  const report = normalizedSupplierSubmissionReport(value);
  lastSupplierSubmissionReport = report;
  const overlay = document.getElementById('ss-submission-overlay');
  const dialog = document.getElementById('ss-submission-dialog');
  const presentation = supplierOutcomePresentation(report.outcome);
  if (!overlay || !dialog) return false;

  dialog.dataset.outcome = report.outcome;
  document.getElementById('ss-submission-title').textContent = presentation.title;
  document.getElementById('ss-submission-summary').textContent = report.summary;
  document.getElementById('ss-submission-orders').textContent = `${report.acceptedOrderCount} / ${report.orderCount}`;
  document.getElementById('ss-submission-lines').textContent = `${report.acceptedLines.length} ${presentation.lineLabel}`;
  document.getElementById('ss-submission-order-number').textContent = report.supplierOrderNumbers.join(', ') || 'Not created';
  document.getElementById('ss-submission-reference').textContent = report.batchId || report.poNumber || 'Unavailable';

  const body = document.getElementById('ss-submission-lines-body');
  body.replaceChildren();
  report.acceptedLines.forEach(line => appendSupplierResultRow(body, { ...line, status: 'accepted' }));
  report.rejectedLines.forEach(line => appendSupplierResultRow(body, { ...line, acceptedQty: 0, status: 'rejected' }));
  if (!body.childElementCount) {
    appendSupplierResultRow(body, {
      status: report.outcome === 'unknown' ? 'unknown' : report.outcome === 'rejected' ? 'rejected' : 'accepted',
      reason: report.summary
    });
  }

  const warning = document.getElementById('ss-submission-warning');
  if (report.outcome === 'unknown') {
    warning.textContent = 'Do not submit this batch again yet. Use the reference below to confirm whether S&S created an order before retrying.';
    warning.classList.remove('hidden');
  } else if (report.outcome === 'partial') {
    warning.textContent = 'Only fully accepted PrintMO orders moved to In S&S Cart. Orders containing rejected garments remain in Build Order.';
    warning.classList.remove('hidden');
  } else if (Array.isArray(report.metadataRepairRequired) && report.metadataRepairRequired.length) {
    warning.textContent = 'S&S accepted the order, but one or more board cards still need an automatic status repair. Do not submit the batch again.';
    warning.classList.remove('hidden');
  } else {
    warning.textContent = '';
    warning.classList.add('hidden');
  }

  document.getElementById('ss-last-result')?.classList.remove('hidden');
  overlay.classList.remove('hidden');
  return true;
}

function closeSupplierSubmissionReport() {
  document.getElementById('ss-submission-overlay')?.classList.add('hidden');
}

function setupSupplierSubmissionReport() {
  const overlay = document.getElementById('ss-submission-overlay');
  document.getElementById('ss-submission-close')?.addEventListener('click', closeSupplierSubmissionReport);
  document.getElementById('ss-submission-done')?.addEventListener('click', closeSupplierSubmissionReport);
  document.getElementById('ss-last-result')?.addEventListener('click', () => {
    if (lastSupplierSubmissionReport) showSupplierSubmissionReport(lastSupplierSubmissionReport);
  });
  document.getElementById('ss-submission-copy')?.addEventListener('click', async event => {
    const reference = document.getElementById('ss-submission-reference')?.textContent || '';
    if (!reference || reference === 'Unavailable') return;
    try {
      await navigator.clipboard.writeText(reference);
      event.currentTarget.textContent = 'Copied';
      setTimeout(() => { event.currentTarget.textContent = 'Copy reference'; }, 1600);
    } catch (_) {
      event.currentTarget.textContent = 'Copy unavailable';
    }
  });
  overlay?.addEventListener('click', event => {
    if (event.target === overlay) closeSupplierSubmissionReport();
  });

  if (typeof window.api?.getLatestBatchResult === 'function') {
    window.api.getLatestBatchResult().then(result => {
      if (!result) return;
      lastSupplierSubmissionReport = normalizedSupplierSubmissionReport(result);
      document.getElementById('ss-last-result')?.classList.remove('hidden');
    }).catch(error => console.warn('Unable to load the latest S&S result', error));
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // --- real-time: debounce renders so bursts of updates don't spam the UI ---
  let renderTimer = null;
  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = setTimeout(async () => {
      renderTimer = null;
      await renderBoard();
    }, 200);
  }

  // Subscribe to server push updates (via web-shim)
  if (window.api && typeof window.api.subscribeQueueChanges === 'function') {
    window.api.subscribeQueueChanges((evt) => {
      if (evt?.type === 'queue_changed') scheduleRender();
    });
  } else {
    console.warn('⚠️ window.api.subscribeQueueChanges is not available (check web-shim.js)');
  }

  initMobileTabs();
  initPrintTabs();
  setupManualMockupControls();
  setupManualDesignControls();
  setupSupplierSubmissionReport();

  // wire up the four zones

  // Submit button
  const submitBtn = document.getElementById('order-submit');
  if (!submitBtn) {
    console.warn('⚠️ #order-submit button not found');
  } else {
    submitBtn.addEventListener('click', async () => {
      const toOrder = allOrders
        .filter(x => x.status === 'toOrder' && orderIsVisibleOnOperationalBoard(x))
        .map(x => x.name);
      if (!toOrder.length) {
        return alert('Drag some cards into “Drag cards here” first.');
      }

      submitBtn.textContent = 'Submitting…';
      submitBtn.disabled = true;
      submitBtn.setAttribute('aria-busy', 'true');
      const submitStatus = document.getElementById('ss-submit-status');
      if (submitStatus) submitStatus.textContent = 'Sending the selected garment lines to S&S…';

      try {
        const result = await window.api.processBatch(toOrder);
        const report = normalizedSupplierSubmissionReport(result);
        const acceptedOrderNames = Array.isArray(result?.acceptedOrderNames)
          ? result.acceptedOrderNames
          : report.outcome === 'confirmed'
            ? toOrder
            : [];

        // A confirmed supplier submission always enters In S&S Cart.
        if (acceptedOrderNames.length && !result?.canonicalStageUpdated && typeof window.api.updateStatuses === 'function') {
          await window.api.updateStatuses(acceptedOrderNames, 'blanks');
        } else if (acceptedOrderNames.length && !result?.canonicalStageUpdated) {
          await Promise.all(acceptedOrderNames.map(id => window.api.updateStatus(id, 'blanks')));
        }

        const touchedStatuses = patchLocalOrders(acceptedOrderNames, { status: 'blanks', blanksOrdered: 0 });
        // Both ends of the move must repaint even if an adapter has already
        // adopted canonical batch metadata in its local cache.
        touchedStatuses.add('toOrder');
        touchedStatuses.add('blanks');
        if (
          document.body?.dataset.orderSource === 'shopify'
          && typeof window.setActiveBlanksView === 'function'
        ) {
          window.setActiveBlanksView('cart', { render: false });
        }
        await renderBoardFromLocalState(touchedStatuses);
        showSupplierSubmissionReport(report);
        const presentation = supplierOutcomePresentation(report.outcome);
        submitBtn.textContent = report.outcome === 'partial' ? 'Review result' : 'Submitted';
        if (submitStatus) submitStatus.textContent = presentation.status;

        setTimeout(() => {
          submitBtn.textContent = 'Add to S&S Cart';
        }, 3000);

      } catch (err) {
        const report = supplierSubmissionReportFromError(err);
        const reportShown = showSupplierSubmissionReport(report);
        if (!reportShown) alert(report.summary);
        submitBtn.textContent = 'Review result';
        if (submitStatus) submitStatus.textContent = supplierOutcomePresentation(report.outcome).status;
        setTimeout(() => {
          submitBtn.textContent = 'Add to S&S Cart';
        }, 3000);
      } finally {
        submitBtn.disabled = false;
        submitBtn.removeAttribute('aria-busy');
      }
    });
  }

  const clearBtn = document.getElementById('clear-picked');
  if (!clearBtn) {
    console.warn('⚠️ #clear-picked button not found');
  } else {
    clearBtn.addEventListener('click', async () => {
      const toOrder = allOrders
        .filter(o => o.status === 'toOrder' && orderIsVisibleOnOperationalBoard(o))
        .map(o => o.name);

      if (!toOrder.length) return;

      clearBtn.disabled = true;
      try {
        if (typeof window.api.updateStatuses === 'function') {
          await window.api.updateStatuses(toOrder, 'received');
        } else {
          await Promise.all(toOrder.map(id => window.api.updateStatus(id, 'received')));
        }
        const touchedStatuses = patchLocalOrders(toOrder, { status: 'received' });
        await renderBoardFromLocalState(touchedStatuses);
      } finally {
        clearBtn.disabled = false;
      }
    });
  }

  const fsBtn = document.getElementById('blanks-fullscreen-btn');
  const blanksSection = document.getElementById('blanks-section');
  const blanksOverlay = document.getElementById('blanks-overlay');
  if (fsBtn && blanksSection && blanksOverlay) {
    fsBtn.addEventListener('click', () => {
      blanksOverlay.classList.remove('hidden');
      blanksSection.classList.add('fullscreen');
    });
    blanksOverlay.addEventListener('click', (e) => {
      if (e.target === blanksOverlay) {
        blanksOverlay.classList.add('hidden');
        blanksSection.classList.remove('fullscreen');
      }
    });
  }

  const printFsBtn = document.getElementById('print-fullscreen-btn');
  const printSection = document.getElementById('print-section');
  const printOverlay = document.getElementById('print-overlay');
  if (printFsBtn && printSection && printOverlay) {
    printFsBtn.addEventListener('click', () => {
      printOverlay.classList.remove('hidden');
      printSection.classList.add('fullscreen');
    });
    printOverlay.addEventListener('click', (e) => {
      if (e.target === printOverlay) {
        printOverlay.classList.add('hidden');
        printSection.classList.remove('fullscreen');
      }
    });
  }

  // Bundle buttons
  const bundleConfigs = [
    { start: 'received-bundle-start', confirm: 'received-bundle-confirm', cancel: 'received-bundle-cancel', status: 'received' },
    { start: 'blanks-bundle-start', confirm: 'blanks-bundle-confirm', cancel: 'blanks-bundle-cancel', status: 'blanks' },
    { start: 'print-bundle-start', confirm: 'print-bundle-confirm', cancel: 'print-bundle-cancel', status: 'print' }
  ];
  bundleConfigs.forEach(cfg => {
    const s = document.getElementById(cfg.start);
    const c = document.getElementById(cfg.confirm);
    const x = document.getElementById(cfg.cancel);
    if (!s || !c || !x) return;

    s.addEventListener('click', () => {
      startBundle(cfg.status);
      s.classList.add('hidden');
      c.classList.remove('hidden');
      x.classList.remove('hidden');
    });

    x.addEventListener('click', () => {
      cancelBundle();
      s.classList.remove('hidden');
      c.classList.add('hidden');
      x.classList.add('hidden');
    });

    c.addEventListener('click', async () => {
      const name = await promptBundleName();
      if (name) {
        await confirmBundle(name);
      } else {
        cancelBundle();
      }
      s.classList.remove('hidden');
      c.classList.add('hidden');
      x.classList.add('hidden');
    });
  });

  const assetViewer = document.getElementById('asset-viewer');
  const assetViewerClose = document.getElementById('asset-viewer-close');
  if (assetViewer) {
    assetViewer.addEventListener('click', (e) => {
      if (e.target === assetViewer) closeAssetViewer();
    });
  }
  if (assetViewerClose) {
    assetViewerClose.addEventListener('click', closeAssetViewer);
  }
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Escape') closeAssetViewer();
  });

  setupDropZones();

  // Initial render (await so allOrders is populated before interactions happen)
  await renderBoard();
});
