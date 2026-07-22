# Date Range & Customer Filters Plan

- **Status**: `[Draft / Idea]`
- **Owner / Target Milestone**: `v1.4 Backlog`

---

## Summary & Intent

Introduce date range filtering and customer search capabilities to the PrintMO Kanban dashboard. As order history in Redis expands over time, shop operators need to filter board views by custom date ranges (e.g. "Today", "This Week", "Custom Date Range") and filter cards by customer name, email, or shop tag.

---

## Open Questions & Brainstorming

1. **Client-Side vs Server-Side Filtering**: Should filtering occur entirely in client JS (`renderer.js`) across cached queue items, or via Redis range/search queries?
2. **Archived / Fulfillment History View**: Should orders older than 30 days automatically archive to a separate tab to keep the Kanban board high-performance?

---

## Technical Specification & Task Checklist

### Phase 1: Search & Filter Toolbar UI
- [ ] Add top filter bar to `index.html` featuring search input and date pickers.
- [ ] Implement live search filtering in `renderer.js` matching customer name, order #, and SKU text.

### Phase 2: Date Filtering Logic
- [ ] Parse `created_at` timestamps on order cards.
- [ ] Add date presets ("Last 7 Days", "Last 30 Days", "All Time").

---

## Progress Log

- **2026-07-21**: Feature converted from legacy markdown plan into Stage 1 `[Draft / Idea]` in `future-plans/`.
