# Supplier Inventory Pilot: Tultex 246 and Bella+Canvas 3001

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

As of 2026-09-26, `inventory-sync/wrangler.jsonc` deploys the separate `printmo-inventory-sync` Cloudflare Worker in `pilot-refresh` mode for **all 72 Tultex 246 variants and 626 of 638 adult Bella+Canvas 3001 variants**. It runs every minute in five fixed shards, so each enrolled variant is checked once every five minutes. The 3001 allowlist is explicit in `inventory-sync/bella-3001-allowlist.mjs`; each scheduled minute uses at most nine 3001 batches of 15, plus one Tultex batch. The S&S Supplier location is `gid://shopify/Location/95240290552`; Print-MO HQ is protected at `gid://shopify/Location/72791752952`.

All 638 adult 3001 Shopify variants are tracked and have active S&S Supplier inventory levels. Twelve exact 3001 SKUs returned 404 from individual S&S reads, were set to zero, and are intentionally excluded from automatic refresh. The post-enrollment Shopify readback found 20 unavailable 3001 variants: those twelve and eight with confirmed physical S&S stock at zero. HQ available was zero for every 3001 variant. One preexisting HQ record had seven committed/on-hand units and was left untouched; this is not evidence of physical shelf stock. Version URLs and public routes are off.

The conservative reopen setting was deployed on 2026-09-26. Its first five scheduled shards completed successfully and covered all 698 scheduled variants. One adult 3001 supplier level increased; a targeted Shopify readback showed 375 available, zero committed, and 375 on hand, matching a fresh physical S&S read of 375. This verifies one live increase without an outstanding commitment; the committed-order purchase lifecycle remains unverified.

Each batch reads fresh S&S physical warehouse stock through one authenticated inventory gateway request. Dropship rows are excluded. Validated decreases, including a large drop or stockout, still lower only the supplier location's Shopify `available` quantity. For an increase, `SUPPLIER_REOPEN_POLICY=subtract-shopify-commitments` caps the new supplier availability at fresh S&S stock minus **all Shopify committed units for that variant across locations**. This prevents reopening units still promised to customers before an S&S purchase reduces its feed. It can temporarily understate stock after that purchase has posted, until Shopify clears the commitment; it is not exact purchase reconciliation. Every quantity write uses Shopify compare-and-set so an intervening checkout is not undone. A successful gateway response that omits an enrolled 3001 SKU blocks that SKU at zero; a failed gateway response does not become zero stock. Stale, malformed, or ambiguous reads fail without a quantity write. A failed batch does not stop later batches in the same minute; the run reports partial failure. HQ quantities remain untouched. S&S may cap large per-warehouse quantities; the sync treats the reported quantity conservatively.

## Check and Pause

1. From `inventory-sync/`, use `npx wrangler deployments list --name printmo-inventory-sync` and inspect `wrangler.jsonc` plus `bella-3001-allowlist.mjs` to confirm the deployed version, both explicit allowlists, and one-minute cron with five shards.
2. Use `npx wrangler tail printmo-inventory-sync --format json` to see scheduled success or error codes. Read Shopify's exact variant and both inventory levels before drawing a stock conclusion; logs do not store a durable checkpoint.
3. To pause, set `INVENTORY_SYNC_MODE` to `disabled` and `triggers.crons` to `[]` in `wrangler.jsonc`, then deploy it with `npx wrangler deploy -c wrangler.jsonc`. Confirm the deploy output has no schedule. Pausing does not roll back Shopify stock or tracking.

Do not force a higher Shopify supplier quantity from a stale or guessed S&S value. The guarded schedule can reopen from a fresh physical count after subtracting all Shopify commitments. A manual correction beyond that conservative ceiling still needs a current source read and verified outstanding-order state. The pilot does not yet know when Print-MO's S&S purchase has reduced the supplier feed.

## Common Failure Modes & Recovery

- `SHOPIFY_QUANTITY_CHANGED`: An order or other writer changed stock between read and write. The next scheduled run rereads; do not blindly retry the old target.
- Supplier or Shopify read errors: The run fails closed and leaves the last Shopify quantity in place. Check the gateway and app scopes before resuming if failures persist.
- Unexpected HQ quantity: Stop the pilot and investigate the separate HQ source; never compensate by writing supplier stock into HQ.
