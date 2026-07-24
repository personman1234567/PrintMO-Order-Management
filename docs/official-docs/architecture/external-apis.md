# External APIs Architecture

## Use This When
- You are working on Shopify webhook ingestion or HMAC validation.
- You are updating S&S Activewear API integration, pricing lookup, order posting, or shipment tracking polling.
- You are adding or evaluating SanMar Web Services / PromoStandards API integrations.
- You are configuring API credentials or headers in `main.js` or `order-manager-proxy/worker.js`.

## Skip This When
- You are editing renderer UI components $\rightarrow$ read [workflows/order-ingestion-kanban.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/workflows/order-ingestion-kanban.md).
- You are adjusting local Redis queue schemas $\rightarrow$ read [architecture/ipc-and-storage.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/architecture/ipc-and-storage.md).

## Section Map
- [1. Shopify Webhook Ingestion](#1-shopify-webhook-ingestion)
- [2. S&S Activewear REST API Capabilities](#2-ss-activewear-rest-api-capabilities)
- [3. SanMar Web Services & PromoStandards API Capabilities](#3-sanmar-web-services--promostandards-api-capabilities)
- [4. API Credentials & Environment Variables](#4-api-credentials--environment-variables)
- [Common Failure Modes & Recovery](#common-failure-modes--recovery)

---

## 1. Shopify Webhook Ingestion

Shopify sends real-time HTTP POST notifications when an order is paid:

- **Webhook Events**: `orders/paid` plus configured update/cancel/refund lifecycle topics.
- **Security Invariant**: Webhooks MUST be validated using HMAC SHA256 signature verification against `SHOPIFY_WEBHOOK_SECRET`.
- **Payload Processing**:
  1. Verify HMAC signature.
  2. Parse order details (order number, line items, variants, customer info, quantities).
  3. Deduplicate the delivery in D1.
  4. Enroll/dirty the Shopify-primary projection and schedule refresh.

Before candidate cutover, `orders/paid` can also be forwarded to the old queue only when `LEGACY_INGEST_ENABLED=1`. Candidate reads and production edits never use that legacy write.

---

## 2. S&S Activewear REST API Capabilities

S&S Activewear is our primary distributor for blank apparel (Gildan, Anvil, Next Level, Hanes, Champion, etc.). The application communicates with S&S endpoints using HTTP Basic Authentication (`SS_ACCOUNT_NUMBER` + `SS_API_KEY`).

### A. Endpoint Capabilities Summary

| Endpoint / Capability | Protocol | Description & Operational Use |
|---|---|---|
| **Product & Pricing Lookup** (`GET /v2/products/{sku}`) | REST / JSON | Fetches wholesale piece price, dozen price, case price, product specs, and weights for target SKUs. Used in batch pre-calculation. |
| **Warehouse Inventory** (`GET /v2/inventory`) | REST / JSON | Queries live stock quantities across all S&S regional distribution centers (Bolingbrook IL, Olathe KS, Reno NV, etc.). |
| **Electronic Order Posting** (`POST /v2/orders`) | REST / JSON | The Worker persists a D1 batch state machine, then sends validated aggregate lines through the authenticated stateless gateway. Ambiguous results become `unknown` and are not blindly retried. |
| **Order Status & Shipment Tracking** (`GET /v2/orders/{poNumber}` or `GET /v2/shipments`) | REST / JSON | Retrieves PO processing state (`Submitted`, `In Process`, `Shipped`), package tracking numbers (UPS, FedEx, Spee-Dee), and delivery timestamps. |

### B. Shipment Arrival Monitoring & Auto-Status Updates
- **Feasibility**: Fully supported via S&S Order Status / Shipment APIs.
- **Workflow**:
  1. Once an S&S PO is placed via `process-batch`, PrintMO stores the S&S PO Confirmation ID in the order metadata.
  2. A scheduled background worker or manual refresh polls `GET /v2/orders/{poNumber}` to retrieve tracking numbers and shipping carrier statuses.
  3. When carrier tracking flags the package as `Delivered` (or S&S reports shipment complete), PrintMO automatically advances affected blank orders from `Blanks Ordered` to `Blanks Received` / `Ready to Print`.

---

## 3. SanMar Web Services & PromoStandards API Capabilities

SanMar is a major wholesale blank apparel supplier. Integrating SanMar is required because S&S Activewear has sunset Bella+Canvas (B+C) catalog items, whereas SanMar remains a primary distributor for **Bella+Canvas**, Port & Company, Sport-Tek, and District.

### A. Standard & Protocol Overview
SanMar supports both proprietary SOAP Web Services and industry-standard **PromoStandards** APIs.

| Service / Capability | Protocol | Description & Operational Use |
|---|---|---|
| **Inventory 2.0.0** | PromoStandards / SOAP | Live stock checks by style, color, size, and warehouse (Preston WA, Robbinsville NJ, Jacksonville FL, Minneapolis MN, Dallas TX, Cincinnati OH, Sparks NV). |
| **Product Pricing & Media** | PromoStandards / SOAP | Customer-specific tier pricing lookup and product attribute validation for Bella+Canvas SKUs. |
| **Purchase Order (PO 1.0.0)** | PromoStandards / SOAP | Electronic purchase order submission for automated blank order placement. |
| **Order Status & Shipment Notification (OSN 1.0.0)** | PromoStandards / SOAP | Real-time order tracking, package tracking numbers (UPS/FedEx), and carrier delivery confirmation notifications. |

---

## 4. API Credentials & Environment Variables

| Variable Name | Description | Scope |
|---|---|---|
| `REDIS_URL` | Legacy queue only; prohibited from the final candidate runtime | Temporary Render legacy service |
| `SHOPIFY_WEBHOOK_SECRET` | HMAC signature verification key | Webhook Listener |
| `SS_API_KEY` | S&S Activewear REST API key | Stateless Render supplier gateway |
| `SS_ACCOUNT_NUMBER` | S&S Activewear account number | Stateless Render supplier gateway |
| `SANMAR_CUSTOMER_NUMBER` | SanMar Customer Account Number | Main Process / Worker Proxy (Future) |
| `SANMAR_USERNAME` | SanMar Web Services / PromoStandards Username | Main Process / Worker Proxy (Future) |
| `SANMAR_PASSWORD` | SanMar Web Services / PromoStandards Password | Main Process / Worker Proxy (Future) |

> [!CAUTION]
> **Credential Protection**: Never check `.env` files into version control. Ensure `.env` is listed in `.gitignore`.

---

## Common Failure Modes & Recovery

| Symptom / Trap | Root Cause | Diagnosis & Recovery |
|---|---|---|
| S&S API 401 Unauthorized | Missing or expired `SS_API_KEY` in environment | Verify `.env` credentials in packaged build resources or Cloudflare secret bindings. |
| Missing items in S&S order batch | Invalid or unmapped SKU format in Shopify line item | Inspect `process-batch` error logs in `main.js:206-258`. Ensure all Shopify items have valid supplier SKUs. |
| Shopify HMAC validation failure | Raw body stream modified prior to HMAC calculation | Compute HMAC against raw unparsed request body string. |
