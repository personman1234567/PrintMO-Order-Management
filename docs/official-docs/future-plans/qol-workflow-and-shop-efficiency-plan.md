# Quality of Life (QoL) & Print Shop Workflow Efficiency Plan

- **Status**: `[Draft / Idea]`
- **Owner / Target Milestone**: `v1.5 Backlog`

---

## Summary & Intent

Operating a custom apparel print shop requires balancing customer communication, quote creation, inventory threshold optimization, artwork verification, tight event deadlines, and post-fulfillment re-ordering. Small friction points in daily operations compound into lost time, missed deadlines, and unnecessary shipping expenses.

This architectural proposal establishes a master **Quality of Life (QoL) & Print Shop Workflow Efficiency Suite** built directly into PrintMO Order Manager. It targets 8 core operational gaps to streamline shop management, reduce manual clicks, automate routine customer updates, and eliminate shipping fee penalties.

---

## Current Continuation State

- **Current state**: Eight opportunities are collected in one draft; they are not one implementation unit and none should be inferred as shipped.
- **Next safe action**: Split the highest-value independent capability into its own spec after scoring operational value, dependencies, permission impact, and verification cost.
- **Remaining blockers**: Priority, ownership, Shopify permission needs, notification policy, and overlap with draft-order/multi-supplier plans.
- **Owner / external actions**: Rank the eight opportunities and choose the first standalone delivery unit.
- **Last verified evidence**: This remains a planning collection; current behavior is defined only in current-state docs.

## Open Questions & Brainstorming

1. Which single capability removes the most weekly operator time without introducing new external permissions?
2. Which items belong in the draft-order, multi-supplier, receiving, or filtering plans instead of this umbrella?
3. Which customer communications require explicit templates, approval, audit, and opt-out behavior?

## Master Quality-of-Life (QoL) Feature Specifications

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PRINTMO WORKFLOW EFFICIENCY ENGINE                     │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. NON-BLOCKING ART PROOF ACCEPTANCE                                        │
│    • Optional proof badge + lightbox preview. Embedded in draft invoices    │
│      so customer payment acts as artwork approval (never blocks Kanban).    │
│                                                                             │
│ 2. TARGET DUE DATES & URGENCY SCHEDULING                                    │
│    • Optional "Event/Due Date" picker with visual badges:                   │
│      🔴 "Due Tomorrow"  |  🟡 "Due in 3 Days"  |  Column sorting by deadline.│
│                                                                             │
│ 3. 1-CLICK "NOTIFY CUSTOMER" DISPATCH                                       │
│    • 1-click button sending pre-formatted status updates via Shopify API:   │
│      "Good news! Your blanks have arrived and production is starting."      │
│                                                                             │
│ 4. "FULFILL & ARCHIVE" + SEARCHABLE COMPLETED HISTORY                       │
│    • Dragging to "Fulfill & Archive" dispatches Shopify tracking emails and │
│      moves cards into a searchable History view for 1-click re-orders.      │
│                                                                             │
│ 5. GARMENT SIZE MATRIX QUICK-GRID (Draft Builder)                           │
│    • Single size entry grid: `[ S: 5 ] [ M: 15 ] [ L: 20 ] [ XL: 10 ]`       │
│      Generates all size variant line items in 1 click instead of 5 searches.│
│                                                                             │
│ 6. THRESHOLD RE-BALANCING & TOP-OFF STOCK PROMPTS                           │
│    • 1-click cart optimizer for S&S/SanMar dual-sourced items + top-off     │
│      prompts for popular shop stock (Gildan 5000 L-Black/Wht) to hit $200. │
│                                                                             │
│ 7. B2B TAX EXEMPTION TOGGLE                                                 │
│    • 1-click `Tax Exempt` toggle saving reseller IDs for schools/wholesalers.│
│                                                                             │
│ 8. QUOTE EXPIRATION & OVERDUE REMINDERS                                     │
│    • Timer badges (`Valid for 7 Days`), overdue alerts (`Overdue: 5d`), and │
│      1-click `Send Payment Reminder` CTA buttons.                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1. Non-Blocking Artwork Proofing & Customer Acceptance
- **Intent**: Track customer artwork approvals without blocking production workflow.
- **Workflow**:
  - Adds an optional `Proof Status` selector (`Proof Pending`, `Proof Approved`, `Revision Needed`) and a proof image lightbox viewer to the Order Detail modal.
  - Proof links are embedded directly into draft email invoices. Customer invoice payment automatically logs legal artwork acceptance (`tags: ["Art_Approved"]`).
  - **Non-Blocking Rule**: Proof status is strictly informational and **never blocks** moving order cards across Kanban columns.

### 2. Target Due Dates & Urgency Scheduling
- **Intent**: Highlight rush orders and hard event deadlines (5K runs, corporate events, tournaments).
- **Workflow**:
  - Adds an optional `Target Due Date / Event Date` calendar picker to order cards.
  - Automatically calculates elapsed time to due date and renders visual urgency badges on collapsed card headers:
    - 🔴 **Red Badge**: `Due in 24h` / `Overdue`
    - 🟡 **Yellow Badge**: `Due in 3 Days`
  - Adds a column sorting toggle: `Sort by Urgency (Nearest Due Date First)`.

### 3. 1-Click "Notify Customer" Status Update Dispatch
- **Intent**: Eliminate customer phone calls/emails asking "What's the status of my order?".
- **Workflow**:
  - Adds a 1-click `Notify Customer` button in the Order Detail modal.
  - Dispatches pre-formatted, branded status email notifications via Shopify API based on the order's current column status (e.g. *"Good news! Your blank apparel has arrived at our shop and printing is starting!"*).

### 4. "Fulfill & Archive" Column with Searchable Completed Order History
- **Intent**: Keep active Kanban columns clean while preserving completed order data for fast client re-orders.
- **Workflow**:
  - Adds a dedicated `Fulfill & Archive` dropzone column.
  - Dragging a card to `Fulfill & Archive` triggers official Shopify fulfillment API calls (`fulfillmentCreate`) and dispatches carrier tracking numbers to the customer.
  - Dequeues completed cards from the active board and archives them into a searchable `Completed History` view with a 1-click `Re-Order / Duplicate Quote` CTA.

### 5. Garment Size Matrix Quick-Grid (Draft Builder)
- **Intent**: Replace tedious line-by-line size searching with a print-shop tailored size matrix.
- **Workflow**:
  - When picking a garment style/color (e.g. `Gildan 5000 - Navy`), the Draft Order builder displays a single horizontal size entry grid: `[ S: 5 ] [ M: 15 ] [ L: 20 ] [ XL: 10 ] [ 2XL: 0 ]`.
  - Automatically generates all size variant line items in a single click.

### 6. Threshold Re-balancing & Top-Off Stock Prompts
- **Intent**: Protect shop margins by preventing unnecessary $15–$25 freight fees when batches fall just short of supplier $200 free shipping minimums.
- **Workflow**:
  - **Smart Re-balancer**: Detects dual-sourced items (Gildan 5000) and displays a 1-click `Optimize Carts ($15+ Saved)` CTA button.
  - **Top-Off Prompt**: When a supplier cart sits at $175, renders a `Top Off Cart ($25 to Free Shipping)` prompt suggesting popular shop stock blanks (e.g., Gildan 5000 L-Black/Wht) or pulling future queued orders.

### 7. B2B Tax Exemption & Reseller Certificate Toggle
- **Intent**: Eliminate accidental sales tax charges for non-profits, schools, churches, and wholesale clients.
- **Workflow**:
  - Adds a 1-click `Tax Exempt` toggle on draft orders (`taxExempt: true`).
  - Stores reseller certificate IDs in Shopify custom attributes/metafields.

### 8. Quote Expiration & Overdue Payment Reminders
- **Intent**: Protect shop margins against blank apparel price increases and automate unpaid quote follow-ups.
- **Workflow**:
  - Renders quote expiration timers (`Quote Valid for 7 Days`). If paid past expiration, alerts shop techs to re-verify blank apparel prices/stock with S&S/SanMar.
  - Displays red overdue badges for unpaid quotes (`Overdue: 5d`) with a 1-click `Send Payment Reminder` CTA.

---

## Technical Specification & Task Checklist

### Phase 1: Order Metadata Extensions & Urgency Engine
- [ ] Add `due_date`, `proof_status`, `proof_url`, and `tax_exempt_id` to order metadata schema.
- [ ] Implement urgency calculator: compare `due_date` against current time and render 🔴/🟡 badges on `.pipeline-card` headers.
- [ ] Add column sorting function: `sortCardsByDueDate()`.

### Phase 2: Customer Communication & Fulfillment Pipeline
- [ ] Implement `Notify Customer` API dispatcher in proxy/main using Shopify Admin API email notifications.
- [ ] Build `Fulfill & Archive` dropzone handler invoking Shopify `fulfillmentCreate` mutation.
- [ ] Create `Completed History` view tab with customer/order name search and 1-click `Re-Order` CTA.

### Phase 3: Size Matrix Quick-Grid & Threshold Optimizer UI
- [ ] Build horizontal Garment Size Matrix component (`[S][M][L][XL][2XL]`) in Draft Order Builder.
- [ ] Integrate Cart Re-balancing algorithm with 1-click `Optimize Carts` CTA.
- [ ] Implement `Top Off Cart` inventory suggestion drawer for sub-$200 carts.

### Phase 4: Proofing & Quote Expiration Mechanics
- [ ] Add Non-Blocking Art Proof status badge and lightbox preview component to Order Details.
- [ ] Implement quote expiration timer calculations and 1-click `Send Payment Reminder` action.

---

## Progress Log

- **2026-07-21**: Proposal created as Stage 1 `[Draft / Idea]` feature plan in `future-plans/` covering 8 major Quality-of-Life (QoL) print shop efficiency features.
