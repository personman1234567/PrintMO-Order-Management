/* Garment COGs extends the Precision Workbench: compact totals where purchasing
 * happens, an explicit shelf split, and a readable per-garment breakdown.
 * Shopify catalog estimates hydrate after the operational board. */
(() => {
  const estimates = new Map();
  const requests = new Map();
  let currentDetail = null;
  let refreshTimer;
  const enabled = () => document.body?.dataset.orderSource === 'shopify';
  const idFor = order => order?._gid || order?._orderKey;
  const orders = () => { try { return Array.isArray(allOrders) ? allOrders : []; } catch (_) { return []; } };
  const cartOrders = () => orders().filter(order => order._candidate && order.status === 'blanks' && !order.blanksOrdered
    && (typeof orderIsVisibleOnOperationalBoard !== 'function' || orderIsVisibleOnOperationalBoard(order)));
  const fingerprint = order => JSON.stringify((order.items || []).map(item => [item.id, item.sku, item.supplierSku, item.qty]));
  const money = minor => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(minor / 100);
  const element = (tag, copy, className) => {
    const node = document.createElement(tag);
    if (copy != null) node.textContent = copy;
    if (className) node.className = className;
    return node;
  };
  const sourceCopy = 'Shopify catalog costs. Excludes prints, shipping, tax, and manual items.';
  function cached(order) {
    const entry = estimates.get(idFor(order));
    return entry?.fingerprint === fingerprint(order) ? entry.value : null;
  }
  function snapshot(order) {
    return window.blanksBatchFoundation?.costSnapshotForOrder?.(order) || null;
  }
  async function load(selected, force = false) {
    if (!enabled() || !window.api?.getGarmentCosts) return;
    const needed = selected.filter(order => {
      const entry = estimates.get(idFor(order));
      return idFor(order) && (force || !entry || entry.fingerprint !== fingerprint(order) || entry.expiresAt < Date.now());
    });
    const waiting = [];
    for (let start = 0; start < needed.length; start += 50) {
      const batch = needed.slice(start, start + 50).filter(order => !requests.has(idFor(order)));
      needed.slice(start, start + 50).forEach(order => { if (requests.has(idFor(order))) waiting.push(requests.get(idFor(order))); });
      if (!batch.length) continue;
      const fingerprints = new Map(batch.map(order => [idFor(order), fingerprint(order)]));
      const task = (async () => {
        try {
          const response = await window.api.getGarmentCosts(batch.map(idFor));
          const byId = new Map((response.estimates || []).map(value => [value.orderId, value]));
          batch.forEach(order => estimates.set(idFor(order), { value: byId.get(idFor(order)) || { status: 'unavailable' },
            fingerprint: fingerprints.get(idFor(order)), expiresAt: Date.now() + 300000 }));
        } catch (_) {
          batch.forEach(order => estimates.set(idFor(order), { value: { status: 'unavailable' },
            fingerprint: fingerprints.get(idFor(order)), expiresAt: Date.now() + 300000 }));
        } finally {
          batch.forEach(order => requests.delete(idFor(order)));
          renderBoard();
          renderDetail();
          // If canonical lines changed during a lookup, do not leave the new
          // quantities waiting until the next scheduled refresh.
          const changed = batch.some(order => fingerprints.get(idFor(order)) !== fingerprint(order));
          if (changed) queueMicrotask(() => {
            refreshBoard();
            if (currentDetail && !snapshot(currentDetail)) load([currentDetail]);
          });
        }
      })();
      batch.forEach(order => requests.set(idFor(order), task));
      waiting.push(task);
    }
    await Promise.all(waiting);
  }
  function addExclusions(parent, exclusions, unavailable = [], pending = 0) {
    if (!exclusions.length && !unavailable.length && !pending) return;
    const old = parent.querySelector('details');
    const details = element('details', null, 'garment-cost-exclusions');
    details.open = old?.open || false;
    const count = exclusions.reduce((sum, line) => sum + line.quantity, 0);
    details.append(element('summary', `${count ? `${count} garments excluded` : 'Estimate incomplete'}${pending ? ` · ${pending} orders loading` : ''}${unavailable.length ? ` · ${unavailable.length} orders unavailable` : ''}`));
    const list = element('ul');
    exclusions.forEach(line => list.append(element('li', `${line.orderName ? `${line.orderName} · ` : ''}${line.title}${line.variantTitle ? ` · ${line.variantTitle}` : ''} · ${line.quantity} × · ${line.exclusionReason}`)));
    unavailable.forEach(order => list.append(element('li', `${order.name} · Cost unavailable. Retry the estimate.`)));
    if (list.children.length) details.append(list);
    parent.append(details);
  }
  function retryButton(action) {
    const button = element('button', 'Retry estimate', 'garment-cost-retry');
    button.type = 'button';
    button.onclick = async () => { button.disabled = true; await action(); };
    return button;
  }
  function renderBoard() {
    if (!enabled()) return;
    const selected = cartOrders();
    const section = document.getElementById('blanks-section');
    const cards = document.getElementById('col-blanks');
    if (!section || !cards) return;
    let summary = document.getElementById('garment-cart-cost');
    if (!summary) {
      summary = element('section', null, 'garment-cart-cost');
      summary.id = 'garment-cart-cost';
      summary.setAttribute('aria-label', 'Estimated S&S garment cost');
      cards.before(summary);
    }
    summary.hidden = section.dataset.blanksView === 'ordered';
    summary.setAttribute('aria-busy', String(selected.some(order => !cached(order))));
    const values = selected.map(cached);
    const pending = values.filter(value => !value).length;
    const unavailable = selected.filter((_, index) => values[index]?.status === 'unavailable');
    const known = values.filter(value => value && value.supplierMinor != null);
    const total = known.reduce((sum, value) => sum + value.supplierMinor, 0);
    const exclusions = values.flatMap(value => (value?.exclusions || []).filter(line => line.supplierQuantity > 0).map(line => ({ ...line, quantity: line.supplierQuantity, orderName: value.orderName })));
    const incomplete = pending || unavailable.length || exclusions.length;
    const header = element('div', null, 'garment-cost-heading');
    header.append(element('h4', 'Estimated S&S garment cost'), element('strong', known.length || !selected.length ? `${money(total)}${incomplete ? ' known subtotal' : ''}` : pending ? 'Loading costs…' : 'Cost unavailable'));
    const open = summary.querySelector('details')?.open;
    summary.replaceChildren(header, element('p', sourceCopy, 'garment-cost-source'));
    addExclusions(summary, exclusions, unavailable, pending);
    if (open && summary.querySelector('details')) summary.querySelector('details').open = true;
    if (!selected.length) summary.append(element('p', 'No orders in S&S Cart.', 'garment-cost-source'));
    if (unavailable.length || values.some(value => value?.lookupFailed)) summary.append(retryButton(() => load(selected, true)));
    const byName = new Map(selected.map(order => [order.name, order]));
    cards.querySelectorAll('.card[data-order-id]').forEach(card => {
      let row = card.querySelector('.garment-card-cost');
      const order = byName.get(card.dataset.orderId);
      if (!order) { row?.remove(); return; }
      if (!row) { row = element('div', null, 'garment-card-cost'); (card.querySelector('.card-footer') || card).append(row); }
      const value = cached(order);
      row.replaceChildren(element('span', 'S&S estimate'), element('span', value?.supplierMinor != null
        ? `${money(value.supplierMinor)}${(value.exclusions || []).some(line => line.supplierQuantity > 0) || value.lookupFailed ? ' · Incomplete' : ''}`
        : value ? 'Cost unavailable' : 'Loading…'));
    });
  }
  function renderDetail() {
    if (!enabled() || !currentDetail) return;
    const order = currentDetail;
    const section = document.getElementById('detail-items-section');
    if (!section) return;
    let panel = document.getElementById('detail-garment-cost');
    if (!panel) {
      panel = element('details', null, 'detail-garment-cost'); panel.id = 'detail-garment-cost';
      panel.setAttribute('aria-label', 'Garment cost of goods');
      section.append(panel);
    }
    const sameOrder = panel.dataset.orderId === idFor(order);
    if (!sameOrder) panel.open = false;
    panel.dataset.orderId = idFor(order);
    const saved = snapshot(order);
    const value = saved || cached(order);
    const open = sameOrder && panel.querySelector('.garment-cost-lines')?.open;
    const exclusionsOpen = sameOrder && panel.querySelector('.garment-cost-exclusions')?.open;
    const label = saved ? 'Saved garment cost' : 'Garment estimate';
    const amount = !value ? 'Calculating…' : value.garmentMinor == null ? 'Unavailable'
      : `${money(value.garmentMinor)}${value.status !== 'complete' ? ' · Partial' : ''}`;
    const heading = element('summary', null, 'garment-cost-detail-heading');
    heading.append(element('span', `${label} details`), element('strong', amount));
    const content = element('div', null, 'garment-cost-detail-body');
    panel.replaceChildren(heading, content);
    const header = document.getElementById('detail-header-garment-cost');
    if (header) {
      header.hidden = false;
      header.setAttribute('aria-busy', String(!value));
      document.getElementById('detail-header-garment-label').textContent = label;
      document.getElementById('detail-header-garment-value').textContent = amount;
      header.title = saved ? 'Garment cost saved when ordered; open for source and quantity changes.' : sourceCopy;
      header.onclick = () => {
        document.getElementById('detail-tab-items')?.click();
        if (document.getElementById('tab-items')?.hidden) return;
        panel.open = true;
        panel.scrollIntoView({ block: 'nearest' });
        panel.querySelector('summary')?.focus({ preventScroll: true });
      };
    }
    if (!value) { content.append(element('p', 'Loading catalog costs…', 'garment-cost-source')); return; }
    if (value.status === 'unavailable' && value.garmentMinor == null) {
      content.append(element('p', 'Cost unavailable.', 'garment-cost-source'));
      if (!saved) content.append(retryButton(() => load([order], true)));
      return;
    }
    const totals = element('dl', null, 'garment-cost-totals');
    [['Garment cost', value.garmentMinor], ['From shelf', value.shelfMinor], ['To buy from S&S', value.supplierMinor]].forEach(([label, minor]) => {
      const group = element('div'); group.append(element('dt', label), element('dd', minor == null ? 'Unavailable' : money(minor))); totals.append(group);
    });
    content.append(totals, element('p', `${saved ? `Saved when ordered · ${new Date(value.capturedAt || value.lookupAt).toLocaleDateString()}` : 'Current catalog estimate'}${value.status !== 'complete' ? ' · Incomplete; totals include known costs only.' : ''}`, 'garment-cost-source'), element('p', sourceCopy, 'garment-cost-source'));
    addExclusions(content, value.exclusions || []);
    if (exclusionsOpen && panel.querySelector('.garment-cost-exclusions')) panel.querySelector('.garment-cost-exclusions').open = true;
    const breakdown = element('details', null, 'garment-cost-lines'); breakdown.open = open || false;
    breakdown.append(element('summary', 'Garment cost breakdown'));
    const list = element('ul');
    (value.lines || []).forEach(line => {
      const row = element('li');
      row.append(element('span', `${line.title}${line.variantTitle ? ` · ${line.variantTitle}` : ''}`, 'garment-cost-line-name'));
      row.append(element('span', line.unitCostMinor == null ? `${line.quantity} × · ${line.exclusionReason || 'Cost unavailable'}` : `${money(line.unitCostMinor)} × ${line.quantity} = ${money(line.garmentMinor)}`, 'garment-cost-line-value'));
      if (line.shelfQuantity) row.append(element('span', `${line.shelfQuantity} from shelf · ${line.supplierQuantity} for S&S`, 'garment-cost-source'));
      list.append(row);
    });
    breakdown.append(list); content.append(breakdown);
    if (saved) {
      const captured = new Map((saved.lines || []).map(line => [line.lineId, line.quantity]));
      const changed = (order.items || []).filter(item => !(typeof PRINT_TITLES !== 'undefined' && PRINT_TITLES.has(item.title)) && Number(item.qty) > 0 && captured.get(item.id) !== Number(item.qty));
      const currentIds = new Set((order.items || []).map(item => item.id));
      if (changed.length || (saved.lines || []).some(line => !currentIds.has(line.lineId))) {
        heading.querySelector('strong').textContent = `${amount} · Items changed`;
        if (header) document.getElementById('detail-header-garment-value').textContent = `${amount} · Items changed`;
        content.append(element('p', 'Items changed after this estimate was saved. The saved total uses the quantities ordered at capture.', 'garment-cost-source'));
        const changes = element('ul');
        changed.forEach(item => changes.append(element('li', `${item.title} · ${item.qty} × · ${captured.has(item.id) ? 'Quantity changed since capture' : 'Outside saved estimate'}`)));
        content.append(changes);
      }
    } else if (value.lookupFailed) content.append(retryButton(() => load([order], true)));
  }
  function refreshBoard(force = false) {
    if (!enabled()) return;
    renderBoard();
    load(cartOrders(), force);
  }
  function openDetail(order) {
    currentDetail = order?._candidate ? order : null;
    if (!currentDetail || !enabled()) {
      document.getElementById('detail-garment-cost')?.remove();
      const header = document.getElementById('detail-header-garment-cost');
      if (header) { header.hidden = true; header.onclick = null; }
      return;
    }
    renderDetail();
    if (!snapshot(order)) load([order]);
  }
  window.garmentCosts = { refreshBoard, renderBoard, renderDetail, openDetail };
  document.addEventListener('printmo:detail-items-rendered', () => {
    try { if (detailOrder) openDetail(detailOrder); } catch (_) { renderDetail(); }
  });
  document.addEventListener('printmo:shelf-changed', event => {
    estimates.delete(event.detail?.orderId);
    if (currentDetail && idFor(currentDetail) === event.detail?.orderId) load([currentDetail], true);
    refreshBoard();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshBoard(); });
  document.addEventListener('DOMContentLoaded', () => { refreshBoard(); refreshTimer = window.setInterval(() => {
    if (!document.hidden) { refreshBoard(); if (currentDetail && !snapshot(currentDetail)) load([currentDetail]); }
  }, 300000); });
  window.addEventListener('pagehide', () => window.clearInterval(refreshTimer));
})();
