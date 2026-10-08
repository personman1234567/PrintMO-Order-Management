/* Shopify Order Detail artwork: staged intake and one selected-file inspector. */
(() => {
  const panel = document.getElementById('detail-design-panel');
  if (!panel) return;
  const $ = id => document.getElementById(id);
  const el = (tag, copy, className) => {
    const node = document.createElement(tag);
    if (copy !== undefined) node.textContent = copy;
    if (className) node.className = className;
    return node;
  };
  let state = { key: '', order: null, files: [], selected: '', pending: [], saved: [], busy: false, placement: 'front' };
  const canEdit = order => order?._candidate === true && (order._provider || 'shopify') === 'shopify'
    && Boolean(order._gid) && !order._historyReadOnly && order._capabilities?.artworkUpload !== false;
  const eligible = order => order?._candidate === true && (order._provider || 'shopify') === 'shopify';
  const placement = side => {
    if (!side || side === 'extra' || side === 'extras') return 'Extras';
    const label = String(side).replaceAll('_', ' ');
    return label.charAt(0).toUpperCase() + label.slice(1);
  };
  const identity = file => `${file.assetId || file.url}|${file.side || ''}`;
  const nameOf = file => file.name || file.filename || 'Design file';
  const displayName = name => name.replace(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}_/i, '');
  const write = (node, copy) => { if (node && node.textContent !== copy) node.textContent = copy; };
  let controller;

  function notice(copy, error = false) {
    const node = $('production-artwork-status');
    write(node, copy);
    node.dataset.state = error ? 'error' : '';
  }
  function releasePending() {
    state.pending.forEach(entry => URL.revokeObjectURL(entry.url));
    state.pending = [];
    state.saved = [];
  }
  function canLeave(nextOrder) {
    if (!state.key || nextOrder?._gid === state.key) return true;
    if (state.busy) {
      notice('Finish or cancel the upload before leaving this order.', true);
      $('production-cancel-upload')?.focus();
      return false;
    }
    if (state.pending.length && !confirm('Discard the files waiting to upload?')) return false;
    releasePending();
    return true;
  }

  function preview(container, file, { pending = false } = {}) {
    const image = el('img');
    image.alt = `${nameOf(file)} preview`;
    if (!pending) image.loading = 'lazy';
    const status = el('span', 'Loading preview…', 'production-preview-status');
    container.replaceChildren(image, status);
    image.onload = () => status.remove();
    image.onerror = () => { image.remove(); write(status, 'Preview unavailable'); };
    image.dataset.identity = identity(file);
    if (!pending && file.assetId && window.api.getOrderArtworkUrl) {
      window.api.getOrderArtworkUrl(file.assetId).then(url => {
        if (image.isConnected && identity(file) === image.dataset.identity) image.src = url;
      }).catch(() => { if (image.isConnected) image.onerror(); });
    } else if (file.url) image.src = file.url;
    else image.onerror();
    return image;
  }
  function dimensions(file) {
    const item = (state.order?.items || []).find(item => file.lineItemIds?.includes(item.id));
    const attrs = Object.fromEntries((item?.customAttributes || []).map(a => [a.key, a.value]));
    const value = file.dimensionsIn || file.metadata?.dimensionsIn || file.meta?.dimensionsIn || attrs.size_inches || item?.properties?.size_inches;
    return value ? `${value}${/\bin(?:ches)?\b|["″]/i.test(String(value)) ? '' : ' in'}` : 'Size not recorded';
  }
  function fileMeta(file) {
    const format = /\.([a-z0-9]+)$/i.exec(nameOf(file))?.[1]?.toUpperCase() || 'File';
    return `${placement(file.placement || file.side)} · ${dimensions(file)} · ${format}`;
  }
  function showInspector({ focus = false } = {}) {
    const inspector = $('production-file-inspector');
    const file = state.files.find(file => identity(file) === state.selected);
    inspector.replaceChildren();
    inspector.hidden = !file;
    if (!file) return;
    const heading = el('h4', displayName(nameOf(file)));
    heading.id = 'production-selected-title'; heading.tabIndex = -1;
    const frame = el('button', undefined, 'production-selected-preview');
    frame.type = 'button'; frame.setAttribute('aria-label', `Open full-size preview of ${nameOf(file)}`);
    const image = preview(frame, file);
    frame.onclick = () => {
      if (image.src && image.isConnected && typeof openAssetViewer === 'function') {
        openAssetViewer(image.src);
        write($('asset-viewer-caption'), nameOf(file));
      }
    };
    const background = el('label', undefined, 'production-preview-background');
    const dark = el('input'); dark.type = 'checkbox';
    dark.onchange = () => frame.classList.toggle('dark-background', dark.checked);
    background.append(dark, el('span', 'Dark preview background'));
    inspector.append(heading, frame, background, el('p', fileMeta(file), 'production-selected-meta'));
    const fullName = el('details', undefined, 'production-filename-details');
    fullName.append(el('summary', 'Full filename'), el('p', nameOf(file)));
    inspector.append(fullName);
    const assignment = el('div', undefined, 'production-assignment');
    assignment.append(el('strong', 'Applies to'));
    const assigned = (state.order?.items || []).filter(item => file.lineItemIds?.includes(item.id));
    if (file.assignmentStatus === 'needs_review') assignment.append(el('p', 'Needs reassignment before printing.', 'production-assignment-warning'));
    if (file.assignmentLabel) assignment.append(el('p', file.assignmentLabel));
    else if (assigned.length) assigned.forEach(item => assignment.append(el('p', [item.title, item.variantTitle].filter(Boolean).join(' · '))));
    else assignment.append(el('p', 'Order-level design; no item assignment recorded.'));
    inspector.append(assignment);
    const instructions = assigned.filter(item => (item.customAttributes || []).some(a => a.key === '_designer_item_instructions' && a.value));
    if (instructions.length) {
      const section = el('div', undefined, 'production-file-instructions');
      section.append(el('strong', 'Item instructions'));
      [...new Set(instructions.map(item => item.customAttributes.find(a => a.key === '_designer_item_instructions').value))]
        .forEach(text => section.append(el('p', text)));
      inspector.append(section);
    }
    const actions = el('div', undefined, 'production-inspector-actions');
    const download = el('button', 'Download', 'production-primary'); download.type = 'button';
    download.onclick = async () => {
      download.disabled = true; write(download, 'Downloading…');
      try { await window.api.downloadAsset(file.url || image.src, nameOf(file), file.assetId); }
      catch (_) { notice('Download failed. Select the file again and retry.', true); }
      finally { download.disabled = false; write(download, 'Download'); }
    };
    actions.append(download);
    if (file.removable && canEdit(state.order)) {
      const menu = el('details', undefined, 'production-file-menu');
      const summary = el('summary', 'More actions');
      const remove = el('button', 'Remove file'); remove.type = 'button';
      remove.onclick = async () => {
        if (state.busy || !confirm(`Remove "${nameOf(file)}" from this order?`)) return;
        const key = state.key;
        remove.disabled = true;
        try {
          await window.api.deleteOrderDesignAsset(file.assetId, file.side || 'extra');
          if (key !== state.key) return;
          state.files = state.files.filter(entry => identity(entry) !== identity(file));
          state.selected = identity(state.files[0] || {});
          renderFiles();
          notice('File removed.');
          await window.refreshCanonicalOrderDetail?.();
          if (key === state.key) ($('production-selected-title') || $('production-add-design')).focus();
        } catch (_) { notice('File could not be removed. Try again.', true); remove.disabled = false; }
      };
      menu.append(summary, remove); actions.append(menu);
    }
    inspector.append(actions);
    if (focus) {
      heading.focus({ preventScroll: true });
      if (matchMedia('(max-width: 900px)').matches) heading.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }
  function renderFiles() {
    const previousFocus = document.activeElement?.dataset.productionFile;
    for (const [side, suffix] of [['front', 'front'], ['back', 'back'], ['', 'extras']]) {
      const files = state.files.filter(file => (file.side || '') === side);
      const group = $(`design-group-${suffix}`);
      group.classList.toggle('hidden', !files.length);
      write(group.querySelector('.design-group-count'), String(files.length));
      group.querySelector('.design-group-title').setAttribute('aria-label', `${placement(side)}, ${files.length} ${files.length === 1 ? 'file' : 'files'}`);
      const list = $(`design-${suffix}-list`);
      list.replaceChildren(...files.map(file => {
        const row = el('button', undefined, 'production-file-row'); row.type = 'button';
        row.dataset.productionFile = identity(file);
        row.setAttribute('aria-pressed', String(state.selected === identity(file)));
        row.setAttribute('aria-label', `${nameOf(file)}, ${fileMeta(file)}${file.assignmentStatus === 'needs_review' ? ', needs reassignment' : ''}`);
        const thumb = el('span', undefined, 'production-file-thumbnail'); preview(thumb, file);
        const copy = el('span', undefined, 'production-file-copy');
        const name = el('strong', displayName(nameOf(file))); name.title = nameOf(file);
        copy.append(name, el('span', fileMeta(file)));
        if (file.assignmentStatus === 'needs_review') copy.append(el('span', 'Needs reassignment', 'production-assignment-warning'));
        row.append(thumb, copy);
        row.onclick = () => { state.selected = identity(file); renderFiles(); showInspector({ focus: true }); };
        return row;
      }));
    }
    $('detail-designs-placeholder').classList.toggle('hidden', state.files.length > 0);
    $('detail-designs-placeholder').textContent = canEdit(state.order) ? 'No design files attached. Add a design to prepare this order.' : 'No design files attached.';
    write($('design-files-count'), `${state.files.length} ${state.files.length === 1 ? 'file' : 'files'}`);
    showInspector();
    if (previousFocus) Array.from(panel.querySelectorAll('[data-production-file]')).find(node => node.dataset.productionFile === previousFocus)?.focus({ preventScroll: true });
  }
  function render(order, buckets) {
    if (!eligible(order)) {
      panel.classList.remove('production-artwork-active');
      notice('');
      $('production-add-design').hidden = true;
      $('production-upload-form').hidden = true;
      $('production-file-inspector').hidden = true;
      return false;
    }
    if (state.key !== order._gid) {
      releasePending();
      state = { key: order._gid, order, files: [], selected: '', pending: [], saved: [], busy: false, placement: 'front' };
      notice('');
    }
    state.order = order;
    const entries = [...(order.assets || []), ...buckets.front, ...buckets.back, ...buckets.extras];
    const merged = new Map();
    entries.filter(file => file.role !== 'mockup').forEach(file => {
      const key = identity(file);
      const old = merged.get(key);
      const lineItemIds = [...new Set([...(old?.lineItemIds || []), ...(file.lineItemIds || []), file.lineItemId].filter(Boolean))];
      merged.set(key, { ...old, ...file, lineItemIds });
    });
    state.files = [...merged.values()];
    if (!state.files.some(file => identity(file) === state.selected)) state.selected = identity(state.files[0] || {});
    panel.classList.add('production-artwork-active');
    $('production-add-design').hidden = !canEdit(order);
    $('production-add-design').disabled = state.busy;
    renderFiles();
    renderPending();
    return true;
  }
  function renderPending() {
    const form = $('production-upload-form');
    form.hidden = !state.pending.length;
    $('production-pending-placement').value = state.placement;
    $('production-pending-placement').disabled = state.busy;
    $('production-upload-submit').disabled = state.busy || !state.pending.length;
    $('production-discard-pending').disabled = state.busy;
    $('production-cancel-upload').hidden = !state.busy;
    $('production-add-design').disabled = state.busy;
    $('manual-design-file-input').disabled = state.busy;
    $('production-pending-files').replaceChildren(...state.pending.map(entry => {
      const row = el('div', undefined, 'production-pending-row');
      const thumb = el('span', undefined, 'production-file-thumbnail'); preview(thumb, { name: entry.file.name, url: entry.url }, { pending: true });
      const copy = el('div'); copy.append(el('strong', entry.file.name), el('p', entry.error || 'Waiting to upload'));
      row.append(thumb, copy);
      return row;
    }));
    write($('production-pending-summary'), `${state.pending.length} ${state.pending.length === 1 ? 'file' : 'files'} · ${placement(state.placement)} applies to every file in this batch. Files attach at order level.`);
    write($('production-saved-files'), state.saved.length ? `Already saved: ${state.saved.join(', ')}` : '');
    panel.setAttribute('aria-busy', String(state.busy));
  }
  function stage(order, files) {
    if (!canEdit(order) || state.busy) return;
    const selected = Array.from(files || []);
    const invalid = selected.some(file => !/\.(svg|png|jpe?g|webp)$/i.test(file.name) || file.size <= 0 || file.size > 50 * 1024 * 1024);
    if (!selected.length) return;
    if (invalid) { notice('Choose SVG, PNG, JPG, or WebP files, up to 50 MB each. Your pending files are kept.', true); return; }
    if (!state.pending.length) { state.saved = []; state.placement = 'front'; }
    state.pending.push(...selected.map(file => ({ file, url: URL.createObjectURL(file), error: '' })));
    notice(''); renderPending();
    $('production-upload-title').focus({ preventScroll: true });
    $('production-upload-form').scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }
  async function upload() {
    if (!canEdit(state.order) || state.busy || !state.pending.length) return;
    const key = state.key;
    state.busy = true;
    controller = new AbortController();
    renderPending();
    let failed = false;
    try {
      while (state.pending.length) {
        const entry = state.pending[0];
        notice(`Uploading ${entry.file.name}…`);
        const timeout = setTimeout(() => controller.abort(), 90000);
        try { await window.api.uploadOrderDesignAsset(key, entry.file, state.placement, { signal: controller.signal }); }
        catch (error) {
          entry.error = error.name === 'AbortError' ? 'Upload stopped. Retry safely; a file may already have saved.' : 'Upload failed. This file is kept for retry.';
          failed = true;
          break;
        } finally { clearTimeout(timeout); }
        if (state.key !== key) return;
        state.saved.push(entry.file.name);
        state.pending.shift(); URL.revokeObjectURL(entry.url);
        renderPending();
      }
      const savedCount = state.saved.length;
      notice(failed ? `${savedCount ? `${savedCount} saved. ` : ''}Remaining files are kept. Retry upload when ready.` : `${savedCount} ${savedCount === 1 ? 'file' : 'files'} saved.`, failed);
      // Do not turn a failed refresh into a failed upload or retry saved files.
      try {
        let refreshTimeout;
        let refreshed;
        try {
          refreshed = await Promise.race([
            window.refreshCanonicalOrderDetail?.(),
            new Promise(resolve => { refreshTimeout = setTimeout(() => resolve({ ok: false }), 30000); })
          ]);
        } finally { clearTimeout(refreshTimeout); }
        if (refreshed?.ok === false) notice(`${savedCount} saved; current detail could not refresh. Retry detail loading. Pending files are kept.`, true);
      } catch (_) { notice(`${savedCount} saved; current detail could not refresh. Retry detail loading. Pending files are kept.`, true); }
    } finally {
      if (state.key === key) {
        state.busy = false; controller = null; renderPending();
        (state.pending.length ? $('production-upload-submit') : $('production-add-design')).focus({ preventScroll: true });
      }
    }
  }
  $('production-add-design').onclick = () => $('manual-design-file-input').click();
  $('production-pending-placement').onchange = event => { state.placement = event.target.value; renderPending(); };
  $('production-upload-submit').onclick = upload;
  $('production-cancel-upload').onclick = () => controller?.abort();
  $('production-discard-pending').onclick = () => { releasePending(); renderPending(); notice('Pending files discarded.'); $('production-add-design').focus(); };
  $('production-manage-blanks').onclick = () => {
    $('detail-tab-items').click();
    const target = $('shelf-allocation');
    const disclosure = target.querySelector('details');
    if (disclosure) disclosure.open = true;
    target.tabIndex = -1; target.scrollIntoView({ block: 'start', behavior: 'instant' }); target.focus({ preventScroll: true });
  };
  panel.addEventListener('dragover', event => {
    if (canEdit(state.order) && !state.busy && Array.from(event.dataTransfer?.types || []).includes('Files')) { event.preventDefault(); panel.classList.add('production-drop-active'); }
  });
  panel.addEventListener('dragleave', event => { if (!panel.contains(event.relatedTarget)) panel.classList.remove('production-drop-active'); });
  panel.addEventListener('drop', event => {
    if (!canEdit(state.order)) return;
    event.preventDefault(); panel.classList.remove('production-drop-active'); stage(state.order, event.dataTransfer.files);
  });
  window.addEventListener('beforeunload', event => { if (state.pending.length || state.busy) { event.preventDefault(); event.returnValue = ''; } });
  window.ProductionArtworkWorkspace = { render, stage, canLeave, close() { releasePending(); state.key = ''; state.order = null; } };
})();
