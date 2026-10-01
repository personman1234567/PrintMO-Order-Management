// Extend the existing pipeline workbench; drafts are preparation, never production stages.
(() => {
  const state = { records: [], cursor: null, query: '', filter: 'active', loaded: false,
    loading: false, generation: 0, detail: null, editing: null, opener: null, busy: false, scrollTop: 0, pending: [], adding: false, selectedAssetId: null,
    uploadRole: 'mockup', uploadPlacement: 'front', uploadItemIds: [] };
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
    const el = state.detail && $('draft-detail-status') ? $('draft-detail-status') : $('draft-orders-status'); el.textContent = value; el.classList.toggle('draft-error', error);
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
  const tiles = new Map();
  let observer, previewEpoch = 0, previewQueue = [], previewRequests = 0;
  function pausePreviews() {
    ++previewEpoch; observer?.disconnect();
    previewQueue.forEach(task => { task.tile.dataset.previewState = 'idle'; }); previewQueue = [];
  }
  function validPreview(task) {
    return task.epoch === previewEpoch && active() && !state.detail && task.tile.isConnected
      && task.tile.dataset.assetId === task.assetId;
  }
  function pumpPreviews() {
    while (previewRequests < 4 && previewQueue.length) {
      const task = previewQueue.shift();
      if (!validPreview(task)) { task.tile.dataset.previewState = 'idle'; continue; }
      ++previewRequests;
      (async () => {
        try {
          const url = await window.api.getDraftArtworkUrl(task.assetId);
          if (!validPreview(task)) return;
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => finish(false), 20000);
            const finish = ok => {
              clearTimeout(timer); task.img.onload = task.img.onerror = null;
              ok ? resolve() : reject(new Error('Preview unavailable'));
            };
            task.img.onload = () => finish(true); task.img.onerror = () => finish(false); task.img.src = url;
          });
          if (validPreview(task)) { task.tile.dataset.previewState = 'ready'; task.label.hidden = true; }
        } catch {
          if (validPreview(task)) {
            task.tile.dataset.previewState = 'error'; task.img.removeAttribute('src'); task.label.textContent = 'Preview unavailable';
          }
        } finally {
          --previewRequests;
          if (!validPreview(task) && task.tile.dataset.previewState === 'loading') {
            task.tile.dataset.previewState = 'idle'; task.img.removeAttribute('src');
            if (active() && !state.detail) observer?.observe(task.tile);
          }
          pumpPreviews();
        }
      })();
    }
  }
  function observePreviews() {
    if (!active() || state.detail) return;
    if (!observer) observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const tile = entry.target;
        if (!entry.isIntersecting || tile.dataset.previewState !== 'idle') continue;
        observer.unobserve(tile); tile.dataset.previewState = 'loading';
        previewQueue.push({ tile, assetId: tile.dataset.assetId, epoch: previewEpoch,
          img: tile.querySelector('img'), label: tile.querySelector('.draft-preview-label') });
      }
      pumpPreviews();
    }, { root: $('draft-orders-workspace'), rootMargin: '200px 0px' });
    tiles.forEach(({ el }) => { if (el.dataset.previewState === 'idle') observer.observe(el); });
  }
  function card(record) {
    const el = button('', () => open(record, el), 'draft-order-card');
    el.dataset.draftId = record.id;
    el.setAttribute('aria-label', `Prepare artwork for ${record.displayName}, ${record.customerName}`);
    const heading = text('span', '', 'draft-card-heading');
    heading.append(text('strong', record.displayName), text('span', status(record), 'draft-state'));
    el.append(heading);
    if (record.preview) {
      el.dataset.assetId = record.preview.assetId; el.dataset.previewState = 'idle';
      const media = text('span', '', 'draft-card-media');
      const img = document.createElement('img'); img.alt = `Mockup for ${record.displayName}`; img.decoding = 'async';
      media.append(text('span', 'Loading preview…', 'draft-preview-label'), img); el.append(media);
    }
    el.append(text('strong', record.customerName, 'draft-card-customer'));
    const footer = text('span', '', 'draft-card-footer');
    footer.append(text('span', countLabel(record.quantity, 'item')), text('span', money(record), 'draft-card-total')); el.append(footer);
    if (!record.preview) el.append(text('span', 'No mockup', 'draft-card-no-mockup'));
    const artwork = [];
    if (record.mockupCount) artwork.push(countLabel(record.mockupCount, 'mockup'));
    if (record.designCount) artwork.push(countLabel(record.designCount, 'print file'));
    if (artwork.length) el.append(text('span', artwork.join(' · '), 'draft-card-artwork'));
    const updated = new Date(record.updatedAt);
    const time = text('time', `Updated ${updated.toLocaleDateString()}`, 'draft-card-updated'); time.dateTime = record.updatedAt;
    el.append(time);
    if (record.syncPending) el.append(text('span', 'Artwork sync pending', 'draft-card-sync'));
    return el;
  }
  function loadingControls() {
    $('draft-orders-load-more').disabled = state.loading; $('draft-orders-refresh').disabled = state.loading || state.busy;
    $('draft-orders-list').setAttribute('aria-busy', String(state.loading));
  }
  function renderList() {
    const list = $('draft-orders-list'), ids = new Set(state.records.map(record => record.id));
    for (const [id, tile] of tiles) if (!ids.has(id)) { observer?.unobserve(tile.el); tile.el.remove(); tiles.delete(id); }
    state.records.forEach((record, index) => {
      const signature = JSON.stringify(record); let tile = tiles.get(record.id);
      if (!tile || tile.signature !== signature) {
        if (tile) { observer?.unobserve(tile.el); tile.el.remove(); }
        tile = { el: card(record), signature }; tiles.set(record.id, tile);
      }
      // Appending pages keeps existing buttons and resolved previews in place.
      if (list.children[index] !== tile.el) list.insertBefore(tile.el, list.children[index] || null);
    });
    list.querySelectorAll('.draft-card-skeleton').forEach(el => el.remove());
    $('draft-orders-count').textContent = `${state.records.length} shown`;
    $('draft-orders-load-more').hidden = !state.cursor;
    loadingControls(); observePreviews();
    if (!state.loading) message(state.records.length ? ''
      : state.query ? 'No drafts match your search. Try a draft number or customer email.'
        : state.filter === 'converted' ? 'No converted drafts found.' : 'No drafts found. Create a draft in Shopify, then refresh here to prepare its artwork.');
  }
  function skeletons() {
    pausePreviews(); tiles.clear();
    $('draft-orders-list').replaceChildren(...Array.from({ length: 6 }, () => {
      const el = text('div', '', 'draft-card-skeleton'); el.setAttribute('aria-hidden', 'true');
      el.append(...Array.from({ length: 4 }, () => text('span', ''))); return el;
    }));
    $('draft-orders-count').textContent = ''; $('draft-orders-load-more').hidden = true; $('draft-orders-workspace').scrollTop = 0;
  }
  async function load({ reset = false, retain = false } = {}) {
    if (state.loading && !reset) return;
    const generation = ++state.generation; state.loading = true;
    if (reset && !retain) { state.records = []; state.cursor = null; state.loaded = false; skeletons(); }
    message(reset && !retain ? 'Loading Shopify drafts…' : reset ? 'Refreshing drafts…' : 'Loading more drafts…'); loadingControls();
    try {
      const page = await window.api.getDraftOrders({ cursor: reset ? null : state.cursor, q: state.query, status: state.filter });
      if (generation !== state.generation) return;
      if (reset) pausePreviews();
      state.records = reset ? page.drafts : [...new Map([...state.records, ...page.drafts].map(record => [record.id, record])).values()];
      state.cursor = page.nextCursor; state.loaded = true;
    } catch (error) {
      if (generation !== state.generation) return;
      $('draft-orders-list').querySelectorAll('.draft-card-skeleton').forEach(el => el.remove());
      message(`${error.message} ${reset ? 'Use Refresh drafts' : 'Use Load more drafts'} to try again.`, true); return;
    } finally {
      if (generation === state.generation) { state.loading = false; loadingControls(); }
    }
    renderList();
  }
  function clearPending() {
    state.pending.forEach(entry => URL.revokeObjectURL(entry.url));
    state.pending = []; state.adding = false;
    state.uploadRole = 'mockup'; state.uploadPlacement = 'front'; state.uploadItemIds = [];
  }
  function discardAssignment() {
    return !state.editing || window.confirm('Discard the unsaved assignment changes? Pending uploads will be kept.');
  }
  function discardChanges() {
    return !(state.pending.length || state.editing) || window.confirm('Discard the unsaved artwork changes? Uploaded files will be kept.');
  }
  function syncRecord(detail) {
    state.detail = detail;
    const index = state.records.findIndex(record => record.id === detail.id);
    if (index >= 0) state.records[index] = { ...state.records[index], ...detail,
      mockupCount: detail.artwork.filter(a => a.role === 'mockup').length,
      designCount: detail.artwork.filter(a => a.role === 'design').length,
      preview: detail.artwork.find(a => a.role === 'mockup') || null };
  }
  async function open(record, opener) {
    if (state.busy || (state.detail && !discardChanges())) return;
    const generation = ++state.generation; state.loading = false;
    if (!state.detail) state.scrollTop = $('draft-orders-workspace').scrollTop;
    pausePreviews(); loadingControls();
    if (opener) state.opener = opener;
    message(`Loading ${record.displayName}…`);
    try {
      const detail = await window.api.getDraftOrder(record.id);
      if (generation !== state.generation || !active()) return;
      clearPending(); state.detail = detail; state.editing = null;
      state.selectedAssetId = detail.artwork[0]?.assetId || null;
      renderDetail(); message(''); $('draft-orders-status').textContent = '';
      if (!$('draft-detail-dialog').open) $('draft-detail-dialog').showModal();
      $('draft-detail-title').focus();
    } catch (error) { if (generation === state.generation) { message(error.message, true); observePreviews(); } }
  }
  function back() {
    if (state.busy || !discardChanges()) return;
    ++state.generation; clearPending(); state.detail = null; state.editing = null;
    $('draft-detail-dialog').close(); $('draft-orders-detail').hidden = true;
    $('draft-orders-browse').hidden = false;
    $('draft-orders-workspace').dataset.detail = 'false'; renderList();
    $('draft-orders-workspace').scrollTop = state.scrollTop;
    const opener = $('draft-orders-list').querySelector(`[data-draft-id="${state.opener?.dataset.draftId || ''}"]`);
    opener?.focus({ preventScroll: true });
  }
  function detailControls() {
    $('draft-orders-detail').setAttribute('aria-busy', String(state.busy));
    $('draft-orders-detail').querySelectorAll('button, input, select').forEach(el => { el.disabled = state.busy; });
    if (state.editing && $('draft-artwork-role')) $('draft-artwork-role').disabled = true;
  }
  async function perform(action, success) {
    if (state.busy) return;
    state.busy = true; const generation = state.generation;
    detailControls(); loadingControls(); message('Saving artwork…');
    try {
      const detail = await action();
      if (generation !== state.generation) return;
      syncRecord(detail); state.editing = null;
      if (!state.pending.length) { state.adding = false; state.uploadItemIds = []; state.uploadPlacement = 'front'; state.uploadRole = 'mockup'; }
      renderDetail(); message(success);
    } catch (error) {
      if (generation === state.generation) {
        // Earlier files in a batch are already saved; only unresolved files remain staged.
        renderDetail();
        const recovery = state.pending.length ? 'Saved artwork is kept. Remaining files are still pending; try Upload artwork again.'
          : state.editing ? 'Your assignment changes are retained. Try Save assignment again.' : 'Existing artwork is kept. Try again.';
        message(`${error.message} ${recovery}`, true);
      }
    } finally {
      state.busy = false; loadingControls(); detailControls();
      if (generation === state.generation && state.detail) {
        (document.querySelector('.draft-assignment-form button[type="submit"]') || $('draft-edit-assignment') || $('draft-add-files'))?.focus({ preventScroll: true });
      }
    }
  }
  function itemLabel(item) { return `${item.title} · ${item.variantTitle || item.sku || 'Custom item'} · Qty ${item.quantity}`; }
  function shortItemTitle(item) {
    const parts = item.title.split(/\s+-\s+/);
    const compact = parts.length > 2 && /^[\w-]*\d[\w-]*$/.test(parts.at(-1)) ? `${parts[0]} · ${parts.at(-1)}` : item.title;
    return compact.length > 52 ? `${compact.slice(0, 49).trimEnd()}…` : compact;
  }
  function assignmentLabel(asset, full = false) {
    if (asset.needsReassignment) return `Previously: ${asset.appliesTo}`;
    const items = state.detail.items.filter(item => asset.lineItemIds.includes(item.id));
    return items.length ? items.map(item => `${full ? item.title : shortItemTitle(item)} · ${item.variantTitle || item.sku || 'Custom item'} · Qty ${item.quantity}`).join('; ') : asset.appliesTo;
  }
  function media(asset, className) {
    const frame = text('div', '', className);
    const fallback = text('span', 'Loading preview…', 'draft-media-status');
    const img = document.createElement('img'); img.alt = asset.name; img.decoding = 'async';
    img.addEventListener('load', () => { fallback.hidden = true; });
    img.addEventListener('error', () => { img.hidden = true; fallback.textContent = 'Preview unavailable'; });
    frame.append(fallback, img);
    const generation = state.generation;
    queueMicrotask(async () => {
      try {
        const url = asset.url || await window.api.getDraftArtworkUrl(asset.assetId);
        if (generation === state.generation && img.isConnected && active()) img.src = url;
      } catch { if (frame.isConnected) { img.hidden = true; fallback.textContent = 'Preview unavailable'; } }
    });
    return frame;
  }
  function focusInspector() {
    const title = $('draft-inspector-title'); title?.focus({ preventScroll: true });
    if (window.matchMedia('(max-width: 760px)').matches) title?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  function selectAsset(assetId) {
    if (state.busy || !discardAssignment()) return;
    state.editing = null; state.adding = false; state.selectedAssetId = assetId;
    renderDetail(); focusInspector();
  }
  function addFiles(files) {
    if (state.busy || !state.detail?.editable) return;
    const selected = Array.from(files || []);
    if (!selected.length) return;
    if (!discardAssignment()) return;
    if (selected.some(file => !/\.(png|svg|jpe?g|webp)$/i.test(file.name) || file.size < 1 || file.size > 50 * 1024 * 1024)) {
      message('Choose PNG, SVG, JPG, or WebP files up to 50 MB each. No files from this selection were added.', true); return;
    }
    if (state.detail.artwork.length + state.pending.length + selected.length > 100) {
      message('A draft can hold up to 100 files. Choose fewer files or remove an existing attachment.', true); return;
    }
    state.editing = null; state.adding = true;
    if (!state.pending.length) {
      state.uploadRole = selected.every(file => /\.svg$/i.test(file.name)) ? 'design' : 'mockup';
      state.uploadItemIds = []; state.uploadPlacement = 'front';
    }
    selected.forEach(file => state.pending.push({ file, id: crypto.randomUUID().replace(/-/g, ''), url: URL.createObjectURL(file) }));
    renderDetail(); message(''); focusInspector(); $('draft-artwork-role')?.focus({ preventScroll: true });
  }
  async function pasteImage() {
    if (state.busy || !state.detail?.editable) return;
    const generation = state.generation;
    try {
      const clipboardItems = await navigator.clipboard.read();
      if (generation !== state.generation || !active()) return;
      const files = [];
      for (const item of clipboardItems) {
        const type = item.types.find(value => ['image/png', 'image/jpeg', 'image/webp'].includes(value));
        if (type) {
          const blob = await item.getType(type);
          files.push(new File([blob], `pasted-image-${state.pending.length + files.length + 1}.${type === 'image/jpeg' ? 'jpg' : type.split('/')[1]}`, { type }));
        }
      }
      if (generation !== state.generation || !active()) return;
      if (!files.length) { message('No supported image was found in the clipboard. Copy an image or use Add files.', true); return; }
      if (state.pending.length && state.uploadRole !== 'mockup') {
        message('Finish or cancel the pending print files before pasting a mockup.', true); return;
      }
      addFiles(files);
    } catch {
      if (generation === state.generation) message('Could not read the clipboard. Use Add files, or focus the artwork area and paste with your keyboard.', true);
    }
  }
  function fileMenu(asset) {
    const wrapper = text('div', '', 'draft-file-menu');
    const menu = document.createElement('div'); menu.className = 'draft-file-popover'; menu.popover = 'auto'; menu.setAttribute('role', 'menu');
    const trigger = button('⋯', () => {
      if (menu.matches(':popover-open')) { menu.hidePopover(); return; }
      const bounds = trigger.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(bounds.right - 160, window.innerWidth - 168))}px`;
      menu.style.top = `${Math.min(bounds.bottom + 4, window.innerHeight - 64)}px`;
      menu.showPopover(); menu.querySelector('button').focus();
    }, 'draft-file-menu-trigger');
    trigger.setAttribute('aria-label', `Actions for ${asset.name}`); trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    menu.addEventListener('toggle', event => { trigger.setAttribute('aria-expanded', String(event.newState === 'open')); });
    const remove = button('Remove file', () => {
      menu.hidePopover(); trigger.focus();
      if (window.confirm(`Remove ${asset.name} from this draft?`)) perform(
        () => window.api.removeDraftArtwork(state.detail.id, asset.assetId, asset.revision), 'Artwork removed from the draft.');
    }, 'draft-remove-file');
    remove.setAttribute('role', 'menuitem');
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); menu.hidePopover(); trigger.focus(); }
    });
    menu.append(remove); wrapper.append(trigger, menu); return wrapper;
  }
  function renderDetail() {
    const record = state.detail;
    if (!record) return;
    if (!record.artwork.some(asset => asset.assetId === state.selectedAssetId)) state.selectedAssetId = record.artwork[0]?.assetId || null;
    pausePreviews(); $('draft-orders-workspace').dataset.detail = 'true';
    $('draft-orders-detail').hidden = false;
    const container = $('draft-orders-detail');
    const scrollTop = container.querySelector('.draft-detail-body')?.scrollTop || 0;
    container.replaceChildren();
    const header = text('header', '', 'draft-detail-header');
    header.append(button('← Drafts', back, 'draft-back'));
    const identity = text('div', '', 'draft-detail-identity');
    const heading = text('h2', `${record.displayName} · ${record.customerName}`, 'draft-detail-title');
    heading.id = 'draft-detail-title'; heading.tabIndex = -1;
    identity.append(heading, text('p', `${status(record)} · ${record.quantity} order items · ${money(record)}`, 'draft-detail-summary'));
    const refresh = button('↻', () => open(record, state.opener), 'draft-detail-refresh');
    refresh.setAttribute('aria-label', 'Refresh draft'); refresh.title = 'Refresh draft';
    header.append(identity, shopifyLink(record), refresh); container.append(header);
    const body = text('div', '', 'draft-detail-body');
    const feedback = text('p', '', 'draft-detail-feedback'); feedback.id = 'draft-detail-status';
    feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite'); body.append(feedback);
    if (record.orderId) body.append(text('p', record.assignmentReview
      ? 'This draft became an order. Review the highlighted files and assign them to the current order items.'
      : `Artwork is attached to ${record.orderName || 'the purchased order'}. Add or remove files from the purchased order.`, 'draft-notice'));
    const toolbar = text('div', '', 'draft-artwork-toolbar');
    toolbar.append(text('h3', 'Artwork'), text('span', countLabel(record.artwork.length, 'file'), 'draft-artwork-count'));
    if (record.editable) {
      const actions = text('div', '', 'draft-intake-actions');
      const input = document.createElement('input'); input.type = 'file'; input.multiple = true;
      input.id = 'draft-artwork-file'; input.accept = '.png,.svg,.jpg,.jpeg,.webp'; input.hidden = true;
      input.addEventListener('change', () => addFiles(input.files));
      const add = button('Add files', () => input.click(), state.adding || state.pending.length ? '' : 'draft-primary'); add.id = 'draft-add-files';
      actions.append(add, button('Paste image', pasteImage), input);
      if (state.pending.length && !state.adding) actions.append(button('Continue upload', () => {
        if (!discardAssignment()) return;
        state.editing = null; state.adding = true; renderDetail(); focusInspector(); $('draft-artwork-role')?.focus({ preventScroll: true });
      }, 'draft-primary'));
      toolbar.append(actions);
    }
    body.append(toolbar);
    const layout = text('div', '', 'draft-artwork-layout');
    layout.tabIndex = 0; layout.setAttribute('aria-label', 'Draft artwork. Drop files here or paste an image.');
    if (record.editable) {
      layout.addEventListener('dragover', event => {
        if (Array.from(event.dataTransfer?.types || []).includes('Files')) { event.preventDefault(); layout.classList.add('is-dropping'); }
      });
      layout.addEventListener('dragleave', event => { if (!layout.contains(event.relatedTarget)) layout.classList.remove('is-dropping'); });
      layout.addEventListener('drop', event => { event.preventDefault(); layout.classList.remove('is-dropping'); addFiles(event.dataTransfer?.files); });
    }
    const list = text('section', '', 'draft-artwork-list'); list.setAttribute('aria-label', 'Artwork files');
    if (!record.artwork.length && !state.pending.length) {
      const empty = text('div', '', 'draft-artwork-empty');
      empty.append(text('h4', 'Start with your artwork'), text('p', record.editable
        ? 'Add files, drop them here, or paste an image. Then choose the items and placement.' : 'No artwork is attached to this draft.'));
      list.append(empty);
    }
    for (const asset of record.artwork) {
      const row = text('div', '', 'draft-artwork-row');
      row.dataset.selected = String(state.selectedAssetId === asset.assetId && !state.adding);
      const select = button('', () => selectAsset(asset.assetId), 'draft-file-select');
      select.dataset.assetId = asset.assetId; select.setAttribute('aria-pressed', row.dataset.selected);
      select.setAttribute('aria-label', `View ${asset.name}, ${asset.role === 'mockup' ? 'Mockup' : 'Print file'}, ${placementLabel(asset.placement)}`);
      select.append(media(asset, 'draft-file-thumbnail'));
      const info = text('span', '', 'draft-artwork-info');
      const name = text('strong', asset.name); name.title = asset.name;
      const assignment = text('span', assignmentLabel(asset), 'draft-file-assignment'); assignment.title = assignmentLabel(asset, true);
      info.append(name, text('span', `${asset.role === 'mockup' ? 'Mockup' : 'Print file'} · ${placementLabel(asset.placement)}`, 'draft-file-meta'), assignment);
      if (asset.needsReassignment) info.append(text('span', 'Needs reassignment', 'draft-file-warning'));
      select.append(info); row.append(select);
      if (record.editable) row.append(fileMenu(asset));
      list.append(row);
    }
    if (state.pending.length) {
      list.append(text('h4', `Pending upload · ${countLabel(state.pending.length, 'file')}`, 'draft-pending-title'));
      state.pending.forEach(entry => {
        const row = text('div', '', 'draft-pending-row');
        row.append(media({ name: entry.file.name, url: entry.url }, 'draft-file-thumbnail'));
        const info = text('div', '', 'draft-artwork-info');
        info.append(text('strong', entry.file.name), text('span', 'Not uploaded yet', 'draft-file-meta')); row.append(info);
        const remove = button('×', () => {
          URL.revokeObjectURL(entry.url); state.pending = state.pending.filter(value => value !== entry);
          renderDetail(); $('draft-artwork-role')?.focus({ preventScroll: true });
        }, 'draft-pending-remove');
        remove.setAttribute('aria-label', `Discard pending ${entry.file.name}`); row.append(remove); list.append(row);
      });
    }
    const inspector = text('section', '', 'draft-artwork-inspector'); inspector.setAttribute('aria-label', 'Selected artwork and assignments');
    let selected = record.artwork.find(asset => asset.assetId === state.selectedAssetId);
    if (!selected) { selected = record.artwork[0]; state.selectedAssetId = selected?.assetId || null; }
    const inspectorTitle = text('h3', state.adding ? 'Upload artwork' : selected?.name || 'Order items');
    inspectorTitle.id = 'draft-inspector-title'; inspectorTitle.tabIndex = -1; inspector.append(inspectorTitle);
    if (state.adding && record.editable) {
      inspector.append(assignmentForm(record));
    } else if (selected) {
      inspector.append(media(selected, 'draft-selected-preview'));
      if (state.editing) inspector.append(assignmentForm(record));
      else {
        inspector.append(text('p', `${selected.role === 'mockup' ? 'Mockup' : 'Print file'} · ${placementLabel(selected.placement)}`, 'draft-selected-meta'));
        inspector.append(text('p', `${selected.needsReassignment ? 'Previously applied to' : 'Applies to'}: ${assignmentLabel(selected).replace(/^Previously: /, '')}`, 'draft-selected-assignment'));
        if (selected.needsReassignment) inspector.append(text('p', 'Needs reassignment. Choose the current order items to repair this file.', 'draft-file-warning'));
        const edit = button('Edit assignment', () => {
          state.editing = { ...selected, draftPlacement: selected.placement, draftItemIds: [...selected.lineItemIds] };
          renderDetail(); focusInspector(); $('draft-artwork-placement').focus({ preventScroll: true });
        }); edit.id = 'draft-edit-assignment'; inspector.append(edit);
      }
    }
    if (!state.adding && !state.editing) {
      const items = text('section', '', 'draft-reference-items');
      if (selected) items.append(text('h4', 'Order items'));
      for (const item of record.items) {
        const row = text('div', '', 'draft-reference-item');
        row.title = itemLabel(item); row.append(text('strong', shortItemTitle(item)), text('span', `${item.variantTitle || item.sku || 'Custom item'} · Qty ${item.quantity}`));
        items.append(row);
      }
      inspector.append(items);
    }
    layout.append(list, inspector); body.append(layout);
    const help = document.createElement('details'); help.className = 'draft-context-help';
    help.append(text('summary', 'About draft artwork'), text('p', 'Files are internal and follow the draft into its purchased order. Manage quotes, invoices, and payment in Shopify.'));
    body.append(help); container.append(body); body.scrollTop = scrollTop;
    detailControls();
  }
  function assignmentForm(record) {
    const editing = state.editing;
    const form = document.createElement('form'); form.className = 'draft-assignment-form';
    const fields = text('div', '', 'draft-upload-fields');
    function selectField(id, title, options, selected) {
      const label = document.createElement('label'); label.htmlFor = id; label.append(text('span', title));
      const select = document.createElement('select'); select.id = id; select.name = id;
      options.forEach(([value, title]) => { const option = text('option', title); option.value = value; select.append(option); });
      select.value = selected; label.append(select); fields.append(label); return select;
    }
    const role = selectField('draft-artwork-role', 'File purpose', [['mockup', 'Mockup'], ['design', 'Print file']], editing?.role || state.uploadRole);
    role.disabled = Boolean(editing);
    const placement = selectField('draft-artwork-placement', 'Placement', placements, editing?.draftPlacement || state.uploadPlacement);
    placement.addEventListener('change', () => { if (editing) editing.draftPlacement = placement.value; else state.uploadPlacement = placement.value; });
    form.append(fields);
    if (!editing) {
      const hint = text('p', '', 'draft-format-hint');
      const updateHint = () => {
        state.uploadRole = role.value;
        hint.textContent = `${role.value === 'design' ? 'Print files: PNG or SVG.' : 'Mockups: PNG, JPG, or WebP.'} Up to 50 MB per file.`;
      };
      updateHint(); role.addEventListener('change', updateHint); form.append(hint);
      if (state.pending.length > 1) form.append(text('p', `This assignment will apply to all ${state.pending.length} pending files.`, 'draft-batch-hint'));
      if (!state.pending.length) form.append(text('p', 'Use Add files or Paste image to choose artwork.', 'draft-format-hint'));
    }
    const fieldset = document.createElement('fieldset'); fieldset.className = 'draft-item-picker';
    fieldset.append(text('legend', 'Applies to items'));
    const all = button('Select all', () => {
      fieldset.querySelectorAll('input').forEach(el => { el.checked = true; });
      if (editing) editing.draftItemIds = record.items.map(item => item.id); else state.uploadItemIds = record.items.map(item => item.id);
    }, 'draft-select-all'); fieldset.append(all);
    record.items.forEach(item => {
      const label = document.createElement('label'); label.className = 'draft-item-option';
      const input = document.createElement('input'); input.type = 'checkbox'; input.name = 'lineItemId'; input.value = item.id;
      input.checked = (editing ? editing.draftItemIds : state.uploadItemIds).includes(item.id); input.setAttribute('aria-label', itemLabel(item));
      input.addEventListener('change', () => {
        const ids = Array.from(fieldset.querySelectorAll('input:checked'), el => el.value);
        if (editing) editing.draftItemIds = ids; else state.uploadItemIds = ids;
      });
      const info = text('span', '', 'draft-item-label'); info.title = itemLabel(item);
      info.append(text('strong', shortItemTitle(item)), text('span', `${item.variantTitle || item.sku || 'Custom item'} · Qty ${item.quantity}`));
      label.append(input, info); fieldset.append(label);
    }); form.append(fieldset);
    const actions = text('div', '', 'draft-form-actions');
    const save = text('button', editing ? 'Save assignment' : 'Upload artwork', 'draft-primary'); save.type = 'submit'; actions.append(save);
    actions.append(button('Cancel', () => {
      if (editing ? !discardAssignment() : !discardChanges()) return;
      state.editing = null; if (!editing) clearPending(); renderDetail(); ($('draft-edit-assignment') || $('draft-add-files'))?.focus({ preventScroll: true });
    })); form.append(actions);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const ids = Array.from(fieldset.querySelectorAll('input:checked'), el => el.value);
      if (!ids.length) { message('Select the items this artwork applies to.', true); fieldset.querySelector('input')?.focus(); return; }
      if (editing) return perform(() => window.api.assignDraftArtwork(record.id, editing.assetId,
        { revision: editing.revision, placement: placement.value, lineItemIds: ids }), 'Artwork assignment saved.');
      if (!state.pending.length) { message('Choose files or paste an image before uploading.', true); $('draft-add-files').focus(); return; }
      const extension = role.value === 'design' ? /\.(png|svg)$/i : /\.(png|jpe?g|webp)$/i;
      if (state.pending.some(entry => !extension.test(entry.file.name))) {
        message(role.value === 'design' ? 'Print files must be PNG or SVG. Remove unsupported pending files or choose Mockup.' : 'Mockups must be PNG, JPG, or WebP. Remove unsupported pending files or choose Print file.', true); return;
      }
      const total = state.pending.length;
      const generation = state.generation;
      perform(async () => {
        let detail = record;
        for (const entry of [...state.pending]) {
          detail = await window.api.uploadDraftArtwork(record.id, entry.file,
            { role: role.value, placement: placement.value, lineItemIds: ids, uploadId: entry.id });
          if (generation !== state.generation || !active() || state.detail?.id !== record.id) throw new Error('The draft workspace changed. Reopen the draft to review uploaded files.');
          syncRecord(detail); state.selectedAssetId = detail.artwork.at(-1)?.assetId || state.selectedAssetId;
          state.pending = state.pending.filter(value => value !== entry); URL.revokeObjectURL(entry.url);
        }
        clearPending(); return detail;
      }, `${countLabel(total, 'file')} uploaded. Artwork will follow this draft into the purchased order.`);
    });
    return form;
  }
  function switchView(view) {
    if (state.busy || document.body.dataset.orderSource !== 'shopify') return;
    if (view !== 'drafts' && state.detail) { back(); if (state.detail) return; }
    if (active() && !state.detail) state.scrollTop = $('draft-orders-workspace').scrollTop;
    ++state.generation; state.loading = false; pausePreviews(); loadingControls();
    document.body.dataset.pipelineView = view;
    $('draft-orders-workspace').hidden = view !== 'drafts';
    $('col-received').setAttribute('aria-hidden', String(view === 'drafts'));
    $('pipeline-view-tabs').querySelectorAll('[role="tab"]').forEach(tab => {
      const selected = tab.dataset.pipelineView === view; tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    });
    if (view === 'drafts') {
      if (state.detail) renderDetail();
      else if (!state.loaded) load({ reset: true });
      else { renderList(); $('draft-orders-workspace').scrollTop = state.scrollTop; }
    }
  }
  function init() {
    if (!$('draft-orders-workspace') || !window.api?.getDraftOrders) return;
    const dialog = document.createElement('dialog'); dialog.id = 'draft-detail-dialog';
    dialog.setAttribute('aria-labelledby', 'draft-detail-title');
    dialog.append($('draft-orders-detail')); document.body.append(dialog);
    dialog.addEventListener('cancel', event => { event.preventDefault(); back(); });
    dialog.addEventListener('paste', event => {
      if (state.busy || !state.detail?.editable || event.target.closest('input, textarea, [contenteditable="true"]')) return;
      const files = Array.from(event.clipboardData?.files || []);
      if (files.length) {
        event.preventDefault();
        if (state.pending.length && state.uploadRole !== 'mockup') { message('Finish or cancel the pending print files before pasting a mockup.', true); return; }
        addFiles(files);
      }
    });
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
      if (state.detail) open(state.detail, state.opener); else load({ reset: true, retain: state.loaded });
    });
    new MutationObserver(() => { if (document.body.dataset.orderSource !== 'shopify') {
      ++state.generation; state.loading = false; clearPending(); state.detail = null; state.editing = null; dialog.close(); $('draft-orders-detail').hidden = true;
      $('draft-orders-workspace').dataset.detail = 'false'; pausePreviews(); loadingControls(); document.body.dataset.pipelineView = 'orders'; $('draft-orders-workspace').hidden = true;
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
