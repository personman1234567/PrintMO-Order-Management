# Supplier Inventory Sync

- **Status**: `[Implemented Candidate]`
- **Owner / Target Milestone**: Print-MO owner / three-stage supplier availability pilot

## Summary & Intent

Reflect S&S stockouts in Shopify while preserving Print-MO physical stock. Code lives in this repository under `inventory-sync/`, with a separately deployable Worker. The existing Order Manager Worker, production stages, Shopify app scopes and supplier ordering routes are unchanged.

This candidate is observation-only: no inventory mutation exists and no schedule is enabled. The separate Worker is deployed with `INVENTORY_SYNC_MODE=disabled`, no public route, and no cron. Its three secrets are limited to the dedicated Shopify read-only app and inventory-only gateway key. Shopify's S&S Supplier location was staged on 2026-09-22 with online fulfillment disabled and no active pilot inventory. Capacity before commitments is an observation, not a sellable quantity. Every row reports `writeReady: false` and `proposedQuantity: null` until order commitments and shared-blank accounting are implemented and validated.

## Current Continuation State

- **Current state**: Gateway PRs #1–#3 are merged. Render manual deploy `dep-daq0hmd9fdbs73eofpj0` is Live at `1014823`, with its inventory-only key configured and Auto-Deploy Off. The gateway joins S&S inventory quantities to product warehouse metadata and forwards only the boolean dropship flag. The dedicated Shopify app, Print-MO Inventory Observation, has only `read_products` and `read_inventory`; its client credentials and the matching gateway key remain Cloudflare secrets. A 2026-09-23 Cloudflare **remote preview** ran the 25 Tultex variants with all non-dropship S&S warehouses selected: `inStock=21`, `outOfStock=4`, `unknown=0`, `blocked=25`, `writes=0`. A subsequent local read-only 25-variant Shopify/S&S check selected one out-of-stock pilot variant: Shopify reported `tracked=false`, `availableForSale=true`, `sellableOnlineQuantity=0`, no active S&S Supplier level and no positive stock at another active level; the gate plan stayed blocked with `writes=0`. These are physical-warehouse observations before commitments, not Shopify sellable quantities. Production Worker version `70fe7356-542b-4230-9e54-b707c3b4d01d` remains disabled, with no public route or cron. The gate-evidence changes have not been deployed.
- **Next safe action**: Validate the gate-evidence query in a hosted Cloudflare preview with its dedicated read-only app, then resolve HQ online-stock participation, supplier fulfillment/delivery routing, and commitment accounting before a live block/reopen trial. Persist status/alerts and approve a read-only observation cadence before considering any inventory writer. The earlier KS-only result was diagnostic and is superseded for warehouse-scope observation by the all-physical-warehouse run.
- **Remaining blockers**: Production observation is intentionally disabled. Physical S&S stock is now classified without dropship rows, but commitment accounting, local-stock policy, shipping eligibility and the Shopify block/re-enable mechanism are not settled. A positive physical-warehouse response is not automatically sellable quantity. The existing order-capable Shopify credential was not copied to the inventory Worker.
- **Owner / external actions**: Settle local-stock and fulfillment policy before sellable quantity is derived. Configure supplier location/fulfillment and reviewed pilot writes after the commerce model is ready. No need to paste secrets into chat.
- **Latest source/setup evidence**: 2026-09-22: owner supplied `https://github.com/personman1234567/PrintMO-Wholesale-API-Integration.git`; cloned at `d3a0d5a` to `/Users/tjreid/Documents/GitHub/PrintMO-Wholesale-API-Integration`. Package name and authenticated S&S routes confirm the gateway source. Locked dependencies, existing phase2 verification and source syntax checks passed on Node 22.23.2. Local development documentation, a blank environment template and Shopify agent handoff are prepared. No adapter was mounted, no production credentials copied, and no live service started or deployed.
- **Last live audit evidence**: 2026-09-16: bounded Shopify health and S&S inventory reads authenticated using existing local environment credentials; initial combined catalog/location read hit an access restriction. One narrowed follow-up successfully read 25 active variants and matched 25 supplier inventory records; all sampled variants were untracked. The catalog has more pages, and the location check still returned ACCESS_DENIED. Remote lookup of the presumed sibling gateway repository returned repository-not-found; no further repository hunting was performed. This does not establish that the actual repository is missing. No live commerce state changed.

## Open Questions & Brainstorming

- Preserve HQ stock for rush/in-store work, or permit online consumption? Default remains undecided; no location policy is changed.
- The owner selected physical S&S warehouse stock only for the first stockout gate. DS/dropship rows are excluded, including if they report positive quantity. Exact shipping/transit eligibility remains a separate release check.
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
- [x] Deploy the gateway source to Render and verify the authenticated live inventory endpoint with its dedicated inventory-only key.
- [x] Verify the Worker's dedicated Shopify read-only app can authenticate and read all 25 pilot variants from Cloudflare remote preview. Exact-location inventory writes require separate future credentials and verification; do not silently reuse a different app as production authority.
- [ ] Complete exact-SKU mapping, shared-blank inventory and pending-order accounting for the pilot.

### 2. Observation Worker

- [x] Separate `inventory-sync/wrangler.jsonc`, disabled by default with no cron/public endpoint.
- [x] Explicit allowlist of at most 25 active Shopify variant IDs; no automatic catalog enrollment.
- [x] Exact supplier SKU mapping, physical-warehouse-only selection, integer validation, missing-data and stale-data rejection. `SS_WAREHOUSES=["*"]` selects all returned non-dropship S&S warehouse rows and always excludes `DS`; an explicit code list remains available for a narrower diagnostic.
- [x] Protected location guard; no fallback to HQ and no write-capable mode.
- [x] Bounded upstream requests (15-second timeout and at most one retry for short throttles/server errors), redacted errors and summary logs.
- [x] Candidate gateway handler plus contract tests; not yet mounted in the now-accessible gateway repository.
- [x] Deploy the separate Worker disabled, with no public route, cron, or inventory writes (2026-09-23). Dedicated read-only secrets were added after initial deployment.
- [x] Configure dedicated gateway/Shopify secrets and exact pilot, then run one Cloudflare remote-preview dry run with zero writes (2026-09-23).
- [x] Decide physical S&S warehouse observation policy and verify one hosted dry run with DS/dropship excluded.
- [x] Add read-only Shopify gate evidence to the dry-run plan: current saleability, complete per-location stock, supplier-level activation, and other-location stock. A zero-at-supplier block is only a candidate; all writes remain disabled. Location online-fulfillment status must be verified separately.
- [x] Run one-variant live gate read with Shopify and S&S data. A 25-variant read selected one confirmed physical-warehouse stockout; Shopify still reported `availableForSale=true` while untracked. The plan made zero writes and left the action blocked.
- [ ] Run a hosted preview with the dedicated read-only Shopify app. The local Order Management credential can read per-location quantities but gets `SHOPIFY_ACCESS_DENIED` when requesting location online-fulfillment settings.
- [ ] Persist status and add an approved read-only observation schedule and alerts.
- [ ] Persist last-success/status before unattended operation. Current version logs run summaries only; CLI returns the detailed report. No D1 table was created solely for the prototype.

### 3. Reviewed pilot and rollout

- [ ] Decide HQ participation, shipping eligibility, buffer and stale-data policy; physical S&S warehouse observation scope is selected.
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

Worker non-secret settings: `SHOPIFY_SHOP_DOMAIN`, `INVENTORY_SYNC_MODE` (`disabled` or `dry-run` only), `PILOT_VARIANT_IDS` (JSON ID array), `SS_WAREHOUSES` (JSON abbreviation array or `["*"]` for all physical S&S warehouses), `SS_SAFETY_BUFFER` (nonnegative integer string), `SUPPLIER_LOCATION_ID` (optional for observation), `PROTECTED_LOCATION_IDS` (JSON ID array), and `SUPPLIER_INVENTORY_URL`.

Worker secrets: the scoped `INVENTORY_READ_KEY` and either `SHOPIFY_API_KEY` plus `SHOPIFY_API_SECRET` for the existing client-credentials flow, or a runtime-supplied `SHOPIFY_ACCESS_TOKEN`. The gateway uses `INVENTORY_READ_KEY` only for the read-only inventory route; order routes continue to require the separate admin key. A static Shopify token must remain valid; no secret is copied to Cloudflare automatically. S&S credentials belong only on the supplier gateway. The optional direct CLI diagnostic consumes existing `SS_ACCOUNT_NUMBER` and `SS_API_KEY` in memory; the Worker does not call S&S directly.

Gateway contract: authenticated `GET /order-manager/v1/supplier/ss/inventory?skus=SKU1,SKU2`, at most 25 unique identifiers, returns `{ observedAt, items: [{ sku, warehouses: [{ warehouseAbbr, qty, dropship }] }] }` with `Cache-Control: no-store`. S&S's inventory endpoint has fresh warehouse quantities but no dropship flag, so the gateway also GETs the products endpoint and joins exact SKU and warehouse metadata; any missing or malformed match rejects the read. Only the boolean dropship flag is forwarded. `observedAt` records fetch time, not an S&S source timestamp. The gateway never reads Redis or creates orders. The local `gateway-handler.mjs` remains a candidate parity adapter; the deployed route lives in the separate gateway repository.

A missing requested SKU or missing product/warehouse metadata remains unknown or rejects the run. A returned SKU whose only stock is in DS/dropship rows has confirmed physical-warehouse quantity zero. Duplicate rows, invalid quantities/flags, a timestamp older than five minutes, timestamps over 30 seconds in the future, Shopify partial GraphQL errors and redirects fail closed. The Worker uses `redirect: 'manual'` because Cloudflare rejects `redirect: 'error'`; non-2xx redirects are rejected without following the destination. Supplier 404 does not become zero. Scheduled errors propagate as failed runs without logging secret-bearing upstream payloads. No endpoint exposes reports or triggers runs publicly.

The gate evidence is deliberately non-executable. The dry run reads `availableForSale`, `sellableOnlineQuantity`, and all reported inventory levels (rejecting pagination). If supplier stock after the safety buffer is zero, it identifies `ZERO_SUPPLIER_AVAILABLE` as the candidate block; if positive, reopening still requires commitment/reservation accounting. Positive stock at another active location may defeat a supplier-only stockout. The read-only credential cannot retrieve location online-fulfillment settings, so the plan marks them unverified rather than inferring them from stock. The current staged S&S Supplier location was last verified offline, and all 25 pilot variants remain untracked, so this code does not establish a working storefront gate. It neither creates a Shopify mutation nor changes tracking, location settings, quantities, checkout, or the production Worker deployment.

### Verification

`npm run repo -- inventory test` owns the isolated modules. Run `npm run docs:check` for route/plan/tool registration. Existing board/Shopify extension behavior is untouched, so its full suite/build is not required by this isolated addition. Before deployment, run Wrangler's Worker dry-run build from `inventory-sync/` and verify the actual binding/auth configuration; the Worker also passed an esbuild browser-target ESM bundle check on this Mac, but that and local Node tests do not establish Cloudflare deployment readiness.

## Progress Log

- 2026-09-16: Implemented the observation candidate and bounded audit; preserved existing server credential boundaries. Live reads established partial access, while gateway access and Shopify location/write permission remain unresolved. Production inventory, purchasing and deployments remain unchanged.

- 2026-09-22: Gateway source access resolved using the owner-provided repository. Local dependency installation and existing gateway tests passed; prepared development setup and Shopify agent handoff. Adapter integration, deployment access, runtime permissions and live inventory rollout remain pending.

- 2026-09-23: Mounted a read-only S&S inventory route in the Windows gateway checkout and passed its new focused tests plus existing phase-two verification. Wrangler dry-run build passed and the separate Cloudflare Worker was deployed in disabled mode with no schedule, public route, or secrets. Render deployment and end-to-end dry-run remain pending.

- 2026-09-23: Render was deployed and a dedicated inventory-only key was configured. A new Shopify app with only `read_products` and `read_inventory` was installed and its client credentials bound to the inventory Worker. Cloudflare remote preview completed one 25-variant KS diagnostic with all 25 blocked and zero writes after correcting the Worker redirect mode. Production Worker was redeployed disabled at `0cce3ed5-5a34-4cfc-a7f6-ef2ffe9f356e`, with no cron or public route; production scheduled execution was not performed.

- 2026-09-23: Added a read-only stockout-gate evidence plan and focused stockout/restock/HQ/offline-location tests in the local `Shopify-Sync` checkout. No mutation path was added. The local Shopify credential could read per-location quantities but was denied the location online-fulfillment field; the dry-run query was narrowed to granted read fields and leaves fulfillment status unverified. A live 25-variant Shopify/S&S read selected one out-of-stock variant with `tracked=false`, `availableForSale=true`, `sellableOnlineQuantity=0`, no active S&S Supplier level and no positive other-location quantity. The gate marked a possible block while all writes remained blocked. No live Shopify or Cloudflare state changed.
