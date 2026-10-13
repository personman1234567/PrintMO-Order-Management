# Optional Dashboard List View

- **Status**: `[In Progress]`
- **Owner / Target Milestone**: `PrintMO owner / five careful implementation stages`

## Summary & Intent

Add a full-width order list alongside the existing Board, using the approved
desktop and mobile concepts. Operators should see stage, material status,
quantities, progress, attention and target dates without opening detail. Board
remains available and opens on first visit; subsequent visits restore the last
layout and sort. The shared order detail remains unchanged.
The list targets the embedded Shopify/provider data plane, not Legacy Redis.

## Current Continuation State

- **Compact List and workspace restructuring, 2026-10-12**: Owner approved moving
  occasional Orders/Draft Orders switching into the drawer and replacing borrowed
  board navigation with one workspace controller. Implementation gives drafts their
  own destination and guarded lifecycle, preserves List preferences across switching,
  combines identity and stages, moves the result count into search controls, removes
  the permanent preview instruction, and reduces sticky table headings to 45px.
  Both search fields cap text at 120 characters; active-order matching remains
  literal and cached, and existing draft query escaping remains authoritative.
  Synthetic navigation/geometry checks pass at 1856/1050/393/320px; at identical
  1856px viewport and fixture data, the first order row moves from 271px to 167px
  (104px recovered), with additional room from removing the preview footer.
  All 52 List tests, Phase 1/2, syntax and docs checks pass. Production Pages
  `020650c8` serves release `1791835737974`; the registered deployment command
  verified its canonical marker, and all 11 changed runtime assets match by SHA-256.
  Authenticated shop interaction and actual phone-app acceptance remain distinct.

- **Current state**: Stages 1 through 4 are deployed. The normal Shopify app
  launch exposes **Board / List** without a special URL, release
  `1791818752348` (Pages deployment `c124dd33`). Device storage restores layout
  and sort only; search, stage, filters, selection and phone expansion reset.
  `?printmo_list_preview=0` explicitly hides the optional layout as a rollback
  escape hatch. Existing `=1` links continue to work.
- **Dashboard control correction**: The owner-authorized October 11 follow-up
  places Board/List in the workspace header, groups Cart actions with Mark cart
  ordered first, exposes Receive Batches directly in Ordered, and standardizes
  rectangular controls, restrained blue accents and readable card quantities.
  Production markers and authenticated desktop Board/List were verified;
  synthetic 1696/1050/393/320px checks covered layout, keyboard and action placement.
- **Motion polish**: The October 11 follow-up adds pointer press feedback,
  trigger-origin menu entrances, and acknowledgment-based save feedback. Keyboard
  and reduced-motion interactions remain immediate; List partial/unknown results
  retain their detailed review messages. Focused tests and four-width synthetic
  browser checks passed; authenticated Shopify verified both menus and preserved
  garment estimates on release `1791751973222`. No live production save was tested.
- **Workspace refinement**: The owner-approved October 11 follow-up adds a compact
  workspace toolbar, right-side navigation drawer, aligned Board headers, compact
  cost disclosure, travelling tab indicators and explicit view/disclosure motion.
  Synthetic 1696/1050/393/320px checks covered geometry, navigation, drawer focus,
  Board/List, action placement, cost disclosures/errors, keyboard, reduced motion,
  and Legacy restoration. The 49 List tests, Phase 2 (including Phase 1), syntax,
  documentation and bundle checks passed. Release `1791753911363` (Pages `1423a04c`)
  was verified on the canonical host and authenticated Shopify desktop, including
  Board/List, Menu, Cart actions and preserved estimates. Supplies orders began
  about 99px higher in the identical wide synthetic comparison. No live supplier
  or production mutation was submitted; actual phone-app acceptance remains pending.
- **Viewport correction**: The next owner-requested October 11 correction removes
  the candidate toolbar and redundant destination label. Board/List and Refresh
  now live in the existing drawer; Menu uses the Board Production header, List
  heading or destination header, and replaces phone Sync in the existing stage bar.
  Shopify's injected 66px bottom pseudo-element spacer is suppressed; both layouts
  fill the iframe with 8px vertical gutters and retain their inner scroll owners.
  Live desktop panels gained 134px at the same 1856 × 801 iframe: 60px above and
  74px below. Cards, information hierarchy and garment estimates remain intact.
  Five-size synthetic checks (1856/1050/901/393/320px, including short windows),
  navigation, drawer controls, Escape/focus, scrolling and Legacy restoration passed.
  All 49 List tests, Phase 1/2, syntax, docs and bundle checks passed. Release
  `1791755400448` (Pages `3d8dfe4a`) was verified on the canonical host and
  authenticated Shopify Board/List. No live workflow mutation was submitted;
  actual Shopify phone-app acceptance remains pending.
- **Rush and finish-by visibility**: The owner-approved October 12 refinement adds
  one compact Board schedule line only when a date or rush fee is present, plus
  a modest plum Rush marker beside List identity and dates in the existing Due / Age
  area. Today/tomorrow retain actual dates; complete/history dates remain neutral.
  Bundles show Includes rush and the earliest active date for members represented
  by that card. Recognition reads positive-quantity commerce lines using the live
  verified official Rush order fee SKUs/title, plus exact explicit custom rush-fee
  names without SKUs. Date proximity, shipping and notes never imply rush. Rush only
  lives inside collapsed filters; Rush first is opt-in. All 51 List tests, Phase 1/2,
  syntax, docs and bundle checks passed. Four-size synthetic checks covered date/rush
  removal, undated cards, bundle labels, wrapping, collapsed phone visibility and
  sorting/filtering. Release `1791818752348` (Pages `c124dd33`) was verified on the
  canonical host and authenticated Shopify Board/List, including one real Rush order
  and Rush-only filtering. No order, catalog or production state was changed.
- **Next safe action**: Complete Stage 5 representative shop acceptance,
  prioritizing the actual Shopify phone app, software keyboard, scroll/detail
  return and reviewed workflow outcomes. Implementation and deployment are done.
- **Remaining acceptance**: Representative authenticated shop orders and real
  detail/workflow changes still need owner acceptance. Browser fixtures establish
  frontend behavior only; no live supplier submission was used for verification.
- **Owner / external actions**: On 2026-10-11 the owner approved the bounded
  List/header correction plan and explicitly requested implementation and deployment.
- **Last verified evidence**: All 44 focused tests, Phase 2 including Phase 1,
  applicable syntax checks, documentation validation and bundle preparation passed.
  Stage 3 focused tests cover immutable identities,
  selection reconciliation, source authority, partial saves, supplier uncertainty,
  shelf coverage and recovery without repeating saved steps. Synthetic browser
  checks cover 1600/1050/393/320px, keyboard selection and detail return. Native
  save feedback, compact phone expansion, keyboard activation, preference reload
  and opt-out preservation were checked. At 1600 × 800 with identical synthetic
  data, browsing gained 116px without selection and 126px with selection/results
  visible. The canonical release marker and authenticated desktop List with 25
  active orders were verified. Impeccable's manual detector reviewed incumbent
  token advisories and existing warnings outside this bounded List/header scope.

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
- [x] Stage 4: mobile list, accessibility/usability polish and preferences.
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

The October 9 intake below is historical. Its choices were implemented and
released October 11; the current continuation state above takes precedence.

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

- **2026-10-11 Stage 4 corrections and release**: Fixed adapter/displayed snapshot divergence by immutable identity and canonical revision, including conflicts and refresh replacement. Consolidated Board/List into the active header, combined browse/receiving controls, flattened feedback, added compact phone rows with separate extras, and persisted layout/sort only. All 44 focused tests, Phase 1/2, syntax, docs and fresh bundle checks passed. Same-data browser checks at 1600/1050/393/320px verified containment, unknown/zero values, reviewed save feedback, keyboard expansion and preference reset/opt-out. Deployed production release `1791744078280` (`e39b816f`) through the authorized repository command; canonical marker and authenticated desktop List with 25 orders verified. No live supplier or workflow mutation was used for acceptance. Stage 5 actual Shopify phone-app and representative operational acceptance remain pending.
