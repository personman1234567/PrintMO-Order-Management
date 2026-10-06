# Supplier Inventory Sync: Enrolled S&S Products

## Use This When

- Enroll or refresh an existing Shopify catalog product from S&S inventory.
- Inspect, pause, resume or release the inventory service.

## Skip This When

- Changing Order Manager shelf counts, HQ stock, catalog content, prices or Designer assets.

## Section Map

- [Enroll an Existing Catalog Product](#enroll-an-existing-catalog-product)
- [Pilot Operating State](#pilot-operating-state)
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

A one-minute cron takes due rows in batches of 25, processes work for approximately 45 seconds, and saves completion after each batch. The next run resumes oldest due work. Successful rows become due in 300 seconds; failed batches retry after 60 seconds without blocking later batches. There is no 2,000-variant limit, fixed 16-batch limit or application-level 49-request ceiling. This account's Worker uses the paid `standard` usage model. Runtime/provider quotas and throughput still apply; five minutes is the refresh target, not a full-catalog timing guarantee. `inventory status` reports actual age and warns beyond three target intervals. Local tests exercise 21,000 registry entries; they do not measure supplier/API latency at that scale.

All stock calculations retain the existing protections: physical S&S warehouse stock only, dropship excluded, safety buffer zero, supplier location `95240290552`, HQ `72791752952` untouched. Increases are capped by fresh supplier stock minus all Shopify commitments across locations; this may temporarily understate stock after a supplier purchase posts. Exact purchase reconciliation remains outside this workflow. Every quantity write uses compare-and-set so checkout changes are not undone. Source failure/staleness/malformed data never becomes zero stock. A successful feed omission follows the variant's pinned `hold` or `block` policy; Tultex 246 and newer enrollments use `hold`.

## Check and Pause

```powershell
npm run repo -- inventory health
npm run repo -- inventory status
```

Health verifies the permanent endpoint, hosted inventory scope and product-policy write capability. Status reports registered/enabled/excluded counts, failures, oldest refresh age and durable job progress. A shared database lease prevents enrollment and scheduled batches from writing concurrently; expired leases recover automatically. Status reads do not take the lease.

For a reviewed code release, run `npm run repo -- inventory release execute`. Initial provisioning can add a positional `POLICY_ENV_FILE` path (this avoids PowerShell/npm flag forwarding) to reuse the existing storefront-manager app's product-write credentials when the inventory app lacks `write_products`. Secrets are sent over stdin and never printed. Provider secrets are not added to the repository.

To pause, set `INVENTORY_SYNC_MODE=disabled` and `triggers.crons=[]` in `inventory-sync/wrangler.jsonc`, then run the release command and confirm no cron trigger. Restore `pilot-refresh` and the one-minute cron to resume. Pausing does not roll back stock, tracking or registry rows. Version preview URLs remain disabled; the permanent workers.dev route requires authentication and returns 404 otherwise.

## Common Failure Modes & Recovery

- `PRODUCT_AMBIGUOUS_USE_HANDLE`: use the exact existing handle; do not guess or create a product.
- `INVENTORY_BUSY`: another operation owns the shared lease; the CLI waits up to 90 seconds. Rerun if it remains busy.
- `SHARED_SUPPLIER_SKU`, `HELD_SHARED_6400_SKU`, `PINNED_SKU_CHANGED`, `OTHER_LOCATION_HAS_STOCK`: resolve that specific identity/stock exception; preserve HQ and listing holds.
- `PRODUCT_POLICY_WRITE_SCOPE_MISSING`: provision the existing product-write app credentials through a code release. Overselling normally corrects automatically before enrollment proceeds.
- `SUPPLIER_SKU_MISSING_OR_UNKNOWN`: enrollment stops before policy or inventory changes. Check the specific source SKU; do not initialize unknown stock as zero.
- `SHOPIFY_QUANTITY_CHANGED`, `ENROLLMENT_READBACK_CHANGED_REQUERY`: quantities/commitments changed during the operation. Rerun from fresh live state; never replay an old target.
- `INVENTORY_SERVICE_CREDENTIALS_MISSING`, `INVENTORY_SERVICE_HTTP_404`: check the stable service URL and local admin key; do not create a temporary Worker.
- `DEPLOYMENT_DRIFT_FETCH_SOURCE_FIRST`: code-release receipt differs from production. Reconcile the owning code release before deploying. Routine enrollment does not require a deployment receipt.
- Supplier/Shopify errors: the affected batch retains its prior verified timestamp and retries later; inspect status if failures or refresh age persist. A successful omitted zero-stock `hold` SKU can remain unchanged while polling for return; this is not proof of source zero.
- Unexpected HQ stock: investigate the independent HQ source; never compensate by writing supplier stock into HQ.
