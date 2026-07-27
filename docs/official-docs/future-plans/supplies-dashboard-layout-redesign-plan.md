# Supplies Column and Dashboard Layout Redesign Plan

- **Status**: `[Draft / Idea]`
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

- **Current state**: Proposal recorded in Stage 1 `[Draft / Idea]`. Live codebase maintains 3 top-level panels with Blanks nested inside Panel 3.
- **Next safe action**: Finalize UX tab behavior and draft HTML/CSS container blueprints for Panel 2 (`.panel.supplies`) and Panel 3 (`.panel.fulfillment`).
- **Remaining blockers**: Drag-and-drop drop-target activation during tab switching; mobile tab bar route mapping.
- **Owner / external actions**: Confirm default tab landing and operator drag preferences.
- **Last verified evidence**: Standard 3-column desktop layout verified in `docs/official-docs/reference/ui-containers-and-views.md`.

---

## Open Questions & Brainstorming

1. **Tab Naming for Create Blanks Order**: Should the tab be named `Build Order`, `Create Order`, or `Draft Order`? `Build Order` keeps tab headers concise on smaller screens.
2. **Drag-and-Drop Target Behavior**: If an operator drags a card from Pipeline while the `In S&S Cart` tab is visible, should hovering over Panel 2 automatically switch to the `Build Order` tab, or should the entire panel act as a drop zone?
3. **Ready to Print Filter Options**: What sorting presets provide the most value for shop operators? (e.g., Oldest First, Newest First, Highest Garment Count, Highest Print Count, Customer Search).

---

## Technical Specification & Task Checklist

### Phase 1: HTML Structure & Container Refactoring (`index.html`)
- [ ] Rename middle panel `.panel.create` container header to **Supplies** (`.panel.supplies`).
- [ ] Implement top tab header inside Panel 2: `[ Build Order | In S&S Cart | Ordered ]`.
- [ ] Relocate `#blanks-section` into Panel 2 under `In S&S Cart` and `Ordered` tab sub-views.
- [ ] Refactor Panel 3 (`.panel.fulfillment`) to exclusively house Ready to Print (`#print-section` / `#col-print`), eliminating the upper Blanks sub-section wrapper.
- [ ] Add sorting/filter toolbar element above the Ready to Print card grid in Panel 3.

### Phase 2: Renderer & State Logic (`renderer.js`)
- [ ] Set `In S&S Cart` tab as the active default tab view when the page loads.
- [ ] Update tab switching handlers for Panel 2 (`Build Order`, `In S&S Cart`, `Ordered`).
- [ ] Maintain drag-and-drop target logic (`#col-toOrder`) when switching into or dragging over the `Build Order` tab.
- [ ] Implement client-side sorting and filter algorithms for Ready to Print cards.

### Phase 3: CSS & Mobile Viewport Adaptation (`desktop.css`, `mobile.css`, `web-shim.js`)
- [ ] Adjust desktop CSS grid styles to provide full-height flex scrolling for Panel 3 (`Ready to Print`).
- [ ] Update `#mobile-tab-bar` layout: collapse `Blanks Cart` and `Blanks Ordered` into a single `Supplies` mobile tab with sub-tab controls, alongside `Pipeline` and `Ready to Print`.
- [ ] Ensure mobile scroll containment and modal overlays operate smoothly across all screen sizes.

### Phase 4: Documentation & Verification
- [ ] Update layout diagrams and container tables in `docs/official-docs/reference/ui-containers-and-views.md`.
- [ ] Update `docs/official-docs/workflows/order-ingestion-kanban.md`.
- [ ] Run `npm run docs:check` to validate links, manifest entries, and plan contracts.

---

## Progress Log

- **2026-07-26**: Documented initial proposal (`[Draft / Idea]`) for Supplies column consolidation, tabbed middle column structure, full-height Ready to Print panel with sorting, and mobile viewport layout adaptation.
