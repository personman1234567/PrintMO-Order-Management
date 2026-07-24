# Troubleshooting & Environmental Traps Runbook

## Use This When
- You encounter a runtime error, UI freeze, failed IPC message, or Redis sync anomaly.
- You need a symptom-to-boundary lookup path to diagnose recurring issues instantly without re-debugging.

## Skip This When
- You are setting up your development environment from scratch $\rightarrow$ read [runbooks/dev-setup-and-build.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/runbooks/dev-setup-and-build.md).
- You are reviewing system architecture contracts $\rightarrow$ read [architecture/system-overview.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/architecture/system-overview.md).

## Section Map
- [1. Diagnostic Symptom Matrix](#1-diagnostic-symptom-matrix)
- [2. Detailed Troubleshooting & Recovery Procedures](#2-detailed-troubleshooting--recovery-procedures)
- [Common Failure Modes & Recovery](#common-failure-modes--recovery)

---

## 1. Diagnostic Symptom Matrix

| Observed Symptom | Primary Fault Boundary | Target Code Location | Primary Action / Recovery |
|---|---|---|---|
| Large file attachments cause slow UI load or Redis timeouts | Base64 payload size bloat in Redis list items | `main.js:149-177`, `renderer.js:910-961` | Compress attachment image client-side prior to Base64 encoding. |
| Dragged Kanban card resets position after drop | Out-of-sync list array index during Redis `LSET` | `main.js:93-105`, `renderer.js:1290-1310` | Force full queue refresh (`getQueue`) before index mutation. |
| Web client error: `window.api is undefined` | Web shim loading order mismatch | `order-manager-web/web-shim.js`, `order-manager-web/index.html` | Verify `web-shim.js` is loaded prior to `renderer.js` script tag. |
| Redis board shows zero cards while bundle tiles remain; console says `(assets || []).forEach is not a function` | A legacy line item contains a non-array `assets` value, causing card rendering to stop mid-board | `renderer.js:splitOrderAssets`, `order-manager-web/renderer.js:splitOrderAssets` | Confirm queue length read-only before any restore. Current renderers ignore malformed asset containers and continue rendering; inspect and repair the source record separately only if its missing artwork is operationally important. |
| Shopify detail error: `404 - [object Object]` | Historical symptom of denied `fulfillmentOrders` access or another structured upstream error being rendered poorly | `order-manager-proxy/worker.js`, `order-manager-web/web-shim.js`, `order-manager-proxy/shopify.app.toml` | Do not assume the order is missing. Follow Procedure C and compare the installed scopes with the currently released app version. |
| Shopify detail customer fields say `Not returned` | Guest checkout or unapproved protected customer fields | `order-manager-proxy/worker.js`, Shopify app API access requests | Compare with Shopify Admin, then follow Procedure D before changing requested PII. |
| Shopify board switch reports `503 - [object Object]` | The D1 projection has no migration/bootstrap checkpoint, and an older web bundle failed to render the structured Worker error | `handleV1OrdersGet`, `bootstrapInitialBoard`, `order-manager-web/web-shim.js:apiErrorMessage` | Deploy the current Worker and Pages bundle. The first candidate read performs a bounded paid/open Shopify bootstrap; if that read fails, the UI now shows `BOARD_NOT_INITIALIZED` with a request ID instead of a false empty board. |
| Shopify board selector activates but the workspace is completely blank | Obsolete diagnostic-preview CSS hides `#orders-view` while the source controller also hides the retired preview table | `order-manager-web/shopify-preview.css`, `shopify-preview.js:setPreviewActive` | The shared Kanban must remain visible for both sources. Do not add a `body[data-order-source="shopify"] #orders-view { display: none }` rule; `npm run verify:phase2` enforces this regression contract. |
| Packaged desktop app fails to connect to Redis | `process.resourcesPath` `.env` path resolution failure | `main.js:7-21` | Ensure `.env` is properly copied by `electron-builder` `extraResources`. |
| S&S Batch submission returns 401 Unauthorized | Missing or expired `SS_API_KEY` | `main.js:206-258` | Check `.env` key value; re-authenticate credentials. |

---

## 2. Detailed Troubleshooting & Recovery Procedures

### A. Diagnosing Base64 Attachment Bloat
- **Trap**: Uploading high-resolution PNG mockups encodes raw image files as multi-megabyte Base64 strings embedded directly inside `shopifyOrdersQueue` JSON objects.
- **Symptom**: Redis `LRANGE` calls stall for several seconds; UI freezes during card render.
- **Recovery**:
  1. Inspect queue items in Redis using `redis-cli LRANGE shopifyOrdersQueue 0 5`.
  2. Clear oversized Base64 strings from affected items.
  3. Ensure client-side image downscaling (max 1024px width) before calling `window.api.addFile`.

### B. Index Shift & Array Mutation Race Conditions
- **Trap**: Electron IPC methods (`update-status`, `delete-order`, `update-ready`) mutate Redis list items by zero-based index (`LSET shopifyOrdersQueue <index> <json>`).
- **Symptom**: If an order is deleted or ingested while a user is dragging a card, the target index shifts, resulting in the wrong order being mutated.
- **Recovery**:
  1. Match target order `id` string before executing index mutations.
  2. Implement optimistic UI locking or immediate re-fetch (`getQueue`).

### C. Shopify Live Detail Scope Failure

- **Observed symptom**: The Shopify list loads, but clicking a known order opens an empty read-only dialog with `Shopify order details could not load: 404 - [object Object]`; DevTools shows the detail GET returning 404.
- **Actual upstream result**: Shopify returns HTTP 200, `data.order: null`, and `ACCESS_DENIED` at GraphQL path `order.fulfillmentOrders`. The order still exists.
- **Why the displayed error is misleading**: The Worker treats every null order as `ORDER_NOT_FOUND`; `web-shim.js` then converts the nested `{ error: { code, message, requestId } }` body to `[object Object]`.
- **Current live authorization**: The required fulfillment-order scopes were released and approved on 2026-07-23, and rich detail was verified live. If this symptom returns, first confirm that the request is using the production `Print-MO` installation and that its approved scopes still match the released app version.
- **Recovery choices**:
  1. Permission route: add the minimum fulfillment-order read scopes, release a Shopify app version, and approve the updated permissions on the production store installation.
  2. Code route: preserve Shopify's partial GraphQL errors and render the structured message clearly if another optional field is denied.
- **Verification**: After a scope release, retry a recent known order and confirm the GraphQL operation returns a non-null order. A Worker/Pages redeploy by itself cannot update installed Shopify permissions.

### D. Protected Customer Data Redaction

- Shopify order/customer/shipping data is protected customer data; name, address, phone, and email are protected fields requested individually.
- Unapproved fields can return null plus GraphQL errors while approved order fields remain available.
- Confirm the field exists in Shopify Admin before assuming a permission issue. Request only operationally necessary fields through the app's API access requests and keep the Redis board available during approval.
- Reference: [Shopify protected customer data](https://shopify.dev/docs/apps/launch/protected-customer-data).

### E. Empty Redis Board Caused by Malformed Line-Item Assets

- **Observed symptom**: Board counts/cards fall to zero or rendering stops, while a bundle tile may already be visible and Redis still contains orders. DevTools reports `TypeError: (assets || []).forEach is not a function` from `splitOrderAssets`.
- **Meaning**: This is a client rendering failure, not proof of queue deletion. One line item's `assets` field is present but is not an array (for example `{}`).
- **Safe diagnosis**: Check `LLEN shopifyOrdersQueue`, JSON parse success, status counts, and `Array.isArray(item.assets)` without logging customer details, attachment payloads, credentials, or full orders. Do not restore a backup merely because the board is blank.
- **Shipped behavior**: Desktop and embedded-web renderers normalize non-array line-item asset containers to an empty list. The affected card remains usable but cannot show artwork from that malformed field; other cards continue rendering.
- **2026-07-22 incident**: All 21 queue records were intact and parseable. One item on order `#1558` contained `assets: {}`. No Redis mutation or restore was required.

---

## Common Failure Modes & Recovery

| Trap / Pattern | Prevention Invariant |
|---|---|
| Bypassing `contextBridge` | Never set `nodeIntegration: true` in `main.js`. Keep main and renderer processes strictly isolated. |
| Hardcoding local API endpoints | Use `order-manager-proxy` environment configuration for production web deployments. |
