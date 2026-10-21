/* Local In Cart presentation. Existing cards remain mounted and unchanged. */
(() => {
  const model = window.CartGarmentModel;
  if (!model) return;
  const storageKey = 'printmo.cartGarments.v1';
  const shelfCache = new Map(), pending = new Map(), expanded = new Set();
  let layout = 'cards', grouping = 'garment', frame = 0, signature = '', loadRun = null;
  let toolbar, content, status, groupSelect, rowsHost, retry, section;
  const enabled = () => document.body.dataset.orderSource === 'shopify';
  const orders = () => window.getOrderManagerBoardSnapshot?.() || [];
  const selected = () => orders().filter(order => order._candidate && order.status === 'blanks' && !Number(order.blanksOrdered)
    && (typeof orderIsVisibleOnOperationalBoard !== 'function' || orderIsVisibleOnOperationalBoard(order)));
  const el = (tag, copy, className) => { const node = document.createElement(tag); if (copy != null) node.textContent = copy; if (className) node.className = className; return node; };
  function save() { try { localStorage.setItem(storageKey, JSON.stringify({ layout, grouping })); } catch (_) { /* Optional device preference. */ } }
  function cached(order) { const entry = shelfCache.get(model.orderKey(order)); return entry?.fingerprint === model.fingerprint(order) && entry.expiresAt > Date.now() ? entry.value : null; }
  function active() { return enabled() && section?.dataset.blanksView !== 'ordered'; }
  function schedule() { if (!frame) frame = requestAnimationFrame(() => { frame = 0; render(); }); }
  async function hydrate(force = false) {
    if (!active() || layout !== 'garments' || document.hidden || !section.getClientRects().length) return;
    if (loadRun) return loadRun;
    const needed = selected().filter(order => (order._provider || 'shopify') === 'shopify'
      && (force || !cached(order)) && !pending.has(model.orderKey(order)));
    if (!needed.length) return;
    const queue = needed.slice();
    loadRun = Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) {
        const order = queue.shift(), key = model.orderKey(order), fingerprint = model.fingerprint(order);
        pending.set(key, true);
        let value;
        try { value = await window.api.getShelfOrder(order._gid); }
        catch (_) { value = { status: 'unavailable' }; }
        shelfCache.set(key, { fingerprint, value, expiresAt: Date.now() + 60000 }); pending.delete(key); schedule();
      }
    })).finally(() => { loadRun = null; schedule(); });
    return loadRun;
  }
  function contribution(line) {
    const row = el('li');
    row.append(el('strong', line.source.number), el('span', line.source.customer),
      el('span', line.expected === null ? `${line.quantity} needed · S&S quantity unresolved` : `${line.expected} for S&S${line.shelf ? ` · ${line.shelf} from shelf` : ''}`, 'cart-contribution-quantity'));
    if (line.reason) row.append(el('span', line.reason, 'cart-line-warning'));
    return row;
  }
  function makeRow(row, scope) {
    const tr = el('tr'), identity = el('th'); identity.scope = 'row';
    identity.append(el('strong', row.title, 'cart-garment-name'), el('span', row.color, 'cart-garment-color'));
    const metadata = el('div', null, 'cart-garment-meta');
    if (row.sku) metadata.append(el('span', `SKU ${row.sku}`, 'cart-garment-sku'));
    if (row.labels.size > 1) identity.append(el('span', 'Item names differ · review breakdown', 'cart-line-warning'));
    const disclosure = el('details', null, 'cart-contributions'), key = `${scope}:${row.key}`;
    disclosure.open = expanded.has(key);
    const summary = el('summary', scope === 'garment' ? `${new Set(row.sources.map(line => line.source.key)).size} ${new Set(row.sources.map(line => line.source.key)).size === 1 ? 'order' : 'orders'}` : 'Item breakdown');
    summary.dataset.cartFocus = key;
    const list = el('ul'); row.sources.forEach(line => list.append(contribution(line)));
    if (row.labels.size > 1) row.sources.forEach(line => list.append(el('li', `${line.title} · ${line.raw || `${line.color} · ${line.size}`}`)));
    disclosure.append(summary, list);
    disclosure.addEventListener('toggle', () => { if (disclosure.open) expanded.add(key); else expanded.delete(key); });
    metadata.append(disclosure); identity.append(metadata);
    if (row.reasons.size) identity.append(el('span', [...row.reasons].join(' · '), 'cart-line-warning'));
    const size = el('td', row.size, 'cart-garment-size');
    const quantity = el('td', null, 'cart-garment-quantity');
    quantity.append(el('strong', row.expected === null ? '—' : String(row.expected)));
    if (row.expected === null) quantity.append(el('span', `${row.quantity} needed`));
    if (row.shelf) quantity.append(el('span', `${row.shelf} shelf`));
    tr.append(identity, size, quantity); return tr;
  }
  function table(rows, scope) {
    const node = el('table', null, 'cart-garment-table'); node.setAttribute('aria-label', scope === 'garment' ? 'Expected supplier garments across the cart' : 'Expected garments for this order');
    const head = el('thead'), headings = el('tr');
    ['Garment / color', 'Size', 'S&S qty'].forEach(label => { const th = el('th', label); th.scope = 'col'; headings.append(th); });
    head.append(headings); const body = el('tbody'); rows.forEach(row => body.append(makeRow(row, scope))); node.append(head, body); return node;
  }
  function render() {
    if (!toolbar) return;
    const visible = active(); toolbar.hidden = !visible;
    const garments = visible && layout === 'garments';
    section.dataset.cartLayout = garments ? 'garments' : 'cards';
    content.hidden = !garments;
    toolbar.querySelectorAll('[data-cart-layout]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.cartLayout === layout)));
    groupSelect.parentElement.hidden = !garments;
    if (!garments) return;
    const current = model.build(selected(), { isPrint: item => typeof isPrintItem === 'function' && isPrintItem(item), shelfFor: cached });
    const loading = selected().some(order => (order._provider || 'shopify') === 'shopify' && !cached(order));
    status.textContent = `${current.expected} ${current.unresolved ? 'known ' : ''}for S&S · ${current.orderCount} ${current.orderCount === 1 ? 'order' : 'orders'}${current.shelf ? ` · ${current.shelf} from shelf` : ''}${current.unresolved ? ` · ${current.unresolved} unresolved` : ''}`;
    content.setAttribute('aria-busy', String(loading));
    retry.hidden = !current.issues.some(line => line.reason === 'Shelf allocation unavailable');
    const next = JSON.stringify([grouping, selected().map(order => [model.orderKey(order), model.fingerprint(order), cached(order)])]);
    if (next !== signature) {
      const focused = content.contains(document.activeElement) ? document.activeElement?.dataset.cartFocus : null;
      signature = next; const scroll = content.scrollTop;
      const fragment = document.createDocumentFragment();
      if (!current.rows.length) fragment.append(el('p', current.orderCount ? 'No garment requirements in these orders.' : 'No orders in cart. Garments appear here as orders enter In Cart.', 'cart-garment-empty'));
      else if (grouping === 'garment') fragment.append(table(current.rows, 'garment'));
      else current.groups.forEach(group => {
        const block = el('section', null, 'cart-order-group'), heading = el('h3');
        heading.append(el('strong', group.number), el('span', group.customer));
        block.append(heading, table(group.rows, group.key)); fragment.append(block);
      });
      rowsHost.replaceChildren(fragment); content.scrollTop = scroll;
      if (focused) [...content.querySelectorAll('[data-cart-focus]')].find(node => node.dataset.cartFocus === focused)?.focus({ preventScroll: true });
    }
    hydrate();
  }
  function init() {
    section = document.getElementById('blanks-section'); const cards = document.getElementById('col-blanks');
    if (!section || !cards) return;
    try { const saved = JSON.parse(localStorage.getItem(storageKey) || '{}'); layout = saved.layout === 'garments' ? 'garments' : 'cards'; grouping = saved.grouping === 'order' ? 'order' : 'garment'; } catch (_) { /* Defaults remain usable. */ }
    toolbar = el('div', null, 'cart-view-toolbar'); toolbar.hidden = true;
    const toggle = el('div', null, 'cart-view-switch'); toggle.setAttribute('role', 'group'); toggle.setAttribute('aria-label', 'In Cart view');
    ['cards', 'garments'].forEach(value => {
      const button = el('button', value === 'cards' ? 'Cards' : 'Garments'); button.type = 'button'; button.dataset.cartLayout = value;
      button.setAttribute('aria-controls', value === 'cards' ? 'col-blanks' : 'cart-garment-content');
      button.onclick = () => { layout = value; save(); render(); }; toggle.append(button);
    });
    const label = el('label', 'Group by', 'cart-group-label'); groupSelect = el('select'); groupSelect.setAttribute('aria-label', 'Group cart garments by');
    [['garment', 'Garment'], ['order', 'Order']].forEach(([value, copy]) => { const option = el('option', copy); option.value = value; groupSelect.append(option); });
    groupSelect.value = grouping; groupSelect.onchange = () => { grouping = groupSelect.value; content.scrollTop = 0; save(); render(); };
    label.append(groupSelect); toolbar.append(toggle, label);
    content = el('div', null, 'cart-garment-content'); content.id = 'cart-garment-content'; content.hidden = true;
    content.tabIndex = 0; content.setAttribute('role', 'region'); content.setAttribute('aria-label', 'Expected cart contents');
    const heading = el('div', null, 'cart-garment-heading');
    heading.append(el('h3', 'Expected cart contents'), el('p', 'Order requirements · compare with S&S', 'cart-garment-caption'));
    status = el('p', '', 'cart-garment-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    retry = el('button', 'Retry shelf allocations', 'cart-garment-retry'); retry.type = 'button'; retry.hidden = true;
    retry.onclick = async () => { retry.disabled = true; await hydrate(true); retry.disabled = false; };
    rowsHost = el('div'); content.append(heading, status, retry, rowsHost); cards.before(toolbar); cards.after(content);
    new MutationObserver(schedule).observe(section, { attributes: true, attributeFilter: ['data-blanks-view'] });
    new MutationObserver(schedule).observe(cards, { childList: true });
    new MutationObserver(schedule).observe(document.body, { attributes: true, attributeFilter: ['data-order-source', 'data-active-view', 'data-order-layout', 'data-active-tab'] });
    document.addEventListener('printmo:board-updated', schedule);
    document.addEventListener('printmo:shelf-changed', event => { for (const [key] of shelfCache) if (key === `shopify:${event.detail?.orderId}`) shelfCache.delete(key); schedule(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { shelfCache.clear(); schedule(); } });
    window.cartGarmentView = { refresh: schedule };
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
