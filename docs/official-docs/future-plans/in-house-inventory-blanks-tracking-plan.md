# In-House Blank Inventory Tracking & Digital Whiteboard Grid Plan

- **Status**: `[Spec Ready]`
- **Owner / Target Milestone**: `v1.5 Backlog`
- **Last Updated**: `2026-07-22`

---

## Summary & Intent

This specification outlines the architecture for **Live In-House Blank Inventory Tracking**, replacing the physical dry-erase whiteboard grid with a **Digital Inventory Grid UI** embedded in PrintMO Order Management.

### Operational Goal
Provide a fast, non-clunky digital representation of physical shop shelf inventory (focusing on core stock like Tultex 202 color/size matrices and miscellaneous overstock). In-house stock counts are synchronized with Shopify's Multi-Location Inventory API, allowing manual assignment of shelf blanks to incoming orders, low-stock visual alerts, and one-click shelf restocking via S&S Activewear batch ordering.

---

## Current Continuation State

- **Current state**: The UI concept and manual assignment direction are spec-ready; Shopify inventory semantics and production-allocation contracts still require implementation-level verification.
- **Next safe action**: Verify Shopify location/inventory mutation contracts and define an idempotent allocation ledger linking shelf adjustments to canonical order GIDs.
- **Remaining blockers**: Inventory authority, adjustment reasons/audit, concurrent allocation, returns/corrections, and supplier-restock integration.
- **Owner / external actions**: Confirm the physical shelf location model, initial stocked catalog, reorder thresholds, and who may adjust counts.
- **Last verified evidence**: No inventory implementation exists; this remains a spec targeting Shopify plus Worker-mediated operations.

## Open Questions & Brainstorming

1. Is Shopify inventory alone sufficient for allocation history, or is a D1 app-only allocation ledger required?
2. How should corrections, returns, damaged stock, and abandoned production assignments reverse counts?
3. What concurrency rule prevents two operators from assigning the same final unit?
4. Should restock suggestions enter an existing batch draft or create a separate replenishment intent?

## Current Shop Workflow vs Target Solution

| Aspect | Current Shop Workflow | Target PrintMO Feature |
|---|---|---|
| **Inventory Tracking** | Manual physical whiteboard grid with color/size columns. | Interactive Digital Whiteboard Grid UI with 1-click `+` / `-` adjustments. |
| **Backend Storage** | Physical dry-erase markers. | **Shopify Multi-Location API** (`"Print Shop Floor Shelf"` location ID). |
| **Core Stocked Items** | Tultex 202 (White, Black, Red, Slate Blue, Kelly Green in XS–3XL). | Pre-configured fast-entry matrix views for core shop blank lines. |
| **Claiming Mechanism** | Verbal / mental note. | **Manual "Assign from Shelf"** button on order cards / detail modal. |
| **Low-Stock Restocking** | Manual reminder to order more. | Visual low-stock alert cells + **"Restock to S&S Cart"** 1-click refill button. |
| **Extra / Leftover Blanks** | Random garments sitting around the shop floor. | "Unassigned / Overstock Bin" for miscellaneous non-core blanks. |

---

## Resolved Architectural Decisions

### 1. Storage Backend: Shopify Multi-Location Inventory API
- **Location Separation**: Rather than storing inventory only in isolated Redis keys, all counts sync directly to Shopify using **Shopify Locations**.
  - Location A: `"Print Shop Floor Shelf"` (Your in-house physical blanks).
  - Location B (Future): `"S&S Distributor Sync"` (Synced live supplier stock).
  - Location C (Future): `"SanMar Distributor Sync"` (Synced live supplier stock).
- **Single Source of Truth**: PrintMO queries Shopify's `inventoryLevels` via GraphQL API, keeping e-commerce and shop-floor inventory perfectly unified in Shopify.

### 2. Allocation Strategy: Manual "Assign from Shelf" Workflow
- **No Automatic Blind Reservation**: Supplier stock is assumed to be ordered via S&S batches by default. In-house shelf stock is assigned **manually** by shop operators.
- **Assignment Action**:
  - Opening an order card displays an **"Assign from Shelf"** action if in-house stock exists for those SKUs.
  - Clicking "Assign" decrements the `"Print Shop Floor Shelf"` quantity in Shopify and tags the order card with a 🟢 **"Assigned from Shelf"** status pill.

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
  - When batching orders for S&S Activewear purchasing, assigned shelf items are automatically excluded from the supplier PO payload.
- **Batch Receiving Restock Integration**:
  - Extra or unused garments from received S&S shipments can be credited directly to the `"Print Shop Floor Shelf"` location in Shopify with a single click.

---

## Implementation Roadmap & Task Checklist

### Phase 1: Shopify Location & Inventory GraphQL Setup
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

- **2026-07-22**: Initial draft created.
- **2026-07-22**: Updated to `[Spec Ready]`. Resolved architectural decisions: Shopify Multi-Location API for storage, manual order assignment workflow, low-stock highlights, and 1-click S&S batch restock buttons.
