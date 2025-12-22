// web-shim.js — backed by your Cloudflare Worker proxy (NO admin key in client)
const API_BASE = "https://order-manager-proxy.printmobusiness.workers.dev";

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} ${text}`);
  }

  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : null;
}

window.api = window.api || {};

// 1) Populate dashboard
window.api.getQueue = async () => {
  const data = await apiFetch("/order-manager/queue", { method: "GET" });
  return data.orders || [];
};

// 2) Drag/drop persistence
window.api.updateStatus = async (name, status) => {
  await apiFetch("/order-manager/orders/status", {
    method: "PATCH",
    body: JSON.stringify({ name, status }),
  });
  return true;
};

window.api.updateNotes = async (a, b) => {
  const payload = (a && typeof a === "object") ? a : { name: a, notes: b };
  return apiFetch("/order-manager/orders/notes", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
};

window.api.setBundle = async (a, b) => {
  const payload = (a && typeof a === "object") ? a : { name: a, bundle: b };
  return apiFetch("/order-manager/orders/bundle", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
};

window.api.updateReady = async (...args) => {
  // supports either (obj) or (name, partialObj)
  const payload =
    (args[0] && typeof args[0] === "object")
      ? args[0]
      : { name: args[0], ...(args[1] || {}) };

  return apiFetch("/order-manager/orders/ready", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
};

window.api.updateProgress = async (a, b) => {
  const payload = (a && typeof a === "object") ? a : { name: a, progress: b };
  return apiFetch("/order-manager/orders/progress", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
};

window.api.updateName = async (a, b) => {
  const payload = (a && typeof a === "object") ? a : { name: a, newName: b };
  return apiFetch("/order-manager/orders/rename", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
};

window.api.deleteOrder = async (a) => {
  const payload = (a && typeof a === "object") ? a : { name: a };
  return apiFetch("/order-manager/orders/delete", {
    method: "POST",
    body: JSON.stringify(payload),
  });
};
