# Code Source Map and Module Ownership

## Use This When

- You need to map a subsystem or responsibility to physical source files.
- You need stable functions, routes, selectors, or configuration keys to inspect.
- You are determining ownership across Electron, embedded web, Worker, migrations, extensions, and tooling.

## Skip This When

- You are selecting verification → read [test-map.md](test-map.md).
- You are auditing UI fields and containers → read [ui-containers-and-views.md](ui-containers-and-views.md).
- You already have an error, task, path, or symbol → run `npm run repo -- route "<signal>"`.

## Section Map

- [Electron Desktop](#electron-desktop)
- [Embedded Web Client](#embedded-web-client)
- [Cloudflare Worker and Shopify Extension](#cloudflare-worker-and-shopify-extension)
- [Repository Tooling](#repository-tooling)
- [Common Failure Modes & Recovery](#common-failure-modes--recovery)

## Electron Desktop

| Source | Ownership | Stable entry symbols |
|---|---|---|
| [main.js](../../../main.js) | Window lifecycle, public runtime config, OIDC-backed Worker transport, legacy IPC compatibility, authenticated asset download | `loadRuntimeConfig`, `workerFetch`, `mutate`, `ipcMain.handle`, `createWindow` |
| [preload.js](../../../preload.js) | Context-isolated renderer API | `contextBridge.exposeInMainWorld('api', ...)` |
| [desktop-auth.js](../../../desktop-auth.js) | Authorization Code + PKCE, token refresh, and secure refresh-token storage | `DesktopOidcAuth` |
| [renderer.js](../../../renderer.js) | Shared desktop Kanban rendering, card interactions, detail overlay, files, notes, bundles, and drag/drop | `renderBoard`, `openDetail`, `splitOrderAssets` |
| [index.html](../../../index.html) | Desktop shell, core containers, modal structure, and source script ordering | `.container`, `#detail-overlay`, Kanban columns |

Electron calls authenticated Worker endpoints. It does not directly own Redis or S&S credentials.

## Embedded Web Client

| Source | Ownership | Stable entry symbols/selectors |
|---|---|---|
| [index.html](../../../order-manager-web/index.html) | Shopify Admin/standalone shell and script ordering | App Bridge meta, `#orders-view` |
| [renderer.js](../../../order-manager-web/renderer.js) | Prepared/minified shared renderer for web deployment | `renderBoard`, `openDetail`, `splitOrderAssets` |
| [web-shim.js](../../../order-manager-web/web-shim.js) | Source-aware `window.api`, candidate DTO mapping, canonical mutations, private-asset tickets | `window.api`, `updateBoardMove` |
| [shopify-preview.js](../../../order-manager-web/shopify-preview.js) | Shopify-first source control, debug-only Legacy Redis switch, failure rollback, rich detail, production controls | `setPreviewActive`, `installLegacyDebugSourceControls` |
| [storage-browser.js](../../../order-manager-web/storage-browser.js) | Browser storage and endpoint adapter | storage-backed `window.api` methods |
| [blanks-batches.js](../../../order-manager-web/blanks-batches.js) | Blank-apparel selection, views, aggregation, and batch submission | `processBatch`, blanks view state |
| [shopify-embedded-mobile.js](../../../order-manager-web/shopify-embedded-mobile.js) | Fixed-shell mobile interaction and scroll containment | `installEmbeddedTouchContainment` |
| [desktop.css](../../../order-manager-web/desktop.css) | Desktop/embedded layout and visual system | desktop component selectors |
| [mobile.css](../../../order-manager-web/mobile.css) | Constrained/mobile layout, touch targets, and detail scroll ownership | mobile breakpoints, `#detail-content` |

## Cloudflare Worker and Shopify Extension

| Source | Ownership | Stable entry symbols/contracts |
|---|---|---|
| [worker.js](../../../order-manager-proxy/worker.js) | Authenticated BFF for Shopify commerce/production state, provider-aware Etsy OAuth/projection, D1, R2, signed webhooks, reconciliation, migration, supplier batch state, and isolated legacy routes | `/order-manager/v1/orders`, `/production`, `/webhooks/shopify`, `/webhooks/etsy`, `BOARD_NOT_INITIALIZED`, `VERSION_CONFLICT` |
| [0001_redis_free.sql](../../../order-manager-proxy/migrations/0001_redis_free.sql) | Core candidate D1 schema | `order_projection`, `mutation_requests`, `production_events`, `batches`, `asset_manifests`, `migration_ledger` |
| [0002_designer_asset_metadata.sql](../../../order-manager-proxy/migrations/0002_designer_asset_metadata.sql) | Designer Studio asset linkage | line item, design reference, role, side |
| [0007_etsy_webhook_delivery.sql](../../../order-manager-proxy/migrations/0007_etsy_webhook_delivery.sql) | PII-free Etsy webhook replay, processing, retry, and recovery ledger | `etsy_webhook_deliveries` |
| [shopify.app.toml](../../../order-manager-proxy/shopify.app.toml) | Shopify app identity, metafield definition, scopes, API version, webhook subscriptions | app-owned production metafield |
| [wrangler.jsonc](../../../order-manager-proxy/wrangler.jsonc) | Worker, D1, R2, Durable Object, cron, and pre-cutover bindings | `ORDER_DB`, `R2_BUCKET`, `PREVIEWS` |
| [production-client.mjs](../../../order-manager-proxy/extensions/printmo-production-status/src/production-client.mjs) | Shared Admin-block normalization, minimal patching, endpoint, auth, and error helpers | production-client exports |
| `order-manager-proxy/extensions/printmo-production-status/` | Shopify Admin order-details production block | canonical production read/edit UI |

## Repository Tooling

| Source | Ownership | Registered interface |
|---|---|---|
| [repo-tool.js](../../../scripts/repo-tool.js) | Parent command, route lookup, tool discovery, safe delegation | `npm run repo -- --help` |
| [check-docs.js](../../../scripts/check-docs.js) | Documentation contracts, plan states, links, routes, tools, source-range validation | `npm run docs:check` |
| [verify-phase1.js](../../../scripts/verify-phase1.js) | Authentication, secret isolation, and legacy transport verification | `npm run repo -- verify phase1` |
| [verify-phase2.js](../../../scripts/verify-phase2.js) | Candidate architecture and regression verification | `npm run repo -- verify phase2` |
| [backup-redis-queue.js](../../../scripts/backup-redis-queue.js) | Checksummed legacy queue backup and redacted fixtures | `npm run repo -- redis backup` |
| [run-shadow-migration.js](../../../scripts/run-shadow-migration.js) | Bounded dry-run/execute migration client | `npm run repo -- migration ...` |
| [run-parity-check.js](../../../scripts/run-parity-check.js) | PII-redacted parity report | `npm run repo -- parity check` |
| [create-desktop-config.js](../../../scripts/create-desktop-config.js) | Ignored public Electron runtime configuration | `npm run repo -- build desktop-config` |
| [prepare-cloudflare-pages-upload.sh](../../../scripts/prepare-cloudflare-pages-upload.sh) | Cloudflare Pages upload artifact | `npm run repo -- build cloudflare` |
| [package.json](../../../package.json) | Package commands and Electron Builder configuration | `npm run` |

See [tool-registry.md](tool-registry.md) for mutation mode, prerequisites, output, and safety.

## Common Failure Modes & Recovery

| Failure | Cause | Recovery |
|---|---|---|
| Source map points to the wrong code after refactoring | Numeric lines or copied ownership text drifted | Update stable symbols/routes and run `npm run docs:check`. |
| A source file appears in several ownership rows | One file crosses multiple boundaries | Name the specific symbols or routes rather than duplicating a broad description. |
| A reusable script is absent | Tool promotion was incomplete | Register it in the parent command, retrieval manifest, and tool registry. |
| Web renderer is difficult to inspect | Deployed web renderer is prepared/minified | Inspect the shared desktop source and relevant adapters, then verify the prepared artifact contract. |
