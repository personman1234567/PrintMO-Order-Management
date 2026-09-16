# Supplier Inventory Sync

- **Status**: `[Implemented Candidate]`
- **Owner / Target Milestone**: Print-MO owner / three-stage supplier availability pilot

## Summary & Intent

Reflect S&S stockouts in Shopify while preserving Print-MO physical stock. Code lives in this repository under `inventory-sync/`, with a separately deployable Worker. The existing Order Manager Worker, production stages, Shopify app scopes and supplier ordering routes are unchanged.

This candidate is observation-only: no inventory mutation exists, no new Worker is deployed, no schedule is enabled, and no Shopify location has been created. Capacity before commitments is an observation, not a sellable quantity. Every row reports `writeReady: false` and `proposedQuantity: null` until order commitments and shared-blank accounting are implemented and validated.

## Current Continuation State

- **Current state**: A bounded read-only audit CLI, explicit-pilot dry-run Worker, supplier normalization/planning module, and a candidate authenticated Render gateway handler exist locally. Fourteen focused tests passed during initial construction; final verification is reported by the owning test command.
- **Next safe action**: Locate the actual `shopify-ss-integration` checkout/deployment access, adapt and mount the candidate inventory handler in its existing authenticated router, and verify a read through that deployed gateway. Reuse server-held S&S credentials. Then configure one verified pilot and run the Worker in dry-run mode.
- **Remaining blockers**: Gateway source/deployment access is unavailable on this Mac. The local Shopify credential authenticates with read_products/read_inventory but no write_inventory; it is not proof of the production Worker's installed scopes. The checked-in Order Manager app configuration requests order scopes only. Location reads encountered ACCESS_DENIED. A subsequent split audit read 25 active variants, all untracked, and matched all 25 to S&S responses. Location reads remain blocked. Full catalog coverage, supplier warehouse eligibility/quantity semantics, commitment accounting, local-stock policy and fulfillment behavior are not settled.
- **Owner / external actions**: Configure/release the required Shopify scopes through the chosen existing installation, provide access to the actual gateway source/deployment, select eligible warehouses and local-stock policy, then configure supplier location/fulfillment and authorize the reviewed pilot writes. No need to paste secrets into chat.
- **Last verified evidence**: 2026-09-16: bounded Shopify health and S&S inventory reads authenticated using existing local environment credentials; initial combined catalog/location read hit an access restriction. One narrowed follow-up successfully read 25 active variants and matched 25 supplier inventory records; all sampled variants were untracked. The catalog has more pages, and the location check still returned ACCESS_DENIED. Remote lookup of the presumed sibling gateway repository returned repository-not-found; no further repository hunting was performed. This does not establish that the actual repository is missing. No live commerce state changed.

## Open Questions & Brainstorming

- Preserve HQ stock for rush/in-store work, or permit online consumption? Default remains undecided; no location policy is changed.
- Which supplier warehouses are eligible for the actual fulfillment promise? Inventory endpoint availability alone does not establish eligibility or transit time.
- Are supplier quantities capped/restricted for this account? An initial sample reported identical quantities across warehouses; do not infer exact physical stock or a reservation from that response.
- Which customer commitments are not yet represented in supplier availability? Order Manager `blanks_cart` and `blanks_ordered` are different states, and neither alone proves S&S inventory reservation timing. Confirm receipt/placement semantics before releasing a commitment to avoid subtracting twice or reopening promised stock.
- Do several Shopify variants/products consume the same supplier blank? Detect the complete sharing set before allocating quantities; the 25-variant audit is not a catalog-wide collision check.
- What freshness cutoff and safety buffer fit observed ordering patterns? Proposed target polling cadence is five minutes, subject to shared API capacity.

## Technical Specification & Task Checklist

### 1. Audit and access

- [x] Trace existing Worker-to-Render authentication (`X-Order-Manager-Key`) and server-held S&S credential ownership.
- [x] Check existing local credential presence without emitting values; verify bounded read access.
- [x] Add `npm run repo -- inventory audit --help` with explicit environment-file input and optional `--direct-ss` local diagnostic.
- [ ] Verify gateway source and authenticated live inventory endpoint.
- [ ] Verify the chosen installation's read_products, read_inventory, read_locations and eventual write_inventory access. Do not silently reuse a different app as the production authority.
- [ ] Complete exact-SKU mapping, shared-blank inventory and pending-order accounting for the pilot.

### 2. Observation Worker

- [x] Separate `inventory-sync/wrangler.jsonc`, disabled by default with no cron/public endpoint.
- [x] Explicit allowlist of at most 25 active Shopify variant IDs; no automatic catalog enrollment.
- [x] Exact supplier SKU mapping, warehouse allowlist, integer validation, missing-data and stale-data rejection.
- [x] Protected location guard; no fallback to HQ and no write-capable mode.
- [x] Bounded upstream requests (15-second timeout and at most one retry for short throttles/server errors), redacted errors and summary logs.
- [x] Candidate gateway handler plus contract tests; not mounted in the inaccessible gateway repository.
- [ ] Wire the actual gateway, configure secrets and pilot, deploy dry-run Worker, enable observation schedule and alerts.
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

Worker secrets: `ORDER_MANAGER_ADMIN_KEY` and either `SHOPIFY_API_KEY` plus `SHOPIFY_API_SECRET` for the existing client-credentials flow, or a runtime-supplied `SHOPIFY_ACCESS_TOKEN`. A static token must remain valid; no secret is copied from the Mac to Cloudflare automatically. S&S credentials belong only on the supplier gateway. The optional direct CLI diagnostic consumes existing `SS_ACCOUNT_NUMBER` and `SS_API_KEY` in memory; the Worker does not call S&S directly.

Candidate gateway contract: authenticated `GET /order-manager/v1/supplier/ss/inventory?skus=SKU1,SKU2`, at most 25 unique identifiers, returns `{ observedAt, items: [{ sku, warehouses: [{ warehouseAbbr, qty }] }] }` with `Cache-Control: no-store`. `observedAt` records fetch time, not an S&S source timestamp. The adapter makes only GET inventory calls, strips unrelated supplier fields, and never reads Redis or creates orders. Its Node/Web Request signature needs adaptation to the actual Render framework; importing it into the gateway is not a deployment.

A missing requested SKU or eligible warehouse remains unknown. Duplicate rows, invalid quantities, a timestamp older than five minutes, timestamps over 30 seconds in the future, Shopify partial GraphQL errors and redirects fail closed. Supplier 404 does not become zero. Scheduled errors propagate as failed runs without logging secret-bearing upstream payloads. No endpoint exposes reports or triggers runs publicly.

### Verification

`npm run repo -- inventory test` owns the isolated modules. Run `npm run docs:check` for route/plan/tool registration. Existing board/Shopify extension behavior is untouched, so its full suite/build is not required by this isolated addition. Before deployment, run Wrangler's Worker dry-run build from `inventory-sync/` and verify the actual binding/auth configuration; the Worker also passed an esbuild browser-target ESM bundle check on this Mac, but that and local Node tests do not establish Cloudflare deployment readiness.

## Progress Log

- 2026-09-16: Implemented the observation candidate and bounded audit; preserved existing server credential boundaries. Live reads established partial access, while gateway access and Shopify location/write permission remain unresolved. Production inventory, purchasing and deployments remain unchanged.
