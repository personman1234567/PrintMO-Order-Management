# Supplier Inventory Sync: Enrolled S&S Products

## Use This When

- You need to enroll an existing catalog product or refresh its supplier inventory.
- You need to inspect, pause, or resume the live S&S-to-Shopify inventory pilot.
- You need to decide whether a supplier stockout was reflected for an enrolled variant.

## Skip This When

- You are changing Order Manager shelf counts or HQ physical inventory.
- You are creating a new catalog product, changing prices, or preparing Designer assets.

## Section Map

- [Enroll an Existing Catalog Product](#enroll-an-existing-catalog-product)
- [Pilot Operating State](#pilot-operating-state)
- [Check and Pause](#check-and-pause)
- [Common Failure Modes & Recovery](#common-failure-modes--recovery)

## Enroll an Existing Catalog Product

For an authorized request such as "enroll LS16005" or "sync its supplier inventory", run from the repository root:

```powershell
npm run repo -- inventory enroll LS16005 execute
# An exact product handle or Shopify product GID works too.
# Without the final word execute, the command produces a plan only.
```

`inventory sync PRODUCT execute` uses the same safe operation: already enrolled items are refreshed conservatively, and missing enrollment entries are added. The positional `execute` avoids npm's PowerShell flag forwarding problem. No new credential or app scope is needed: the existing `.env` supplies local product reads and Wrangler uses the hosted inventory app for writes.

The command resolves the existing product, uses its live SKUs, checks duplicate counts and oversell policy, reads fresh physical-only S&S stock, activates missing supplier levels, safely initializes tracking/quantities, reads back both locations, preserves prior enrollments, checks schedule capacity and deployment drift, and deploys only when new schedule entries are added. It saves progress/results to ignored `backups/inventory-enrollment/<handle>.json`. A rerun resumes from live state; it never replays old quantities or blindly reseeds an already tracked variant. Transient failures and uncertain writes receive one bounded recovery after requery.

**Normal agent stop:** exit 0 with `status=verified` is the scoped completion evidence. Report the product and counts. Do not scan supplier CSVs, redo apparel onboarding, write custom GraphQL, run the test suite, or manually watch five scheduled minutes for each product. Existing catalog intake owns style/color/size mapping. Investigate only a reported inconsistency or a specific blocker. Implementation changes still require the owning inventory tests and documentation check.

The temporary hosted operation is authenticated, restricted to the exact product, expires after 15 minutes, and is disabled in cleanup. Shopify/gateway secrets are not copied locally. Its plan phase can upload a Worker version but does not change production or Shopify quantities. Local reports are operational evidence, not a second inventory authority.

The tracked `inventory-sync/deployment.json` ties the deployed version to the pinned scope hash. A normal enrollment must not deploy unrelated uncommitted inventory code. Commit both that receipt and additive `scheduled-variants.mjs` changes after a successful new enrollment; publish through the normal repository workflow. If drift is reported, fetch the owning source and reconcile the actual deployment; do not overwrite production from a stale checkout.

## Pilot Operating State

As of 2026-10-06, `inventory-sync/wrangler.jsonc` deploys `printmo-inventory-sync` in `pilot-refresh` mode for **1,318 scheduled variants**, including all 105 Lane Seven LS16005 variants. The pinned source has 1,393 entries; the same 75 shared 6400 SKUs remain excluded. Existing live coverage was recovered before deployment, including the 1566, 2000T, FTEX00, and 1300 enrollments that had been absent from the checkout. Five rotating minute shards contain 264, 264, 264, 263, and 263 variants. Batches contain at most 25 variants; the current schedule needs 11 batches per minute, at most 34 ordinary requests including authentication. Enrollment automatically checks the 16-batch ceiling. Every scheduled variant is checked once every five minutes. S&S Supplier remains `gid://shopify/Location/95240290552`; Print-MO HQ remains protected at `gid://shopify/Location/72791752952`.

LS16005 enrollment readback verified all 105 items tracked, supplier-active, and seeded from fresh physical S&S counts: 89 positive and 16 zero, with no HQ quantity changes. Exact supplier style/color/size mapping, unique SKUs, DENY policy, and zero commitments were checked. Worker version `8bc94dd6-3c20-446f-8922-1e19868626e6` retains conservative reopening and physical-only warehouse selection. The gateway fix accepts repeated DS product metadata only when all repeated flags are dropship true; ambiguous physical rows still fail closed. Temporary enrollment URLs are disabled.

Enrollment must not assume `inventoryActivate(available: ...)` seeds an untracked item: the LS16005 readback showed an active level at zero while tracking was false. Activate the supplier level, read its current quantity and all commitments, then enable tracking and set the freshly verified supplier quantity in one serial GraphQL request. The quantity mutation must use compare-and-set and idempotency; `inventoryActivate` also requires `@idempotent` in API 2026-04 and later. Requery both tracking and quantities before scheduling. A failed or uncertain result requires requery before retry; do not leave a newly tracked in-stock item at zero.

The 2026-09-27 Shopify readback confirmed all 297 newly enrolled variants tracked with active S&S Supplier levels, no changed HQ available quantity, and no seed mismatches. The 3719 and two 8871 products are complete. The nine unique 6400 SKUs are all absent from the successful S&S batch read and were initialized at zero; **the other 75 active 6400 variants are not synced yet**. A second Unlisted 6400 product uses those same 75 SKUs and remains purchasable through a direct link with `inventoryPolicy=CONTINUE`. Do not sync either copy of those shared SKUs until the owner chooses which listing should be sellable and the other is blocked. One open 6400 order has a single HQ committed unit; enrollment preserved that commitment and did not write HQ stock.

The first five expanded scheduled runs on 2026-09-27 each completed successfully for 199 variants; three guarded downward writes occurred and no batch failed. A fresh two-variant spot check found Shopify supplier available equal to physical S&S warehouse stock for one 3719 and one 8871 Crazy variant, with HQ untouched.

All 638 adult 3001 Shopify variants are tracked and have active S&S Supplier inventory levels. Twelve exact 3001 SKUs returned 404 from individual S&S reads, were set to zero, and are intentionally excluded from automatic refresh. The post-enrollment Shopify readback found 20 unavailable 3001 variants: those twelve and eight with confirmed physical S&S stock at zero. HQ available was zero for every 3001 variant. One preexisting HQ record had seven committed/on-hand units and was left untouched; this is not evidence of physical shelf stock. Version URLs and public routes are off.

The conservative reopen setting was deployed on 2026-09-26. Its first five scheduled shards completed successfully and covered all 698 scheduled variants. One adult 3001 supplier level increased; a targeted Shopify readback showed 375 available, zero committed, and 375 on hand, matching a fresh physical S&S read of 375. This verifies one live increase without an outstanding commitment; the committed-order purchase lifecycle remains unverified.

Each batch reads fresh S&S physical warehouse stock through one authenticated inventory gateway request. Dropship rows are excluded. Validated decreases, including a large drop or stockout, still lower only the supplier location's Shopify `available` quantity. For an increase, `SUPPLIER_REOPEN_POLICY=subtract-shopify-commitments` caps the new supplier availability at fresh S&S stock minus **all Shopify committed units for that variant across locations**. This prevents reopening units still promised to customers before an S&S purchase reduces its feed. It can temporarily understate stock after that purchase has posted, until Shopify clears the commitment; it is not exact purchase reconciliation. Every quantity write uses Shopify compare-and-set so an intervening checkout is not undone. A successful gateway response that omits an enrolled closeout SKU blocks that SKU at zero; a failed gateway response does not become zero stock. Tultex 246 still holds on a missing SKU. Stale, malformed, or ambiguous reads fail without a quantity write. A failed batch does not stop later batches in the same minute; the run reports partial failure. HQ quantities remain untouched. S&S may cap large per-warehouse quantities; the sync treats the reported quantity conservatively.

## Check and Pause

1. From `inventory-sync/`, use `npx wrangler deployments list --name printmo-inventory-sync` and inspect `wrangler.jsonc`, `scheduled-variants.mjs`, and `priority-shared-6400.mjs` to confirm the deployed version, exact SKU mapping, exclusion, and one-minute cron with five shards.
2. Use `npx wrangler tail printmo-inventory-sync --format json` to see scheduled success or error codes. Read Shopify's exact variant and both inventory levels before drawing a stock conclusion; logs do not store a durable checkpoint.
3. To pause, set `INVENTORY_SYNC_MODE` to `disabled` and `triggers.crons` to `[]` in `wrangler.jsonc`, then deploy it with `npx wrangler deploy -c wrangler.jsonc`. Confirm the deploy output has no schedule. Pausing does not roll back Shopify stock or tracking.

Do not force a higher Shopify supplier quantity from a stale or guessed S&S value. The guarded schedule can reopen from a fresh physical count after subtracting all Shopify commitments. A manual correction beyond that conservative ceiling still needs a current source read and verified outstanding-order state. The pilot does not yet know when Print-MO's S&S purchase has reduced the supplier feed.

## Common Failure Modes & Recovery

- `PRODUCT_AMBIGUOUS_USE_HANDLE`: use the exact existing handle; do not guess a product or create one.
- `SHARED_SUPPLIER_SKU`, `OVERSELL_POLICY`, or `OTHER_LOCATION_HAS_STOCK`: resolve only that exception; preserve HQ stock and duplicate-listing holds. A copied SKU on a Draft product is permitted only after a complete live SKU lookup proves zero commitments at every draft inventory level. Active/Unlisted copies, incomplete reads, and committed draft copies remain blocked. Enrollment and scheduled refresh write only the selected variant IDs; they never change the draft copy.
- `SUPPLIER_SKU_MISSING_OR_UNKNOWN`: enrollment stops before mutation. A supplier failure or missing row is never seeded as zero.
- `DEPLOYMENT_DRIFT_FETCH_SOURCE_FIRST`: the active Worker version or pinned scope differs from the tracked deployment receipt. Fetch/reconcile the owning release before applying; do not bypass the receipt.
- `COMMIT_INVENTORY_IMPLEMENTATION_BEFORE_ENROLLMENT`: commit reviewed implementation changes before the tool deploys additional products.
- `SCHEDULE_CAPACITY_EXCEEDED`: additional entries would exceed the five-minute request budget. Prepare a capacity change separately; do not enroll unscheduled inventory. The Worker also caps actual external calls at 49 including retries; `SCHEDULE_REQUEST_BUDGET_DEFERRED` leaves the remaining work untouched for a fresh scheduled attempt.
- `ENROLLMENT_PREVIEW_CLEANUP_REQUIRED`: quantities may already be verified, but temporary URL cleanup failed. Disable the Worker's preview URLs through authenticated Cloudflare configuration; requery before retrying inventory. The operation also expires automatically.
- `ENROLLMENT_ALREADY_RUNNING`: another command holds the local lock. Do not run overlapping enrollments. A lock from an exited process is recovered automatically; an invalid lock requires inspection.
- `inventory-variant-held` / `SUPPLIER_SKU_MISSING_ZERO_UNCOMMITTED`: a successful feed omitted an already tracked, zero-stock SKU with no commitments anywhere. Leave quantities untouched and keep polling for return. This is an explicit hold, not proof of supplier zero. Missing SKUs with positive Shopify stock still fail visibly. The four observed older 2000T variants are in this zero-stock state; direct supplier reads returned 404 on 2026-10-06.

- `SHOPIFY_QUANTITY_CHANGED`: An order or other writer changed stock between read and write. The next scheduled run rereads; do not blindly retry the old target.
- Supplier or Shopify read errors: The run fails closed and leaves the last Shopify quantity in place. Check the gateway and app scopes before resuming if failures persist.
- Unexpected HQ quantity: Stop the pilot and investigate the separate HQ source; never compensate by writing supplier stock into HQ.
