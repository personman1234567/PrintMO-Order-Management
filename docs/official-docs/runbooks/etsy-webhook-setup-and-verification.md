# Etsy Paid-Order Webhook Setup and Verification

## Use This When

- The Etsy Worker webhook release and migration are deployed and the owner is ready to subscribe `order.paid`.
- You need to verify delivery, signature enforcement, shadow ingestion, retry, or reconciliation health.

## Skip This When

- Etsy OAuth is disconnected or `transactions_r` has not passed the bounded read and refresh proof.
- You are changing provider identity or board semantics; use the [Etsy integration plan](../future-plans/etsy-order-source-integration-plan.md).
- You intend to enable automatic board enrollment. That remains a separate owner-acceptance gate after one real paid/unshipped receipt passes shadow comparison.

## Section Map

- [Shipped Contract](#shipped-contract)
- [One-Time Portal and Secret Setup](#one-time-portal-and-secret-setup)
- [Verification](#verification)
- [Recovery and Rollback](#recovery-and-rollback)
- [Common Failure Modes & Recovery](#common-failure-modes--recovery)

## Shipped Contract

The public callback is:

```text
https://order-manager-proxy.printmobusiness.workers.dev/order-manager/v1/webhooks/etsy
```

Subscribe only `order.paid`. The route is server-to-server and uses Etsy's signature—not a browser bearer token—as authorization. It verifies the exact raw body, accepts only `v1` HMAC-SHA256 signatures, enforces Etsy's five-minute timestamp window, validates the authorized shop and a canonical Etsy receipt resource, and deduplicates `webhook-id`.

The durable ledger stores delivery metadata and redacted error codes, never the raw payload. Accepted deliveries fetch the authoritative receipt and transactions through the encrypted OAuth connection. Paid, unshipped, non-canceled receipts are projected idempotently. `ETSY_WEBHOOK_ENROLLMENT_ENABLED=0` keeps new real receipts in hidden shadow; existing production state is never reset by a commerce refresh.

The five-minute schedule retries due failed processing and runs an overlapping, paginated paid/unshipped reconciliation. The nightly schedule runs a bounded 30-day integrity window. Both remain inactive until a valid `ETSY_WEBHOOK_SECRET` exists; `ETSY_WEBHOOK_RECONCILIATION_ENABLED=0` is the explicit reconciliation kill switch.

## One-Time Portal and Secret Setup

1. In Etsy Developer Portal, open **Manage Apps**, select `print-mo-internal-order-sync`, and choose **Go to Webhook portal**.
2. Select **+ Add Endpoint**.
3. Enter the callback exactly as shown above. Do not add a trailing slash, query string, or alternate hostname.
4. Choose only `order.paid`, then select **Create**.
5. Open the new endpoint's details and reveal/copy its signing secret. It begins with `whsec_`. Do not put it in chat, source, `.env`, documentation, screenshots, shell history, or browser storage.
6. In a local PowerShell window, let Wrangler prompt for the value so the secret is not passed as a command-line argument:

   ```powershell
   Set-Location 'E:\PrintMO\PrintMO-Order-Management\order-manager-proxy'
   npx wrangler secret put ETSY_WEBHOOK_SECRET
   ```

7. Paste the secret only into Wrangler's hidden prompt and submit it. Do not set `ETSY_WEBHOOK_SECRET_PREVIOUS` during first setup; that optional secret exists only for a controlled rotation overlap.

If Etsy sends or records an initial delivery before step 6, a `503` is expected because the Worker deliberately fails closed without the signing secret. Install the secret, then resend a Portal test event.

## Verification

1. Open the endpoint in Etsy's Webhook Portal and use its **Testing** tab to send an `order.paid` test.
2. In Etsy **Activity** or delivery history, confirm the latest attempt received a `2xx` response. A new valid delivery returns `202`; an exact retry of the same `webhook-id` returns `200` without processing twice.
3. Confirm signature rejection independently. This intentionally invalid request must return `401` with `ETSY_WEBHOOK_SIGNATURE_INVALID` and must not create a delivery row:

   ```powershell
   $headers = @{
     'Content-Type' = 'application/json'
     'webhook-id' = 'msg_invalid_health_check_1'
     'webhook-timestamp' = [string][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
     'webhook-signature' = 'v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
   }
   try {
     Invoke-WebRequest `
       -Method Post `
       -Uri 'https://order-manager-proxy.printmobusiness.workers.dev/order-manager/v1/webhooks/etsy' `
       -Headers $headers `
       -Body '{"event_type":"order.paid","resource_url":"https://api.etsy.com/v3/application/shops/41261957/receipts/1","shop_id":41261957}'
   } catch {
     $_.Exception.Response.StatusCode.value__
   }
   ```

4. While the embedded Order Manager is open inside Shopify Admin, inspect the authenticated status from its browser console:

   ```javascript
   await apiFetch('/order-manager/v1/integrations/etsy/webhook-status', { method: 'GET' })
   ```

   Expected setup state: `secretConfigured: true`, `event: "order.paid"`, `mode: "shadow-only"`, `reconciliationEnabled: true`, and `customerDataIncluded: false`. After the Portal test, delivery counts and `latest` should update without exposing a receipt ID, payload, token, or buyer value. A Portal sample that points to a readable eligible receipt may become `processed` with `SHADOW_SYNCED`; a synthetic or unreadable sample may become `retry` after the signed request was correctly accepted. In that case, the Portal `2xx` plus the new redacted ledger entry proves routing and signature verification, while the first real order proves authoritative hydration.
5. For the first real paid/unshipped order, verify that the latest delivery becomes `processed` with `SHADOW_SYNCED`, the provider projection remains `enrollment_state='shadow'` and `board_enrolled=0`, and reconciliation reports bounded counts. Compare its line count, quantities, money, variations, and personalization to Etsy before enabling automatic enrollment.
6. Keep `ETSY_WEBHOOK_ENROLLMENT_ENABLED=0` until that exact real receipt passes owner acceptance. Enabling it is a separate Worker release and rollback decision, not part of Portal setup.

## Recovery and Rollback

- Immediate external stop: choose **Disable Endpoint** in Etsy's portal. Disable is reversible; delete is permanent and removes portal history.
- Ingestion stop: keep or restore `ETSY_WEBHOOK_ENROLLMENT_ENABLED=0`. Already verified receipts remain hidden shadow records.
- Reconciliation stop: set `ETSY_WEBHOOK_RECONCILIATION_ENABLED=0` through a reviewed Worker release. Do not remove the OAuth connection merely to pause webhook ingestion.
- Secret compromise: disable the endpoint, create/rotate the portal secret, place the old value temporarily in `ETSY_WEBHOOK_SECRET_PREVIOUS`, put the new value in `ETSY_WEBHOOK_SECRET`, verify a test, then delete the previous secret.
- Failed processing: inspect the authenticated status and redacted Worker logs. The D1 ledger retries transient failures up to eight attempts; overlapping reconciliation recovers eligible receipts independently of a single delivery.
- Roll back Worker code through Cloudflare version rollback only after the endpoint is disabled. Preserve D1 delivery and provider audit rows.

## Common Failure Modes & Recovery

| Failure | Likely boundary | Recovery |
|---|---|---|
| Portal shows `503` | Signing secret is absent or malformed | Run `wrangler secret put ETSY_WEBHOOK_SECRET` from `order-manager-proxy`, then resend the Portal test. |
| Portal shows `401` | Wrong endpoint secret, changed raw body, stale timestamp, or invalid signature prefix | Copy the secret from this exact endpoint, preserve the raw request body, and confirm current Worker time. Never paste the secret into logs. |
| Portal shows `403` | Payload shop or resource path does not match the connected Print-MO shop | Verify the webhook belongs to `print-mo-internal-order-sync` and shop `41261957`; do not broaden the allowlist. |
| Delivery is `retry` | Etsy receipt read, token refresh, rate limit, or temporary provider failure | Let scheduled recovery run; inspect only the redacted error code. Reconnect OAuth only for an actual token/connection failure. |
| Portal test is `2xx` but no board card appears | Shadow-only mode is working as designed | Verify `SHADOW_SYNCED`; compare one real receipt, then make a separate owner-approved enrollment release. |
| Duplicate delivery returns `200` | Etsy retried the same `webhook-id` | No action. The ledger and provider upsert are idempotent. |
| Same `webhook-id` returns `409` | The ID was reused with different signed content | Treat as an integrity incident; preserve the delivery metadata and inspect Etsy Activity without replaying arbitrary bodies. |
| Reconciliation reports `truncated: true` | More receipts matched than the bounded run could safely process | Keep enrollment off and run a reviewed bounded catch-up; do not silently advance the checkpoint. |
