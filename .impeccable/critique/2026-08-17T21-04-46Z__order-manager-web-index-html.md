---
target: Order Manager order detail workbench
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 6
p2_count: 2
p3_count: 1
timestamp: 2026-08-17T21-04-46Z
slug: order-manager-web-index-html
---
# Order Manager order-detail workbench critique

Method: dual-agent (A: order_detail_design_review_final · B: order_detail_technical_evidence)

## Verdict

24/40 — Acceptable. The current split workbench is a technically thoughtful, visually coherent order viewer with strong loading, error, accessibility, and responsive foundations. It is not yet a trustworthy end-to-end production control surface because the persisted model cannot represent artwork approval/versioning, gang-sheet lifecycle, partial material states, blockers, ownership, deadlines, or quality/rework.

## Heuristic scores

| Heuristic | Score | Summary |
|---|---:|---|
| H1 Visibility of status | 3/4 | Strong loading/partial/error/retry and save feedback; no consolidated blocker, next action, deadline, or explicit artwork/gang state. |
| H2 Match with real shop workflow | 2/4 | Useful shop language, but four readiness booleans collapse garments/transfers and omit artwork and gang-sheet lifecycles. |
| H3 User control and freedom | 2/4 | Close/cancel and confirmations exist; no durable undo, and unsaved notes can cross order boundaries. |
| H4 Consistency and standards | 3/4 | Coherent cards, tabs, badges, and source-aware adapter; semantic drift remains around prints/transfers, Revision, and source identity. |
| H5 Error prevention | 2/4 | Sequenced readiness, revision/idempotency, server caps, and delete confirmation are good; production artifacts and quality are not gated. |
| H6 Recognition over recall | 3/4 | Artwork, notes, and readiness stay visible; exceptions, authority, owner, and next action must still be remembered across tabs. |
| H7 Flexibility and efficiency | 2/4 | Keyboard tabs and quick progress controls help; there is no operational fast path, action queue, or gang-sheet workflow. |
| H8 Aesthetic and minimalist design | 3/4 | Calm split layout and good grouping; dense small type and five same-weight tabs flatten priority. |
| H9 Error recovery | 3/4 | Strong canonical retry/partial/rollback patterns; legacy mobile mutations, uploads, and cross-order drafts are weaker. |
| H10 Help and documentation | 1/4 | Labels exist, but Revision, Ready, Print, gates, and exception-resolution guidance are undefined. |

## Priority findings

### P1 — Missing authoritative shop state

- Artwork is an asset collection, not a governed workflow. There is no designing/proof/approval/production-ready state, approved version, approver, rejection reason, or production lock.
- Gang sheets are reduced to `printsOrdered` and `printsReady`; draft, assembled, ready to order, ordered, ETA, received, verified, cut/sorted, partial, defect, and remake cannot be represented.
- Garments and transfers use Ordered/Ready booleans and cannot express quantities ordered/received/accepted, partial receipt, backorder, discrepancy, vendor, PO, or ETA.
- “Production ready” is inferred from four booleans, so the interface can sound more certain than the underlying evidence warrants.

### P1 — No operational command center

- The default tab is Items & financials while blockers and exceptions are last.
- There is no single visible next action, owner, deadline, severity, dependency, or SLA.
- The operator must reconcile artwork, notes, materials, quantities, fulfillment, and exceptions across two panes and five tabs.

### P1 — Cross-order notes integrity bug

An unsaved inline-notes draft is not reset on close. Opening another order can preserve the previous order's draft while switching the active order, allowing Save to target the wrong order. Escape ordering makes this path especially risky. Drafts must be keyed by order identity and close must discard or explicitly preserve them through one canonical path.

### P1 — Canonical hydration can leave controls stale

Canonical detail merging adopts commerce, assets, attention, and stage but does not adopt the canonical revision, printed count, or four readiness flags into the local order used by controls. This can display stale progress/readiness and cause avoidable conflict reconciliation.

### P1 — Focus trap includes hidden controls

The dialog focusable filter checks an element's own display/visibility but not hidden ancestors, zero geometry, or roving `tabindex=-1`. Hidden-panel controls can be counted as focus targets and break actual wraparound.

### P1 — Source-incompatible Edit name action

The shared detail exposes Edit name, but the Shopify candidate adapter throws because commerce-source customer names are immutable. The modal confirm path has no inline error recovery. Hide or disable the action with an explanation in source modes that cannot fulfill it.

### P2 — Mobile hierarchy hides the selected content

At 390×844, the selected Items tab begins around y=1320 below a 782px scroll viewport; users traverse the entire left rail before reaching the nominal default content. Use an Overview-first mobile composition with a sticky status/action bar and explicit jumps.

### P2 — Accessibility and token defects

- Several mobile controls compute to 40px except under a coarse-pointer query; enforce the 44px floor at the mobile breakpoint and with `any-pointer: coarse`.
- The clipped 1×1 upload input receives keyboard focus without a visible focus treatment on the Upload affordance.
- JavaScript smooth tab scrolling ignores reduced-motion preference.
- `--detail-border-strong` is undefined, producing a borderless notes textarea in production.
- A nested `<main>` landmark makes the dialog structure ambiguous.

### P3 — Performance and maintainability

- The hidden detail overlay remains fully laid out with opacity/pointer suppression; mobile computed layout retained 1834px of hidden content.
- Repeated rAF/250ms/1000ms enhancement passes plus a subtree observer add avoidable work.
- The overlay contains significant hard-coded color drift outside its semantic tokens.

## Strengths to preserve

- Source-isolated, on-demand canonical detail with abort/stale-request protection, partial-data handling, explicit retry, and useful empty states.
- Split-pane artwork/notes/readiness context on desktop; responsive table-to-card behavior and a single mobile scroll owner.
- Strong tab semantics, keyboard navigation, focus styling, forced-colors and reduced-motion CSS foundations.
- Revision/idempotency, per-order serialization, conflict retry, print-count validation, and optimistic rollback patterns.

## Recommended product direction

Make the detail screen the order's digital traveler:

1. A sticky command header: order/customer, promised date, owner, current production state, data freshness, blockers, and one primary next action.
2. An Overview default: blocker stack and milestone rail for Artwork → Gang sheet/transfers → Garments → Production → Quality → Fulfillment.
3. First-class Artwork workflow: version stack, proof/approval status, approver/time, rejection reason, dimensions, and explicit production version.
4. First-class Gang sheet work package: draft composition, linked approved artwork versions, required quantities, order reference, ETA, receive, verification, cut/sort, discrepancy/remake.
5. Garment and Transfer ledgers: required/ordered/received/accepted quantities, supplier/PO, ETA, shortages, and discrepancies.
6. Activity as immutable history, not the only place operators discover current blockers.
7. Purposeful motion only for state transitions, saves, sync, and next-action changes; reliability and calm remain primary.

## Evidence limits

The fresh production browser session lacked Shopify Admin authentication and exposed zero orders, so no populated customer-bearing order was opened. Visual judgments about populated density are source/computed-layout based. The deterministic detector reported two broken-image warnings; both were intentional empty preview elements and neither applies to a visible order-detail defect. Phase 2 contract verification passed, but it does not cover the critical behavioral defects above.
