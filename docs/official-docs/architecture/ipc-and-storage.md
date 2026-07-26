# IPC and Storage Architecture

## Use This When

- You are modifying Electron startup, authenticated Worker transport, IPC handlers, or `window.api`.
- You need to distinguish the isolated Legacy Redis view from the Shopify-primary candidate.
- You are diagnosing desktop authentication, IPC, legacy queue, or attachment behavior.

## Skip This When

- You are changing only the Shopify/D1/R2 candidate → read [Shopify-primary data plane](shopify-primary-data-plane.md).
- You are changing card layout or drag/drop → read [Order ingestion and Kanban](../workflows/order-ingestion-kanban.md).
- You are changing embedded browser adapters → read [Web and Shopify porting](../workflows/web-shopify-porting.md).

## Section Map

- [IPC Bridge and Electron Transport](#ipc-bridge-and-electron-transport)
- [Legacy Redis Boundary](#legacy-redis-boundary)
- [Shopify Candidate Boundary](#shopify-candidate-boundary)
- [Attachment and Browser Storage Boundaries](#attachment-and-browser-storage-boundaries)
- [Common Failure Modes & Recovery](#common-failure-modes--recovery)

## IPC Bridge and Electron Transport

Electron maintains `contextIsolation: true` and `nodeIntegration: false`. `preload.js` exposes the renderer API through `contextBridge.exposeInMainWorld`.

Representative methods include:

```javascript
getQueue: () => ipcRenderer.invoke('get-queue')
updateStatus: (orderId, status) => ipcRenderer.invoke('update-status', orderId, status)
processBatch: orderIds => ipcRenderer.invoke('process-batch', orderIds)
downloadAsset: (url, filename) => ipcRenderer.invoke('download-asset', url, filename)
```

`main.js` owns:

- loading public Worker/OIDC runtime configuration;
- obtaining a short-lived token through `DesktopOidcAuth`;
- attaching the bearer token to Worker calls through `workerFetch`;
- legacy-compatible IPC handlers;
- authenticated asset download;
- BrowserWindow creation.

Electron contains no direct Redis client or S&S credentials. Production packages contain public runtime configuration only and explicitly exclude `.env`.

## Legacy Redis Boundary

The Legacy Redis board remains an isolated pre-cutover fallback:

```text
Desktop or web legacy view
→ authenticated Worker /legacy route
→ authenticated Render legacy adapter
→ shopifyOrdersQueue
```

- Only the Render legacy adapter owns `REDIS_URL`.
- Candidate reads and mutations never mirror into this queue.
- The legacy queue may still receive paid-order ingestion while `LEGACY_INGEST_ENABLED=1`.
- Queue mutations are addressed by stable order/bundle identity at the client boundary; the adapter owns atomic Redis mutation details.
- Full queue backup is available through `npm run repo -- redis backup`.

The queue contains legacy JSON order objects and may include Base64 attachment payloads. It is not the target architecture for new features.

## Shopify Candidate Boundary

The Shopify board bypasses legacy queue routes:

```text
Embedded web candidate view
→ authenticated Worker candidate endpoint
→ Shopify canonical production metafield
→ D1 projection/app records
→ private R2 assets
```

Shopify owns commerce facts and the per-order production authority. D1 is a rebuildable board index plus authoritative app-only relational records. R2 owns private asset bytes.

See [Shopify-primary data plane](shopify-primary-data-plane.md) for concurrency, idempotency, webhook, reconciliation, asset, migration, and batch contracts.

## Attachment and Browser Storage Boundaries

- Legacy attachments may remain Base64 inside legacy queue items and can make full-list reads expensive.
- Candidate artwork is represented by D1 manifests and private R2 bytes; board DTOs never expose object keys.
- Candidate cards render before private ticket hydration completes.
- `order-manager-web/web-shim.js` provides the source-aware browser API.
- `storage-browser.js` is a browser storage/endpoint adapter; it must not become a client-side infrastructure credential holder.

## Common Failure Modes & Recovery

| Symptom | Cause | Recovery |
|---|---|---|
| Desktop reports sign-in failure | OIDC configuration, browser authorization, token refresh, or Worker trust failure | Inspect `DesktopOidcAuth` and `workerFetch`; run Phase 1 verification. |
| `window.api` is missing in Electron | Preload failed or context bridge contract changed | Check `preload.js`, BrowserWindow preload path, and syntax. |
| `window.api` is missing on web | `web-shim.js` loaded after the renderer or failed initialization | Preserve script ordering and run the web route verification. |
| Legacy queue is slow | Large Base64 payloads make full-list transport expensive | Inspect payload size safely; avoid high-frequency full-list operations. |
| Candidate edit changes Legacy Redis | Source isolation was violated | Stop, restore source-aware routing, and run Phase 2 verification. |
