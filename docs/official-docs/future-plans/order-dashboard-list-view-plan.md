# Optional Dashboard List View

- **Status**: `[In Progress]`
- **Owner / Target Milestone**: `PrintMO owner / five careful implementation stages`

## Summary & Intent

Add a full-width order list alongside the existing Board, using the approved
desktop and mobile concepts. Operators should see stage, material status,
quantities, progress, attention and target dates without opening detail. Board
remains available and opens by default; the shared order detail remains unchanged.
The list targets the embedded Shopify/provider data plane, not Legacy Redis.

## Current Continuation State

- **Current state**: Stages 1 through 3 are deployed. The normal Shopify app
  launch now exposes **Board / List preview** without a special URL, release
  `1791584493560` (Pages deployment `95b1c131`). Board remains the reload default;
  `?printmo_list_preview=0` explicitly hides the optional layout as a rollback
  escape hatch. Existing `=1` links continue to work.
- **Next safe action**: Resume Stage 4 from the owner decisions below. Inspect the
  committed Stage 3 baseline, then prepare its bounded implementation plan when
  requested. This handoff records scope; Stage 4 implementation has not started.
- **Remaining acceptance**: Representative authenticated shop orders and real
  detail/workflow changes still need owner acceptance. Browser fixtures establish
  frontend behavior only; no live supplier submission was used for verification.
- **Owner / external actions**: Owner authorized Stage 3 implementation on
  2026-10-09, including visible-only selection, one toolbar, all-selected eligibility
  and existing manual moves. Owner then requested Stage 3 production deployment
  with the preview flag retained. After the normal app launch hid the toggle,
  the owner reported the discoverability problem; the follow-up exposes the
  optional layout on normal launches and retains an explicit opt-out.
- **Last verified evidence**: All 39 focused tests, Phase 2 including Phase 1,
  applicable syntax checks, documentation validation and bundle preparation passed.
  Stage 3 focused tests cover immutable identities,
  selection reconciliation, source authority, partial saves, supplier uncertainty,
  shelf coverage and recovery without repeating saved steps. Synthetic browser
  checks cover 1600/1050/393/320px, keyboard selection and detail return. Native
  list, review and result captures accompany the preview; the 320px native-dialog
  capture is limited by the browser capture path, while DOM bounds, 44px controls
  and Escape/focus behavior were verified.

## Open Questions & Brainstorming

- Validate the finished columns against real dense shop orders before release; avoid
  duplicating every detail field or making a wide table the mobile experience.
- Validate Stage 3 operational actions with authenticated representative orders
  before any requested deployment; retain supplier reconciliation boundaries.
- Validate the Stage 4 desktop space improvements at the same viewport and row
  density as the current release; do not equate more visible rows with completed
  acceptance of the operational workflows.

## Technical Specification & Task Checklist

- [x] Stage 1: pure shared model, separate controller, Board default, optional
  read-only preview. No second queue or detail fetch, new schema, stage mutation,
  or replacement of the existing Board/detail.
- [x] Stage 2: finished desktop browsing table, stage counts/filters, search,
  sorting, detail opening and return behavior.
- [x] Stage 3: deployed preview selections and existing workflow actions; purchasing, receiving,
  bundles, and stage moves must retain provider-specific authority and guardrails.
- [ ] Stage 4: mobile list, accessibility/usability polish and preferences.
- [ ] Stage 5: regression, representative shop acceptance and authorized release.

Foundation code:

- `order-manager-web/order-board-model.js`: pure provider identities, canonical
  stages, counts, quantities, material milestones, printable progress, target
  presentation, distinct recorded attention/triage/receipt accounting.
- `order-manager-web/order-list-foundation.js` and `.css`: optional layout gate, separate
  rendering and layout state. Event updates coalesce without additional transport.
- Root `renderer.js`: cached snapshot updates and shared calculations, with the
  existing fallback retained when the embedded model is absent.
- `scripts/order-list-foundation.test.js`: `npm run verify:order-list`.

Counts mean individual orders even when the board groups them into bundles.
`blanks_cart` differs from `blanks_ordered`. Printed orders remain active until
commerce fulfillment/archive removes them. Four material flags do not establish
artwork approval or formal production release. Printable eligibility controls
the progress denominator; progress alone never changes stage in the model.
Carrier delivery does not mean physically received or allocated stock.

## Stage 4 Owner Decisions and Session Handoff

**Captured 2026-10-09.** The owner answered the Stage 4 scope questions and asked
for a durable handoff to a new session. These are approved design choices, not
an instruction to implement or deploy during this intake task.

| Question | Owner choice | Implementation consequence |
|---|---|---|
| Phone testing priority | Shopify mobile app first | Prioritize the real embedded app viewport, safe areas, software keyboard and contained scrolling. Phone-browser behavior remains a secondary check. |
| Phone row density | Compact rows with expandable extras | Keep order/customer, stage, target, quantities, readiness/progress and attention visible. Reveal remaining financial/receiving/supplier details within the list without requiring order detail. Do not lose unknown values, valid zero or separate delivery/receipt/allocation meanings. |
| Reopening preferences | Remember last Board/List view and sort; reset search and filters | Save preferences separately per browser/device. Reload starts with All active and no search/additional filters; selections are never persisted. First visit or unavailable/invalid preference storage falls back to Board and Newest first. |
| Column customization | Keep current columns for now | Retain the approved eight desktop columns and their order. No hide/show or reorder controls in Stage 4. Mobile expansion is presentation of the same facts. |
| Desktop feedback | Upper sections and the standalone view-toggle row are too bulky and constrict list space | Reclaim vertical space by consolidating upper controls and integrating Board/List into existing navigation/header space. Preserve legibility, touch targets, search/filter access and selected-order review clarity. |

The normal detail screen and Stage 3 reviewed workflow contracts remain shared.
Provide separate accessible controls for selecting a job and expanding phone
extras; order opening must remain available through its existing path. Stage 4
also owns the already-scoped keyboard/focus, touch-target and usability polish.
Preference restoration changes reload behavior only after Stage 4 is implemented;
the current live release still starts on Board.

**Desktop space requirement:** The owner reports that the upper sections are too
bulky and leave too little room for the list. The Board/List toggle also consumes
an unnecessary standalone row of height across the app. Stage 4 must address both
Board and List placement of that toggle and reduce excess header/control height.
The exact composition is still an implementation-plan decision, not an approved
new mockup.

Compare before/after at the same desktop viewport, row density and data, both with
and without the selection toolbar. Verify that more order rows fit without hiding
stage/filter/selection controls, shrinking text to unreadable sizes or weakening
44px touch controls, keyboard operation and normal detail opening. Capture the
current deployed layout as the baseline before changing it. The owner has answered
all five intake questions; do not repeat them unless a choice changes.

**Verified resumption baseline:**

- Repository: `PrintMO-Order-Management`, branch `Shopify-Sync`, clean commit
  `02f4bba77916d4fed4e66ad21b8f781a7a34efd1` (`Stage 3 complete`) at handoff.
  Recheck actual Git state before edits; preserve any later owner changes.
- Live frontend: release `1791584493560`, Pages deployment `95b1c131`.
  Normal app navigation exposes **Board / List preview**. No opt-in URL is needed;
  explicit `printmo_list_preview=0` remains the opt-out. Do not restore query-only
  gating: normal Shopify navigation previously hid the toggle.
- Normal owner entry: [Order Manager in Shopify Admin](https://admin.shopify.com/store/429cc0-3/apps/print-mo-order-manager).
- Stages 1–3 are implemented and deployed. All 39 focused tests, Phase 1/2,
  syntax, docs and bundle checks passed. Authenticated browsing, selection and
  normal-launch refresh were verified. Live supplier/workflow submissions were
  not used for tests; representative operational acceptance remains outstanding.
- Stage 4 is not implemented. Stage 5 remains regression and real shop acceptance.
  Use synthetic workflow fixtures for implementation testing; deployment is a
  separately authorized action.
- The earlier localhost `8766` tab is a Stage 2 synthetic preview; `8767` was a
  temporary Stage 3 fixture. Neither establishes current production state or
  contains Stage 4. Start from the committed repo, not a stale preview tab or
  temporary checkout.
- Reuse `order-board-model.js`, `order-list-foundation.js`/`.css`,
  `order-list-workflows.js` and the existing identity-safe adapter/cache events.
  Do not rebuild stages 1–3, add list polling/detail prefetch, weaken source
  isolation, or expand selection actions to hidden bundle members.
- Prior native 320px review-dialog screenshot capture was limited despite verified
  functional bounds and keyboard behavior. Do not repeat unchanged capture
  attempts; retest the actual Stage 4 mobile changes with a suitable capture path.

## Stage 3 Behavior

Selection addresses immutable provider/order identities and stays within current
results. Filters and live changes deselect departed jobs; sorting, Board/List and
normal detail preserve selection. Draft Orders, history and source changes clear it.
The matching-orders checkbox covers the full filtered result, not just visible rows.

One shared toolbar offers explicit-order S&S cart submission, Ordered recording,
manual moves to Pipeline/Build Order/In S&S Cart/To Print, bundle creation and
selected-member removal. Every selected job must qualify. Supplier actions here
remain Shopify-only; Etsy production actions require its existing authority.
Printed and generic Ordered shortcuts are absent. Receive Batches opens the existing
workspace without requiring selection. No commerce, readiness or artwork approval
semantics were added.

`order-manager-web/order-list-workflows.js` coordinates reviewed jobs and per-order
results. The existing frontend adapters accept identity descriptors as well as
names and serialize both by immutable identity. Source changes fail closed for
identity descriptors. Version reconciliation may retry once only while reviewed
stage/bundle prerequisites remain valid. Existing Board scope and Legacy transport
remain in place.

Successful members stay saved when another fails. Receiving-record success followed
by stage failure retries only advancement; a stage move followed by batch correction
failure retries only remaining membership removal. Unknown supplier outcomes and
accepted submissions requiring production repair remain for reconciliation, without
automatic resubmission. Existing shelf-claim subtraction, batch membership checks,
physical check-in and allocation rules remain authoritative. Browsing adds no
transport, detail prefetch or polling.

## Progress Log

- **2026-10-09**: Implemented and checked Stage 1 locally after owner approval.
  Board stays default, existing detail/workflow transport stays in place, and the
  list can be inspected through an explicit preview flag. No release performed.

- **2026-10-09**: Stage 2 local browsing implemented. Combined filters use AND;
  counts precede stage selection; target-date filters remain calendar-based even
  when Printed labels are neutral. Unknown money/receiving stays explicit and
  zero is preserved. Cached supplier states remain separate from check-in and
  pending allocation. Existing Orders/Drafts navigation and shared detail remain
  in use; keyed row updates and nearest-row recovery were browser-checked.
  Selection, inline actions, Columns, persistent preferences and deployment are
  deferred. Independent finish review led to denser desktop identity rows and
  explicit progress tracks; final captures accompany the local preview.

- **2026-10-09 release**: Owner requested deployment of the verified Stage 2
  frontend. Published Cloudflare Pages production release `1791580136344`
  (`9f091e0c`); production release marker verified. Board remains default and
  List requires `printmo_list_preview=1`. This publishes the opt-in browsing
  preview; it does not complete authenticated shop acceptance or later stages.

- **2026-10-09 Stage 3 local**: Added exact-order selection, reviewed workflow
  actions and individual recovery results. Keyboard selection, mixed-source reasons,
  exact bundle scope, Ordered partial failure/retry, supplier partial/unknown results,
  detail focus return and narrow containment were checked with synthetic fixtures.
  Independent finish review found no material UI change; native list/result and
  availability captures passed, with the 320px native-dialog screenshot remaining
  an evidence limitation. Design documentation records the local extension. No
  deployment or live supplier verification occurred.

- **2026-10-09 Stage 3 release**: Owner requested deployment and a usable preview.
  Published production Pages release `1791582951853` (`51b5e8b9`) through the
  registered deployment command. Production release marker and seven runtime
  assets match the fresh artifact; 37 frontend source files matched the tested
  Stage 3 checkout and all 39 focused tests passed again. Verified the flagged
  Shopify Admin launch, List opening with 20 active real orders, selection and
  toolbar eligibility without submitting any order or supplier mutation. Board
  remains the reload default; broader workflow acceptance remains pending.
  Owner launch link: [Stage 3 in Shopify Admin](https://admin.shopify.com/store/429cc0-3/apps/print-mo-order-manager?printmo_list_preview=1&printmo_release=1791582951853).

- **2026-10-09 toggle discoverability fix**: Normal app navigation removed the
  opt-in query string and hid Board/List. The optional layout is now enabled on
  normal Shopify launches; explicit `printmo_list_preview=0` retains opt-out.
  Published Pages release `1791584493560` (`95b1c131`), verified its production
  marker and controller bytes, and checked the ordinary Shopify Admin app URL
  before and after refresh. Board stayed default; List opened 20 real active
  orders. Syntax, 39 focused tests, Phase 1/2, bundle and docs checks passed.

- **2026-10-09 Stage 4 intake**: Owner selected Shopify mobile app first, compact
  expandable phone rows, per-browser/device view-and-sort persistence with
  search/filters reset, and no column customization. Recorded the committed
  baseline and current deployment for a new session. Owner also reported bulky
  upper sections and a wasteful standalone toggle row; reclaiming list height is
  now an explicit Stage 4 desktop requirement. No Stage 4 implementation or
  deployment performed.
