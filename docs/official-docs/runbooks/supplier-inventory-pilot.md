# Supplier Inventory Sync: Enrolled S&S Products

## Use This When

- You need to inspect, pause, or resume the live S&S-to-Shopify inventory pilot.
- You need to decide whether a supplier stockout was reflected for an enrolled variant.

## Skip This When

- You are changing Order Manager shelf counts or HQ physical inventory.
- You are enrolling another product; first review the [supplier inventory plan](../future-plans/supplier-inventory-sync-plan.md#current-continuation-state).

## Section Map

- [Pilot Operating State](#pilot-operating-state)
- [Check and Pause](#check-and-pause)
- [Common Failure Modes & Recovery](#common-failure-modes--recovery)

## Pilot Operating State

As of 2026-09-29, `inventory-sync/wrangler.jsonc` deploys the separate `printmo-inventory-sync` Cloudflare Worker in `pilot-refresh` mode for **1,213 active scheduled variants** (1,288 total scheduled variants): 72 Tultex 246, 626 adult Bella+Canvas 3001, 96 Bella+Canvas 3719, 96 J. America 8871 Classic Colors, 96 J. America 8871 Crazy Colors, 120 Comfort Colors 1566, 32 Gildan 2000T, 30 American Apparel FTEX00, 36 Unisex Mineral Wash T-Shirt 1300, and 9 unique Bella+Canvas 6400 SKUs. It runs every minute in five fixed shards [243, 243, 243, 242, 242], so each scheduled variant is checked once every five minutes. `inventory-sync/scheduled-variants.mjs` pins each Shopify variant to its exact S&S SKU; `priority-shared-6400.mjs` excludes 75 active 6400 variants that share SKUs with a second purchasable Unlisted 6400 product. Each minute has at most 16 batches of 16 (max 49 subrequests <= 50). The S&S Supplier location is `gid://shopify/Location/95240290552`; Print-MO HQ is protected at `gid://shopify/Location/72791752952`.

The 2026-09-29 Unisex Mineral Wash T-Shirt 1300 enrollment (`Unisex Mineral Wash T-Shirt - 1300`, `gid://shopify/Product/10279494025464`, 36 variants across 5 colors) confirmed all 36 variants updated to `inventoryPolicy=DENY` and `tracked=true`, all 36 S&S-carried physical warehouse variants seeded with live physical stock (24,671 physical warehouse units total across 28 in-stock variants, 8 stockouts seeded at 0, 0 missing SKUs), and Print-MO HQ strictly untouched with zero available, zero committed, zero on hand. They are pinned in `scheduled-variants.mjs` under cohort `1300` with `hold` on missing.

The 2026-09-29 American Apparel FTEX00 enrollment (`American Apparel - Unisex French Terry Oversized Boxy Tee - FTEX00`, `gid://shopify/Product/15376756408568`, 30 variants across 6 colors) confirmed all 30 variants updated to `inventoryPolicy=DENY` and `tracked=true`, all 30 S&S-carried physical warehouse variants seeded with live physical stock (28,130 physical warehouse units total, 0 stockouts, 0 missing SKUs), and Print-MO HQ strictly untouched with zero available and zero committed. They are pinned in `scheduled-variants.mjs` under cohort `FTEX00` with `hold` on missing.

The 2026-09-28 Gildan 2000T enrollment (`Gildan - Ultra Cotton® Tall T-Shirt - 2000T`, `gid://shopify/Product/10274739486968`, 32 variants across 8 colors) confirmed all 8 option values linked to native swatches (`shopify--color-pattern`), all 32 variants updated to `inventoryPolicy=DENY` and `tracked=true`, all 28 S&S-carried physical warehouse variants seeded with live physical stock, and the 4 uncarried Red SKUs seeded at zero (`availableForSale=false`). Print-MO HQ was strictly untouched with zero available and zero committed. They are pinned in `scheduled-variants.mjs` under cohort `2000T` with `hold` on missing.

The 2026-09-28 Comfort Colors 1566 enrollment confirmed all 120 variants tracked and active at S&S Supplier with `inventoryPolicy=DENY`, exactly 356,831 physical warehouse units seeded across all 120 variants (0 stockouts, 0 missing SKUs), and Print-MO HQ strictly untouched with zero available and zero committed. Status guards in `clients.mjs` and `writer.mjs` accept both `ACTIVE` and `UNLISTED`.

The 2026-09-27 Shopify readback confirmed all 297 previously enrolled variants tracked with active S&S Supplier levels, no changed HQ available quantity, and no seed mismatches. The 3719 and two 8871 products are complete. The nine unique 6400 SKUs are all absent from the successful S&S batch read and were initialized at zero; **the other 75 active 6400 variants are not synced yet**. A second Unlisted 6400 product uses those same 75 SKUs and remains purchasable through a direct link with `inventoryPolicy=CONTINUE`. Do not sync either copy of those shared SKUs until the owner chooses which listing should be sellable and the other is blocked. One open 6400 order has a single HQ committed unit; enrollment preserved that commitment and did not write HQ stock.

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

- `SHOPIFY_QUANTITY_CHANGED`: An order or other writer changed stock between read and write. The next scheduled run rereads; do not blindly retry the old target.
- Supplier or Shopify read errors: The run fails closed and leaves the last Shopify quantity in place. Check the gateway and app scopes before resuming if failures persist.
- Unexpected HQ quantity: Stop the pilot and investigate the separate HQ source; never compensate by writing supplier stock into HQ.
