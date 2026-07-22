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

## Open Questions & Brainstorming

1. **Dual-Sourced Item Re-balancing Rules**: Should the optimizer automatically reassign dual-sourced SKUs (like Gildan or Anvil) between S&S and SanMar to achieve free shipping on both orders, or present suggested allocations for manual one-click approval?
2. **Minimum Batch Threshold Alerts**: If a supplier batch sits at $180 (just $20 short of free shipping), should the UI display a "Suggested Additions" prompt (e.g., pulling future queued orders or popular stock blanks to hit $200)?
3. **Supplier API Adapter Abstraction**: How should we structure the main process IPC handlers so `process-batch` delegates cleanly to `SSSupplierAdapter` or `SanMarSupplierAdapter` without duplicating queue mutation logic?
4. **Partial Shipment Tracking UI**: When an order contains line items from both S&S and SanMar, how should card badges display partial blank arrivals (e.g. `S&S Arrived (2/3) - SanMar In Transit (1/3)`)?

---

## Technical Specification & Task Checklist

### Phase 1: Supplier Catalog Mapping & Protocol Adapters
- [ ] Create `supplier-catalog.js` mapping rules (Bella+Canvas $\rightarrow$ SanMar; Gildan/Next Level/Anvil $\rightarrow$ S&S by default, with dual-source flags).
- [ ] Implement `SanMarSupplierAdapter` using PromoStandards / Web Services for pricing, inventory, and PO submission.
- [ ] Refactor `main.js:process-batch` into a modular multi-supplier batching pipeline.

### Phase 2: Threshold Optimization & UI Batching Drawer
- [ ] Build "Free Shipping Threshold Meters" ($200 progress bar per supplier) inside the Batch Order Modal.
- [ ] Implement cart re-balancing algorithm to optimize dual-sourced items across suppliers to maximize free shipping qualifications.
- [ ] Add dual-tab UI in Order Manager for viewing and submitting `S&S Batch PO` and `SanMar Batch PO`.

### Phase 3: Automated Garment Delivery Tracking
- [ ] Build background shipment status poller in proxy/main process using S&S Order Tracking API and SanMar OSN API.
- [ ] Add auto-transition trigger: advance order cards from `Blanks Ordered` to `Blanks Arrived` / `Ready to Print` when carrier delivery is confirmed.

---

## Progress Log

- **2026-07-21**: Proposal drafted as Stage 1 `[Draft / Idea]` feature plan in `future-plans/`.
