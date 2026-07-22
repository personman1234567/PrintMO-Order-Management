// web-shim.js — backed by your Cloudflare Worker proxy (NO admin key in client)
const API_BASE = "https://order-manager-proxy.printmobusiness.workers.dev";

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
      if (!text) return "";
      try {
        const data = JSON.parse(text);
        const msg = data?.error || data?.message || data?.msg;
        if (msg) return String(msg);
      } catch (_) {
        // not JSON, fall through
      }
      return text;
    } catch (_) {
      return "";
    }
  };

  if (!res.ok) {
    const msg = await parseErrorBody();
    const base = `${res.status} ${res.statusText}`.trim();
    throw new Error([base, msg].filter(Boolean).join(" - "));
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

window.api = window.api || {};
window.api.transport = "http";

// 1) Populate dashboard
window.api.getQueue = async () => {
  const data = await apiFetch("/order-manager/v1/legacy/queue", { method: "GET" });
  return Array.isArray(data) ? data : (data?.orders || []);
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

// 2) Drag/drop persistence
window.api.updateStatus = async (name, status) => {
  await apiFetch("/order-manager/v1/legacy/queue/mutate", {
    method: "POST",
    body: JSON.stringify({ orderName: name, patch: { status } }),
  });
  return true;
};

window.api.updateNotes = async (a, b) => {
  const payload = (a && typeof a === "object") ? a : { name: a, notes: b };
  return apiFetch("/order-manager/v1/legacy/queue/mutate", {
    method: "POST",
    body: JSON.stringify({ orderName: payload.name, patch: { notes: payload.notes } }),
  });
};

window.api.setBundle = async (a, b) => {
  const payload = Array.isArray(a)
    ? { names: a, bundle: b }
    : ((a && typeof a === "object") ? a : { name: a, bundle: b });
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
  return apiFetch("/order-manager/v1/legacy/queue/mutate", {
    method: "POST",
    body: JSON.stringify({ orderName: name, patch }),
  });
};

window.api.updateProgress = async (a, b) => {
  const payload = (a && typeof a === "object") ? a : { name: a, progress: b };
  return apiFetch("/order-manager/v1/legacy/queue/mutate", {
    method: "POST",
    body: JSON.stringify({ orderName: payload.name, patch: { progress: payload.progress } }),
  });
};

window.api.updateName = async (a, b) => {
  const payload = (a && typeof a === "object") ? a : { name: a, newName: b };
  return apiFetch("/order-manager/v1/legacy/queue/mutate", {
    method: "POST",
    body: JSON.stringify({ orderName: payload.name, patch: { custName: payload.newName ?? payload.custName } }),
  });
};

window.api.deleteOrder = async (a) => {
  const payload = (a && typeof a === "object") ? a : { name: a };
  return apiFetch("/order-manager/v1/legacy/queue/item", {
    method: "DELETE",
    body: JSON.stringify({ orderName: payload.name }),
  });
};

window.api.updateBundleStatus = async (bundleName, status) => {
  const payload = (bundleName && typeof bundleName === "object")
    ? bundleName
    : { bundle: bundleName, name: bundleName, status };

  return apiFetch("/order-manager/v1/legacy/queue/mutate", {
    method: "POST",
    body: JSON.stringify({ bundleName: payload.bundle, patch: { status: payload.status } }),
  });
};

window.api.processBatch = async (orderIds) => {
  const names = Array.isArray(orderIds) ? orderIds : [];
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
  const timer = setInterval(() => onEvent({ type: "queue_changed" }), 30000);
  return () => clearInterval(timer);
};
