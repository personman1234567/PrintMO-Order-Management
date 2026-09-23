# Supplier Inventory Sync

- **Status**: `[Implemented Candidate]`
- **Owner / Target Milestone**: Print-MO owner / three-stage supplier availability pilot

## Summary & Intent

Reflect S&S stockouts in Shopify while preserving Print-MO physical stock. Code lives in this repository under `inventory-sync/`, with a separately deployable Worker. The existing Order Manager Worker, production stages, Shopify app scopes and supplier ordering routes are unchanged.

This candidate is observation-only: no inventory mutation exists and no schedule is enabled. The separate Worker was deployed on 2026-09-23 with `INVENTORY_SYNC_MODE=disabled`, no public route, no cron, and no secrets. Shopify's S&S Supplier location was staged on 2026-09-22 with online fulfillment disabled and no active pilot inventory. Capacity before commitments is an observation, not a sellable quantity. Every row reports `writeReady: false` and `proposedQuantity: null` until order commitments and shared-blank accounting are implemented and validated.

## Current Continuation State

- **Current state**: A bounded read-only audit CLI, explicit-pilot dry-run Worker, and supplier normalization/planning module exist. Gateway PRs #1 and #2 are merged; Render was manually deployed at `0c6acf5` on 2026-09-23 with Auto-Deploy Off. PR #2 adds optional `INVENTORY_READ_KEY` limited to the inventory GET route; it is not configured yet, so the prior admin-key fallback still works. The live inventory and existing authenticated queue probes each returned 200 without exposing order data. The separate Worker is deployed to Cloudflare at version `e096e5d6-76a5-419b-85d9-d30ec4ee4f72` with the exact 25 Tultex 246 pilot variant IDs and gateway URL, but remains disabled with no warehouse selection, schedule, or secrets. A local read-only dry run fetched all 25 current pilot SKUs from Shopify and S&S through the candidate gateway adapter; a diagnostic KS-only view produced quantities for 19 and marked 6 as missing KS warehouse coverage. All 25 rows had `writeReady: false`, `proposedQuantity: null`, and zero writes.
- **Next safe action**: Use a dedicated gateway inventory-read key and a Shopify credential limited to the needed read scopes for a hosted Worker dry run. Verify both paths, then consider a read-only schedule and alerts. Keep writes disabled and treat KS as a diagnostic sample, not an approved warehouse policy.
- **Remaining blockers**: The Cloudflare Worker has no secrets and remains disabled. The available local Shopify credential has `read_products`, `read_inventory`, `read_orders`, `read_all_orders`, and `write_orders`; copying it into the inventory Worker would widen access unnecessarily. A separate read-only Shopify credential is needed for hosted execution. The gateway's scoped key must be configured on Render and Cloudflare. Supplier warehouse eligibility/quantity semantics, commitment accounting, local-stock policy and fulfillment behavior are not settled. A successful supplier response or KS diagnostic is not evidence of sellable quantity.
- **Owner / external actions**: Approve a dedicated read-only Shopify credential and inventory-only gateway key for hosted observation; settle eligible warehouses and local-stock policy before any sellable quantity is derived. At Worker integration, test that credential through real read operations and keep the existing order-capable credential out of this Worker. Configure supplier location/fulfillment and reviewed pilot writes after the commerce model is ready. No need to paste secrets into chat.
- **Latest source/setup evidence**: 2026-09-22: owner supplied `https://github.com/personman1234567/PrintMO-Wholesale-API-Integration.git`; cloned at `d3a0d5a` to `/Users/tjreid/Documents/GitHub/PrintMO-Wholesale-API-Integration`. Package name and authenticated S&S routes confirm the gateway source. Locked dependencies, existing phase2 verification and source syntax checks passed on Node 22.23.2. Local development documentation, a blank environment template and Shopify agent handoff are prepared. No adapter was mounted, no production credentials copied, and no live service started or deployed.
- **Last live audit evidence**: 2026-09-16: bounded Shopify health and S&S inventory reads authenticated using existing local environment credentials; initial combined catalog/location read hit an access restriction. One narrowed follow-up successfully read 25 active variants and matched 25 supplier inventory records; all sampled variants were untracked. The catalog has more pages, and the location check still returned ACCESS_DENIED. Remote lookup of the presumed sibling gateway repository returned repository-not-found; no further repository hunting was performed. This does not establish that the actual repository is missing. No live commerce state changed.

## Open Questions & Brainstorming

- Preserve HQ stock for rush/in-store work, or permit online consumption? Default remains undecided; no location policy is changed.
- Which supplier warehouses are eligible for the actual fulfillment promise? Inventory endpoint availability alone does not establish eligibility or transit time.
- Are supplier quantities capped/restricted for this account? An initial sample reported identical quantities across warehouses; do not infer exact physical stock or a reservation from that response.
- Which customer commitments are not yet represented in supplier availability? Order Manager `blanks_cart` and `blanks_ordered` are different states, and neither alone proves S&S inventory reservation timing. Confirm receipt/placement semantics before releasing a commitment to avoid subtracting twice or reopening promised stock.
- Do several Shopify variants/products consume the same supplier blank? Detect the complete sharing set before allocating quantities; the 25-variant audit is not a catalog-wide collision check.
- What freshness cutoff and safety buffer fit observed ordering patterns? Proposed target polling cadence is five minutes, subject to shared API capacity.

## Technical Specification & Task Checklist

### 1. Audit and access

- [x] Trace existing gateway authentication and server-held S&S credential ownership; use a separate `X-Inventory-Read-Key` for the inventory Worker after staged gateway deployment.
- [x] Check existing local credential presence without emitting values; verify bounded read access.
- [x] Add `npm run repo -- inventory audit --help` with explicit environment-file input and optional `--direct-ss` local diagnostic.
- [x] Locate and set up the actual gateway source (2026-09-22).
- [x] Mount and test the read-only inventory endpoint in the Windows gateway checkout (2026-09-23). The earlier Node/Web Request candidate remains as an isolated contract test.
- [ ] Deploy the gateway source to Render and verify the authenticated live inventory endpoint.
- [ ] During Worker integration, verify the Worker's own Shopify credential can perform the required pilot reads and, when the write path is ready, exact-location inventory writes. Resolve a real access error in the chosen installation; the separate Shopify agent need not list app scopes before performing its plugin-based work. Do not silently reuse a different app as production authority.
- [ ] Complete exact-SKU mapping, shared-blank inventory and pending-order accounting for the pilot.

### 2. Observation Worker

- [x] Separate `inventory-sync/wrangler.jsonc`, disabled by default with no cron/public endpoint.
- [x] Explicit allowlist of at most 25 active Shopify variant IDs; no automatic catalog enrollment.
- [x] Exact supplier SKU mapping, warehouse allowlist, integer validation, missing-data and stale-data rejection.
- [x] Protected location guard; no fallback to HQ and no write-capable mode.
- [x] Bounded upstream requests (15-second timeout and at most one retry for short throttles/server errors), redacted errors and summary logs.
- [x] Candidate gateway handler plus contract tests; not yet mounted in the now-accessible gateway repository.
- [x] Deploy the separate Worker disabled, with no public route, cron, secrets or inventory writes (2026-09-23).
- [ ] Configure gateway/Shopify secrets and pilot, enable dry-run observation schedule and alerts after the gateway is verified.
- [ ] Persist last-success/status before unattended operation. Current version logs run summaries only; CLI returns the detailed report. No D1 table was created solely for the prototype.

### 3. Reviewed pilot and rollout

- [ ] Decide HQ participation, supplier warehouse scope, buffer and stale-data policy.
- [ ] Add supplier location and verify shipping, order routing and local pickup.
- [ ] Implement commitment-aware, shared-SKU-safe quantities and lifecycle reconciliation.
- [ ] Add exact-location inventory writes with compare-and-set, idempotency, explicit mode and pilot allowlist; preserve Shopify order deductions during races.
- [ ] Update relevant import/onboarding conventions so they do not reset tracked inventory for enrolled variants. Brain's older tracked=false guidance predates this supplier-stock model.
- [ ] Verify stockout, restock, overlapping orders, refunds/cancellation, outages, stale data, protected local stock and pause/rollback behavior.
- [ ] Verify the live storefront, Designer, cart, checkout and customer delivery options, then expand deliberately.

### Commands and configuration

Run from this repository with Node 22+:

```sh
npm run repo -- inventory audit --env-file /approved/existing/.env --shop example.myshopify.com
npm run repo -- inventory audit --env-file /approved/existing/.env --shop example.myshopify.com --direct-ss
npm run repo -- inventory dry-run --env-file /approved/runtime/config
npm run repo -- inventory test
```

The CLI prints internal variant IDs, SKUs, supplier quantities and location names where authorized. It prints no credentials, customer records or raw error bodies, writes no files, and never updates commerce. Preserve reports only in approved internal storage. Exit 0 means requested checks completed (not rollout readiness), 2 means an audit check was blocked, and 1 means command/configuration failure. Shell variables override an explicit env file; `--shop` overrides the shop domain. No env file is loaded implicitly.

Worker non-secret settings: `SHOPIFY_SHOP_DOMAIN`, `INVENTORY_SYNC_MODE` (`disabled` or `dry-run` only), `PILOT_VARIANT_IDS` (JSON ID array), `SS_WAREHOUSES` (JSON abbreviation array), `SS_SAFETY_BUFFER` (nonnegative integer string), `SUPPLIER_LOCATION_ID` (optional for observation), `PROTECTED_LOCATION_IDS` (JSON ID array), and `SUPPLIER_INVENTORY_URL`.

Worker secrets: the scoped `INVENTORY_READ_KEY` and either `SHOPIFY_API_KEY` plus `SHOPIFY_API_SECRET` for the existing client-credentials flow, or a runtime-supplied `SHOPIFY_ACCESS_TOKEN`. The gateway uses `INVENTORY_READ_KEY` only for the read-only inventory route; order routes continue to require the separate admin key. A static Shopify token must remain valid; no secret is copied to Cloudflare automatically. S&S credentials belong only on the supplier gateway. The optional direct CLI diagnostic consumes existing `SS_ACCOUNT_NUMBER` and `SS_API_KEY` in memory; the Worker does not call S&S directly.

Candidate gateway contract: authenticated `GET /order-manager/v1/supplier/ss/inventory?skus=SKU1,SKU2`, at most 25 unique identifiers, returns `{ observedAt, items: [{ sku, warehouses: [{ warehouseAbbr, qty }] }] }` with `Cache-Control: no-store`. `observedAt` records fetch time, not an S&S source timestamp. The adapter makes only GET inventory calls, strips unrelated supplier fields, and never reads Redis or creates orders. Its Node/Web Request signature needs adaptation to the actual Render framework; importing it into the gateway is not a deployment.

A missing requested SKU or eligible warehouse remains unknown. Duplicate rows, invalid quantities, a timestamp older than five minutes, timestamps over 30 seconds in the future, Shopify partial GraphQL errors and redirects fail closed. Supplier 404 does not become zero. Scheduled errors propagate as failed runs without logging secret-bearing upstream payloads. No endpoint exposes reports or triggers runs publicly.

### Verification

`npm run repo -- inventory test` owns the isolated modules. Run `npm run docs:check` for route/plan/tool registration. Existing board/Shopify extension behavior is untouched, so its full suite/build is not required by this isolated addition. Before deployment, run Wrangler's Worker dry-run build from `inventory-sync/` and verify the actual binding/auth configuration; the Worker also passed an esbuild browser-target ESM bundle check on this Mac, but that and local Node tests do not establish Cloudflare deployment readiness.

## Progress Log

- 2026-09-16: Implemented the observation candidate and bounded audit; preserved existing server credential boundaries. Live reads established partial access, while gateway access and Shopify location/write permission remain unresolved. Production inventory, purchasing and deployments remain unchanged.

- 2026-09-22: Gateway source access resolved using the owner-provided repository. Local dependency installation and existing gateway tests passed; prepared development setup and Shopify agent handoff. Adapter integration, deployment access, runtime permissions and live inventory rollout remain pending.

- 2026-09-23: Mounted a read-only S&S inventory route in the Windows gateway checkout and passed its new focused tests plus existing phase-two verification. Wrangler dry-run build passed and the separate Cloudflare Worker was deployed in disabled mode with no schedule, public route, or secrets. Render deployment and end-to-end dry-run remain pending.
