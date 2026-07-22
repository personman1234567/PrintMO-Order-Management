# Code Source Map & Module Ownership

## Use This When
- You need to map a component, module, or function to its physical file and line range.
- You are determining file ownership across Electron desktop, Web client, and Cloudflare Worker code.

## Skip This When
- You are looking for test verification commands $\rightarrow$ read [reference/test-map.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/reference/test-map.md).

## Section Map
- [1. Core Desktop App (Electron)](#1-core-desktop-app-electron)
- [2. Web Client (order-manager-web/)](#2-web-client-order-manager-web)
- [3. Cloudflare Worker Proxy (order-manager-proxy/)](#3-cloudflare-worker-proxy-order-manager-proxy)
- [4. Deployment & Helper Scripts](#4-deployment--helper-scripts)

---

## 1. Core Desktop App (Electron)

| File / Component | Primary Responsibilities | Key Functions / Line Ranges |
|---|---|---|
| [main.js](file:///e:/PrintMO/PrintMO-Order-Management/main.js) | App boot, env loading, Redis connection, BrowserWindow creation, IPC handler registration | Env/Redis Init (`L7-25`), IPC Registration (`L60-205`), S&S Batch Ordering (`L206-258`), Download Handler (`L260-286`) |
| [preload.js](file:///e:/PrintMO/PrintMO-Order-Management/preload.js) | Secure IPC bridge binding renderer to main process via `contextBridge` | `contextBridge.exposeInMainWorld('api', ...)` (`L4-24`) |
| [renderer.js](file:///e:/PrintMO/PrintMO-Order-Management/renderer.js) | DOM rendering, Kanban board state, drag-and-drop handlers, modal views, file uploads | Queue Fetch & Render (`L1080-1120`), Drag & Drop (`L1290-1310`), Batch Submission (`L1330-1350`), Attachments (`L910-961`) |
| [index.html](file:///e:/PrintMO/PrintMO-Order-Management/index.html) | Main HTML layout, modal templates, inline styles | Modal Containers, Column Dropzones, Script Inclusions |

---

## 2. Web Client (`order-manager-web/`)

| File / Component | Primary Responsibilities |
|---|---|
| [index.html](file:///e:/PrintMO/PrintMO-Order-Management/order-manager-web/index.html) | Standalone web / Shopify Admin iframe container |
| [renderer.js](file:///e:/PrintMO/PrintMO-Order-Management/order-manager-web/renderer.js) | Web-specific renderer logic adapted for browser DOM |
| [web-shim.js](file:///e:/PrintMO/PrintMO-Order-Management/order-manager-web/web-shim.js) | Shim replacing Electron `window.api` with web-safe async handlers |
| [storage-browser.js](file:///e:/PrintMO/PrintMO-Order-Management/order-manager-web/storage-browser.js) | LocalStorage & remote endpoint storage adapter |
| [blanks-batches.js](file:///e:/PrintMO/PrintMO-Order-Management/order-manager-web/blanks-batches.js) | Batch ordering and blank-apparel aggregation module |
| [detail-overlay-enhancements.js](file:///e:/PrintMO/PrintMO-Order-Management/order-manager-web/detail-overlay-enhancements.js) | Enhanced order detail modal & variant breakdown views |
| [desktop-drag-polish.js](file:///e:/PrintMO/PrintMO-Order-Management/order-manager-web/desktop-drag-polish.js) | Smooth drag-and-drop animation & visual cues |
| [manual-add-checklist.js](file:///e:/PrintMO/PrintMO-Order-Management/order-manager-web/manual-add-checklist.js) | Manual order creation & checklist overlay |
| [dashboard-triage-enhancements.js](file:///e:/PrintMO/PrintMO-Order-Management/order-manager-web/dashboard-triage-enhancements.js) | High-priority order badges & time-ago metrics |
| [desktop.css](file:///e:/PrintMO/PrintMO-Order-Management/order-manager-web/desktop.css) | Desktop viewport design system & layout styles |
| [mobile.css](file:///e:/PrintMO/PrintMO-Order-Management/order-manager-web/mobile.css) | Mobile & Shopify Admin constrained viewport styles |

---

## 3. Cloudflare Worker Proxy (`order-manager-proxy/`)

| File / Component | Primary Responsibilities |
|---|---|
| [worker.js](file:///e:/PrintMO/PrintMO-Order-Management/order-manager-proxy/worker.js) | Serverless proxy for S&S Activewear API, CORS handling, and remote Redis bridging |

---

## 4. Deployment & Helper Scripts

| File / Component | Primary Responsibilities |
|---|---|
| [package.json](file:///e:/PrintMO/PrintMO-Order-Management/package.json) | NPM build scripts (`start`, `dist`, `prepare:cloudflare`), electron-builder configuration |
| [scripts/prepare-cloudflare-pages-upload.sh](file:///e:/PrintMO/PrintMO-Order-Management/scripts/prepare-cloudflare-pages-upload.sh) | Build packaging script for Cloudflare Pages web deployment |
