# Context Router

> Human-readable fallback for targeted retrieval. The structured authority is [retrieval-manifest.json](retrieval-manifest.json).

## Preferred Lookup

```text
npm run repo -- route "<task, symptom, error, path, or symbol>"
```

The command ranks exact document sections, source symbols, registered tools, verification, and stop conditions. Use this table when browsing manually.

<!-- route:electron-ipc route:legacy-redis route:order-data-inventory route:order-detail-workbench route:kanban-ui route:shopify-data-plane route:etsy-integration route:blanks-batching route:web-shopify-port route:shopify-detail-scope-failure route:idempotency-key-rejection route:codex-browser-gpu-crash route:troubleshooting route:build-and-setup route:feature-progression route:candidate-cutover route:repository-tools route:documentation-system route:domain-language route:legacy-history -->

## Task and Symptom Routing

| Task, symptom, or focus | First section | Primary symbols/files | Tool / verification | Stop condition |
|---|---|---|---|---|
| Electron IPC, preload, OIDC, desktop initialization | [IPC bridge and Electron transport](architecture/ipc-and-storage.md#ipc-bridge-and-electron-transport) | `main.js → workerFetch, createWindow`; `preload.js → contextBridge.exposeInMainWorld` | `npm run repo -- verify phase1` | Authentication authority, secrets, or Worker trust-boundary change |
| Legacy Redis queue, Base64 assets, fallback behavior | [Legacy Redis boundary](architecture/ipc-and-storage.md#legacy-redis-boundary) | `worker.js → shopifyOrdersQueue`; `renderer.js → splitOrderAssets` | `npm run repo -- redis backup`; Phase 1 | Restore, deletion, or schema rewrite |
| Order data inventory, Shopify field availability, current-versus-potential visualization | [Order data visualization inventory](reference/order-data-visualization-inventory.md#purpose-and-status-vocabulary) | `worker.js → ORDER_SUMMARIES_QUERY, SHOPIFY_PREVIEW_ORDER_DETAIL_QUERY`; `web-shim.js → candidateOrderToBoard`; `renderer.js → makeCard, openDetail` | `npm run docs:check` | Stop before changing scopes, protected-customer-data use, summary payload size, or production authority |
| Order Detail redesign, digital traveler, artwork approval, gang-sheet state, readiness semantics, next action, or known detail integrity defects | [Order Detail Digital Traveler Redesign](future-plans/order-detail-digital-traveler-redesign-plan.md#current-continuation-state) | `renderer.js → openDetail, closeDetail`; `detail-overlay-enhancements.js → mergeCanonicalDetail, syncNotesContext`; `accessibility-hardening.js → focusableElements`; `worker.js → defaultProductionState` | Phase 2 plus focused behavioral checks; `npm run docs:check` | Stop before approving workflow semantics, migrating production schema, or changing source isolation without owner approval |
| Shared Kanban cards, drag/drop, detail opening | [Shared board render and mutation flow](workflows/order-ingestion-kanban.md#shared-board-render-and-mutation-flow) | `renderer.js → renderBoard, openDetail`; `web-shim.js → updateBoardMove` | Phase 2 | Canonical stage or source-isolation change |
| UI containers, card fields, modal overlays | [UI containers reference](reference/ui-containers-and-views.md#global-application-layout--top-level-containers) | `index.html`, `renderer.js`, `desktop.css`, `mobile.css` | Phase 2 plus representative viewport | Core production schema change |
| S&S SKU aggregation or batch state | [Batch submission and state update](workflows/blanks-batching.md#batch-submission--state-update) | `blanks-batches.js → saveBatchForOrders`; `worker.js → /order-manager/v1/batches/commit` | Phase 2 | Live supplier enablement or payload/auth changes |
| Embedded Shopify web, mobile iframe, Pages bundle | [Source-switched operational board](workflows/web-shopify-porting.md#source-switched-operational-board) | `web-shim.js`, `shopify-preview.js`, `shopify-embedded-mobile.js` | Phase 2; `npm run prepare:cloudflare` | CORS, scopes, or browser-visible secrets |
| Shopify detail says `404 - [object Object]` or `ACCESS_DENIED` | [Shopify live detail scope failure](runbooks/troubleshooting.md#shopify-live-detail-scope-failure) | `worker.js → fulfillmentOrders`; `web-shim.js → apiErrorMessage` | Phase 2 plus known live-order check | Scope changes require Shopify release and approval |
| Admin block says `A valid idempotency key is required` | [Admin-block idempotency rejection](runbooks/troubleshooting.md#admin-block-idempotency-key-rejection) | `production-client.mjs → idempotencyKey`; Worker validation | Proxy tests/build plus one live save | Extension fix requires Shopify app release |
| Codex Desktop exits when Browser or Chrome starts; log says `processType=GPU reason=crashed` then `reason=launch-failed` | [Codex Desktop Browser GPU crash and persistent cache recovery](runbooks/troubleshooting.md#i-codex-desktop-browser-gpu-crash-and-persistent-cache-recovery) | `%LOCALAPPDATA%\Codex\Logs`; `%APPDATA%\Codex\web\Codex` transient caches | Exact-log diagnosis, recoverable cache move, bounded Browser/Chrome health checks, `npm run docs:check` | Stop before deleting the full profile, cookies, sessions, or changing GPU/virtual-display drivers |
| Shopify production metadata, D1, R2, webhooks, reconciliation | [Data-plane ownership](architecture/shopify-primary-data-plane.md#ownership) | `worker.js`; migrations; Admin block | Phase 2 and proxy package tests | Cutover, permissions, live S&S, Redis retirement |
| Etsy Seller App OAuth, receipt proof, provider shadow, synthetic/shared-board pilot, production state, or Etsy webhooks | [Etsy integration continuation](future-plans/etsy-order-source-integration-plan.md#current-continuation-state); [webhook setup](runbooks/etsy-webhook-setup-and-verification.md#one-time-portal-and-secret-setup) | `worker.js → handleEtsyConnect, handleEtsyOauthCallback, handleEtsyShadowSync, handleEtsyWebhook, processEtsyWebhookDelivery, reconcileEtsyPaidReceipts, handleEtsyWebhookStatus`; migrations `0004–0007` | `node --check order-manager-proxy/worker.js`; Phase 2; proxy tests/build; invalid-signature live probe; docs check | The owner creates the Portal subscription and installs its secret; real-receipt enrollment, write scopes, automatic enrollment, and mixed-source supplier batches remain separately gated |
| Known runtime symptom or misleading error | [Diagnostic symptom matrix](runbooks/troubleshooting.md#diagnostic-symptom-matrix) | Exact error string through `npm run repo -- route` | Route-selected check | Do not mutate data before establishing the fault boundary |
| Development setup, build, packaging | [Development workflow commands](runbooks/dev-setup-and-build.md#development-workflow-commands) | `package.json`, build scripts | `npm run docs:check`; registered build tool | Packaging would introduce secrets |
| New proposal or meaningful partial feature work | [Feature lifecycle](future-plans/README.md#feature-lifecycle-stages) | Target plan; governance | `npm run docs:check` | Shipped invariant conflict or owner-gated external change |
| Migration, parity, candidate acceptance, cutover | [Migration](runbooks/shopify-candidate-cutover.md#migration) | migration/parity scripts; Worker flags | Registered migration/parity tools; Phase 2 | Owner approval gates |
| Existing script or reusable helper | [Registered commands](reference/tool-registry.md#registered-commands) | `scripts/repo-tool.js`; retrieval manifest | `npm run repo -- tools` | Do not promote one-off task artifacts |
| Living documentation, routing, promotion, governance | [System model](reference/living-documentation-system.md#system-model) | `AGENTS.md`; manifest; docs validator | `npm run docs:check` | Do not create task diaries or duplicate authorities |
| Confusing domain terms or identifiers | [Semantic boundaries](reference/domain-glossary.md#semantic-boundaries) | Glossary authority links | `npm run repo -- route "<term>"` | Verify historical terminology against current code |
| Historical or archived plans | [Legacy index](legacy/README.md#quarantined-files-index) | Explicit direct file access; legacy is ignored by default search | `rg --no-ignore` only when necessary | Never revive deprecated behavior without current verification |

## Retrieval Discipline

1. Start with one route.
2. Read the specified section, not the entire documentation tree.
3. Inspect named symbols rather than broad files where possible.
4. Use existing registered tools before creating helpers.
5. Run only the routed verification plus checks required by the actual blast radius.
6. Promote durable knowledge after verification; keep ordinary task detail local.
