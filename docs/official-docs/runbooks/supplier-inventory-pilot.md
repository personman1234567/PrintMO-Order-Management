# Supplier Inventory Sync: Enrolled S&S Products

## Use This When

- Enroll or refresh an existing Shopify catalog product from S&S inventory.
- Inspect, pause, resume or release the inventory service.

## Skip This When

- Changing Order Manager shelf counts, HQ stock, catalog content, prices or Designer assets.

## Section Map

- [Enroll an Existing Catalog Product](#enroll-an-existing-catalog-product)
- [Pilot Operating State](#pilot-operating-state)
- [Local Bulk-Read Candidate](#local-bulk-read-candidate)
- [Check and Pause](#check-and-pause)
- [Common Failure Modes & Recovery](#common-failure-modes--recovery)

## Enroll an Existing Catalog Product

From the repository root, an authorized request such as "enroll LS16005" runs:

```powershell
npm run repo -- inventory enroll LS16005 execute
# inventory sync PRODUCT execute uses the same operation.
# An exact product handle or Shopify product GID also works.
# Without execute, this is a read-only plan.
```

The CLI uses the permanent authenticated service. Root `.env` supplies `INVENTORY_ADMIN_KEY`; `INVENTORY_SERVICE_URL` defaults to `https://printmo-inventory-sync.printmobusiness.workers.dev`. Provider credentials stay hosted. Ordinary enrollment requires no Wrangler, source edits, deployment, temporary Worker or full catalog scan.

The script resolves one existing product, uses its live SKUs, checks duplicate counts, reads fresh physical S&S stock, automatically changes `CONTINUE` to `DENY`, activates missing supplier levels, enables tracking, sets quantities using compare-and-set, verifies supplier and protected inventory, and registers each verified batch in D1. SKU mappings already verified during intake are reused. Draft SKU copies are accepted only after a complete live duplicate lookup proves zero commitments at every draft inventory level. Active/Unlisted copies remain blocked.

`execute` validates and applies each batch directly; a separate plan is optional. Reports are saved under ignored `backups/inventory-enrollment/<handle>.json`. Repeating the command resumes from live Shopify state and registry progress; it never blindly replays saved quantities. Uncertain writes receive one bounded requery/recovery. Partial completion remains enrolled and is visible in status.

**Normal agent stop:** exit 0 with `status=verified` is completion evidence. Report the product and counts. Do not scan supplier CSVs, redo onboarding, write custom GraphQL, run tests, create Brain activity logs, or manually watch scheduled minutes for each product. Investigate only a reported blocker. Implementation changes require `npm run repo -- inventory test` and `npm run docs:check`.

## Pilot Operating State

The deployed configuration enables the D1 registry. Its live rows own enrollment and progress; `scheduled-variants.mjs` is the legacy bootstrap snapshot, not the enrollment destination. `deployment.json` records a code-release version and bootstrap hash. A code release verifies coverage against the live registry before/after deployment.

The migration imports 2,009 existing entries: 1,934 enabled and 75 shared 6400 SKUs disabled. Do not enroll either copy of those 75 SKUs until the owner resolves which listing is sellable. Twelve previously omitted adult 3001 SKUs remain outside the migrated schedule. Migration does not enroll other catalog products or alter Shopify tracking/quantities.

A one-minute cron prefetches supplier data for up to 250 due rows, processes Shopify operations in batches of at most 25 for approximately 45 seconds, and saves completion after each batch. The next run resumes oldest due work. Successful rows become due in 300 seconds; isolated guard failures retry after 60 seconds. Supplier rate limits and gateway 502/503 defer the remaining run with a persisted cooldown rather than repeatedly consuming the shared quota. There is no 2,000-variant limit, fixed 16-batch limit or application-level 49-request ceiling. This account's Worker uses the paid `standard` usage model. Runtime/provider quotas and throughput still apply; five minutes is the refresh target, not a full-catalog timing guarantee. `inventory status` reports actual age and warns beyond three target intervals. Local tests exercise 21,000 registry entries; they do not measure supplier/API latency at that scale.

All stock calculations retain the existing protections: physical S&S warehouse stock only, dropship excluded, safety buffer zero, supplier location `95240290552`, HQ `72791752952` untouched. Increases are capped by fresh supplier stock minus all Shopify commitments across locations; this may temporarily understate stock after a supplier purchase posts. Exact purchase reconciliation remains outside this workflow. First-time tracking also subtracts all existing Shopify commitments from verified supplier capacity, clamped at zero, while requiring the untracked supplier level to start at zero available. Existing commitments do not establish physical HQ stock and are not deleted or moved. HQ quantities remain unchanged and are read back. Every quantity write uses compare-and-set so checkout changes are not undone. Source failure/staleness/malformed data never becomes zero stock. A successful feed omission follows the variant's pinned `hold` or `block` policy; Tultex 246 and newer enrollments use `hold`.

## Local Bulk-Read Candidate

**Live on 2026-11-14 after owner approval.** Render gateway commit 84c9f1bb594f55f0e0965f1ca72fabca653ad4ac was deployed first. Worker version b2645ac7-a40f-4ade-8190-8880c0f5f06a includes bulk reads plus commitment-preserving first-time tracking. Authenticated cache verification preserved observedAt on repeated reads; scheduled failures cleared to zero while all 10,351 prior scheduled entries and 75 shared-SKU exclusions were preserved. The heading retains the original candidate name for existing retrieval links.

- Render accepts 1-250 distinct SKUs and reads only S&S products with fields=sku,styleID,warehouses,customerPrice. Warehouse qty is documented as available for sale; dropship flags arrive in the same response. Repeated DS vendor rows collapse only when every flag is true and each quantity is valid. Other duplicates, invalid quantities and unknown rows fail closed. Missing SKUs remain absent, including in cache.
- The process-local, account-scoped cache lasts 60 seconds from the actual fetch start. Hits preserve that timestamp; mixed-age results report the oldest contributing observation. Fills are serialized/coalesced, memory is bounded, and stale/error data is never served. Restarting Render clears the cache safely. This is a fetch observation, not a supplier-issued stock timestamp.
- The reader spaces cold requests by at least 1.5 seconds and permits at most 40 starts per rolling minute. It reads limit/remaining/reset, reserves ten reported requests, and returns a safe code plus Retry-After on deferral. S&S's timezone-less ISO reset value is interpreted as UTC. A supplier 429/503 is deferred without an immediate retry. Other services sharing the key still consume quota; this in-memory limiter is per process, so horizontal scaling would need a shared budget or divided limits.
- INVENTORY_SUPPLIER_BATCH_SIZE=250 selects up to 250 due registry rows for one source read. Each Shopify identity/commitment read, CAS write and saved registry checkpoint still covers at most 25 variants. Only completed batches advance. Unfinished prefetched rows remain due for a later run. No database migration or new secret is required. Setting the flag to 25 restores the old per-batch supplier-read pattern with the new single-endpoint gateway.
- Enrollment warms one product-scoped group through authenticated POST /inventory/prefetch after checking live Shopify product/SKU identities. The CLI then applies the existing 25-variant operations, requerying Shopify for every batch. Older service health responses fall back to 25 without calling the new endpoint. Rate limits, UPSTREAM_HTTP_502/503 and UPSTREAM_RETRY_DEFERRED stop the run; they do not trigger a verify/apply loop. Uncertain writes and CAS races retain one bounded recovery. Rerun after cooldown to resume from live state and verified registry progress.
- Registry throttling stops the current cron and saves a durable supplier-backoff job. Future cron invocations skip supplier work until its retryAt; expired cooldown state clears on resume. Prior verified timestamps and quantities are preserved. The five-minute observation bound is unchanged and enrollment also rechecks it immediately before constructing a quantity mutation. INVENTORY_REFRESH_SECONDS remains 300 and the run budget remains 45 seconds.

At full 250-SKU groups, 10,351 variants require 42 S&S calls instead of 830 at two calls per 25 variants (about 20x fewer); 577 variants require three initial bulk reads instead of 48. Cache expiry, restarts, interrupted groups and concurrent activity can add reads. These are call-count estimates, not a verified five-minute full-catalog refresh. Shopify throughput remains a separate limit.

Read-only evidence on 2026-11-14: a Gildan 5000 style read returned 592 supplier SKUs; 25 spread samples matched inventory across 250 physical warehouse quantities, with valid qty/dropship fields. A separate 250-SKU products request returned 243 requested rows and seven omissions with no unexpected rows. These samples support the endpoint choice; they do not prove every catalog row or reserve supplier inventory. Supplier documentation: [products](https://api.ssactivewear.com/V2/Products.aspx) and [rate limit](https://api.ssactivewear.com/V2/Default.aspx).

For a future owner-approved rollout or recovery, use this order:

1. Review scoped inventory diffs in both dirty checkouts; prepare explicit release commits without publishing unrelated local changes. Record the previous Render commit/deploy and Worker version before release. Run gateway npm run verify:inventory and npm test; run the repository inventory tests and docs check below.
2. Manually deploy the reviewed gateway commit on Render service srv-d07v58adbo4c738s2mag (Auto-Deploy stays off). Confirm that exact commit is Live. Using the existing scoped inventory-read credential, GET the inventory route with 250 exact known SKUs; repeat a 25-SKU subset within 60 seconds. Require safe response shape, identical observedAt for those cache hits, and successful existing order-route regression checks. Do not proceed on a 25-SKU-only gateway.
3. From the Order Management checkout, run the approved code release. It records/verifies the existing live registry coverage and shared-SKU exclusions. Check health reports supplierBatchSize=250, registryEnabled=true and the policy capability. Observe scheduled progress until previously due work completes, failures do not accumulate and oldest refresh age falls. Investigate a persistent five-minute target miss as throughput work rather than extending freshness bounds.
4. Run the exact Gildan enrollment command below. Require exit 0, status=verified, all 577 variants verified/registered if that is still the live product scope, and protected-location readback. On deferral stop, wait the reported cooldown and rerun the same command; never replay saved quantities or change HQ balances. Observe scheduled refresh for the added rows before enrolling further products.

From E:/PrintMO/PrintMO-Order-Management, the release/enrollment commands are (do not run before approval):

~~~powershell
npm run repo -- inventory release execute
npm run repo -- inventory health
npm run repo -- inventory status
npm run repo -- inventory enroll gildan-adult-heavy-cotton-t-shirt execute
npm run repo -- inventory status
~~~

Local checks: npm run repo -- inventory test and npm run docs:check. Gateway: npm run verify:inventory and npm test. Tests retain DENY, commitment subtraction, HQ isolation, missing/failed/stale source guards, unchanged CAS semantics and the existing shared 6400 holds.

Rollback: reduce the new Worker's supplier batch setting to 25 through an approved release, or restore its prior version, **before** restoring a gateway limited to 25. Keep registry data, tracking, quantities and HQ untouched. A rollback is another owner-approved deployment; use status to verify recovery. Pausing the cron follows Check and Pause below and does not undo completed enrollment.

## Supplier Garment Cost Sync

**Verified rollout, 2026-11-16:** Render gateway 96cf617 was deployed first; Worker 341220ee-3961-46fa-a4d6-4c48cde4f67b is enabled for all enrolled entries. The full preview, 35-variant pilot, 11596-variant initial reconciliation and unchanged scheduled follow-up completed. 11506 costs matched; 90 missing/unusable prices preserved existing costs. Final stock failures were zero and oldest age was 694s. Detailed prices and recovery values are in ignored backups/inventory-costs.

The optional cost sync uses the same 250-SKU gateway reads and updates Shopify **Cost per item** for enabled, enrolled S&S variants. It uses account customerPrice only, validates positive USD amounts to cents, and preserves the current cost on missing/invalid prices or currency mismatches. Retail prices, quantity/tracking/policy fields, HQ records, dropship exclusions and shared-SKU holds are outside the cost mutation. New enrollments join cost checking on their next scheduled refresh.

Default mode is disabled. The existing authenticated service stores the selected mode and optional pilot product in its job state; switching cost mode does not pause stock refreshes. Commands:

~~~powershell
npm run repo -- inventory costs preview execute
npm run repo -- inventory costs status
npm run repo -- inventory costs export
npm run repo -- inventory costs enable execute gid://shopify/Product/EXACT_NUMERIC_ID
npm run repo -- inventory costs enable execute
npm run repo -- inventory costs disable execute
~~~

Preview checks the normal registry schedule without Shopify cost writes. Status reports coverage since the most recent mode change, matches, proposed changes, exceptions and pending work. Export saves the complete check/recovery records under ignored backups/inventory-costs. The one-product pilot uses an exact product GID; enabling without a GID selects all enabled registry entries. Leave cron running and allow a full registry pass after each mode change; do not treat a zero-change partial preview as catalog completion.

Cost comparison is included in the existing Shopify scheduled read. If cost-field access is denied, stock falls back to its original read and records the cost-read exception. Stock writes and their 25-variant checkpoints finish before cost work. Cost inputs accumulate within the existing 250-SKU supplier group, then share batched D1 checks and recovery writes. Cost requests combine up to 250 variants and 25 product groups through aliased product mutations using the existing hosted product-write app. Each product result is confirmed independently. A partial final group is recorded at the run boundary; when time is exhausted its cost writes defer to a fresh pass. The per-run token is reused. Cost writes honor the normal Shopify throttle helper and stop near the run deadline; failures/deferred writes retry from fresh source and Shopify state on a later pass. Cost failures do not mark successful stock batches failed or activate supplier backoff. A long initial backfill can reduce stock throughput while costs are changing; watch actual refresh age during rollout.

Migration 0002 adds one current cost/check/recovery row per checked variant, not a price-history system. Check records are batched in D1. Before each cost mutation, old and intended costs are persisted; the mutation response must confirm the exact returned amounts/currency. Later unchanged checks preserve recovery values. To recover from a bad mapping, disable cost sync first, export the records, and restore only identified bad writes after comparing live costs with their recorded written_cost. Disabling alone does not undo costs, and automatic bulk restoration is intentionally absent.

Rollout: deploy the backwards-compatible Render price response first, then release the Worker disabled. Preview the complete eligible registry, inspect a small representative sample/differences, enable one product and verify readback, then enable the full registry and complete its initial reconciliation. Require matched costs or named exceptions, healthy stock refreshes, and an unchanged follow-up with no cost writes. Rollback can disable cost sync independently while leaving stock running.

This is current blank replacement cost, not invoice-level landed cost or full decorated COGS. S&S requests are unchanged; initial Shopify cost writes are extra. Existing order cost snapshots are not rewritten. Local verification is the existing inventory test command and docs check; the gateway runs verify:inventory and its existing shared-service tests.

## Refresh Timing

The existing schedule job includes aggregate timing.phases for setup, registry selection, supplier reads, lease renewal, stock batches, cost work and checkpoints. timing.detail/http/waits are nested measurements: do not add them to the phase totals. HTTP timings end at response headers; Shopify detail timings include response parsing and retry waits. timing.graphql reports returned requested/actual costs, throttled responses, minimum available budget and restore rate by request kind; it retains no payloads, tokens or SKU-level tracing. Lease acquisition precedes the existing elapsedMs window.

A lock-busy cron records schedule-busy separately without replacing the last completed schedule. Compare those timestamps with enrollment before treating an oldest-age sample as steady-state throughput. The 300-second setting is next eligibility after a successful checkpoint, not a maximum freshness guarantee; cron phase and backlog add time.

Use inventory status for these reports. Measure normal completed runs before choosing an optimization; keep the existing shared lease, stock guards, 25-variant CAS/checkpoint boundaries and source-observation age.

## Check and Pause

```powershell
npm run repo -- inventory health
npm run repo -- inventory status
```

Health verifies the permanent endpoint, hosted inventory scope and product-policy write capability. Status reports registered/enabled/excluded counts, failures, oldest refresh age and durable job progress. A shared database lease prevents enrollment and scheduled batches from writing concurrently; expired leases recover automatically. Status reads do not take the lease.

For a reviewed code release, run `npm run repo -- inventory release execute`. Initial provisioning can add a positional `POLICY_ENV_FILE` path (this avoids PowerShell/npm flag forwarding) to reuse the existing storefront-manager app's product-write credentials when the inventory app lacks `write_products`. Secrets are sent over stdin and never printed. Provider secrets are not added to the repository.

To pause, set `INVENTORY_SYNC_MODE=disabled` and `triggers.crons=[]` in `inventory-sync/wrangler.jsonc`, then run the release command and confirm no cron trigger. Restore `pilot-refresh` and the one-minute cron to resume. Pausing does not roll back stock, tracking or registry rows. Version preview URLs remain disabled; the permanent workers.dev route requires authentication and returns 404 otherwise.

## Common Failure Modes & Recovery

- `Shipping not available` with positive S&S stock: inspect the supplier location's complete address as well as online fulfillment and shipping-profile membership. S&S availability does not require positive HQ physical stock. On 2026-10-27, the existing merchant-managed S&S Supplier location had only a country; adding Print-MO's verified ship-from address restored USPS rates in ordinary checkout and two affected draft-item configurations. Keep the same supplier location ID, supplier quantities, tracking, `DENY` policy and separate HQ counts. Its address represents where Print-MO ships the finished order, not a claim that supplier blanks are physically on the HQ shelf. `shipsInventory` is a legacy field and remained false after rates recovered; do not use it alone as a shipping eligibility gate. Verify with a fresh checkout containing a supplier-only-stock variant and an address, plus the exact affected draft configuration. Reversing the address change can recreate the rate failure; preserve the prior address for rollback and reverify rates after any ship-from change. See Shopify's [shipping-rate troubleshooting](https://help.shopify.com/en/manual/fulfillment/setup/shipping-rates/troubleshooting) and [location contract](https://shopify.dev/docs/api/admin-graphql/latest/objects/Location).
- `PRODUCT_AMBIGUOUS_USE_HANDLE`: use the exact existing handle; do not guess or create a product.
- `INVENTORY_BUSY`: another operation owns the shared lease; the CLI waits up to 90 seconds. Rerun if it remains busy.
- `SHARED_SUPPLIER_SKU`, `HELD_SHARED_6400_SKU`, `PINNED_SKU_CHANGED`, `OTHER_LOCATION_HAS_STOCK`: resolve that specific identity/stock exception; preserve HQ and listing holds.
- `PRODUCT_POLICY_WRITE_SCOPE_MISSING`: provision the existing product-write app credentials through a code release. Overselling normally corrects automatically before enrollment proceeds.
- `UNTRACKED_ITEM_HAS_SUPPLIER_STOCK`: an untracked variant already has nonzero available at the supplier location; resolve that exact supplier-level state before initializing. Existing HQ commitments alone are supported by conservative subtraction and do not require a HQ reset.
- `SUPPLIER_SKU_MISSING_OR_UNKNOWN`: enrollment stops before policy or inventory changes. Check the specific source SKU; do not initialize unknown stock as zero.
- `SHOPIFY_QUANTITY_CHANGED`, `ENROLLMENT_READBACK_CHANGED_REQUERY`: quantities/commitments changed during the operation. Rerun from fresh live state; never replay an old target.
- `INVENTORY_SERVICE_CREDENTIALS_MISSING`, `INVENTORY_SERVICE_HTTP_404`: check the stable service URL and local admin key; do not create a temporary Worker.
- `DEPLOYMENT_DRIFT_FETCH_SOURCE_FIRST`: code-release receipt differs from production. Reconcile the owning code release before deploying. Routine enrollment does not require a deployment receipt.
- Supplier/Shopify errors: the affected batch retains its prior verified timestamp and retries later; inspect status if failures or refresh age persist. A successful omitted zero-stock `hold` SKU can remain unchanged while polling for return; this is not proof of source zero.
- Unexpected HQ stock: investigate the independent HQ source; never compensate by writing supplier stock into HQ.
