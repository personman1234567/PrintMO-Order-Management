# Worker and Shopify Data-Plane Instructions

- Read the `shopify-data-plane` route before changing Worker, D1, R2, webhook, reconciliation, migration, batch, or Admin-block behavior.
- Shopify `$app:printmo.production_state_v1` is the only writable per-order production authority.
- D1 projections are rebuildable; D1 also owns app-only audit, mutation, batch, asset-manifest, and migration records.
- Candidate reads and writes must remain Redis-free. Explicit `/legacy/` routes are isolated compatibility boundaries.
- Verify webhook HMAC against the raw body before parsing.
- Preserve compare-digest concurrency, request idempotency, bounded retry, and explicit `BOARD_NOT_INITIALIZED`, `VERSION_CONFLICT`, `SYNC_PENDING`, and unknown-supplier states.
- Never expose R2 object keys, infrastructure credentials, protected customer data, tokens, or signed URLs in logs or browser DTOs.
- Apply migrations before deploying code that selects their columns.
- Run `node --check order-manager-proxy/worker.js`, `npm run verify:phase2`, and the proxy package tests/build when applicable.
