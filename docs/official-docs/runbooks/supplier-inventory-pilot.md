# Tultex 246 Supplier Inventory Pilot

## Use This When

- You need to inspect, pause, or resume the live S&S-to-Shopify inventory pilot.
- You need to decide whether a supplier stockout was reflected for the enrolled variant.

## Skip This When

- You are changing Order Manager shelf counts or HQ physical inventory.
- You are enrolling another product; first review the [supplier inventory plan](../future-plans/supplier-inventory-sync-plan.md#current-continuation-state).

## Section Map

- [Pilot Operating State](#pilot-operating-state)
- [Check and Pause](#check-and-pause)
- [Common Failure Modes & Recovery](#common-failure-modes--recovery)

## Pilot Operating State

As of 2026-09-26, `inventory-sync/wrangler.jsonc` deploys the separate `printmo-inventory-sync` Cloudflare Worker in `pilot-refresh` mode for **all 72 Tultex 246 variants**. It runs every minute in five fixed shards of 14–15 variants, so each variant is checked once every five minutes. The S&S Supplier location is `gid://shopify/Location/95240290552`; Print-MO HQ is protected at `gid://shopify/Location/72791752952`. All 72 Shopify variants are tracked and have an active S&S Supplier inventory level. After enrollment, a full Shopify readback found five supplier stockouts at zero, no unexpected commitments, and HQ available/committed at zero for every variant. Version URLs and public routes are off.

Each shard reads fresh S&S physical warehouse stock through one authenticated inventory gateway request. Dropship rows are excluded. It can lower only the supplier location's Shopify `available` quantity and uses compare-and-set so an intervening order does not get undone. A confirmed physical S&S stockout may set that quantity to zero even when the difference exceeds the ordinary 20-unit limit. Missing, stale, malformed, or ambiguous reads fail without a quantity write. An individual variant failure does not prevent other variants in the shard from being checked; the run reports partial failure. It does not automatically increase stock after restock or order cancellation, and it does not read or change HQ quantities. S&S may cap large per-warehouse quantities; the sync treats the reported quantity conservatively.

## Check and Pause

1. From `inventory-sync/`, use `npx wrangler deployments list --name printmo-inventory-sync` and inspect `wrangler.jsonc` to confirm the deployed version, 72-variant allowlist, and one-minute cron with five shards.
2. Use `npx wrangler tail printmo-inventory-sync --format json` to see scheduled success or error codes. Read Shopify's exact variant and both inventory levels before drawing a stock conclusion; logs do not store a durable checkpoint.
3. To pause, set `INVENTORY_SYNC_MODE` to `disabled` and `triggers.crons` to `[]` in `wrangler.jsonc`, then deploy it with `npx wrangler deploy -c wrangler.jsonc`. Confirm the deploy output has no schedule. Pausing does not roll back Shopify stock or tracking.

Do not set a higher Shopify supplier quantity by guessing from a later S&S read. A reopen needs a current physical count and a check of outstanding customer commitments. The pilot does not yet know when Print-MO's S&S purchase has reduced the supplier feed.

## Common Failure Modes & Recovery

- `WRITE_DELTA_EXCEEDS_LIMIT`: A nonzero partial S&S decrease is greater than 20 units. Inspect the current S&S warehouses and Shopify commitments before any manual correction. A true S&S zero is handled separately.
- `SHOPIFY_QUANTITY_CHANGED`: An order or other writer changed stock between read and write. The next scheduled run rereads; do not blindly retry the old target.
- Supplier or Shopify read errors: The run fails closed and leaves the last Shopify quantity in place. Check the gateway and app scopes before resuming if failures persist.
- Unexpected HQ quantity: Stop the pilot and investigate the separate HQ source; never compensate by writing supplier stock into HQ.
