// Extend the existing pipeline workbench; drafts are preparation, never production stages.
(() => {
  const state = { records: [], cursor: null, query: '', filter: 'active', loaded: false,
    loading: false, generation: 0, detail: null, editing: null, opener: null, busy: false };
  const uploads = new WeakMap();
  const placements = [['front', 'Front'], ['back', 'Back'], ['left-chest', 'Left chest'],
    ['right-chest', 'Right chest'], ['left-sleeve', 'Left sleeve'], ['right-sleeve', 'Right sleeve'], ['other', 'Other']];
  const $ = id => document.getElementById(id);
  const text = (tag, value, className = '') => {
    const el = document.createElement(tag); el.textContent = value; el.className = className; return el;
  };
  function button(label, action, className = '') {
    const el = text('button', label, className); el.type = 'button'; el.addEventListener('click', action); return el;
  }
  function active() { return document.body.dataset.pipelineView === 'drafts' && document.body.dataset.orderSource === 'shopify'; }
  function message(value, error = false) {
    const el = $('draft-orders-status'); el.textContent = value; el.classList.toggle('draft-error', error);
    el.setAttribute('role', error ? 'alert' : 'status');
  }
  const countLabel = (count, label) => `${count} ${label}${count === 1 ? '' : 's'}`;
  const placementLabel = value => placements.find(([key]) => key === value)?.[1] || 'Other';
  function money(record) {
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: record.currencyCode || 'USD' }).format(Number(record.total)); }
    catch { return `${record.total} ${record.currencyCode || ''}`; }
  }
  function status(record) { return record.orderId ? `Converted to ${record.orderName || 'order'}` : record.status === 'INVOICE_SENT' ? 'Invoice sent' : 'Saved draft'; }
  function shopifyLink(record) {
    const anchor = text('a', 'Open in Shopify', 'draft-shopify-link');
    const shop = new URLSearchParams(window.location.search).get('shop') || '';
    const store = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop) ? shop.replace(/\.myshopify\.com$/i, '') : '';
    anchor.href = `https://admin.shopify.com${store ? `/store/${store}` : ''}/draft_orders/${record.id.split('/').pop()}`;
    anchor.target = '_top'; return anchor;
  }
  async function preview(asset, img, generation) {
    try {
      const url = await window.api.getDraftArtworkUrl(asset.assetId);
      if (generation === state.generation && img.isConnected && active()) img.src = url;
    } catch { if (img.isConnected) img.alt = 'Preview unavailable'; }
  }
  function card(record) {
    const el = button('', () => open(record, el), 'draft-order-card');
    el.dataset.draftId = record.id;
    el.setAttribute('aria-label', `Prepare artwork for ${record.displayName}, ${record.customerName}`);
    const heading = text('span', '', 'draft-card-heading');
    heading.append(text('strong', record.displayName), text('span', status(record), 'draft-state'));
    const media = text('span', '', 'draft-card-media');
    if (record.preview) {
      const img = document.createElement('img'); img.alt = `Mockup for ${record.displayName}`; img.loading = 'lazy';
      media.append(img); queueMicrotask(() => preview(record.preview, img, state.generation));
    } else media.append(text('span', 'No mockup'));
    const body = text('span', '', 'draft-card-body');
    body.append(media, text('strong', record.customerName, 'draft-card-customer'));
    const footer = text('span', '', 'draft-card-footer');
    footer.append(text('span', `${record.quantity} items · ${money(record)}`),
      text('span', `${countLabel(record.mockupCount, 'mockup')} · ${countLabel(record.designCount, 'print file')}`));
    const updated = new Date(record.updatedAt);
    const time = text('time', `Updated ${updated.toLocaleDateString()}`, 'draft-card-updated'); time.dateTime = record.updatedAt;
    el.append(heading, body, footer, time);
    if (record.syncPending) el.append(text('span', 'Artwork sync pending', 'draft-state'));
    return el;
  }
  function renderList() {
    $('draft-orders-list').replaceChildren(...state.records.map(card));
    $('draft-orders-load-more').hidden = !state.cursor;
    $('draft-orders-load-more').disabled = state.loading;
    if (!state.loading) message(state.records.length
      ? `${state.records.length} drafts shown${state.cursor ? ' · More available' : ''}`
      : state.query ? 'No drafts match your search. Try a draft number or customer email.'
        : state.filter === 'converted' ? 'No converted drafts found.' : 'No drafts found. Create a draft in Shopify, then refresh here to prepare its artwork.');
  }
  async function load({ reset = false } = {}) {
    if (state.loading && !reset) return;
    const generation = ++state.generation; state.loading = true;
    if (reset) { state.cursor = null; $('draft-orders-list').replaceChildren(); }
    message('Loading Shopify drafts…'); $('draft-orders-load-more').disabled = true;
    try {
      const page = await window.api.getDraftOrders({ cursor: state.cursor, q: state.query, status: state.filter });
      if (generation !== state.generation) return;
      state.records = reset ? page.drafts : [...new Map([...state.records, ...page.drafts].map(record => [record.id, record])).values()];
      state.cursor = page.nextCursor; state.loaded = true;
    } catch (error) {
      if (generation !== state.generation) return;
      message(`${error.message} Use Refresh to try again.`, true); return;
    } finally {
      if (generation === state.generation) { state.loading = false; $('draft-orders-load-more').disabled = false; }
    }
    renderList();
  }
  async function open(record, opener) {
    if (state.busy) return;
    const generation = ++state.generation; state.loading = false;
    state.opener = opener; message(`Loading ${record.displayName}…`);
    try {
      const detail = await window.api.getDraftOrder(record.id);
      if (generation !== state.generation || !active()) return;
      state.detail = detail; state.editing = null; renderDetail();
      $('draft-detail-title').focus();
    } catch (error) { if (generation === state.generation) message(error.message, true); }
  }
  function back() {
    if (state.busy) return;
    ++state.generation; state.detail = null; state.editing = null;
    $('draft-orders-detail').hidden = true; $('draft-orders-browse').hidden = false;
    renderList();
    const opener = $('draft-orders-list').querySelector(`[data-draft-id="${state.opener?.dataset.draftId || ''}"]`);
    opener?.focus();
  }
  async function perform(action, success) {
    if (state.busy) return;
    state.busy = true; const generation = state.generation;
    $('draft-orders-detail').setAttribute('aria-busy', 'true');
    $('draft-orders-detail').querySelectorAll('button, input, select').forEach(el => { el.disabled = true; });
    message('Saving artwork…');
    try {
      const detail = await action();
      if (generation !== state.generation) return;
      state.detail = detail; state.editing = null;
      const index = state.records.findIndex(record => record.id === detail.id);
      if (index >= 0) state.records[index] = { ...state.records[index], ...detail,
        mockupCount: detail.artwork.filter(a => a.role === 'mockup').length,
        designCount: detail.artwork.filter(a => a.role === 'design').length,
        preview: detail.artwork.find(a => a.role === 'mockup') || null };
      renderDetail(); $('draft-detail-title').focus(); message(success);
    } catch (error) { if (generation === state.generation) message(`${error.message} Your existing files are retained.`, true); }
    finally {
      state.busy = false;
      $('draft-orders-detail').removeAttribute('aria-busy');
      $('draft-orders-detail').querySelectorAll('button, input, select').forEach(el => { el.disabled = false; });
      if (state.editing && $('draft-artwork-role')) $('draft-artwork-role').disabled = true;
    }
  }
  function renderDetail() {
    const record = state.detail;
    $('draft-orders-browse').hidden = true; $('draft-orders-detail').hidden = false;
    const container = $('draft-orders-detail'); container.replaceChildren();
    const header = text('div', '', 'draft-detail-header');
    header.append(button('← Draft orders', back));
    const heading = text('h3', `${record.displayName} · ${record.customerName}`, 'draft-detail-title');
    heading.id = 'draft-detail-title'; heading.tabIndex = -1;
    header.append(heading, shopifyLink(record)); container.append(header);
    container.append(text('p', `${status(record)} · ${record.quantity} items · ${money(record)}`, 'draft-detail-summary'));
    if (record.orderId) {
      container.append(text('p', record.assignmentReview
        ? 'Some artwork needs reassignment. Select its current order items below and save the assignment.'
        : `Artwork is attached to ${record.orderName || 'the purchased order'}. ${record.financialStatus === 'PAID' ? 'Paid orders enter the order pipeline.' : 'The order is awaiting payment.'}`, 'draft-notice'));
    } else container.append(text('p', 'Prepare files here. Quotes and invoices stay in Shopify. Uploaded files are internal.', 'draft-detail-summary'));
    const artwork = text('section', '', 'draft-artwork-list');
    artwork.append(text('h4', 'Attached artwork'));
    if (!record.artwork.length) artwork.append(text('p', 'No files attached yet. Select garments and a placement below to add artwork.', 'draft-detail-summary'));
    for (const asset of record.artwork) {
      const row = text('div', '', 'draft-artwork-row');
      const img = document.createElement('img'); img.alt = asset.name; img.loading = 'lazy';
      row.append(img); queueMicrotask(() => preview(asset, img, state.generation));
      const info = text('div', '', 'draft-artwork-info');
      info.append(text('strong', asset.name), text('span', `${asset.role === 'mockup' ? 'Mockup' : 'Print file'} · ${placementLabel(asset.placement)}`),
        text('span', asset.needsReassignment ? `Needs reassignment · Previously: ${asset.appliesTo}` : asset.appliesTo, asset.needsReassignment ? 'draft-error' : ''));
      const actions = text('div', '', 'draft-artwork-actions');
      actions.append(button('Preview', async () => {
        try {
          const url = await window.api.getDraftArtworkUrl(asset.assetId);
          const viewer = document.createElement('dialog'); viewer.className = 'draft-artwork-preview'; viewer.setAttribute('aria-label', `Preview ${asset.name}`);
          const image = document.createElement('img'); image.src = url; image.alt = asset.name;
          const close = button('Close preview', () => viewer.close());
          viewer.append(text('h3', asset.name), close, image); document.body.append(viewer);
          viewer.addEventListener('close', () => { viewer.remove(); actions.querySelector('button')?.focus(); }, { once: true });
          viewer.showModal(); close.focus();
        } catch (error) { message(error.message, true); }
      }));
      actions.append(button('Reassign', () => { state.editing = asset; renderDetail(); $('draft-artwork-placement').focus(); }));
      if (record.editable) actions.append(button('Remove', () => {
        if (window.confirm(`Remove ${asset.name} from this draft?`)) perform(
          () => window.api.removeDraftArtwork(record.id, asset.assetId, asset.revision), 'Artwork removed from the draft.');
      }));
      info.append(actions); row.append(info); artwork.append(row);
    }
    container.append(artwork);
    if (record.editable || state.editing) container.append(assignmentForm(record));
    message(record.assignmentReview ? 'Artwork needs reassignment.' : `${record.artwork.length} files attached.`, record.assignmentReview);
  }
  function assignmentForm(record) {
    const editing = state.editing;
    const form = document.createElement('form'); form.className = 'draft-assignment-form';
    form.append(text('h4', editing ? `Reassign ${editing.name}` : 'Add artwork'));
    const fieldset = document.createElement('fieldset'); fieldset.className = 'draft-item-picker';
    fieldset.append(text('legend', 'Applies to garments'));
    fieldset.append(text('p', 'Select every size or item that shares this artwork.', 'draft-detail-summary'));
    const all = button('Select all items', () => fieldset.querySelectorAll('input').forEach(el => { el.checked = true; }));
    fieldset.append(all);
    record.items.forEach(item => {
      const label = document.createElement('label'); label.className = 'draft-item-option';
      const input = document.createElement('input'); input.type = 'checkbox'; input.name = 'lineItemId'; input.value = item.id;
      input.checked = editing?.lineItemIds.includes(item.id) || false;
      label.append(input, text('span', `${item.title} · ${item.variantTitle || item.sku || 'Custom item'} · ${item.quantity} items`));
      fieldset.append(label);
    });
    form.append(fieldset);
    const fields = text('div', '', 'draft-upload-fields');
    function selectField(id, title, options, selected) {
      const label = document.createElement('label'); label.htmlFor = id; label.append(text('span', title));
      const select = document.createElement('select'); select.id = id; select.name = id;
      options.forEach(([value, title]) => { const option = text('option', title); option.value = value; select.append(option); });
      select.value = selected; label.append(select); fields.append(label); return select;
    }
    const role = selectField('draft-artwork-role', 'File type', [['mockup', 'Mockup'], ['design', 'Print file']], editing?.role || 'mockup');
    role.disabled = Boolean(editing);
    const placement = selectField('draft-artwork-placement', 'Placement', placements, editing?.placement || 'front');
    form.append(fields);
    let file;
    if (!editing) {
      const label = document.createElement('label'); label.htmlFor = 'draft-artwork-file'; label.append(text('span', 'Files'));
      file = document.createElement('input'); file.id = 'draft-artwork-file'; file.type = 'file'; file.multiple = true; file.required = true;
      const accept = () => { file.accept = role.value === 'design' ? '.png,.svg' : '.png,.jpg,.jpeg,.webp'; };
      accept(); role.addEventListener('change', accept); label.append(file); form.append(label);
      form.append(text('p', 'Print files: PNG or SVG. Mockups: PNG, JPG, or WebP. Up to 50 MB per file.', 'draft-detail-summary'));
    }
    const actions = text('div', '', 'draft-form-actions');
    const save = text('button', editing ? 'Save assignment' : 'Upload artwork', 'draft-primary'); save.type = 'submit'; actions.append(save);
    if (editing) actions.append(button('Cancel reassignment', () => { state.editing = null; renderDetail(); }));
    form.append(actions);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const ids = Array.from(fieldset.querySelectorAll('input:checked'), el => el.value);
      if (!ids.length) { message('Select the garments this artwork applies to.', true); fieldset.querySelector('input')?.focus(); return; }
      if (editing) return perform(() => window.api.assignDraftArtwork(record.id, editing.assetId,
        { revision: editing.revision, placement: placement.value, lineItemIds: ids }), 'Artwork assignment saved.');
      const files = Array.from(file.files || []);
      if (!files.length) return;
      // Validate the whole selection before starting so one wrong file does not cause a partial batch.
      const extension = role.value === 'design' ? /\.(png|svg)$/i : /\.(png|jpe?g|webp)$/i;
      if (files.some(file => !extension.test(file.name) || file.size < 1 || file.size > 50 * 1024 * 1024)) {
        message('Choose supported files smaller than 50 MB each.', true); return;
      }
      perform(async () => {
        let detail;
        for (const selected of files) {
          if (!uploads.has(selected)) uploads.set(selected, crypto.randomUUID().replace(/-/g, ''));
          detail = await window.api.uploadDraftArtwork(record.id, selected,
            { role: role.value, placement: placement.value, lineItemIds: ids, uploadId: uploads.get(selected) });
        }
        return detail;
      }, 'Artwork saved. It will follow this draft into the purchased order.');
    });
    return form;
  }
  function switchView(view) {
    if (state.busy || document.body.dataset.orderSource !== 'shopify') return;
    ++state.generation; state.loading = false;
    document.body.dataset.pipelineView = view;
    $('draft-orders-workspace').hidden = view !== 'drafts';
    $('col-received').setAttribute('aria-hidden', String(view === 'drafts'));
    $('pipeline-view-tabs').querySelectorAll('[role="tab"]').forEach(tab => {
      const selected = tab.dataset.pipelineView === view; tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    });
    if (view === 'drafts') {
      if (state.detail) renderDetail();
      else if (!state.loaded) load({ reset: true });
      else renderList();
    }
  }
  function init() {
    if (!$('draft-orders-workspace') || !window.api?.getDraftOrders) return;
    $('col-received').setAttribute('role', 'tabpanel');
    $('col-received').setAttribute('aria-label', 'Orders');
    $('pipeline-view-tabs').querySelectorAll('button').forEach(tab => tab.addEventListener('click', () => switchView(tab.dataset.pipelineView)));
    $('pipeline-view-tabs').addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const tabs = [...$('pipeline-view-tabs').querySelectorAll('button')];
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : (tabs.indexOf(document.activeElement) + 1) % tabs.length;
      tabs[index].focus(); switchView(tabs[index].dataset.pipelineView);
    });
    $('draft-orders-search').addEventListener('submit', event => {
      event.preventDefault(); state.query = $('draft-orders-search-input').value.trim(); load({ reset: true });
    });
    $('draft-orders-filter').addEventListener('change', event => { state.filter = event.target.value; load({ reset: true }); });
    $('draft-orders-load-more').addEventListener('click', () => load());
    $('draft-orders-refresh').addEventListener('click', () => {
      if (state.busy) return;
      if (state.detail) open(state.detail, state.opener); else load({ reset: true });
    });
    new MutationObserver(() => { if (document.body.dataset.orderSource !== 'shopify') {
      ++state.generation; state.loading = false; document.body.dataset.pipelineView = 'orders'; $('draft-orders-workspace').hidden = true;
      $('col-received').setAttribute('aria-hidden', 'false');
      $('pipeline-view-tabs').querySelectorAll('[role="tab"]').forEach(tab => {
        const selected = tab.dataset.pipelineView === 'orders'; tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
      });
    } }).observe(document.body, { attributes: true, attributeFilter: ['data-order-source'] });
    document.addEventListener('click', event => {
      if (!active() || !event.target.closest('#order-manager-refresh-btn, #mobile-refresh-btn')) return;
      event.preventDefault(); event.stopImmediatePropagation(); $('draft-orders-refresh').click();
    }, true);
  }
  window.openDraftArtworkReview = id => {
    document.querySelector('.app-nav-tab[data-view="orders"]')?.click();
    if (window.matchMedia('(max-width: 900px)').matches) document.querySelector('.mobile-tab[data-tab="pipeline"]')?.click();
    switchView('drafts'); if (active()) open({ id, displayName: 'draft artwork' }, null);
  };
  document.addEventListener('DOMContentLoaded', init);
})();
