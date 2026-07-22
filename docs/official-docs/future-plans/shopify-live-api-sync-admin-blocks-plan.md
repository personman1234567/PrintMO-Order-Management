# Shopify Live API Sync, Decoupled Architecture & Zero-Trust Partner Security Plan

- **Status**: `[Draft / Idea]`
- **Owner / Target Milestone**: `v1.4 Backlog`

---

## Summary & Intent

This proposal outlines a major architectural evolution for PrintMO Order Management: transitioning from a **static webhook-only Redis queue** to a **Decoupled Live Shopify API Sync Layer**, combined with a **Zero-Trust 2-Partner Security Model**.

### 1. The Decoupling Problem & Solution
- **Current Limitation**: When an order is paid, a single `orders/paid` webhook pushes a static order snapshot into Redis (`shopifyOrdersQueue`). If an order is edited (line items added/removed, address changed, customer notes updated) or canceled in Shopify Admin post-payment, Redis holds a stale snapshot. Maintaining webhooks for every single Shopify event introduces complex state race conditions.
- **Decoupled Architecture**:
  - **Shopify Admin API as Source of Truth**: Live order attributes (items, quantities, variants, customer info, Shopify fulfillment status) are fetched directly via Shopify Admin GraphQL API on demand.
  - **Redis as Production Metadata Store**: Redis is decoupled from static order data and only stores PrintMO shop-specific production metadata (`kanban_status`, `blanks_po`, `printed_count`, `attachments`, `internal_notes`).
  - **On-Demand Hybrid Reconciliation**: When an order card or detail modal is opened, PrintMO merges live Shopify Admin API data with local Redis production metadata in real time.

### 2. Zero-Trust 2-Partner Access Control
Access to live Shopify Admin APIs, production state, and Shopify Admin App Blocks MUST be strictly restricted **ONLY to the 2 authorized business partners**, eliminating unauthorized access risks and external vulnerabilities.

---

## Open Questions & Brainstorming

1. **Authentication Protocol**: Should partner authentication rely on WebAuthn/Passkeys (biometric/hardware key), short-lived signed JWTs with TOTP 2FA, or mTLS client certificate pinning for Electron desktop builds?
2. **Shopify Admin Block Session Verification**: When rendering inside Shopify Admin, how do we validate Shopify session tokens (`id_token`) to verify that the logged-in Shopify user ID matches one of the 2 authorized partner user IDs?
3. **GraphQL vs REST Polling Frequency**: For active batch rendering, should live status sync use bulk GraphQL queries with short Redis TTL caching (e.g., 30s cache) to avoid hitting Shopify leaky-bucket rate limits?
4. **Offline / Fallback Resilience**: If Shopify API experiences temporary downtime, should PrintMO fall back to cached Redis snapshots with a visual "Stale Data Warning" banner?

---

## Technical Specification & Security Hardening Framework

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 2-PARTNER CLIENT SURFACES                              │
│  [ Partner 1 Electron Desktop App ]       [ Partner 2 Shopify Admin Embedded App Block ]│
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
                    1. Signed Request + Auth Token / Passkey (TLS 1.3)
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                 CLOUDFLARE WORKER PROXY (Zero-Trust Security Barrier)                 │
│                                                                                        │
│  • Partner Whitelist Verification (Strict 2-User Identity Match)                       │
│  • HMAC Replay Attack Prevention & Rate Limiting (60 req/min)                          │
│  • Encrypted Secrets Binding (`shpat_...` Shopify Access Token protected)              │
│  • Immutable Audit Logger (Records IP, Timestamp, Partner ID)                          │
└─────────────────────┬──────────────────────────────────────────────┬───────────────────┘
                      │                                              │
         2. Live GraphQL Query                         3. Merges Production Metadata
                      ▼                                              ▼
┌───────────────────────────┐                      ┌────────────────────────────────────┐
│ SHOPIFY ADMIN GRAPHQL API │                      │ UPSTASH REDIS QUEUE                │
│ (Live Order Attributes)   │                      │ (PrintMO Production Metadata Only) │
└───────────────────────────┘                      └────────────────────────────────────┘
```

### Phase 1: Zero-Trust Security Infrastructure & Proxy Hardening
- [ ] **Partner Identity Whitelist**: Configure strict 2-user whitelist (`PARTNER_1_ID`, `PARTNER_2_ID`) inside `order-manager-proxy/worker.js`.
- [ ] **Authentication Middleware**: Implement WebAuthn / signed short-lived JWT (RS256) auth flow. Reject any request not originating from an authenticated partner session.
- [ ] **Shopify Admin Token Protection**: Ensure `SHOPIFY_ADMIN_API_TOKEN` resides strictly inside Cloudflare Encrypted Secret bindings and `.env` (never exposed to renderer scripts).
- [ ] **Vulnerability Mitigation Layer**:
  - Lock CORS headers strictly to authorized origins.
  - Implement request rate-limiting and IP throttling.
  - Enforce HMAC header signatures and nonce timestamps to prevent replay attacks.
  - Log all administrative state changes to an immutable audit KV log.

### Phase 2: Decoupled Data Layer & GraphQL Sync Engine
- [ ] **Data Model Decoupling**: Refactor Redis schema so `shopifyOrdersQueue` stores only PrintMO production metadata keyed by Shopify Order ID (`gid://shopify/Order/1234`).
- [ ] **GraphQL Sync Client**: Build high-performance GraphQL client query inside proxy to fetch live order details, line item modifications, and Shopify fulfillment status.
- [ ] **Data Reconciliation Pipeline**: Implement merge function: `Live Shopify Order JSON + Redis Production Metadata = Final Unified Render Object`.

### Phase 3: Shopify Admin App Block & Bidirectional Sync
- [ ] **Shopify Admin UI Extension**: Create Admin Order Detail App Block rendered within Shopify Admin.
- [ ] **Session Token Verification**: Validate Shopify `id_token` JWT on every App Block load and verify user ID against the 2-partner whitelist.
- [ ] **Two-Way Status Propagation**: Broadcast status changes made in Shopify Admin App Block to active Electron/Web Kanban sessions via proxy WebSocket / SSE channels.

---

## Progress Log

- **2026-07-21**: Proposal expanded into comprehensive Decoupled Architecture & Zero-Trust 2-Partner Security Framework spec in `future-plans/`.
