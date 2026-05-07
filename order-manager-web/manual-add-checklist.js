(() => {
  const STORAGE_KEY = 'printmo.manualAddChecklist.v1';
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

  let checkedItems = loadCheckedItems();
  let currentItems = [];
  let currentOrders = [];
  let updateFrame = 0;
  let uiReady = false;

  function loadCheckedItems() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      console.warn('Unable to load manual add checklist state', error);
      return {};
    }
  }

  function saveCheckedItems() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(checkedItems));
    } catch (error) {
      console.warn('Unable to save manual add checklist state', error);
    }
  }

  function getAllOrders() {
    try {
      if (typeof allOrders !== 'undefined' && Array.isArray(allOrders)) return allOrders;
    } catch (error) {
      return [];
    }
    return [];
  }

  function isInCartOrder(order) {
    return order?.status === 'blanks' && !Boolean(Number(order.blanksOrdered || 0));
  }

  function isPrintLineItem(item) {
    try {
      if (typeof isPrintItem === 'function') return isPrintItem(item);
    } catch (error) {
      // Fall through to the local title list.
    }
    return PRINT_TITLE_FALLBACK.has(item?.title);
  }

  function itemSku(item) {
    return String(item?.sku ?? '').trim();
  }

  function hasSku(item) {
    return itemSku(item).length > 0;
  }

  function orderParts(orderName) {
    const [number, customer = ''] = String(orderName || '').split(' \u2013 ');
    return {
      number: number || String(orderName || ''),
      customer
    };
  }

  function itemKey(order, item, index) {
    return [
      order.name || '',
      index,
      item.title || '',
      item.variantTitle || '',
      item.qty || ''
    ].join('|');
  }

  function compareOrdersByReceived(left, right) {
    const leftTime = Date.parse(left.receivedAt || '');
    const rightTime = Date.parse(right.receivedAt || '');
    return (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0);
  }

  function buildManualItems(orders) {
    const inCart = orders.filter(isInCartOrder).sort(compareOrdersByReceived);
    return inCart.flatMap(order => {
      const parts = orderParts(order.name);
      return (order.items || []).flatMap((item, index) => {
        if (isPrintLineItem(item) || hasSku(item)) return [];
        const qty = Number(item.qty) || 0;
        if (qty <= 0) return [];
        return [{
          key: itemKey(order, item, index),
          orderName: order.name || '',
          orderNumber: parts.number,
          customer: parts.customer,
          title: item.title || 'Untitled garment',
          variantTitle: item.variantTitle || '',
          qty
        }];
      });
    });
  }

  function groupItemsByOrder(items) {
    const groups = new Map();
    items.forEach(item => {
      if (!groups.has(item.orderName)) {
        groups.set(item.orderName, {
          orderName: item.orderName,
          orderNumber: item.orderNumber,
          customer: item.customer,
          items: []
        });
      }
      groups.get(item.orderName).items.push(item);
    });
    return Array.from(groups.values());
  }

  function scheduleUpdate() {
    if (updateFrame) cancelAnimationFrame(updateFrame);
    updateFrame = requestAnimationFrame(() => {
      updateFrame = 0;
      updateChecklistState();
    });
  }

  function isCartViewActive() {
    const section = document.getElementById('blanks-section');
    return !section || section.dataset.blanksView !== 'ordered';
  }

  function updateChecklistState() {
    if (!uiReady) return;
    const orders = getAllOrders();
    currentOrders = orders.filter(isInCartOrder);
    currentItems = buildManualItems(orders);
    pruneStoredChecks(currentItems);
    updateButton();
    if (isOverlayOpen()) renderChecklist();
  }

  function pruneStoredChecks(items) {
    const activeKeys = new Set(items.map(item => item.key));
    let changed = false;
    Object.keys(checkedItems).forEach(key => {
      if (!activeKeys.has(key)) {
        delete checkedItems[key];
        changed = true;
      }
    });
    if (changed) saveCheckedItems();
  }

  function remainingItems() {
    return currentItems.filter(item => !checkedItems[item.key]);
  }

  function completedCount() {
    return currentItems.length - remainingItems().length;
  }

  function updateButton() {
    const button = document.getElementById('manual-add-checklist-btn');
    const count = document.getElementById('manual-add-checklist-count');
    if (!button || !count) return;

    const hasInCartOrders = currentOrders.length > 0;
    const hasItems = currentItems.length > 0;
    const remaining = remainingItems().length;
    button.hidden = !isCartViewActive() || !hasInCartOrders;
    button.disabled = !hasItems;
    button.classList.toggle('is-complete', hasItems && remaining === 0);
    count.textContent = String(remaining);
    button.setAttribute('aria-label', `Open manual add checklist, ${remaining} remaining`);
  }

  function ensureButton() {
    const actions = document.querySelector('#blanks-section .section-actions');
    if (!actions || document.getElementById('manual-add-checklist-btn')) return;

    const button = document.createElement('button');
    button.id = 'manual-add-checklist-btn';
    button.className = 'fullscreen-btn manual-add-checklist-btn';
    button.type = 'button';
    button.hidden = true;

    const label = document.createElement('span');
    label.textContent = 'Manual Add';

    const count = document.createElement('span');
    count.id = 'manual-add-checklist-count';
    count.className = 'manual-add-checklist-count';
    count.textContent = '0';

    button.append(label, count);
    button.addEventListener('click', openOverlay);
    actions.insertBefore(button, actions.firstChild);
  }

  function ensureOverlay() {
    if (document.getElementById('manual-add-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'manual-add-overlay';
    overlay.className = 'manual-add-overlay hidden';
    overlay.setAttribute('role', 'presentation');

    overlay.innerHTML = `
      <div class="manual-add-dialog" role="dialog" aria-modal="true" aria-labelledby="manual-add-title">
        <header class="manual-add-header">
          <div class="manual-add-heading">
            <span class="manual-add-eyebrow">In S&amp;S Cart</span>
            <h2 id="manual-add-title">Manual Add Checklist</h2>
          </div>
          <button class="manual-add-close" type="button">Close</button>
        </header>
        <section class="manual-add-stats" aria-label="Manual add progress">
          <div class="manual-add-stat">
            <span id="manual-add-remaining" class="manual-add-stat-value">0</span>
            <span class="manual-add-stat-label">Remaining</span>
          </div>
          <div class="manual-add-stat">
            <span id="manual-add-complete" class="manual-add-stat-value">0</span>
            <span class="manual-add-stat-label">Done</span>
          </div>
          <div class="manual-add-stat">
            <span id="manual-add-orders" class="manual-add-stat-value">0</span>
            <span class="manual-add-stat-label">Orders</span>
          </div>
        </section>
        <div class="manual-add-actions">
          <button id="manual-add-copy" class="manual-add-action" type="button">Copy Remaining</button>
          <button id="manual-add-mark-all" class="manual-add-action" type="button">Mark All Done</button>
          <button id="manual-add-clear" class="manual-add-action manual-add-action-secondary" type="button">Reset Checks</button>
        </div>
        <div class="manual-add-body">
          <div id="manual-add-list" class="manual-add-list"></div>
          <div id="manual-add-empty" class="manual-add-empty" hidden>
            <strong>No manual garment adds</strong>
            <span>Everything in the current S&amp;S cart has a SKU code.</span>
          </div>
        </div>
      </div>
    `;

    overlay.addEventListener('click', event => {
      if (event.target === overlay) closeOverlay();
    });
    overlay.querySelector('.manual-add-close')?.addEventListener('click', closeOverlay);
    overlay.querySelector('#manual-add-copy')?.addEventListener('click', copyRemainingList);
    overlay.querySelector('#manual-add-mark-all')?.addEventListener('click', markAllDone);
    overlay.querySelector('#manual-add-clear')?.addEventListener('click', resetChecks);
    document.addEventListener('keyup', event => {
      if (event.key === 'Escape' && isOverlayOpen()) closeOverlay();
    });

    document.body.appendChild(overlay);
  }

  function isOverlayOpen() {
    return !document.getElementById('manual-add-overlay')?.classList.contains('hidden');
  }

  function openOverlay() {
    renderChecklist();
    const overlay = document.getElementById('manual-add-overlay');
    overlay?.classList.remove('hidden');
    document.body.classList.add('manual-add-open');
    requestAnimationFrame(() => {
      overlay?.querySelector('.manual-add-close')?.focus();
    });
  }

  function closeOverlay() {
    document.getElementById('manual-add-overlay')?.classList.add('hidden');
    document.body.classList.remove('manual-add-open');
    document.getElementById('manual-add-checklist-btn')?.focus();
  }

  function renderChecklist() {
    const list = document.getElementById('manual-add-list');
    const empty = document.getElementById('manual-add-empty');
    if (!list || !empty) return;

    const remaining = remainingItems().length;
    document.getElementById('manual-add-remaining').textContent = String(remaining);
    document.getElementById('manual-add-complete').textContent = String(completedCount());
    document.getElementById('manual-add-orders').textContent = String(currentOrders.length);

    const hasItems = currentItems.length > 0;
    empty.hidden = hasItems;
    list.hidden = !hasItems;
    list.replaceChildren();

    document.getElementById('manual-add-copy').disabled = remaining === 0;
    document.getElementById('manual-add-mark-all').disabled = !hasItems || remaining === 0;
    document.getElementById('manual-add-clear').disabled = completedCount() === 0;

    groupItemsByOrder(currentItems).forEach(group => {
      list.appendChild(renderOrderGroup(group));
    });
  }

  function renderOrderGroup(group) {
    const order = document.createElement('article');
    order.className = 'manual-add-order';

    const header = document.createElement('div');
    header.className = 'manual-add-order-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'manual-add-order-title';

    const number = document.createElement('strong');
    number.textContent = group.orderNumber;

    const customer = document.createElement('span');
    customer.textContent = group.customer || group.orderName;

    const count = document.createElement('span');
    count.className = 'manual-add-order-count';
    count.textContent = `${group.items.length} item${group.items.length === 1 ? '' : 's'}`;

    titleWrap.append(number, customer);
    header.append(titleWrap, count);
    order.appendChild(header);

    const items = document.createElement('div');
    items.className = 'manual-add-items';
    group.items.forEach(item => {
      items.appendChild(renderChecklistItem(item));
    });
    order.appendChild(items);
    return order;
  }

  function renderChecklistItem(item) {
    const label = document.createElement('label');
    label.className = 'manual-add-item';
    label.classList.toggle('is-checked', Boolean(checkedItems[item.key]));

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(checkedItems[item.key]);
    input.addEventListener('change', () => {
      checkedItems[item.key] = input.checked;
      if (!input.checked) delete checkedItems[item.key];
      saveCheckedItems();
      updateButton();
      renderChecklist();
    });

    const copy = document.createElement('span');
    copy.className = 'manual-add-item-copy';

    const title = document.createElement('strong');
    title.textContent = item.title;

    const variant = document.createElement('span');
    variant.textContent = item.variantTitle || 'No variant';

    const qty = document.createElement('span');
    qty.className = 'manual-add-item-qty';
    qty.textContent = `Qty ${item.qty}`;

    copy.append(title, variant);
    label.append(input, copy, qty);
    return label;
  }

  async function copyRemainingList() {
    const button = document.getElementById('manual-add-copy');
    const items = remainingItems();
    if (!items.length || !button) return;
    const text = items.map(item => {
      const variant = item.variantTitle ? ` - ${item.variantTitle}` : '';
      return `${item.qty} x ${item.title}${variant} (${item.orderName})`;
    }).join('\n');

    try {
      await navigator.clipboard.writeText(text);
      flashButtonText(button, 'Copied');
    } catch (error) {
      console.warn('Unable to copy manual add checklist', error);
      flashButtonText(button, 'Copy Failed');
    }
  }

  function flashButtonText(button, text) {
    const original = button.textContent;
    button.textContent = text;
    window.setTimeout(() => {
      button.textContent = original;
    }, 1200);
  }

  function markAllDone() {
    currentItems.forEach(item => {
      checkedItems[item.key] = true;
    });
    saveCheckedItems();
    updateButton();
    renderChecklist();
  }

  function resetChecks() {
    currentItems.forEach(item => {
      delete checkedItems[item.key];
    });
    saveCheckedItems();
    updateButton();
    renderChecklist();
  }

  function patchRenderBoard() {
    try {
      if (typeof renderBoard !== 'function' || renderBoard.__manualAddChecklistPatched) return;
      const originalRenderBoard = renderBoard;
      renderBoard = async function patchedRenderBoard(...args) {
        const result = await originalRenderBoard.apply(this, args);
        scheduleUpdate();
        return result;
      };
      renderBoard.__manualAddChecklistPatched = true;
    } catch (error) {
      console.warn('Unable to hook manual add checklist into board render', error);
    }
  }

  function observeBlanksSection() {
    const section = document.getElementById('blanks-section');
    if (!section) return;
    const observer = new MutationObserver(scheduleUpdate);
    observer.observe(section, {
      attributes: true,
      attributeFilter: ['data-blanks-view'],
      childList: true,
      subtree: true
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    ensureButton();
    ensureOverlay();
    uiReady = true;
    patchRenderBoard();
    observeBlanksSection();
    scheduleUpdate();
  });
})();
