# Blanks Batch Receiving Workflow Plan

- **Status**: `[Draft / Idea]`
- **Owner / Target Milestone**: `v1.4 Backlog`

---

## Summary & Intent

Provide a receiving workflow for incoming blank-apparel shipments from S&S Activewear. Currently, orders transition directly from `Blanks Ordered` to `Ready to Print`. This feature introduces an intermediate receiving check where shop technicians can scan or check off delivered blanks, verify partial vs complete shipments, and flag damaged or missing items before advancing orders to production.

---

## Open Questions & Brainstorming

1. **Barcode / Packing Slip Scanning**: Should we support USB barcode scanner inputs for checking in S&S packing slips, or rely on manual click check-offs?
2. **Partial Shipment Handling**: If only 10 out of 12 blank shirts arrive in a shipment, should the order card split into partial status or remain in `Blanks Ordered` with a yellow badge?
3. **Inventory Tracking**: Do we track received blanks at the shop level or strictly tied to specific Shopify order IDs?

---

## Technical Specification & Task Checklist

### Phase 1: Data Model & Schema Extension
- [ ] Add `received_items` array to order object structure in Redis queue.
- [ ] Define new IPC channels (`update-receiving-status`, `record-shipment-checkin`).

### Phase 2: UI UI Receiving Overlay
- [ ] Add receiving modal to `Blanks Ordered` column cards.
- [ ] Display checklist of expected SKUs vs received quantities.
- [ ] Add "Mark Fully Received" CTA button.

---

## Progress Log

- **2026-07-21**: Feature converted from legacy markdown plan into Stage 1 `[Draft / Idea]` in `future-plans/`.
