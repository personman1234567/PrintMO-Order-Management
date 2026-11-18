// Studio activity reuses the private storage adapter and workspace lifecycle.
(() => {
  const model = window.StudioActivityModel;
  const PAGE_SIZE = 1000, RENDER_CHUNK = 24, METADATA_CONCURRENCY = 4;
  const presets = { today: 1, last3: 3, last7: 7, last14: 14 };
  const state = {
    filter: 'all', query: '', range: 'last7', bounds: null, needsInitialLoad: true, generation: 0, rendered: RENDER_CHUNK,
    detail: null, detailRequest: 0,
    sources: Object.fromEntries(['mockups', 'ai', 'uploads'].map(kind => [kind, { items: [], loading: false, error: '' }]))
  };
  const elements = {}, listCache = new Map();
  let imageObserver, renderTimer, loadController;
  const icons = {
    stack: '<path d="m3 7 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5M3 17l9 5 9-5"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 14h8M8 18h5"/>'
  };
  function node(tag, className, text) {
    const value = document.createElement(tag); if (className) value.className = className;
    if (text !== undefined) value.textContent = text;
    return value;
  }
  function button(label, action, className = '') {
    const value = node('button', className, label); value.type = 'button'; value.addEventListener('click', action); return value;
  }
  function icon(name) {
    const span = node('span', 'studio-icon'); span.setAttribute('aria-hidden', 'true');
    span.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
    return span;
  }
  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = setTimeout(() => { renderTimer = null; renderStorageResults(); }, 80);
  }
  async function mapLimited(values, task, count = METADATA_CONCURRENCY) {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(count, values.length) }, async () => {
      while (next < values.length) { const value = values[next++]; await task(value); }
    }));
  }
  function normalizeList(data) {
    return { items: data?.objects || data?.items || data?.results || [], prefixes: data?.prefixes || data?.commonPrefixes || data?.delimiters || [],
      cursor: data?.cursor || data?.nextCursor || data?.continuationToken || null,
      more: Boolean(data?.hasMore || data?.truncated || data?.cursor || data?.nextCursor || data?.continuationToken) };
  }
  async function fetchList(prefix, delimiter, generation) {
    const cacheKey = JSON.stringify([prefix, delimiter || '']);
    if (listCache.has(cacheKey)) return listCache.get(cacheKey);
    const result = { items: [], prefixes: [] }, cursors = new Set(); let cursor;
    do {
      if (generation !== state.generation) return result;
      const page = normalizeList(await window.api.listStorageObjects({ prefix, delimiter, cursor, limit: PAGE_SIZE, signal: loadController?.signal }));
      result.items.push(...page.items); result.prefixes.push(...page.prefixes);
      if (!page.more) break;
      if (!page.cursor || cursors.has(page.cursor)) throw new Error('The file listing did not finish. Try again.');
      cursor = page.cursor; cursors.add(cursor);
    } while (true);
    if (generation === state.generation) listCache.set(cacheKey, result);
    return result;
  }
  async function normalizeItems(objects, kind, generation) {
    const seen = new Set(), items = objects.map(object => model.normalizeItem(object, kind)).filter(item => item.key && !seen.has(item.key) && seen.add(item.key));
    await mapLimited(items.filter(item => !Object.keys(item.metadata).length && kind !== 'uploads'), async item => {
      if (generation !== state.generation) return;
      try {
        const response = await window.api.headStorageObject(item.key, { signal: loadController?.signal });
        item.metadata = model.metadata(response?.metadata || response?.customMetadata);
      } catch { /* Optional metadata may be missing on older stored files. */ }
    });
    return items;
  }
  function appendItems(kind, items, generation) {
    if (generation !== state.generation) return;
    const source = state.sources[kind];
    if (!source.received) { source.items = []; source.received = true; }
    const seen = new Set(source.items.map(item => item.key));
    source.items.push(...items.filter(item => !seen.has(item.key) && seen.add(item.key))); scheduleRender();
  }
  async function loadPreviews(generation, dates) {
    for (const date of dates) {
      if (generation !== state.generation) return;
      const page = await fetchList(`previews/${date}/`, undefined, generation);
      appendItems('mockups', await normalizeItems(page.items, 'mockups', generation), generation);
    }
  }
  async function loadPrompts(generation, dates, history) {
    if (history) {
      const page = await fetchList('prompts/', undefined, generation);
      appendItems('ai', await normalizeItems(page.items, 'ai', generation), generation); return;
    }
    const root = await fetchList('prompts/', '/', generation);
    appendItems('ai', await normalizeItems(root.items, 'ai', generation), generation);
    const prefixes = [...new Set(root.prefixes.map(value => typeof value === 'string' ? value : value.prefix || value.name).filter(Boolean))];
    // Discover real date folders once per identity instead of probing every
    // identity/date combination, most of which have no objects.
    const wanted = new Set(dates);
    let failed = 0;
    await mapLimited(prefixes, async prefix => {
      if (generation !== state.generation) return;
      try {
        const base = prefix.replace(/\/?$/, '/');
        const folders = await fetchList(base, '/', generation);
        if (generation !== state.generation) return;
        appendItems('ai', await normalizeItems(folders.items, 'ai', generation), generation);
        const selected = [...new Set(folders.prefixes.map(value => typeof value === 'string' ? value : value.prefix || value.name).filter(Boolean))]
          .filter(folder => { const day = folder.slice(base.length).replace(/\/$/, ''); return folder.startsWith(base) && wanted.has(day) && folder === `${base}${day}/`; });
        for (const folder of selected) {
          if (generation !== state.generation) return;
          const page = await fetchList(folder, undefined, generation);
          appendItems('ai', await normalizeItems(page.items, 'ai', generation), generation);
        }
      } catch { if (generation === state.generation) failed++; }
    });
    if (failed) throw new Error('Some AI images could not load. Try again.');
  }
  async function loadUploads(generation, bounds) {
    if (typeof window.api.listStudioUploads !== 'function') throw new Error('Uploads are not available in this app version.');
    const cursors = new Set(); let cursor;
    do {
      if (generation !== state.generation) return;
      const page = await window.api.listStudioUploads({ after: bounds.after, before: bounds.before, cursor, limit: 100, signal: loadController?.signal });
      appendItems('uploads', await normalizeItems(page.items || [], 'uploads', generation), generation);
      if (!page.hasMore) break;
      if (!page.cursor || cursors.has(page.cursor)) throw new Error('The upload listing did not finish. Try again.');
      cursor = page.cursor; cursors.add(cursor);
    } while (true);
  }
  async function loadCheckoutExports(generation, bounds) {
    if (typeof window.api.listStudioCheckoutExports !== 'function') return;
    const cursors = new Set(); let cursor;
    do {
      if (generation !== state.generation) return;
      const page = await window.api.listStudioCheckoutExports({ after: bounds.after, before: bounds.before, cursor, limit: 60, signal: loadController?.signal });
      appendItems('mockups', await normalizeItems(page.items || [], 'mockups', generation), generation);
      if (!page.hasMore) break;
      if (!page.cursor || cursors.has(page.cursor)) throw new Error('The checkout export listing did not finish. Try again.');
      cursor = page.cursor; cursors.add(cursor);
    } while (true);
  }
  async function loadMockups(generation, dates, bounds) {
    const results = await Promise.allSettled([loadPreviews(generation, dates), loadCheckoutExports(generation, bounds)]);
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
  }
  function relevantKinds() { return state.filter === 'all' ? ['mockups', 'ai', 'uploads'] : [state.filter]; }
  function pauseLoading() {
    if (!Object.values(state.sources).some(source => source.loading)) return;
    state.generation++; loadController?.abort(); state.needsInitialLoad = true;
    Object.values(state.sources).forEach(source => { source.loading = false; });
    scheduleRender();
  }
  async function loadActiveTab({ reset = false } = {}) {
    loadController?.abort(); loadController = new AbortController();
    const generation = ++state.generation, bounds = state.bounds, history = state.range === 'history', dates = model.rangeDates(bounds);
    if (reset) listCache.clear();
    closeDetail(); state.rendered = RENDER_CHUNK; state.needsInitialLoad = false;
    const kinds = history ? ['ai'] : ['mockups', 'ai', 'uploads'];
    for (const kind of kinds) Object.assign(state.sources[kind], { loading: true, error: '', received: false });
    renderStorageResults();
    await Promise.all(kinds.map(async kind => {
      try {
        await ({ mockups: () => loadMockups(generation, dates, bounds), ai: () => loadPrompts(generation, dates, history), uploads: () => loadUploads(generation, bounds) })[kind]();
        if (generation === state.generation && !state.sources[kind].received) state.sources[kind].items = [];
      } catch (error) {
        if (generation === state.generation) state.sources[kind].error = error?.message || 'This activity could not load. Try again.';
      } finally {
        if (generation === state.generation) { state.sources[kind].loading = false; scheduleRender(); }
      }
    }));
  }
  function setRange(name, start, end) {
    const today = new Date(), first = new Date(today);
    if (name === 'history') { state.filter = 'ai'; first.setDate(first.getDate() - 6); }
    else if (presets[name]) first.setDate(first.getDate() - presets[name] + 1);
    const bounds = model.rangeBounds(start || model.dateKey(first), end || model.dateKey(today));
    if (!bounds) { elements.dateError.textContent = 'Enter a valid start and end date.'; return; }
    state.range = name; state.bounds = bounds;
    elements.start.value = bounds.start; elements.end.value = bounds.end;
    elements.rangeLabel.textContent = ({ today: 'Today', last3: 'Last 3 days', last7: 'Last 7 days', last14: 'Last 14 days', history: 'All AI history' })[name]
      || `${model.dayLabel(bounds.start)} – ${model.dayLabel(bounds.end)}`;
    elements.dateError.textContent = ''; elements.range.open = false; state.rendered = RENDER_CHUNK; updateFilters();
    document.dispatchEvent(new CustomEvent('studio:range'));
    if (document.body.dataset.activeView === 'storage' && !window.StudioUsage?.active) loadActiveTab(); else state.needsInitialLoad = true;
  }
  function updateFilters() {
    elements.filters.forEach(item => {
      const active = item.dataset.activityFilter === state.filter;
      item.setAttribute('aria-pressed', String(active)); item.classList.toggle('active', active);
    });
  }
  function setFilter(kind) {
    if (!model.kinds.includes(kind)) return;
    state.filter = kind; state.rendered = RENDER_CHUNK;
    if (state.range === 'history' && kind !== 'ai') { setRange('last7'); return; }
    updateFilters(); renderStorageResults();
  }
  function imageUrl(item, retry = false) {
    // The adapter owns URL lifetime and in-flight deduplication. Keeping a
    // second resolved cache here would retain URLs after adapter eviction.
    return item.projectRef ? window.api.getStudioProjectThumbnailUrl(item.projectRef, { refresh: retry })
      : item.checkoutAssetId ? window.api.getDraftArtworkUrl(item.checkoutAssetId)
      : item.uploadId ? window.api.getStudioUploadUrl(item.uploadId, { refresh: retry })
      : window.api.getStorageObjectUrl(item.key, { refresh: retry });
  }
  async function loadImage(img) {
    const item = img._studioItem; if (!item || img.dataset.requested) return;
    img.dataset.requested = 'true'; const host = img.parentElement;
    img.onload = () => { host.classList.add('image-ready'); host.classList.remove('image-failed'); };
    img.onerror = () => { host.classList.remove('image-ready'); host.classList.add('image-failed'); };
    try { const url = await imageUrl(item); if (img.isConnected) img.src = url; }
    catch { if (img.isConnected) img.onerror(); }
  }
  function media(item, alt) {
    const host = node('span', 'studio-media'), img = node('img'); img.alt = alt; img.decoding = 'async'; img.loading = 'lazy'; img._studioItem = item;
    const fallback = node('span', 'studio-media-fallback'); fallback.append(icon('file'), node('span', '', 'Preview unavailable'));
    host.append(img, fallback);
    if (imageObserver) imageObserver.observe(img); else queueMicrotask(() => loadImage(img));
    return host;
  }
  function createEntry(entry) {
    const article = node('article', 'studio-entry'); article.dataset.entryId = entry.id;
    const open = button('', () => openDetail(entry), 'studio-entry-open');
    open.setAttribute('aria-label', `${entry.action}: ${entry.title}. ${entry.items.length} file${entry.items.length === 1 ? '' : 's'}. ${model.relativeTime(entry.timestamp)}`);
    const picture = media(entry.cover, entry.title);
    if (entry.items.length > 1) {
      const count = node('span', 'studio-file-count'); count.append(icon('stack'), node('span', '', `${entry.items.length} files`)); picture.append(count);
    }
    const text = node('span', 'studio-entry-caption'); text.append(node('strong', '', state.filter === 'mockups' ? entry.title : entry.action));
    const age = model.relativeTime(entry.timestamp);
    const caption = entry.checkout ? `${entry.action} · ${age}` : `Exported ${age}`;
    const time = node('time', '', state.filter === 'mockups' ? caption : age);
    if (entry.timestamp) time.dateTime = new Date(entry.timestamp).toISOString();
    text.append(time); open.append(picture, text); article.append(open); return article;
  }
  function renderStorageResults() {
    const kinds = relevantKinds(), busy = kinds.some(kind => state.sources[kind].loading), errors = kinds.filter(kind => state.sources[kind].error);
    const feed = model.buildFeed({ previews: state.sources.mockups.items, prompts: state.sources.ai.items, uploads: state.sources.uploads.items,
      filter: state.filter, query: state.query, bounds: state.range === 'history' ? null : state.bounds });
    elements.results.setAttribute('aria-busy', String(busy)); elements.loading.hidden = !busy;
    elements.loading.textContent = feed.length ? 'Loading more activity…' : 'Loading recent creations…';
    elements.errors.replaceChildren(); elements.errors.hidden = errors.length === 0;
    for (const kind of errors) {
      const row = node('div', 'studio-source-error');
      row.append(node('span', '', `${{ ai: 'AI images', mockups: 'Mockups', uploads: 'Uploads' }[kind]}: ${state.sources[kind].error}`), button('Retry', () => loadActiveTab({ reset: true })));
      elements.errors.append(row);
    }
    if (!window.StudioUsage?.active) elements.refresh.disabled = busy;
    const visible = feed.slice(0, state.rendered);
    const signature = JSON.stringify([state.filter, visible.map(entry => [entry.id, entry.title, entry.action, entry.timestamp, entry.items.map(item => item.key)])]);
    if (signature !== elements.results.dataset.signature) {
      elements.results.dataset.signature = signature; imageObserver?.disconnect(); elements.results.replaceChildren(); let day;
      for (const entry of visible) {
        if (entry.date !== day) { day = entry.date; elements.results.append(node('h2', 'studio-day', model.dayLabel(day))); }
        elements.results.append(createEntry(entry));
      }
    }
    elements.empty.hidden = Boolean(feed.length || busy || errors.length); elements.empty.replaceChildren();
    if (!elements.empty.hidden) {
      elements.empty.append(node('p', '', state.query ? 'No creations match this search in the selected period.' : 'No creations in this period yet.'));
      if (state.query) elements.empty.append(button('Clear search', () => { elements.search.value = ''; state.query = ''; renderStorageResults(); }));
      else if (state.range !== 'last14') elements.empty.append(button('View last 14 days', () => setRange('last14')));
    }
    elements.more.hidden = feed.length <= state.rendered; elements.more.textContent = `Show ${Math.max(0, Math.min(RENDER_CHUNK, feed.length - state.rendered))} more`;
    elements.coverage.hidden = !kinds.includes('uploads');
    document.dispatchEvent(new CustomEvent('studio:creations'));
  }
  function detailField(label, value) {
    if (value === null || value === undefined || value === '') return;
    elements.fields.append(node('dt', '', label), node('dd', '', String(value)));
  }
  function renderDetailFields(entry, item) {
    const meta = item.metadata; elements.detailTitle.textContent = entry.title;
    const age = model.relativeTime(entry.timestamp);
    elements.detailSubtitle.textContent = [entry.checkout ? entry.action : entry.kind === 'mockups' ? `Exported ${age}` : age,
      entry.checkout ? age : '', entry.orderName,
      entry.items.length > 1 ? `${entry.items.length} related files` : '', model.customer(item)].filter(Boolean).join(' · ');
    elements.context.textContent = [meta.color, meta.producttitle, entry.kind === 'ai' ? meta.style : ''].filter(Boolean).join(' · ');
    elements.context.hidden = !elements.context.textContent;
    elements.prompt.textContent = meta.promptshort || ''; elements.promptSection.hidden = !meta.promptshort; elements.fields.replaceChildren();
    detailField('Filename', item.filename); detailField('Created', model.timestamp(item) ? new Date(model.timestamp(item)).toLocaleString() : '');
    detailField('Customer', meta.customername || meta.customeremail); detailField('Customer ID', meta.customerid); detailField('Guest ID', meta.guestid); detailField('Identity', meta.identitykey);
    detailField('Design reference', meta.designref); detailField('Workspace', meta.workspaceid); detailField('Product', meta.producttitle); detailField('Product handle', meta.producthandle);
    detailField('Color', meta.color); detailField('Side', meta.side); detailField('File role', meta.role);
    detailField('Order', meta.ordername);
    const reference = item.projectRef || item.uploadId || item.checkoutAssetId || item.key;
    detailField(item.projectRef ? 'Project reference' : item.uploadId ? 'Upload reference' : item.checkoutAssetId ? 'File reference' : 'Object key', reference);
    elements.copyStatus.textContent = '';
    elements.copyKey.textContent = item.projectRef ? 'Copy project reference' : 'Copy file reference';
    elements.copyKey.onclick = () => copyText(reference);
    elements.copyUrl.textContent = item.checkoutAssetId ? 'Download file' : 'Copy temporary image URL';
    elements.copyUrl.onclick = async () => {
      try {
        if (item.checkoutAssetId) await window.api.downloadAsset(null, item.filename, item.checkoutAssetId);
        else await copyText(await imageUrl(item));
      } catch {
        elements.copyStatus.textContent = item.checkoutAssetId ? 'The file could not download. Try again.' : 'The image URL could not load. Try again.';
      }
    };
    elements.retryImage.onclick = () => selectDetailFile(item, true);
  }
  async function selectDetailFile(item, retry = false) {
    const entry = state.detail; if (!entry) return; const request = ++state.detailRequest;
    renderDetailFields(entry, item);
    elements.related.querySelectorAll('button').forEach(value => value.setAttribute('aria-pressed', String(value._studioKey === item.key)));
    elements.detailImage.removeAttribute('src'); elements.detailImage.alt = item.kind === 'mockups' ? `${entry.title} — ${model.fileLabel(item)}` : entry.title;
    elements.detailImage.hidden = true; elements.imageStatus.hidden = false; elements.imageStatus.textContent = 'Loading image…'; elements.retryImage.hidden = true;
    const fail = () => { if (request === state.detailRequest) { elements.imageStatus.hidden = false; elements.imageStatus.textContent = 'This image could not load.'; elements.retryImage.hidden = false; } };
    elements.detailImage.onload = () => { if (request === state.detailRequest) { elements.detailImage.hidden = false; elements.imageStatus.hidden = true; } };
    elements.detailImage.onerror = fail;
    try { const src = await imageUrl(item, retry); if (request === state.detailRequest && state.detail) elements.detailImage.src = src; }
    catch { fail(); }
  }
  function openDetail(entry) {
    state.detail = entry; elements.technical.open = false; elements.detailCard.classList.remove('studio-image-expanded');
    elements.expand.setAttribute('aria-pressed', 'false'); elements.related.replaceChildren();
    for (const item of entry.items) {
      const select = button('', () => selectDetailFile(item), 'studio-related-file'); select._studioKey = item.key;
      select.setAttribute('aria-label', model.fileLabel(item));
      select.append(media(item, model.fileLabel(item)), node('span', '', model.fileLabel(item))); elements.related.append(select);
    }
    elements.related.hidden = entry.items.length < 2; elements.overlay.classList.remove('hidden');
    elements.detailCard.querySelector('.storage-detail-body').scrollTop = 0;
    elements.related.scrollLeft = 0; selectDetailFile(entry.cover);
  }
  function closeDetail() {
    state.detail = null; state.detailRequest++; elements.overlay?.classList.add('hidden'); elements.detailImage?.removeAttribute('src');
  }
  async function copyText(value) {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else {
        const textarea = node('textarea'); textarea.value = value; textarea.style.position = 'fixed'; textarea.style.opacity = '0';
        document.body.append(textarea); textarea.select(); const copied = document.execCommand('copy'); textarea.remove(); if (!copied) throw new Error('Copy failed');
      }
      elements.copyStatus.textContent = 'Copied.';
    } catch { elements.copyStatus.textContent = 'Could not copy. Select and copy the reference below.'; }
  }
  function enterWorkspace(nextView) {
    if (nextView === 'inventory') {
      if (document.body.classList.contains('detail-open')) document.getElementById('detail-close')?.click(); window.loadShelfInventory?.();
    } else if (nextView === 'storage') {
      if (window.StudioUsage?.active) { window.StudioUsage.enter(); return; }
      if (state.needsInitialLoad) loadActiveTab(); else renderStorageResults();
    } else if (nextView === 'previous') {
      if (typeof window.loadPreviousOrders === 'function') window.loadPreviousOrders();
    }
  }
  function initStorageBrowser() {
    if (!model || !document.getElementById('storage-view')) return;
    const ids = { root: 'storage-view', results: 'storage-results', loading: 'storage-loading', errors: 'storage-error', empty: 'storage-empty', more: 'storage-load-more',
      refresh: 'storage-refresh', search: 'storage-filter-input', searchRow: 'storage-search-row', searchToggle: 'storage-search-toggle', range: 'storage-date-options', rangeLabel: 'storage-range-label',
      start: 'storage-start-date-input', end: 'storage-end-date-input', dateError: 'storage-date-error', coverage: 'storage-upload-coverage',
      overlay: 'storage-detail-overlay', detailCard: 'storage-detail-card', detailTitle: 'storage-detail-title', detailSubtitle: 'storage-detail-subtitle',
      detailImage: 'storage-detail-image', imageStatus: 'storage-image-status', retryImage: 'storage-image-retry', related: 'storage-related-files',
      fields: 'storage-detail-fields', context: 'storage-detail-context', prompt: 'storage-detail-prompt', promptSection: 'storage-prompt-section', technical: 'storage-file-details',
      copyKey: 'storage-copy-key', copyUrl: 'storage-copy-url', copyStatus: 'storage-copy-status', expand: 'storage-image-expand' };
    for (const [key, id] of Object.entries(ids)) elements[key] = document.getElementById(id);
    elements.filters = [...elements.root.querySelectorAll('[data-activity-filter]')];
    if ('IntersectionObserver' in window) imageObserver = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) { imageObserver.unobserve(entry.target); loadImage(entry.target); }
    }, { rootMargin: '200px' });
    elements.filters.forEach(item => item.addEventListener('click', () => setFilter(item.dataset.activityFilter)));
    elements.root.querySelectorAll('[data-activity-range]').forEach(item => item.addEventListener('click', () => setRange(item.dataset.activityRange)));
    document.getElementById('storage-custom-dates').addEventListener('submit', event => { event.preventDefault(); setRange('custom', elements.start.value, elements.end.value); });
    elements.search.addEventListener('input', () => { state.query = elements.search.value; state.rendered = RENDER_CHUNK; renderStorageResults(); });
    elements.searchToggle.addEventListener('click', () => {
      const open = elements.searchRow.hidden; elements.searchRow.hidden = !open; elements.searchToggle.setAttribute('aria-expanded', String(open));
      if (open) elements.search.focus(); else elements.searchToggle.focus();
    });
    elements.refresh.addEventListener('click', () => window.StudioUsage?.active ? window.StudioUsage.refresh() : loadActiveTab({ reset: true }));
    elements.more.addEventListener('click', () => { state.rendered += RENDER_CHUNK; renderStorageResults(); });
    document.getElementById('storage-detail-close').addEventListener('click', closeDetail); document.getElementById('storage-detail-back').addEventListener('click', closeDetail);
    elements.overlay.addEventListener('click', event => { if (event.target === elements.overlay) closeDetail(); });
    elements.expand.addEventListener('click', () => {
      const expanded = elements.detailCard.classList.toggle('studio-image-expanded'); elements.expand.setAttribute('aria-pressed', String(expanded));
      elements.expand.setAttribute('aria-label', expanded ? 'Restore image size' : 'Enlarge image');
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeDetail(); elements.range.open = false; } });
    document.addEventListener('click', event => { if (!elements.range.contains(event.target)) elements.range.open = false; });
    setRange('last7');
    for (const name of ['storage', 'previous', 'inventory']) window.OrderManagerNavigation.register(name, { onEnter: () => enterWorkspace(name), ...(name === 'storage' ? { onLeave: () => { closeDetail(); pauseLoading(); window.StudioUsage?.leave(); } } : {}) });
  }
  window.StudioActivity = {
    range: () => state.bounds,
    setRange: (start, end) => setRange('custom', start, end),
    enter: () => enterWorkspace('storage'),
    pause: pauseLoading,
    entries: () => state.needsInitialLoad || state.range === 'history' || Object.values(state.sources).some(source => source.loading || source.error) ? null
      : model.buildFeed({ previews: state.sources.mockups.items, prompts: state.sources.ai.items, uploads: state.sources.uploads.items, filter: 'all', query: '', bounds: state.bounds }),
    projectMedia: record => media({ projectRef: record.ref }, record.title || 'Untitled project'),
    openProject: record => {
      const item = { key: '', projectRef: record.ref, filename: record.title || 'Untitled project', metadata: {}, uploadedAt: record.occurredAt, kind: 'project' };
      openDetail({ title: item.filename, kind: 'project', timestamp: Date.parse(record.occurredAt), items: [item], cover: item });
    },
    open: openDetail, imageUrl
  };
  document.addEventListener('DOMContentLoaded', initStorageBrowser);
})();
