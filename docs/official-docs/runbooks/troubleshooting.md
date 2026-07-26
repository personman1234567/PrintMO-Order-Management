# Troubleshooting & Environmental Traps Runbook

## Use This When
- You encounter a runtime error, UI freeze, failed IPC message, or Redis sync anomaly.
- You need a symptom-to-boundary lookup path to diagnose recurring issues instantly without re-debugging.

## Skip This When
- You are setting up your development environment from scratch → read [Developer setup and build](dev-setup-and-build.md).
- You are reviewing system architecture contracts → read [System overview](../architecture/system-overview.md).

## Section Map
- [Diagnostic Symptom Matrix](#diagnostic-symptom-matrix)
- [Detailed Troubleshooting & Recovery Procedures](#detailed-troubleshooting--recovery-procedures)
- [Codex Desktop Browser GPU Crash and Persistent Cache Recovery](#i-codex-desktop-browser-gpu-crash-and-persistent-cache-recovery)
- [Common Failure Modes & Recovery](#common-failure-modes--recovery)

---

## Diagnostic Symptom Matrix

| Observed Symptom | Primary Fault Boundary | Target Code Location | Primary Action / Recovery |
|---|---|---|---|
| Large legacy attachments cause slow board load or adapter timeouts | Base64 payload size bloat in legacy Redis list items | `renderer.js` file handling; authenticated legacy adapter | Capture a checksummed backup, measure payload size safely, and require owner approval before repairing source records. |
| Dragged card resets position after drop | Candidate canonical write failed/conflicted, or legacy adapter mutation failed | `web-shim.js:updateBoardMove`; legacy mutation route | Identify the active source first. Preserve candidate rollback/conflict handling; diagnose legacy transport by stable order identity. |
| Web client error: `window.api is undefined` | Web shim loading order mismatch | `order-manager-web/web-shim.js`, `order-manager-web/index.html` | Verify `web-shim.js` is loaded prior to `renderer.js` script tag. |
| Redis board shows zero cards while bundle tiles remain; console says `(assets || []).forEach is not a function` | A legacy line item contains a non-array `assets` value, causing card rendering to stop mid-board | `renderer.js:splitOrderAssets`, `order-manager-web/renderer.js:splitOrderAssets` | Confirm queue length read-only before any restore. Current renderers ignore malformed asset containers and continue rendering; inspect and repair the source record separately only if its missing artwork is operationally important. |
| Shopify detail error: `404 - [object Object]` | Historical symptom of denied `fulfillmentOrders` access or another structured upstream error being rendered poorly | `order-manager-proxy/worker.js`, `order-manager-web/web-shim.js`, `order-manager-proxy/shopify.app.toml` | Do not assume the order is missing. Follow Procedure C and compare the installed scopes with the currently released app version. |
| Shopify detail customer fields say `Not returned` | Guest checkout or unapproved protected customer fields | `order-manager-proxy/worker.js`, Shopify app API access requests | Compare with Shopify Admin, then follow Procedure D before changing requested PII. |
| Shopify board switch reports `503 - [object Object]` | The D1 projection has no migration/bootstrap checkpoint, and an older web bundle failed to render the structured Worker error | `handleV1OrdersGet`, `bootstrapInitialBoard`, `order-manager-web/web-shim.js:apiErrorMessage` | Deploy the current Worker and Pages bundle. The first candidate read performs a bounded paid/open Shopify bootstrap; if that read fails, the UI now shows `BOARD_NOT_INITIALIZED` with a request ID instead of a false empty board. |
| Shopify board selector activates but the workspace is completely blank | Obsolete diagnostic-preview CSS hides `#orders-view` while the source controller also hides the retired preview table | `order-manager-web/shopify-preview.css`, `shopify-preview.js:setPreviewActive` | The shared Kanban must remain visible for both sources. Do not add a `body[data-order-source="shopify"] #orders-view { display: none }` rule; `npm run verify:phase2` enforces this regression contract. |
| Clicking a Shopify-board card does nothing and no detail overlay appears | Shared `openDetail()` unconditionally wires a desktop-only DOM control that the Shopify web detail intentionally omits | `renderer.js:openDetail`, optional `#detail-files-btn`, generated `order-manager-web/renderer.js` | Check the first console exception before investigating data. Keep the aggregate Files button optional, regenerate the web renderer, run `npm run verify:phase2`, and deploy Pages. Do not add a duplicate hidden button merely to satisfy the shared renderer. |
| Admin order block says `A valid idempotency key is required` | A fallback mutation key embedded a Shopify GID, whose `/` separators are rejected by the Worker | `production-client.mjs:idempotencyKey`, `handleV1ProductionPatch` | Deploy/release the current extension. Fallback keys must match `^[A-Za-z0-9._:-]{8,200}$` and must not contain the GID. Run the Admin-block test before release. |
| Designer Studio orders show blank placeholders or `Missing files`, while manual mockups work | Shopify summary omitted line-item design properties, the purchased object was promoted from `previews/...` to `orders/...`, or the D1/private-R2 import is incomplete | `ORDER_SUMMARIES_QUERY`, `syncDesignerStudioAssetsForSummary`, `asset_manifests`, `web-shim.js:candidateAssetObjectUrl` | Follow Procedure G. Do not restore Redis or persist the public preview URL as the candidate source. |
| Shopify guest checkouts appear as `Name unavailable` even though Shopify Admin shows a recipient | Candidate summary contains a null `customer`, or D1 still has the pre-fallback snapshot | `ORDER_SUMMARIES_QUERY`, `normalizeShopifySummary`, `handleV1OrdersGet`, `web-shim.js:candidateOrderToBoard` | Press **Refresh Shopify** once. The current projection falls back customer → shipping → billing name and `refresh=1` bypasses the short TTL. If still absent, Shopify did not return an approved name field. |
| **Ordered** cannot be selected, or In Cart and Ordered show identical cards | The segmented control has CSS but no source-aware view/filter controller | `blanks-batches.js:setActiveBlanksView`, `renderStatusColumn` wrapper | Verify the current Pages bundle wires click and arrow-key activation and filters only Shopify `blanks` cards by `blanksOrdered`. This is a view change, not a metadata mutation. |
| A card dropped while **Ordered** is selected always returns to **In S&S Cart** | The drop mapper ignored the active blanks view and defaulted `blanksOrdered` to `0` | `blanks-batches.js:blanksOrderedValueForActiveView`, `movePatchForDropTarget` | Keep the selected-view bridge installed. A section drop must emit `blanksOrdered: 1` in Ordered and `0` in In S&S Cart; the resulting stage is persisted atomically with the move. |
| Shopify board positions reset after changing from Redis to Shopify canonical state | The D1/Shopify projection was enrolled without importing the legacy operational position | `restoreLegacySnapshotPositions`, `migration_ledger`, `reconciliation_checkpoints` | Do not mutate Redis or infer positions from card order. Use only the owner-approved dated backup/checksum and exact projected order numbers. Preserve current Shopify-only fields, exclude absent/new orders, and require the catch-up checkpoint plus ledger evidence before declaring success. |
| Shopify drag/drop reports `VERSION_CONFLICT`, feels delayed, then appears after refresh | Separate stage/readiness writes raced, or another client advanced the canonical revision | `web-shim.js:updateBoardMove`, `candidateMutationChains`, `blanks-batches.js:applyOptimisticOrderUpdate` | Keep the move atomic, serialized per order, optimistic, and rollback-safe. The Worker must include current revision/state in conflict details; the client reconciles and retries once only. |
| Production cards render as tiny slivers, a lone card stretches across the section, or pipeline footer values clip | CSS expects semantic `production-card`/`pipeline-main-card` classes that the generated card did not receive, compounded by inherited one-third width or an `auto-fit` grid that expands a lone card | `dashboard-triage-enhancements.js:decorateCard`, `desktop.css`, `mobile.css` | Confirm Shopify cards receive the semantic class before changing grid math. Candidate production grids use `auto-fill` at desktop widths so one card retains the normal two-column width; phone production cards use one column. Do not un-scope the repair onto Legacy Redis. |
| Mobile detail opens but cannot scroll | Fixed-shell touch containment selects no inner vertical scroll owner | `shopify-embedded-mobile.js:installEmbeddedTouchContainment`, `mobile.css` detail repair layer | Preserve `#detail-content` as the touch owner and scrollable flex child; suppress page bounce only at its boundaries. |
| Packaged desktop app fails before loading orders | Public OIDC config, sign-in, or authenticated Worker connectivity failed | `main.js:loadRuntimeConfig`, `DesktopOidcAuth`, `main.js:workerFetch` | Verify public runtime config and identity/Worker reachability. Never copy `.env` or infrastructure secrets into the package. |
| Codex Desktop closes, hangs, or must be reinstalled after an agent starts Browser or Chrome; its log ends with `Recoverable Chromium child process gone ... processType=GPU reason=crashed` followed by `reason=launch-failed` | Codex Desktop's Chromium GPU process and persistent browser/shader caches, not the PrintMO Electron runtime | `%LOCALAPPDATA%\Codex\Logs`; `%APPDATA%\Codex\web\Codex` | Stop browser retries and follow Procedure I. A normal app reinstall preserves this roaming browser profile. Move only the listed transient caches to a timestamped backup while Codex is fully closed, then verify a fresh in-app Browser load and Chrome connection. |
| S&S batch submission returns 401 Unauthorized | Supplier-gateway credentials or Worker-to-gateway authentication failed | Worker batch route and stateless supplier gateway | Inspect server-side gateway configuration and request IDs. No S&S credential belongs in Electron or the browser. |

---

## Detailed Troubleshooting & Recovery Procedures

### A. Diagnosing Base64 Attachment Bloat
- **Trap**: Uploading high-resolution PNG mockups encodes raw image files as multi-megabyte Base64 strings embedded directly inside `shopifyOrdersQueue` JSON objects.
- **Symptom**: Authenticated legacy queue reads stall; UI rendering is delayed.
- **Recovery**:
  1. Run `npm run repo -- redis backup` and preserve the printed checksum.
  2. Inspect attachment manifest sizes without logging customer data or Base64 bytes.
  3. Confirm client-side image downscaling before `window.api.addFile`.
  4. Treat source-record deletion or replacement as a separate owner-approved repair; do not mutate Redis merely because the UI is slow.

### B. Source-Aware Card Mutation Failure

- **Trap**: Diagnosing every reverted card as a Redis index problem ignores the active board source and current transport architecture.
- **Candidate diagnosis**: Inspect the structured canonical response. Preserve optimistic local rollback, per-order serialization, expected revision, and one bounded `VERSION_CONFLICT` reconciliation.
- **Legacy diagnosis**: Confirm the client used the authenticated legacy route and supplied stable order/bundle identity. Only the Render adapter owns Redis mutation details.
- **Recovery**:
  1. Confirm whether **Legacy Redis** or **Shopify board** is active.
  2. Inspect the first structured transport/canonical error.
  3. Re-fetch only after the failed mutation has been classified.
  4. Never introduce direct Redis IPC or client-side list-index mutation as a repair.

### Shopify Live Detail Scope Failure

- **Observed symptom**: The Shopify list loads, but clicking a known order opens an empty read-only dialog with `Shopify order details could not load: 404 - [object Object]`; DevTools shows the detail GET returning 404.
- **Actual upstream result**: Shopify returns HTTP 200, `data.order: null`, and `ACCESS_DENIED` at GraphQL path `order.fulfillmentOrders`. The order still exists.
- **Why the displayed error is misleading**: The Worker treats every null order as `ORDER_NOT_FOUND`; `web-shim.js` then converts the nested `{ error: { code, message, requestId } }` body to `[object Object]`.
- **Current live authorization**: The required fulfillment-order scopes were released and approved on 2026-07-23, and rich detail was verified live. If this symptom returns, first confirm that the request is using the production `Print-MO` installation and that its approved scopes still match the released app version.
- **Recovery choices**:
  1. Permission route: add the minimum fulfillment-order read scopes, release a Shopify app version, and approve the updated permissions on the production store installation.
  2. Code route: preserve Shopify's partial GraphQL errors and render the structured message clearly if another optional field is denied.
- **Verification**: After a scope release, retry a recent known order and confirm the GraphQL operation returns a non-null order. A Worker/Pages redeploy by itself cannot update installed Shopify permissions.

### D. Protected Customer Data Redaction

- Shopify order/customer/shipping data is protected customer data; name, address, phone, and email are protected fields requested individually.
- Unapproved fields can return null plus GraphQL errors while approved order fields remain available.
- Confirm the field exists in Shopify Admin before assuming a permission issue. Request only operationally necessary fields through the app's API access requests and keep the Redis board available during approval.
- Reference: [Shopify protected customer data](https://shopify.dev/docs/apps/launch/protected-customer-data).

### Empty Redis Board Caused by Malformed Line-Item Assets

- **Observed symptom**: Board counts/cards fall to zero or rendering stops, while a bundle tile may already be visible and Redis still contains orders. DevTools reports `TypeError: (assets || []).forEach is not a function` from `splitOrderAssets`.
- **Meaning**: This is a client rendering failure, not proof of queue deletion. One line item's `assets` field is present but is not an array (for example `{}`).
- **Safe diagnosis**: Check `LLEN shopifyOrdersQueue`, JSON parse success, status counts, and `Array.isArray(item.assets)` without logging customer details, attachment payloads, credentials, or full orders. Do not restore a backup merely because the board is blank.
- **Shipped behavior**: Desktop and embedded-web renderers normalize non-array line-item asset containers to an empty list. The affected card remains usable but cannot show artwork from that malformed field; other cards continue rendering.
- **2026-07-22 incident**: All 21 queue records were intact and parseable. One item on order `#1558` contained `assets: {}`. No Redis mutation or restore was required.

### Admin Block Idempotency-Key Rejection

- **Observed symptom**: The order block loads current production data, but save shows `A valid idempotency key is required`.
- **Cause**: Shopify UI extensions do not guarantee `crypto.randomUUID()`. The retired fallback used `${gid}:${timestamp}:...`; Shopify GIDs contain `/`, while the Worker intentionally accepts only letters, digits, `.`, `_`, `:`, and `-`.
- **Invariant**: Generate the key independently of the order identifier. The current extension uses `admin:<base36 timestamp>:<random hex>` when UUID generation is unavailable. Board/detail/batch fallbacks follow the same rule.
- **Verification**:
  1. Run `cd order-manager-proxy && npm test`.
  2. Confirm the fallback-key fixture matches `^[A-Za-z0-9._:-]{8,200}$` and contains no `/`.
  3. Release the Shopify app extension; a Worker/Pages deploy alone does not replace Admin-block JavaScript.
  4. Save one changed field, refresh, and confirm the revision increases exactly once.

### G. Designer Studio Asset Import and Backfill

- **Expected source properties**: `_designref` or `_design_ref`, plus `design_preview_url` or `design-preview-url`.
- **Expected path**: HTTPS URL whose path is `previews/YYYY-MM-DD/<designRef>/<file>`. The Worker uses only the validated path with its `PREVIEWS` R2 binding; it never server-fetches the supplied hostname.
- **Promotion behavior**: A purchased design may no longer exist at the preview key. Resolution then lists at most five 1,000-object pages under `orders/<orderNumber>_` and requires one exact `/<designRef>/<file>` suffix match. Zero matches remain unresolved; multiple matches are rejected as ambiguous.
- **Canonical result**: Private `R2_BUCKET` bytes, matching source/destination SHA-256, and an active `asset_manifests` row with `created_by='designer-studio-sync'`. Board responses expose the manifest ID/metadata, not `object_key`.
- **Backfill evidence** (run from `order-manager-proxy/`):

```text
npx wrangler d1 execute printmo-order-manager --remote --command "SELECT checkpoint,last_result_json FROM reconciliation_checkpoints WHERE name='designer-studio-assets-v1';"
npx wrangler d1 execute printmo-order-manager --remote --command "SELECT order_gid,filename,role,side,line_item_id,design_ref,state FROM asset_manifests WHERE created_by='designer-studio-sync' ORDER BY order_gid,filename;"
```

- **Recovery**:
  1. If the checkpoint is absent, inspect Worker logs for `DESIGNER_ASSET_BACKFILL_INCOMPLETE`; the board background task and five-minute cron retry automatically.
  2. If a candidate is missing, confirm Shopify still returns both expected properties and inspect the `PREVIEWS` bucket for either the exact preview key or the promoted order/design-ref suffix.
  3. If the D1 manifest exists but the card is blank, verify the read-ticket POST and authenticated asset GET succeed, then verify the Pages bundle contains `candidateAssetObjectUrl` and renderer `assetId` handling.
  4. Do not manually write an active manifest without source/private checksum equality. Do not expose `object_key` or reintroduce a permanent public `r2.dev` dependency.

The board intentionally does not await all asset tickets before rendering. Commerce and production cards appear first; successful ticket hydration repaints the affected status columns. A placeholder during that interval is expected and is not evidence that the order or manifest disappeared.

### H. Candidate Move Conflict and Rollback

- A move between pipeline, blanks-cart, blanks-ordered, and print is one production-state transition. Do not reintroduce a separate `updateStatus` followed by `updateReady` on the Shopify path.
- `blanks-batches.js` snapshots the local status fields, repaints immediately, and calls `web-shim.js:updateBoardMove`. On a terminal failure it restores the snapshot and presents a non-blocking notice.
- `web-shim.js` queues mutations by order name. A `409 VERSION_CONFLICT` must contain `error.details.currentVersion` and `error.details.current`; adopt that state, return success when it already matches the requested patch, otherwise retry once with a fresh idempotency key.
- Repeated conflict is a real concurrent-edit failure. Do not loop, suppress it, or overwrite the newer canonical state.
- Verification: move one order while its Admin block is also open, then refresh both surfaces. They must converge on one canonical revision, the Shopify board must remain responsive, and the Legacy Redis value must remain unchanged.

### I. Codex Desktop Browser GPU Crash and Persistent Cache Recovery

This procedure repairs the OpenAI Codex Desktop tool host used during development. It does not modify the PrintMO Electron application, repository data, Chrome profile, or production infrastructure.

#### Confirm the fault boundary

Use the exact Codex Desktop log signature before touching caches. A browser tab or webview may appear briefly, the app may exit without a Windows crash dump, and reinstalling the app may appear to help only until Browser is used again.

```powershell
$logRoot = Join-Path $env:LOCALAPPDATA 'Codex\Logs'
$recentLogs = Get-ChildItem -LiteralPath $logRoot -File -Recurse |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 20

Select-String -Path $recentLogs.FullName -CaseSensitive:$false -Pattern @(
  'Recoverable Chromium child process gone.*processType=GPU.*reason=crashed',
  'Recoverable Chromium child process gone.*processType=GPU.*reason=launch-failed'
)
```

The high-confidence sequence is one `reason=crashed` GPU event followed immediately by `reason=launch-failed`, with the affected desktop log ending at or soon after those events. Browser route or picture-in-picture warnings without the GPU sequence are not sufficient evidence for this repair. Likewise, a Chrome native-host or extension connection error without the GPU signature belongs to Chrome plugin troubleshooting, not cache recovery.

#### Recover without destroying browser state

1. Quit Codex Desktop completely and confirm no `ChatGPT.exe` process remains.
2. Run the PowerShell block below. It moves only transient graphics, code, and HTTP caches into a timestamped backup. It does not touch cookies, authentication, local storage, browser history, `Preferences`, sessions, or the user's Chrome profile.
3. Reopen Codex Desktop. Chromium recreates the missing cache directories on demand.

```powershell
if (Get-Process -Name ChatGPT -ErrorAction SilentlyContinue) {
  throw 'Quit Codex Desktop completely before moving its browser caches.'
}

$profileRoot = [IO.Path]::GetFullPath(
  (Join-Path $env:APPDATA 'Codex\web\Codex')
)
$backupRoot = [IO.Path]::GetFullPath(
  (Join-Path $env:LOCALAPPDATA (
    'OpenAI\Codex\repair-backups\browser-cache-' +
    (Get-Date -Format 'yyyyMMdd-HHmmss')
  ))
)
$relativePaths = @(
  'GrShaderCache',
  'ShaderCache',
  'GraphiteDawnCache',
  'GPUPersistentCache',
  'Default\GPUCache',
  'Default\DawnGraphiteCache',
  'Default\DawnWebGPUCache',
  'Default\Partitions\codex-browser-app\GPUCache',
  'Default\Partitions\codex-browser-app\DawnGraphiteCache',
  'Default\Partitions\codex-browser-app\DawnWebGPUCache',
  'codex-browser-app\Cache',
  'codex-browser-app\Code Cache',
  'Default\Partitions\codex-browser-app\Cache',
  'Default\Partitions\codex-browser-app\Code Cache'
)

$sourcePrefix = $profileRoot.TrimEnd('\') + '\'
$backupPrefix = $backupRoot.TrimEnd('\') + '\'

foreach ($relativePath in $relativePaths) {
  $source = [IO.Path]::GetFullPath(
    (Join-Path $profileRoot $relativePath)
  )
  $destination = [IO.Path]::GetFullPath(
    (Join-Path $backupRoot $relativePath)
  )

  if (-not $source.StartsWith(
    $sourcePrefix,
    [StringComparison]::OrdinalIgnoreCase
  )) {
    throw "Unsafe cache source: $source"
  }
  if (-not $destination.StartsWith(
    $backupPrefix,
    [StringComparison]::OrdinalIgnoreCase
  )) {
    throw "Unsafe cache destination: $destination"
  }
  if (Test-Path -LiteralPath $source) {
    New-Item -ItemType Directory -Force -Path (
      Split-Path -Parent $destination
    ) | Out-Null
    Move-Item -LiteralPath $source -Destination $destination
  }
}

"Moved transient Codex browser caches to: $backupRoot"
```

Do not replace this recoverable move with recursive deletion, and do not move the entire `Codex\web\Codex` profile. Retain the backup until several Browser/Chrome tasks complete successfully; then it may be deleted to reclaim space.

#### Verify the repair

1. Confirm Codex rebuilt fresh cache directories and has a live GPU process:

   ```powershell
   Get-CimInstance Win32_Process |
     Where-Object {
       $_.Name -eq 'ChatGPT.exe' -and
       $_.CommandLine -match '--type=gpu-process'
     } |
     Select-Object ProcessId, ParentProcessId
   ```

2. Use the Browser skill for one bounded health check: open a disposable in-app tab, load `https://example.com/` or the intended localhost route, verify its title/DOM, and finalize the tab.
3. If Chrome is part of the workflow, connect through the Chrome skill and perform a lightweight session/tab-list call without claiming or reading unrelated user tabs.
4. Search only the new desktop-session logs for the two GPU events. Both must be absent after the health checks.

#### Prevent recurrence and limit blast radius

- Use a purpose-built connector, API, or CLI when the task needs semantic data rather than visual or interactive browser state. This avoids initializing a local browser for work that does not require one.
- During real browser work, reuse the established browser binding, avoid duplicate tabs, and finalize disposable tabs when the task ends. This limits stale route state and unnecessary profile churn; it is not a substitute for a graphics-driver fix.
- At the first unexpected Codex exit after Browser/Chrome initialization, inspect the log signature before retrying. Once the GPU crash/launch-failure pair is present, stop repeated browser attempts and perform one cache recovery after closing the app.
- Cache size alone is not a failure signal. Do not schedule routine cache deletion or clear cookies, local storage, sessions, `Preferences`, or the full browser profile.
- Keep Codex Desktop and the Chrome plugin current. If Chrome alone cannot connect and the GPU signature is absent, follow the Chrome plugin setup/reinstall flow rather than this cache procedure.
- If the same GPU sequence returns immediately with newly rebuilt caches, preserve the new logs and backup, submit `/feedback` with the task ID, and investigate GPU driver, virtual-display, or hardware-acceleration compatibility. Do not loop cache resets or reinstall the app again.

---

## Common Failure Modes & Recovery

| Trap / Pattern | Prevention Invariant |
|---|---|
| Bypassing `contextBridge` | Never set `nodeIntegration: true` in `main.js`. Keep main and renderer processes strictly isolated. |
| Hardcoding local API endpoints | Use `order-manager-proxy` environment configuration for production web deployments. |
| Reinstalling Codex repeatedly after Browser-triggered exits | Confirm the GPU crash/launch-failure log pair first. Reinstall preserves the roaming browser profile; move only the documented transient caches to a recoverable backup while Codex is closed. |
