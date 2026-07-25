// web-shim.js — backed by your Cloudflare Worker proxy (NO admin key in client)
const API_BASE = "https://order-manager-proxy.printmobusiness.workers.dev";

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
  if (!window.shopify || typeof window.shopify.idToken !== "function") {
    throw new Error("Shopify authentication is unavailable. Open PrintMO from Shopify Admin.");
  }
  const token = await window.shopify.idToken();
  if (!token) throw new Error("Shopify authentication did not return an ID token.");
  headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers,
  });

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
const candidateMutationChains = new Map();
let candidateForceRefreshOnce = false;
let candidateAssetHydrationRun = 0;
let candidateQueueLoadGeneration = 0;

function isShopifyCandidateView() {
  return document.body?.dataset.orderSource === "shopify";
}

function candidateStageToBoard(stage) {
  if (stage === "to_order") return "toOrder";
  if (stage === "blanks_cart" || stage === "blanks_ordered") return "blanks";
  if (stage === "print") return "print";
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
  const properties = (item.customAttributes || []).reduce((result, attribute) => {
    if (attribute?.key) result[attribute.key] = attribute.value;
    return result;
  }, {});
  return {
    id: item.id,
    title: item.title || "",
    variantTitle: item.variantTitle || "",
    sku: item.sku || "",
    qty: Number(item.currentQuantity ?? item.quantity ?? 0),
    price: Number(item.unitPrice || 0),
    unitPrice: Number(item.unitPrice || 0),
    properties,
    assets,
  };
}

function candidateOrderToBoard(order = {}, { register = true } = {}) {
  const production = order.production || {};
  const customer = selectOperationalCustomerName(order) || "Name unavailable";
  const displayName = order.displayName || order.id || "Shopify order";
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
    _gid: order.id,
    _version: Number(production.version || 0),
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
    shopify: order,
    assets: production.assets || [],
  };
  if (register) candidateOrdersByName.set(name, mapped);
  return mapped;
}

async function candidateAssetObjectUrl(asset) {
  if (!asset?.assetId) return "";
  if (candidateAssetObjectUrls.has(asset.assetId)) return candidateAssetObjectUrls.get(asset.assetId);
  const ticket = await apiFetch(
    `/order-manager/v1/assets/${encodeURIComponent(asset.assetId)}/read-ticket`,
    { method: "POST", body: "{}" }
  );
  if (!ticket?.url) throw new Error(`Private asset ticket was not returned for ${asset.name || asset.assetId}.`);
  const blob = await apiFetch(ticket.url, { method: "GET", expect: "blob" });
  const url = URL.createObjectURL(blob);
  candidateAssetObjectUrls.set(asset.assetId, url);
  return url;
}

async function hydrateCandidateAssets(records) {
  const assets = [];
  records.forEach((order) => {
    (order?.production?.assets || []).forEach((asset) => assets.push({ asset, orderId: order.id }));
  });
  const changedOrderIds = new Set();
  await Promise.all(assets.map(async ({ asset, orderId }) => {
    try {
      const previousUrl = asset.url || "";
      const nextUrl = await candidateAssetObjectUrl(asset);
      asset.url = nextUrl;
      if (nextUrl && nextUrl !== previousUrl) changedOrderIds.add(orderId);
    } catch (error) {
      console.warn("Unable to hydrate private Designer Studio asset", asset?.assetId, error);
    }
  }));
  return changedOrderIds;
}

function applyCandidateCachedAssetUrls(records) {
  records.forEach((order) => {
    (order?.production?.assets || []).forEach((asset) => {
      const cached = asset?.assetId ? candidateAssetObjectUrls.get(asset.assetId) : "";
      if (cached) asset.url = cached;
    });
  });
}

async function loadCandidateQueue({ refresh = false } = {}) {
  const loadGeneration = ++candidateQueueLoadGeneration;
  const records = [];
  let cursor = "";
  do {
    const query = buildQuery({ limit: 50, cursor, refresh: refresh ? 1 : undefined });
    const page = await apiFetch(`/order-manager/v1/orders${query}`, { method: "GET" });
    records.push(...(Array.isArray(page?.data) ? page.data : []));
    cursor = page?.pageInfo?.nextCursor || "";
  } while (cursor && records.length < 500);
  applyCandidateCachedAssetUrls(records);
  const mapped = records.map(record => candidateOrderToBoard(record, { register: false }));
  if (loadGeneration !== candidateQueueLoadGeneration) return mapped;
  candidateOrdersByName.clear();
  mapped.forEach(order => candidateOrdersByName.set(order.name, order));

  // Private Designer Studio previews are useful but must not hold the board
  // hostage. Hydrate them after commerce + production metadata has rendered.
  const hydrationRun = ++candidateAssetHydrationRun;
  void hydrateCandidateAssets(records).then((changedOrderIds) => {
    if (hydrationRun !== candidateAssetHydrationRun || !isShopifyCandidateView()) return;
    const changedStatuses = new Set();
    records.forEach((record) => {
      if (!changedOrderIds.has(record.id)) return;
      const displayName = record.displayName || record.id || "Shopify order";
      const customer = selectOperationalCustomerName(record) || "Name unavailable";
      const key = `${displayName} \u2013 ${customer}`;
      const current = candidateOrdersByName.get(key);
      if (!current) return;
      changedStatuses.add(current.status || "received");
    });
    if (!changedStatuses.size) return;
    if (typeof window.renderBoardFromLocalState === "function") {
      void window.renderBoardFromLocalState(changedStatuses);
    } else if (typeof window.renderStatusColumn === "function") {
      changedStatuses.forEach((status) => window.renderStatusColumn(status));
    }
  }).catch((error) => {
    console.warn("Unable to hydrate Shopify board previews", error);
  });
  return mapped;
}

function candidateByName(name) {
  const order = candidateOrdersByName.get(name);
  if (!order) throw new Error("The Shopify order is no longer in the current board view. Refresh and try again.");
  return order;
}

function applyCandidateProduction(order, production = {}) {
  order._version = Number(production.version ?? production.revision ?? order._version + 1);
  if (production.stage) order.status = candidateStageToBoard(production.stage);
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
window.api.getQueue = async () => {
  if (isShopifyCandidateView()) {
    const refresh = candidateForceRefreshOnce;
    candidateForceRefreshOnce = false;
    return loadCandidateQueue({ refresh });
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

// Production metadata is separate from the Shopify commerce response. These
// endpoints update the v1 order hash and atomically mirror supported fields to
// the legacy Redis queue while that board remains in production.
window.api.getProductionMetadata = async (orderId) => {
  if (!orderId) throw new Error("A Shopify order ID is required");
  return apiFetch(
    `/order-manager/v1/orders/${encodeURIComponent(orderId)}/production`,
    { method: "GET" }
  );
};

window.api.updateProductionMetadata = async (orderId, payload = {}) => {
  if (!orderId) throw new Error("A Shopify order ID is required");
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
  if (isShopifyCandidateView()) return updateCandidateOrder(payload.name, { printed_count: Number(payload.progress || 0) });
  return apiFetch("/order-manager/v1/legacy/queue/mutate", {
    method: "POST",
    body: JSON.stringify({ orderName: payload.name, patch: { progress: payload.progress } }),
  });
};

window.api.updateName = async (a, b) => {
  const payload = (a && typeof a === "object") ? a : { name: a, newName: b };
  if (isShopifyCandidateView()) {
    throw new Error("Customer names come from Shopify and cannot be changed from the production board.");
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
    return updateCandidateOrder(payload.name, { archived_at: now, archived_by: "shopify-admin" });
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
    const result = await apiFetch("/order-manager/v1/batches/commit", {
      method: "POST",
      body: JSON.stringify({
        orderIds: orders.map((order) => order._gid),
        idempotencyKey: newIdempotencyKey("batch"),
      }),
    });
    const now = Date.now();
    orders.forEach((order) => {
      order.status = "blanks";
      order.blanksOrdered = 1;
      order._batchConfirmedAt = now;
      if (result?.poNumber) order.blanksPo = [result.poNumber];
    });
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

window.api.getStorageObjectUrl = async (key) => {
  if (!key) return "";
  if (storageObjectUrls.has(key)) return storageObjectUrls.get(key);
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
  return updateCandidateOrder(name, metadataPatch);
};

async function hydrateAssetUrls(result) {
  const manifests = result?.orders && typeof result.orders === "object"
    ? Object.values(result.orders)
    : [result];
  for (const manifest of manifests) {
    for (const asset of (manifest?.assets || [])) {
      if (asset?.key) asset.url = await window.api.getStorageObjectUrl(asset.key);
    }
  }
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

window.api.bulkListManualMockups = async (orderNumbers) => {
  const unique = Array.from(new Set((Array.isArray(orderNumbers) ? orderNumbers : []).filter(Boolean)));
  if (!unique.length) return { orders: {} };
  return hydrateAssetUrls(await apiFetch("/order-manager/orders/manual-mockups/bulk", {
    method: "POST",
    body: JSON.stringify({ orderNumbers: unique }),
  }));
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

window.api.downloadAsset = async (url, filename) => {
  if (!url) throw new Error("Asset URL is required");

  const res = url.startsWith(API_BASE)
    ? await apiFetch(url.slice(API_BASE.length), { method: "GET", rawResponse: true })
    : await fetch(url, { cache: "no-store" });
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
