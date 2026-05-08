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
let fileRemoveMode = false;
const selectedFiles = new Set();
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
// utility to detect “print” items by SKU or title
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

const MOBILE_TAB_BREAKPOINT = 900;
const MOBILE_TABS = ['pipeline', 'blanksCart', 'blanksOrdered', 'readyToPrint'];
let activeMobileTab = MOBILE_TABS[0];
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

/**
 * Render one status column from the cached allOrders array.
 * @param {string} status - Queue status represented by the target column.
 */
function renderStatusColumn(status) {
  const config = STATUS_COLUMN_CONFIG[status];
  if (!config) return;

  const container = document.getElementById(config.containerId);
  if (!container) return;

  const orders = allOrders.filter(order => (order.status || 'received') === status);
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

  const bundleOrders = allOrders.filter(order => order.bundle === bundleName);
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
 */
async function renderBoardFromLocalState(statuses) {
  await renderBoard({ useLocalOrders: true, statuses });
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

// build a card from the record’s `items` array
function makeCard(o, style = 'default') {
  const card = document.createElement('div');
  card.className   = 'card';
  card.draggable   = true;
  card.dataset.orderId = o.name;

  // split “#1234 – John Smith”
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
  Object.values(groups).forEach(g => g.classList.remove('hidden'));

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

  renderDesignGroup(lists.front, groups.front, assets.front);
  renderDesignGroup(lists.back, groups.back, assets.back);
  renderDesignGroup(lists.extras, groups.extras, assets.extras);
}

function openDetail(o) {
  detailOrder = o;
  renderOrderAssets(o);
  // fill header
  document.getElementById('detail-timestamp').textContent = new Date(o.receivedAt).toLocaleString();

  // customer & notes
  const [orderNum, custName = ''] = (o.name || '').split(' – ');
  document.getElementById('detail-order-id').textContent   = `Order ${orderNum}`;
  document.getElementById('detail-cust-name').textContent = custName;
  document.getElementById('detail-notes').textContent = o.notes || 'No special instructions';
  document.getElementById('detail-edit-name-btn').onclick = () => openNameModal(o);
  document.getElementById('detail-edit-notes-btn').onclick = () => openNotesModal(o);
  document.getElementById('detail-view-notes-btn').onclick = () => openViewNotesModal(o);

  // progress
  const totalApparel = (o.items || []).reduce((sum, it) => sum + (isPrintItem(it) ? 0 : it.qty), 0);
  o.totalApparel = totalApparel;
  if (typeof o.progress !== 'number') o.progress = 0;
  const progressText = document.getElementById('progress-text');
  const progressBar = document.getElementById('progress-bar');
  const updateProgressUI = () => {
    progressText.textContent = `${o.progress} / ${totalApparel} pieces printed`;
    const pct = totalApparel ? Math.min(100, (o.progress / totalApparel) * 100) : 0;
    progressBar.style.width = pct + '%';
  };
  updateProgressUI();
  document.getElementById('progress-plus1').onclick = async () => {
    if (o.progress < totalApparel) {
      o.progress += 1;
      await window.api.updateProgress(o.name, o.progress);
      await renderBoardFromLocalState([o.status || 'received']);
      updateProgressUI();
    }
  };
  document.getElementById('progress-custom').onclick = () => openProgressModal(o, updateProgressUI);

  // line items
  const tbody = document.querySelector('#detail-items tbody');
  tbody.innerHTML = (o.items || []).map(i => {
    const p = Number(i.unitPrice) || 0;
    const lineTotal = (p * i.qty).toFixed(2) || 0;
    return `
      <tr>
        <td style="padding:4px 8px;">${i.qty}</td>
        <td style="padding:4px 8px;">${i.title}</td>
        <td style="padding:4px 8px;">${i.variantTitle || '–'}</td>  <!-- new -->
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
    const touchedStatuses = patchLocalOrders([o.name], {
      blanksStatus: blanks,
      printsStatus: prints,
      blanksOrdered: blanksOrd,
      printsOrdered: printsOrd
    });
    await renderBoardFromLocalState(touchedStatuses);
    applyBtn.classList.add('hidden');
  };

  document.getElementById('detail-files-btn').onclick = () => openFilesModal(o);

  // show overlay
  document.getElementById('detail-overlay')
    .classList.replace('hidden', 'visible');

  document.getElementById('detail-overlay').classList.add('visible');
  document.body.classList.add('detail-open');

  document.querySelector('.pipeline').classList.add('no-delete');

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
    await renderBoardFromLocalState([order.status || 'received']);
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
/**
 * Render the order board from Redis or from the cached order array.
 * Full refreshes still fetch the queue, while mutation paths pass
 * useLocalOrders/statuses so only impacted columns are rebuilt.
 * @param {{useLocalOrders?: boolean, statuses?: Iterable<string>|string}} [options]
 */
async function renderBoard(options = {}) {
  const { useLocalOrders = false, statuses = null } = options;
  if (!useLocalOrders) {
    allOrders = await window.api.getQueue();
  }

  normalizeBoardStatuses(statuses).forEach(renderStatusColumn);
  refreshOpenBundleModal();
}

// recalc summary from “toOrder” items
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

  // wire up the four zones

  // Submit button
  const submitBtn = document.getElementById('order-submit');
  if (!submitBtn) {
    console.warn('⚠️ #order-submit button not found');
  } else {
    submitBtn.addEventListener('click', async () => {
      const toOrder = allOrders.filter(x => x.status === 'toOrder').map(x => x.name);
      if (!toOrder.length) {
        return alert('Drag some cards into “Drag cards here” first.');
      }

      submitBtn.textContent = 'Submitting…';
      submitBtn.disabled = true;

      try {
        await window.api.processBatch(toOrder);

        // auto-move into Blanks Ordered
        if (typeof window.api.updateStatuses === 'function') {
          await window.api.updateStatuses(toOrder, 'blanks');
        } else {
          await Promise.all(toOrder.map(id => window.api.updateStatus(id, 'blanks')));
        }

        const touchedStatuses = patchLocalOrders(toOrder, { status: 'blanks' });
        await renderBoardFromLocalState(touchedStatuses);
        submitBtn.textContent = '✅ Submitted';

        setTimeout(() => {
          submitBtn.textContent = 'Submit To S&S';
        }, 3000);

      } catch (err) {
        submitBtn.textContent = `❌ ${err?.message || err}`;
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  const clearBtn = document.getElementById('clear-picked');
  if (!clearBtn) {
    console.warn('⚠️ #clear-picked button not found');
  } else {
    clearBtn.addEventListener('click', async () => {
      const toOrder = allOrders
        .filter(o => o.status === 'toOrder')
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
