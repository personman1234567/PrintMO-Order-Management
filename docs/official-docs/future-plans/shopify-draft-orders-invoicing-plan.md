# Shopify Draft Artwork Preparation

- **Status**: `[Implemented Candidate]`
- **Owner / Target Milestone**: `TJ / Draft artwork release after permissions and migration`

## Summary & Intent

Prepare mockups and PNG/SVG print files before a Shopify draft is purchased. The embedded Order Pipeline has an **Orders / Draft Orders** toggle and draft tiles for saved drafts, emailed invoices, and converted drafts. Operators select the exact garment line items (including every applicable size) and a placement for each upload. Shopify remains the quote, invoice, customer, and payment authority.

The September 30 owner decisions supersede the broader July invoicing-engine proposal: this release does not create quotes, send invoices, write draft commerce, or introduce separate credentials or customer-management permissions.

## Current Continuation State

- **Current state**: Live and enabled since 2026-09-30; browsing refinement and bulk list optimization released on 2026-10-01. Production D1 migration 0012 remains applied; Worker `02724e16-34b5-4a4a-987f-a83abf607a02`; Pages marker `1790876574885`; existing Shopify release `draft-artwork-2026-09-30` includes draft create/update/delete notifications.
- **Next safe action**: Owner hands-on review of the refined draft browsing area; live artwork/payment/conversion acceptance remains separate.
- **Remaining blockers**: Live artwork upload/payment/conversion and changed/duplicate-garment acceptance remain unverified. Release blockers are cleared.
- **Owner / external actions**: Owner authorized the October 1 browsing/loading implementation and release; no additional scopes, migrations, or Shopify configuration release were required.
- **Last verified evidence**: Worker optimization deployed before Pages; production marker and draft JS/CSS hashes match the prepared bundle. Actual `DRAFT_ORDERS_ENABLED=1`, `SS_TEST_ORDER=1`, and existing integration flags verified. All 15 focused draft tests, proxy checks/build, Phase 1/2, documentation checks, and Worker dry-run passed. Synthetic browser checks cover 320px/393px and desktop layout, square/wide/slow/failed previews, four-request concurrency, stale results, retained refresh/pagination, and detail/tab continuity. No live purchase acceptance claimed.
- **Recovery evidence**: Pre-migration D1 bookmark `00004566-00000576-000050f6-6cace2ff8544d964dedc6c9a60ffd1b3`; first disabled Worker release `ab11ca21-e490-4ab1-ba44-ed8fdbdbdf2b`; deployments used `--keep-vars`. Shopify release: https://dev.shopify.com/dashboard/102036845/apps/305079713793/versions/1150423072769.

## Open Questions & Brainstorming

- Verify real saved drafts and invoice-sent drafts return the expected display name, address-name/email fallback, garment attributes, and presentment currency under the installed app's current customer-data approval. The query omits the customer relation and full addresses.
- Confirm draft-to-order line identity with real custom items and personalized attributes. Any ambiguous association stays unassigned for operator review; duplicate SKUs never justify guessing.
- Retention policy for deleted drafts and removed private artwork remains a later owner decision. This feature preserves bytes and records, with no destructive cleanup job.
- A separate quoting/invoicing product, if wanted later, needs a new scoped design and permission review.

## Technical Specification & Task Checklist

### Experience

- [x] Nested Draft Orders toggle, matching tile layout, status filters, search, cursor pagination, explicit permission/loading/error/empty states.
- [x] Compact two-row browse controls and responsive tiles: optional uncropped 16:9 mockup frame, shorter no-mockup tiles, positive artwork counts, conversion references and sync warnings.
- [x] Summaries render independently of previews. The draft scroller observes nearby tiles, uses the existing private URL cache, and limits tile preview requests to four. Static skeletons cover initial/search/filter loading; refresh failures retain results and cursors, and appended pages preserve existing tiles.
- [x] Draft detail in the pipeline scroll area; keyboard tab navigation and focus restoration; responsive controls and an accessible in-app artwork preview.
- [x] Explicit garment selections and named placements: front, back, left/right chest, left/right sleeve, other. Upload one or multiple files using one selected assignment; reassign each attachment afterward.
- [x] Print exports: PNG/SVG. Mockups: PNG/JPG/WebP. Maximum 50 MB per file and 100 active files per draft.
- [x] Converted drafts retain previews and allow assignment repair against the purchased order's current items. New uploads/removal happen through the normal purchased-order workflow.
- [x] Purchased-order detail keeps exact mockup associations, displays placement labels on draft artwork, and exposes an explicit reassignment warning when needed.

### Ownership and handoff

- Shopify owns draft status, invoice state, commerce, and the resulting `DraftOrder.order` relationship. Only `read_draft_orders` is added to the existing app scopes; no `write_draft_orders` or `read_customers` scope is added. See Shopify's [DraftOrder reference](https://shopify.dev/docs/api/admin-graphql/latest/objects/DraftOrder) and [draftOrders search/pagination reference](https://shopify.dev/docs/api/admin-graphql/latest/queries/draftOrders).
- D1 stores draft projections, file manifests, immutable item snapshots, assignment revisions, conversion progress, and operator audit events. R2 stores private file bytes. No draft or production writes use Redis.
- List requests retain Shopify's 25-draft newest-updated cursor query and response contract. Each nonempty page resolves its shop once, batches timestamp-guarded projection upserts, and reads active artwork metadata in one shop-scoped query ordered by creation time and asset ID. Detail/upload/conversion operations retain their existing paths.
- Authenticated `/order-manager/v1/drafts` routes use the existing partner identity boundary. Private previews reuse short-lived asset tickets; SVG responses retain sandbox and `nosniff` protections. Object keys never appear in draft DTOs.
- Upload IDs plus file checksums make retries reuse one asset identity and byte object. Assignment/removal require an expected revision. A removal that loses the conversion race cannot remove purchased artwork.
- On conversion, the same asset ID and R2 object are linked into the existing order manifest/link tables. All selected items must match uniquely by SKU, title, variant title, and all custom attributes. Within the same item kind, matching IDs are preferred only when that identity still matches. If any selection is ambiguous, the file transfers with `needs_review` and no guessed garment links.
- Draft create/update/delete webhooks use the existing raw-body HMAC/shop boundary. Draft IDs never become Order IDs or production projection records. Failed draft deliveries can be retried; repeated successful deliveries are deduplicated.
- `orders/paid` can repair known draft relationships or a matching draft in a bounded recent-conversion page. The existing five-minute cron rotates through 20 prepared drafts per run to recover missed/late delivery or interrupted promotion. Large backlogs may require multiple cron runs; handoff is eventual, not a promise of instantaneous delivery.
- Conversion only attaches files. Existing paid-order eligibility, canonical production state, and intake gates remain authoritative.

### Source boundaries

- `order-manager-proxy/draft-orders.mjs`: queries, uploads, assignment validation, promotion, reconciliation.
- `order-manager-proxy/worker.js`: authenticated routing, shared asset tickets, draft webhook handling and paid/cron repair.
- `order-manager-proxy/migrations/0012_draft_artwork.sql`: draft records and additional order-link placement/review fields.
- `order-manager-web/draft-orders.js`, `draft-orders.css`, `index.html`: embedded draft workspace.
- `order-manager-web/web-shim.js`: authenticated browser API adapter; root `renderer.js` and `detail-overlay-enhancements.js`: purchased-order artwork labels and exact associations.
- `order-manager-proxy/draft-orders.test.mjs`: service and Worker boundary tests included in proxy `npm test`.
- The root renderer remains readable authority. Pages preparation copies it into the output bundle; the optimized tracked web fallback is preserved. The Electron shell is not extended by this embedded-web feature.

### Release and acceptance

1. Run `npm run verify:phase2`, `cd order-manager-proxy && npm test`, `npm run docs:check`, and `npm run prepare:cloudflare`. Complete the existing Shopify app build and Wrangler dry-run release checks where those CLIs are available.
2. Apply D1 migration `0012_draft_artwork.sql` before deploying the Worker: the shared order-detail asset query now selects its added columns even while the feature flag is off. Use the registered cutover/release procedures in [Shopify candidate cutover](../runbooks/shopify-candidate-cutover.md).
3. Release `shopify.app.toml` with `read_draft_orders` and the `draft_orders/create`, `draft_orders/update`, and `draft_orders/delete` subscriptions. Approve the installed app's permission update and verify the grant; editing TOML alone does not grant access.
4. Deploy the Worker with the flag off first, then explicitly enable `DRAFT_ORDERS_ENABLED=1` after scope and migration verification. `keep_vars` is enabled: verify the actual deployed flag rather than assuming a local config edit changes it.
5. Publish the prepared Pages bundle through the registered production deployment command and verify its served release marker.
6. Prepare a real test draft with mockups and PNG/SVG print files assigned to several sizes and placements. Send the invoice in Shopify. Buy/pay the draft and confirm exactly one retained asset per upload, the correct purchased garment links, normal paid intake, and unchanged production readiness.
7. Repeat with a changed garment and duplicate custom items: files remain visible and flagged; manual reassignment repairs the links. Verify invalid auth, scope failure, deleted draft, retry, and mobile preview/upload behavior.
8. Verify source switching, ordinary Shopify orders, and existing manual artwork behavior. Graduate stable verified facts into current docs only after live acceptance.

- [x] Remote migration and permission approval.
- [x] Worker Wrangler dry-run compilation and Pages bundle preparation.
- [x] Shopify app build and live Worker/Pages/configuration releases.
- [ ] Real draft invoice/payment handoff and desktop/mobile acceptance.

## Progress Log

- **2026-07-21**: A broader quote/invoicing engine was proposed. Its separate-token, customer-creation, fee-builder, invoice-send, and production-init assumptions are superseded by this preparation-only scope.
- **2026-09-30**: Owner approved implementation of a nested draft tile view, explicit garment/placement assignments, mockups and PNG/SVG print exports, with invoices managed in Shopify. Implemented the authenticated D1/R2 preparation and order handoff candidate, with focused tests and a local Pages preview; live activation remains pending.

- **2026-09-30 release**: Owner authorized production deployment. Migration, Worker/Pages and Shopify notification configuration released successfully. Owner will test; further agent checks stopped at their request.
