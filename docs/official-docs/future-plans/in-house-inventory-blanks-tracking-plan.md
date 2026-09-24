# In-House Blank Inventory Tracking & Digital Whiteboard Grid Plan

- **Status**: `[Implemented Candidate]`
- **Owner / Target Milestone**: `v1.5 Backlog`
- **Last Updated**: `2026-09-24`

---

## Summary & Intent

This specification outlines the architecture for **Live In-House Blank Inventory Tracking**, replacing the physical dry-erase whiteboard grid with a **Digital Inventory Grid UI** embedded in PrintMO Order Management.

### Operational Goal
Provide a fast digital representation of physical shop shelf inventory. The first implementation covers Tultex 202 only: staff enter physically counted free units in Order Manager and explicitly claim them for Shopify order lines. The separate S&S supplier inventory observation never includes these local counts. A broader inventory grid and Shopify-location synchronization remain future work.

---

## Current Continuation State

- **Current state**: The first Tultex 202 release uses D1 as the staff-only shelf count and claim authority. Exact Shopify product ID `gid://shopify/Product/8984050729208` was read live on 2026-09-24; sampled variants were untracked. Authenticated Worker endpoints and browser Order Detail controls are limited to this exact product. Claims are tied to Shopify order and line IDs, and S&S batch lines and receiving quantities subtract claims.
- **Next safe action**: Release Shopify app version `tultex-shelf-read-products-2026-09-24` and approve its added `read_products` permission on the installed Print-MO Order Manager app. Refresh the embedded app and verify order #1715 shows both Tultex 202 lines as uncounted. Then physically count free shelf units and enter those counts in Order Detail.
- **Remaining blockers**: The installed Order Manager app lacks `read_products`, so Shopify returns `null` for order-line variants and the Worker cannot verify exact Tultex 202 product identity. No verified physical shelf counts are available. The broader whiteboard grid, restock suggestions, other garments and Shopify-location synchronization remain out of this first release.
- **Owner / external actions**: Release the draft app version in Shopify Dev Dashboard, approve the new permission in the store, and enter actual free shelf counts after a physical count. No Shopify HQ balances should be used as a substitute.
- **Last verified evidence**: Focused shelf ledger, actual Worker S&S request, receiving-manifest, and phase-two tests passed locally on 2026-09-24. Production D1 migration `0010` applied with zero stock, claim, and event rows. Shopify order #1715 returned its Tultex SKUs but `null` variants to the installed Order Manager app; the live embedded UI now reports `SHELF_PRODUCT_ACCESS_REQUIRED` instead of silently hiding the shelf section. Shopify app config validated and draft version `tultex-shelf-read-products-2026-09-24` was created without release. Worker `d82e19cb-dbd3-49d1-8005-75ba6d4885f0` and Pages marker `1790267901886` serve the explicit error state. No Shopify inventory values, tracking flags, location settings or supplier sync Worker state changed.

## Open Questions & Brainstorming

1. If physical shelf stock is later mirrored into Shopify, how should that offline location be reconciled without making local rush stock available to online order routing?
2. How should corrections, returns, damaged stock, and abandoned production assignments reverse counts?
3. What concurrency rule prevents two operators from assigning the same final unit?
4. Should restock suggestions enter an existing batch draft or create a separate replenishment intent?

## Current Shop Workflow vs Longer-Term Target

| Aspect | Current Shop Workflow | Target PrintMO Feature |
|---|---|---|
| **Inventory Tracking** | Manual physical whiteboard grid with color/size columns. | Interactive Digital Whiteboard Grid UI with 1-click `+` / `-` adjustments. |
| **Backend Storage** | Physical dry-erase markers. | First release: audited Order Manager D1 shelf ledger. A later Shopify mirror is undecided. |
| **Core Stocked Items** | Tultex 202 (White, Black, Red, Slate Blue, Kelly Green in XS–3XL). | Pre-configured fast-entry matrix views for core shop blank lines. |
| **Claiming Mechanism** | Verbal / mental note. | **Manual "Assign from Shelf"** button on order cards / detail modal. |
| **Low-Stock Restocking** | Manual reminder to order more. | Visual low-stock alert cells + **"Restock to S&S Cart"** 1-click refill button. |
| **Extra / Leftover Blanks** | Random garments sitting around the shop floor. | "Unassigned / Overstock Bin" for miscellaneous non-core blanks. |

---

## Resolved Architectural Decisions

### 1. Storage Backend: Order Manager D1 for the first release
- **Authority**: D1 stores counted free shelf stock, per-order line claims, and an append-only audit trail. Claims decrement free stock when staff assign units; they can be released only by explicit staff action when the units are physically back on the shelf.
- **Isolation**: This first release does not write Shopify inventory or change tracking, HQ, fulfillment routing, or online availability. The S&S Supplier location and its read-only observation Worker remain separate.
- **Rollout**: `SHELF_ALLOCATION_ENABLED` gates the endpoints and controls and can be set to `0` to pause the feature. Exact Tultex 202 product identity is checked live by the Worker; no title-based matching is accepted. All variants remain uncounted until a staff member records a physical free count.

### 2. Allocation Strategy: Manual "Assign from Shelf" Workflow
- **No Automatic Blind Reservation**: Supplier stock is assumed to be ordered via S&S batches by default. In-house shelf stock is assigned **manually** by shop operators; partial claims leave the remainder for S&S.
- **Assignment Action**:
  - The first release shows Tultex 202 lines in Order Detail with free, claimed and supplier-needed quantities. A board-card shortcut is future work.
  - Saving a claim decrements free D1 shelf stock, leaves Shopify checkout untouched, and records order, line, actor, time and idempotency key.

### 3. Low-Stock Visual Alerts & One-Click S&S Batch Restock
- **Visual Threshold Highlights**:
  - Cell background turns **Yellow** when stock drops to 1 unit.
  - Cell background turns **Red** when stock drops to 0 units.
- **1-Click Refill to S&S Cart**:
  - Hovering or clicking a low/out cell presents a **"Restock to S&S Cart (+6 / +12)"** button.
  - Adds the refill quantity directly into PrintMO's active S&S batch queue so it gets ordered on the next S&S PO run.

---

## Technical Specification & Task Checklist — UI Architecture

### 1. Non-Clunky UI Layout (Digital Whiteboard View)
- Accessible via a fast dedicated top-bar tab or slide-out overlay drawer (**`[ Alt + I ]` shortcut**).
- **Core Matrix Grid View**:
  - Rows: Colors (White, Black, Red, Slate Blue, Kelly Green).
  - Columns: Sizes (XS, S, M, L, XL, 2XL, 3XL).
  - Cells: Large, readable stock count numbers with micro `+` and `-` buttons for instant manual adjustments.
- **Overstock / Miscellaneous Tab**:
  - Searchable list view for random non-core blanks tagged by brand, SKU, color, and shelf location bin.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ TULTEX 202 IN-HOUSE STOCK GRID (Shopify Location: Floor Shelf)        [ + Add Item ]   │
├─────────────────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬─────────────────────┤
│ COLOR           │ XS   │ S    │ M    │ L    │ XL   │ 2XL  │ 3XL  │ TOTAL IN STOCK      │
├─────────────────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┼─────────────────────┤
│ White           │ [-1+]│ [-3+]│ [-5+]│ [-4+]│ [-2+]│ [-1+]│ [-1+]│ 17                  │
│ Black           │ [-2+]│ [-4+]│ [-6+]│ [-5+]│ [-3+]│ [-2+]│ [-1+]│ 23                  │
│ Red (LOW) ⚠️    │ [-1+]│ [-0+]│ [-1+]│ [-0+]│ [-1+]│ [-1+]│ [-0+]│ 4  [+ Restock S&S]  │
│ Slate Blue      │ [-0+]│ [-1+]│ [-3+]│ [-2+]│ [-1+]│ [-0+]│ [-0+]│ 7                   │
│ Kelly Green     │ [-1+]│ [-1+]│ [-2+]│ [-2+]│ [-1+]│ [-1+]│ [-0+]│ 8                   │
└─────────────────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┴─────────────────────┘
```

### 2. Order Card & S&S Batch Integration
- **Manual Assignment Pill**:
  - Renders 🟢 `Shelf Stock Available (Manual Claim)` on Kanban cards when matching SKUs are found at the `"Print Shop Floor Shelf"` Shopify Location.
- **S&S Batch Deduction**:
  - When batching orders for S&S Activewear purchasing, assigned shelf units are excluded from both the supplier PO payload and the receiving manifest. Claims lock when supplier submission starts or its result is uncertain.
- **Batch Receiving Restock Integration**:
  - Extra or unused garments from received S&S shipments can be credited directly to the `"Print Shop Floor Shelf"` location in Shopify with a single click.

---

## Implementation Roadmap & Task Checklist

### Future Phase: Shopify Location & Inventory GraphQL Setup
- [ ] Configure Shopify Location ID (`"Print Shop Floor Shelf"`) in Cloudflare Worker environment bindings.
- [ ] Implement GraphQL mutations for `inventorySetQuantities` / `inventoryAdjustQuantities`.

### Phase 2: Digital Whiteboard Grid UI
- [ ] Build responsive Color-by-Size Matrix Component in renderer script.
- [ ] Implement instant click `+`/`-` counter controls updating Shopify inventory levels via proxy.
- [ ] Implement low-stock visual highlighting (Yellow @ 1, Red @ 0).
- [ ] Add **"Restock to S&S Cart"** 1-click action on matrix cells.

### Phase 3: Manual Assignment & Order Flow
- [ ] Add **"Assign from Shelf"** button to order detail modals and Kanban card overlays.
- [ ] Update `process-batch` to exclude manually claimed shelf garments from S&S purchase orders.

---

## Progress Log

- **2026-09-24**: Implemented a feature-flagged Tultex 202 D1 shelf-count and manual-claim candidate. Supplier batch and receiving quantities subtract claims; Shopify inventory remains untouched. Physical counts and staff acceptance are required before enabling it.
- **2026-07-22**: Initial draft created.
- **2026-07-22**: Updated to `[Spec Ready]`. Resolved architectural decisions: Shopify Multi-Location API for storage, manual order assignment workflow, low-stock highlights, and 1-click S&S batch restock buttons.
