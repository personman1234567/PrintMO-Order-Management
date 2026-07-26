# Date Range & Customer Filters Plan

- **Status**: `[Draft / Idea]`
- **Owner / Target Milestone**: `v1.4 Backlog`

---

## Summary & Intent

Introduce date range filtering and customer search capabilities to the PrintMO Kanban dashboard. As Shopify-backed order history expands over time, shop operators need to filter board views by custom date ranges (for example, "Today", "This Week", and "Custom Date Range") and filter cards by customer name, order number, SKU, or Shopify tag.

---

## Current Continuation State

- **Current state**: Draft UX and data-boundary questions are recorded; no filter implementation has shipped.
- **Next safe action**: Define the exact operator queries and map each to indexed D1 fields or bounded Shopify lookups.
- **Remaining blockers**: Protected-customer search scope, archive policy, and cursor/filter contract.
- **Owner / external actions**: Prioritize the first filter set and decide whether archived work belongs in the same surface.
- **Last verified evidence**: The obsolete Redis filtering direction was removed on 2026-07-23.

## Open Questions & Brainstorming

1. **Client-Side vs Server-Side Filtering**: Which filters can use indexed D1 projection fields, and which protected customer searches require bounded Shopify queries?
2. **Archived / Fulfillment History View**: Should orders older than 30 days automatically archive to a separate tab to keep the Kanban board high-performance?

---

## Technical Specification & Task Checklist

### Phase 1: Search & Filter Toolbar UI
- [ ] Add top filter bar to `index.html` featuring search input and date pickers.
- [ ] Implement live search filtering in `renderer.js` matching customer name, order #, and SKU text.

### Phase 2: Date Filtering Logic
- [ ] Parse `created_at` timestamps on order cards.
- [ ] Add date presets ("Last 7 Days", "Last 30 Days", "All Time").
- [ ] Implement cursor-safe server filtering through the Worker; do not load or search an entire order history in the browser.

---

## Progress Log

- **2026-07-21**: Feature converted from legacy markdown plan into Stage 1 `[Draft / Idea]` in `future-plans/`.
- **2026-07-23**: Removed the obsolete Redis filtering direction. This feature now depends on the Shopify/D1/R2 data plane defined by the Redis-free cutover plan.
