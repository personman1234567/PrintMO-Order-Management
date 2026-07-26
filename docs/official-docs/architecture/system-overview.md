# System Overview Architecture

## Use This When
- You need a high-level conceptual understanding of the PrintMO Order Management architecture.
- You are evaluating the boundaries between the Electron desktop app, Web/Shopify Admin client, Redis queue layer, and Cloudflare proxy.

## Skip This When
- You are debugging specific IPC handlers or legacy Redis adapter behavior → read [IPC and storage](ipc-and-storage.md).
- You are looking for S&S Activewear or webhook contracts → read [External APIs](external-apis.md).

## Section Map
- [1. High-Level System Architecture](#1-high-level-system-architecture)
- [2. Execution Environments](#2-execution-environments)
- [3. Key System Invariants](#3-key-system-invariants)
- [Common Failure Modes & Recovery](#common-failure-modes--recovery)

---

## 1. High-Level System Architecture

PrintMO Order Management is designed as a hybrid desktop and web operational platform that manages Shopify order fulfillment and S&S Activewear blank-apparel batch purchasing.

```mermaid
flowchart TD
    Shopify[Shopify Admin GraphQL and Webhooks] --> CFProxy[Cloudflare Worker BFF worker.js]
    RendererUI[Desktop Renderer UI renderer.js] -->|IPC Bridge preload.js| ElectronMain[Electron main.js]
    ElectronMain -->|OIDC bearer token| CFProxy
    WebClient[Web UI order-manager-web/] -->|Shopify bearer token| CFProxy
    CFProxy --> ShopifyState[Shopify commerce + PrintMO metafield]
    CFProxy --> D1[(Cloudflare D1)]
    CFProxy --> R2[(Private Cloudflare R2)]
    CFProxy -->|Validated aggregate lines| RenderAdapter[Stateless S&S gateway]
    RenderAdapter --> SSAPI[S&S Activewear REST API]
    CFProxy -. legacy-only routes before cutover .-> RedisQueue[(Redis Cloud)]
```

---

## 2. Execution Environments

### A. Electron Desktop Runtime
- **Entry point**: `main.js` (Node.js runtime).
- **Security model**: `contextIsolation: true`, `nodeIntegration: false`. Preload script `preload.js` exposes IPC methods via `window.api`.
- **Primary Responsibility**: Manages local app windows, token custody, and the IPC bridge. It calls the authenticated Worker API and has no direct Redis or S&S connection.

### B. Web / Shopify Admin Runtime (`order-manager-web/`)
- **Entry point**: `index.html` within `order-manager-web/`.
- **Target**: Embedded within Shopify Admin iframe or standalone web browsers.
- **Data abstraction**: Uses `web-shim.js` and `storage-browser.js` to simulate IPC methods, delegating data calls to local storage or Cloudflare proxy.

### C. Cloudflare Proxy (`order-manager-proxy/`)
- **Entry point**: `worker.js`.
- **Target**: Cloudflare Workers serverless environment.
- **Primary Responsibility**: Authenticates clients, accesses Shopify, owns the D1 projection/app state, coordinates refreshes, verifies webhooks, mediates private R2, and sends validated aggregate supplier lines to the stateless S&S gateway. Explicit legacy routes remain only while the old board is retained for acceptance.

---

## 3. Key System Invariants

1. **Split acceptance boundary**: The legacy view still uses `shopifyOrdersQueue`. The Shopify board uses Shopify commerce, one app-owned production metafield, D1, and R2. Candidate edits never mirror to Redis. See `shopify-primary-data-plane.md`.
2. **Canonical candidate writes**: Shopify `$app:printmo.production_state_v1` is the only writable per-order production record. D1 is a rebuildable projection plus authoritative app-only records; it is not a second order store.
3. **Viewport Parity**: Both desktop and web platforms MUST maintain complete functional parity (viewing orders, batching blanks, adding attachments).
4. **Secret Isolation**: Frontend code in `renderer.js` or `order-manager-web/` must never contain hardcoded API keys or database URLs.

---

## Common Failure Modes & Recovery

| Symptom / Trap | Root Cause | Diagnosis & Recovery |
|---|---|---|
| Web client fails to load orders | `web-shim.js` or `storage-browser.js` fallback failed to contact proxy | Check Cloudflare Worker proxy logs in `order-manager-proxy/worker.js` and verify CORS settings. |
| Desktop app fails to load orders | OIDC or Worker connectivity failure | Check the Worker URL/public OIDC configuration and Worker logs; Electron must not contain `REDIS_URL`. |
| API key exposure build warning | Secret embedded in renderer code | Move the secret to Cloudflare Worker or Render environment secrets according to ownership. |
