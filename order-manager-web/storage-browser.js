// storage-browser.js
(() => {
  const STORAGE_TABS = ['previews', 'prompts'];
  const RECENT_DAYS = 7;
  const STORAGE_LIST_PAGE_LIMIT = 1000;
  const META_CONCURRENCY = 4;
  const PROMPT_LIST_CONCURRENCY = 24;
  const PROMPT_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif']);

  const state = {
    activeTab: 'previews',
    date: '',
    filter: '',
    lastOrdersTab: 'pipeline',
    needsInitialLoad: true,
    listCache: new Map(),
    metadataCache: new Map(),
    metadataRequests: new Map(),
    detailItemKey: null,
    detailTab: null,
    previews: {
      items: [],
      cursor: null,
      hasMore: false,
      loading: false,
      error: null,
    },
    prompts: {
      items: [],
      identityCursor: null,
      identityPrefixes: [],
      identityItemCursors: new Map(),
      fallbackMode: false,
      hasMore: false,
      loading: false,
      error: null,
    },
  };

  const elements = {};

  const metadataLimiter = createLimiter(META_CONCURRENCY);
  const promptListLimiter = createLimiter(PROMPT_LIST_CONCURRENCY);
  let imageObserver = null;
  let renderTimer = null;

  function createLimiter(limit) {
    let active = 0;
    const queue = [];
    const runNext = () => {
      if (!queue.length || active >= limit) return;
      const next = queue.shift();
      if (next) next();
    };
    return (task) => new Promise((resolve, reject) => {
      const runner = () => {
        active += 1;
        Promise.resolve()
          .then(task)
          .then(resolve)
          .catch(reject)
          .finally(() => {
            active -= 1;
            runNext();
          });
      };
      if (active < limit) {
        runner();
      } else {
        queue.push(runner);
      }
    });
  }

  function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function getRecentDates(count = RECENT_DAYS) {
    const dates = [];
    const now = new Date();
    for (let i = 0; i < count; i += 1) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      dates.push(formatDate(d));
    }
    return dates;
  }

  function getCacheKey({ tab, date, prefix, cursor, delimiter }) {
    return [tab, date, prefix, cursor || 'start', delimiter || 'none'].join('|');
  }

  function normalizeListResponse(data) {
    const objects = Array.isArray(data?.objects)
      ? data.objects
      : Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data?.results)
          ? data.results
          : [];
    const prefixes = Array.isArray(data?.prefixes)
      ? data.prefixes
      : Array.isArray(data?.commonPrefixes)
        ? data.commonPrefixes
        : Array.isArray(data?.delimiters)
          ? data.delimiters
          : [];
    const cursor = data?.cursor || data?.nextCursor || data?.continuationToken || null;
    const hasMore = Boolean(data?.hasMore || data?.truncated || cursor);
    return { objects, prefixes, cursor, hasMore };
  }

  function normalizeMetadata(meta = {}) {
    const normalized = {};
    Object.entries(meta || {}).forEach(([key, value]) => {
      if (key) normalized[key.toLowerCase()] = value;
    });
    return normalized;
  }

  /**
   * Extract a lowercase file extension from a storage key.
   * @param {string} key
   * @returns {string}
   */
  function getFileExtension(key) {
    if (!key) return '';
    const lastDot = key.lastIndexOf('.');
    if (lastDot === -1 || lastDot === key.length - 1) return '';
    return key.slice(lastDot + 1).toLowerCase();
  }

  /**
   * Determine if a storage key references an image asset we can render.
   * @param {string} key
   * @returns {boolean}
   */
  function isPromptImageKey(key) {
    return PROMPT_IMAGE_EXTENSIONS.has(getFileExtension(key));
  }

  /**
   * Extract the identity segment from a prompt storage key.
   * @param {string} key
   * @returns {string|null}
   */
  function extractPromptIdentityFromKey(key) {
    if (!key) return null;
    const parts = key.split('/');
    const promptsIndex = parts.indexOf('prompts');
    if (promptsIndex === -1 || promptsIndex + 1 >= parts.length) return null;
    return parts[promptsIndex + 1] || null;
  }

  function pickMeta(meta, keys) {
    if (!meta) return null;
    for (const key of keys) {
      const value = meta[key];
      if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
    return null;
  }

  /**
   * Render a timestamp as a friendly date string with an "at" separator.
   * @param {string|number|Date} raw
   * @returns {string}
   */
  function formatTimestamp(raw) {
    if (!raw) return '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return String(raw);
    const formatted = date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    return formatted.replace(', ', ' at ');
  }

  /**
   * Provide a stable key for matching prompt image+JSON pairs.
   * @param {string} key
   * @returns {string}
   */
  function getPromptBaseKey(key) {
    if (!key) return '';
    const lastDot = key.lastIndexOf('.');
    return lastDot === -1 ? key : key.slice(0, lastDot);
  }

  /**
   * Check if metadata contains real values beyond the injected key reference.
   * @param {Object} meta
   * @returns {boolean}
   */
  function hasMeaningfulMetadata(meta) {
    if (!meta || typeof meta !== 'object') return false;
    return Object.keys(meta).some(key => key !== 'key');
  }

  function getPreviewIdentity(meta) {
    const normalized = normalizeMetadata(meta);
    const customerName = pickMeta(normalized, ['customername']);
    const customerEmail = pickMeta(normalized, ['customeremail']);
    const customerId = pickMeta(normalized, ['customerid']);
    const guestId = pickMeta(normalized, ['guestid']);
    const identityKey = pickMeta(normalized, ['identitykey']);
    const geoLabel = pickMeta(normalized, ['geolabel']);

    let displayName = customerName || customerEmail || customerId;
    let identity = identityKey || customerId || customerEmail || guestId || 'unknown';
    if (!displayName) {
      if (guestId) {
        displayName = guestId;
      } else if (identityKey) {
        displayName = identityKey.startsWith('guest:') ? identityKey : `guest:${identityKey}`;
      } else {
        displayName = 'Guest';
      }
    }

    if (!identity) identity = displayName;
    const subtitle = geoLabel ? `Geo: ${geoLabel}` : '';
    return { identity, displayName, subtitle };
  }

  function getPromptIdentity(meta) {
    const normalized = normalizeMetadata(meta);
    const customerName = pickMeta(normalized, ['customername']);
    const customerEmail = pickMeta(normalized, ['customeremail']);
    const customerId = pickMeta(normalized, ['customerid']);
    const identityKey = pickMeta(normalized, ['identitykey']);
    const guestId = pickMeta(normalized, ['guestid']);

    const fallbackIdentity = extractPromptIdentityFromKey(meta?.key || '') || null;
    const displayName = customerName || customerEmail || customerId || guestId || identityKey || fallbackIdentity || 'Unknown';
    const identity = identityKey || customerId || customerEmail || guestId || fallbackIdentity || displayName;
    return { identity, displayName };
  }

  function buildSearchText(item, meta) {
    const normalized = normalizeMetadata(meta);
    const fields = [
      item.filename,
      pickMeta(normalized, ['customername']),
      pickMeta(normalized, ['customeremail']),
      pickMeta(normalized, ['customerid']),
      pickMeta(normalized, ['guestid']),
      pickMeta(normalized, ['identitykey']),
      pickMeta(normalized, ['designref']),
      pickMeta(normalized, ['producthandle']),
      pickMeta(normalized, ['producttitle']),
      pickMeta(normalized, ['promptshort']),
      pickMeta(normalized, ['style']),
      pickMeta(normalized, ['audience']),
    ];
    return fields.filter(Boolean).join(' ').toLowerCase();
  }

  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = window.setTimeout(() => {
      renderTimer = null;
      renderStorageResults();
    }, 100);
  }

  function setActiveView(view) {
    const nextView = view === 'storage' ? 'storage' : 'orders';
    if (nextView === 'storage') {
      const currentTab = document.body.dataset.activeTab || 'pipeline';
      if (currentTab && currentTab !== 'storage') state.lastOrdersTab = currentTab;
    }
    document.body.dataset.activeView = nextView;
    document.querySelectorAll('.app-nav-tab').forEach(btn => {
      const isActive = btn.dataset.view === nextView;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    if (elements.storageView) {
      elements.storageView.setAttribute('aria-hidden', nextView !== 'storage');
    }
    if (elements.ordersView) {
      elements.ordersView.setAttribute('aria-hidden', nextView !== 'orders');
    }
    if (nextView === 'storage') {
      if (typeof window.setActiveMobileTab === 'function' && window.matchMedia('(max-width: 900px)').matches) {
        window.setActiveMobileTab('storage', { scrollTop: false });
      }
      if (state.needsInitialLoad || state[state.activeTab].items.length === 0) {
        state.needsInitialLoad = false;
        loadActiveTab({ reset: true });
      }
    } else if (typeof window.setActiveMobileTab === 'function' && window.matchMedia('(max-width: 900px)').matches) {
      window.setActiveMobileTab(state.lastOrdersTab || 'pipeline', { scrollTop: false });
    }
  }

  async function fetchList({ tab, date, prefix, cursor, limit, delimiter }) {
    const cacheKey = getCacheKey({ tab, date, prefix, cursor, delimiter });
    if (state.listCache.has(cacheKey)) return state.listCache.get(cacheKey);
    const data = await window.api.listStorageObjects({ prefix, cursor, limit, delimiter });
    const normalized = normalizeListResponse(data || {});
    state.listCache.set(cacheKey, normalized);
    return normalized;
  }

  async function fetchAllListPages({ tab, date, prefix, cursor = null, limit = STORAGE_LIST_PAGE_LIMIT, delimiter }) {
    const objects = [];
    const prefixes = [];
    const seenCursors = new Set();
    let nextCursor = cursor;

    while (true) {
      const page = await fetchList({ tab, date, prefix, cursor: nextCursor, limit, delimiter });
      objects.push(...page.objects);
      prefixes.push(...page.prefixes);

      if (!page.hasMore) break;
      if (!page.cursor || seenCursors.has(page.cursor)) {
        console.warn('Stopping paginated storage fetch without a usable next cursor', { tab, prefix, cursor: page.cursor });
        break;
      }

      seenCursors.add(page.cursor);
      nextCursor = page.cursor;
    }

    return { objects, prefixes };
  }

  async function fetchListPagesIncrementally({ tab, date, prefix, cursor = null, limit = STORAGE_LIST_PAGE_LIMIT, delimiter, onPage }) {
    const objects = [];
    const prefixes = [];
    const seenCursors = new Set();
    let nextCursor = cursor;

    while (true) {
      const page = await fetchList({ tab, date, prefix, cursor: nextCursor, limit, delimiter });
      objects.push(...page.objects);
      prefixes.push(...page.prefixes);

      if (onPage) {
        await onPage(page);
      }

      if (!page.hasMore) break;
      if (!page.cursor || seenCursors.has(page.cursor)) {
        console.warn('Stopping paginated storage fetch without a usable next cursor', { tab, prefix, cursor: page.cursor });
        break;
      }

      seenCursors.add(page.cursor);
      nextCursor = page.cursor;
    }

    return { objects, prefixes };
  }

  function buildItem(obj) {
    const key = obj?.key || obj?.name || obj?.objectKey || obj?.Key || '';
    const filename = key.split('/').pop() || key;
    const meta = obj?.customMetadata || obj?.metadata || obj?.custom_metadata || null;
    const metadata = meta ? cacheMetadata(key, meta) : state.metadataCache.get(key) || null;
    return {
      key,
      filename,
      metadata,
      metadataLoaded: Boolean(metadata),
      lastModified: obj?.uploadedAt || obj?.uploaded || obj?.lastModified || obj?.mtime || obj?.modified || null,
    };
  }

  function buildItemsFromObjects(objects, { seenKeys, filter } = {}) {
    const items = [];
    objects.forEach(obj => {
      const item = buildItem(obj);
      if (!item.key) return;
      if (typeof filter === 'function' && !filter(item)) return;
      if (seenKeys && seenKeys.has(item.key)) return;
      if (seenKeys) seenKeys.add(item.key);
      items.push(item);
    });
    return items;
  }

  function cacheMetadata(key, meta = {}) {
    if (!key) return null;
    const normalized = normalizeMetadata(meta);
    normalized.key = key;
    const existing = state.metadataCache.get(key);
    if (existing) {
      if (hasMeaningfulMetadata(existing) && !hasMeaningfulMetadata(normalized)) {
        return existing;
      }
      Object.assign(existing, normalized);
      existing.key = key;
      return existing;
    }
    state.metadataCache.set(key, normalized);
    return normalized;
  }

  function applyOwnMetadata(item, metadata) {
    if (!item || !metadata) return false;
    const preserveDisplayMetadata = hasMeaningfulMetadata(item.metadata) && !hasMeaningfulMetadata(metadata);
    const changed = !preserveDisplayMetadata && item.metadata !== metadata;
    if (!preserveDisplayMetadata) {
      item.metadata = metadata;
    }
    item.metadataLoaded = true;
    return changed;
  }

  async function fetchMetadataForKey(key) {
    if (!key) return null;
    if (state.metadataCache.has(key)) {
      return state.metadataCache.get(key);
    }
    if (state.metadataRequests.has(key)) {
      return state.metadataRequests.get(key);
    }

    const request = metadataLimiter(async () => {
      try {
        const data = await window.api.headStorageObject(key);
        const meta = data?.customMetadata || data?.metadata || data?.custom_metadata || {};
        return cacheMetadata(key, meta);
      } catch (err) {
        console.warn('Failed to load metadata', key, err);
        return null;
      } finally {
        state.metadataRequests.delete(key);
      }
    });

    state.metadataRequests.set(key, request);
    return request;
  }

  async function ensureItemMetadata(item) {
    if (!item?.key) return item?.metadata || null;
    if (item.metadataLoaded) {
      return item.metadata || state.metadataCache.get(item.key) || null;
    }

    const cached = state.metadataCache.get(item.key);
    if (cached) {
      applyOwnMetadata(item, cached);
      return cached;
    }

    const metadata = await fetchMetadataForKey(item.key);
    if (metadata) {
      applyOwnMetadata(item, metadata);
    }
    return item.metadata || metadata || null;
  }

  function hydrateMetadataInBackground(items, onUpdate) {
    const pending = items.filter(item => item?.key && !item.metadataLoaded).map(async item => {
      const previousMetadata = item.metadata;
      const metadata = await ensureItemMetadata(item);
      const changed = previousMetadata !== item.metadata;
      onUpdate?.(item, metadata, changed);
    });
    return Promise.all(pending);
  }

  function findPromptMetadataSidecar(item) {
    if (!item?.key || !isPromptImageKey(item.key)) return null;
    const baseKey = getPromptBaseKey(item.key);
    return state.prompts.items.find(candidate =>
      candidate !== item
      && getFileExtension(candidate.key) === 'json'
      && getPromptBaseKey(candidate.key) === baseKey,
    ) || null;
  }

  async function ensureDetailMetadata(item, tab) {
    if (!item?.key) return item?.metadata || null;
    if (tab !== 'prompts' || !isPromptImageKey(item.key)) {
      return ensureItemMetadata(item);
    }

    const pending = [ensureItemMetadata(item)];
    const sidecar = findPromptMetadataSidecar(item);
    if (sidecar && !hasMeaningfulMetadata(item.metadata)) {
      pending.push(ensureItemMetadata(sidecar));
    }

    await Promise.all(pending);
    mergePromptMetadata(state.prompts.items);
    return item.metadata || null;
  }

  /**
   * Apply JSON metadata onto matching prompt images when the image lacks it.
   * @param {Array<{key: string, metadata?: Object}>} items
   */
  function mergePromptMetadata(items) {
    let changed = false;
    const jsonMetaByBase = new Map();
    items.forEach(item => {
      if (getFileExtension(item.key) !== 'json') return;
      if (!hasMeaningfulMetadata(item.metadata)) return;
      jsonMetaByBase.set(getPromptBaseKey(item.key), item.metadata);
    });

    items.forEach(item => {
      if (!isPromptImageKey(item.key)) return;
      if (hasMeaningfulMetadata(item.metadata)) return;
      const baseKey = getPromptBaseKey(item.key);
      if (jsonMetaByBase.has(baseKey)) {
        const nextMetadata = jsonMetaByBase.get(baseKey);
        if (item.metadata !== nextMetadata) {
          item.metadata = nextMetadata;
          changed = true;
        }
      }
    });

    return changed;
  }

  function appendPromptItems(tabState, items) {
    if (!items.length) return;
    tabState.items = tabState.items.concat(items);
    mergePromptMetadata(tabState.items);
    hydrateMetadataInBackground(items, (_item, _metadata, changed) => {
      const merged = mergePromptMetadata(tabState.items);
      if (changed || merged) scheduleRender();
    });
    scheduleRender();
  }

  function setupImageObserver() {
    if (imageObserver) return;
    if (!('IntersectionObserver' in window)) {
      imageObserver = {
        observe: (img) => {
          const src = img.dataset.src;
          if (src) {
            img.src = src;
            img.classList.add('loaded');
          }
        },
      };
      return;
    }
    imageObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const img = entry.target;
        const src = img.dataset.src;
        if (src && !img.src) {
          img.src = src;
          // Clean up fade-in once loaded by browser
          img.onload = () => img.classList.add('loaded');
        }
        imageObserver.unobserve(img);
      });
    }, { rootMargin: '400px' });
  }

  function setLoading(tab, isLoading) {
    const tabState = state[tab];
    if (!tabState) return;
    tabState.loading = isLoading;
    if (isLoading) {
      tabState.error = null;
    }
  }

  function setError(tab, message) {
    const tabState = state[tab];
    if (!tabState) return;
    tabState.error = message;
  }

  function setDate(date) {
    if (!date) return;
    state.date = date;
    elements.dateInput.value = date;
    document.querySelectorAll('.storage-recent-date').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.date === date);
    });
    loadActiveTab({ reset: true });
  }

  function setActiveTab(tab) {
    const next = STORAGE_TABS.includes(tab) ? tab : STORAGE_TABS[0];
    state.activeTab = next;
    document.querySelectorAll('.storage-tab').forEach(btn => {
      const isActive = btn.dataset.storageTab === next;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    if (document.body.dataset.activeView === 'storage') {
      loadActiveTab({ reset: true });
    } else {
      state.needsInitialLoad = true;
    }
  }

  async function loadActiveTab({ reset }) {
    if (!state.date) return;
    if (state.activeTab === 'previews') {
      await loadPreviews({ reset });
    } else {
      await loadPrompts({ reset });
    }
  }

  async function loadPreviews({ reset }) {
    const tabState = state.previews;
    if (tabState.loading) return;
    if (!reset && !tabState.hasMore) return;
    setLoading('previews', true);
    scheduleRender();

    try {
      if (reset) {
        tabState.items = [];
        tabState.cursor = null;
        tabState.hasMore = false;
      }
      const prefix = `previews/${state.date}/`;
      const data = await fetchAllListPages({
        tab: 'previews',
        date: state.date,
        prefix,
        cursor: reset ? null : tabState.cursor,
        limit: STORAGE_LIST_PAGE_LIMIT,
      });
      const items = data.objects.map(buildItem).filter(item => item.key);
      tabState.items = reset ? items : tabState.items.concat(items);
      tabState.cursor = null;
      tabState.hasMore = false;
      hydrateMetadataInBackground(items, (_item, _metadata, changed) => {
        if (changed) scheduleRender();
      });
    } catch (err) {
      console.error('Failed to load previews', err);
      setError('previews', err?.message || 'Failed to load previews');
    } finally {
      setLoading('previews', false);
      scheduleRender();
    }
  }

  async function loadPrompts({ reset }) {
    const tabState = state.prompts;
    if (tabState.loading) return;
    if (!reset && !tabState.hasMore) return;
    setLoading('prompts', true);
    scheduleRender();

    try {
      if (reset) {
        tabState.items = [];
        tabState.identityCursor = null;
        tabState.identityPrefixes = [];
        tabState.identityItemCursors = new Map();
        tabState.fallbackMode = false;
        tabState.hasMore = false;
      }

      const targetDate = state.date;
      const seenKeys = new Set(tabState.items.map(item => item.key));
      const identityTasks = [];
      let sawRootObjects = false;
      let sawPrefixes = false;

      const appendObjects = (objects, filter) => {
        const items = buildItemsFromObjects(objects, { seenKeys, filter });
        appendPromptItems(tabState, items);
      };

      await fetchListPagesIncrementally({
        tab: 'prompts',
        date: targetDate,
        prefix: 'prompts/',
        cursor: reset ? null : tabState.identityCursor,
        limit: STORAGE_LIST_PAGE_LIMIT,
        delimiter: '/',
        onPage: (page) => {
          if (page.objects.length) {
            sawRootObjects = true;
            appendObjects(page.objects, item => item.key.includes(`/${targetDate}/`));
          }

          if (page.prefixes.length) {
            sawPrefixes = true;
            page.prefixes.forEach(identityPrefix => {
              identityTasks.push(promptListLimiter(async () => {
                try {
                  const list = await fetchAllListPages({
                    tab: 'prompts',
                    date: targetDate,
                    prefix: `${identityPrefix}${targetDate}/`,
                    limit: STORAGE_LIST_PAGE_LIMIT,
                  });
                  appendObjects(list.objects);
                } catch (err) {
                  console.warn('Failed to load prompt identity prefix', identityPrefix, err);
                }
              }));
            });
          }
        },
      });

      await Promise.all(identityTasks);

      tabState.fallbackMode = !sawPrefixes && sawRootObjects;
      tabState.identityCursor = null;
      tabState.identityPrefixes = [];
      tabState.identityItemCursors = new Map();
      tabState.hasMore = false;
    } catch (err) {
      console.error('Failed to load prompts', err);
      setError('prompts', err?.message || 'Failed to load prompts');
    } finally {
      setLoading('prompts', false);
      scheduleRender();
    }
  }

  function renderStorageResults() {
    const tabState = state[state.activeTab];
    // Recursion guarantees all items load at once, so 'Load More' 
    // is effectively hidden as hasMore will be exhausted if recursive loop completes successfully.
    elements.loadMoreBtn.disabled = tabState.loading || !tabState.hasMore;
    elements.loadMoreBtn.classList.toggle('hidden', !tabState.hasMore);

    elements.error.classList.add('hidden');
    elements.empty.classList.add('hidden');

    if (tabState.error) {
      elements.error.textContent = tabState.error;
      elements.error.classList.remove('hidden');
    }

    if (tabState.loading && tabState.items.length === 0) {
      renderSkeleton();
      return;
    }

    const filteredItems = filterItems(tabState.items);
    const visibleItems = state.activeTab === 'prompts'
      ? filteredItems.filter(item => isPromptImageKey(item.key))
      : filteredItems;
    if (!visibleItems.length && !tabState.loading && !tabState.error) {
      elements.empty.classList.remove('hidden');
    }

    if (state.activeTab === 'previews') {
      renderPreviewGroups(visibleItems);
    } else {
      renderPromptGroups(visibleItems);
    }
  }

  function renderSkeleton() {
    elements.results.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'storage-skeleton-grid';
    for (let i = 0; i < 8; i += 1) {
      const card = document.createElement('div');
      card.className = 'storage-skeleton';
      wrapper.appendChild(card);
    }
    elements.results.appendChild(wrapper);
  }

  function filterItems(items) {
    const query = state.filter.trim().toLowerCase();
    if (!query) return items;
    return items.filter(item => {
      const meta = item.metadata || {};
      const search = buildSearchText(item, meta);
      return search.includes(query);
    });
  }

  function renderPreviewGroups(items) {
    elements.results.innerHTML = '';
    if (!items.length) return;

    const dateSection = document.createElement('div');
    dateSection.className = 'storage-group';

    const header = document.createElement('div');
    header.className = 'storage-group-header';
    const title = document.createElement('div');
    title.className = 'storage-group-title';
    title.textContent = `Date: ${state.date}`;
    const subtitle = document.createElement('div');
    subtitle.className = 'storage-group-subtitle';
    subtitle.textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;
    header.appendChild(title);
    header.appendChild(subtitle);
    dateSection.appendChild(header);

    const byIdentity = new Map();
    items.forEach(item => {
      const meta = item.metadata || {};
      const identity = getPreviewIdentity(meta);
      if (!byIdentity.has(identity.identity)) {
        byIdentity.set(identity.identity, { identity, items: [] });
      }
      byIdentity.get(identity.identity).items.push(item);
    });

    byIdentity.forEach(group => {
      const groupCard = document.createElement('div');
      groupCard.className = 'storage-group';

      const groupHeader = document.createElement('div');
      groupHeader.className = 'storage-group-header';
      const groupTitle = document.createElement('div');
      groupTitle.className = 'storage-group-title';
      groupTitle.textContent = group.identity.displayName;
      const groupSubtitle = document.createElement('div');
      groupSubtitle.className = 'storage-group-subtitle';
      groupSubtitle.textContent = group.identity.subtitle || `${group.items.length} preview${group.items.length === 1 ? '' : 's'}`;
      groupHeader.appendChild(groupTitle);
      groupHeader.appendChild(groupSubtitle);

      const grid = document.createElement('div');
      grid.className = 'storage-thumbnail-grid';
      group.items.forEach(item => {
        grid.appendChild(createPreviewThumb(item));
      });

      groupCard.appendChild(groupHeader);
      groupCard.appendChild(grid);
      dateSection.appendChild(groupCard);
    });

    elements.results.appendChild(dateSection);
  }

  function renderPromptGroups(items) {
    elements.results.innerHTML = '';
    if (!items.length) return;

    const byIdentity = new Map();
    items.forEach(item => {
      const meta = item.metadata || {};
      const identity = getPromptIdentity({ ...meta, key: item.key });
      if (!byIdentity.has(identity.identity)) {
        byIdentity.set(identity.identity, { identity, items: [] });
      }
      byIdentity.get(identity.identity).items.push(item);
    });

    byIdentity.forEach(group => {
      const groupCard = document.createElement('div');
      groupCard.className = 'storage-group';

      const groupHeader = document.createElement('div');
      groupHeader.className = 'storage-group-header';
      const groupTitle = document.createElement('div');
      groupTitle.className = 'storage-group-title';
      groupTitle.textContent = group.identity.displayName;
      const groupSubtitle = document.createElement('div');
      groupSubtitle.className = 'storage-group-subtitle';
      groupSubtitle.textContent = `${group.items.length} prompt${group.items.length === 1 ? '' : 's'}`;
      groupHeader.appendChild(groupTitle);
      groupHeader.appendChild(groupSubtitle);

      const grid = document.createElement('div');
      grid.className = 'storage-prompt-grid';
      group.items.forEach(item => {
        grid.appendChild(createPromptCard(item));
      });

      groupCard.appendChild(groupHeader);
      groupCard.appendChild(grid);
      elements.results.appendChild(groupCard);
    });
  }

  function createPreviewThumb(item) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'storage-thumb';
    button.title = item.filename;
    const img = document.createElement('img');
    img.alt = item.filename;
    img.loading = 'lazy';
    img.decoding = 'async';
    const src = window.api.getStorageObjectUrl(item.key);
    img.dataset.src = src;
    setupImageObserver();
    imageObserver.observe(img);

    const label = document.createElement('span');
    label.textContent = item.filename;
    label.title = item.filename;

    button.appendChild(img);
    button.appendChild(label);
    button.addEventListener('click', () => openDetail(item));
    return button;
  }

  function createPromptCard(item) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'storage-prompt-card';
    button.title = item.filename;

    const img = document.createElement('img');
    img.alt = item.filename;
    img.loading = 'lazy';
    img.decoding = 'async';
    const src = window.api.getStorageObjectUrl(item.key);
    img.dataset.src = src;
    setupImageObserver();
    imageObserver.observe(img);

    const meta = item.metadata || {};
    const promptShort = pickMeta(meta, ['promptshort']) || 'Prompt';
    const style = pickMeta(meta, ['style']);
    const audience = pickMeta(meta, ['audience']);
    const createdAt = pickMeta(meta, ['createdat']) || item.lastModified;
    const createdLabel = formatTimestamp(createdAt);

    if (createdLabel) {
      const dateBadge = document.createElement('div');
      dateBadge.className = 'storage-prompt-date';
      dateBadge.textContent = createdLabel;
      button.appendChild(dateBadge);
    }

    const titleEl = document.createElement('h4');
    titleEl.textContent = promptShort;
    titleEl.title = promptShort; // Provide native tooltip

    const details = [];
    if (audience) details.push(`For: ${audience}`);
    if (style) details.push(`Style: ${style}`);
    const detailsEl = document.createElement('p');
    detailsEl.textContent = details.length ? details.join(' \u2022 ') : '\u00A0';

    button.appendChild(img);
    button.appendChild(titleEl);
    button.appendChild(detailsEl);
    button.addEventListener('click', () => openDetail(item));
    return button;
  }

  function renderDetailFields(item, meta, tab) {
    const title = tab === 'previews'
      ? getPreviewIdentity(meta).displayName
      : getPromptIdentity({ ...meta, key: item.key }).displayName;

    elements.detailTitle.textContent = title;
    elements.detailSubtitle.textContent = item.filename;
    elements.detailFields.innerHTML = '';

    const fieldValues = buildDetailFields(item, meta, tab);
    fieldValues.forEach(([label, value]) => {
      if (!value) return;
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      elements.detailFields.appendChild(dt);
      elements.detailFields.appendChild(dd);
    });
  }

  async function openDetail(item) {
    const tab = state.activeTab;
    const meta = item.metadata || {};
    state.detailItemKey = item.key;
    state.detailTab = tab;
    renderDetailFields(item, meta, tab);

    const src = window.api.getStorageObjectUrl(item.key);
    elements.detailImage.removeAttribute('src');
    // Load the detail image immediately (modal is visible, no lazy loading needed)
    elements.detailImage.src = src;
    elements.detailImage.classList.remove('loaded');
    elements.detailImage.onload = () => elements.detailImage.classList.add('loaded');

    elements.detailOverlay.classList.remove('hidden');
    elements.copyKey.onclick = () => copyText(item.key);
    elements.copyUrl.onclick = () => copyText(src);

    const hydratedMeta = await ensureDetailMetadata(item, tab);
    if (state.detailItemKey !== item.key || state.detailTab !== tab || elements.detailOverlay.classList.contains('hidden')) {
      return;
    }
    renderDetailFields(item, hydratedMeta || item.metadata || {}, tab);
  }

  /**
   * Build a customer label for prompt detail view.
   * @param {Object} meta
   * @returns {string}
   */
  function getPromptDetailCustomer(meta) {
    const normalized = normalizeMetadata(meta);
    return pickMeta(normalized, ['customername'])
      || pickMeta(normalized, ['customeremail'])
      || pickMeta(normalized, ['identitykey'])
      || 'Unknown';
  }

  function buildDetailFields(item, meta, tab) {
    const normalized = normalizeMetadata(meta);
    const createdAt = pickMeta(normalized, ['createdat']) || item.lastModified;
    const fields = [];

    if (tab === 'previews') {
      fields.push(
        ['Object Key', item.key],
        ['Created', formatTimestamp(createdAt)],
      );
      fields.push(
        ['Design Ref', pickMeta(normalized, ['designref'])],
        ['Product Handle', pickMeta(normalized, ['producthandle'])],
        ['Product Title', pickMeta(normalized, ['producttitle'])],
        ['Color', pickMeta(normalized, ['color'])],
        ['Side', pickMeta(normalized, ['side'])],
        ['Role', pickMeta(normalized, ['role'])],
      );
    } else {
      fields.push(
        ['Customer', getPromptDetailCustomer(normalized)],
        ['Style', pickMeta(normalized, ['style'])],
        ['Prompt', pickMeta(normalized, ['promptshort'])],
        ['Created', formatTimestamp(createdAt)],
        ['Object Key', item.key],
      );
    }

    return fields;
  }

  function copyText(text) {
    if (!text) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }

  function closeDetail() {
    state.detailItemKey = null;
    state.detailTab = null;
    elements.detailOverlay.classList.add('hidden');
    elements.detailImage.removeAttribute('src');
  }

  function initStorageBrowser() {
    elements.dateInput = document.getElementById('storage-date-input');
    elements.recentDates = document.getElementById('storage-recent-dates');
    elements.filterInput = document.getElementById('storage-filter-input');
    elements.results = document.getElementById('storage-results');
    elements.error = document.getElementById('storage-error');
    elements.empty = document.getElementById('storage-empty');
    elements.loadMoreBtn = document.getElementById('storage-load-more');
    elements.detailOverlay = document.getElementById('storage-detail-overlay');
    elements.detailClose = document.getElementById('storage-detail-close');
    elements.detailTitle = document.getElementById('storage-detail-title');
    elements.detailSubtitle = document.getElementById('storage-detail-subtitle');
    elements.detailFields = document.getElementById('storage-detail-fields');
    elements.detailImage = document.getElementById('storage-detail-image');
    elements.copyKey = document.getElementById('storage-copy-key');
    elements.copyUrl = document.getElementById('storage-copy-url');
    elements.storageView = document.getElementById('storage-view');
    elements.ordersView = document.getElementById('orders-view');

    const recentDates = getRecentDates();
    elements.recentDates.innerHTML = '';
    recentDates.forEach(date => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'storage-recent-date';
      button.dataset.date = date;
      button.textContent = date;
      button.addEventListener('click', () => setDate(date));
      elements.recentDates.appendChild(button);
    });

    const today = recentDates[0];
    state.date = today;
    elements.dateInput.value = today;

    elements.dateInput.addEventListener('change', (event) => {
      if (event.target.value) setDate(event.target.value);
    });

    elements.filterInput.addEventListener('input', (event) => {
      state.filter = event.target.value || '';
      renderStorageResults();
    });

    document.querySelectorAll('.storage-tab').forEach(btn => {
      btn.addEventListener('click', () => setActiveTab(btn.dataset.storageTab));
    });

    document.querySelectorAll('.app-nav-tab').forEach(btn => {
      btn.addEventListener('click', () => setActiveView(btn.dataset.view));
    });

    elements.loadMoreBtn.addEventListener('click', () => loadActiveTab({ reset: false }));

    elements.detailClose.addEventListener('click', closeDetail);
    elements.detailOverlay.addEventListener('click', (event) => {
      if (event.target === elements.detailOverlay) closeDetail();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeDetail();
    });

    setActiveTab('previews');
    setActiveView(document.body.dataset.activeView || 'orders');
  }

  document.addEventListener('DOMContentLoaded', initStorageBrowser);
})();

