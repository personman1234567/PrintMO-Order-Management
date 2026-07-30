# Supplies Column and Dashboard Layout Redesign Plan

- **Status**: `[In Progress]`
- **Owner / Target Milestone**: `v1.5 Backlog`

---

## Summary & Intent

Reorganize the main desktop dashboard layout to streamline blank apparel purchasing and maximize production visibility. 

Currently, the **Blanks** section (with `In S&S Cart` and `Ordered` tabs) sits at the top of the **Production & Fulfillment** panel (Panel 3), sharing vertical space with **Ready to Print**. Meanwhile, the middle column (Panel 2) is dedicated solely to the **Create Blanks Order** staging area where cards are dragged to aggregate supplier orders.

This plan proposes:
1. **Unifying Blanks into Panel 2 ("Supplies")**: Move the Blanks section into the middle column and rename Panel 2 to **Supplies**.
2. **Tabbed Middle Column**: Combine the staging zone and blank order tracking into a 3-tab layout:
   - **Build Order** (left tab): The drag-and-drop staging interface for creating supplier orders.
   - **In S&S Cart** (center tab / default view on load): Staged items in the supplier cart ready for submission.
   - **Ordered** (right tab): Pending and completed blank apparel purchases.
3. **Full-Height Ready to Print Panel**: Unnest **Ready to Print** so it takes up the entire **Production & Fulfillment** panel (Panel 3) with a full vertical two-column grid.
4. **Ready to Print Sorting & Filters**: Add sorting and filter toolbar controls at the top of Ready to Print (similar to the Order Pipeline panel) to allow operators to reorder jobs by age, item count, or print count.
5. **Mobile Viewport Adaptation**: Update mobile navigation (`#mobile-tab-bar`) to feature `Pipeline`, `Supplies` (with internal tab switching), and `Ready to Print`.

---

## Current Continuation State

- **Current state**: Shopify desktop now uses a tabbed Supplies workspace in the existing middle panel. Exactly one body is visible at a time: `Build Order`, `In S&S Cart` (the default), or `Ordered`. `Build Order` is activated after a short hover when a Pipeline card is dragged over the panel. A confirmed supplier submission immediately clears Build Order and opens In S&S Cart. Desktop Shopify work queues retain a non-overlapping two-column card grid even when a queue has one card, and all production columns show the same available garment mockup preview. Ready to Print receives the full right panel height and separates canonical `print` and `completed` orders into To Print and Printed tabs across desktop and mobile. Shopify is the initial board; Legacy Redis remains unchanged.
- **Next safe action**: Perform Shopify acceptance for the new Ready to Print tabs and card anatomy, then decide whether to redesign the mobile Supplies navigation and add the Ready to Print sort/filter toolbar.
- **Remaining blockers**: Mobile tab-bar route mapping and the operator-facing sorting/filter vocabulary are still unimplemented.
- **Owner / external actions**: Confirm the desktop interaction is accepted before widening the change to mobile.
- **Last verified evidence**: Candidate-only desktop relocation is implemented by `order-manager-web/blanks-batches.js → syncSuppliesLayout` with desktop styling in `order-manager-web/desktop.css`.

---

## Open Questions & Brainstorming

1. **Tab Naming for Create Blanks Order**: Should the tab be named `Build Order`, `Create Order`, or `Draft Order`? `Build Order` keeps tab headers concise on smaller screens.
2. **Drag-and-Drop Target Behavior**: If an operator drags a card from Pipeline while the `In S&S Cart` tab is visible, should hovering over Panel 2 automatically switch to the `Build Order` tab, or should the entire panel act as a drop zone?
3. **Ready to Print Filter Options**: What sorting presets provide the most value for shop operators? (e.g., Oldest First, Newest First, Highest Garment Count, Highest Print Count, Customer Search).

---

## Technical Specification & Task Checklist

### Phase 1: HTML Structure & Container Refactoring (`index.html`)
- [x] Add the candidate-only top tab header inside Panel 2: `[ Build Order | In S&S Cart | Ordered ]`.
- [x] Relocate `#blanks-section` into Panel 2 at runtime for Shopify desktop, preserving the original Legacy Redis DOM placement.
- [x] Give Panel 3 (`.panel.fulfillment`) the full-height Ready to Print view in Shopify desktop.
- [x] Enforce one visible Supplies tab body and a fixed two-column card grid across Shopify desktop queues.
- [ ] Add sorting/filter toolbar element above the Ready to Print card grid in Panel 3.

### Phase 2: Supplies View State (`order-manager-web/blanks-batches.js`)
- [x] Set `In S&S Cart` as the default Shopify desktop Supplies view.
- [x] Add accessible tab switching for Panel 2 (`Build Order`, `In S&S Cart`, `Ordered`) without changing production state semantics.
- [x] Activate `Build Order` after a short hover over Supplies while a Pipeline card is dragged, preserving `#col-toOrder` as the drop target.
- [ ] Implement client-side sorting and filter algorithms for Ready to Print cards.

### Phase 3: CSS & Mobile Viewport Adaptation (`desktop.css`, `mobile.css`, `web-shim.js`)
- [x] Adjust Shopify desktop CSS to provide full-height flex scrolling for Panel 3 (`Ready to Print`).
- [ ] Update `#mobile-tab-bar` layout: collapse `Blanks Cart` and `Blanks Ordered` into a single `Supplies` mobile tab with sub-tab controls, alongside `Pipeline` and `Ready to Print`.
- [ ] Ensure mobile scroll containment and modal overlays operate smoothly across all screen sizes.

### Phase 4: Documentation & Verification
- [ ] Update layout diagrams and container tables in `docs/official-docs/reference/ui-containers-and-views.md`.
- [ ] Update `docs/official-docs/workflows/order-ingestion-kanban.md`.
- [ ] Run `npm run docs:check` to validate links, manifest entries, and plan contracts.

---

## Progress Log

- **2026-07-26**: Documented initial proposal (`[Draft / Idea]`) for Supplies column consolidation, tabbed middle column structure, full-height Ready to Print panel with sorting, and mobile viewport layout adaptation.
- **2026-07-27**: Implemented the Shopify desktop Supplies workspace: Cart is the default view, Pipeline drag hover activates Build Order, and Ready to Print now fills the right panel. Corrected the tab containment so exactly one Supplies body is visible and fixed all Shopify desktop queue grids to two columns. Shopify now opens as the initial board. Existing supplier state transitions, Legacy Redis, and mobile behavior remain unchanged.
- **2026-07-28**: Made confirmed supplier submissions repaint both Build Order and In S&S Cart immediately, then activate the cart view. Unified Shopify production-card sizing across the relocated Supplies and Ready to Print containers. Ready to Print now hides fully fulfilled Shopify orders, keeps progress visible on hover, reserves a stable mockup slot, and progressively hydrates prioritized private previews across desktop and mobile.
- **2026-07-30**: Split Ready to Print into To Print and Printed views backed by canonical `print` and `completed` stages, made 100% progress changes advance or reverse stage atomically, and anchored garment-accounting badges inside a stable card status region so they no longer displace mockups or progress.
