# IPC and Storage Architecture

## Use This When
- You are modifying Electron main process IPC handlers in `main.js`.
- You are updating the `preload.js` bridge contract (`window.api`).
- You are working on Redis queue persistence (`shopifyOrdersQueue`) or browser fallback storage (`storage-browser.js`).

## Skip This When
- You are modifying UI CSS or drag-and-drop animations $\rightarrow$ read [workflows/order-ingestion-kanban.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/workflows/order-ingestion-kanban.md).
- You are configuring Cloudflare worker endpoints $\rightarrow$ read [workflows/web-shopify-porting.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/workflows/web-shopify-porting.md).

## Section Map
- [1. IPC Bridge Contract (preload.js)](#1-ipc-bridge-contract-preloadjs)
- [2. Main Process Handlers (main.js)](#2-main-process-handlers-mainjs)
- [3. Redis Data Schema (shopifyOrdersQueue)](#3-redis-data-schema-shopifyordersqueue)
- [4. Web Storage Fallback (storage-browser.js)](#4-web-storage-fallback-storage-browserjs)
- [Common Failure Modes & Recovery](#common-failure-modes--recovery)

---

## 1. IPC Bridge Contract (preload.js)

The renderer process accesses Node/Electron capabilities exclusively via `window.api`:

```javascript
// Exposed IPC surface in preload.js
contextBridge.exposeInMainWorld('api', {
  getQueue: () => ipcRenderer.invoke('get-queue'),
  updateStatus: (index, status) => ipcRenderer.invoke('update-status', { index, status }),
  processBatch: (toOrder) => ipcRenderer.invoke('process-batch', toOrder),
  updateReady: (index, isReady) => ipcRenderer.invoke('update-ready', { index, isReady }),
  deleteOrder: (index) => ipcRenderer.invoke('delete-order', { index }),
  setBundle: (index, isBundle, subOrders) => ipcRenderer.invoke('set-bundle', { index, isBundle, subOrders }),
  updateBundleStatus: (index, subOrderIndex, status) => ipcRenderer.invoke('update-bundle-status', { index, subOrderIndex, status }),
  addFile: (index, fileData) => ipcRenderer.invoke('add-file', { index, fileData }),
  removeFiles: (index, fileIndices) => ipcRenderer.invoke('remove-files', { index, fileIndices }),
  updateNotes: (index, notes) => ipcRenderer.invoke('update-notes', { index, notes }),
  updateName: (index, name) => ipcRenderer.invoke('update-name', { index, name }),
  updateProgress: (index, progress) => ipcRenderer.invoke('update-progress', { index, progress }),
  downloadAsset: (url, filename) => ipcRenderer.invoke('download-asset', { url, filename }),
  getAssetPath: (relativePath) => ipcRenderer.sendSync('get-asset-path', relativePath)
});
```

---

## 2. Main Process Handlers (main.js)

Electron preserves the existing `window.api` IPC contract, but `main.js` now sends every queue and S&S operation to authenticated `/order-manager/v1/legacy/*` Worker endpoints. Electron obtains a short-lived OIDC ID token through Authorization Code + PKCE in the system browser and stores only a rotating refresh token through `safeStorage`.

- Electron contains no direct Redis or S&S code path and packages no `.env`.
- `get-queue` reads the legacy list through the Worker adapter.
- The Worker forwards queue operations over authenticated HTTPS to the Render data adapter; only that adapter holds `REDIS_URL`.
- Queue mutations and deletion are executed by atomic Redis Lua scripts in the Render adapter.
- `process-batch` executes through the authenticated Worker and Render adapter; S&S credentials remain server-only.

---

## 3. Redis Data Schema (shopifyOrdersQueue)

During candidate acceptance, this list remains the source for the explicitly labeled **Legacy Redis** view only. The **Shopify board** does not read, mirror, or mutate it; that view uses the app-owned Shopify production metafield plus D1/R2 as documented in `shopify-primary-data-plane.md`. Incoming paid-order ingestion may continue reaching the legacy list while `LEGACY_INGEST_ENABLED=1` so the old view remains usable before owner-approved cutover.

The queue stores a JSON-serialized list under the key `shopifyOrdersQueue`:

```json
{
  "id": "1001",
  "name": "#1001",
  "created_at": "2026-07-21T20:00:00Z",
  "status": "payment_received",
  "isReady": false,
  "notes": "",
  "files": [
    {
      "name": "front_mockup.png",
      "data": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
      "type": "image/png"
    }
  ],
  "line_items": [
    {
      "sku": "2000-WHT-L",
      "title": "Gildan Ultra Cotton Tee - White / L",
      "quantity": 12,
      "price": "15.00"
    }
  ]
}
```

---

## 4. Web Storage Fallback (storage-browser.js)

In the web interface (`order-manager-web/`), native IPC is unavailable (`window.api` is undefined). `storage-browser.js` provides an identical interface backed by browser `localStorage` or remote Cloudflare endpoints:

- Emulates `window.api` methods asynchronously.
- Preserves identical order data model for seamless cross-platform support.

---

## Common Failure Modes & Recovery

| Symptom / Trap | Root Cause | Diagnosis & Recovery |
|---|---|---|
| Queue mutation conflict or shifted index | A caller bypassed the authenticated Worker/Render Lua adapter | Confirm both clients use `/order-manager/v1/legacy/*`; only the Render service may contain `REDIS_URL`. |
| Redis memory spike or slow `getQueue` | Large Base64 attachment files stored directly in list JSON | Inspect file upload sizes; compress or move large attachments to external blob storage. |
| `TypeError: window.api.getQueue is not a function` in web mode | `web-shim.js` or `storage-browser.js` failed to initialize | Ensure `web-shim.js` is loaded prior to `renderer.js` in `order-manager-web/index.html`. |
