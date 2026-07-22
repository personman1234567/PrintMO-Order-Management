# Shopify Live API Sync & Admin Blocks Integration Plan

- **Status**: `[Draft / Idea]`
- **Owner / Target Milestone**: `v1.4 Backlog`

---

## Summary & Intent

Currently, the PrintMO Order Manager relies primarily on Shopify `orders/paid` webhooks pushing static order snapshots directly into the operational Redis queue (`shopifyOrdersQueue`). However, if an order is edited, updated, or augmented inside Shopify Admin after initial payment (e.g. line items added/removed, address changes, custom customer notes), the static snapshot in Redis becomes stale unless complex, multi-event webhook infrastructure is maintained.

This architectural proposal outlines a two-pronged solution:
1. **Live Shopify API Sync Layer**: Enhancing the backend data layer to query and synchronize live order data directly via Shopify Admin REST/GraphQL APIs (or a polling/on-demand active sync layer) alongside webhooks, maintaining real-time data accuracy while keeping API token access secure.
2. **Shopify Admin Order Blocks & Two-Way Sync**: Embedding Shopify App UI Blocks / Theme App Extensions into the Shopify Admin Order Details interface. This enables shop admins to view and modify PrintMO production states directly inside Shopify Admin, with bidirectional real-time synchronization between Shopify Admin Order Blocks and the PrintMO Order Manager UI.

---

## Open Questions & Brainstorming

1. **REST vs GraphQL Admin API Selection**: Should live status sync rely on GraphQL Admin API (bulk query capabilities, granular field selection) or REST Admin API (simpler endpoint contracts already present in proxy)?
2. **Rate Limiting & Caching Strategy**: How can we perform live polling or on-demand active syncs without exceeding Shopify Admin API leaky bucket rate limits during peak order volume? Should Cloudflare Worker proxy cache order state in Redis with short TTLs?
3. **Conflict Resolution in Two-Way Sync**: If an order status is updated simultaneously in the PrintMO Kanban UI (e.g., dragged to `In Production`) and modified in Shopify Admin (e.g., order edited via App Block), which update takes precedence, and how is the optimistic update handled?
4. **App Block Technology Stack**: Should Shopify Admin extensions be built using Shopify Admin Action/Block Extensions (React/Web Components) or embedded iframe surfaces hosted via the Cloudflare Worker proxy (`order-manager-proxy`)?

---

## Technical Specification & Task Checklist

### Phase 1: Live API Sync Data Layer (Cloudflare Proxy & Backend)
- [ ] Extend `order-manager-proxy/worker.js` with authenticated endpoints for on-demand GraphQL/REST order fetching.
- [ ] Design active sync strategy (hybrid webhook trigger + background query validation on order view/edit).
- [ ] Implement Redis queue reconciliation logic to merge live API payloads with existing `shopifyOrdersQueue` records without overwriting local shop metadata.

### Phase 2: Shopify Admin UI Extension / Order Block Integration
- [ ] Create Shopify Admin Extension project for Order Detail App Block.
- [ ] Implement Shopify Admin Block layout displaying current PrintMO Kanban status, production notes, and blanks availability.
- [ ] Expose two-way sync endpoints on proxy to allow Admin Block user actions to trigger state updates in Redis and broadcast updates to active Electron/Web Kanban sessions.

### Phase 3: Client Sync & UI Verification
- [ ] Update desktop `renderer.js` and `order-manager-web/` to handle live sync events and reflect real-time updates from Shopify Admin.
- [ ] Verify contextual isolation and security rules (protecting API tokens inside proxy/env variables).

---

## Progress Log

- **2026-07-21**: Proposal drafted as Stage 1 `[Draft / Idea]` feature plan in `future-plans/`.
