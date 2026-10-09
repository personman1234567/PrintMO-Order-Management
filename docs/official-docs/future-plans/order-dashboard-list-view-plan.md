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

- **Current state**: Stages 1 and 2 deployed as an opt-in production preview behind
  `?printmo_list_preview=1`. Board remains the reload default. The approved
  eight-column list supports searching, stage and additional filters, sorting,
  existing detail opening, and focus/scroll recovery. No list workflow actions.
- **Next safe action**: Stage 3, when requested: design selections and reuse
  existing purchasing, receiving, bundling and stage actions with their source,
  eligibility, confirmation and revision contracts.
- **Remaining acceptance**: Representative dense shop orders and authenticated
  detail updates still need owner acceptance. Dedicated mobile refinement and
  preferences remain Stage 4; complete rollout/acceptance remains Stage 5.
- **Owner / external actions**: Owner authorized Stages 1 and 2. Owner requested this frontend deployment on 2026-10-09. Subsequent stages
  still require their own request.
- **Last verified evidence**: Twenty-one focused tests, Phase 2 including Phase 1,
  syntax, docs and bundle checks; actual synthetic browser checks at
  1600/1050/393/320px. Synthetic evidence does not establish live shop acceptance.

## Open Questions & Brainstorming

- Validate the finished columns against real dense shop orders before release; avoid
  duplicating every detail field or making a wide table the mobile experience.
- Select operational actions within the list during Stage 3, using the existing
  source, eligibility, confirmation and revision rules.
- Decide preference persistence and column customization during Stage 4.

## Technical Specification & Task Checklist

- [x] Stage 1: pure shared model, separate controller, Board default, optional
  read-only preview. No second queue or detail fetch, new schema, stage mutation,
  or replacement of the existing Board/detail.
- [x] Stage 2: finished desktop browsing table, stage counts/filters, search,
  sorting, detail opening and return behavior.
- [ ] Stage 3: selections and existing workflow actions; purchasing, receiving,
  bundles, and stage moves must retain provider-specific authority and guardrails.
- [ ] Stage 4: mobile list, accessibility/usability polish and preferences.
- [ ] Stage 5: regression, representative shop acceptance and authorized release.

Foundation code:

- `order-manager-web/order-board-model.js`: pure provider identities, canonical
  stages, counts, quantities, material milestones, printable progress, target
  presentation, distinct recorded attention/triage/receipt accounting.
- `order-manager-web/order-list-foundation.js` and `.css`: preview flag, separate
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
