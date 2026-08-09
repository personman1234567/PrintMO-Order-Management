# Etsy Order Source Integration

- **Status**: `[In Progress]`
- **Owner / Target Milestone**: Print-MO owner / Etsy connection proof, then provider-aware Order Manager rollout

## Summary & Intent

Connect Print-MO's approved private Etsy Seller App to the Order Manager without pretending Etsy receipts are Shopify orders or weakening the existing Shopify production authority. The completed connection milestone proved OAuth, exact shop identity, a bounded receipt/transaction read, token refresh, and secret isolation. The current staged rollout adds provider-aware board behavior plus signed webhook ingestion while keeping real automatic enrollment and Etsy fulfillment writes separately gated.

The target experience is one operational board with source-aware commerce adapters. Shared production workflows should feel consistent, while source badges and source-specific actions remain explicit enough that an operator cannot accidentally perform a Shopify-only action on an Etsy order.

## Current Continuation State

- **Current state**: The isolated Worker-side Etsy connection proof passed live for shop `PrintMOShirts` (`41261957`). Migrations through `0007_etsy_webhook_delivery.sql`, Worker `95efcfdc-a205-47cf-a229-18223a9a4ca8`, and Pages release `1786233715159` now provide the shared provider-aware board plus a public signed `order.paid` receiver, a payload-free D1 delivery ledger, shadow-only authoritative receipt ingestion, durable retry, bounded overlapping reconciliation, authenticated redacted health, and an owner-gated automatic-enrollment switch. `#ETSY-TEST-001` remains the only Etsy card on the live board.
- **Next safe action**: The owner should create exactly one `order.paid` endpoint for `https://order-manager-proxy.printmobusiness.workers.dev/order-manager/v1/webhooks/etsy`, install its `whsec_` value through `wrangler secret put ETSY_WEBHOOK_SECRET`, and send one Portal test. Then let one real paid/unshipped receipt reach hidden shadow and compare identity, lines, money, variations, and revision behavior. Keep `ETSY_WEBHOOK_ENROLLMENT_ENABLED=0` until that receipt passes acceptance.
- **Remaining blockers**: The Worker is deployed fail-closed because Etsy has not yet issued/installed the endpoint signing secret, and no Portal-signed delivery has been observed. The synthetic card proves board mechanics but not real receipt fidelity. The only previously observed live receipt was already shipped; eligible paid/unshipped, canceled, refunded, multi-line, and non-null typed-personalization examples remain live-unobserved. Supplier batching/artwork upload remain disabled for Etsy.
- **Owner / external actions**: Follow [Etsy webhook setup and verification](../runbooks/etsy-webhook-setup-and-verification.md). Keep all Etsy API, OAuth, token-encryption, and webhook signing secrets out of chat, source, browser storage, screenshots, and logs; enter them only through Wrangler's hidden secret prompt. Subscribe only `order.paid` at the exact callback above.
- **Last verified evidence**: On 2026-08-08, migration `0007` applied with an empty delivery ledger and Worker `95efcfdc-a205-47cf-a229-18223a9a4ca8` deployed with the existing four secrets and cron triggers preserved. Live probes returned `405` for GET, `415` for a bodyless POST, and fail-closed `503 ETSY_WEBHOOK_NOT_CONFIGURED` for a structured invalid delivery. The signed-in embedded board completed an authenticated Shopify refresh with zero browser errors; `#ETSY-TEST-001` and current Shopify orders remained visible. Phase 2 proves valid/invalid/stale/conflicting delivery behavior, retry recovery, shadow-only ingestion, bounded reconciliation, explicit enrollment gating, and no raw webhook/customer retention.

## Approved Provider and Source-Identity Contract

The owner approved one shared production board with explicit provider identity on 2026-08-08. The renderer may present Shopify and Etsy consistently, but it must never infer authority from a display number or make an Etsy receipt look like a Shopify order internally.

### Stable identity

- Every order carries `provider`, `providerAccountId`, `externalOrderId`, `sourceDisplayNumber`, and a Worker-issued `orderKey`.
- `orderKey` is the shared browser, drag, cache, and mutation identity. Its canonical components are provider-safe, for example `shopify:<shop-id>:<numeric-order-id>` and `etsy:<etsy-shop-id>:<receipt-id>`.
- Provider-native identifiers remain intact behind the adapter. Shopify GIDs are not placed into fallback idempotency keys, and Etsy receipt IDs are never converted into Shopify GIDs.
- The current renderer convention of using the combined display `name` as identity must be retired before Etsy board enrollment. Customer or recipient display text is presentation only.

### Normalized order boundary

The eventual shared board DTO contains these top-level groups:

- `orderKey` and `source`: provider, provider account, external ID, display number, source label, and optional source-admin URL;
- `commerce`: created/updated times, paid/canceled/shipped/delivered state, currency and totals, bounded recipient identity, line items, variations, personalization, and source notes;
- `production`: the existing shared production shape plus an explicit authority descriptor and revision;
- `sync`: fetched/fresh/stale timestamps, partial-data state, and structured provider errors;
- `capabilities`: source-specific actions the current order actually supports.

Commerce remains read-only at launch. Missing protected Etsy address fields must produce an explicit partial-data state and fallback presentation, not a failed or empty order.

The first live inventory established these mapping anchors without retaining values:

| Normalized meaning | Observed Etsy paths | Mapping rule |
|---|---|---|
| Order identity | `receipt_id` | Etsy provider account plus receipt ID forms the stable order key. |
| Line identity | `transactions[].transaction_id` | Transaction ID is immutable line identity. |
| Garment/line content | `title`, `sku`, `quantity`, `price` | Money uses `amount / divisor` and preserves `currency_code`. |
| Variation and personalization | `variations[].formatted_name`, `formatted_value`, `property_id`, `value_id`, `question_id` | Preserve every variation; classify non-null `question_id` or a personalization-named field as personalization without discarding the original pair. |
| Rich product selections | receipt-nested `transactions[].product_data[]` | Prefer the receipt-nested non-null structure when the separate transaction response returns `product_data: null`. |
| Lifecycle | `status`, `is_paid`, `is_shipped`, paid/shipped timestamps | Keep commerce lifecycle separate from Print-MO production stage; tolerate optional cancellation fields not present in this sample. |
| Totals | `subtotal`, `discount_amt`, `grandtotal`, shipping/tax/VAT money objects | Normalize exact currency-aware amounts; do not hard-code dollars. |
| Recipient and fulfillment | `name`, address fields, `shipments[]` | Board summary receives only operational display name; full address/tracking belongs to on-demand detail and may be unavailable by region/permission. |
| Artwork reference | `listing_image_id` | A listing image may aid recognition but is never approved production artwork. |
| Exceptions | `refunds`, gift/message fields | Summary exposes only bounded booleans/counts; raw messages and refund detail remain on-demand. |

### Production authority and persistence

- Shopify production remains canonical only in `$app:printmo.production_state_v1`; its existing `order_projection`, compare-digest concurrency, webhook, reconciliation, and repair behavior do not change.
- Etsy production is canonical in a new revisioned D1 record managed only by the Worker. It uses expected revision, last mutation ID, request idempotency, production events, and the same one-conflict reconciliation posture exposed to the browser.
- Etsy commerce projection stays outside the current Shopify `order_projection`. The minimum schema direction is provider-aware app tables keyed by `(provider, provider_account_id, external_order_id)` plus a unique `order_key`; no Shopify row or `order_gid` column is overloaded.
- Batch, bundle, asset, and audit records must carry `orderKey` or the complete provider tuple before mixed-source operations are allowed. Mixed Shopify/Etsy bundles remain disabled during the first board pilot.

### Source badge and color treatment

- Every collapsed card, compact Build Order card, bundle member, and detail header shows a text badge. The labels are `PrintMO` and `Etsy`; color is reinforcement, never the only cue.
- Etsy uses the official current orange `#F1641E` as a small source rail/accent. The readable badge uses a pale orange surface `#FFF1E8`, dark text `#7A2E0A`, and the orange border/indicator. This keeps small text above WCAG AA contrast while preserving instant Etsy recognition.
- The whole card is not tinted. Existing header/footer readiness colors continue to communicate production state without competing with the commerce source.
- Shopify/website orders use the existing Print-MO primary treatment so they read as Print-MO storefront orders, with the `Shopify` text badge preserving technical clarity.
- Source filters are separate from operational filters: `All`, `Shopify`, and `Etsy` can combine with Attention, Stale, No Mockup, and Ready.
- The official Etsy logo is not bundled at this stage. Etsy publishes logo assets, but its current trademark policy says official-logo use requires prior written approval. Use the correctly capitalized plain-text `Etsy` badge unless that permission is obtained. Sources: `https://www.etsy.com/press` and `https://www.etsy.com/legal/trademarks/`.

## Open Questions & Brainstorming

1. Which live Etsy orders should enter the production pool initially: paid and unshipped only, a bounded recent window, or explicit owner-selected receipts?
2. Which Etsy fields are required for garments, variations, personalization, production artwork, shipping promises, and customer instructions, and which protected fields are unnecessary for production?
3. Should Etsy production state use a dedicated D1 record behind a provider strategy, or should a new provider-neutral production entity eventually replace source-specific storage? Shopify must continue using its canonical app-owned metafield.
4. Which actions remain read-only at launch? Etsy tracking/fulfillment writes require separate scope, API verification, idempotency, and owner approval.
5. How should listing/transaction images and personalization map to the existing private artwork and line-item model without treating public listing media as approved production art?
6. After one real eligible receipt passes shadow comparison, what exact owner acceptance and rollback observation window is sufficient to enable automatic enrollment?

## Technical Specification & Task Checklist

### 1. Connection proof — implemented locally, live acceptance pending

- [x] Use the existing Cloudflare Worker as the only Etsy credential/API boundary.
- [x] Request only `transactions_r`; do not request Etsy write scopes.
- [x] Generate high-entropy single-use OAuth state and store only its SHA-256 digest.
- [x] Generate an S256 PKCE verifier/challenge pair and encrypt the verifier at rest.
- [x] Keep the callback public but authorize it solely through unexpired, unconsumed state plus PKCE.
- [x] Encrypt the access and refresh tokens with AES-256-GCM using a server-only key.
- [x] Read the authorized user's shop, then one receipt page and the first receipt's transactions.
- [x] Return and retain only redacted health evidence: shop ID/name, scope, booleans, and transaction count.
- [x] Exercise refresh-token rotation through `forceRefresh`.
- [x] Apply migration `0004_etsy_connection_probe.sql` to the live D1 database.
- [x] Configure the server-generated `ETSY_TOKEN_ENCRYPTION_KEY` without exposing its value.
- [x] Configure `ETSY_API_KEY` and `ETSY_SHARED_SECRET` without exposing their values.
- [x] Deploy the Worker with dashboard-managed production variables preserved.
- [x] Register the exact callback URL in Etsy.
- [x] Confirm the returned shop ID/name and run one live forced-refresh test read.

### 2. Provider-aware commerce contract — plan before implementation

Define a normalized internal reference with at least:

- `provider`: `shopify` or `etsy`;
- `providerAccountId`;
- `externalOrderId` and source display number;
- immutable line identity, quantity, SKU/variation/personalization fields;
- paid/canceled/shipped/delivered commerce state;
- source-created and source-updated timestamps;
- bounded customer/fulfillment fields justified by an actual production use;
- source sync freshness and structured errors;
- a separate production-state reference and authority descriptor.

Do not convert Etsy receipt IDs into `gid://shopify/Order/...`. Do not make D1 canonical for Shopify commerce or replace Shopify's `$app:printmo.production_state_v1` metafield.

- [x] Capture and redact the live Etsy receipt/transaction field inventory.
- [x] Map it against the existing board DTO and order-detail requirements.
- [x] Decide the minimum provider-aware database keys and uniqueness rules.
- [x] Specify Etsy production revision, idempotency, audit, and conflict behavior.
- [x] Add contract fixtures before any renderer or board change.

### 3. Shadow ingestion and event recovery

- [x] Add an Etsy projection that is isolated from `order_projection` until the provider contract is approved.
- [x] Require an explicit receipt ID for persistence and enforce paid, unshipped, non-canceled eligibility; allow latest-receipt inspection only as a dry run.
- [ ] Import one owner-approved eligible receipt into the live shadow projection.
- [ ] Compare projected receipt/line counts with a live bounded Etsy read.
- [x] Deploy the `order.paid` receiver and callback configuration with the signing secret absent/fail-closed until the owner creates the Portal subscription.
- [x] Verify Etsy webhook signatures from the exact raw body, check the timestamp window, and deduplicate `webhook-id` under fixtures; Portal-signed live acceptance remains pending.
- [x] Validate the webhook resource host/shop/path, extract the receipt identity, and reconstruct the authorized Etsy API read instead of blindly fetching the supplied URL.
- [x] Add bounded overlapping reconciliation and durable delivery retry as backstops; webhook delivery is not the sole source of liveness.
- [ ] Create the one `order.paid` Portal subscription, install its signing secret, and pass one Portal test.
- [x] Keep Etsy orders hidden from the active production board during shadow acceptance.

### 4. Shared board rollout

- [x] Normalize Shopify and Etsy through provider adapters before the renderer consumes them.
- [x] Preserve existing Shopify CAS, metafield, D1 projection, webhook, and reconciliation contracts.
- [x] Add a compact source badge and source-aware detail metadata.
- [x] Reuse shared cards, stages, and details where the normalized contract proves parity; keep supplier batching and artwork upload disabled for the Etsy pilot.
- [x] Hide or disable unsupported source-specific actions with an explicit explanation.
- [x] Activate one synthetic Etsy order manually and verify quantities, details, production mutation, refresh, source presentation, and deterministic cleanup through fixtures plus the live UI. A real receipt remains pending.
- [ ] Enable automatic paid-order enrollment only after owner acceptance and rollback verification.

### Acceptance and rollback gates

The connection proof passes only when the exact Print-MO Etsy shop is identified, one receipt/transaction read succeeds, a forced token refresh succeeds, no token or buyer/address value reaches a response/log, and `boardChanged` remains false.

The board rollout passes only when Shopify behavior is unchanged, Etsy identity cannot collide with Shopify identity, webhook retries are idempotent, missed events recover through reconciliation, and disabling Etsy enrollment removes its active feed without deleting source or audit records.

Rollback before board rollout is to disable the Etsy routes/secrets and leave the Shopify/D1/R2 path untouched. Token-encryption-key loss requires Etsy reauthorization unless a deliberate re-encryption procedure is executed before rotation.

## Progress Log

- **2026-08-08**: Implemented and locally verified the isolated Etsy OAuth/status/test-read slice plus encrypted D1 custody and Phase 2 contracts. No deployment, live Etsy authorization, webhook, order persistence, or board integration was performed.
- **2026-08-08**: Applied D1 migration `0004`, installed the server-generated token-encryption secret, and recorded the owner's confirmation that the exact callback is registered. The two Etsy provider secrets, Worker deployment, OAuth, and live read remain pending.
- **2026-08-08**: Verified all three Etsy secrets, deployed Worker `0db7698e-ee0f-45b7-b902-542048fb7a1a`, and opened Etsy's read-only consent page through a real Shopify-authenticated connect request. An initial deploy omitted `--keep-vars`; it was immediately rolled back before redeploying with dashboard-managed production variables preserved. Owner consent and the live read remain pending.
- **2026-08-08**: Diagnosed the post-consent HTTP 403 as `ETSY_SHOP_READ_FAILED`, added a credential preflight and non-sensitive callback failure code, then bound the owner-shop lookup to the freshly granted bearer token. Worker `05e181a5-ba7b-4e0f-9c8e-6aae0e62ef6b` connected `PrintMOShirts`, forced token refresh, read one bounded receipt/transaction, retained no customer payload, and left the board unchanged.
- **2026-08-08**: Approved the provider-aware identity, split production-authority, and source-badge contract. Added a locally verified `includeFieldShape` option that returns only bounded JSON paths and observed types; fixtures prove buyer identity, address, email, messages, personalization values, and OAuth tokens never reach the response. Live deployment and inventory remain pending.
- **2026-08-08**: Deployed Worker `59622cfc-0a96-46f3-8573-5bd71baeed4e` with `--keep-vars` and ran one authenticated bounded inventory. It returned 122 receipt paths and 44 transaction paths with no values, no truncation, no board mutation, and confirmed the receipt-nested transaction contains richer product data than the separate transaction read. Added and verified the local normalized Etsy provider contract and collision-safe identity fixture; persistence and board use remain disabled.
- **2026-08-08**: Applied migration `0005_provider_order_shadow.sql` and deployed Worker `c8449123-17e6-4f6d-bf4b-a6767469d0fd` with a hidden provider projection, revision-zero Etsy production state, and an authenticated explicit-receipt shadow route. Phase 2 fixtures prove paid/unshipped eligibility, already-shipped rejection, idempotent repeated sync, protected-field response redaction, and no Shopify board mutation. Remote provider tables exist and remain empty; no live Etsy receipt was persisted or enrolled.
- **2026-08-08**: Owner approved one unmistakably marked live synthetic pilot. Applied migration `0006_provider_pilot_idempotency.sql`, deployed Worker `e0512130-4abc-4d6b-ba0b-8b89806b4b26` and Pages release `1786233715159`, and enrolled `#ETSY-TEST-001`. Phase 2 proves create/delete confirmation, unified paging, detail reads, revision/idempotency/conflict behavior, and stage filtering. The live embedded app shows one orange-rail Etsy card with `Etsy` and `TEST` badges, two garment lines, hidden artwork-upload controls, and stable provider identity. No Etsy API write or buyer data is involved.
- **2026-08-08**: Applied `0007_etsy_webhook_delivery.sql` and deployed Worker `95efcfdc-a205-47cf-a229-18223a9a4ca8` with a fail-closed `order.paid` route, raw-body Standard Webhooks verification, five-minute replay window, exact shop/resource validation, payload-free D1 delivery state, idempotent shadow ingestion, durable retry, bounded overlapping reconciliation, redacted authenticated health, and automatic enrollment gated off. Local Phase 2, proxy tests/build, docs validation, remote schema checks, public fail-closed probes, and a signed-in production board refresh passed. Etsy Portal secret installation/test and one real eligible receipt remain pending.
