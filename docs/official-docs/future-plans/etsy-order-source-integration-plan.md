# Etsy Order Source Integration

- **Status**: `[In Progress]`
- **Owner / Target Milestone**: Print-MO owner / Etsy connection proof, then provider-aware Order Manager rollout

## Summary & Intent

Connect Print-MO's approved private Etsy Seller App to the Order Manager without pretending Etsy receipts are Shopify orders or weakening the existing Shopify production authority. The first milestone proves OAuth, exact shop identity, a bounded receipt/transaction read, token refresh, and secret isolation. It does not enroll Etsy orders, subscribe to webhooks, alter the board, or write Etsy fulfillment state.

The target experience is one operational board with source-aware commerce adapters. Shared production workflows should feel consistent, while source badges and source-specific actions remain explicit enough that an operator cannot accidentally perform a Shopify-only action on an Etsy order.

## Current Continuation State

- **Current state**: The isolated Worker-side Etsy connection proof passed live for shop `PrintMOShirts` (`41261957`). OAuth completed with only `transactions_r`, tokens are encrypted in D1, forced refresh succeeded, and the privacy-safe live inventory observed 122 receipt paths plus 44 transaction paths without customer values. Migration `0005_provider_order_shadow.sql` and Worker `c8449123-17e6-4f6d-bf4b-a6767469d0fd` now provide a provider-aware hidden projection, revision-zero Etsy production state, and an authenticated explicit-receipt shadow route. Persistence is limited to paid, unshipped, non-canceled receipts; latest-receipt checks are dry-run only; no Etsy row has been persisted live; and board enrollment remains disabled.
- **Next safe action**: Wait for or identify one owner-approved paid/unshipped Etsy receipt, run the latest-receipt dry run, then persist that exact receipt ID to shadow. Compare its provider key, line count, money, variations, and initial revision against Etsy while confirming both provider tables remain hidden from `/order-manager/v1/orders`. Stop before webhooks or board enrollment.
- **Remaining blockers**: The one live receipt observed so far is already shipped and therefore correctly ineligible for shadow persistence. Live evidence still lacks an unshipped, canceled, refunded, multi-line, and non-null typed-personalization example. Those shapes remain fixture-backed and must be treated as provisional until observed. Webhooks, reconciliation, and board enrollment remain deliberately unimplemented.
- **Owner / external actions**: Keep the Etsy shared secret and token-encryption key out of chat, source, browser storage, and logs. Enter them only through the approved Cloudflare Worker secret path. In Etsy, register exactly `https://order-manager-proxy.printmobusiness.workers.dev/order-manager/v1/oauth/etsy/callback` with no trailing slash or query string, then approve only `transactions_r` during the connection proof.
- **Last verified evidence**: On 2026-08-08, the final live callback identified `PrintMOShirts` (`41261957`), authenticated status returned `connected: true` with only `transactions_r`, and the forced-refresh probe returned HTTP 200 with `tokenRefreshed: true`, one paid/shipped receipt, one transaction, `customerDataRetained: false`, and `boardChanged: false`. The initial callback 403 was isolated to the owner-shop lookup; Etsy accepted the same lookup when it was bound to the freshly granted bearer token.

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

- Every collapsed card, compact Build Order card, bundle member, and detail header shows a text badge. The labels are `Shopify` and `Etsy`; color is reinforcement, never the only cue.
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
6. What reconciliation window and retry policy recover missed webhook deliveries without repeatedly reading old customer records or exhausting the app quota?

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
- [ ] Add `order.paid` only after the read path is accepted.
- [ ] Verify Etsy webhook signatures from the exact raw body, check the timestamp window, and deduplicate `webhook-id`.
- [ ] Fetch the webhook `resource_url` through the authorized Etsy client instead of trusting the event as a complete order.
- [ ] Add bounded reconciliation as a backstop; webhook delivery must not be the sole source of liveness.
- [x] Keep Etsy orders hidden from the active production board during shadow acceptance.

### 4. Shared board rollout

- [ ] Normalize Shopify and Etsy through provider adapters before the renderer consumes them.
- [ ] Preserve existing Shopify CAS, metafield, D1 projection, webhook, and reconciliation contracts.
- [ ] Add a compact source badge and source-aware detail metadata.
- [ ] Reuse shared cards, stages, details, artwork tickets, and blanks workflows only where the normalized contract proves parity.
- [ ] Hide or disable unsupported source-specific actions with an explicit explanation.
- [ ] Activate one known Etsy order manually and verify quantities, details, production moves, refresh, and archive behavior.
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
