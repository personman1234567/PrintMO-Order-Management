// storage-browser.js
(() => {
  const STORAGE_TABS = ['previews', 'prompts'];
  const STORAGE_LIST_PAGE_LIMIT = 1000;
  const META_CONCURRENCY = 4;
  const PROMPT_LIST_CONCURRENCY = 24;
  const VIRTUAL_GROUP_CHUNK_SIZE = 18;
  const DATE_VIEW_MODE = 'date';
  const ALL_CUSTOMERS_VIEW_MODE = 'all';
  const PROMPT_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif']);
  const RANGE_PRESETS = [
    { id: 'today', label: 'Today', days: 1 },
    { id: 'last3', label: 'Last 3 Days', days: 3 },
    { id: 'last7', label: 'Last 7 Days', days: 7 },
  ];

  const state = {
    activeTab: 'previews',
    viewMode: DATE_VIEW_MODE,
    dateRange: {
      start: '',
      end: '',
    },
    rangePreset: RANGE_PRESETS[0].id,
    filter: '',
    lastOrdersTab: 'pipeline',
    needsInitialLoad: true,
    listCache: new Map(),
    metadataCache: new Map(),
    metadataRequests: new Map(),
    detailItemKey: null,
    detailTab: null,
    virtualResults: {
      signature: '',
      renderedCount: 0,
      groups: [],
    },
    previews: {
      items: [],
      loading: false,
      error: null,
      sessionId: 0,
    },
    prompts: {
      items: [],
      loading: false,
      error: null,
      fallbackMode: false,
      allCustomersCursor: null,
      allCustomerGroups: [],
      allCustomerRequests: new Map(),
      sessionId: 0,
    },
  };

  const elements = {};

  const metadataLimiter = createLimiter(META_CONCURRENCY);
  const promptListLimiter = createLimiter(PROMPT_LIST_CONCURRENCY);
  let imageObserver = null;
  let renderTimer = null;
  let renderSentinelObserver = null;
  let customerGroupObserver = null;

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

  /**
   * Build a stable local-date object from a YYYY-MM-DD input string.
   * Midday avoids DST edge cases that can happen around midnight parsing.
   * @param {string} value
   * @returns {Date|null}
   */
  function createDateFromInput(value) {
    if (!value) return null;
    const parts = String(value).split('-').map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
    const [year, month, day] = parts;
    const date = new Date(year, month - 1, day, 12, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  /**
   * Normalize a date range so both edges are present and ordered oldest to newest.
   * @param {string} start
   * @param {string} end
   * @returns {{start: string, end: string}}
   */
  function normalizeDateRange(start, end) {
    const parsedStart = createDateFromInput(start);
    const parsedEnd = createDateFromInput(end);

    if (!parsedStart && !parsedEnd) {
      return { start: '', end: '' };
    }

    const safeStart = parsedStart || parsedEnd;
    const safeEnd = parsedEnd || parsedStart;
    if (!safeStart || !safeEnd) {
      return { start: '', end: '' };
    }

    if (safeStart.getTime() <= safeEnd.getTime()) {
      return { start: formatDate(safeStart), end: formatDate(safeEnd) };
    }

    return { start: formatDate(safeEnd), end: formatDate(safeStart) };
  }

  /**
   * Build a preset range ending today.
   * @param {number} days
   * @returns {{start: string, end: string}}
   */
  function buildPresetDateRange(days) {
    const end = new Date();
    const start = new Date(end);
    start.setDate(end.getDate() - (days - 1));
    return normalizeDateRange(formatDate(start), formatDate(end));
  }

  /**
   * Detect whether the current range matches a known preset.
   * @param {{start: string, end: string}} range
   * @returns {string}
   */
  function detectRangePreset(range) {
    const normalized = normalizeDateRange(range.start, range.end);
    const match = RANGE_PRESETS.find((preset) => {
      const presetRange = buildPresetDateRange(preset.days);
      return presetRange.start === normalized.start && presetRange.end === normalized.end;
    });
    return match?.id || 'custom';
  }

  /**
   * Expand an inclusive date range into individual YYYY-MM-DD strings.
   * Results are returned newest first so downstream rendering stays naturally descending.
   * @param {string} start
   * @param {string} end
   * @returns {string[]}
   */
  function getDateRangeArray(start, end) {
    const normalized = normalizeDateRange(start, end);
    if (!normalized.start || !normalized.end) return [];

    const cursor = createDateFromInput(normalized.end);
    const floor = createDateFromInput(normalized.start);
    if (!cursor || !floor) return [];

    const dates = [];
    while (cursor.getTime() >= floor.getTime()) {
      dates.push(formatDate(cursor));
      cursor.setDate(cursor.getDate() - 1);
    }
    return dates;
  }

  /**
   * Safely decode display strings stored in path segments.
   * @param {string} value
   * @returns {string}
   */
  function safeDecode(value) {
    if (!value) return '';
    try {
      return decodeURIComponent(value);
    } catch (_) {
      return value;
    }
  }

  function getActiveRangeKey() {
    const { start, end } = state.dateRange;
    if (!start || !end) return 'unset';
    return `${start}:${end}`;
  }

  function getCacheKey({ tab, mode, rangeKey, prefix, cursor, delimiter }) {
    return [
      tab,
      mode || DATE_VIEW_MODE,
      rangeKey || 'unset',
      prefix || 'root',
      cursor || 'start',
      delimiter || 'none',
    ].join('|');
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

  /**
   * Extract a date segment from a storage key when the path embeds one.
   * @param {string} key
   * @returns {string}
   */
  function extractDateFromStorageKey(key) {
    const match = /\/(\d{4}-\d{2}-\d{2})(?:\/|$)/.exec(key || '');
    return match ? match[1] : '';
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
    return Object.keys(meta).some((key) => key !== 'key');
  }

  /**
   * Resolve the most useful timestamp available for sorting.
   * @param {{key?: string, metadata?: Object, lastModified?: string|null}} item
   * @returns {number}
   */
  function getItemSortTimestamp(item) {
    const metadata = normalizeMetadata(item?.metadata || {});
    const createdAt = pickMeta(metadata, ['createdat']);
    if (createdAt) {
      const parsedCreated = new Date(createdAt);
      if (!Number.isNaN(parsedCreated.getTime())) return parsedCreated.getTime();
    }

    if (item?.lastModified) {
      const parsedModified = new Date(item.lastModified);
      if (!Number.isNaN(parsedModified.getTime())) return parsedModified.getTime();
    }

    const keyDate = extractDateFromStorageKey(item?.key || '');
    const parsedDate = createDateFromInput(keyDate);
    return parsedDate ? parsedDate.getTime() : 0;
  }

  /**
   * Sort items from newest to oldest using metadata, upload times, or date path fallbacks.
   * @param {Array<{key: string, metadata?: Object, lastModified?: string|null}>} items
   * @returns {Array<{key: string, metadata?: Object, lastModified?: string|null}>}
   */
  function sortItemsNewestFirst(items) {
    return items.sort((left, right) => {
      const diff = getItemSortTimestamp(right) - getItemSortTimestamp(left);
      if (diff !== 0) return diff;
      return right.key.localeCompare(left.key);
    });
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

  function disconnectRenderSentinelObserver() {
    if (renderSentinelObserver) {
      renderSentinelObserver.disconnect();
    }
  }

  function disconnectCustomerGroupObserver() {
    if (customerGroupObserver) {
      customerGroupObserver.disconnect();
    }
  }

  function invalidateVirtualResults() {
    state.virtualResults.signature = '';
    state.virtualResults.renderedCount = 0;
    state.virtualResults.groups = [];
    disconnectRenderSentinelObserver();
    disconnectCustomerGroupObserver();
  }

  function hasActiveStorageData() {
    if (state.activeTab === 'previews') {
      return state.previews.items.length > 0;
    }

    if (state.viewMode === ALL_CUSTOMERS_VIEW_MODE && !state.prompts.fallbackMode) {
      return state.prompts.allCustomerGroups.length > 0 || state.prompts.items.length > 0;
    }

    return state.prompts.items.length > 0;
  }

  function setActiveView(view) {
    const nextView = view === 'storage' ? 'storage' : 'orders';
    if (nextView === 'storage') {
      const currentTab = document.body.dataset.activeTab || 'pipeline';
      if (currentTab && currentTab !== 'storage') state.lastOrdersTab = currentTab;
    }

    document.body.dataset.activeView = nextView;
    document.querySelectorAll('.app-nav-tab').forEach((btn) => {
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
      if (state.needsInitialLoad || !hasActiveStorageData()) {
        state.needsInitialLoad = false;
        loadActiveTab({ reset: true });
      } else {
        renderStorageResults();
      }
    } else if (typeof window.setActiveMobileTab === 'function' && window.matchMedia('(max-width: 900px)').matches) {
      window.setActiveMobileTab(state.lastOrdersTab || 'pipeline', { scrollTop: false });
    }
  }

  async function fetchList({ tab, mode, rangeKey, prefix, cursor, limit, delimiter }) {
    const cacheKey = getCacheKey({ tab, mode, rangeKey, prefix, cursor, delimiter });
    if (state.listCache.has(cacheKey)) return state.listCache.get(cacheKey);

    const data = await window.api.listStorageObjects({ prefix, cursor, limit, delimiter });
    const normalized = normalizeListResponse(data || {});
    state.listCache.set(cacheKey, normalized);
    return normalized;
  }

  /**
   * Exhaust a paginated list endpoint and return all collected objects and prefixes.
   * @param {{tab: string, mode: string, rangeKey: string, prefix: string, cursor?: string|null, limit?: number, delimiter?: string}} options
   * @returns {Promise<{objects: Array<Object>, prefixes: string[]}>}
   */
  async function fetchAllListPages({
    tab,
    mode,
    rangeKey,
    prefix,
    cursor = null,
    limit = STORAGE_LIST_PAGE_LIMIT,
    delimiter,
  }) {
    const objects = [];
    const prefixes = [];
    const seenCursors = new Set();
    let nextCursor = cursor;

    while (true) {
      const page = await fetchList({
        tab,
        mode,
        rangeKey,
        prefix,
        cursor: nextCursor,
        limit,
        delimiter,
      });
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
      storageDate: extractDateFromStorageKey(key),
    };
  }

  function buildItemsFromObjects(objects, { seenKeys, filter } = {}) {
    const items = [];
    objects.forEach((obj) => {
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
    const pending = items.filter((item) => item?.key && !item.metadataLoaded).map(async (item) => {
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
    return state.prompts.items.find((candidate) => candidate !== item
      && getFileExtension(candidate.key) === 'json'
      && getPromptBaseKey(candidate.key) === baseKey) || null;
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
   * @returns {boolean}
   */
  function mergePromptMetadata(items) {
    let changed = false;
    const jsonMetaByBase = new Map();

    items.forEach((item) => {
      if (getFileExtension(item.key) !== 'json') return;
      if (!hasMeaningfulMetadata(item.metadata)) return;
      jsonMetaByBase.set(getPromptBaseKey(item.key), item.metadata);
    });

    items.forEach((item) => {
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
        unobserve: () => {},
      };
      return;
    }

    imageObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const img = entry.target;
        const src = img.dataset.src;
        if (src && !img.src) {
          img.src = src;
          img.onload = () => img.classList.add('loaded');
        }
        imageObserver.unobserve(img);
      });
    }, { rootMargin: '400px' });
  }

  function setupRenderSentinelObserver() {
    if (renderSentinelObserver || !('IntersectionObserver' in window)) return;
    renderSentinelObserver = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      disconnectRenderSentinelObserver();
      renderNextGroupChunk();
    }, { rootMargin: '700px 0px' });
  }

  function setupCustomerGroupObserver() {
    if (customerGroupObserver || !('IntersectionObserver' in window)) return;
    customerGroupObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const identityPrefix = entry.target.dataset.identityPrefix;
        if (!identityPrefix) return;
        customerGroupObserver.unobserve(entry.target);
        ensureAllCustomerGroupLoaded(identityPrefix);
      });
    }, { rootMargin: '500px 0px' });
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

  function isDateRangeValid() {
    return Boolean(state.dateRange.start && state.dateRange.end);
  }

  function updateRangePresetButtons() {
    elements.rangePresetButtons.forEach((button) => {
      const isActive = button.dataset.rangePreset === state.rangePreset;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  function updateViewModeControls() {
    const allowAllCustomers = state.activeTab === 'prompts';
    elements.viewModeButtons.forEach((button) => {
      const mode = button.dataset.storageViewMode;
      const isActive = state.viewMode === mode;
      const disabled = mode === ALL_CUSTOMERS_VIEW_MODE && !allowAllCustomers;
      button.disabled = disabled;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    const disableDates = allowAllCustomers && state.viewMode === ALL_CUSTOMERS_VIEW_MODE;
    elements.dateControls.classList.toggle('is-disabled', disableDates);
    elements.dateControls.querySelectorAll('input, button').forEach((control) => {
      control.disabled = disableDates;
    });

    if (!allowAllCustomers) {
      elements.viewModeHint.textContent = 'Designer Studio previews are organized by date, so this tab stays in date-range mode.';
    } else if (state.viewMode === ALL_CUSTOMERS_VIEW_MODE) {
      elements.viewModeHint.textContent = 'Customer folders are listed first, then each customer loads as its group scrolls into view.';
    } else {
      elements.viewModeHint.textContent = 'Search and browse prompts across the selected date range.';
    }
  }

  /**
   * Apply a new date range, normalize it, update controls, and optionally reload data.
   * @param {{start: string, end: string}} nextRange
   * @param {{preset?: string, skipLoad?: boolean}} options
   */
  function setDateRange(nextRange, { preset, skipLoad = false } = {}) {
    const normalized = normalizeDateRange(nextRange.start, nextRange.end);
    if (!normalized.start || !normalized.end) return;

    const changed = state.dateRange.start !== normalized.start || state.dateRange.end !== normalized.end;
    state.dateRange = normalized;
    state.rangePreset = preset || detectRangePreset(normalized);

    elements.startDateInput.value = normalized.start;
    elements.endDateInput.value = normalized.end;
    updateRangePresetButtons();

    if (!skipLoad && changed && document.body.dataset.activeView === 'storage') {
      loadActiveTab({ reset: true });
    } else if (changed) {
      state.needsInitialLoad = true;
    }
  }

  function setViewMode(mode, { skipLoad = false } = {}) {
    const requestedMode = mode === ALL_CUSTOMERS_VIEW_MODE ? ALL_CUSTOMERS_VIEW_MODE : DATE_VIEW_MODE;
    const nextMode = state.activeTab === 'prompts' ? requestedMode : DATE_VIEW_MODE;
    const changed = state.viewMode !== nextMode;

    state.viewMode = nextMode;
    updateViewModeControls();

    if (!changed) return;

    invalidateVirtualResults();
    if (!skipLoad && document.body.dataset.activeView === 'storage') {
      loadActiveTab({ reset: true });
    } else {
      state.needsInitialLoad = true;
    }
  }

  function setActiveTab(tab) {
    const next = STORAGE_TABS.includes(tab) ? tab : STORAGE_TABS[0];
    state.activeTab = next;

    if (next !== 'prompts' && state.viewMode === ALL_CUSTOMERS_VIEW_MODE) {
      state.viewMode = DATE_VIEW_MODE;
    }

    updateViewModeControls();
    document.querySelectorAll('.storage-tab').forEach((btn) => {
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
    if (state.activeTab === 'previews' || state.viewMode === DATE_VIEW_MODE) {
      if (!isDateRangeValid()) return;
    }

    invalidateVirtualResults();

    if (state.activeTab === 'previews') {
      await loadPreviews({ reset });
    } else {
      await loadPrompts({ reset });
    }
  }

  /**
   * Hydrate metadata for newly loaded preview items and trigger lightweight rerenders as data arrives.
   * @param {Array<Object>} items
   */
  function hydratePreviewItems(items) {
    hydrateMetadataInBackground(items, (_item, _metadata, changed) => {
      if (changed) scheduleRender();
    });
  }

  /**
   * Hydrate prompt metadata, including JSON sidecar merges, without blocking the initial render.
   * @param {Array<Object>} items
   */
  function hydratePromptItems(items) {
    if (!items.length) return;
    mergePromptMetadata(state.prompts.items);
    hydrateMetadataInBackground(items, (_item, _metadata, changed) => {
      const merged = mergePromptMetadata(state.prompts.items);
      if (changed || merged) scheduleRender();
    });
  }

  async function loadPreviews({ reset }) {
    const tabState = state.previews;
    const sessionId = reset ? tabState.sessionId + 1 : tabState.sessionId;
    if (reset) {
      tabState.sessionId = sessionId;
    }

    setLoading('previews', true);
    scheduleRender();

    try {
      const dates = getDateRangeArray(state.dateRange.start, state.dateRange.end);
      const seenKeys = new Set();
      const collectedObjects = [];

      if (reset) {
        tabState.items = [];
      }

      for (const date of dates) {
        const list = await fetchAllListPages({
          tab: 'previews',
          mode: DATE_VIEW_MODE,
          rangeKey: getActiveRangeKey(),
          prefix: `previews/${date}/`,
          limit: STORAGE_LIST_PAGE_LIMIT,
        });
        if (tabState.sessionId !== sessionId) return;
        collectedObjects.push(...list.objects);
      }

      if (tabState.sessionId !== sessionId) return;

      const items = sortItemsNewestFirst(buildItemsFromObjects(collectedObjects, { seenKeys }));
      tabState.items = items;
      hydratePreviewItems(items);
    } catch (err) {
      if (tabState.sessionId !== sessionId) return;
      console.error('Failed to load previews', err);
      setError('previews', err?.message || 'Failed to load previews');
    } finally {
      if (tabState.sessionId === sessionId) {
        setLoading('previews', false);
        scheduleRender();
      }
    }
  }

  /**
   * Build lazy-load prompt customer groups from root prefixes.
   * @param {string[]} prefixes
   * @returns {Array<Object>}
   */
  function buildAllCustomerGroups(prefixes) {
    const uniquePrefixes = Array.from(new Set(prefixes || [])).filter(Boolean);
    return uniquePrefixes
      .map((identityPrefix) => {
        const identityKey = identityPrefix.replace(/^prompts\//, '').replace(/\/$/, '');
        const displayName = safeDecode(identityKey) || 'Unknown';
        return {
          key: `all-customer:${identityKey}`,
          identityPrefix,
          identityKey,
          displayName,
          items: [],
          loading: false,
          loaded: false,
          error: null,
        };
      })
      .sort((left, right) => left.displayName.localeCompare(right.displayName))
      .map((group, index) => ({ ...group, sortIndex: index }));
  }

  async function loadPrompts({ reset }) {
    const tabState = state.prompts;
    const sessionId = reset ? tabState.sessionId + 1 : tabState.sessionId;
    if (reset) {
      tabState.sessionId = sessionId;
    }

    setLoading('prompts', true);
    scheduleRender();

    try {
      if (reset) {
        tabState.items = [];
        tabState.fallbackMode = false;
        tabState.allCustomersCursor = null;
        tabState.allCustomerGroups = [];
        tabState.allCustomerRequests = new Map();
      }

      if (state.viewMode === ALL_CUSTOMERS_VIEW_MODE) {
        const rootList = await fetchAllListPages({
          tab: 'prompts',
          mode: ALL_CUSTOMERS_VIEW_MODE,
          rangeKey: 'all-customers',
          prefix: 'prompts/',
          limit: STORAGE_LIST_PAGE_LIMIT,
          delimiter: '/',
        });
        if (tabState.sessionId !== sessionId) return;

        if (rootList.prefixes.length) {
          tabState.allCustomerGroups = buildAllCustomerGroups(rootList.prefixes);
          tabState.fallbackMode = false;
        } else {
          const seenKeys = new Set();
          const items = sortItemsNewestFirst(buildItemsFromObjects(rootList.objects, { seenKeys }));
          tabState.items = items;
          tabState.fallbackMode = true;
          hydratePromptItems(items);
        }
        return;
      }

      const dates = getDateRangeArray(state.dateRange.start, state.dateRange.end);
      const rootList = await fetchAllListPages({
        tab: 'prompts',
        mode: DATE_VIEW_MODE,
        rangeKey: getActiveRangeKey(),
        prefix: 'prompts/',
        limit: STORAGE_LIST_PAGE_LIMIT,
        delimiter: '/',
      });
      if (tabState.sessionId !== sessionId) return;

      const seenKeys = new Set();
      const collectedObjects = [];
      const identityPrefixes = Array.from(new Set(rootList.prefixes || []));
      const dateSet = new Set(dates);

      if (rootList.objects.length) {
        collectedObjects.push(...rootList.objects.filter((obj) => {
          const itemDate = extractDateFromStorageKey(obj?.key || '');
          return !itemDate || dateSet.has(itemDate);
        }));
      }

      for (const date of dates) {
        const perDateResults = await Promise.all(identityPrefixes.map((identityPrefix) => promptListLimiter(async () => {
          try {
            const list = await fetchAllListPages({
              tab: 'prompts',
              mode: DATE_VIEW_MODE,
              rangeKey: getActiveRangeKey(),
              prefix: `${identityPrefix}${date}/`,
              limit: STORAGE_LIST_PAGE_LIMIT,
            });
            return list.objects;
          } catch (err) {
            console.warn('Failed to load prompt identity/date prefix', identityPrefix, date, err);
            return [];
          }
        })));

        if (tabState.sessionId !== sessionId) return;
        perDateResults.forEach((objects) => {
          collectedObjects.push(...objects);
        });
      }

      if (tabState.sessionId !== sessionId) return;

      const items = sortItemsNewestFirst(buildItemsFromObjects(collectedObjects, {
        seenKeys,
        filter: (item) => {
          const itemDate = item.storageDate || extractDateFromStorageKey(item.key);
          return !itemDate || dateSet.has(itemDate);
        },
      }));
      tabState.items = items;
      tabState.fallbackMode = !identityPrefixes.length && rootList.objects.length > 0;
      hydratePromptItems(items);
    } catch (err) {
      if (tabState.sessionId !== sessionId) return;
      console.error('Failed to load prompts', err);
      setError('prompts', err?.message || 'Failed to load prompts');
    } finally {
      if (tabState.sessionId === sessionId) {
        setLoading('prompts', false);
        scheduleRender();
      }
    }
  }

  /**
   * Load a single customer folder the first time its group scrolls near the viewport.
   * @param {string} identityPrefix
   * @returns {Promise<void>|undefined}
   */
  function ensureAllCustomerGroupLoaded(identityPrefix) {
    const tabState = state.prompts;
    const group = tabState.allCustomerGroups.find((candidate) => candidate.identityPrefix === identityPrefix);
    if (!group || group.loading || group.loaded) return undefined;
    if (tabState.allCustomerRequests.has(identityPrefix)) {
      return tabState.allCustomerRequests.get(identityPrefix);
    }

    const sessionId = tabState.sessionId;
    group.loading = true;
    group.error = null;
    scheduleRender();

    const request = promptListLimiter(async () => {
      try {
        const list = await fetchAllListPages({
          tab: 'prompts',
          mode: ALL_CUSTOMERS_VIEW_MODE,
          rangeKey: 'all-customers',
          prefix: identityPrefix,
          limit: STORAGE_LIST_PAGE_LIMIT,
        });
        if (tabState.sessionId !== sessionId) return;

        const seenKeys = new Set(tabState.items.map((item) => item.key));
        const items = sortItemsNewestFirst(buildItemsFromObjects(list.objects, { seenKeys }));
        group.items = items;
        group.loaded = true;
        group.loading = false;
        group.error = null;
        tabState.items = sortItemsNewestFirst(tabState.items.concat(items));
        hydratePromptItems(items);
      } catch (err) {
        if (tabState.sessionId !== sessionId) return;
        console.error('Failed to load all-customer prompt group', identityPrefix, err);
        group.loading = false;
        group.loaded = false;
        group.error = err?.message || 'Failed to load this customer';
      } finally {
        tabState.allCustomerRequests.delete(identityPrefix);
        scheduleRender();
      }
    });

    tabState.allCustomerRequests.set(identityPrefix, request);
    return request;
  }

  function renderNextGroupChunk() {
    const groups = state.virtualResults.groups;
    if (!groups.length) return;

    if (state.virtualResults.renderedCount >= groups.length) return;
    state.virtualResults.renderedCount = Math.min(
      state.virtualResults.renderedCount + VIRTUAL_GROUP_CHUNK_SIZE,
      groups.length,
    );
    renderStorageResults();
  }

  function updateLoadMoreButton(totalGroups) {
    const remaining = Math.max(totalGroups - state.virtualResults.renderedCount, 0);
    elements.loadMoreBtn.classList.toggle('hidden', remaining === 0);
    elements.loadMoreBtn.disabled = remaining === 0;
    elements.loadMoreBtn.textContent = remaining > 0
      ? `Show ${Math.min(remaining, VIRTUAL_GROUP_CHUNK_SIZE)} more groups`
      : 'Show more groups';
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
    updateLoadMoreButton(0);
  }

  function filterItems(items) {
    const query = state.filter.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => {
      const meta = item.metadata || {};
      const search = buildSearchText(item, meta);
      return search.includes(query);
    });
  }

  function buildRangeSubtitle() {
    const { start, end } = state.dateRange;
    if (!start || !end) return '';
    return start === end ? start : `${start} to ${end}`;
  }

  /**
   * Build preview group models keyed by date + identity so large ranges stay scannable.
   * @param {Array<Object>} items
   * @returns {Array<Object>}
   */
  function buildPreviewRenderGroups(items) {
    const groupsByKey = new Map();

    items.forEach((item) => {
      const meta = item.metadata || {};
      const identity = getPreviewIdentity(meta);
      const dateLabel = item.storageDate || state.dateRange.end || 'Unknown date';
      const groupKey = `${dateLabel}|${identity.identity}`;
      if (!groupsByKey.has(groupKey)) {
        groupsByKey.set(groupKey, {
          key: groupKey,
          title: identity.displayName,
          identitySubtitle: identity.subtitle,
          dateLabel,
          items: [],
        });
      }
      groupsByKey.get(groupKey).items.push(item);
    });

    return Array.from(groupsByKey.values())
      .map((group) => {
        sortItemsNewestFirst(group.items);
        const subtitleParts = [
          group.dateLabel,
          `${group.items.length} preview${group.items.length === 1 ? '' : 's'}`,
        ];
        if (group.identitySubtitle) subtitleParts.push(group.identitySubtitle);
        return {
          ...group,
          subtitle: subtitleParts.join(' • '),
          sortValue: createDateFromInput(group.dateLabel)?.getTime() || getItemSortTimestamp(group.items[0]),
        };
      })
      .sort((left, right) => {
        const diff = right.sortValue - left.sortValue;
        if (diff !== 0) return diff;
        return left.title.localeCompare(right.title);
      });
  }

  function summarizePromptDates(items) {
    const dates = Array.from(new Set(items.map((item) => item.storageDate || extractDateFromStorageKey(item.key)).filter(Boolean)))
      .sort();
    if (!dates.length) return buildRangeSubtitle();
    if (dates.length === 1) return dates[0];
    return `${dates[0]} to ${dates[dates.length - 1]}`;
  }

  /**
   * Build prompt group models for range-based browsing.
   * @param {Array<Object>} items
   * @returns {Array<Object>}
   */
  function buildPromptRenderGroups(items) {
    const groupsByKey = new Map();

    items.filter((item) => isPromptImageKey(item.key)).forEach((item) => {
      const meta = item.metadata || {};
      const identity = getPromptIdentity({ ...meta, key: item.key });
      if (!groupsByKey.has(identity.identity)) {
        groupsByKey.set(identity.identity, {
          key: `prompt:${identity.identity}`,
          title: identity.displayName,
          items: [],
        });
      }
      groupsByKey.get(identity.identity).items.push(item);
    });

    return Array.from(groupsByKey.values())
      .map((group) => {
        sortItemsNewestFirst(group.items);
        const latestTimestamp = getItemSortTimestamp(group.items[0]);
        return {
          ...group,
          subtitle: `${group.items.length} prompt${group.items.length === 1 ? '' : 's'} • ${summarizePromptDates(group.items)}`,
          sortValue: latestTimestamp,
          loaded: true,
          loading: false,
          error: null,
        };
      })
      .sort((left, right) => {
        const diff = right.sortValue - left.sortValue;
        if (diff !== 0) return diff;
        return left.title.localeCompare(right.title);
      });
  }

  function buildAllCustomerPromptGroups() {
    const query = state.filter.trim().toLowerCase();

    return state.prompts.allCustomerGroups.filter((group) => {
      if (!query) return true;
      const groupSearch = `${group.displayName} ${group.identityKey}`.toLowerCase();
      if (groupSearch.includes(query)) return true;
      if (!group.loaded) return false;
      return group.items.some((item) => buildSearchText(item, item.metadata || {}).includes(query));
    }).map((group) => {
      const visibleItems = group.loaded
        ? filterItems(group.items).filter((item) => isPromptImageKey(item.key))
        : [];
      const latestItem = group.loaded && group.items.length ? group.items[0] : null;
      let subtitle = 'Scroll to load prompts';
      if (group.loading) {
        subtitle = 'Loading prompts...';
      } else if (group.error) {
        subtitle = group.error;
      } else if (group.loaded) {
        subtitle = `${visibleItems.length} prompt${visibleItems.length === 1 ? '' : 's'}`;
        const latestLabel = latestItem ? formatTimestamp(pickMeta(normalizeMetadata(latestItem.metadata || {}), ['createdat']) || latestItem.lastModified || latestItem.storageDate) : '';
        if (latestLabel) subtitle += ` • Latest ${latestLabel}`;
      }

      return {
        key: group.key,
        title: group.displayName,
        subtitle,
        items: visibleItems,
        loading: group.loading,
        loaded: group.loaded,
        error: group.error,
        identityPrefix: group.identityPrefix,
        sortIndex: group.sortIndex,
      };
    }).sort((left, right) => left.sortIndex - right.sortIndex);
  }

  function buildRenderGroups() {
    if (state.activeTab === 'previews') {
      return buildPreviewRenderGroups(filterItems(state.previews.items));
    }

    if (state.viewMode === ALL_CUSTOMERS_VIEW_MODE && !state.prompts.fallbackMode) {
      return buildAllCustomerPromptGroups();
    }

    return buildPromptRenderGroups(filterItems(state.prompts.items));
  }

  function getEmptyStateMessage() {
    if (state.activeTab === 'previews') {
      return state.dateRange.start === state.dateRange.end
        ? `No previews found for ${state.dateRange.start} yet.`
        : `No previews found between ${state.dateRange.start} and ${state.dateRange.end}.`;
    }

    if (state.viewMode === ALL_CUSTOMERS_VIEW_MODE && !state.prompts.fallbackMode) {
      return state.filter
        ? 'No customer groups match the current filter.'
        : 'No customer prompt folders were found.';
    }

    return state.dateRange.start === state.dateRange.end
      ? `No prompts found for ${state.dateRange.start} yet.`
      : `No prompts found between ${state.dateRange.start} and ${state.dateRange.end}.`;
  }

  function getRenderSignature(groups) {
    const groupPart = groups.map((group) => [
      group.key,
      group.items?.length || 0,
      group.loading ? '1' : '0',
      group.loaded ? '1' : '0',
      group.error || '',
    ].join(':')).join('|');

    return [
      state.activeTab,
      state.viewMode,
      state.filter.trim().toLowerCase(),
      groupPart,
    ].join('||');
  }

  function createGroupShell(title, subtitle) {
    const card = document.createElement('div');
    card.className = 'storage-group';

    const header = document.createElement('div');
    header.className = 'storage-group-header';
    const groupTitle = document.createElement('div');
    groupTitle.className = 'storage-group-title';
    groupTitle.textContent = title;
    const groupSubtitle = document.createElement('div');
    groupSubtitle.className = 'storage-group-subtitle';
    groupSubtitle.textContent = subtitle;

    header.appendChild(groupTitle);
    header.appendChild(groupSubtitle);
    card.appendChild(header);

    return { card };
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
    img.dataset.src = window.api.getStorageObjectUrl(item.key);
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
    img.dataset.src = window.api.getStorageObjectUrl(item.key);
    setupImageObserver();
    imageObserver.observe(img);

    const meta = item.metadata || {};
    const promptShort = pickMeta(meta, ['promptshort']) || 'Prompt';
    const style = pickMeta(meta, ['style']);
    const audience = pickMeta(meta, ['audience']);
    const createdAt = pickMeta(meta, ['createdat']) || item.lastModified || item.storageDate;
    const createdLabel = formatTimestamp(createdAt);

    if (createdLabel) {
      const dateBadge = document.createElement('div');
      dateBadge.className = 'storage-prompt-date';
      dateBadge.textContent = createdLabel;
      button.appendChild(dateBadge);
    }

    const titleEl = document.createElement('h4');
    titleEl.textContent = promptShort;
    titleEl.title = promptShort;

    const details = [];
    if (audience) details.push(`For: ${audience}`);
    if (style) details.push(`Style: ${style}`);
    const detailsEl = document.createElement('p');
    detailsEl.textContent = details.length ? details.join(' • ') : ' ';

    button.appendChild(img);
    button.appendChild(titleEl);
    button.appendChild(detailsEl);
    button.addEventListener('click', () => openDetail(item));
    return button;
  }

  function createGroupPlaceholder(group) {
    const placeholder = document.createElement('div');
    placeholder.className = 'storage-group-placeholder';

    const message = document.createElement('strong');
    if (group.loading) {
      message.textContent = 'Loading prompts...';
      placeholder.classList.add('is-loading');
    } else if (group.error) {
      message.textContent = 'Unable to load this customer right now.';
    } else if (!group.loaded) {
      message.textContent = 'Prompt images will load when this customer scrolls into view.';
    } else {
      message.textContent = state.filter
        ? 'No loaded prompt images match the current filter.'
        : 'No prompt images were found for this customer.';
    }

    const detail = document.createElement('span');
    detail.textContent = group.subtitle || '';

    placeholder.appendChild(message);
    if (detail.textContent) placeholder.appendChild(detail);

    if (group.error) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Retry';
      retry.addEventListener('click', () => {
        const sourceGroup = state.prompts.allCustomerGroups.find((candidate) => candidate.identityPrefix === group.identityPrefix);
        if (sourceGroup) {
          sourceGroup.loaded = false;
          sourceGroup.loading = false;
          sourceGroup.error = null;
        }
        ensureAllCustomerGroupLoaded(group.identityPrefix);
      });
      placeholder.appendChild(retry);
    }

    return placeholder;
  }

  function createPreviewGroup(group) {
    const { card } = createGroupShell(group.title, group.subtitle);
    const grid = document.createElement('div');
    grid.className = 'storage-thumbnail-grid';
    group.items.forEach((item) => {
      grid.appendChild(createPreviewThumb(item));
    });
    card.appendChild(grid);
    return card;
  }

  function createPromptGroup(group) {
    const { card } = createGroupShell(group.title, group.subtitle);

    if (!group.loaded || group.loading || group.error || group.items.length === 0) {
      card.appendChild(createGroupPlaceholder(group));
      if (group.identityPrefix && !group.loaded && !group.loading && !group.error) {
        card.dataset.identityPrefix = group.identityPrefix;
        setupCustomerGroupObserver();
        if (customerGroupObserver) {
          customerGroupObserver.observe(card);
        } else {
          ensureAllCustomerGroupLoaded(group.identityPrefix);
        }
      }
      return card;
    }

    const grid = document.createElement('div');
    grid.className = 'storage-prompt-grid';
    group.items.forEach((item) => {
      grid.appendChild(createPromptCard(item));
    });
    card.appendChild(grid);
    return card;
  }

  function createRenderNode(group) {
    return state.activeTab === 'previews'
      ? createPreviewGroup(group)
      : createPromptGroup(group);
  }

  function renderStorageResults() {
    const tabState = state[state.activeTab];

    elements.error.classList.add('hidden');
    elements.error.classList.remove('error');
    elements.empty.classList.add('hidden');

    if (tabState.error) {
      elements.error.textContent = tabState.error;
      elements.error.classList.add('error');
      elements.error.classList.remove('hidden');
    }

    const hasInitialPayload = state.activeTab === 'prompts'
      ? (state.viewMode === ALL_CUSTOMERS_VIEW_MODE && !state.prompts.fallbackMode
        ? state.prompts.allCustomerGroups.length > 0
        : tabState.items.length > 0)
      : tabState.items.length > 0;

    if (tabState.loading && !hasInitialPayload) {
      renderSkeleton();
      return;
    }

    const groups = buildRenderGroups();
    const signature = getRenderSignature(groups);
    if (state.virtualResults.signature !== signature) {
      state.virtualResults.signature = signature;
      state.virtualResults.groups = groups;
      state.virtualResults.renderedCount = Math.min(VIRTUAL_GROUP_CHUNK_SIZE, groups.length);
    } else {
      state.virtualResults.groups = groups;
      state.virtualResults.renderedCount = Math.min(
        Math.max(state.virtualResults.renderedCount, Math.min(VIRTUAL_GROUP_CHUNK_SIZE, groups.length)),
        groups.length,
      );
    }

    elements.results.innerHTML = '';
    disconnectRenderSentinelObserver();
    disconnectCustomerGroupObserver();

    if (!groups.length && !tabState.loading && !tabState.error) {
      elements.empty.textContent = getEmptyStateMessage();
      elements.empty.classList.remove('hidden');
      updateLoadMoreButton(0);
      return;
    }

    groups.slice(0, state.virtualResults.renderedCount).forEach((group) => {
      elements.results.appendChild(createRenderNode(group));
    });

    if (state.virtualResults.renderedCount < groups.length) {
      const sentinel = document.createElement('div');
      sentinel.className = 'storage-render-sentinel';
      sentinel.setAttribute('aria-hidden', 'true');
      elements.results.appendChild(sentinel);
      setupRenderSentinelObserver();
      if (renderSentinelObserver) {
        renderSentinelObserver.observe(sentinel);
      }
    }

    updateLoadMoreButton(groups.length);
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
    const createdAt = pickMeta(normalized, ['createdat']) || item.lastModified || item.storageDate;
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

  function initRangePresetButtons() {
    elements.rangePresets.innerHTML = '';
    elements.rangePresetButtons = RANGE_PRESETS.map((preset) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'storage-range-preset';
      button.dataset.rangePreset = preset.id;
      button.textContent = preset.label;
      button.addEventListener('click', () => {
        setDateRange(buildPresetDateRange(preset.days), { preset: preset.id });
      });
      elements.rangePresets.appendChild(button);
      return button;
    });
  }

  function initStorageBrowser() {
    elements.startDateInput = document.getElementById('storage-start-date-input');
    elements.endDateInput = document.getElementById('storage-end-date-input');
    elements.rangePresets = document.getElementById('storage-range-presets');
    elements.dateControls = document.getElementById('storage-date-controls');
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
    elements.viewModeButtons = Array.from(document.querySelectorAll('.storage-view-mode'));
    elements.viewModeHint = document.getElementById('storage-view-mode-hint');
    elements.rangePresetButtons = [];

    initRangePresetButtons();

    const todayRange = buildPresetDateRange(1);
    state.dateRange = todayRange;
    state.rangePreset = RANGE_PRESETS[0].id;
    elements.startDateInput.value = todayRange.start;
    elements.endDateInput.value = todayRange.end;
    updateRangePresetButtons();
    updateViewModeControls();

    elements.startDateInput.addEventListener('change', (event) => {
      setDateRange({
        start: event.target.value || state.dateRange.start,
        end: state.dateRange.end,
      }, { preset: 'custom' });
    });

    elements.endDateInput.addEventListener('change', (event) => {
      setDateRange({
        start: state.dateRange.start,
        end: event.target.value || state.dateRange.end,
      }, { preset: 'custom' });
    });

    elements.filterInput.addEventListener('input', (event) => {
      state.filter = event.target.value || '';
      renderStorageResults();
    });

    document.querySelectorAll('.storage-tab').forEach((btn) => {
      btn.addEventListener('click', () => setActiveTab(btn.dataset.storageTab));
    });

    elements.viewModeButtons.forEach((button) => {
      button.addEventListener('click', () => {
        if (button.disabled) return;
        setViewMode(button.dataset.storageViewMode);
      });
    });

    document.querySelectorAll('.app-nav-tab').forEach((btn) => {
      btn.addEventListener('click', () => setActiveView(btn.dataset.view));
    });

    // Mobile workflow navigation must use the same view controller as the
    // desktop header so data loading, ARIA state, and the selected tab stay in sync.
    document.querySelectorAll('.mobile-tab').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        if (!window.matchMedia('(max-width: 900px)').matches) return;
        const nextTab = btn.dataset.tab || 'pipeline';

        if (nextTab === 'storage') {
          event.stopImmediatePropagation();
          setActiveView('storage');
          return;
        }

        if (document.body.dataset.activeView === 'storage') {
          event.stopImmediatePropagation();
          setActiveView('orders');
          if (typeof window.setActiveMobileTab === 'function') {
            window.setActiveMobileTab(nextTab);
          }
        }
      }, true);
    });

    elements.loadMoreBtn.addEventListener('click', renderNextGroupChunk);

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
