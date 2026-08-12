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

### 2A. Listing-preview read proof — locally implemented, live acceptance pending

- [x] Add an authenticated, receipt-backed `POST /order-manager/v1/integrations/etsy/listing-image-probe` that accepts only an explicit Etsy receipt and transaction ID.
- [x] Re-read the authoritative receipt and transaction under the existing `transactions_r` connection; do not accept an arbitrary browser-provided listing/image tuple.
- [x] Read the transaction's listing image and listing variation-image mappings through the server-only Etsy app-key boundary, with no additional OAuth scope and no Etsy write.
- [x] Return only catalog IDs, dimensions, rendition availability, and a redacted variation/image-match verdict. Never return buyer values, personalization, image URLs, token values, image bytes, or an assertion that the image is approved production artwork.
- [x] Keep the proof independent of provider projections, the board, and R2. A token refresh may still maintain the encrypted OAuth connection as part of existing credential custody.
- [ ] Deploy the proof and run it against one owner-selected real receipt/transaction before relying on transaction `listing_image_id` for the visual-preview design.

### 2B. Catalog variation-image proof — deployed and live accepted

- [x] Add an authenticated, catalog-only `POST /order-manager/v1/integrations/etsy/catalog-image-probe` that accepts an owner-selected `listingId`; it safely lists mapped variation property/value IDs and labels, then accepts a selected `propertyId` and `valueId`, never an arbitrary image ID or URL.
- [x] Read the listing through the server-only Etsy app-key boundary and reject it unless its `shop_id` is the connected Etsy shop.
- [x] Resolve the matching variation-image record server-side, then read and validate that exact listing image. No Etsy order, receipt, projection, R2 object, board state, OAuth scope, or image bytes are created or changed.
- [x] Return only catalog IDs, the selected variation label when Etsy provides one, dimensions, rendition availability, and redaction flags. Never return the listing title, image URLs, buyer data, personalization values, tokens, or a production-artwork assertion.
- [x] Run the deployed catalog proof for one owner-selected existing listing/color before the first order arrives. This validates app-key catalog access and color-to-image mapping, but not a future transaction's `listing_image_id`.

Run the proof from the embedded Order Manager browser console: first call the route with only the numeric Etsy `listingId` from its URL to receive safe `variationOptions`; then call it again with the returned `propertyId` and `valueId` for the intended color. `apiFetch` supplies the signed Shopify session token, so no Etsy key or OAuth token belongs in the browser command.

### 2C. Agent-operated catalog preview cache — deployed, live cache acceptance pending

- [x] Add migration `0008_etsy_catalog_previews.sql` with provider/listing-scoped preview blobs and mappings. Do not reuse `asset_manifests`, because it is Shopify-order scoped.
- [x] Add authenticated `POST /order-manager/v1/integrations/etsy/catalog-preview-sync`. It accepts up to 25 Etsy listing URLs/IDs or one bounded active-listings page, defaults to `dry_run`, and requires `execute: true` before any R2/D1 write.
- [x] Resolve listing ownership and variation-image IDs only through the existing server-side Etsy app-key boundary. A dry run returns only safe listing/variation IDs, labels, intended outcome, and redacted error codes.
- [x] On execute, download only Etsy's standard `url_570xN` raster rendition from the Etsy CDN; accept JPEG, PNG, or WebP only; enforce an 8 MiB limit; checksum-verify the private R2 object; deduplicate by bytes; and persist only opaque preview/blob IDs plus catalog selector metadata.
- [x] Add a separate 60-second signed read-ticket/read path for opaque catalog-preview IDs. It never exposes Etsy rendition URLs, R2 object keys, customer data, an Etsy write, or production-artwork authority.
- [x] Fixture-test dry-run non-mutation, execute, idempotent re-run without a second download, private R2 verification, opaque ticket access, unsigned-read rejection, and unchanged provider projection.
- [x] Apply migration `0008` and deploy the Worker with `--keep-vars`; then run one owner-approved dry run and explicit execute for a known listing before presenting a cached preview on a card.
- [ ] Add the chat-upload override endpoint using the reserved `printmo_override` / `replace` / `fallback` mapping vocabulary. Do not add a dashboard control or an Etsy write.
- [ ] Extend the provider card DTO and web client to resolve the selected opaque preview ID through the signed catalog-preview read path.

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
- **2026-08-11**: Deployed Worker `9cb099ba-73be-4a09-8e5f-17221f9ffc2b` with `--keep-vars`. It adds authenticated, catalog-only Etsy preview proof: an owner can list safe variation IDs/labels for an existing shop listing, then resolve the selected color's listing image metadata. No receipt, Etsy write, D1/provider projection, R2 object, board state, OAuth scope, or image bytes are changed; owner live acceptance remains pending.
- **2026-08-11**: Owner ran the deployed authenticated catalog proof against Etsy listing `4452232638`. Etsy returned four mapped color options (Black, White, Red, Green); the selected Black property/value pair (`200` / `49928889190`) resolved to listing image `7722005927`, `1080×1080`, with thumbnail, standard, and full renditions available. The response confirmed app-key catalog access under the existing `transactions_r` connection and unchanged board/R2/customer-data boundaries. This accepts catalog color-to-image mapping; a future receipt-backed probe still must validate transaction `listing_image_id` fidelity.
- **2026-08-11**: Implemented the next local preview-cache slice: migration `0008`, an authenticated URL/ID-driven Etsy catalog preview sync with safe dry-run default and explicit execute mode, private R2 checksum-verified/deduplicated image blobs, opaque selector mappings, and a separate signed read path. Phase 2 fixtures prove dry-run non-mutation, execute/idempotency, ticket authorization, and unchanged provider projections. No remote migration, deployment, R2 production write, Etsy write, board/card change, or custom override upload was performed.
- **2026-08-11**: Applied `0008_etsy_catalog_previews.sql` to the remote `printmo-order-manager` D1 database, verified no migrations remain, and deployed Worker `df313f05-6c94-478d-a82a-786a83a28cc4` with `--keep-vars`. Existing R2/D1 bindings, Etsy enrollment `0`, and reconciliation `1` were preserved. No preview-sync request, Etsy write, card/UI change, or production-artwork change was performed; the first authenticated dry run and owner-confirmed execute remain the acceptance gate.
- **2026-08-11**: The owner executed the first one-listing cache import for `4452232638`; all four direct color mappings were stored privately. Worker `37f7b54f-3437-491a-a6d7-e72cedf31fcf` and Pages release `1786503216834` now attach a catalog preview only when an Etsy line's selected variation and receipt `listing_image_id` both match that private mapping. `#ETSY-TEST-001` is intentionally updated on explicit re-save to model Black and Green purchase lines; its card uses the first line's recognition preview while both resolved preview IDs remain available in the provider payload. No Etsy write, real receipt enrollment, customer data, or production-artwork behavior is involved.
- **2026-08-11**: Fixed the Etsy catalog-preview detail gap and deployed Pages release `1786504817116`. Canonical detail hydration now retains each line's resolved catalog preview, and the existing read-only artwork browser presents the Black/Green recognition previews as switchable thumbnails. They remain distinct from uploaded design/production artwork.
- **2026-08-11**: Fixed a detail-hydration race observed in the synthetic acceptance check: the first card image could flash in the detail browser and disappear when the identity-only canonical detail line replaced its still-valid signed URL. Pages release `1786505306079` retains the board URL for the same opaque preview ID until a fresh ticket is available.
- **2026-08-11**: Deployed Worker `28682a92-8491-47b8-9dfd-ad61aa73e8b7` with a separately confirmed `full_receipt` synthetic scenario. It creates `#ETSY-TEST-RECEIPT-002` only inside the PrintMO provider projection: four imported color/size lines, fixed `.invalid` contact values, synthetic shipping/billing, shipping line, discount, note, timeline, and one synthetic personalization field. Phase 2 proves strict confirmation, detail projection, color-preview selection, and scenario-specific cleanup. It performs no Etsy API write and includes no real buyer data.
- **2026-08-11**: Strengthened the full synthetic scenario after review: Worker `a71999ad-c15b-4426-a257-e4513edb551b` now starts from Etsy-shaped Receipt and Transaction fixture objects and passes them through the same `normalizeEtsyOrderContract` routine used by webhook delivery and reconciliation. The synthetic-only contact/address/detail fields remain explicitly separate because live Etsy detail authorization and payload coverage have not been accepted. This proves receipt/transaction normalization and all downstream UI, but not a Portal-signed webhook delivery or the shape of a future live eligible receipt.
