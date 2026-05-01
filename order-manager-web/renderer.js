// renderer.js

let allOrders = [];
let renderTimer = null;
function scheduleRender() {
  if (renderTimer) return;
  renderTimer = setTimeout(async () => {
    renderTimer = null;
    await renderBoard();
  }, 200);
}
let bundleMode = null; // {status, selected:Set<string>}
let detailOrder = null;
let notesResizeHandler = null;
let detailAssetRenderToken = 0;
const detailAssetBlobUrls = new Set();

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
// utility to detect "print" items by SKU or title
function isPrintItem(li) {
  return PRINT_TITLES.has(li.title);
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

/**
 * Layout styling is split by viewport: desktop.css for >=901px, mobile.css for <=900px.
 * Keep visual changes in the appropriate stylesheet; renderer.js stays behavior-only.
 */
const MOBILE_TAB_BREAKPOINT = 900;
const MOBILE_TABS = ['pipeline', 'blanksCart', 'blanksOrdered', 'readyToPrint', 'storage'];
let activeMobileTab = MOBILE_TABS[0];
let isMobileViewport = false;
let mobileMediaQuery = null;
let mobilePipelineSelectionMode = false;
const mobileSelectedOrders = new Set();
let mobileDetailDragCleanup = null;
let mobileNotesEditing = false;
let mobileItemsExpanded = false;

/**
 * Whether mobile selection behavior should hijack card taps for the given order.
 * Keeps selection logic isolated to the Pipeline tab and mobile view.
 * @param {{status?: string}} order - Order object to evaluate.
 * @returns {boolean} True if selection mode should handle taps.
 */
function shouldHandleMobilePipelineSelection(order) {
  return Boolean(
    isMobileViewport &&
    activeMobileTab === 'pipeline' &&
    mobilePipelineSelectionMode &&
    order &&
    order.status === 'received'
  );
}

/**
 * Apply or clear selection visuals for a single card in the Pipeline tab.
 * @param {HTMLElement} card - The card element to update.
 * @param {string} orderId - The order ID associated with the card.
 */
function applyMobileSelectionState(card, orderId) {
  if (!card || !orderId) return;
  const isSelected = mobileSelectedOrders.has(orderId);
  card.classList.toggle('mobile-selectable', mobilePipelineSelectionMode);
  card.classList.toggle('mobile-selected', mobilePipelineSelectionMode && isSelected);
}

/**
 * Sync the sticky action bar and toggle button to the current selection state.
 * Centralized so renders and state mutations stay consistent.
 */
function refreshMobileSelectionUI() {
  const toggleBtn = document.getElementById('mobile-selection-toggle');
  const addBtn = document.getElementById('mobile-selection-add');
  const cancelBtn = document.getElementById('mobile-selection-cancel');
  const selectedCount = mobileSelectedOrders.size;

  if (document.body) {
    document.body.classList.toggle('mobile-selection-mode', mobilePipelineSelectionMode);
  }

  if (toggleBtn) {
    toggleBtn.setAttribute('aria-pressed', mobilePipelineSelectionMode ? 'true' : 'false');
  }
  if (addBtn) {
    addBtn.textContent = `Add (${selectedCount}) to Blanks Cart`;
    const disabled = selectedCount === 0;
    addBtn.disabled = disabled;
    addBtn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
  }
  if (cancelBtn) {
    cancelBtn.disabled = !mobilePipelineSelectionMode;
  }

  document.querySelectorAll('#col-received .card').forEach(card => {
    const id = card.dataset.orderId;
    applyMobileSelectionState(card, id);
  });
}

/**
 * Toggle selection mode for the mobile Pipeline tab.
 * Clears current selection when turning off.
 * @param {boolean} [next] - Optional explicit value; otherwise toggles.
 */
function setMobileSelectionMode(next) {
  const target = typeof next === 'boolean' ? next : !mobilePipelineSelectionMode;
  mobilePipelineSelectionMode = target;
  if (!target) {
    mobileSelectedOrders.clear();
  }
  refreshMobileSelectionUI();
}

/**
 * Toggle selection for a specific order card without opening detail.
 * @param {string} orderId - Order ID to toggle.
 * @param {HTMLElement} card - Card element for immediate visual sync.
 */
function toggleMobileCardSelection(orderId, card) {
  if (!orderId) return;
  if (mobileSelectedOrders.has(orderId)) {
    mobileSelectedOrders.delete(orderId);
  } else {
    mobileSelectedOrders.add(orderId);
  }
  applyMobileSelectionState(card, orderId);
  refreshMobileSelectionUI();
}

/**
 * Toggle the inline mobile notes editing state, reusing existing notes storage.
 * @param {boolean} editing - True to enable editing, false to return to read-only.
 */
function setMobileNotesEditing(editing) {
  mobileNotesEditing = editing;
  const notesDisplay = document.getElementById('detail-notes');
  const notesInput = document.getElementById('detail-notes-input');
  const saveBtn = document.getElementById('mobile-notes-save');
  const editBtn = document.getElementById('mobile-notes-edit');
  if (!notesDisplay || !notesInput) return;
  if (editing) {
    notesInput.classList.remove('hidden');
    notesDisplay.classList.add('hidden');
    saveBtn?.classList.remove('hidden');
  } else {
    notesInput.classList.add('hidden');
    notesDisplay.classList.remove('hidden');
    saveBtn?.classList.add('hidden');
  }
  if (editBtn) {
    editBtn.setAttribute('aria-pressed', editing ? 'true' : 'false');
  }
}

/**
 * Manage the mobile line-items collapse/expand affordance without changing data.
 * @param {boolean} expanded - Whether the items table should expand to full height.
 */
function setMobileItemsExpanded(expanded) {
  mobileItemsExpanded = expanded;
  const wrapper = document.getElementById('detail-items-wrapper');
  const btn = document.getElementById('mobile-items-expand');
  if (wrapper) wrapper.classList.toggle('mobile-expanded', expanded);
  if (btn) btn.textContent = expanded ? 'Collapse' : 'Expand';
}

/**
 * Move all selected Pipeline orders into the Blanks Cart (toOrder) stage.
 * Clears selection and exits selection mode after successful updates.
 */
async function moveSelectedToBlanksCart() {
  const ids = Array.from(mobileSelectedOrders);
  if (!ids.length) return;
  try {
    await Promise.all(ids.map(id => window.api.updateStatus(id, 'toOrder')));
    setMobileSelectionMode(false);
    await renderBoard();
    setActiveMobileTab('blanksCart', { scrollTop: false });
  } catch (err) {
    console.error('Failed to move selected to Blanks Cart', err);
    alert('Could not move selected orders. Please try again.');
  }
}

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
    document.body.dataset.activeView = nextTab === 'storage' ? 'storage' : 'orders';
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

window.setActiveMobileTab = setActiveMobileTab;

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
  } else {
    setMobileSelectionMode(false);
    document.body.classList.remove('mobile-detail-open');
    const overlay = document.getElementById('detail-overlay');
    if (overlay) overlay.classList.remove('mobile-bottomsheet');
  }
  syncDetailDesignPanelPlacement();
  if (detailOrder) {
    updateDetailProgressUI(detailOrder);
  }
}

/**
 * Keep the design files panel inside the detail grid. CSS controls whether
 * it appears as a right rail, a lower compact-desktop region, or a mobile
 * stacked section.
 */
function syncDetailDesignPanelPlacement() {
  const panel = document.getElementById('detail-design-panel');
  const column = document.getElementById('detail-main-column');
  if (!panel || !column) return;
  if (panel.parentElement !== column) {
    column.appendChild(panel);
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

/**
 * Attach mobile-only drag-to-close gesture for the detail bottom sheet.
 * @param {HTMLElement} card - The detail card acting as the sheet.
 * @returns {() => void} Cleanup function to remove listeners.
 */
function setupMobileDetailDrag(card) {
  if (!card) return () => {};
  let startY = 0;
  let dragging = false;
  let canDismiss = false;
  let scrollTarget = null;
  const dragThreshold = 12;

  /**
   * Resolve the scroll container for the gesture start target inside the sheet.
   * Falls back to #detail-content if no scrollable ancestor is found.
   * @param {EventTarget} target - Touch start target.
   * @returns {HTMLElement|null} Scroll container element.
   */
  const resolveScrollContainer = (target) => {
    const fallback = document.getElementById('detail-content');
    let el = target instanceof HTMLElement ? target : null;
    while (el && el !== card) {
      if (el.scrollHeight > el.clientHeight) {
        const overflowY = window.getComputedStyle(el).overflowY;
        if (overflowY === 'auto' || overflowY === 'scroll') {
          return el;
        }
      }
      el = el.parentElement;
    }
    return fallback || card;
  };

  const onStart = (e) => {
    if (!isMobileViewport || e.touches.length !== 1) return;
    startY = e.touches[0].clientY;
    scrollTarget = resolveScrollContainer(e.target);
    canDismiss = (scrollTarget?.scrollTop || 0) <= 0;
    dragging = false;
  };

  const onMove = (e) => {
    if (!isMobileViewport || e.touches.length !== 1 || startY === 0) return;
    const dy = e.touches[0].clientY - startY;
    if (!canDismiss) return;
    if (!dragging) {
      if (dy > dragThreshold) {
        dragging = true;
        card.style.transition = 'none';
      } else {
        return;
      }
    }
    if (dy <= 0) {
      dragging = false;
      card.style.transition = 'transform 0.2s ease';
      card.style.transform = 'translateY(0)';
      return;
    }
    card.style.transform = `translateY(${Math.min(dy, 140)}px)`;
    e.preventDefault();
  };

  const onEnd = (e) => {
    if (!dragging) {
      card.style.transition = 'transform 0.2s ease';
      card.style.transform = 'translateY(0)';
      startY = 0;
      canDismiss = false;
      scrollTarget = null;
      return;
    }
    const dy = (e.changedTouches?.[0]?.clientY || startY) - startY;
    card.style.transition = 'transform 0.2s ease';
    if (dy > 80) {
      closeDetail();
    } else {
      card.style.transform = 'translateY(0)';
    }
    startY = 0;
    dragging = false;
    canDismiss = false;
    scrollTarget = null;
  };

  card.addEventListener('touchstart', onStart, { passive: true });
  card.addEventListener('touchmove', onMove, { passive: false });
  card.addEventListener('touchend', onEnd, { passive: true });
  card.addEventListener('touchcancel', onEnd, { passive: true });

  return () => {
    card.removeEventListener('touchstart', onStart);
    card.removeEventListener('touchmove', onMove);
    card.removeEventListener('touchend', onEnd);
    card.removeEventListener('touchcancel', onEnd);
    card.style.transition = '';
    card.style.transform = '';
  };
}

/**
 * Wire up mobile selection controls (toggle, action bar) once the DOM is ready.
 * Keeps handlers isolated to mobile UX without impacting desktop.
 */
function initMobileSelectionControls() {
  const toggleBtn = document.getElementById('mobile-selection-toggle');
  const addBtn = document.getElementById('mobile-selection-add');
  const cancelBtn = document.getElementById('mobile-selection-cancel');

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      setMobileSelectionMode();
      if (mobilePipelineSelectionMode && activeMobileTab !== 'pipeline') {
        setActiveMobileTab('pipeline');
      }
    });
  }
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => setMobileSelectionMode(false));
  }
  if (addBtn) {
    addBtn.addEventListener('click', moveSelectedToBlanksCart);
  }
  refreshMobileSelectionUI();
}

/**
 * Wire up mobile detail affordances (inline notes edit, line-items expand).
 * Keeps interactions declarative while reusing existing update APIs.
 */
function initMobileDetailUI() {
  const editBtn = document.getElementById('mobile-notes-edit');
  const saveBtn = document.getElementById('mobile-notes-save');
  const notesInput = document.getElementById('detail-notes-input');
  const expandBtn = document.getElementById('mobile-items-expand');

  if (editBtn && notesInput) {
    editBtn.addEventListener('click', () => {
      setMobileNotesEditing(true);
      requestAnimationFrame(() => {
        notesInput.focus();
        notesInput.setSelectionRange(notesInput.value.length, notesInput.value.length);
      });
    });
  }
  if (saveBtn && notesInput) {
    saveBtn.addEventListener('click', async () => {
      if (!detailOrder) {
        setMobileNotesEditing(false);
        return;
      }
      const val = notesInput.value;
      try {
        await window.api.updateNotes(detailOrder.name, val);
        detailOrder.notes = val;
        document.getElementById('detail-notes').textContent = val || 'No special instructions';
        setMobileNotesEditing(false);
      } catch (err) {
        alert(`Could not save notes: ${err?.message || err}`);
      }
    });
  }
  if (expandBtn) {
    expandBtn.addEventListener('click', () => setMobileItemsExpanded(!mobileItemsExpanded));
  }
}


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

// build a card from the record's `items` array
function makeCard(o, style = 'default') {
  const card = document.createElement('div');
  card.className   = 'card';
  card.draggable   = true;
  card.dataset.orderId = o.name;

  // split "#1234 – Johnâ”¬Ã¡Smith"
  const [orderNum, custNameRaw] = o.name.split(' – ');
  const custName = custNameRaw || '';

  // count apparel vs prints
  let apparel = 0, prints = 0;
  (o.items || []).forEach(it => {
    if (isPrintItem(it)) prints += it.qty;
    else apparel += it.qty;
  });
  const firstMockupUrl = getFirstMockupUrl(o);
  const hasMockup = !!firstMockupUrl;

  if (style === 'pipeline') {
    // PIPELINE style
    card.classList.add('pipeline-card');
    card.innerHTML = `
      <div class="card-header">
        <span class="order-number">${orderNum}</span>
        <span class="time-ago-pill">${timeAgo(o.receivedAt)}</span>
      </div>
      <div class="card-body ${hasMockup ? 'has-mockup' : 'no-mockup'}">
        ${hasMockup ? `
          <div class="mockup-slot">
            <img src="${firstMockupUrl}" alt="Mockup preview" loading="lazy" />
          </div>
        ` : ''}
        <div class="cust-name">${custName}</div>
        <div class="counts">
          <span class="apparel-count"><img class="count-icon" src="${o.blanksOrdered ? APPAREL_ICON_GREEN : APPAREL_ICON}" alt="" /> ${apparel}</span>
          <span class="prints-count"><img class="count-icon" src="${o.printsOrdered ? PRINT_ICON_GREEN : PRINT_ICON}" alt="" /> ${prints}</span>
        </div>
      </div>
      <div class="card-footer">
        <span class="footer-label">Subtotal</span>
        <span class="footer-value">$${(o.subtotal||0).toFixed(2)}</span>
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
    const totalApparel = (o.items || []).reduce((sum, it) => sum + (isPrintItem(it) ? 0 : it.qty), 0);
    const prog = typeof o.progress === 'number' ? o.progress : 0;
    const pct = totalApparel ? Math.round((prog / totalApparel) * 100) : 0;
    card.classList.add('pipeline-card', 'print-card');
    card.innerHTML = `
      <div class="card-header">
        <span class="order-number">${orderNum}</span>
        <span class="time-ago-pill">${timeAgo(o.receivedAt)}</span>
      </div>
      <div class="card-body">
        <div class="progress-view">
          <div class="cust-name">${custName}</div>
          <div class="progress-pct">${pct}%</div>
        </div>
        <div class="normal-view">
          <div class="cust-name">${custName}</div>
          <div class="counts">
            <span class="apparel-count"><img class="count-icon" src="${o.blanksOrdered ? APPAREL_ICON_GREEN : APPAREL_ICON}" alt="" /> ${apparel}</span>
            <span class="prints-count"><img class="count-icon" src="${o.printsOrdered ? PRINT_ICON_GREEN : PRINT_ICON}" alt="" /> ${prints}</span>
          </div>
        </div>
      </div>
      <div class="card-footer">
        <span class="footer-label">Subtotal</span>
        <span class="footer-value">$${(o.subtotal||0).toFixed(2)}</span>
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
      <div class="card-header"><span class="cust-name">${custName}</span></div>
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
      <div class="order-cust">${custName}</div>
      <div class="counts">Apparel: ${apparel}, Prints: ${prints}</div>
    `;
    requestAnimationFrame(() => {
      card.querySelectorAll('.order-cust').forEach(shortenNameIfWrapped);
    });
  }

  card.style.position = 'relative';

  const del = document.createElement('button');
  del.className   = 'delete-btn';
  del.textContent = '×';
  del.title       = 'Delete this order';
  del.addEventListener('click', async e => {
    e.stopPropagation();
    if (confirm(`Delete ${o.name}?`)) {
      await window.api.deleteOrder(o.name);
      await renderBoard();
    }
  });
  card.appendChild(del);

  // drag handlers
  card.addEventListener('dragstart', e => {
    document.body.classList.add('dragging-cursor');
    card.classList.add('dragging');
    e.dataTransfer.setData('text/plain', o.name);
  });

  card.addEventListener('dragend', () => {
    document.body.classList.remove('dragging-cursor');
    card.classList.remove('dragging');
  });

  if (card.classList.contains('pipeline-card')) {
    const delay = (Math.random() * 3).toFixed(2) + 's';
    card.style.setProperty('--shimmer-delay', delay);
  }

  card.addEventListener('click', (ev) => {
    if (shouldHandleMobilePipelineSelection(o)) {
      ev.preventDefault();
      ev.stopPropagation();
      toggleMobileCardSelection(o.name, card);
      return;
    }
    openDetail(o);
  });

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
      if (!isPrintItem(it)) apparel += it.qty;
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
    e.dataTransfer.setData('text/plain', `bundle:${name}`);
  });

  card.addEventListener('dragend', () => {
    document.body.classList.remove('dragging-cursor');
    card.classList.remove('dragging');
  });

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
    closeBundleModal();
    await renderBoard();
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

function getAssetPixelDimensions(assetEntry) {
  const meta = assetEntry && typeof assetEntry === 'object'
    ? (typeof assetEntry.metadata === 'object' && assetEntry.metadata) || (typeof assetEntry.meta === 'object' && assetEntry.meta) || null
    : null;
  const sources = [assetEntry, meta].filter(Boolean);
  for (const source of sources) {
    const width = source.width || source.w || source.pixelWidth || source.widthPx;
    const height = source.height || source.h || source.pixelHeight || source.heightPx;
    if (Number.isFinite(Number(width)) && Number.isFinite(Number(height))) {
      return `${Number(width)} x ${Number(height)}`;
    }
    const dims = source.dimensions || source.pixelDimensions || source.dimensionsPx;
    if (typeof dims === 'string' && dims.trim()) return dims.trim();
  }
  return '';
}

function getAssetFileMetaText(assetEntry) {
  const url = getAssetUrlValue(assetEntry);
  const filename = detailAssetFilename(url, 0).split('?')[0];
  const ext = (filename.match(/\.([a-z0-9]+)$/i)?.[1] || (assetEntry.isSvg ? 'svg' : '')).toUpperCase();
  const dimensions = getAssetPixelDimensions(assetEntry);
  return [ext, dimensions].filter(Boolean).join(' · ');
}

function splitOrderAssets(order) {
  const seen = new Set();
  const buckets = { mockups: [], front: [], back: [], extras: [] };
  (order.items || []).forEach(item => {
    (item.assets || []).forEach(asset => {
      const url = getAssetUrlValue(asset);
      if (typeof url !== 'string') return;
      if (!url.toLowerCase().includes('/orders/')) return;
      const norm = url.toLowerCase();
      if (seen.has(norm)) return;
      seen.add(norm);

      const isSvg = /\.svg(\?|$)/i.test(url);
      const isMockup = /side\.png(\?|$)/i.test(norm);
      const isFront = /(front\.(svg|png|jpe?g)|_front(?:\.[a-z0-9]+)?)(\?|$)/i.test(norm);
      const isBack = /(back\.(svg|png|jpe?g)|_back(?:\.[a-z0-9]+)?)(\?|$)/i.test(norm);

      const metadata = asset && typeof asset === 'object'
        ? (typeof asset.metadata === 'object' && asset.metadata) || (typeof asset.meta === 'object' && asset.meta) || undefined
        : undefined;
      const dimensionsIn = getAssetDimensionsIn(asset);
      const entry = { url, isSvg };
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
  const assets = splitOrderAssets(order);
  const entry = assets.mockups[0];
  return entry ? getAssetUrlValue(entry) : '';
}

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

async function handleAssetDownload(url, filename, btn) {
  if (!window.api || typeof window.api.downloadAsset !== 'function') {
    alert('Download is not available in this build.');
    return;
  }
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Downloading...';
  try {
    await window.api.downloadAsset(url, filename);
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
  const designFilesCount = document.getElementById('design-files-count');
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
  if (!mockupTrack || !mockupPlaceholder || !designPlaceholder ||
      !lists.front || !lists.back || !lists.extras ||
      !groups.front || !groups.back || !groups.extras) return;

  const token = ++detailAssetRenderToken;
  cleanupDetailAssetPreviews();
  mockupTrack.innerHTML = '';
  Object.values(lists).forEach(list => { list.innerHTML = ''; });
  Object.values(groups).forEach(g => {
    g.classList.remove('hidden', 'is-collapsed');
    const toggle = g.querySelector('.design-group-title');
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
  });

  const assets = splitOrderAssets(order);

  if (!assets.mockups.length) {
    mockupTrack.classList.remove('left-align', 'center-align');
    mockupPlaceholder.classList.remove('hidden');
  } else {
    mockupPlaceholder.classList.add('hidden');
    mockupTrack.classList.remove('left-align', 'center-align');
    mockupTrack.classList.add(assets.mockups.length >= 4 ? 'left-align' : 'center-align');
    assets.mockups.forEach(({ url, isSvg }, idx) => {
      if (token !== detailAssetRenderToken) return;
      const thumb = document.createElement('div');
      thumb.className = 'mockup-thumb';

      const img = document.createElement('img');
      img.alt = `Mockup ${idx + 1}`;
      img.loading = 'lazy';
      thumb.appendChild(img);

      thumb.addEventListener('click', () => openAssetViewer(img.src || url));

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

      mockupTrack.appendChild(thumb);
    });
  }

  const totalDesigns = assets.front.length + assets.back.length + assets.extras.length;
  designPlaceholder.classList.toggle('hidden', totalDesigns > 0);
  if (designFilesCount) {
    designFilesCount.textContent = `${totalDesigns} ${totalDesigns === 1 ? 'file' : 'files'}`;
  }

  const renderDesignGroup = (listEl, wrapEl, items, printTypeLabel) => {
    wrapEl.classList.toggle('hidden', !items.length);
    const toggle = wrapEl.querySelector('.design-group-title');
    const count = wrapEl.querySelector('.design-group-count');
    if (count) count.textContent = String(items.length);
    if (toggle) {
      toggle.onclick = () => {
        const collapsed = wrapEl.classList.toggle('is-collapsed');
        toggle.setAttribute('aria-expanded', String(!collapsed));
      };
    }
    if (!items.length) return;
    items.forEach((item, idx) => {
      const { url, isSvg } = item;
      if (token !== detailAssetRenderToken) return;
      const tile = document.createElement('div');
      tile.className = 'design-file-row';

      const thumb = document.createElement('div');
      thumb.className = 'design-thumb';
      const img = document.createElement('img');
      const labelText = detailAssetFilename(url, idx);
      img.alt = labelText;
      img.loading = 'lazy';
      thumb.appendChild(img);
      thumb.addEventListener('click', () => openAssetViewer(img.src || url));
      tile.appendChild(thumb);

      const info = document.createElement('div');
      info.className = 'design-file-info';

      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'design-label';
      label.textContent = labelText;
      label.title = labelText;
      label.addEventListener('click', () => openAssetViewer(img.src || url));
      info.appendChild(label);

      const badge = document.createElement('span');
      badge.className = 'design-print-type';
      badge.textContent = printTypeLabel;
      info.appendChild(badge);

      const meta = document.createElement('div');
      meta.className = 'design-file-meta';
      meta.textContent = getAssetFileMetaText(item);
      info.appendChild(meta);

      tile.appendChild(info);

      const actions = document.createElement('div');
      actions.className = 'design-actions';
      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'detail-asset-download';
      downloadBtn.textContent = 'Download';
      const filename = detailAssetFilename(url, idx);
      downloadBtn.addEventListener('click', () => handleAssetDownload(url, filename, downloadBtn));
      actions.appendChild(downloadBtn);
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

  renderDesignGroup(lists.front, groups.front, assets.front, 'Front Print');
  renderDesignGroup(lists.back, groups.back, assets.back, 'Back Print');
  renderDesignGroup(lists.extras, groups.extras, assets.extras, 'Extra');
}

/**
 * Split the order name into order number and customer name.
 * Accepts en dash, em dash, or hyphen separators with flexible spacing.
 * @param {string} rawName - Full order name string.
 * @returns {[string, string]} Tuple of [orderNum, custName].
 */
function splitOrderName(rawName) {
  if (!rawName) return ['', ''];
  const match = rawName.match(/^(.*?)\s*[\u2013\u2014-]\s*(.*)$/);
  if (match) return [match[1], match[2]];
  return [rawName, ''];
}

/**
 * Align the detail progress controls with the active viewport.
 * Adds mobile-only labels inside the progress bar and removes them on desktop.
 * @returns {{countEl: HTMLElement|null, percentEl: HTMLElement|null, container: HTMLElement|null}}
 */
function syncDetailProgressLayout() {
  const progressPlus = document.getElementById('progress-plus1');
  const progressCustom = document.getElementById('progress-custom');
  if (progressPlus) progressPlus.textContent = isMobileViewport ? 'Increment' : '+1';
  if (progressCustom) progressCustom.textContent = 'Custom Amount';

  const container = document.getElementById('progress-bar-container');
  if (!container) {
    return { countEl: null, percentEl: null, container: null };
  }

  let countEl = document.getElementById('progress-count');
  let percentEl = document.getElementById('progress-percent');

  if (isMobileViewport) {
    if (!countEl) {
      countEl = document.createElement('span');
      countEl.id = 'progress-count';
      container.appendChild(countEl);
    }
    if (!percentEl) {
      percentEl = document.createElement('span');
      percentEl.id = 'progress-percent';
      container.appendChild(percentEl);
    }
  } else {
    if (countEl) countEl.remove();
    if (percentEl) percentEl.remove();
    countEl = null;
    percentEl = null;
    container.style.removeProperty('--progress-pct');
  }

  return { countEl, percentEl, container };
}

/**
 * Render the detail progress section, including mobile in-bar labels.
 * Desktop retains the original inline count text.
 * @param {Object} order - Order data backing the detail view.
 */
function updateDetailProgressUI(order) {
  if (!order) return;
  const totalApparel = (order.items || []).reduce((sum, it) => sum + (isPrintItem(it) ? 0 : it.qty), 0);
  order.totalApparel = totalApparel;
  if (typeof order.progress !== 'number') order.progress = 0;

  const progressText = document.getElementById('progress-text');
  const progressBar = document.getElementById('progress-bar');
  if (!progressText || !progressBar) return;

  const pct = totalApparel ? Math.min(100, (order.progress / totalApparel) * 100) : 0;
  progressBar.style.width = pct + '%';

  const { countEl, percentEl, container } = syncDetailProgressLayout();
  if (isMobileViewport) {
    progressText.textContent = 'Order Progress';
    if (countEl) countEl.textContent = `${order.progress}/${totalApparel} Pieces Completed`;
    if (percentEl) percentEl.textContent = `${Math.round(pct)}%`;
    if (container) {
      container.style.setProperty('--progress-pct', `${pct}%`);
      container.classList.toggle('progress-percent-outside', pct < 50);
    }
  } else {
    progressText.textContent = `${order.progress} / ${totalApparel} pieces printed`;
  }
}

/**
 * Update the detail panel content using the latest order data.
 * @param {Object} o - Order data backing the detail view.
 * @param {{preserveEditing?: boolean}} [opts] - Preserve inline editing state when true.
 */
function applyDetailData(o, opts = {}) {
  const { preserveEditing = false } = opts;
  detailOrder = o;
  renderOrderAssets(o);
  syncDetailDesignPanelPlacement();
  // fill header
  document.getElementById('detail-timestamp').textContent = new Date(o.receivedAt).toLocaleString();

  // customer & notes
  const [orderNum, custName] = splitOrderName(o.name);
  document.getElementById('detail-order-id').textContent   = `Order ${orderNum}`;
  document.getElementById('detail-cust-name').textContent = custName;
  if (!preserveEditing || !mobileNotesEditing) {
    document.getElementById('detail-notes').textContent = o.notes || 'No special instructions';
    const notesInput = document.getElementById('detail-notes-input');
    if (notesInput) notesInput.value = o.notes || '';
  }
  document.getElementById('detail-edit-name-btn').onclick = () => openNameModal(o);
  document.getElementById('detail-edit-notes-btn').onclick = () => openNotesModal(o);
  document.getElementById('detail-view-notes-btn').onclick = () => openViewNotesModal(o);

  // progress
  updateDetailProgressUI(o);
  const progressPlus = document.getElementById('progress-plus1');
  const progressCustom = document.getElementById('progress-custom');
  if (progressPlus) {
    progressPlus.onclick = async () => {
      const total = o.totalApparel || 0;
      if (o.progress < total) {
        o.progress += 1;
        await window.api.updateProgress(o.name, o.progress);
        updateDetailProgressUI(o);
      }
    };
  }
  if (progressCustom) {
    progressCustom.onclick = () => openProgressModal(o, () => updateDetailProgressUI(o));
  }

  // line items
  const tbody = document.querySelector('#detail-items tbody');
  tbody.innerHTML = (o.items || []).map(i => {
    const p = Number(i.unitPrice) || 0;
    const lineTotal = (p * i.qty).toFixed(2) || 0;
    return `
      <tr>
        <td style="padding:4px 8px;">${i.qty}</td>
        <td style="padding:4px 8px;">${i.title}</td>
        <td style="padding:4px 8px;">${i.variantTitle || '-'}</td>  <!-- new -->
        <td style="padding:4px 8px; text-align:right;">$${lineTotal}</td>
      </tr>`;
  }).join('');

  // discount & total
  const disc = Number(o.discount) || 0;
  const tot  = Number(o.total)    || 0;
  
  document.getElementById('detail-discount').textContent = `-$${disc.toFixed(2)}`;
  document.getElementById('detail-total').textContent    = `$${tot.toFixed(2)}`;

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
    o.blanksStatus = blanks;
    o.printsStatus = prints;
    o.blanksOrdered = blanksOrd;
    o.printsOrdered = printsOrd;
    await renderBoard();
    applyBtn.classList.add('hidden');
    const bundleOverlay = document.getElementById('bundle-overlay');
    if (!bundleOverlay.classList.contains('hidden')) {
      const bundleName = document.getElementById('bundle-title').textContent;
      const bundleOrders = allOrders.filter(x => x.bundle === bundleName);
      const container = document.getElementById('bundle-cards');
      container.innerHTML = '';
      bundleOrders.forEach(ord => container.appendChild(makeCard(ord, 'pipeline')));
    }
  };
}

/**
 * Populate and reveal the detail overlay for a selected order.
 * @param {Object} o - Order data backing the detail view.
 */
function openDetail(o) {
  setMobileNotesEditing(false);
  setMobileItemsExpanded(false);
  applyDetailData(o);

  // show overlay
  const overlay = document.getElementById('detail-overlay');
  const detailCard = document.getElementById('detail-card');
  if (mobileDetailDragCleanup) {
    mobileDetailDragCleanup();
    mobileDetailDragCleanup = null;
  }
  if (overlay) {
    overlay.classList.replace('hidden', 'visible');
    overlay.classList.add('visible');
    if (isMobileViewport) {
      overlay.classList.add('mobile-bottomsheet');
      document.body.classList.add('mobile-detail-open');
      if (detailCard) {
        detailCard.style.transition = 'transform 0.25s ease';
        detailCard.style.transform = 'translateY(100%)';
        requestAnimationFrame(() => {
          detailCard.style.transform = 'translateY(0)';
        });
        mobileDetailDragCleanup = setupMobileDetailDrag(detailCard);
      }
    } else {
      overlay.classList.remove('mobile-bottomsheet');
      document.body.classList.remove('mobile-detail-open');
    }
  }

  document.body.classList.add('detail-open');

  document.querySelector('.pipeline').classList.add('no-delete');

  if (notesResizeHandler) {
    window.removeEventListener('resize', notesResizeHandler);
    notesResizeHandler = null;
  }
  const notesWrapper = document.getElementById('detail-notes-wrapper');
  const detailCardEl = document.getElementById('detail-card');
  const updateNotesLimit = () => {
    notesWrapper.style.maxHeight = Math.round(detailCardEl.clientHeight * 0.15) + 'px';
  };
  setTimeout(updateNotesLimit, 0);
  window.addEventListener('resize', updateNotesLimit);
  notesResizeHandler = updateNotesLimit;
}
/**
 * Close the order detail overlay. On mobile this animates the bottom sheet
 * downward and reuses the same handler invoked by the header close button,
 * overlay tap, or drag gesture so future detail extensions stay centralized.
 */
function closeDetail() {
  const overlay = document.getElementById('detail-overlay');
  const detailCard = document.getElementById('detail-card');
  const finishClose = () => {
    if (overlay) {
      overlay.classList.replace('visible', 'hidden');
      overlay.classList.remove('mobile-bottomsheet');
    }
    if (detailCard) {
      detailCard.style.transition = '';
      detailCard.style.transform = '';
    }
    document.body.classList.remove('detail-open');
    document.body.classList.remove('mobile-detail-open');
  };

  if (mobileDetailDragCleanup) {
    mobileDetailDragCleanup();
    mobileDetailDragCleanup = null;
  }

  if (isMobileViewport && overlay && detailCard && overlay.classList.contains('mobile-bottomsheet')) {
    detailCard.style.transition = 'transform 0.2s ease';
    detailCard.style.transform = 'translateY(100%)';
    setTimeout(finishClose, 220);
  } else {
    finishClose();
  }

  cleanupDetailAssetPreviews();
  const mockupTrack = document.getElementById('detail-mockups-track');
  if (mockupTrack) mockupTrack.innerHTML = '';
  const mockupPlaceholder = document.getElementById('detail-mockups-placeholder');
  if (mockupPlaceholder) mockupPlaceholder.classList.remove('hidden');
  const designPlaceholder = document.getElementById('detail-designs-placeholder');
  if (designPlaceholder) designPlaceholder.classList.remove('hidden');
  const designFilesCount = document.getElementById('design-files-count');
  if (designFilesCount) designFilesCount.textContent = '0 files';
  ['design-front-list', 'design-back-list', 'design-extras-list'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
  ['design-group-front', 'design-group-back', 'design-group-extras'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.remove('hidden', 'is-collapsed');
      const toggle = el.querySelector('.design-group-title');
      const count = el.querySelector('.design-group-count');
      if (toggle) toggle.setAttribute('aria-expanded', 'true');
      if (count) count.textContent = '0';
    }
  });
  closeAssetViewer();
  document.querySelector('.pipeline').classList.remove('no-delete');
  if (notesResizeHandler) {
    window.removeEventListener('resize', notesResizeHandler);
    notesResizeHandler = null;
  }
}

/**
 * Refresh the open detail view with the newest order data.
 * Keeps inline editing state intact while syncing remote changes.
 */
function refreshDetailIfOpen() {
  if (!detailOrder || !document.body.classList.contains('detail-open')) return;
  const latest = allOrders.find(o => o.name === detailOrder.name);
  if (!latest) {
    closeDetail();
    return;
  }
  applyDetailData(latest, { preserveEditing: true });
}

function openNotesModal(order) {
  const overlay = document.getElementById('notes-overlay');
  const input = document.getElementById('notes-input');
  const confirmBtn = document.getElementById('notes-confirm');
  const cancelBtn = document.getElementById('notes-cancel');

  input.value = order.notes || 'No special instructions';

  const cleanup = () => {
    overlay.classList.add('hidden');
    confirmBtn.onclick = null;
    cancelBtn.onclick = null;
    overlay.onclick = null;
  };

  confirmBtn.onclick = async () => {
    const val = input.value;
    await window.api.updateNotes(order.name, val);
    order.notes = val;
    document.getElementById('detail-notes').textContent = val || 'No special instructions';
    cleanup();
  };

  cancelBtn.onclick = () => cleanup();
  overlay.onclick = e => { if (e.target.id === 'notes-overlay') cleanup(); };

  overlay.classList.remove('hidden');
  input.focus();
}

function openNameModal(order) {
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
    await window.api.updateName(order.name, val);
    order.name = `${orderNum} – ${val}`;
    document.getElementById('detail-cust-name').textContent = val;
    cleanup();
    await renderBoard();
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

  input.value = order.progress;

  const cleanup = () => {
    overlay.classList.add('hidden');
    confirmBtn.onclick = null;
    cancelBtn.onclick = null;
    overlay.onclick = null;
  };

  confirmBtn.onclick = async () => {
    let val = parseInt(input.value, 10);
    if (isNaN(val) || val < 0) val = 0;
    if (val > order.totalApparel) val = order.totalApparel;
    order.progress = val;
    await window.api.updateProgress(order.name, order.progress);
    updateFn();
    cleanup();
  };

  cancelBtn.onclick = () => cleanup();
  overlay.onclick = e => { if (e.target.id === 'progress-overlay') cleanup(); };

  overlay.classList.remove('hidden');
  input.focus();
}

// close handlers
document.getElementById('detail-close').addEventListener('click', closeDetail);
document.getElementById('detail-overlay')
  .addEventListener('click', e => {
    if (e.target.id === 'detail-overlay') {
      closeDetail();
    }
  });

// fetch & render every zone
async function renderBoard() {
  allOrders = await window.api.getQueue();

  // Pipeline
  const recs = allOrders.filter(x => x.status === 'received');
  const recEl = document.getElementById('col-received');
  recEl.innerHTML = '';
  const recGroups = {}, recSingles = [];
  recs.forEach(o => {
    if (o.bundle) {
      if (!recGroups[o.bundle]) recGroups[o.bundle] = [];
      recGroups[o.bundle].push(o);
    } else {
      recSingles.push(o);
    }
  });
  sortBundlesByOldest(Object.entries(recGroups))
    .forEach(([n, arr]) => recEl.appendChild(makeBundleCard(n, arr)));
  recSingles.forEach(o => recEl.appendChild(makeCard(o, 'pipeline')));
  document.getElementById('pipeline-count').textContent = recs.length;

  // ToOrder picks
  const picks = allOrders.filter(o => o.status === 'toOrder');
  const pickedEl = document.getElementById('picked-cards');
  pickedEl.innerHTML = '';
  const pickGroups = {}, pickSingles = [];
  picks.forEach(o => {
    if (o.bundle) {
      if (!pickGroups[o.bundle]) pickGroups[o.bundle] = [];
      pickGroups[o.bundle].push(o);
    } else {
      pickSingles.push(o);
    }
  });
  sortBundlesByOldest(Object.entries(pickGroups))
    .forEach(([n, arr]) => pickedEl.appendChild(makeBundleCard(n, arr, 'picked')));
  pickSingles.forEach(o => pickedEl.appendChild(makeCard(o, 'picked')));
  updateSummary();

  // Blanks Ordered
  const blanksEl = document.getElementById('col-blanks');
  blanksEl.innerHTML = '';
  const blankOrders = allOrders.filter(x => x.status === 'blanks');
  const blankGroups = {}, blankSingles = [];
  blankOrders.forEach(o => {
    if (o.bundle) {
      if (!blankGroups[o.bundle]) blankGroups[o.bundle] = [];
      blankGroups[o.bundle].push(o);
    } else {
      blankSingles.push(o);
    }
  });
  sortBundlesByOldest(Object.entries(blankGroups))
    .forEach(([n, arr]) => blanksEl.appendChild(makeBundleCard(n, arr)));
  blankSingles.forEach(o => blanksEl.appendChild(makeCard(o, 'pipeline')));

  // Ready To Print
  const printEl = document.getElementById('col-print');
  printEl.innerHTML = '';
  const printOrders = allOrders.filter(x => x.status === 'print');
  const printGroups = {}, printSingles = [];
  printOrders.forEach(o => {
    if (o.bundle) {
      if (!printGroups[o.bundle]) printGroups[o.bundle] = [];
      printGroups[o.bundle].push(o);
    } else {
      printSingles.push(o);
    }
  });
  sortBundlesByOldest(Object.entries(printGroups))
    .forEach(([n, arr]) => printEl.appendChild(makeBundleCard(n, arr)));
  printSingles.forEach(o => printEl.appendChild(makeCard(o, 'printProgress')));

  refreshMobileSelectionUI();
  refreshDetailIfOpen();
}

// recalc summary from "toOrder" items
function updateSummary() {
  const picks = allOrders.filter(x => x.status === 'toOrder');
  const summary = { Apparel: 0, Prints: 0 };
  picks.forEach(o =>
    (o.items || []).forEach(it => {
      if (isPrintItem(it)) summary.Prints += it.qty;
      else summary.Apparel += it.qty;
    })
  );
  const ul = document.getElementById('summary-list');
  ul.innerHTML = Object.entries(summary)
    .map(([k, v]) => `<li>${k}: ${v}</li>`)
    .join('');
  document.getElementById('cart-total').textContent =
    `Total items: ${summary.Apparel}`;
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
  cancelBundle();
  await renderBoard();
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
    // highlight only the dragÎ“Ã‡Ã‰area if desired:
    e.dataTransfer.dropEffect = 'move';  // show move cursor instead of "noÎ“Ã‡Ã‰drop"
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

    // 1) Grab the ID that was set on dragstart
    const id = e.dataTransfer.getData('text/plain');
    console.log(`Î“Ã¥Ã† drop: id="${id}" status="${status}"`);

    if (!id) {
      console.warn('Drop ignored: no order ID present');
      return;
    }

    try {
      if (id.startsWith('bundle:')) {
        const name = id.slice(7);
        await window.api.updateBundleStatus(name, status);
      } else {
        await window.api.updateStatus(id, status);
      }
      await renderBoard();
    } catch (err) {
      console.error('Error updating status on drop:', err);
    }
  });
}

function setupDropZones() {
  // Order Pipeline Î“Ã¥Ã† you can drop back as Î“Ã‡Ã¿received'
  makeDropZone(document.getElementById('col-received'), 'received');
  // Drag area itself Î“Ã§Ã† toOrder
  const dragArea = document.getElementById('col-toOrder');
  makeDropZone(dragArea, 'toOrder');
  // Blanks Ordered
  makeDropZone(document.getElementById('col-blanks'), 'blanks');
  // Ready To Print
  makeDropZone(document.getElementById('col-print'), 'print');
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
    console.warn('Î“ÃœÃ¡âˆ©â••Ã… window.api.subscribeQueueChanges is not available (check web-shim.js)');
  }

  initMobileTabs();
  initMobileSelectionControls();
  initMobileDetailUI();

  // wire up the four zones

  // Submit button
  const submitBtn = document.getElementById('order-submit');
  if (!submitBtn) {
    console.warn('Î“ÃœÃ¡âˆ©â••Ã… #order-submit button not found');
  } else {
    submitBtn.addEventListener('click', async () => {
      const toOrder = allOrders.filter(x => x.status === 'toOrder').map(x => x.name);
      if (!toOrder.length) {
        return alert('Drag some cards into "Drag cards here" first.');
      }

      submitBtn.textContent = 'SubmittingÎ“Ã‡Âª';
      submitBtn.disabled = true;

      try {
        await window.api.processBatch(toOrder);

        // auto-move into Blanks Ordered
        for (const id of toOrder) {
          await window.api.updateStatus(id, 'blanks');
        }

        await renderBoard();
        submitBtn.textContent = 'Î“Â£Ã  Submitted';

        setTimeout(() => {
          submitBtn.textContent = 'Submit To S&S';
        }, 3000);

      } catch (err) {
        submitBtn.textContent = `Î“Â¥Ã® ${err?.message || err}`;
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  const clearBtn = document.getElementById('clear-picked');
  if (!clearBtn) {
    console.warn('Î“ÃœÃ¡âˆ©â••Ã… #clear-picked button not found');
  } else {
    clearBtn.addEventListener('click', async () => {
      const toOrder = allOrders
        .filter(o => o.status === 'toOrder')
        .map(o => o.name);

      if (!toOrder.length) return;

      clearBtn.disabled = true;
      try {
        for (const id of toOrder) {
          await window.api.updateStatus(id, 'received');
        }
        await renderBoard();
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
