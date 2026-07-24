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
| Shopify/D1 Candidate Contract | `npm run verify:phase2` | Verifies webhook enrollment, D1 projection, Shopify CAS mutation, Redis isolation, S&S batch commit, private asset tickets, and migration gates |
| Shopify Board Source Controller | `node --check order-manager-web/shopify-preview.js` | Silent exit code 0 |
| Admin Block and Candidate Controls | Run `npm test` then `npm run build` in `order-manager-proxy` | Canonical stages, labels, collapsed summary, source switching, and Shopify extension build pass |
| Render Legacy Adapter + Stateless S&S Gateway | Run `npm test` in `E:\PrintMO\shopify-ss-integration` | Legacy regressions pass and candidate supplier route is proven Redis-free |
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
| Source Isolation | Change a production field in **Shopify board**, then inspect **Legacy Redis** | Candidate value persists through Shopify/D1; the legacy queue value is unchanged |
| Shopify Rich Detail Contract | Run `npm run verify:phase2` | Fixture-backed detail test verifies no Render/Redis request, full line-item pagination, and payment, delivery-method, conversion, discount, and timeline normalization. This test does not prove production Shopify scopes are installed. |
| Shopify Rich Detail — Production Scope Gate | Open a recent order from **Shopify board** | Passed live on 2026-07-23 for the previously installed read scopes. Detail identifies Shopify as source and renders payment, delivery, conversion, discounts, complete line items, and timeline data. The Task 3 write/all-orders permission update remains a separate installation approval gate. |
| Shopify Production CAS | Run `npm run verify:phase2` | Mutation writes the Shopify metafield, commits D1 audit/projection, and makes no Redis CAS request |
| Shopify Board | Switch to **Shopify board**, drag a card, edit notes/readiness/progress, and refresh | Same Kanban persists from Shopify/D1 and conflicts refresh instead of overwriting |
| Shopify Admin Order Block | Open an order after the coordinated release | Block loads the selected GID, shows stage/progress summary and labeled controls, and converges with the Shopify board |
| Candidate S&S Batch | Keep `SS_TEST_ORDER=1`; submit selected candidate orders once | D1 batch becomes confirmed, one supplier test order is returned, and Shopify stages become `blanks_ordered` |
| Candidate Bootstrap and Empty-State Safety | Use a fresh D1 database, then repeat with the initial Shopify read forced to fail | A successful bounded read records `bootstrap` and returns the populated board; a failed read returns `BOARD_NOT_INITIALIZED` and the UI keeps the previous board instead of displaying zero |

---

## 3. Build & Packaging Verification

| Target | Command | Verification Artifact |
|---|---|---|
| Electron Packaging (macOS / Windows) | `npm run dist` | Executable packages generated in `dist/` directory without builder errors. |
| Cloudflare Pages Upload Bundle | `npm run prepare:cloudflare` | Web assets copied and packaged according to `scripts/prepare-cloudflare-pages-upload.sh`. |
