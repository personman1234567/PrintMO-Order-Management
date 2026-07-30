# Verification & Test Lookup Map

## Use This When
- You are validating code changes prior to claiming task completion.
- You need to select the appropriate syntax check or manual runbook test for a subsystem.

## Skip This When
- You are looking for source ownership and symbols → read [Source map](source-map.md).

## Section Map
- [Automated and Syntax Verification Commands](#automated-and-syntax-verification-commands)
- [Subsystem Manual Verification Matrix](#subsystem-manual-verification-matrix)
- [Build and Packaging Verification](#build-and-packaging-verification)
- [Common Failure Modes & Recovery](#common-failure-modes--recovery)

---

## Automated and Syntax Verification Commands

Run these targeted CLI commands to verify syntax integrity without side effects:

| Subsystem / File | Verification Command | Expected Output |
|---|---|---|
| Main Electron Process | `node --check main.js` | Silent exit code 0 |
| Preload Script | `node --check preload.js` | Silent exit code 0 |
| Desktop Renderer | `node --check renderer.js` | Silent exit code 0 |
| Cloudflare Worker Proxy | `node --check order-manager-proxy/worker.js` | Silent exit code 0 |
| Phase 1 Auth/Transport Contract | `npm run verify:phase1` | `Phase 1 contract verification passed.` |
| Shopify/D1 Candidate Contract | `npm run verify:phase2` | Verifies webhook enrollment, D1 projection, non-blocking stale-summary refresh, generation-guarded/stable board rendering, guest-checkout name fallback, Shopify CAS/conflict details, Redis isolation, atomic/optimistic board contracts, functional blanks tabs, semantic card classes, order-detail DOM/controller and accessible-tab contracts, paired ordered-to-ready readiness semantics, mobile detail scroll ownership, S&S batch commit, Designer Studio private-R2 import/backfill, private asset tickets, and migration gates |
| Shopify Board Source Controller | `node --check order-manager-web/shopify-preview.js` | Silent exit code 0 |
| Admin Block and Candidate Controls | Run `npm test` then `npm run build` in `order-manager-proxy` | Canonical stages, labels, collapsed summary, source switching, and Shopify extension build pass |
| Render Legacy Adapter + Stateless S&S Gateway | Run `npm test` in `E:\PrintMO\shopify-ss-integration` | Legacy regressions pass and candidate supplier route is proven Redis-free |
| Web Client Renderer | `node --check order-manager-web/renderer.js` | Silent exit code 0 |
| Web Storage Adapter | `node --check order-manager-web/storage-browser.js` | Silent exit code 0 |
| Living Documentation Contracts | `npm run docs:check` | Routes, links, plan states, source ranges, and tool registry pass |

---

## Subsystem Manual Verification Matrix

| Component / Workflow | Manual Verification Procedure | Success Criteria |
|---|---|---|
| Desktop App Local Boot | Run `npm start` | OIDC sign-in succeeds, the window launches, and the authenticated legacy board loads through the Worker. |
| Legacy Kanban Card Drag-and-Drop | In **Legacy Redis**, move a card between supported columns | IPC calls the authenticated legacy adapter; the stable-identity mutation persists after refresh. |
| Order Detail Modal | Click any order card | Modal overlays dashboard showing customer info, SKU variants, unit costs, and attachments. |
| Attachment File Upload | Upload image attachment via detail modal | FileReader encodes image Base64, IPC `add-file` persists file, image renders in preview tab. |
| S&S Blank Batching | Drag multiple cards to Create Blanks Order zone, click Submit | SKUs aggregate, API call executes, order confirmation returns, cards advance to `Blanks Ordered`. |
| Malformed Legacy Asset Container | Run the `splitOrderAssets` regression check with item assets shaped as `{}`, `null`, and a valid array; then load the Redis board | Invalid containers are treated as empty, valid asset arrays still render, and one malformed item cannot blank the entire board. |
| Embedded Web Authentication | Run `npm run prepare:cloudflare`, deploy the generated artifact, and open it from Shopify Admin | App Bridge supplies a bearer token; queue and asset calls succeed while unauthenticated calls return `401`. |
| Source Isolation | Change a production field in **Shopify board**, then inspect **Legacy Redis** | Candidate value persists through Shopify/D1; the legacy queue value is unchanged |
| Shopify Rich Detail Contract | Run `npm run verify:phase2` | Fixture-backed detail test verifies no Render/Redis request, full line-item pagination, and payment, delivery-method, conversion, discount, and timeline normalization. This test does not prove production Shopify scopes are installed. |
| Shopify Rich Detail — Production Scope Gate | Open a recent order from **Shopify board** | Passed live on 2026-07-23. Installed read/write/all-orders scopes support detail plus canonical production edits; detail identifies Shopify as source and renders payment, delivery, conversion, discounts, complete line items, and timeline data. |
| Shopify Production CAS | Run `npm run verify:phase2` | Mutation writes the Shopify metafield, commits D1 audit/projection, and makes no Redis CAS request |
| Shopify Board | Switch to **Shopify board**, drag a card, edit notes/readiness/progress, and refresh | Same Kanban persists from Shopify/D1 and conflicts refresh instead of overwriting; reaching the nonzero garment total moves the order from **To Print** to **Printed**, while lowering it reverses the stage |
| Shopify Board Load and Poll Stability | Let the board sit beyond the 60-second commerce TTL, switch to **Shopify board**, and watch it through at least two 30-second poll cycles | Existing D1 cards appear without waiting for Shopify/R2 reconciliation; unchanged cards retain their DOM position without flashing; a changed order repaints only its old/new columns; **Refresh Shopify** still waits for and returns live commerce |
| Shopify Blanks Views and Destination | Put one order in **In S&S Cart** and one in **Ordered**, click and arrow-key between tabs, then drop a pipeline card while each tab is selected | Each tab is navigable, displays only its subset, both counts remain accurate, selecting a view does not mutate either order, and a later section drop atomically persists the selected cart/ordered destination |
| Shopify Optimistic Move | Drag a card to another stage, then repeat while the Admin block has advanced its revision | Card moves immediately; one canonical request persists the complete stage; one conflict reconciles/retries; terminal failure restores the card without blocking alerts |
| Candidate Responsive Cards | Inspect the Shopify board at desktop with one and two production cards, then at 393px and 320px widths; include accounting, mockup, no-mockup, To Print, and Printed states | Pipeline footer values fit; one desktop production card remains the normal two-column card width; accounting badges stay inside the status region without displacing previews or progress; phone production cards use one column; both Ready to Print tabs remain operable; Legacy Redis layout is unchanged |
| Embedded Mobile Detail Scroll | Open a long detail view at 320px and 393px, swipe its content from top to bottom, then swipe at both boundaries | Detail content scrolls; fixed app shell does not move or rubber-band sideways; boundary gestures do not chain into Shopify Admin |
| Shopify Admin Order Block | Open an order after the coordinated release, change one field, save, and refresh | Block loads the selected GID, uses a Worker-valid idempotency key even without `randomUUID`, advances one revision, and converges with the Shopify board |
| Designer Studio Assets | Run `npm run verify:phase2`, then open an active Designer Studio order in Shopify board | Line-item properties survive the summary query; preview/promoted bytes are checksum-copied to private R2; D1 records role/side/line item; the board hydrates the manifest by ticket and displays the mockup without reading Redis |
| Candidate S&S Batch | Keep `SS_TEST_ORDER=1`; submit selected candidate orders once | D1 batch becomes confirmed, one supplier test order is returned, and Shopify stages enter `blanks_cart` until the operator marks them Ordered |
| Candidate Bootstrap and Empty-State Safety | Use a fresh D1 database, then repeat with the initial Shopify read forced to fail | A successful bounded read records `bootstrap` and returns the populated board; a failed read returns `BOARD_NOT_INITIALIZED` and the UI keeps the previous board instead of displaying zero |
| Shared Board Source Visibility | Run `npm run verify:phase2`, then switch between Legacy Redis and Shopify board | Both sources keep `#orders-view` visible; obsolete diagnostic CSS cannot blank the Shopify workspace |

---

## Build and Packaging Verification

| Target | Command | Verification Artifact |
|---|---|---|
| Electron Packaging (macOS / Windows) | `npm run dist` | Executable packages generated in `dist/` directory without builder errors. |
| Cloudflare Pages Upload Bundle | `npm run prepare:cloudflare` | Web assets copied into `dist/cloudflare-order-manager-web/`, asset URLs are versioned, and the artifact contains a release marker without mutating tracked web source. |
| Cloudflare Pages Production Release | `npm run repo -- deploy cloudflare -- --production` | Wrangler publishes the `main` branch and the public production hostname returns the exact release marker. |

## Common Failure Modes & Recovery

| Failure | Cause | Recovery |
|---|---|---|
| Full Phase 2 runs for an unrelated small change | Verification was selected by habit, not route/blast radius | Start with the route result; add broader checks only when dependencies require them. |
| Syntax passes but live permissions fail | Local contract tests cannot prove installed external scopes | Run the explicit production scope/acceptance gate. |
| Candidate batch is expected to enter Ordered immediately | Supplier confirmation and operator Mark Ordered were conflated | Expect `blanks_cart`, then verify the operator-controlled transition. |
| Docs and source maps drift despite code tests passing | Documentation validation was omitted | Run `npm run docs:check`. |
