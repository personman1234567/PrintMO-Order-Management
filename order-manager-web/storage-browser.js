// storage-browser.js
(() => {
  const STORAGE_TABS = ['previews', 'prompts'];
  const RECENT_DAYS = 7;
  const PREVIEW_PAGE_LIMIT = 150;
  const PROMPT_IDENTITY_LIMIT = 40;
  const PROMPT_OBJECT_LIMIT = 80;
  const PROMPT_TARGET_COUNT = 60;
  const META_CONCURRENCY = 4;
  const IMAGE_CONCURRENCY = 6;
  const PROMPT_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif']);

  const state = {
    activeTab: 'previews',
    date: '',
    filter: '',
    lastOrdersTab: 'pipeline',
    needsInitialLoad: true,
    listCache: new Map(),
    metadataCache: new Map(),
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
  const imageLimiter = createLimiter(IMAGE_CONCURRENCY);
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

  function buildItem(obj) {
    const key = obj?.key || obj?.name || obj?.objectKey || obj?.Key || '';
    const filename = key.split('/').pop() || key;
    const meta = obj?.customMetadata || obj?.metadata || obj?.custom_metadata || null;
    const metadata = meta ? normalizeMetadata(meta) : null;
    if (metadata) {
      metadata.key = key;
      state.metadataCache.set(key, metadata);
    }
    return {
      key,
      filename,
      metadata,
      lastModified: obj?.uploaded || obj?.lastModified || obj?.mtime || obj?.modified || null,
    };
  }

  async function hydrateMetadata(items) {
    const missing = items.filter(item => item.key && !item.metadata);
    if (!missing.length) return;

    await Promise.all(missing.map(item => metadataLimiter(async () => {
      if (state.metadataCache.has(item.key)) {
        item.metadata = state.metadataCache.get(item.key);
        return;
      }
      try {
        const data = await window.api.headStorageObject(item.key);
        const meta = data?.customMetadata || data?.metadata || data?.custom_metadata || {};
        const normalized = normalizeMetadata(meta);
        normalized.key = item.key;
        state.metadataCache.set(item.key, normalized);
        item.metadata = normalized;
      } catch (err) {
        console.warn('Failed to load metadata', item.key, err);
      }
    })));
  }

  /**
   * Apply JSON metadata onto matching prompt images when the image lacks it.
   * @param {Array<{key: string, metadata?: Object}>} items
   */
  function mergePromptMetadata(items) {
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
        item.metadata = jsonMetaByBase.get(baseKey);
      }
    });
  }

  function setupImageObserver() {
    if (imageObserver) return;
    if (!('IntersectionObserver' in window)) {
      imageObserver = {
        observe: (img) => {
          const src = img.dataset.src;
          if (!src) return;
          imageLimiter(() => loadImage(img, src));
        },
      };
      return;
    }
    imageObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const img = entry.target;
        const src = img.dataset.src;
        if (!src) return;
        imageObserver.unobserve(img);
        imageLimiter(() => loadImage(img, src));
      });
    }, { rootMargin: '200px' });
  }

  function loadImage(img, src) {
    return new Promise((resolve, reject) => {
      const loader = new Image();
      loader.onload = () => {
        img.src = src;
        img.classList.add('loaded');
        resolve();
      };
      loader.onerror = () => reject(new Error('Image failed'));
      loader.src = src;
    });
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
    setLoading('previews', true);
    scheduleRender();

    try {
      if (reset) {
        tabState.items = [];
        tabState.cursor = null;
      }
      const prefix = `previews/${state.date}/`;
      const data = await fetchList({
        tab: 'previews',
        date: state.date,
        prefix,
        cursor: reset ? null : tabState.cursor,
        limit: PREVIEW_PAGE_LIMIT,
      });
      const items = data.objects.map(buildItem).filter(item => item.key);
      tabState.items = reset ? items : tabState.items.concat(items);
      tabState.cursor = data.cursor;
      tabState.hasMore = data.hasMore;
      await hydrateMetadata(items);
    } catch (err) {
      console.error('Failed to load previews', err);
      setError('previews', err?.message || 'Failed to load previews');
    } finally {
      setLoading('previews', false);
      scheduleRender();
    }
  }

  async function loadPromptIdentityPrefixes(cursor) {
    const data = await fetchList({
      tab: 'prompts',
      date: state.date,
      prefix: 'prompts/',
      cursor,
      limit: PROMPT_IDENTITY_LIMIT,
      delimiter: '/',
    });
    return data;
  }

  async function loadPromptIdentityItems(identityPrefix, cursor) {
    const prefix = `${identityPrefix}${state.date}/`;
    const data = await fetchList({
      tab: 'prompts',
      date: state.date,
      prefix,
      cursor,
      limit: PROMPT_OBJECT_LIMIT,
    });
    return data;
  }

  async function loadPrompts({ reset }) {
    const tabState = state.prompts;
    if (tabState.loading) return;
    setLoading('prompts', true);
    scheduleRender();

    try {
      if (reset) {
        tabState.items = [];
        tabState.identityCursor = null;
        tabState.identityPrefixes = [];
        tabState.identityItemCursors = new Map();
        tabState.fallbackMode = false;
      }

      if (tabState.fallbackMode) {
        const list = await fetchList({
          tab: 'prompts',
          date: state.date,
          prefix: 'prompts/',
          cursor: reset ? null : tabState.identityCursor,
          limit: PROMPT_OBJECT_LIMIT,
        });
        const items = list.objects
          .map(buildItem)
          .filter(item => item.key && item.key.includes(`/${state.date}/`));
        tabState.items = reset ? items : tabState.items.concat(items);
        tabState.identityCursor = list.cursor;
        tabState.hasMore = list.hasMore;
        await hydrateMetadata(items);
        mergePromptMetadata(tabState.items);
        return;
      }

      let safety = 0;
      while (tabState.items.length < PROMPT_TARGET_COUNT && safety < 20) {
        safety += 1;
        if (!tabState.identityPrefixes.length) {
          if (tabState.identityCursor === null || tabState.hasMore !== false) {
            const list = await loadPromptIdentityPrefixes(tabState.identityCursor);
            if (!list.prefixes.length && list.objects.length) {
              tabState.fallbackMode = true;
              tabState.identityCursor = list.cursor;
              tabState.hasMore = list.hasMore;
              const items = list.objects
                .map(buildItem)
                .filter(item => item.key && item.key.includes(`/${state.date}/`));
              tabState.items = tabState.items.concat(items);
              await hydrateMetadata(items);
              mergePromptMetadata(tabState.items);
              return;
            }
            tabState.identityCursor = list.cursor;
            tabState.hasMore = list.hasMore;
            tabState.identityPrefixes = list.prefixes.slice();
          }
        }

        const identityPrefix = tabState.identityPrefixes.shift();
        if (!identityPrefix) break;

        const identityCursor = tabState.identityItemCursors.get(identityPrefix) || null;
        const list = await loadPromptIdentityItems(identityPrefix, identityCursor);
        const items = list.objects.map(buildItem).filter(item => item.key);
        tabState.items = tabState.items.concat(items);
        if (list.hasMore) {
          tabState.identityItemCursors.set(identityPrefix, list.cursor);
        } else {
          tabState.identityItemCursors.delete(identityPrefix);
        }
        await hydrateMetadata(items);
        mergePromptMetadata(tabState.items);
      }

      tabState.hasMore = Boolean(tabState.identityPrefixes.length || tabState.identityCursor || tabState.identityItemCursors.size);
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

    button.appendChild(img);
    button.appendChild(label);
    button.addEventListener('click', () => openDetail(item));
    return button;
  }

  function createPromptCard(item) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'storage-prompt-card';

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
      const time = document.createElement('time');
      time.className = 'storage-prompt-date';
      time.textContent = createdLabel;
      button.appendChild(time);
    }

    const title = document.createElement('h4');
    title.textContent = promptShort;

    const detail = document.createElement('p');
    detail.textContent = [style, audience].filter(Boolean).join(' • ');

    button.appendChild(img);
    button.appendChild(title);
    button.appendChild(detail);
    button.addEventListener('click', () => openDetail(item));
    return button;
  }

  function openDetail(item) {
    const meta = item.metadata || {};
    const tab = state.activeTab;
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

    const src = window.api.getStorageObjectUrl(item.key);
    elements.detailImage.removeAttribute('src');
    elements.detailImage.dataset.src = src;
    imageLimiter(() => loadImage(elements.detailImage, src));

    elements.detailOverlay.classList.remove('hidden');
    elements.copyKey.onclick = () => copyText(item.key);
    elements.copyUrl.onclick = () => copyText(src);
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
