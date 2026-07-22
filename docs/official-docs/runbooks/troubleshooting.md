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

---

## Common Failure Modes & Recovery

| Trap / Pattern | Prevention Invariant |
|---|---|
| Bypassing `contextBridge` | Never set `nodeIntegration: true` in `main.js`. Keep main and renderer processes strictly isolated. |
| Hardcoding local API endpoints | Use `order-manager-proxy` environment configuration for production web deployments. |
