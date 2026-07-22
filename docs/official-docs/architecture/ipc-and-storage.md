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

The Electron main process (`main.js`) handles these channels by executing operations against Redis list `shopifyOrdersQueue`:

- `get-queue`: Fetches all list entries via `lRange('shopifyOrdersQueue', 0, -1)`, parses JSON, patches missing default attributes, and rewrites normalized list entries back to Redis.
- `update-status`: Reads entry at index `LINDEX`, mutates `.status`, and writes back with `LSET`.
- `add-file` / `remove-files`: Appends or removes Base64-encoded attachment objects in the target order's `.files` array.
- `process-batch`: Aggregates line items by SKU across selected orders, calls the S&S Activewear API, records blank order confirmation numbers, and updates order status to `blanks`.

---

## 3. Redis Data Schema (shopifyOrdersQueue)

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
| Index mismatch on Redis update | Race condition when list entries shift while an index-based `LSET` is executed | Verify list indices prior to write; use order `id` matching where possible. |
| Redis memory spike or slow `getQueue` | Large Base64 attachment files stored directly in list JSON | Inspect file upload sizes; compress or move large attachments to external blob storage. |
| `TypeError: window.api.getQueue is not a function` in web mode | `web-shim.js` or `storage-browser.js` failed to initialize | Ensure `web-shim.js` is loaded prior to `renderer.js` in `order-manager-web/index.html`. |
