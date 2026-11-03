/* Mobile job sheet: relocate live detail sections, restore the desktop tree verbatim. */
(() => {
  const media = window.matchMedia('(max-width: 900px)');
  const byId = id => document.getElementById(id);
  const enabled = () => media.matches && document.body?.dataset.orderSource === 'shopify';
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const button = (text, action) => {
    const node = el('button', text); node.type = 'button';
    node.addEventListener('click', action); return node;
  };
  let order = null, response = null, mounted = false, nodes = null, expanded = false;
  let activeKey = '', rowFrame = 0;
  const moves = new Map(), copies = new Map();

  // Anchors preserve exact sibling positions, including controls with unsaved state.
  function move(node, target, before = null) {
    if (!node || !target) return;
    if (!moves.has(node)) {
      const anchor = document.createComment('mobile detail return');
      node.before(anchor); moves.set(node, anchor);
    }
    target.insertBefore(node, before);
  }
  function copy(node, text) {
    if (!node) return;
    const previous = copies.get(node);
    if (!previous || node.textContent !== previous.applied) copies.set(node, { original: node.textContent, applied: text });
    else previous.applied = text;
    if (node.textContent !== text) node.textContent = text;
  }
  function releaseCopy(node) {
    const previous = copies.get(node);
    if (!previous) return;
    if (node.textContent === previous.applied) node.textContent = previous.original;
    copies.delete(node);
  }
  function field(label, valueClass) {
    const node = el('div', null, valueClass);
    node.append(el('span', label), el('strong'));
    return node;
  }
  function create() {
    const navigation = el('div'); navigation.id = 'detail-mobile-navigation';
    const top = el('div', null, 'mobile-detail-topbar');
    const identity = el('span'); identity.id = 'mobile-detail-order-label';
    top.append(identity);
    const nav = el('nav', null, 'mobile-detail-nav'); nav.setAttribute('aria-label', 'Order workspaces');
    const navButtons = {};
    for (const [key, label] of [['overview', 'Order'], ['production', 'Production'], ['logistics', 'Fulfillment']]) {
      const control = button(label, () => navigate(`tab-${key}`));
      control.dataset.mobileDetailTab = key;
      control.setAttribute('aria-controls', `tab-${key}`);
      navButtons[key] = control; nav.append(control);
    }
    const moreButton = button('More', () => setMore(nodes.more.hidden));
    moreButton.dataset.mobileDetailTab = 'more';
    moreButton.setAttribute('aria-expanded', 'false'); moreButton.setAttribute('aria-controls', 'mobile-detail-more');
    navButtons.more = moreButton; nav.append(moreButton);
    const more = el('div'); more.id = 'mobile-detail-more'; more.hidden = true;
    more.append(button('Customer & order', () => navigate('tab-customer')), button('Activity & exceptions', () => navigate('tab-activity')));
    navigation.append(top, nav, more);
    const brief = el('section'); brief.id = 'mobile-detail-brief'; brief.setAttribute('aria-label', 'Order brief');
    const briefIdentity = el('div', null, 'mobile-detail-identity');
    const customer = field('Customer', 'mobile-detail-customer');
    const total = field('Order total', 'mobile-detail-total');
    const payment = el('span', null, 'mobile-detail-payment'); total.append(payment);
    briefIdentity.append(customer, total);
    const delivery = el('dl', null, 'mobile-detail-delivery');
    const deliveryGroup = el('div'), fulfillmentGroup = el('div');
    const deliveryValue = el('dd'), fulfillmentValue = el('dd');
    deliveryGroup.append(el('dt', 'Delivery'), deliveryValue);
    fulfillmentGroup.append(el('dt', 'Fulfillment'), fulfillmentValue);
    delivery.append(deliveryGroup, fulfillmentGroup);
    const context = el('p', null, 'mobile-detail-context'); context.hidden = true;
    customer.append(context);
    brief.append(briefIdentity, delivery);
    const toggle = button('View all order lines', () => { expanded = !expanded; refreshRows(); });
    toggle.id = 'mobile-detail-items-toggle'; toggle.setAttribute('aria-controls', 'detail-items-wrapper');
    const unavailableItems = el('p', 'Item details not returned', 'mobile-detail-items-unavailable-copy'); unavailableItems.hidden = true;
    const charges = el('details'); charges.id = 'mobile-detail-charges';
    charges.append(el('summary', 'Charges & payment'));
    const paymentDetails = el('dl', null, 'mobile-detail-payment-details'); charges.append(paymentDetails);
    const workflow = el('details'); workflow.id = 'mobile-detail-workflow';
    workflow.append(el('summary', 'Workflow overview & target date'));
    workflow.addEventListener('click', event => {
      const action = event.target.closest('[data-overview-target]');
      if (!action || !workflow.contains(action)) return;
      event.preventDefault(); navigate(action.dataset.overviewTarget);
      const anchor = action.dataset.overviewMobileAnchor;
      if (anchor) byId(anchor)?.scrollIntoView({ block: 'start', behavior: 'auto' });
    });
    const tools = el('details'); tools.id = 'mobile-detail-preview-tools'; tools.append(el('summary', 'Preview uploads'));
    const expand = button('', () => byId('detail-mockup-main')?.click()); expand.id = 'mobile-detail-expand';
    expand.setAttribute('aria-label', 'Expand selected design preview');
    expand.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg>';
    const gallery = button('Previews', () => {
      const open = gallery.getAttribute('aria-expanded') !== 'true';
      byId('detail-mockups-track')?.classList.toggle('mobile-detail-gallery-open', open);
      gallery.setAttribute('aria-expanded', String(open));
    });
    gallery.id = 'mobile-detail-gallery-toggle'; gallery.setAttribute('aria-controls', 'detail-mockups-track'); gallery.setAttribute('aria-expanded', 'false');
    return { navigation, top, identity, navButtons, more, moreButton, brief, customer, total, payment, deliveryValue, fulfillmentValue, context, toggle, unavailableItems, charges, paymentDetails, workflow, tools, expand, gallery };
  }
  function setMore(open) {
    if (!nodes) return;
    nodes.more.hidden = !open; nodes.moreButton.setAttribute('aria-expanded', String(open));
  }
  function closeGallery() {
    byId('detail-mockups-track')?.classList.remove('mobile-detail-gallery-open');
    nodes?.gallery.setAttribute('aria-expanded', 'false');
  }
  function previewUnavailable() {
    const control = byId('detail-mockup-main');
    return !control || control.disabled || control.getAttribute('aria-disabled') === 'true';
  }
  function navigate(panelId) {
    setMore(false);
    byId(`detail-tab-${panelId.replace('tab-', '')}`)?.click();
    byId('detail-content')?.scrollTo({ top: 0, behavior: 'auto' });
  }
  function onTabChange(panelId) {
    if (!mounted) return;
    const key = panelId.replace('tab-', '');
    for (const [name, control] of Object.entries(nodes.navButtons)) {
      const active = name === key || name === 'more' && ['customer', 'activity'].includes(key);
      control.classList.toggle('active', active);
      if (active) control.setAttribute('aria-current', 'page'); else control.removeAttribute('aria-current');
    }
  }
  function mount() {
    if (mounted || !byId('tab-overview') || !byId('tab-production')) return;
    nodes ||= create(); mounted = true;
    const overview = byId('tab-overview'), production = byId('tab-production');
    // Retain every existing overview capability in the Production workspace.
    for (const child of [...overview.children]) move(child, nodes.workflow);
    production.append(nodes.workflow, nodes.tools);
    move(byId('detail-production-card'), production, production.firstChild);
    move(byId('detail-notes-wrapper'), production, nodes.workflow);
    for (const id of ['shelf-allocation']) move(byId(id), production, nodes.workflow);
    byId('detail-header').append(nodes.navigation);
    move(byId('detail-close'), nodes.top, nodes.identity);
    move(byId('detail-order-actions'), nodes.more);
    overview.append(nodes.brief);
    const proof = byId('detail-mockups-strip'); move(proof, overview);
    for (const node of [proof?.querySelector('.manual-mockup-actions'), byId('manual-mockup-paste-area'), byId('manual-mockup-status')]) move(node, nodes.tools);
    proof?.querySelector('.detail-section-header')?.append(nodes.gallery, nodes.expand);
    move(byId('detail-mockups-track'), proof, byId('detail-mockups-browser'));
    move(byId('detail-items-section'), overview);
    byId('detail-items-section')?.querySelector('.detail-items-header-row')?.after(nodes.unavailableItems);
    byId('detail-items-wrapper')?.after(nodes.toggle, nodes.charges);
    move(byId('detail-summary'), nodes.charges, nodes.paymentDetails);
    for (const id of ['detail-item-discounts', 'detail-tax-details']) move(byId(id), nodes.charges);
    copy(byId('detail-mockups-title'), 'Design preview');
    copy(byId('detail-items-section')?.querySelector('h3'), 'Order lines');
    byId('detail-overlay').classList.add('mobile-job-sheet');
    relocateCost();
  }
  function relocateCost() {
    if (mounted) move(byId('detail-garment-cost'), byId('tab-production'), nodes.workflow);
  }
  function unmount() {
    if (!mounted) return;
    // Restore children before removing their temporary containers.
    for (const [node, anchor] of [...moves].reverse()) {
      if (anchor.parentNode) {
        // A source/permission controller may intentionally remove a live section.
        if (node.isConnected) anchor.replaceWith(node); else anchor.remove();
      }
    }
    moves.clear();
    for (const node of [...copies.keys()]) releaseCopy(node);
    for (const row of byId('detail-items')?.querySelectorAll('.mobile-detail-line-hidden') || []) row.classList.remove('mobile-detail-line-hidden');
    closeGallery();
    byId('detail-items-section')?.classList.remove('mobile-detail-items-unavailable');
    for (const node of [nodes.navigation, nodes.brief, nodes.toggle, nodes.unavailableItems, nodes.charges, nodes.workflow, nodes.tools, nodes.expand, nodes.gallery]) node.remove();
    byId('detail-overlay')?.classList.remove('mobile-job-sheet');
    mounted = false; setMore(false);
  }
  function refreshRows() {
    if (!mounted) return;
    const rows = [...(byId('detail-items')?.querySelector('tbody')?.rows || [])];
    const count = rows.filter(row => row.cells.length >= 4).length;
    const incomplete = window.MobileDetailSummary?.describe(order, response || undefined).freshness.partial;
    const unavailable = count === 0 && Boolean(incomplete);
    byId('detail-items-section')?.classList.toggle('mobile-detail-items-unavailable', unavailable);
    nodes.unavailableItems.hidden = !unavailable;
    let index = -1;
    for (const row of rows) {
      if (row.cells.length >= 4) index++;
      row.classList.toggle('mobile-detail-line-hidden', !expanded && index >= 2);
    }
    nodes.toggle.hidden = count <= 2;
    nodes.toggle.textContent = expanded ? 'Show first 2 order lines' : `View all ${count} order lines`;
    nodes.toggle.setAttribute('aria-expanded', String(expanded));
    relocateCost();
  }
  function refreshGallery() {
    if (!mounted) return;
    const text = byId('detail-mockup-count')?.textContent || '';
    const match = text.match(/(\d+)\s+of\s+(\d+)/i);
    nodes.gallery.textContent = match ? `${match[1]} of ${match[2]}` : text.replace(/\bmockups?\b/gi, 'previews') || 'Previews';
    nodes.gallery.disabled = !match || Number(match[2]) < 2;
    nodes.gallery.setAttribute('aria-label', match ? `Choose design preview, ${match[1]} of ${match[2]}` : 'No design previews available');
  }
  function formatMoney(value) {
    if (!value) return 'Not returned';
    if (!value.currencyCode) return `${value.amount.toFixed(2)} (currency unavailable)`;
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: value.currencyCode }).format(value.amount); }
    catch { return `${value.amount.toFixed(2)} ${value.currencyCode}`; }
  }
  function refreshCaption() {
    if (!mounted) return;
    for (const node of byId('detail-mockup-context')?.querySelectorAll('.detail-mockup-context-product-name') || []) {
      const color = node.dataset.linkedColor;
      const original = copies.get(node)?.original || node.textContent;
      if (color) copy(node, `${original} · ${color}`);
    }
  }
  function refreshSummary() {
    if (!mounted || !order || !window.MobileDetailSummary) return;
    const facts = window.MobileDetailSummary.describe(order, response || undefined);
    // The existing header owns operational customer-name fallback (including Etsy).
    nodes.customer.querySelector('strong').textContent = byId('detail-header-customer')?.textContent?.trim() || facts.customerLabel;
    nodes.total.querySelector('strong').textContent = formatMoney(facts.total);
    nodes.payment.textContent = facts.payment.label;
    nodes.deliveryValue.textContent = facts.delivery.label;
    nodes.fulfillmentValue.textContent = facts.fulfillment.label;
    const label = facts.orderLabel.replace(/^Order\s+/i, '').split(' - ')[0];
    nodes.identity.textContent = /^#/.test(label) ? `Order ${label}` : label;
    const context = ['badge-source', 'badge-test-order', 'badge-history-readonly'].map(id => byId(id))
      .filter(node => node && !node.hidden && !node.classList.contains('hidden'))
      .map(node => node.textContent.trim()).filter(text => text && text !== 'PrintMO');
    nodes.context.textContent = context.join(' · '); nodes.context.hidden = !context.length;
    nodes.paymentDetails.replaceChildren();
    const payment = el('div'); payment.append(el('dt', 'Payment'), el('dd', facts.payment.label)); nodes.paymentDetails.append(payment);
    if (facts.payment.outstanding) {
      const balance = el('div'); balance.append(el('dt', 'Balance due'), el('dd', formatMoney(facts.payment.outstanding))); nodes.paymentDetails.append(balance);
    }
    const provider = response?.source?.provider || order._provider;
    if (provider === 'shopify') {
      copy(byId('detail-discount-row')?.firstElementChild, 'Discounts included');
    }
    for (const [id, amount] of Object.entries({
      'detail-subtotal': facts.charges.subtotal, 'detail-shipping': facts.charges.shipping,
      'detail-tax': facts.charges.tax, 'detail-discount': facts.charges.discounts, 'detail-total': facts.total
    })) {
      const cell = byId(id);
      if (!amount) copy(cell, 'Not returned'); else releaseCopy(cell);
    }
    nodes.expand.disabled = previewUnavailable();
    refreshRows(); refreshGallery(); refreshCaption();
  }
  function sync(nextOrder, nextResponse) {
    if (nextOrder && nextOrder !== order) response = null;
    if (nextOrder) order = nextOrder;
    if (nextResponse) response = nextResponse;
    const key = order?._gid || order?.name || '';
    if (key !== activeKey) { activeKey = key; expanded = false; if (nodes) { nodes.charges.open = false; closeGallery(); } }
    if (!enabled() || !order) { unmount(); return; }
    mount(); refreshSummary();
    const active = byId('detail-tabs-header')?.querySelector('.active')?.dataset.tab || 'tab-overview';
    if (active === 'tab-items') byId('detail-tab-overview')?.click(); else onTabChange(active);
  }
  function scheduleRows() {
    if (!mounted || rowFrame) return;
    rowFrame = requestAnimationFrame(() => { rowFrame = 0; refreshRows(); });
  }
  window.MobileOrderDetail = {
    sync, onTabChange, refreshCaption,
    panelFor: panelId => enabled() && mounted && panelId === 'tab-items' ? 'tab-overview' : panelId,
    tabForTarget: (targetId, fallback) => mounted ? byId(targetId)?.closest('.detail-tab-panel')?.getAttribute('aria-labelledby') || fallback : fallback
  };
  function setup() {
    const overlay = byId('detail-overlay');
    if (!overlay) return;
    const rows = byId('detail-items')?.querySelector('tbody');
    if (rows) new MutationObserver(scheduleRows).observe(rows, { childList: true });
    const feature = byId('detail-mockup-main');
    if (feature) new MutationObserver(() => {
      if (mounted) nodes.expand.disabled = previewUnavailable();
    }).observe(feature, { attributes: true, attributeFilter: ['disabled', 'aria-disabled'] });
    const counter = byId('detail-mockup-count');
    if (counter) new MutationObserver(refreshGallery).observe(counter, { childList: true, characterData: true, subtree: true });
    // The existing gallery consumes the event at its own capture handler.
    document.addEventListener('click', event => {
      if (mounted && event.target.closest('#detail-mockups-track .mockup-thumb')) {
        closeGallery(); nodes.gallery.focus({ preventScroll: true });
      }
    }, true);
    document.addEventListener('printmo:detail-items-rendered', scheduleRows);
    document.addEventListener('printmo:detail-closed', () => { unmount(); order = response = null; activeKey = ''; });
    document.addEventListener('keydown', event => {
      if (mounted && event.key === 'Escape' && !nodes.more.hidden) { event.preventDefault(); setMore(false); nodes.moreButton.focus(); }
    });
    document.addEventListener('click', event => {
      if (mounted && !nodes.more.hidden && !nodes.navigation.contains(event.target)) setMore(false);
    });
    media.addEventListener('change', () => {
      if (!enabled()) unmount();
      else if (order && !overlay.classList.contains('hidden')) sync(order);
    });
    new MutationObserver(() => { if (!enabled()) unmount(); }).observe(document.body, { attributes: true, attributeFilter: ['data-order-source'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();
})();
