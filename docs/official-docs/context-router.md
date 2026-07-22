# Context Router

> **Fast Tabular Lookup Route for AI Agents & Developers**

Use this router to find the exact document and code entry point for your task. Read *only* the indicated document and source file range to minimize token usage.

---

## Task & Symptom Routing Table

| Task / Symptom / Focus Area | First Doc to Read | Primary Source Code Files | Adjacent / Secondary Docs | Stop / Ask Condition |
|---|---|---|---|---|
| Modifying Electron IPC, Redis storage, or main process initialization | [architecture/ipc-and-storage.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/architecture/ipc-and-storage.md) | `main.js:7-180`, `preload.js:1-25` | [runbooks/troubleshooting.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/runbooks/troubleshooting.md) | Stop & ask if mutating Redis list structures or changing key names |
| UI Kanban drag-and-drop, card layout, or detail modal adjustments | [workflows/order-ingestion-kanban.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/workflows/order-ingestion-kanban.md) | `renderer.js`, `index.html` | [reference/ui-containers-and-views.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/reference/ui-containers-and-views.md) | Stop & ask if adding new Kanban columns or changing order state enums |
| Auditing UI containers, card tiles, modal overlays, or field data origins | [reference/ui-containers-and-views.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/reference/ui-containers-and-views.md) | `index.html`, `renderer.js` | [reference/source-map.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/reference/source-map.md) | Stop & ask if altering core JSON schema field paths in Redis |
| S&S Activewear SKU aggregation, pricing, or batch ordering | [workflows/blanks-batching.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/workflows/blanks-batching.md) | `main.js:206-258`, `renderer.js:1330-1340` | [architecture/external-apis.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/architecture/external-apis.md) | Stop & ask if modifying S&S authentication or payload schemas |
| Web client porting, Cloudflare Worker proxy, or browser storage fallback | [workflows/web-shopify-porting.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/workflows/web-shopify-porting.md) | `order-manager-web/*`, `order-manager-proxy/worker.js` | [architecture/system-overview.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/architecture/system-overview.md) | Stop & ask if modifying CORS headers or environment secrets |
| Shopify live preview/detail, `404 - [object Object]`, missing customer data, or Shopify scope diagnosis | [workflows/web-shopify-porting.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/workflows/web-shopify-porting.md) | `order-manager-web/shopify-preview.js`, `order-manager-web/web-shim.js`, `order-manager-proxy/worker.js`, `order-manager-proxy/shopify.app.toml` | [runbooks/troubleshooting.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/runbooks/troubleshooting.md), [reference/test-map.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/reference/test-map.md) | Stop & ask before requesting broader Shopify or protected-customer-data access |
| Troubleshooting UI freezes, base64 payload traps, or broken attachments | [runbooks/troubleshooting.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/runbooks/troubleshooting.md) | `main.js:149-177`, `renderer.js:910-961` | [architecture/ipc-and-storage.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/architecture/ipc-and-storage.md) | Stop & ask if data corruption in Redis list items is detected |
| Development setup, running local Electron builds, or packaging | [runbooks/dev-setup-and-build.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/runbooks/dev-setup-and-build.md) | `package.json`, `scripts/prepare-cloudflare-pages-upload.sh` | [reference/test-map.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/reference/test-map.md) | Stop & ask if build tools fail or electron-builder fails |
| Planning or building a new feature proposal | [future-plans/README.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/future-plans/README.md) | Target plan in `docs/official-docs/future-plans/` | [runbooks/doc-governance.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/runbooks/doc-governance.md) | Stop & ask if feature requirements contradict shipped invariants |
| Reviewing historical notes or archived plans | [legacy/README.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/legacy/README.md) | `docs/official-docs/legacy/*` | N/A | Stop & ask if attempting to revive deprecated architectural patterns |

---

## Quick Navigation Instructions

1. Identify your current objective or issue in the **Task / Symptom** column.
2. Click the link in **First Doc to Read** and review the document header (`## Use This When`, `## Skip This When`).
3. Open the corresponding **Primary Source Code Files** for targeted editing.
