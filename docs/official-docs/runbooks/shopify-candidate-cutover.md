# Shopify Candidate Verification and Cutover Runbook

## Use This When

- Deploying or verifying the Redis-free Shopify board.
- Migrating legacy production state/assets.
- Deciding whether the legacy Redis board can be retired.

## 1. Build and Contract Checks

Run:

```text
node --check order-manager-proxy/worker.js
node --check order-manager-web/web-shim.js
node --check order-manager-web/shopify-preview.js
npm run verify:phase2
cd order-manager-proxy && npm test && npm run build
npx wrangler deploy --dry-run
```

The Render repository must also pass `npm test`.

## 2. Infrastructure Checks

1. Confirm `ORDER_DB` resolves to the production D1 database.
2. Apply all remote migrations.
3. Record the current D1 Time Travel bookmark.
4. Confirm `R2_BUCKET` resolves to the private artwork bucket.
5. Confirm `PREVIEWS` resolves to the Designer Studio source bucket and remote migration `0002_designer_asset_metadata.sql` is applied before deploying Worker code that selects its columns.
6. Keep `SS_TEST_ORDER=1`.
7. Confirm the stateless supplier gateway deployment contains `/order-manager/v1/supplier/ss/commit`.

## 3. Shopify Release Gate

Release `shopify.app.toml` and approve the permission update on the real **Print-MO** store. Required candidate scopes include `write_orders` and `read_all_orders` in addition to the already justified read scopes.

Do not run canonical migration writes before the installed app has the new scopes and app-owned metafield definition.

## 4. Migration

1. Preserve the existing Redis export and checksums.
2. Enable `MIGRATION_UPSTREAM_ENABLED=1`.
3. Dry-run in small pages.
4. Execute approved pages with exact `confirmShop`.
5. Confirm every approved order is `verified` in `migration_ledger`.
6. Keep order `#1000` quarantined unless the owner changes that decision.
7. For assets, require matching source/R2 SHA-256 and an active `asset_manifests` row.
8. Disable the migration bridge after the final delta.

Never use `overwriteChangedOrders` unless the owner explicitly approves replacing candidate edits made after migration began.

### 2026-07-24 one-time position catch-up

The owner approved a one-time canonical position catch-up from
`backups/shopifyOrdersQueue-backup-2026-07-22T15-51-42-430Z.json`
(SHA-256 `22f099ad077d6a66f2aabf0ccf08ff18aa97faa764787cdb79368e0b77c3aaea`).
Only the 19 explicitly projected order numbers are eligible. The job restores stage,
readiness, and printed count while preserving current Shopify-only bundle, notes,
batch references, attention, archive, commerce, and asset data. Orders absent from the
approved projection—including newer orders—are untouched; owner-quarantined `#1000`
and unmatched legacy `#1174` are not in the projection.

The Worker checkpoint is
`redis-position-catchup-2026-07-22T15-51-42-430Z`. The scheduled job is idempotent:
it retries incomplete work, records each match in `migration_ledger` under
`redis-position-catchup`, writes the source checksum on completion, and becomes a
no-op after `last_completed_at` is present. It never writes the Redis queue.

Expected canonical result for the 19 approved records:

- 2 `received`
- 7 `blanks_ordered`
- 2 `blanks_cart`
- 8 `print`

Verification is read-only:

```powershell
npx wrangler d1 execute printmo-order-manager --remote --command "SELECT checkpoint, last_completed_at, last_result_json FROM reconciliation_checkpoints WHERE name = 'redis-position-catchup-2026-07-22T15-51-42-430Z';"
```

Require the recorded checksum, `matched: 19`, `quarantined: 0`, and an empty
`errors` array before treating the catch-up as verified.

## 5. Acceptance

Verify:

- the Shopify board displays the expected non-empty set;
- the Redis board is unchanged when candidate stage/notes/readiness/bundle/progress change;
- the Admin block and Shopify board converge on the same revision;
- simultaneous edits yield one success and one `409`;
- a repeated idempotency key returns the stored result;
- the Admin block fallback key saves when `randomUUID` is unavailable and never embeds a Shopify GID;
- the `designer-studio-assets-v1` checkpoint reports zero failures and active Designer Studio orders display ticket-hydrated private mockups;
- a confirmed S&S test batch creates one supplier order and advances selected orders;
- an ambiguous S&S result is `unknown` and cannot be resent;
- invalid/missing D1 does not render an authoritative empty board;
- private artwork requires a valid short-lived ticket.

## 6. Security Hardening Gate

Before owner go/no-go:

1. Restrict CORS to exact production and explicitly approved staging origins.
2. Set a response-header CSP with Shopify Admin `frame-ancestors`; tighten script sources and remove `'unsafe-inline'` where feasible.
3. Apply Worker and supplier-gateway rate limits by verified identity and sensitive route.
4. Configure dedicated cursor/asset-ticket signing secrets, constant-time verification, and a rotation procedure.
5. Alert on elevated `401`/`403`/`5xx`, D1 failures, failed webhook receipts, `SYNC_PENDING`, reconciliation errors, and `unknown` S&S batches.
6. Verify logs contain no bearer tokens, signed URLs, addresses, contacts, payment details, production notes, or asset bytes.
7. Confirm Cloudflare, Shopify, Render, and GitHub operator accounts use MFA and least-privilege access.

Do not describe these controls as active until their configuration and verification evidence exist.

## 7. Cutover

Cutover requires owner go/no-go.

1. Pause legacy edits briefly.
2. Capture and verify the final Redis delta.
3. Make the Shopify board the default.
4. Set `LEGACY_INGEST_ENABLED=0`.
5. Set `MIGRATION_UPSTREAM_ENABLED=0`.
6. Smoke-test board, block, detail, assets, and S&S test mode.
7. Prove candidate operation with Redis unavailable.
8. Retain the dated Redis export only for the approved retention period.

Do not delete Redis or enable live S&S ordering as part of the same unobserved change.

## Recovery

- D1 failure before a mutation: keep the UI read-only.
- Shopify commit with D1 pending: retry the same idempotency key or run reconciliation.
- Projection loss: rebuild from Shopify metafields and commerce reads.
- Confirmed supplier order with metadata repair list: do not resubmit; run integrity reconciliation.
- D1 corruption: use Time Travel/export, then rebuild projections from Shopify.
