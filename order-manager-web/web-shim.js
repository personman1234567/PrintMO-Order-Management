// web-shim.js — backed by your Cloudflare Worker proxy (NO admin key in client)
const API_BASE = "https://order-manager-proxy.printmobusiness.workers.dev";

let shopifyIdTokenCache = null;
let shopifyIdTokenLoad = null;

function shopifyIdTokenExpiry(token) {
  try {
    const payload = String(token || "").split(".")[1] || "";
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const claims = JSON.parse(atob(padded));
    const expiresAt = Number(claims?.exp) * 1000;
    return Number.isFinite(expiresAt) ? expiresAt : 0;
  } catch (_) {
    return 0;
  }
}

async function getShopifyIdToken({ force = false } = {}) {
  const now = Date.now();
  if (!force && shopifyIdTokenCache?.value && shopifyIdTokenCache.expiresAt > now) {
    return shopifyIdTokenCache.value;
  }
  if (shopifyIdTokenLoad) return shopifyIdTokenLoad;
  if (!window.shopify || typeof window.shopify.idToken !== "function") {
    throw new Error("Shopify authentication is unavailable. Open PrintMO from Shopify Admin.");
  }
  shopifyIdTokenLoad = (async () => {
    const token = await window.shopify.idToken();
    if (!token) throw new Error("Shopify authentication did not return an ID token.");
    const declaredExpiry = shopifyIdTokenExpiry(token);
    const safeDeclaredExpiry = declaredExpiry > now ? declaredExpiry - 10000 : now + 15000;
    shopifyIdTokenCache = {
      value: token,
      // Reuse the queue token only for its immediate follow-up ticket calls.
      // This removes a second App Bridge readiness round-trip without keeping
      // a bearer token near its one-minute expiry.
      expiresAt: Math.min(safeDeclaredExpiry, now + 30000),
    };
    return token;
  })();
  try {
    return await shopifyIdTokenLoad;
  } finally {
    shopifyIdTokenLoad = null;
  }
}

function apiErrorMessage(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return String(value);
  const code = value.code ? String(value.code) : "";
  const message = value.message ? String(value.message) : "";
  const requestId = value.requestId ? `Request ${value.requestId}` : "";
  if (code && message) return `${code}: ${message}${requestId ? ` (${requestId})` : ""}`;
  if (message) return `${message}${requestId ? ` (${requestId})` : ""}`;
  if (code) return `${code}${requestId ? ` (${requestId})` : ""}`;
  return requestId || "The server returned an unexpected error.";
}

async function apiFetch(path, opts = {}) {
  const { rawResponse, expect, ...rest } = opts;
  const headers = new Headers(rest.headers || {});
  const isFormData = typeof FormData !== "undefined" && rest.body instanceof FormData;
  if (!isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const request = async (forceToken = false) => {
    const token = await getShopifyIdToken({ force: forceToken });
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(`${API_BASE}${path}`, {
      ...rest,
      headers,
    });
  };
  let res = await request();
  if (res.status === 401) {
    shopifyIdTokenCache = null;
    res = await request(true);
  }

  const parseErrorBody = async () => {
    try {
      const text = await res.text();
      if (!text) return { message: "", payload: null };
      try {
        const data = JSON.parse(text);
        const msg = data?.error || data?.message || data?.msg;
        if (msg) return { message: apiErrorMessage(msg), payload: data };
      } catch (_) {
        // not JSON, fall through
      }
      return { message: text, payload: null };
    } catch (_) {
      return { message: "", payload: null };
    }
  };

  if (!res.ok) {
    const parsed = await parseErrorBody();
    const base = `${res.status} ${res.statusText}`.trim();
    const error = new Error([base, parsed.message].filter(Boolean).join(" - "));
    error.status = res.status;
    error.payload = parsed.payload;
    error.code = parsed.payload?.error?.code || null;
    error.details = parsed.payload?.error?.details || null;
    throw error;
  }

  if (rawResponse) return res;

  const ct = res.headers.get("content-type") || "";
  if (expect === "blob") return res.blob();
  if (expect === "text") return res.text();
  return ct.includes("application/json") ? res.json() : null;
}

function buildQuery(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `?${query}` : '';
}

function newIdempotencyKey(prefix = "web") {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const random = new Uint8Array(12);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(random);
  } else {
    for (let index = 0; index < random.length; index += 1) random[index] = Math.floor(Math.random() * 256);
  }
  const entropy = Array.from(random, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${prefix}:${Date.now().toString(36)}:${entropy}`;
}

window.api = window.api || {};
window.api.transport = "http";

const candidateOrdersByName = new Map();
const candidateAssetObjectUrls = new Map();
const candidateAssetObjectUrlLoads = new Map();
const candidateCatalogPreviewLoads = new Map();
const candidateMutationChains = new Map();
// Visible mockups receive their signed URLs immediately; the browser owns
// HTTP scheduling and decoding instead of a detached-image timeout queue.
const ASSET_HYDRATION_CONCURRENCY = 6;
const CANDIDATE_TICKET_BATCH_TIMEOUT_MS = 1500;
const CANDIDATE_ASSET_OBJECT_URL_LIMIT = 100;
const CANDIDATE_PERF_DEBUG_KEY = "printmo:order-manager:performance-debug";
let candidateForceRefreshOnce = false;
let candidateAssetHydrationRun = 0;
let candidateQueueLoadGeneration = 0;
let candidateBoardHydrationRecords = [];
let candidateBoardMockupRepaint = null;
let candidatePerfImageObserverInstalled = false;

function candidatePerfNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function candidatePerfDebugEnabled() {
  try {
    return window.localStorage?.getItem(CANDIDATE_PERF_DEBUG_KEY) === "1";
  } catch (_) {
    return false;
  }
}

function candidatePerfLog(event, detail = {}) {
  if (!candidatePerfDebugEnabled()) return;
  console.info(`[OrderManagerPerf] ${event}`, {
    atMs: Math.round(candidatePerfNow()),
    ...detail,
  });
}

function installCandidatePerfImageObserver() {
  if (candidatePerfImageObserverInstalled || typeof document?.addEventListener !== "function") return;
  candidatePerfImageObserverInstalled = true;
  document.addEventListener("load", (event) => {
    const image = event.target;
    if (!candidatePerfDebugEnabled() || image?.tagName !== "IMG" || !image.closest?.(".card .mockup-slot")) return;
    const rect = image.getBoundingClientRect();
    candidatePerfLog("tile-image-loaded", {
      visible: rect.bottom >= 0
        && rect.right >= 0
        && rect.top <= (window.innerHeight || document.documentElement.clientHeight)
        && rect.left <= (window.innerWidth || document.documentElement.clientWidth),
      naturalWidth: Number(image.naturalWidth || 0),
      naturalHeight: Number(image.naturalHeight || 0),
    });
  }, true);
}

window.orderManagerPerformanceDebug = Object.freeze({
  enable() {
    try { window.localStorage?.setItem(CANDIDATE_PERF_DEBUG_KEY, "1"); } catch (_) {}
    installCandidatePerfImageObserver();
    candidatePerfLog("debug-enabled");
    return true;
  },
  disable() {
    try { window.localStorage?.removeItem(CANDIDATE_PERF_DEBUG_KEY); } catch (_) {}
    return false;
  },
  enabled: candidatePerfDebugEnabled,
  log: candidatePerfLog,
});

if (candidatePerfDebugEnabled()) installCandidatePerfImageObserver();

async function runWithConcurrency(items, limit, worker) {
  const queue = Array.isArray(items) ? items : [];
  let nextIndex = 0;
  const runners = Array.from(
    { length: Math.min(Math.max(Number(limit) || 1, 1), queue.length) },
    async () => {
      while (nextIndex < queue.length) {
        const index = nextIndex;
        nextIndex += 1;
        await worker(queue[index], index);
      }
    }
  );
  await Promise.all(runners);
}

async function withCandidateTicketBatchTimeout(promise) {
  let timeoutId = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = window.setTimeout(
          () => reject(new Error("Private preview ticket batch timed out")),
          CANDIDATE_TICKET_BATCH_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  }
}

function isShopifyCandidateView() {
  return document.body?.dataset.orderSource === "shopify";
}

function candidateCachedAssetUrl(assetId) {
  const entry = assetId ? candidateAssetObjectUrls.get(assetId) : null;
  if (!entry) return "";
  if (entry.expiresAt <= Date.now() + 5000) {
    candidateAssetObjectUrls.delete(assetId);
    if (String(entry.url || "").startsWith("blob:")) URL.revokeObjectURL(entry.url);
    return "";
  }
  candidateAssetObjectUrls.delete(assetId);
  candidateAssetObjectUrls.set(assetId, entry);
  return entry.url;
}

function rememberCandidateAssetUrl(assetId, url, expiresIn = 60) {
  if (!assetId || !url) return "";
  candidateAssetObjectUrls.set(assetId, {
    url: new URL(url, API_BASE).toString(),
    expiresAt: Date.now() + Math.max(Number(expiresIn) || 60, 1) * 1000,
  });
  while (candidateAssetObjectUrls.size > CANDIDATE_ASSET_OBJECT_URL_LIMIT) {
    const oldest = candidateAssetObjectUrls.entries().next().value;
    if (!oldest) break;
    candidateAssetObjectUrls.delete(oldest[0]);
    if (String(oldest[1]?.url || "").startsWith("blob:")) URL.revokeObjectURL(oldest[1].url);
  }
  return candidateAssetObjectUrls.get(assetId)?.url || "";
}

function candidateStageToBoard(stage) {
  if (stage === "to_order") return "toOrder";
  if (stage === "blanks_cart" || stage === "blanks_ordered") return "blanks";
  if (stage === "print" || stage === "completed") return "print";
  return "received";
}

function boardStageToCandidate(status, current = {}) {
  if (status === "toOrder") return "to_order";
  if (status === "blanks") return Number(current.blanksOrdered) ? "blanks_ordered" : "blanks_cart";
  if (status === "print") return "print";
  return "received";
}

function selectOperationalCustomerName(order = {}) {
  const shipping = String(order.shippingAddress?.name || "").trim();
  if (shipping) return shipping;
  const billing = String(order.billingAddress?.name || "").trim();
  if (billing) return billing;
  const first = String(order.customer?.firstName || "").trim();
  const last = String(order.customer?.lastName || "").trim();
  if (first && last) return `${first} ${last}`;
  if (first) return first;
  if (last) return last;
  const display = String(order.customer?.displayName || "").trim();
  if (display && order.customer && !("firstName" in order.customer) && !("lastName" in order.customer)) {
    return display;
  }
  return null;
}

function candidateLineItem(item = {}, assets = []) {
  const variationAttributes = (item.variations || [])
    .filter(variation => variation?.name && variation?.value)
    .map(variation => ({ key: variation.name, value: variation.value }));
  const customAttributes = Array.isArray(item.customAttributes) && item.customAttributes.length
    ? item.customAttributes
    : variationAttributes;
  const properties = customAttributes.reduce((result, attribute) => {
    if (attribute?.key) result[attribute.key] = attribute.value;
    return result;
  }, {});
  const variantTitle = item.variantTitle || (item.variations || [])
    .filter(variation => !variation?.questionId && !/personal/i.test(String(variation?.name || "")))
    .map(variation => variation?.value)
    .filter(Boolean)
    .join(" / ");
  return {
    id: item.id,
    title: item.title || "",
    variantTitle,
    sku: item.supplierSku || item.sku || "",
    sourceSku: item.sourceSku || item.sku || "",
    supplierSku: item.supplierSku || "",
    qty: Number(item.currentQuantity ?? item.quantity ?? 0),
    price: Number(item.unitPrice || 0),
    unitPrice: Number(item.unitPrice || 0),
    properties,
    customAttributes,
    assets,
    catalogPreview: item.catalogPreview?.previewId ? item.catalogPreview : null,
  };
}

function candidateOrderToBoard(order = {}, { register = true } = {}) {
  const production = order.production || {};
  const customer = selectOperationalCustomerName(order) || "Name unavailable";
  const provider = String(order.source?.provider || "shopify").toLowerCase();
  const displayName = order.displayName || order.source?.displayNumber || order.id || (provider === "shopify" ? "Shopify order" : "Order");
  const name = `${displayName} \u2013 ${customer}`;
  const orderAssets = Array.isArray(production.assets) ? production.assets : [];
  const assetsByLine = new Map();
  const unassignedAssets = [];
  orderAssets.forEach((asset) => {
    if (asset?.lineItemId) {
      const current = assetsByLine.get(asset.lineItemId) || [];
      current.push(asset);
      assetsByLine.set(asset.lineItemId, current);
    } else {
      unassignedAssets.push(asset);
    }
  });
  const lineItems = (order.commerce?.lineItems || []).map((item) =>
    candidateLineItem(item, assetsByLine.get(item.id) || [])
  );
  if (lineItems.length && unassignedAssets.length) lineItems[0].assets.push(...unassignedAssets);
  const mapped = {
    _candidate: true,
    _gid: order.orderKey || order.id,
    _orderKey: order.orderKey || order.id,
    _provider: provider,
    _source: order.source || { provider: "shopify", label: "Shopify", synthetic: false },
    _synthetic: Boolean(order.source?.synthetic || order.commerce?.synthetic),
    _capabilities: order.capabilities || {},
    _version: Number(production.version || 0),
    productionStage: production.stage || "received",
    name,
    orderNumber: String(displayName).replace(/^#/, ""),
    receivedAt: order.createdAt,
    status: candidateStageToBoard(production.stage),
    items: lineItems,
    subtotal: Number(order.commerce?.subtotal || 0),
    discount: Number(order.commerce?.discount || 0),
    total: Number(order.commerce?.total || 0),
    notes: production.internalNotes || "",
    bundle: production.bundleId || "",
    progress: Number(production.printedCount || 0),
    blanksStatus: Number(production.blanksStatus || 0),
    printsStatus: Number(production.printsStatus || 0),
    blanksOrdered: Number(production.blanksOrdered ?? (production.stage === "blanks_ordered" ? 1 : 0)),
    printsOrdered: Number(production.printsOrdered || 0),
    displayFinancialStatus: order.commerce?.financialStatus || "",
    displayFulfillmentStatus: order.commerce?.fulfillmentStatus || "",
    source: order.source || null,
    canonical: order,
    assets: production.assets || [],
  };
  if (register) candidateOrdersByName.set(name, mapped);
  return mapped;
}

async function candidateAssetObjectUrl(asset) {
  if (!asset?.assetId) return "";
  const cached = candidateCachedAssetUrl(asset.assetId);
  if (cached) return cached;
  if (candidateAssetObjectUrlLoads.has(asset.assetId)) return candidateAssetObjectUrlLoads.get(asset.assetId);
  const load = (async () => {
    const ticket = await apiFetch(
      `/order-manager/v1/assets/${encodeURIComponent(asset.assetId)}/read-ticket`,
      { method: "POST", body: "{}" }
    );
    if (!ticket?.url) throw new Error(`Private asset ticket was not returned for ${asset.name || asset.assetId}.`);
    return rememberCandidateAssetUrl(asset.assetId, ticket.url, ticket.expiresIn);
  })().finally(() => {
    candidateAssetObjectUrlLoads.delete(asset.assetId);
  });
  candidateAssetObjectUrlLoads.set(asset.assetId, load);
  return load;
}

function catalogPreviewCacheKey(previewId) {
  return previewId ? `catalog:${previewId}` : "";
}

async function candidateCatalogPreviewUrl(preview) {
  const previewId = String(preview?.previewId || "");
  const cacheKey = catalogPreviewCacheKey(previewId);
  if (!cacheKey) return "";
  const cached = candidateCachedAssetUrl(cacheKey);
  if (cached) return cached;
  if (candidateCatalogPreviewLoads.has(cacheKey)) return candidateCatalogPreviewLoads.get(cacheKey);
  const load = (async () => {
    const ticket = await apiFetch(
      `/order-manager/v1/catalog-previews/${encodeURIComponent(previewId)}/read-ticket`,
      { method: "POST", body: "{}" }
    );
    if (!ticket?.url) throw new Error(`Catalog preview ticket was not returned for ${previewId}.`);
    return rememberCandidateAssetUrl(cacheKey, ticket.url, ticket.expiresIn);
  })().finally(() => {
    candidateCatalogPreviewLoads.delete(cacheKey);
  });
  candidateCatalogPreviewLoads.set(cacheKey, load);
  return load;
}

function candidateCatalogPreviewEntries(records) {
  const entries = [];
  const seen = new Set();
  (records || []).forEach(record => {
    (record?.commerce?.lineItems || []).forEach(item => {
      const preview = item?.catalogPreview;
      const previewId = String(preview?.previewId || "");
      if (!previewId || seen.has(`${record.id}:${previewId}`)) return;
      seen.add(`${record.id}:${previewId}`);
      entries.push({ record, item, preview });
    });
  });
  return entries;
}

async function prefetchCandidateAssetTickets(assets) {
  const assetIds = [...new Set((assets || [])
    .map(asset => asset?.assetId)
    .filter(assetId => assetId && !candidateCachedAssetUrl(assetId)))];
  if (!assetIds.length) return;
  const result = await apiFetch("/order-manager/v1/assets/read-tickets", {
    method: "POST",
    body: JSON.stringify({ assetIds }),
  });
  (result?.tickets || []).forEach(ticket => {
    rememberCandidateAssetUrl(ticket.assetId, ticket.url, ticket.expiresIn);
  });
}

function candidateAssetIsMockup(asset) {
  if (asset?.role === "mockup") return true;
  return /(?:^|[/_-])side\.(?:png|jpe?g|webp)(?:$|\?)/i.test(String(asset?.name || asset?.filename || ""));
}

function candidateAssetOrderPriority(record) {
  const stage = record?.production?.stage;
  const defaultPriority = stage === "print" || stage === "completed"
    ? 0
    : stage === "received"
      ? 1
      : stage === "blanks_cart" || stage === "blanks_ordered"
        ? 2
        : stage === "to_order" ? 3 : 4;
  const mobile = window.matchMedia?.("(max-width: 900px)")?.matches;
  const activeTab = document.body?.dataset.activeTab || "pipeline";
  if (mobile) {
    const belongsToActiveTab = (activeTab === "pipeline" && stage === "received")
      || ((activeTab === "blanksCart" || activeTab === "blanksOrdered")
        && (stage === "to_order" || stage === "blanks_cart" || stage === "blanks_ordered"))
      || (activeTab === "readyToPrint" && (stage === "print" || stage === "completed"));
    return belongsToActiveTab ? 0 : defaultPriority + 1;
  }
  return defaultPriority;
}

function candidateRecordBelongsToActiveMobileTab(record) {
  const stage = record?.production?.stage;
  const activeTab = document.body?.dataset.activeTab || "pipeline";
  if (activeTab === "pipeline") return stage === "received";
  if (activeTab === "blanksCart" || activeTab === "blanksOrdered") {
    return stage === "to_order" || stage === "blanks_cart" || stage === "blanks_ordered";
  }
  if (activeTab === "readyToPrint") return stage === "print" || stage === "completed";
  return false;
}

function waitForCandidateBoardPaint() {
  if (typeof requestAnimationFrame !== "function") return Promise.resolve();
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

function candidateRecordIsVisibleInBoard(record) {
  if (typeof document === "undefined") return false;
  const displayName = record?.displayName || record?.id || "Shopify order";
  const customer = selectOperationalCustomerName(record) || "Name unavailable";
  const orderName = `${displayName} – ${customer}`;
  const card = Array.from(document.querySelectorAll(".card[data-order-id]")).find(node => node.dataset.orderId === orderName);
  if (!card) return false;
  const rect = card.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0
    && rect.bottom >= 0
    && rect.right >= 0
    && rect.top <= (window.innerHeight || document.documentElement.clientHeight)
    && rect.left <= (window.innerWidth || document.documentElement.clientWidth);
}

function candidateAssetHydrationQueue(records, { boardVisibleOnly = false } = {}) {
  const firstMockups = [];
  const remainingMockups = [];
  const remainingAssets = [];
  const mobile = window.matchMedia?.("(max-width: 900px)")?.matches;
  const scopedRecords = boardVisibleOnly && mobile
    ? [...records].filter(candidateRecordBelongsToActiveMobileTab)
    : [...records];
  scopedRecords
    .sort((left, right) => candidateAssetOrderPriority(left) - candidateAssetOrderPriority(right))
    .forEach((record) => {
      const assets = Array.isArray(record?.production?.assets) ? record.production.assets : [];
      const mockups = assets.filter(candidateAssetIsMockup);
      if (mockups[0]) firstMockups.push({ asset: mockups[0], record, isMockup: true });
      mockups.slice(1).forEach((asset) => remainingMockups.push({ asset, record, isMockup: true }));
      assets
        .filter((asset) => !candidateAssetIsMockup(asset))
        .forEach((asset) => remainingAssets.push({ asset, record, isMockup: false }));
    });
  return [...firstMockups, ...remainingMockups, ...remainingAssets];
}

async function hydrateCandidateAssets(records, { onMockupChange, boardVisibleOnly = false } = {}) {
  // Yield after the page snapshot is applied so layout can identify visible
  // cards before preview sources are prioritized.
  if (boardVisibleOnly) await waitForCandidateBoardPaint();
  const assets = candidateAssetHydrationQueue(records, { boardVisibleOnly });
  assets.sort((left, right) => {
    const leftVisible = candidateRecordIsVisibleInBoard(left.record) ? 0 : 1;
    const rightVisible = candidateRecordIsVisibleInBoard(right.record) ? 0 : 1;
    return leftVisible - rightVisible;
  });
  const changedOrderIds = new Set();
  try {
    await withCandidateTicketBatchTimeout(
      prefetchCandidateAssetTickets(assets.map(entry => entry.asset))
    );
  } catch (error) {
    console.warn("Unable to batch private asset tickets; using per-asset fallback", error);
  }
  await runWithConcurrency(assets, ASSET_HYDRATION_CONCURRENCY, async ({ asset, record, isMockup }) => {
    let repainted = false;
    try {
      const previousUrl = asset.url || "";
      const nextUrl = await candidateAssetObjectUrl(asset);
      asset.url = nextUrl;
      asset._previewState = "ready";
      if (nextUrl && nextUrl !== previousUrl) changedOrderIds.add(record.id);
      if (isMockup && typeof onMockupChange === "function") {
        onMockupChange(record);
        repainted = true;
      }
    } catch (error) {
      asset._previewState = "failed";
      console.warn("Unable to hydrate private Designer Studio asset", asset?.assetId, error);
    } finally {
      if (!repainted && isMockup && typeof onMockupChange === "function") onMockupChange(record);
    }
  });
  const catalogPreviews = candidateCatalogPreviewEntries(records);
  await runWithConcurrency(catalogPreviews, ASSET_HYDRATION_CONCURRENCY, async ({ preview, record }) => {
    try {
      const previousUrl = preview.url || "";
      const nextUrl = await candidateCatalogPreviewUrl(preview);
      preview.url = nextUrl;
      preview._previewState = "ready";
      if (nextUrl && nextUrl !== previousUrl) changedOrderIds.add(record.id);
    } catch (error) {
      preview._previewState = "failed";
      console.warn("Unable to hydrate Etsy catalog preview", preview?.previewId, error);
    } finally {
      if (typeof onMockupChange === "function") onMockupChange(record);
    }
  });
  return changedOrderIds;
}

function applyCandidateCachedAssetUrls(records) {
  records.forEach((order) => {
    (order?.production?.assets || []).forEach((asset) => {
      const cached = candidateCachedAssetUrl(asset?.assetId);
      if (cached) asset.url = cached;
    });
    (order?.commerce?.lineItems || []).forEach(item => {
      const preview = item?.catalogPreview;
      const cached = candidateCachedAssetUrl(catalogPreviewCacheKey(preview?.previewId));
      if (cached && preview) preview.url = cached;
    });
  });
}

async function loadCandidateQueue({ refresh = false, onPage } = {}) {
  const loadGeneration = ++candidateQueueLoadGeneration;
  const loadStartedAt = candidatePerfNow();
  const records = [];
  const hydrationRun = ++candidateAssetHydrationRun;
  let hydrationChain = Promise.resolve();
  let pageIndex = 0;
  let cursor = "";

  const scheduleMockupRepaint = (record) => {
    if (hydrationRun !== candidateAssetHydrationRun || !isShopifyCandidateView()) return;
    const displayName = record.displayName || record.id || "Shopify order";
    const customer = selectOperationalCustomerName(record) || "Name unavailable";
    const key = `${displayName} \u2013 ${customer}`;
    const current = candidateOrdersByName.get(key);
    if (!current || typeof window.updateBoardMockupPreview !== "function") return;
    const updated = window.updateBoardMockupPreview(current, { resolvePlaceholder: true });
    if (updated) candidatePerfLog("tile-preview-source-attached");
  };

  candidateBoardHydrationRecords = records;
  candidateBoardMockupRepaint = scheduleMockupRepaint;
  candidatePerfLog("queue-load-start", { generation: loadGeneration, refresh: Boolean(refresh) });

  do {
    const pageStartedAt = candidatePerfNow();
    const query = buildQuery({ limit: 50, cursor, refresh: refresh ? 1 : undefined });
    const page = await apiFetch(`/order-manager/v1/orders${query}`, { method: "GET" });
    if (loadGeneration !== candidateQueueLoadGeneration) return [];
    const pageRecords = Array.isArray(page?.data) ? page.data : [];
    records.push(...pageRecords);
    cursor = page?.pageInfo?.nextCursor || "";
    pageIndex += 1;
    const pageNumber = pageIndex;

    applyCandidateCachedAssetUrls(pageRecords);
    const mapped = records.map(record => candidateOrderToBoard(record, { register: false }));
    candidateOrdersByName.clear();
    mapped.forEach(order => candidateOrdersByName.set(order.name, order));

    const hasMore = Boolean(cursor && records.length < 500);
    candidatePerfLog("queue-page-ready", {
      generation: loadGeneration,
      page: pageNumber,
      pageRecords: pageRecords.length,
      accumulatedRecords: records.length,
      requestMs: Math.round(candidatePerfNow() - pageStartedAt),
      hasMore,
    });

    if (typeof onPage === "function") {
      await onPage(mapped, {
        generation: loadGeneration,
        page: pageNumber,
        hasMore,
        accumulatedRecords: records.length,
        totalRecords: Number(page?.pageInfo?.total || records.length),
      });
      if (loadGeneration !== candidateQueueLoadGeneration) return [];
    }

    // Page hydration is deliberately detached from queue enumeration and card
    // rendering. Serialize pages so the first visible cards receive image
    // sources before later pages compete for browser/network attention.
    hydrationChain = hydrationChain.catch(() => {}).then(async () => {
      if (hydrationRun !== candidateAssetHydrationRun) return;
      candidatePerfLog("preview-page-hydration-start", { page: pageNumber, records: pageRecords.length });
      await hydrateCandidateAssets(pageRecords, {
        onMockupChange: scheduleMockupRepaint,
        boardVisibleOnly: true,
      });
      candidatePerfLog("preview-page-hydration-complete", { page: pageNumber, records: pageRecords.length });
    }).catch(error => console.warn("Unable to hydrate Shopify board previews", error));
  } while (cursor && records.length < 500);

  const mapped = records.map(record => candidateOrderToBoard(record, { register: false }));
  candidatePerfLog("queue-load-complete", {
    generation: loadGeneration,
    pages: pageIndex,
    records: records.length,
    elapsedMs: Math.round(candidatePerfNow() - loadStartedAt),
  });
  return mapped;
}

document.addEventListener?.("click", (event) => {
  if (!event.target?.closest?.(".mobile-tab[data-tab]")) return;
  window.setTimeout(() => {
    if (!candidateBoardHydrationRecords.length || !isShopifyCandidateView()) return;
    void hydrateCandidateAssets(candidateBoardHydrationRecords, {
      onMockupChange: candidateBoardMockupRepaint,
      boardVisibleOnly: true,
    }).catch(error => console.warn("Unable to hydrate active mobile previews", error));
  }, 0);
});

function candidateByName(name) {
  const order = candidateOrdersByName.get(name);
  if (!order) throw new Error("The order is no longer in the current board view. Refresh and try again.");
  return order;
}

function applyCandidateProduction(order, production = {}) {
  order._version = Number(production.version ?? production.revision ?? order._version + 1);
  if (production.stage) {
    order.productionStage = production.stage;
    order.status = candidateStageToBoard(production.stage);
  }
  if ("bundleId" in production) order.bundle = production.bundleId || "";
  if ("internalNotes" in production) order.notes = production.internalNotes || "";
  if ("printedCount" in production) order.progress = Number(production.printedCount || 0);
  if ("blanksStatus" in production) order.blanksStatus = Number(production.blanksStatus || 0);
  if ("printsStatus" in production) order.printsStatus = Number(production.printsStatus || 0);
  if ("printsOrdered" in production) order.printsOrdered = Number(production.printsOrdered || 0);
  order.blanksOrdered = Number(production.blanksOrdered ?? (production.stage === "blanks_ordered" ? 1 : 0));
}

function candidateProductionMatchesPatch(production = {}, patch = {}) {
  const fields = {
    stage: "stage",
    bundle_id: "bundleId",
    internal_notes: "internalNotes",
    printed_count: "printedCount",
    blanks_status: "blanksStatus",
    blanks_ordered: "blanksOrdered",
    prints_status: "printsStatus",
    prints_ordered: "printsOrdered",
  };
  return Object.entries(patch).every(([patchKey, expected]) => {
    const productionKey = fields[patchKey];
    if (!productionKey) return false;
    const actual = production[productionKey];
    if (typeof expected === "number") return Number(actual || 0) === Number(expected);
    return String(actual ?? "") === String(expected ?? "");
  });
}

async function performCandidateOrderUpdate(name, patch) {
  const order = candidateByName(name);
  if (!patch || Object.keys(patch).length === 0) return true;
  const send = () => window.api.updateProductionMetadata(order._gid, {
    expectedVersion: order._version,
    patch,
    idempotencyKey: newIdempotencyKey("board"),
  });
  try {
    const result = await send();
    applyCandidateProduction(order, result?.production || {});
    return result;
  } catch (error) {
    if (error?.status !== 409 || error?.code !== "VERSION_CONFLICT") throw error;
    const conflictProduction = error.details?.current;
    if (conflictProduction) applyCandidateProduction(order, conflictProduction);
    const currentResult = conflictProduction
      ? { production: conflictProduction }
      : await window.api.getProductionMetadata(order._gid);
    const current = currentResult?.production || currentResult || {};
    applyCandidateProduction(order, current);
    if (candidateProductionMatchesPatch(current, patch)) return { ok: true, production: current };
    const retry = await send();
    applyCandidateProduction(order, retry?.production || {});
    return retry;
  }
}

function updateCandidateOrder(name, patch) {
  const previous = candidateMutationChains.get(name) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => performCandidateOrderUpdate(name, patch));
  const settled = next.catch(() => {}).finally(() => {
    if (candidateMutationChains.get(name) === settled) candidateMutationChains.delete(name);
  });
  candidateMutationChains.set(name, settled);
  return next;
}

// 1) Populate dashboard
window.api.getQueue = async ({ onPage } = {}) => {
  if (isShopifyCandidateView()) {
    const refresh = candidateForceRefreshOnce;
    candidateForceRefreshOnce = false;
    return loadCandidateQueue({ refresh, onPage });
  }
  const data = await apiFetch("/order-manager/v1/legacy/queue", { method: "GET" });
  return Array.isArray(data) ? data : (data?.orders || []);
};

window.api.invalidateQueueLoads = () => {
  candidateQueueLoadGeneration += 1;
  candidateAssetHydrationRun += 1;
};

window.refreshOrderManagerNow = async () => {
  if (isShopifyCandidateView()) candidateForceRefreshOnce = true;
  if (typeof window.renderBoard === "function") return window.renderBoard();
  return null;
};

// Read-only Shopify commerce preview. This endpoint never enumerates or mutates
// the legacy Redis queue; production workflow continues through getQueue().
window.api.getShopifyPreviewOrders = async ({ limit = 50, refresh = false } = {}) => {
  const query = buildQuery({
    limit: Math.min(Math.max(Number(limit) || 50, 1), 50),
    refresh: refresh ? 1 : undefined,
  });
  return apiFetch(`/order-manager/v1/shopify-preview/orders${query}`, { method: "GET" });
};

window.api.getShopifyPreviewOrderDetail = async (orderId, { refresh = false } = {}) => {
  if (!orderId) throw new Error("A Shopify order ID is required");
  const query = buildQuery({ refresh: refresh ? 1 : undefined });
  return apiFetch(
    `/order-manager/v1/shopify-preview/orders/${encodeURIComponent(orderId)}${query}`,
    { method: "GET" }
  );
};

// Canonical on-demand detail for the operational multi-source workbench. The
// bounded board payload remains responsible for first paint; this request
// hydrates commerce, delivery, attention, production, and private asset
// metadata only after an operator opens an order.
window.api.getOrderDetail = async (orderId, { signal } = {}) => {
  if (!orderId) throw new Error("An order ID is required");
  const result = await apiFetch(
    `/order-manager/v1/orders/${encodeURIComponent(orderId)}`,
    {
      method: "GET",
      ...(signal ? { signal } : {}),
    }
  );
  applyCandidateCachedAssetUrls([result]);
  await hydrateCandidateAssets([result]);
  return result;
};

// Production metadata is separate from commerce. Shopify state remains in its
// canonical metafield; explicitly enrolled provider pilots use provider-owned
// D1 state. Candidate edits remain Redis-free in both cases.
window.api.getProductionMetadata = async (orderId) => {
  if (!orderId) throw new Error("An order ID is required");
  return apiFetch(
    `/order-manager/v1/orders/${encodeURIComponent(orderId)}/production`,
    { method: "GET" }
  );
};

window.api.updateProductionMetadata = async (orderId, payload = {}) => {
  if (!orderId) throw new Error("An order ID is required");
  return apiFetch(
    `/order-manager/v1/orders/${encodeURIComponent(orderId)}/production`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    }
  );
};

// 2) Drag/drop persistence
window.api.updateStatus = async (name, status) => {
  if (isShopifyCandidateView()) {
    const order = candidateByName(name);
    if (status === "blanks" && order._batchConfirmedAt && Date.now() - order._batchConfirmedAt < 10000) {
      return true;
    }
    return updateCandidateOrder(name, { stage: boardStageToCandidate(status, order) });
  }
  await apiFetch("/order-manager/v1/legacy/queue/mutate", {
    method: "POST",
    body: JSON.stringify({ orderName: name, patch: { status } }),
  });
  return true;
};

window.api.updateNotes = async (a, b) => {
  const payload = (a && typeof a === "object") ? a : { name: a, notes: b };
  if (isShopifyCandidateView()) return updateCandidateOrder(payload.name, { internal_notes: payload.notes || "" });
  return apiFetch("/order-manager/v1/legacy/queue/mutate", {
    method: "POST",
    body: JSON.stringify({ orderName: payload.name, patch: { notes: payload.notes } }),
  });
};

window.api.setBundle = async (a, b) => {
  const payload = Array.isArray(a)
    ? { names: a, bundle: b }
    : ((a && typeof a === "object") ? a : { name: a, bundle: b });
  if (isShopifyCandidateView()) {
    return Promise.all((payload.names || [payload.name]).map((name) =>
      updateCandidateOrder(name, { bundle_id: payload.bundle || null })
    ));
  }
  return apiFetch("/order-manager/v1/legacy/queue/mutate", {
    method: "POST",
    body: JSON.stringify({ orderNames: payload.names || [payload.name], patch: { bundle: payload.bundle } }),
  });
};

window.api.updateReady = async (...args) => {
  let payload = null;
  // full object or partial object already
  if (args[0] && typeof args[0] === "object" && !Array.isArray(args[0])) {
    payload = { ...args[0] };
  } else if (typeof args[0] === "string") {
    const [blanksStatus, printsStatus, blanksOrdered, printsOrdered] = args.slice(1);
    if (args[1] && typeof args[1] === "object" && !Array.isArray(args[1])) {
      payload = { name: args[0], ...args[1] };
    } else {
      payload = { name: args[0] };
      if (typeof blanksStatus === "number") payload.blanksStatus = blanksStatus;
      if (typeof printsStatus === "number") payload.printsStatus = printsStatus;
      if (typeof blanksOrdered === "number") payload.blanksOrdered = blanksOrdered;
      if (typeof printsOrdered === "number") payload.printsOrdered = printsOrdered;
    }
  }

  if (!payload || !payload.name) {
    throw new Error("updateReady requires an order name");
  }

  const { name, ...patch } = payload;
  if (isShopifyCandidateView()) {
    const candidate = candidateByName(name);
    const metadataPatch = {};
    if ("blanksStatus" in patch) metadataPatch.blanks_status = patch.blanksStatus;
    if ("blanksOrdered" in patch) metadataPatch.blanks_ordered = patch.blanksOrdered;
    if ("printsStatus" in patch) metadataPatch.prints_status = patch.printsStatus;
    if ("printsOrdered" in patch) metadataPatch.prints_ordered = patch.printsOrdered;
    if ("blanksOrdered" in patch && candidate.status === "blanks") {
      const recentlyConfirmed = candidate._batchConfirmedAt && Date.now() - candidate._batchConfirmedAt < 10000;
      if (!recentlyConfirmed || Number(patch.blanksOrdered)) {
        metadataPatch.stage = Number(patch.blanksOrdered) ? "blanks_ordered" : "blanks_cart";
      }
    }
    return updateCandidateOrder(name, metadataPatch);
  }
  return apiFetch("/order-manager/v1/legacy/queue/mutate", {
    method: "POST",
    body: JSON.stringify({ orderName: name, patch }),
  });
};

window.api.updateProgress = async (a, b) => {
  const payload = (a && typeof a === "object") ? a : { name: a, progress: b };
  if (isShopifyCandidateView()) {
    const metadataPatch = { printed_count: Number(payload.progress || 0) };
    if (payload.stage === "print" || payload.stage === "completed") metadataPatch.stage = payload.stage;
    return updateCandidateOrder(payload.name, metadataPatch);
  }
  return apiFetch("/order-manager/v1/legacy/queue/mutate", {
    method: "POST",
    body: JSON.stringify({ orderName: payload.name, patch: { progress: payload.progress } }),
  });
};

window.api.updateName = async (a, b) => {
  const payload = (a && typeof a === "object") ? a : { name: a, newName: b };
  if (isShopifyCandidateView()) {
    throw new Error("Customer names come from the commerce source and cannot be changed from the production board.");
  }
  return apiFetch("/order-manager/v1/legacy/queue/mutate", {
    method: "POST",
    body: JSON.stringify({ orderName: payload.name, patch: { custName: payload.newName ?? payload.custName } }),
  });
};

window.api.deleteOrder = async (a) => {
  const payload = (a && typeof a === "object") ? a : { name: a };
  if (isShopifyCandidateView()) {
    const now = new Date().toISOString();
    return updateCandidateOrder(payload.name, { archived_at: now });
  }
  return apiFetch("/order-manager/v1/legacy/queue/item", {
    method: "DELETE",
    body: JSON.stringify({ orderName: payload.name }),
  });
};

window.api.updateBundleStatus = async (bundleName, status) => {
  const payload = (bundleName && typeof bundleName === "object")
    ? bundleName
    : { bundle: bundleName, name: bundleName, status };

  if (isShopifyCandidateView()) {
    const names = [...candidateOrdersByName.values()]
      .filter((order) => order.bundle === payload.bundle)
      .map((order) => order.name);
    return Promise.all(names.map((name) =>
      updateCandidateOrder(name, { stage: boardStageToCandidate(payload.status, candidateByName(name)) })
    ));
  }
  return apiFetch("/order-manager/v1/legacy/queue/mutate", {
    method: "POST",
    body: JSON.stringify({ bundleName: payload.bundle, patch: { status: payload.status } }),
  });
};

window.api.processBatch = async (orderIds) => {
  const names = Array.isArray(orderIds) ? orderIds : [];
  if (isShopifyCandidateView()) {
    const orders = names.map(candidateByName);
    const providers = new Set(orders.map(order => order._provider));
    if (providers.size !== 1) {
      throw new Error("Submit Shopify and Etsy Build Order cards as separate S&S batches.");
    }
    const isEtsyBatch = providers.has("etsy");
    const result = await apiFetch(isEtsyBatch ? "/order-manager/v1/provider-batches/commit" : "/order-manager/v1/batches/commit", {
      method: "POST",
      body: JSON.stringify({
        ...(isEtsyBatch ? { orderKeys: orders.map((order) => order._orderKey) } : { orderIds: orders.map((order) => order._gid) }),
        idempotencyKey: newIdempotencyKey("batch"),
      }),
    });
    const resultByOrderId = new Map((result?.orderResults || []).map(order => [order.orderId, order]));
    const acceptedOrders = resultByOrderId.size
      ? orders.filter(order => resultByOrderId.get(order._gid || order._orderKey)?.outcome === "confirmed")
      : orders;
    const now = Date.now();
    acceptedOrders.forEach((order) => {
      // The shared renderer owns the visible toOrder -> blanks transition so it
      // can repaint both columns. Mutating status here first loses the source
      // column from patchLocalOrders() and leaves stale Build Order cards.
      order.blanksOrdered = 0;
      order._batchConfirmedAt = now;
      if (result?.poNumber) order.blanksPo = [result.poNumber];
    });
    result.acceptedOrderNames = acceptedOrders.map(order => order.name);
    result.canonicalStageUpdated = true;
    return result;
  }
  return apiFetch("/order-manager/v1/legacy/ss/batch", {
    method: "POST",
    body: JSON.stringify({ orderIds: names }),
  });
};

window.api.createBlanksBatch = async (payload = {}) => {
  return apiFetch("/order-manager/blanks-batches", {
    method: "POST",
    body: JSON.stringify(payload),
  });
};

window.api.listBlanksBatches = async () => {
  return apiFetch("/order-manager/blanks-batches", { method: "GET" });
};

window.api.getBlanksBatch = async (id) => {
  if (!id) throw new Error("Batch ID is required");
  const query = buildQuery({ id });
  return apiFetch(`/order-manager/blanks-batches${query}`, { method: "GET" });
};

window.api.updateBlanksBatchReceiving = async (id, updates = []) => {
  if (!id) throw new Error("Batch ID is required");
  const cleanUpdates = Array.isArray(updates) ? updates.filter(Boolean) : [];
  return apiFetch("/order-manager/blanks-batches", {
    method: "PATCH",
    body: JSON.stringify({ id, updates: cleanUpdates }),
  });
};

window.api.removeOrdersFromBlanksBatch = async (id, orderNames = []) => {
  if (!id) throw new Error("Batch ID is required");
  const names = Array.isArray(orderNames) ? orderNames.filter(Boolean) : [];
  return apiFetch("/order-manager/blanks-batches", {
    method: "PATCH",
    body: JSON.stringify({ id, action: "remove-orders", orderNames: names }),
  });
};

window.api.addOrdersToBlanksBatch = async (id, orders = []) => {
  if (!id) throw new Error("Batch ID is required");
  const cleanOrders = Array.isArray(orders) ? orders.filter(Boolean) : [];
  return apiFetch("/order-manager/blanks-batches", {
    method: "PATCH",
    body: JSON.stringify({ id, action: "add-orders", orders: cleanOrders }),
  });
};

window.api.getLatestBatchResult = async () => {
  if (!isShopifyCandidateView()) return null;
  const response = await apiFetch("/order-manager/v1/batches/latest");
  return response?.result || null;
};

window.api.assignOrdersToBlanksBatch = async (id, orders = []) => {
  if (!id) throw new Error("Batch ID is required");
  const cleanOrders = Array.isArray(orders) ? orders.filter(Boolean) : [];
  return apiFetch("/order-manager/blanks-batches", {
    method: "PATCH",
    body: JSON.stringify({ id, action: "assign-orders", orders: cleanOrders }),
  });
};

window.api.listStorageObjects = async ({ prefix, cursor, limit, delimiter } = {}) => {
  const query = buildQuery({ prefix, cursor, limit, delimiter });
  return apiFetch(`/order-manager/storage/list${query}`, { method: "GET" });
};

window.api.headStorageObject = async (key) => {
  if (!key) throw new Error("Storage key is required");
  const query = buildQuery({ key });
  return apiFetch(`/order-manager/storage/head${query}`, { method: "GET" });
};

const storageObjectUrls = new Map();
const storageObjectUrlLoads = new Map();

window.api.getStorageObjectUrl = async (key) => {
  if (!key) return "";
  if (storageObjectUrls.has(key)) return storageObjectUrls.get(key);
  if (storageObjectUrlLoads.has(key)) return storageObjectUrlLoads.get(key);
  const load = (async () => {
    const query = buildQuery({ key });
    const blob = await apiFetch(`/order-manager/storage/object${query}`, { method: "GET", expect: "blob" });
    const url = URL.createObjectURL(blob);
    if (storageObjectUrls.size >= 200) {
      const oldestKey = storageObjectUrls.keys().next().value;
      URL.revokeObjectURL(storageObjectUrls.get(oldestKey));
      storageObjectUrls.delete(oldestKey);
    }
    storageObjectUrls.set(key, url);
    return url;
  })().finally(() => {
    storageObjectUrlLoads.delete(key);
  });
  storageObjectUrlLoads.set(key, load);
  return load;
};

window.api.updateBoardMove = async (name, patch = {}) => {
  if (!isShopifyCandidateView()) {
    await window.api.updateStatus(name, patch.status);
    if (Object.prototype.hasOwnProperty.call(patch, "blanksOrdered")) {
      await window.api.updateReady({ name, blanksOrdered: Number(patch.blanksOrdered) ? 1 : 0 });
    }
    return true;
  }
  const order = candidateByName(name);
  const status = patch.status || order.status;
  const currentBlanksOrdered = Object.prototype.hasOwnProperty.call(patch, "blanksOrdered")
    ? Number(patch.blanksOrdered)
    : Number(order.blanksOrdered);
  const metadataPatch = {
    stage: status === "blanks"
      ? (currentBlanksOrdered ? "blanks_ordered" : "blanks_cart")
      : boardStageToCandidate(status, order),
  };
  // The Blanks tabs are separate canonical stages, but the existing shared
  // renderer still reads this readiness field. Persist both in the same CAS
  // mutation so a board reload cannot observe a contradictory state.
  if (status === "blanks") metadataPatch.blanks_ordered = currentBlanksOrdered ? 1 : 0;
  return updateCandidateOrder(name, metadataPatch);
};

async function hydrateAssetUrls(result, { onManifest } = {}) {
  const manifests = result?.orders && typeof result.orders === "object"
    ? Object.values(result.orders)
    : [result];
  await runWithConcurrency(manifests, ASSET_HYDRATION_CONCURRENCY, async (manifest) => {
    for (const asset of (manifest?.assets || [])) {
      if (asset?.key) asset.url = await window.api.getStorageObjectUrl(asset.key);
    }
    if (typeof onManifest === "function") await onManifest(manifest);
  });
  return result;
}

window.api.listManualMockups = async (orderNumber) => {
  if (!orderNumber) throw new Error("Order number is required");
  const query = buildQuery({ orderNumber });
  return hydrateAssetUrls(await apiFetch(`/order-manager/orders/manual-mockups${query}`, { method: "GET" }));
};

window.api.uploadManualMockup = async (orderNumber, file) => {
  if (!orderNumber) throw new Error("Order number is required");
  if (!file) throw new Error("Mockup file is required");
  const form = new FormData();
  form.set("file", file, file.name || "mockup");
  const query = buildQuery({ orderNumber });
  return hydrateAssetUrls(await apiFetch(`/order-manager/orders/manual-mockups${query}`, {
    method: "POST",
    body: form,
  }));
};

window.api.deleteManualMockup = async (orderNumber, assetId) => {
  if (!orderNumber) throw new Error("Order number is required");
  if (!assetId) throw new Error("Mockup asset ID is required");
  const query = buildQuery({ orderNumber, assetId });
  return apiFetch(`/order-manager/orders/manual-mockups${query}`, { method: "DELETE" });
};

window.api.bulkListManualMockups = async (orderNumbers, { onOrder } = {}) => {
  const unique = Array.from(new Set((Array.isArray(orderNumbers) ? orderNumbers : []).filter(Boolean)));
  if (!unique.length) return { orders: {} };
  const result = await apiFetch("/order-manager/orders/manual-mockups/bulk", {
    method: "POST",
    body: JSON.stringify({ orderNumbers: unique }),
  });
  return hydrateAssetUrls(result, {
    onManifest: (manifest) => {
      if (typeof onOrder === "function") {
        return onOrder(String(manifest?.orderNumber || ""), manifest);
      }
      return undefined;
    },
  });
};

window.api.listManualChecklist = async (orderNumber) => {
  if (!orderNumber) throw new Error("Order number is required");
  const query = buildQuery({ orderNumber });
  return apiFetch(`/order-manager/orders/manual-checklist${query}`, { method: "GET" });
};

window.api.bulkListManualChecklist = async (orderNumbers) => {
  const unique = Array.from(new Set((Array.isArray(orderNumbers) ? orderNumbers : []).filter(Boolean)));
  if (!unique.length) return { orders: {} };
  return apiFetch("/order-manager/orders/manual-checklist/bulk", {
    method: "POST",
    body: JSON.stringify({ orderNumbers: unique }),
  });
};

window.api.updateManualChecklistItem = async (orderNumber, itemId, checked, item = {}) => {
  if (!orderNumber) throw new Error("Order number is required");
  if (!itemId) throw new Error("Checklist item ID is required");
  return apiFetch("/order-manager/orders/manual-checklist", {
    method: "PATCH",
    body: JSON.stringify({ orderNumber, itemId, checked: Boolean(checked), item }),
  });
};

window.api.updateManualChecklistItems = async (updates) => {
  const clean = Array.isArray(updates) ? updates.filter(Boolean) : [];
  if (!clean.length) return { ok: true, results: [] };
  return apiFetch("/order-manager/orders/manual-checklist/bulk", {
    method: "POST",
    body: JSON.stringify({ updates: clean }),
  });
};

function filenameFromDisposition(disposition = "", fallback = "order-asset") {
  const match = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/i.exec(disposition);
  if (match && match[1]) {
    return match[1].replace(/['"]/g, "") || fallback;
  }
  return fallback;
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

window.api.downloadAsset = async (url, filename, assetId) => {
  const resolvedUrl = assetId
    ? await candidateAssetObjectUrl({ assetId, name: filename })
    : url;
  if (!resolvedUrl) throw new Error("Asset URL is required");

  const res = resolvedUrl.startsWith(API_BASE)
    ? await apiFetch(resolvedUrl.slice(API_BASE.length), { method: "GET", rawResponse: true })
    : await fetch(resolvedUrl, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }

  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition") || "";
  const safeName = filenameFromDisposition(disposition, filename || "order-asset");
  triggerBlobDownload(blob, safeName);
  return true;
};

window.api.subscribeQueueChanges = (onEvent) => {
  // Phase 1 uses authenticated polling; Phase 2 replaces this with one-use WS tickets.
  const timer = setInterval(() => {
    if (!document.hidden) onEvent({ type: "queue_changed" });
  }, 30000);
  return () => clearInterval(timer);
};
