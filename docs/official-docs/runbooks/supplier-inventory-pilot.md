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

Each batch reads fresh S&S physical warehouse stock through one authenticated inventory gateway request. Dropship rows are excluded. It can lower only the supplier location's Shopify `available` quantity and uses compare-and-set so an intervening order does not get undone. Any validated decrease, including a large nonzero drop or a stockout, is applied. A successful gateway response that omits an enrolled 3001 SKU blocks that SKU at zero; a failed gateway response does not become zero stock. Stale, malformed, or ambiguous reads fail without a quantity write. A failed batch does not stop later batches in the same minute; the run reports partial failure. It does not automatically increase stock after restock or order cancellation, and it does not change HQ quantities. S&S may cap large per-warehouse quantities; the sync treats the reported quantity conservatively.

## Check and Pause

1. From `inventory-sync/`, use `npx wrangler deployments list --name printmo-inventory-sync` and inspect `wrangler.jsonc` plus `bella-3001-allowlist.mjs` to confirm the deployed version, both explicit allowlists, and one-minute cron with five shards.
2. Use `npx wrangler tail printmo-inventory-sync --format json` to see scheduled success or error codes. Read Shopify's exact variant and both inventory levels before drawing a stock conclusion; logs do not store a durable checkpoint.
3. To pause, set `INVENTORY_SYNC_MODE` to `disabled` and `triggers.crons` to `[]` in `wrangler.jsonc`, then deploy it with `npx wrangler deploy -c wrangler.jsonc`. Confirm the deploy output has no schedule. Pausing does not roll back Shopify stock or tracking.

Do not set a higher Shopify supplier quantity by guessing from a later S&S read. A reopen needs a current physical count and a check of outstanding customer commitments. The pilot does not yet know when Print-MO's S&S purchase has reduced the supplier feed.

## Common Failure Modes & Recovery

- `SHOPIFY_QUANTITY_CHANGED`: An order or other writer changed stock between read and write. The next scheduled run rereads; do not blindly retry the old target.
- Supplier or Shopify read errors: The run fails closed and leaves the last Shopify quantity in place. Check the gateway and app scopes before resuming if failures persist.
- Unexpected HQ quantity: Stop the pilot and investigate the separate HQ source; never compensate by writing supplier stock into HQ.
