# External APIs Architecture

## Use This When

- You are changing current Shopify GraphQL/webhook behavior or S&S supplier submission.
- You need current authentication, ownership, error, or data-flow boundaries for external services.

## Skip This When

- You are planning SanMar or multi-supplier support → read [Multi-supplier future plan](../future-plans/multi-supplier-routing-and-batching-plan.md).
- You are changing renderer UI → read [Order ingestion and Kanban](../workflows/order-ingestion-kanban.md).
- You are changing the isolated legacy Redis boundary → read [IPC and storage](ipc-and-storage.md).

## Section Map

- [Shopify Admin API and Webhooks](#shopify-admin-api-and-webhooks)
- [S&S Activewear](#ss-activewear)
- [Credential and Trust Boundaries](#credential-and-trust-boundaries)
- [Common Failure Modes & Recovery](#common-failure-modes--recovery)

## Shopify Admin API and Webhooks

The Cloudflare Worker is the authenticated Shopify boundary.

- Embedded clients authenticate with Shopify session tokens; Electron uses approved OIDC identity.
- GraphQL order reads provide commerce summaries and on-demand rich detail.
- `$app:printmo.production_state_v1` is the canonical writable PrintMO production record.
- Production mutation uses `metafieldsSet` with compare digest, expected revision, and idempotency.
- Webhook HMAC is verified against the raw body before parsing.
- Shopify delivery IDs are deduplicated in D1.
- Webhooks dirty projections and schedule bounded refresh/reconciliation.
- Protected customer fields and fulfillment-order data depend on approved installed scopes.

Configured order lifecycle topics and current scopes are authoritative in `order-manager-proxy/shopify.app.toml`.

## S&S Activewear

Candidate submission follows:

```text
Embedded client
→ Worker batch validation and D1 state machine
→ authenticated stateless supplier gateway
→ S&S API
```

- The Worker validates selected canonical projections, stages, revisions, and aggregate lines.
- D1 records prepared/submitting/confirmed/unknown/failed state and redacted supplier attempts.
- The gateway holds S&S credentials and never reads Redis.
- The Worker accepts the gateway's legacy summary success and its detailed line-result contract, normalizes S&S `Orders`, `LineErrors`, and structured `errors`, and maps rejected SKUs back to the source PrintMO orders.
- A confirmed or partial result is stored before Shopify production metadata advances. Only fully accepted orders advance after a partial result.
- A deterministic supplier rejection is stored as `failed` with operator-safe line feedback.
- An ambiguous result becomes `unknown` and must not be blindly resent.
- `GET /order-manager/v1/batches/latest` returns the latest authenticated, redacted result report for the board; it never returns gateway credentials or raw customer/shipping payloads.
- `SS_TEST_ORDER=1` remains required until owner approval enables live ordering.

The Legacy Redis view continues using its isolated legacy batch route until final cutover.

Automated shipment tracking, SanMar, PromoStandards, threshold optimization, and multi-supplier receiving are future work and belong only in the multi-supplier plan.

## Credential and Trust Boundaries

| Secret/configuration | Owner | Client exposure |
|---|---|---|
| Shopify app secret and webhook secret | Worker environment | Never |
| Shopify access token / app installation | Worker/Shopify platform | Never |
| S&S account credentials | Stateless supplier gateway environment | Never |
| Redis URL | Legacy Render adapter only | Never |
| Worker URL and OIDC public configuration | Electron public runtime config | Allowed |
| D1/R2 bindings | Worker configuration | Never |

No renderer, browser bundle, Electron package, or repository document may contain infrastructure secret values.

## Common Failure Modes & Recovery

| Symptom | Cause | Recovery |
|---|---|---|
| Shopify returns a null order with GraphQL errors | Missing installed scope or protected field access | Inspect structured GraphQL error paths; do not assume deletion. |
| Webhook HMAC fails | Body was parsed or transformed before verification | Verify the raw request bytes before JSON parsing. |
| Supplier result is ambiguous | Timeout or uncertain upstream response | Preserve `unknown`, reconcile externally, and do not resubmit blindly. |
| Candidate batch touches Redis | Supplier or candidate path crossed the legacy boundary | Stop, restore Redis-free candidate routing, and run Phase 2 verification. |
| Client requests infrastructure credentials | Trust boundary was placed in the browser/Electron renderer | Move credential use into Worker or supplier gateway. |
