# In-House Blank Inventory

- **Status**: `[Implemented Candidate]`
- **Owner**: PrintMO shop staff
- **Last Updated**: 2026-09-24

## Summary & Intent

Replace the shop's whiteboard with inventory integrated into Order Manager. The first scope is the exact Tultex 202 Shopify product (`gid://shopify/Product/8984050729208`). D1 is the authority for shop stock. Shopify HQ balances are never imported as physical shelf counts.

## Current Continuation State

- **Current state**: Tultex 202 physical shelf stock, reservations, pulls, and receipts are deployed in Order Manager. Staff opening counts are pending.
- **Next safe action**: Count actual Tultex 202 blanks and enter opening quantities in the Inventory tab.
- **Remaining blockers**: Physical counts and staff acceptance. The separate S&S storefront stockout gate remains future work.
- **Owner / external actions**: Shop staff physically count the Tultex 202 shelf and enter quantities in Inventory.
- **Last verified evidence**: Focused phase-two checks cover reservations, pulls, returns, receipts, supplier payload, and receiving manifest. Remote D1 migration `0011` and Worker deployment completed; Cloudflare Pages verified production marker `1790271002029`. No browser or computer control was used for this release.

## Open Questions & Brainstorming

- When should other garment styles join the same physical inventory ledger?
- Should a future Shopify location mirror local stock without allowing online fulfillment to consume it?

## Technical Specification & Task Checklist

### Counts and order workflow

For each variant, Order Manager stores **on shelf** (physically present), **reserved** (physically present but assigned to an order), and **free to reserve** (`on shelf - reserved`). Staff enter an opening physical count after counting the shelf. Subsequent receipts add units, and count corrections require a reason. An audit trail records the actor and each count, receipt, reservation, pull, return, and release.

On a Shopify order's Production tab, staff reserve any part of a Tultex 202 line. Reserving reduces free units immediately and leaves the physical on-shelf count unchanged. When blanks are physically removed, staff mark them pulled; that action reduces on-shelf units and the number still reserved to pull. A physical return restores on-shelf units but leaves the order reservation in place until staff explicitly release it. Cancellation never returns or releases stock automatically. Duplicate mutations and concurrent operators use idempotency keys, versions, and D1 guards.

The Inventory tab shows the Tultex 202 catalog, counts by variant, and reservations waiting to be pulled. Uncounted variants cannot be reserved. Order Manager's S&S purchase payload and receiving manifest subtract the total quantity assigned to the shelf, whether still reserved or already pulled. Reservation changes stop when supplier purchasing starts or its result is uncertain. Pull and physical return remain separate shop actions.

### Separation from supplier and storefront inventory

Shop stock is independent from S&S warehouse availability and is never counted as supplier stock. This release makes no Shopify inventory, tracking, location, fulfillment routing, or storefront availability changes. The separate supplier inventory Worker remains disabled. The planned storefront stockout block should use only S&S warehouse stock and must exclude dropship stock.

### Release and operations

The installed Order Manager Shopify app needs `read_products` so the Worker can verify variant identity. The `SHELF_ALLOCATION_ENABLED` Worker flag gates this Tultex 202 feature. Apply D1 migration `0011_shelf_physical_reservations.sql` before deploying the Worker, then deploy the web client. Staff should enter real opening counts only after a physical count; absent rows remain uncounted. A full shelf assignment can proceed through the existing explicit ready action without an S&S PO.

### Future scope

- More in-house garments, transfers, damaged stock, and richer stock history views.
- Supplier warehouse observation and a storefront stockout gate for S&S inventory, excluding dropship inventory.
- A Shopify location mirror only if shop stock can remain unavailable to online checkout and fulfillment routing.

## Progress Log

- **2026-09-24**: Manual Tultex 202 claims, S&S payload deduction, and receiving deduction implemented. Staff approved the `read_products` app permission and confirmed the embedded controls appeared.
- **2026-09-24**: Physical on-shelf, reserved, and pulled states and the Inventory tab released. Physical opening counts remain the next step.
