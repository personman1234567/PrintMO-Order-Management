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

As of 2026-09-26, `inventory-sync/wrangler.jsonc` deploys the separate `printmo-inventory-sync` Cloudflare Worker in `pilot-refresh` mode every five minutes. Its allowlist contains exactly the six Heather Grey/Heather Charcoal sizes of Tultex 246, SKUs `B30459583`–`B30459588`; the product has 72 variants total. The S&S Supplier location is `gid://shopify/Location/95240290552`; Print-MO HQ is protected at `gid://shopify/Location/72791752952`. All six are tracked. Fresh readback after seeding found supplier available quantities Small 445, Medium 527, Large 362, XL 503, 2XL 586, 3XL 1,000, matching physical S&S warehouse reads, with zero committed and zero HQ for each. Production version `58956cf3-223f-4659-ae54-a92ab71e5906` has no public route or version URL. The first six-variant scheduled run succeeded with zero writes; post-run Shopify readback preserved those balances and HQ zero.

Each run reads fresh S&S physical warehouse stock through the authenticated inventory gateway for each allowlisted variant. Dropship rows are excluded. It can lower only the supplier location's Shopify `available` quantity and uses compare-and-set so an intervening order does not get undone. An exact S&S physical stockout may set that quantity to zero even when the difference exceeds the ordinary 20-unit limit. Missing, stale, malformed, or ambiguous reads fail without a quantity write. A failure for one variant does not prevent the other five from being checked; the run reports partial failure. It does not automatically increase stock after restock or order cancellation, and it does not read or change HQ quantities.

## Check and Pause

1. From `inventory-sync/`, use `npx wrangler deployments list --name printmo-inventory-sync` and inspect `wrangler.jsonc` to confirm the deployed version, six-variant allowlist, and five-minute schedule.
2. Use `npx wrangler tail printmo-inventory-sync --format json` to see scheduled success or error codes. Read Shopify's exact variant and both inventory levels before drawing a stock conclusion; logs do not store a durable checkpoint.
3. To pause, set `INVENTORY_SYNC_MODE` to `disabled` and `triggers.crons` to `[]` in `wrangler.jsonc`, then deploy it with `npx wrangler deploy -c wrangler.jsonc`. Confirm the deploy output has no schedule. Pausing does not roll back Shopify stock or tracking.

Do not set a higher Shopify supplier quantity by guessing from a later S&S read. A reopen needs a current physical count and a check of outstanding customer commitments. The pilot does not yet know when Print-MO's S&S purchase has reduced the supplier feed.

## Common Failure Modes & Recovery

- `WRITE_DELTA_EXCEEDS_LIMIT`: A nonzero partial S&S decrease is greater than 20 units. Inspect the current S&S warehouses and Shopify commitments before any manual correction. A true S&S zero is handled separately.
- `SHOPIFY_QUANTITY_CHANGED`: An order or other writer changed stock between read and write. The next scheduled run rereads; do not blindly retry the old target.
- Supplier or Shopify read errors: The run fails closed and leaves the last Shopify quantity in place. Check the gateway and app scopes before resuming if failures persist.
- Unexpected HQ quantity: Stop the pilot and investigate the separate HQ source; never compensate by writing supplier stock into HQ.
