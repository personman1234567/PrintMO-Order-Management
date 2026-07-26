# Multi-Supplier Routing & Threshold-Optimized Batching Plan

- **Status**: `[Draft / Idea]`
- **Owner / Target Milestone**: `v1.4 Backlog`

---

## Summary & Intent

With S&S Activewear sunsetting Bella+Canvas (B+C) products from their catalog, PrintMO must integrate a secondary blank apparel supplier (**SanMar**) to fulfill Bella+Canvas orders. However, managing two suppliers introduces logistical and financial challenges—specifically regarding freight costs.

S&S Activewear offers free shipping on orders over **$200** (and SanMar enforces similar threshold policies). If blank orders are naively split across suppliers by item brand, shop orders risk falling below the $200 threshold on both suppliers (e.g. $160 S&S + $90 SanMar), incurring unnecessary duplicate shipping charges ($30–$50 per batch).

This architectural proposal designs a **Multi-Supplier Routing & Threshold-Optimized Batching Engine** for PrintMO Order Manager. It will:
1. Automatically map SKUs to their appropriate supplier (routing Bella+Canvas to SanMar, others to S&S by default).
2. Calculate live cart subtotal progress against the $200 free shipping threshold for each supplier.
3. Provide smart cross-supplier re-routing recommendations for dual-sourced items (e.g., shifting Gildan items to SanMar if it helps cross a free shipping threshold).
4. Integrate automated shipment tracking APIs (S&S REST + SanMar PromoStandards OSN) to automatically flag incoming blank orders as `Blanks Arrived` when delivered to the shop.

---

## Current Continuation State

- **Current state**: Operational choices are drafted, but supplier capabilities, commercial thresholds, and protocol contracts are not yet verified for implementation.
- **Next safe action**: Verify current SanMar/PromoStandards and S&S capabilities, credential requirements, pricing rules, and idempotency behavior using primary vendor documentation.
- **Remaining blockers**: Supplier agreements, live API access, threshold policy, SKU crosswalk ownership, shipment identity, and receiving-state design.
- **Owner / external actions**: Confirm supplier accounts, operational threshold policy, and acceptable top-off inventory behavior.
- **Last verified evidence**: No executable multi-supplier implementation exists; this remains a proposal.

## Open Questions & Brainstorming

1. Which supplier API contracts and account capabilities are actually available to the installed accounts?
2. Where should the SKU crosswalk and dual-source confidence live so it remains auditable and versioned?
3. How should an ambiguous PO result be reconciled independently for each supplier?
4. Should delivery tracking update shipment records only, leaving physical receiving as an explicit operator action?

## Resolved Architectural Decisions

Following interactive design alignment, the following 4 core design decisions have been locked:

### 1. Partial Shipment Board Representation (Chokepoint 1)
- **Decision**: When an order contains items from both S&S and SanMar and only one shipment arrives, the order card **remains in the `Blanks Ordered` column** with a yellow partial arrival badge (e.g., `5/7 Blanks Received (SanMar Pending)`).
- **Auto-Advance Trigger**: The card automatically advances to `Ready to Print` ONLY when 100% of items across all suppliers have arrived at the shop.

### 2. Receiving Verification Workflow (Chokepoint 1)
- **Decision**: **Hybrid Verification Pipeline**. Carrier delivery tracking APIs (UPS/FedEx via S&S REST & SanMar OSN) automatically mark incoming packages as `Delivered`.
- **Shop Floor Control**: The Order Detail modal renders a supplier-grouped item checklist (`S&S Items` vs `SanMar Items`) allowing shop technicians to manually inspect, adjust, or check off physical item counts.

### 3. Smart Threshold Re-balancing Engine (Chokepoint 2)
- **Decision**: **Smart Suggestion Mode**. The optimizer detects dual-sourced items (e.g., Gildan 5000 carried by both S&S and SanMar) and auto-calculates an optimal allocation to cross the $200 threshold on S&S/SanMar.
- **UI Trigger**: Displays a 1-click `Optimize Carts ($15+ Saved)` CTA button in the Batching Drawer prior to PO submission.

### 4. Unfillable Threshold Gap Resolution (Chokepoint 2)
- **Decision**: **Top-Off Stock Prompt**. When a supplier cart sits just below $200 (e.g., $175 on S&S) and no dual-sourced items remain to shift over, the drawer renders a `Top Off Cart ($25 to Free Shipping)` prompt.
- **Stock Options**: Suggests adding popular shop stock blanks (e.g., Gildan 5000 L-Black / L-White) or pulling future queued customer orders into the current batch to unlock free shipping.

---

## Technical Specification & Task Checklist

### Phase 1: Supplier Catalog Mapping & Protocol Adapters
- [ ] Create `supplier-catalog.js` mapping rules (Bella+Canvas $\rightarrow$ SanMar; Gildan/Next Level/Anvil $\rightarrow$ S&S by default, with dual-source flags).
- [ ] Implement `SanMarSupplierAdapter` using PromoStandards / Web Services for pricing, inventory, and PO submission.
- [ ] Extend the Worker/D1 batch state machine and stateless supplier-gateway interface into a modular multi-supplier pipeline; do not add supplier credentials or direct supplier calls to Electron.

### Phase 2: Threshold Optimization & UI Batching Drawer
- [ ] Build "Free Shipping Threshold Meters" ($200 progress bar per supplier) inside the Batch Order Modal.
- [ ] Implement cart re-balancing algorithm to optimize dual-sourced items across suppliers to maximize free shipping qualifications with `Optimize Carts` CTA.
- [ ] Implement `Top Off Cart` inventory suggestion box for sub-$200 carts.
- [ ] Add dual-tab UI in Order Manager for viewing and submitting `S&S Batch PO` and `SanMar Batch PO`.

### Phase 3: Automated Garment Delivery Tracking & Partial Badging
- [ ] Build bounded Worker-side shipment reconciliation using verified S&S and SanMar contracts; clients remain credential-free.
- [ ] Add partial arrival yellow badge (`5/7 Blanks Received`) to `.pipeline-card` renderer.
- [ ] Implement supplier-grouped receiving checklist in Order Detail overlay.
- [ ] Add auto-transition trigger: advance order cards from `Blanks Ordered` to `Ready to Print` when all supplier shipments reach 100% completion.

---

## Progress Log

- **2026-07-21**: Proposal expanded into Stage 1 locked spec with interactive design decisions finalized for partial shipments and threshold optimization in `future-plans/`.
