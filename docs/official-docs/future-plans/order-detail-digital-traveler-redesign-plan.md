# Order Detail Digital Traveler Redesign

- **Status**: `[Draft / Idea]`
- **Owner / Target Milestone**: `PrintMO owner / Order Manager reliability and production-control polish`

## Summary & Intent

Turn Order Detail from a capable order viewer with readiness toggles into the order's trustworthy **digital traveler**: the place where an operator can see what must happen next, who owns it, when it is due, what evidence supports the state, and what is blocking production.

The experience must preserve the current workbench's strongest qualities—on-demand canonical detail, source isolation, private artwork delivery, revision/idempotency protection, desktop artwork context, and mobile scroll ownership—while correcting verified integrity defects before adding new workflow fields.

This plan separates three evidence states:

- **Verified current behavior or defect** is grounded in the repository and the 2026-08-17 audit.
- **Candidate workflow** is a proposed representation that requires owner validation against the real shop.
- **Approved implementation** does not exist until the owner validates semantics and the code, migration, and acceptance work are completed.

## Current Continuation State

- **Current state**: A dual-assessment Impeccable audit scored the current detail workbench 24/40 (Acceptable). The split layout and error/accessibility foundations are credible, but the persisted model cannot represent artwork approval/versioning, gang-sheet lifecycle, partial material readiness, blocker ownership, deadlines, or quality/rework. Six P1 reliability and product-model issues are documented below. No redesign or defect fix from this plan is implemented.
- **Next safe action**: Implement the bounded reliability patch in Phase 1, then validate the smallest authoritative artwork, gang-sheet/transfer, garment, blocker, owner, and deadline vocabulary with the PrintMO owner before changing the production schema or claiming complete production readiness.
- **Remaining blockers**: No representative authenticated order was available during the production-browser pass; populated density and real mobile workflow need owner acceptance. Exact shop state names, transition authority, partial-receipt semantics, and quality/rework policy remain unapproved.
- **Owner / external actions**: Confirm the real shop workflow vocabulary, which workstreams apply to each order type, who may approve artwork/release work/override blockers, and whether Overview should replace Items & financials as the default tab.
- **Last verified evidence**: Repository source and deployed unauthenticated shell inspected 2026-08-17. `scripts/verify-phase2.js` passed. The production shell exposed zero orders outside Shopify Admin, so no customer-bearing order or mutation was opened. Full audit snapshot: `../../../.impeccable/critique/2026-08-17T21-04-46Z__order-manager-web-index-html.md`.

## Problem & User Need

Order Detail currently answers “What information is attached to this order?” better than “What should the shop do next?” Its default tab is commerce-led, present exceptions are separated from the action that resolves them, and material readiness is summarized through four booleans. Operators must mentally reconcile artwork, instructions, quantities, supplier state, progress, fulfillment, and history.

The redesign must let a busy operator answer, without searching across tabs:

1. What is the next safe action?
2. What is blocking it?
3. Who owns the blocker or action?
4. When must it happen?
5. Which exact artwork and material evidence make the order safe to release?
6. What changed, by whom, and can the state be trusted?

## Audit Outcome

### Health score

| Heuristic | Score | Current implication |
|---|---:|---|
| Visibility of system status | 3/4 | Loading, partial, retry, and save feedback are strong; blocker, deadline, owner, and next action are not consolidated. |
| Match with the real world | 2/4 | Shop language exists, but artwork, gang-sheet, materials, and quality lifecycles are materially under-modeled. |
| User control and freedom | 2/4 | Close/cancel and confirmations exist; unsaved notes can cross orders and durable undo is absent. |
| Consistency and standards | 3/4 | The workbench is coherent; `Print`, `Revision`, source identity, and readiness semantics drift. |
| Error prevention | 2/4 | Ordered-before-ready sequencing and versioned writes help; no approved-artifact or quality gate protects release. |
| Recognition over recall | 3/4 | Artwork and notes stay visible; operators still remember authority and blockers across five tabs. |
| Flexibility and efficiency | 2/4 | Quick progress and keyboard tabs help; no operational fast path or gang-sheet action exists. |
| Aesthetic and minimalist design | 3/4 | Calm split layout; small metadata and equal-weight tabs flatten priority. |
| Error recovery | 3/4 | Canonical retry/partial/rollback patterns are strong; legacy mobile mutations and uploads are weaker. |
| Help and documentation | 1/4 | The UI does not define `Revision`, `Ready`, `Print`, required gates, or exception resolution. |
| **Total** | **24/40** | **Acceptable shell; incomplete production-control model.** |

### Verified P1 findings

| Finding | Evidence boundary | Required outcome |
|---|---|---|
| Unsaved inline notes can survive close, switch order identity, and save against the next order. | `detail-overlay-enhancements.js → setNotesEditing, syncNotesContext, saveInlineNotes`; `renderer.js → closeDetail`; document-level Escape handling. | Key drafts by immutable order identity. Closing must explicitly discard, preserve, or confirm a dirty draft through one canonical path. Add a regression test for edit A → close → open B → save. |
| Canonical hydration does not adopt canonical revision, printed count, or all readiness flags into the local control model. | `detail-overlay-enhancements.js → mergeCanonicalDetail, renderCanonicalDetail`. | Make the canonical response the explicit source for every rendered production control and conflict token after hydration. |
| The dialog focusable filter can include controls under hidden tab panels, zero-geometry descendants, and roving tabs with `tabindex=-1`. | `accessibility-hardening.js → focusableElements`. | Exclude hidden ancestry, `aria-hidden` ancestry, zero geometry, inert descendants, and negative-tabindex controls from wrap calculations. |
| Shopify candidate detail exposes Edit name even though the adapter rejects commerce-source name mutation. | `renderer.js → openNameModal`; `web-shim.js → window.api.updateName`. | Hide or disable the action by source capability and explain why; do not open a mutation path that cannot succeed. |
| `Production ready` is inferred from blanks/prints Ordered and Ready booleans only. | `detail-overlay-enhancements.js → readyStateFromInputs`; Worker default production state. | Rename the current summary to its actual scope until approved artwork, materials, quality, and release gates exist. Never imply full production eligibility from four booleans. |
| No authoritative operational command center exists. | Default `Items & financials` tab; `Activity & exceptions` is last; no first-class owner/deadline/next-action fields. | Open to an Overview that leads with the next action and blockers, while preserving commerce as supporting evidence. |

### Verified P2/P3 findings

- At a 390×844 viewport, the selected tab strip began roughly 1,320px into a 782px detail scroll viewport. Mobile reads as the entire left rail followed by the nominally selected content.
- Several secondary mobile controls remain 40px unless a coarse-pointer media query matches; the project target is 44×44 CSS pixels.
- The clipped file input can receive keyboard focus without moving the visible focus indicator to the Upload affordance.
- JavaScript tab scrolling requests smooth behavior without honoring `prefers-reduced-motion`.
- `--detail-border-strong` is undefined, so the notes textarea border declaration is invalid.
- The right detail pane introduces a nested `<main>` landmark.
- The closed overlay remains fully laid out behind opacity/pointer suppression, and design-file enhancement uses repeated delayed passes plus an observer.
- Detail styling retains hard-coded color duplication that can drift from the documented design tokens.

## Design Approach

### Preserve

- Shopify commerce remains read-only and source-owned.
- Production mutations remain versioned, idempotent, serialized per order, and reconciled at most once after a conflict.
- Board summaries remain bounded; rich or protected data remains on-demand.
- Private assets retain opaque IDs and renewable short-lived read tickets.
- Desktop keeps prominent artwork, instructions, and production context.
- Mobile keeps one explicit vertical scroll owner and no shell-level horizontal chaining.

### Change

- Make operational state and next action primary; commerce becomes supporting evidence.
- Represent independent workstreams rather than compressing the entire order into one stage or four readiness flags.
- Separate current exceptions from immutable history.
- Make every production-affecting state explainable through owner, timestamp, evidence, dependency, and transition authority.
- Use motion only to confirm saves, sync, milestone transitions, conflict recovery, and next-action changes.

### Do not do

- Do not visually redesign around unapproved state names and then retrofit the data model.
- Do not replace Shopify line IDs or canonical source data with presentation groupings.
- Do not add an opaque readiness score, automatic scheduler, or customer promise rule.
- Do not treat a product/variant image as approved production artwork.
- Do not expose private object keys, tokens, or unrestricted protected customer data.

## Candidate Operating Model — Owner Validation Required

These are candidate state families derived from the audit and production-science field map. They are not current behavior or approved PrintMO policy.

| Workstream | Candidate normal states | Candidate exception states / evidence |
|---|---|---|
| Artwork | Not started → Designing → Proof ready → Awaiting approval → Approved → Production file ready | Changes requested, rejected, superseded, wrong dimensions; selected version, approver, approval time, placement, checksum/reference. |
| Gang sheet / transfers | Not needed → Layout needed → Draft saved → Ready to order → Ordered → Received → Verified → Cut/sorted | Partial receipt, discrepancy, defect, remake; linked approved artwork versions, required quantity, vendor/order reference, ETA. |
| Garments | Need identified → In cart/quote → Ordered → Partially received → Received → Verified | Backorder, substitution requested/approved, shortage, wrong item, damaged; required/ordered/received/accepted quantities, supplier/PO/ETA. |
| Production | Not released → Ready pool → Released/queued → Printing → Partial → Complete | Hold, machine/material blocker, quantity mismatch; responsible operator, release actor/time, remaining quantity. |
| Quality | Pending → Passed | Hold → Rework → Reverified; defect type, affected quantity, disposition, owner. |
| Fulfillment | Awaiting production → Ready → Packed → Pickup/shipped → Complete | Address/customer hold, partial fulfillment, tracking exception. |

Every workstream candidate should support:

- state and state reason;
- responsible owner or role;
- next action and due time;
- blocking dependencies;
- required, completed, and accepted quantities when material;
- evidence/reference and authoritative source;
- created/updated/decided timestamps and actor;
- append-only event history;
- explicit override authority and reason where an override is allowed.

## Information Architecture Specification

### Sticky command header

Show order/customer identity, promised or operational due date, responsible owner, overall state, freshness, blocker summary, and one primary next action. The header must distinguish a derived recommendation from an enforced gate.

### Overview — proposed default

1. **Next action** with owner, due time, and direct CTA.
2. **Blocker stack** ordered by safety/actionability, each with reason, evidence, owner, and resolution path.
3. **Milestone rail**: Artwork → Transfers/gang sheet → Garments → Production → Quality → Fulfillment.
4. **Material reconciliation** for required/ordered/received/accepted quantities.
5. **Recent meaningful change**, not a duplicate of the full event log.

### Workspaces

- **Artwork**: mockup/proof and production-file version stack, placement, dimensions, approval identity/time, and explicit “Use for production.”
- **Materials**: separate Garment and Transfer ledgers with supplier, reference, ETA, quantities, shortages, and discrepancies.
- **Gang sheet**: draft composition, linked artwork versions and quantities, ordering, receipt, verification, cut/sort, and remake actions.
- **Items & commerce**: canonical line items, current money, payment, customer, and delivery evidence without becoming the default production task.
- **Activity**: immutable production and commerce history; current blockers must not live only here.

## Interaction, Copy, and Feedback Requirements

- Replace broad `Production ready` copy with scope-accurate language until all required gates are modeled, such as `Materials marked ready`.
- Replace ambiguous `+1 Print` if it counts completed garment pieces rather than print impressions; use the domain term validated by the owner.
- Define `Revision` contextually or keep it out of the operator surface unless conflict/support work requires it.
- Show source capability before actions: a read-only commerce name must not appear editable.
- Every save exposes Saving, Saved, specific failure, and retry/rollback behavior without discarding the operator's input.
- Dirty drafts are order-scoped and survive only through an explicit product decision.
- State-transition motion uses opacity/transform only, normally 150–220ms, and is removed under reduced motion.

## Accessibility and Responsive Requirements

- Dialog open establishes initial focus, makes the background inert, traps only rendered focusable controls, supports Escape according to nested-editor ownership, and restores focus to the opener.
- Tabs retain roving tabindex, ArrowLeft/Right, Home, and End; hidden panels cannot contribute to tab order.
- Every mobile action has at least a 44×44 CSS-pixel target regardless of fine/coarse pointer emulation.
- The visible Upload affordance owns the focus indicator for the clipped file input.
- Mobile opening shows the command header and next action in the initial viewport. Overview may stack, but the operator must not scroll through the entire artwork/notes rail to discover the selected content.
- Critical metadata must not depend on 0.62–0.7rem text or color alone.
- JavaScript scrolling respects reduced motion.

## Technical Specification & Task Checklist

### Phase 1 — Reliability patch before redesign

- [ ] Key inline-note drafts by immutable order ID and define close/backdrop/Escape behavior.
- [ ] Add the cross-order notes regression test.
- [ ] Merge canonical revision, printed count, and readiness flags into the local control model before repaint.
- [ ] Add hydration regression coverage for a stale board summary followed by a newer detail response.
- [ ] Correct focusable-element filtering and test wraparound with each tab active.
- [ ] Capability-gate Edit name and add source-aware copy.
- [ ] Fix the missing border token, visible Upload focus, reduced-motion scrolling, nested landmark, and mobile target floor.
- [ ] Bring legacy mobile custom-progress and notes mutations under explicit failure/rollback feedback.

### Phase 2 — Validate and specify authoritative workflow

- [ ] Observe or map representative orders: ordinary garment order, artwork-in-design, gang-sheet draft, partial garment receipt, partial transfer receipt, quality hold/remake, local pickup, and shipped order.
- [ ] Approve state names, transition actors, granularity (order/line/placement/work package/sublot), partial-readiness semantics, and override authority.
- [ ] Identify the smallest first schema slice; artwork version/approval, gang-sheet work package, blocker/owner/deadline, and quantity reconciliation are the leading candidates.
- [ ] Decide whether “Overview” becomes the default on desktop and mobile.

### Phase 3 — Versioned data and event contracts

- [ ] Extend the app-owned production schema through an explicit migration/version contract; do not overload existing booleans with new meanings.
- [ ] Keep Shopify commerce immutable and D1 app records rebuildable/relational according to the current data-plane authority.
- [ ] Add append-only events and idempotent transitions with expected revision.
- [ ] Define deterministic next-action/readiness derivation and explainability; keep owner judgment for unresolved tradeoffs.
- [ ] Preserve Legacy Redis isolation and provider-aware identity.

### Phase 4 — Workbench redesign

- [ ] Build the sticky command header and Overview.
- [ ] Add artwork version/approval, materials ledgers, gang-sheet work package, and current blocker stack.
- [ ] Keep commerce and activity as supporting workspaces.
- [ ] Adapt the structure for mobile instead of merely stacking the desktop panes.
- [ ] Apply design tokens and remove always-laid-out closed content/repeated delayed enhancement where safe.

### Phase 5 — Acceptance and rollout

- [ ] Run focused syntax, Phase 2, documentation, and artifact checks.
- [ ] Verify authenticated representative orders for every approved state and exception.
- [ ] Complete desktop keyboard and screen-reader behavior checks.
- [ ] Complete 390×844 and 430×932 mobile checks with touch-target geometry and no shell-level overflow.
- [ ] Verify stale/partial/error/conflict states and cross-order navigation.
- [ ] Obtain owner acceptance before graduating new workflow semantics into current-state documentation.

## Test Plan

| Scenario | Required result |
|---|---|
| Edit notes on A, close through each supported path, open B | B never receives A's draft; the chosen discard/preserve/confirm behavior is explicit and consistent. |
| Board summary is older than canonical detail | Progress, readiness, revision, and save preconditions repaint from canonical detail. |
| Cycle Tab/Shift+Tab with each detail tab active | Focus stays inside the dialog and never lands in hidden panels. |
| Shopify candidate order | Customer name is visibly read-only; no failing edit modal is offered. |
| Artwork has several versions | Exactly one production version is identifiable; approval actor/time and superseded versions are clear. |
| Gang sheet is saved but not ordered | Overview says what is next without marking transfers or production ready. |
| Partial garment or transfer receipt | Required, received, accepted, shortage, and next action remain visible and arithmetically consistent. |
| Quality failure/remake | Original completion cannot hide the hold; affected quantity, owner, and recovery path are visible. |
| Mobile 390×844 | Header and next action are reachable immediately, actions are at least 44px, and only the intended detail owner scrolls vertically. |
| Reduced motion | No smooth programmatic scrolling or decorative transition remains. |

## Measurement

Metrics are candidates until instrumentation and operational baselines are approved:

- Primary: representative orders for which an operator can identify the correct next action and blocker without opening another system.
- Reliability counter-metrics: wrong-order mutations, conflict retries, stale-control saves, unresolved partial receipts, and actions attempted against read-only source data.
- Efficiency counter-metrics: time to locate approved artwork, time to identify a gang-sheet order state, and tab changes before the first production action.
- Guardrails: initial board paint, private-preview stability, mobile scroll containment, and mutation success must not regress.

## Ethical Review

The design must not use false certainty, hidden blockers, or opaque priority scoring to pressure operators. Derived readiness and next-action recommendations must expose their evidence and allow only authorized, logged overrides. No customer urgency or promised date may be invented by the interface.

## Open Questions & Brainstorming

### Owner/workflow questions

- Which candidate artwork and gang-sheet states match the actual shop, and which are missing or unnecessary?
- Is readiness evaluated at the order, line, placement, gang-sheet work package, or production sublot level?
- Who can approve artwork, release work, accept substitutions, clear quality holds, and override blockers?
- How should partial receipt and customer-approved partial fulfillment affect release?
- Which date is authoritative for urgency: requested, quoted, committed, fulfill-by, pickup, ship, or internal must-start?
- Is the printed counter garment pieces, completed decoration operations, or another unit?

### Engineering questions

- Which workstreams belong in the production metafield versus normalized D1 app records?
- How should a gang sheet link several artwork versions and order lines without weakening immutable Shopify identities?
- Which events must be append-only, and which state can be derived from them?
- What is the migration/default behavior for existing orders that have only the four readiness flags?
- How should provider-aware orders advertise mutation capabilities to shared UI controls?

## Progress Log

- **2026-08-17 — Audit intake**: Preserved the dual-assessment 24/40 audit, separated verified defects from candidate shop states, and defined the reliability-first continuation path. No application behavior or production schema changed.
