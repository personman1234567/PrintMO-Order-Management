# Verification & Test Lookup Map

## Use This When
- You are validating code changes prior to claiming task completion.
- You need to select the appropriate syntax check or manual runbook test for a subsystem.

## Skip This When
- You are looking for source code file locations $\rightarrow$ read [reference/source-map.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/reference/source-map.md).

## Section Map
- [1. Automated & Syntax Verification Commands](#1-automated--syntax-verification-commands)
- [2. Subsystem Manual Verification Matrix](#2-subsystem-manual-verification-matrix)
- [3. Build & Packaging Verification](#3-build--packaging-verification)

---

## 1. Automated & Syntax Verification Commands

Run these targeted CLI commands to verify syntax integrity without side effects:

| Subsystem / File | Verification Command | Expected Output |
|---|---|---|
| Main Electron Process | `node --check main.js` | Silent exit code 0 |
| Preload Script | `node --check preload.js` | Silent exit code 0 |
| Desktop Renderer | `node --check renderer.js` | Silent exit code 0 |
| Cloudflare Worker Proxy | `node --check order-manager-proxy/worker.js` | Silent exit code 0 |
| Phase 1 Auth/Transport Contract | `npm run verify:phase1` | `Phase 1 contract verification passed.` |
| Phase 2 Worker Shadow Contract | `npm run verify:phase2` | `Phase 2 shadow data plane verification passed.` |
| Shopify Live Preview Controller | `node --check order-manager-web/shopify-preview.js` | Silent exit code 0 |
| Task 2 Admin Block and Production Controls | Run `npm test` then `npm run build` in `order-manager-proxy` | Contract script passes and Shopify CLI builds `printmo-production-status` for API `2026-07` |
| Phase 2 Render Redis Adapter | Run `npm test` in `E:\PrintMO\shopify-ss-integration` | `Render Phase 2 Redis adapter verification passed.` |
| Web Client Renderer | `node --check order-manager-web/renderer.js` | Silent exit code 0 |
| Web Storage Adapter | `node --check order-manager-web/storage-browser.js` | Silent exit code 0 |

---

## 2. Subsystem Manual Verification Matrix

| Component / Workflow | Manual Verification Procedure | Success Criteria |
|---|---|---|
| Desktop App Local Boot | Run `npm start` | Window launches, connects to Redis, displays 3-column Kanban board with cards. |
| Kanban Card Drag-and-Drop | Drag order card from `Payment Received` to `Blanks Ordered` | Card moves smoothly, IPC `update-status` fires, status persists in Redis on refresh. |
| Order Detail Modal | Click any order card | Modal overlays dashboard showing customer info, SKU variants, unit costs, and attachments. |
| Attachment File Upload | Upload image attachment via detail modal | FileReader encodes image Base64, IPC `add-file` persists file, image renders in preview tab. |
| S&S Blank Batching | Drag multiple cards to Create Blanks Order zone, click Submit | SKUs aggregate, API call executes, order confirmation returns, cards advance to `Blanks Ordered`. |
| Malformed Legacy Asset Container | Run the `splitOrderAssets` regression check with item assets shaped as `{}`, `null`, and a valid array; then load the Redis board | Invalid containers are treated as empty, valid asset arrays still render, and one malformed item cannot blank the entire board. |
| Embedded Web Authentication | Run `npm run prepare:cloudflare`, deploy the generated artifact, and open it from Shopify Admin | App Bridge supplies a bearer token; queue and asset calls succeed while unauthenticated calls return `401`. |
| Shopify Live Preview List Isolation | Switch to **Shopify live**, then return to **Redis board** | List identifies Shopify Admin GraphQL as its source, exposes no mutation controls, and Redis board returns unchanged. `npm run verify:phase2` asserts the preview makes no Render/Redis request. |
| Shopify Live Rich Detail Contract | Run `npm run verify:phase2` | Fixture-backed detail test verifies no Render/Redis request, full line-item pagination, and payment, delivery-method, conversion, discount, and timeline normalization. This test does not prove production Shopify scopes are installed. |
| Shopify Live Rich Detail — Production Scope Gate | Open a recent order from **Shopify live** | Passed live on 2026-07-23 after the required scopes were released and approved. Detail identifies Shopify as source and renders payment, delivery, conversion, discounts, complete line items, and timeline data. |
| Task 1 Production Metadata Transition Contract | Run `npm run verify:phase2`, then run `npm test` in `E:\PrintMO\shopify-ss-integration` | Worker verifies lightweight production read and exact Admin-extension CORS; Render verifies that compatible writes are mirrored atomically, unsupported/missing legacy targets fail closed, and successful mirrors broadcast a queue refresh. |
| Task 2 Shopify Live Production Editor | Open an order in **Shopify live**, change one production field, and save | Shopify commerce stays read-only; save reports that PrintMO and Redis were updated; returning to the Redis board shows the same production value. A concurrent version conflict refreshes instead of overwriting. |
| Task 2 Shopify Admin Order Block | After the coordinated release, add and pin **PrintMO production** once on an order page, then open another order | The block appears for order pages, loads that page's order GID, and exposes the same transition-safe stage/readiness/count/bundle/notes fields. |

---

## 3. Build & Packaging Verification

| Target | Command | Verification Artifact |
|---|---|---|
| Electron Packaging (macOS / Windows) | `npm run dist` | Executable packages generated in `dist/` directory without builder errors. |
| Cloudflare Pages Upload Bundle | `npm run prepare:cloudflare` | Web assets copied and packaged according to `scripts/prepare-cloudflare-pages-upload.sh`. |
