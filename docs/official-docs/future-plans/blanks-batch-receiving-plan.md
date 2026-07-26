# Blanks Batch Receiving Workflow Plan

- **Status**: `[Draft / Idea]`
- **Owner / Target Milestone**: `v1.4 Backlog`

---

## Summary & Intent

Provide a receiving workflow for incoming blank-apparel shipments from S&S Activewear. Currently, orders transition directly from `Blanks Ordered` to `Ready to Print`. This feature introduces an intermediate receiving check where shop technicians can scan or check off delivered blanks, verify partial vs complete shipments, and flag damaged or missing items before advancing orders to production.

---

## Current Continuation State

- **Current state**: Draft requirements and the Shopify/D1 target boundary are recorded; no receiving implementation has shipped.
- **Next safe action**: Resolve the scan/manual and partial-shipment choices, then define D1 entities and canonical production-state effects.
- **Remaining blockers**: Receiving identity, partial quantity semantics, and relationship to in-house inventory.
- **Owner / external actions**: Choose the preferred shop-floor input method and partial-shipment presentation.
- **Last verified evidence**: Plan direction was aligned to the Shopify/D1 Worker boundary on 2026-07-23.

## Open Questions & Brainstorming

1. **Barcode / Packing Slip Scanning**: Should we support USB barcode scanner inputs for checking in S&S packing slips, or rely on manual click check-offs?
2. **Partial Shipment Handling**: If only 10 out of 12 blank shirts arrive in a shipment, should the order card split into partial status or remain in `Blanks Ordered` with a yellow badge?
3. **Inventory Tracking**: Do we track received blanks at the shop level or strictly tied to specific Shopify order IDs?

---

## Technical Specification & Task Checklist

### Phase 1: Data Model & Schema Extension
- [ ] Add normalized shipment and received-item tables in D1, linked to the canonical Shopify order GID and confirmed batch records.
- [ ] Add authenticated Worker endpoints with idempotency and audit events; clients must not write receiving state directly.

### Phase 2: UI UI Receiving Overlay
- [ ] Add receiving modal to `Blanks Ordered` column cards.
- [ ] Display checklist of expected SKUs vs received quantities.
- [ ] Add "Mark Fully Received" CTA button.

---

## Progress Log

- **2026-07-21**: Feature converted from legacy markdown plan into Stage 1 `[Draft / Idea]` in `future-plans/`.
- **2026-07-23**: Replaced the obsolete Redis queue/IPC direction with the Shopify/D1 Worker data plane required after Redis-free cutover.
