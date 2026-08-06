# Blanks Batch Receiving Workflow Plan

- **Status**: `[Implemented Candidate]`
- **Owner / Target Milestone**: `v1.4 Backlog`

---

## Summary & Intent

Provide a receiving workflow for incoming blank-apparel shipments from S&S Activewear. Currently, orders transition directly from `Blanks Ordered` to `Ready to Print`. This feature introduces an intermediate receiving check where shop technicians can scan or check off delivered blanks, verify partial vs complete shipments, and flag damaged or missing items before advancing orders to production.

---

## Current Continuation State

- **Current state**: A production candidate supports authenticated R2 receiving manifests, aggregate expected/received quantities, inline order-detail edits, full-batch receiving, stable Shopify GID membership, and explicit add/transfer correction with one active batch per order.
- **Next safe action**: Complete owner acceptance of inline edits and add/transfer behavior, then design the normalized D1 migration for audit history, scanning, damage, and partial-shipment events.
- **Remaining blockers**: Normalized D1 receiving entities, idempotent/audited quantity mutations, barcode input, damage handling, and relationship to in-house inventory.
- **Owner / external actions**: Choose the preferred shop-floor input method and partial-shipment presentation.
- **Last verified evidence**: Phase 2 Worker/client contracts covered quantity validation, inline controls, dialog stacking, unique membership, and transfer behavior on 2026-08-06; owner browser acceptance remains manual.

## Open Questions & Brainstorming

1. **Barcode / Packing Slip Scanning**: Should we support USB barcode scanner inputs for checking in S&S packing slips, or rely on manual click check-offs?
2. **Partial Shipment Handling**: If only 10 out of 12 blank shirts arrive in a shipment, should the order card split into partial status or remain in `Blanks Ordered` with a yellow badge?
3. **Inventory Tracking**: Do we track received blanks at the shop level or strictly tied to specific Shopify order IDs?

---

## Technical Specification & Task Checklist

### Phase 1: Data Model & Schema Extension
- [ ] Add normalized shipment and received-item tables in D1, linked to the canonical Shopify order GID and confirmed batch records.
- [ ] Add authenticated Worker endpoints with idempotency and audit events; clients must not write receiving state directly.

### Phase 2: UI Receiving Foundation
- [x] Add authenticated receiving modal for ordered blanks batches.
- [x] Display expected, received, accounted, and missing SKU quantities.
- [x] Add "Mark All Received" action.
- [x] Add inline order-detail quantity controls without stacking the full modal.
- [x] Add explicit order selection and cross-batch transfer correction.

---

## Progress Log

- **2026-07-21**: Feature converted from legacy markdown plan into Stage 1 `[Draft / Idea]` in `future-plans/`.
- **2026-07-23**: Replaced the obsolete Redis queue/IPC direction with the Shopify/D1 Worker data plane required after Redis-free cutover.
- **2026-08-06**: Promoted the shipped receiving foundation to `[Implemented Candidate]`; added stable order identity, unique active membership, received-quantity-preserving transfer, inline detail edits, and accessible modal stacking. Normalized D1 receiving history remains follow-up work.
