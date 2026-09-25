# Supplier Inventory Sync

- **Status**: `[Implemented Candidate]`
- **Owner / Target Milestone**: Print-MO owner / three-stage supplier availability pilot

## Summary & Intent

Reflect S&S stockouts in Shopify while preserving Print-MO physical stock. Code lives in this repository under `inventory-sync/`, with a separately deployable Worker. The existing Order Manager Worker and supplier ordering routes are unchanged; the dedicated inventory app has the four scopes listed below.

The Worker contains a guarded single-variant Shopify writer. The dedicated app now grants read_products, read_inventory, read_locations, and write_inventory. On 2026-09-25 one hosted write mirrored 446 physically available S&S units to one variant at the S&S Supplier location; Shopify and public product JSON showed it available. The write was rolled back to zero and the variant returned to untracked because repeat refreshes are not yet safe after customer orders. Production remains INVENTORY_SYNC_MODE=disabled with no public route or cron. S&S Supplier is online in the General shipping group, but no positive supplier stock is currently active.

## Current Continuation State

- **Current state**: The Render inventory-only gateway is live. The stockout pilot B30459123 remains tracked and unavailable. In-stock test SKU B30459583 has an active S&S level at zero and is back to untracked. A guarded hosted one-variant write set its S&S quantity to 446, which Shopify reported as available for sale; an exact-location compare-and-set restored zero, and storefront availability returned to its pre-pilot state. The temporary version URL is disabled. The production Worker is disabled and unscheduled.
- **Next safe action**: Design the smallest safe repeat-refresh rule for a Shopify order before enabling a five-minute schedule. Verify checkout and fulfillment routing for the supplier location before leaving any positive supplier quantity online.
- **Remaining blockers**: The one-off writer requires zero Shopify commitments. An unattended repeat could restore sold units before S&S reflects the matching purchase. Checkout and order routing have not been proven. No status persistence or alerts exist, and no schedule is enabled.
- **Owner / external actions**: Review the eventual checkout and order-routing behavior before enabling a schedule. No credential copy or additional app scope is currently needed.
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
- [x] Verify the Worker's dedicated Shopify app can authenticate and read all 25 pilot variants from Cloudflare remote preview. The owner granted `write_inventory` and `read_locations` on 2026-09-25, and the Worker completed one guarded write under that app. Do not silently reuse a different app as production authority.
- [ ] Complete exact-SKU mapping, shared-blank inventory and pending-order accounting for the pilot.

### 2. Observation Worker

- [x] Separate `inventory-sync/wrangler.jsonc`, disabled by default with no cron/public endpoint.
- [x] Explicit allowlist of at most 25 active Shopify variant IDs; no automatic catalog enrollment.
- [x] Exact supplier SKU mapping, physical-warehouse-only selection, integer validation, missing-data and stale-data rejection. `SS_WAREHOUSES=["*"]` selects all returned non-dropship S&S warehouse rows and always excludes `DS`; an explicit code list remains available for a narrower diagnostic.
- [x] Protected location guard; no fallback to HQ. The later single-variant writer also hardcodes the shop and S&S destination and rejects protected-location overlap.
- [x] Bounded upstream requests (15-second timeout and at most one retry for short throttles/server errors), redacted errors and summary logs.
- [x] Candidate gateway handler plus contract tests; not yet mounted in the now-accessible gateway repository.
- [x] Deploy the separate Worker disabled, with no public route, cron, or inventory writes (2026-09-23). Dedicated read-only secrets were added after initial deployment.
- [x] Configure dedicated gateway/Shopify secrets and exact pilot, then run one Cloudflare remote-preview dry run with zero writes (2026-09-23).
- [x] Decide physical S&S warehouse observation policy and verify one hosted dry run with DS/dropship excluded.
- [x] Add read-only Shopify gate evidence to the dry-run plan: current saleability, complete per-location stock, supplier-level activation, and other-location stock. A zero-at-supplier block is only a candidate; all writes remain disabled. Location online-fulfillment status must be verified separately.
- [x] Run one-variant live gate read with Shopify and S&S data. A 25-variant read selected one confirmed physical-warehouse stockout; Shopify still reported `availableForSale=true` while untracked, and the public product JSON reported that exact variant as `available=true`. The plan made zero writes and left the action blocked.
- [x] Run one manual, one-variant Shopify stockout pilot after a fresh physical S&S zero read. SKU `B30459123` became tracked with its existing HQ zero; Shopify and public product JSON report unavailable. No supplier quantity write or automatic refresh was enabled (2026-09-25).
- [ ] Run a hosted preview with the dedicated read-only Shopify app. The local Order Management credential can read per-location quantities but gets `SHOPIFY_ACCESS_DENIED` when requesting location online-fulfillment settings.
- [ ] Persist status and add an approved read-only observation schedule and alerts.
- [ ] Persist last-success/status before unattended operation. Current version logs run summaries only; CLI returns the detailed report. No D1 table was created solely for the prototype.

### 3. Reviewed pilot and rollout

- [ ] Decide HQ participation, shipping eligibility, buffer and stale-data policy; physical S&S warehouse observation scope is selected.
- [ ] Verify actual checkout and order routing for the newly online supplier location; its General profile group and Domestic shipping rate were read back, and local pickup remains off.
- [ ] Implement commitment-aware, shared-SKU-safe quantities and lifecycle reconciliation.
- [x] Build and locally test an exact-location, single-variant writer using `inventorySetQuantities`, `changeFromQuantity` compare-and-set and Shopify `@idempotent`; preserve Shopify order deductions during races. This is a disabled code candidate, not approval to enable it.
- [x] Add `read_locations` to the dedicated app and conduct one reviewed, one-variant positive quantity write with readback and rollback (2026-09-25). This proves the narrow mutation path, not a safe unattended schedule.
- [ ] Verify full shared-SKU mapping and the order-lifecycle rule before expanding beyond one variant.
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

Worker non-secret settings: `SHOPIFY_SHOP_DOMAIN`, `INVENTORY_SYNC_MODE` (`disabled`, `dry-run`, or guarded `pilot-write`), `PILOT_VARIANT_IDS` (JSON ID array), `SS_WAREHOUSES` (JSON abbreviation array or `["*"]` for all physical S&S warehouses), `SS_SAFETY_BUFFER` (nonnegative integer string), `SUPPLIER_LOCATION_ID` (optional for observation), `PROTECTED_LOCATION_IDS` (JSON ID array), and `SUPPLIER_INVENTORY_URL`. `pilot-write` additionally requires `SUPPLIER_FEED_SEMANTICS=ss-available-for-sale-zero-commitments`, a positive integer `INVENTORY_MAX_WRITE_DELTA`, exactly one variant ID, at least one protected location, and the hardcoded Print-MO shop and S&S location. These write settings are intentionally absent from production. Never enable unattended repeats under this one-off zero-commitment rule.

Worker secrets: the scoped `INVENTORY_READ_KEY` and either `SHOPIFY_API_KEY` plus `SHOPIFY_API_SECRET` for the existing client-credentials flow, or a runtime-supplied `SHOPIFY_ACCESS_TOKEN`. The gateway uses `INVENTORY_READ_KEY` only for the read-only inventory route; order routes continue to require the separate admin key. A static Shopify token must remain valid; no secret is copied to Cloudflare automatically. S&S credentials belong only on the supplier gateway. The optional direct CLI diagnostic consumes existing `SS_ACCOUNT_NUMBER` and `SS_API_KEY` in memory; the Worker does not call S&S directly.

Gateway contract: authenticated `GET /order-manager/v1/supplier/ss/inventory?skus=SKU1,SKU2`, at most 25 unique identifiers, returns `{ observedAt, items: [{ sku, warehouses: [{ warehouseAbbr, qty, dropship }] }] }` with `Cache-Control: no-store`. S&S's inventory endpoint has fresh warehouse quantities but no dropship flag, so the gateway also GETs the products endpoint and joins exact SKU and warehouse metadata; any missing or malformed match rejects the read. Only the boolean dropship flag is forwarded. `observedAt` records fetch time, not an S&S source timestamp. The gateway never reads Redis or creates orders. The local `gateway-handler.mjs` remains a candidate parity adapter; the deployed route lives in the separate gateway repository.

A missing requested SKU or missing product/warehouse metadata remains unknown or rejects the run. A returned SKU whose only stock is in DS/dropship rows has confirmed physical-warehouse quantity zero. Duplicate rows, invalid quantities/flags, a timestamp older than five minutes, timestamps over 30 seconds in the future, Shopify partial GraphQL errors and redirects fail closed. The Worker uses `redirect: 'manual'` because Cloudflare rejects `redirect: 'error'`; non-2xx redirects are rejected without following the destination. Supplier 404 does not become zero. Scheduled errors propagate as failed runs without logging secret-bearing upstream payloads. No endpoint exposes reports or triggers runs publicly.

The dry-run gate evidence remains non-executable. It reports candidate stockout/reopen evidence but proposes no quantity. Positive stock at another active location can defeat a supplier-only stockout. The dedicated app can now read the S&S location and completed one guarded positive write, but the normal Worker remains disabled and does not establish unattended storefront synchronization.

The guarded writer reads the exact variant, active S&S location, granted `write_inventory` scope, and exact SKU uniqueness before a write. It rejects untracked variants, Shopify oversell policy, any nonzero Shopify commitment, unknown or positive stock at any other active location, stale S&S data, non-physical/dropship inventory, unexpected Shopify inventory states, and changes above the configured delta. S&S defines its per-warehouse `qty` as available for sale, so the one-off zero-commitment pilot targets `max(0, physical S&S available-for-sale quantity - buffer)` at the S&S location only. The mutation compares Shopify's prior `available` quantity and uses a stable idempotency key across its bounded HTTP retry. It does not change tracking, location settings, checkout, or Shopify app scopes. This rule is not an unattended order-lifecycle reconciliation policy.

### Verification

`npm run repo -- inventory test` owns the isolated modules. Run `npm run docs:check` for route/plan/tool registration. Existing board/Shopify extension behavior is untouched, so its full suite/build is not required by this isolated addition. Before deployment, run Wrangler's Worker dry-run build from `inventory-sync/` and verify the actual disabled binding configuration. Local mocked writes establish guard behavior only; they do not verify a real Shopify quantity mutation or source commitment semantics.

## Progress Log

- 2026-09-16: Implemented the observation candidate and bounded audit; preserved existing server credential boundaries. Live reads established partial access, while gateway access and Shopify location/write permission remain unresolved. Production inventory, purchasing and deployments remain unchanged.

- 2026-09-22: Gateway source access resolved using the owner-provided repository. Local dependency installation and existing gateway tests passed; prepared development setup and Shopify agent handoff. Adapter integration, deployment access, runtime permissions and live inventory rollout remain pending.

- 2026-09-23: Mounted a read-only S&S inventory route in the Windows gateway checkout and passed its new focused tests plus existing phase-two verification. Wrangler dry-run build passed and the separate Cloudflare Worker was deployed in disabled mode with no schedule, public route, or secrets. Render deployment and end-to-end dry-run remain pending.

- 2026-09-23: Render was deployed and a dedicated inventory-only key was configured. A new Shopify app with only `read_products` and `read_inventory` was installed and its client credentials bound to the inventory Worker. Cloudflare remote preview completed one 25-variant KS diagnostic with all 25 blocked and zero writes after correcting the Worker redirect mode. Production Worker was redeployed disabled at `0cce3ed5-5a34-4cfc-a7f6-ef2ffe9f356e`, with no cron or public route; production scheduled execution was not performed.

- 2026-09-23: Added a read-only stockout-gate evidence plan and focused stockout/restock/HQ/offline-location tests in the local `Shopify-Sync` checkout. No mutation path was added. The local Shopify credential could read per-location quantities but was denied the location online-fulfillment field; the dry-run query was narrowed to granted read fields and leaves fulfillment status unverified. A live 25-variant Shopify/S&S read selected one out-of-stock variant with `tracked=false`, `availableForSale=true`, `sellableOnlineQuantity=0`, no active S&S Supplier level and no positive other-location quantity. The public product JSON reported the exact variant as `available=true`. The gate marked a possible block while all writes remained blocked. No live Shopify or Cloudflare state changed.

- 2026-09-25: Added a hardcoded-shop, hardcoded-S&S-location, one-variant guarded writer with source-semantics and maximum-delta gates, exact-SKU and online-location checks, Shopify commitment subtraction, compare-and-set, and idempotency. Focused tests passed 26/26, documentation validation passed, and Wrangler dry-run built the bundle. Deployed separate Cloudflare Worker version `fad82450-90ea-428b-a188-08091aa45f6e` with `INVENTORY_SYNC_MODE=disabled`, empty protected-location list, no write-policy settings, no public route and no cron. No live inventory mutation, tracking, HQ count, location, or Shopify app scope changed.

- 2026-09-25: Fresh S&S physical-warehouse read confirmed Tultex 246 `B30459123` at zero, excluding DS/dropship. Shopify exact-SKU lookup found one variant, policy `DENY`, HQ available zero, no other level, and `availableForSale=true` while untracked. Enabled Shopify inventory tracking for that single variant through `productVariantsBulkUpdate`; readback and public product JSON both changed to unavailable. The neighboring Medium variant remained untracked and available. No Shopify quantity, HQ count, supplier location, app scope, or Worker setting changed. This is a manual stockout block; the disabled Worker will not automatically reopen it after S&S restocks.

- 2026-09-25: Owner released and approved `write_inventory` for the dedicated inventory app. Live installation scopes now show `read_products`, `read_inventory`, and `write_inventory`. S&S documentation defines warehouse `qty` as available for sale. The guarded one-off writer was corrected to mirror this quantity only when Shopify has zero committed units at every location; a focused regression test rejects a repeat after an order commitment. The Worker remains disabled with no cron. Read-only Shopify inspection found S&S Supplier active but not fulfilling online, absent from the General shipping profile, with no active inventory. A positive live pilot still requires reviewed shipping and fulfillment routing.

- 2026-09-25: Enabled S&S Supplier for online orders and added it to the existing General shipping profile group with HQ. Readback showed the same active Domestic USPS rate and no local pickup. Activated the S&S inventory level at **zero** for in-stock candidate SKU `B30459583` (Tultex 246 Heather Grey/Heather Charcoal / Small); it remains untracked with HQ zero and no sellability change. A fresh direct S&S read found 446 available across two physical warehouses. A hosted, authenticated one-variant Cloudflare version-URL dry run used the dedicated app and gateway secrets, returned 446 physical units and zero writes. The guarded write preflight then failed `SHOPIFY_ACCESS_DENIED` before any mutation because the dedicated app lacks the location read needed by its preflight. The temporary version URL was disabled; authenticated retry returned 404. Production Worker version `8a5c5369-cbcb-4d47-b4e5-e6ee24eb2584` is disabled with no route or cron. No positive supplier quantity was posted and no additional variant was tracked.

- 2026-09-25: Owner added and approved `read_locations`; live installation readback showed all four intended scopes. A second authenticated version-URL preflight got past the prior access denial and stopped at `WRITE_GUARD_BLOCKED` while the candidate was untracked. Tracked only `B30459583`, then ran the guarded one-variant Worker once: it read fresh S&S stock and wrote 446 to the active S&S Supplier level. Shopify readback showed HQ zero, S&S available/on-hand 446, committed zero, `availableForSale=true`, and online sellable quantity 446; public product JSON reported `available=true` with Shopify tracking. The temporary version URL was then disabled and authenticated retry returned 404. A separate Shopify compare-and-set restored the supplier level from 446 to zero, and tracking was returned to false. Public product JSON again showed `available=true` with no tracking, matching the pre-pilot behavior. Production Worker version `3ad4c346-6655-469a-8574-5e0bbf9a6857` is disabled with no route or cron. Checkout and order routing were not tested by placing a customer order; no automatic refresh was enabled.
