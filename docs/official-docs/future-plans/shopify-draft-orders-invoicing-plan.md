# Shopify Draft Orders & Invoicing Engine Plan

- **Status**: `[Draft / Idea]`
- **Owner / Target Milestone**: `v1.5 Backlog`

---

## Summary & Intent

Currently, creating quotes, custom estimates, or partial customer orders requires shop owners to leave PrintMO Order Manager and operate inside Shopify Admin. This introduces context switching, friction when adding print-shop specific charges (setup fees, digitizing, screen charges, rush fees), and difficulty tracking unpaid quotes alongside active shop production.

This architectural proposal designs a **Shopify Draft Orders & Invoicing Engine** built natively into PrintMO Order Manager. It allows shop owners to:
1. Search products, variants, colors, sizes, and images directly via Shopify Admin GraphQL API.
2. Build custom quotes with 1-click shop fee buttons (Art Setup, Screen Charges, Digitizing, Rush Fees).
3. Save partially completed Draft Orders to resume or edit at any time.
4. Send official Shopify email invoices (`draftOrderInvoiceSend`) directly to customers from PrintMO.
5. Track active draft states with live aging metrics (`Awaiting Payment: 3d 14h`).
6. Automatically transition completed payments into the PrintMO Kanban Order Pipeline (`Payment Received`).

---

## Security Architecture: Micro-Scoped Least-Privilege Tokens

To prevent over-privileged credential exposure ("all permissions on one key"), API authentication is compartmentalized into **three isolated micro-scoped tokens** enforced by the Cloudflare Worker proxy firewall:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                   CLOUDFLARE WORKER PROXY GATEWAY FIREWALL                   │
│                                                                             │
│  [ ENDPOINT 1: /api/catalog/search ] ──► Token A (read_products ONLY)      │
│  • Can ONLY search titles, SKUs & images. Cannot see customers or money!    │
│                                                                             │
│  [ ENDPOINT 2: /api/drafts/create ]   ──► Token B (write_draft_orders ONLY)  │
│  • Can ONLY build draft orders & send invoices.                            │
│                                                                             │
│  [ ENDPOINT 3: /api/webhooks/ingest ] ──► Token C (read_orders ONLY)       │
│  • Can ONLY invalidate/reconcile paid Shopify orders.                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

1. **Token A (Catalog Search)**: Scope `read_products` ONLY. If compromised, an attacker can only view public catalog items—zero access to customer records, financial data, or order creation.
2. **Token B (Drafts & Invoicing)**: Scopes `write_draft_orders` + `write_customers` ONLY. Used strictly by authenticated proxy routes for draft creation and invoice delivery.
3. **Token C (Webhook Listener)**: Scope `read_orders` ONLY. Used strictly for order ingestion.
4. **Endpoint Firewalling**: Client scripts (Electron/Web) never hold API tokens. Cloudflare Worker proxy routes incoming requests, verifies Passkey/mTLS signatures, and invokes the specific micro-scoped token endpoint.

---

## Data Persistence & Multi-Device Synchronization

### Shopify Cloud as Master Data Store (Zero Redis Dependency for Drafts)
- **Persisted Cloud Storage**: When a draft order is created or updated in PrintMO, Shopify persists the entire draft order record (`draftOrderCreate`, `draftOrderUpdate`) on Shopify’s cloud infrastructure.
- **Multi-Device Parity**: Because draft orders are fetched directly from Shopify GraphQL API (`draftOrders(query: "status:open")`), **all devices** (Partner 1 Desktop, Partner 2 Laptop, Mobile, Shopify Admin) stay **100% in sync in real time without needing Redis storage for draft orders**.

### Custom PrintMO Metadata via Shopify Tags & Metafields
To persist print-shop specific metadata directly on Shopify without external databases:
- **Shopify Tags**: Draft orders receive functional tags (e.g. `PrintMO_Draft`, `Art_Approved`, `Deposit_Paid`).
- **Shopify Metafields**: Extended metadata (e.g. quote version, art proof URL, target print date) is stored in the `printmo` metafield namespace on the Shopify Draft Order object.

---

## Resolved Architectural Decisions & QoL Polishing

Following interactive design alignment, the following core design decisions and Quality-of-Life (QoL) features have been locked:

### 1. UI Workspace & Placement
- **Decision**: Dedicated **Draft Orders Workspace Panel/Tab** in the navigation bar.
- **Layout**: Features a grid/list of active draft order cards displaying real-time aging metrics (e.g. `Awaiting Payment: 2d 5h`) alongside a collapsible `+ New Draft Order` builder drawer.

### 2. Product Search & Custom Shop Fees
- **Decision**: **Unified Catalog + Custom Fee Toolbar**.
- **Capabilities**: Real-time Shopify product search returning variant titles, SKUs, pricing, color/size swatches, and thumbnail images. Includes 1-click preset buttons for print shop surcharges: `Art Setup Fee`, `Screen Preparation`, `Digitizing Fee`, and `Rush Order Surcharge`.

### 3. Invoice Delivery & Aging Metrics
- **Decision**: **1-Click Shopify Invoice Dispatch + Auto-Pipeline Transition**.
- **Workflow**:
  - Clicking `Send Invoice` calls Shopify GraphQL mutation `draftOrderInvoiceSend` to send official branded email invoices.
  - Cards track payment aging metrics (`Draft Created` $\rightarrow$ `Invoice Sent: 4h ago` $\rightarrow$ `Awaiting Payment: 3d`).
  - When payment is completed on Shopify, webhook ingestion initializes the app-owned PrintMO production metafield at `received` and refreshes the D1 board projection.

### 4. Customer Lookup & Quick Creation
- **Decision**: **Customer Search + Quick Create Modal**.
- **Capabilities**: Real-time autocomplete searching existing Shopify customer records by name, email, phone, or company. Includes a `+ New Customer` inline modal to register new customer profiles in Shopify on the fly without leaving PrintMO.

### 5. Print-Shop Specific QoL Enhancements
- **Garment Size Matrix Quick-Grid**: Renders a single horizontal size entry grid `[ S: 5 ] [ M: 15 ] [ L: 20 ] [ XL: 10 ] [ 2XL: 0 ]` when a garment color is chosen, automatically generating all size variant line items in 1 click instead of adding sizes individually.
- **1-Click Quote Duplicator**: A `Duplicate Draft` action allowing shop owners to clone a previous draft quote for re-orders or returning clients in 1 click.
- **B2B Tax Exemption & Reseller Certificate Toggle**: A 1-click `Tax Exempt` toggle (`taxExempt: true`), saving reseller certificate IDs to Shopify custom attributes for non-profits, schools, and wholesale clients.
- **Quote Expiration & Stock Lock Warnings**: Configurable quote validity windows (e.g., `Valid for 7 Days`). Displays warning alerts if an invoice is paid past expiration so shop owners can re-verify blank apparel prices/stock with S&S/SanMar.
- **Automated Overdue Payment Reminders**: Cards turn red if unpaid after 5 days (`Overdue: 5d`). Provides a 1-click `Send Payment Reminder` CTA button.
- **Art Proof Attachment in Invoice**: Option to attach proof data URLs/links directly into the `customMessage` field during `draftOrderInvoiceSend`.
- **Deposit / Partial Billing Support**: Ability to set a custom deposit percentage (e.g., 50% deposit) using Shopify custom line-item discounts.

---

## Technical Specification & Task Checklist

### Phase 1: Micro-Scoped API Credentials & Proxy Security Firewall
- [ ] Configure `Token A` (`read_products`), `Token B` (`write_draft_orders`, `write_customers`), and `Token C` (`read_orders`) in Shopify Admin & Cloudflare Secrets.
- [ ] Build proxy middleware in `worker.js` mapping `/api/catalog/*` to Token A and `/api/drafts/*` to Token B with Passkey/mTLS authorization checks.

### Phase 2: GraphQL Data Engine & Metafield Sync
- [ ] Implement Shopify GraphQL queries:
  - Catalog Search: `products(query: $query)` returning titles, SKUs, variants, prices, and `featuredMedia`.
  - Customer Search & Quick Creation: `customers(query: $query)` and `customerCreate`.
  - Draft Order CRUD: `draftOrderCreate`, `draftOrderUpdate`, `draftOrderDelete`, `draftOrders(query: $query)`.
  - Tax Calculation: `draftOrderCalculate`.
  - Invoice Delivery: `draftOrderInvoiceSend`.
- [ ] Implement Shopify Metafield & Tag writer (`namespace: "printmo"`) to persist custom shop notes, art proof URLs, and quote versions directly on Shopify.

### Phase 3: Draft Orders Workspace UI & Builder Drawer
- [ ] Create `Draft Orders` tab in navigation shell and standalone drawer UI.
- [ ] Build product search autocomplete component displaying variant thumbnails, size/color dropdowns, and unit prices.
- [ ] Implement Garment Size Matrix Quick-Grid (`[S][M][L][XL][2XL]`).
- [ ] Add Custom Shop Fee toolbar (`Art Setup`, `Screen Charge`, `Digitizing`, `Rush Fee`).
- [ ] Implement draft line-item table with total price, tax exemption toggle, and discount input fields.
- [ ] Add 1-click `Duplicate Draft` CTA button.

### Phase 4: Invoice Dispatch, Aging Metrics & Webhook Transition
- [ ] Implement `Send Invoice` action with custom shop message input modal and art proof attachment options.
- [ ] Add aging badge renderer (`Awaiting Payment: Xd Yh`) and overdue warning alerts (`Overdue: 5d`) to draft order tiles.
- [ ] Wire webhook/polling reconciliation: when a draft transitions to `orders/paid`, idempotently initialize the canonical production metafield at `received` and refresh the D1 board projection.

---

## Progress Log

- **2026-07-21**: Proposal expanded into Stage 1 locked spec with Micro-Scoped Token Security Architecture, Shopify Cloud Data Persistence (Zero Redis dependency for drafts), multi-device parity rules, size matrix quick-grid, B2B tax exemption toggles, and quote expiration safeguards in `future-plans/`.
- **2026-07-23**: Removed the paid-order handoff to `shopifyOrdersQueue`; future implementation must use the Redis-free Shopify/D1/R2 data plane.
