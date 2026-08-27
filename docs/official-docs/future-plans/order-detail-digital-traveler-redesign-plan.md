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

- **Current state**: Overview v1 remains the default desktop/mobile detail workspace, and the print-progress reliability release remains current. Production Pages deployment `2d498349` with verified release marker `17877829113N` additionally makes mobile Detail an escapable drill-in screen beneath the persistent Orders, Blanks, Print, and Storage navigation. A labeled Back action restores the originating stage and card focus; global stage selection closes Detail before navigation; the covered board remains inert while the command surface stays available. Desktop Detail remains modal. This release adds no schema fields and claims no artwork approval, release, owner, deadline, blocker, gang-sheet, or quality semantics.
- **Next safe action**: Select the smallest app-owned next-action/owner/deadline/blocker contract and promote its appropriate summary into the sticky command header. Confirm the actual shop labels, authoritative deadline, and transition authority before changing the production schema; another broad UX audit is not required.
- **Remaining blockers**: Overview v1, print-progress reliability, and mobile Detail navigation have no remaining release blocker. The local navigation fixture passed 320px, 393px, and desktop interaction checks, but final native-app acceptance remains owner-observed. The next persisted workflow slice remains blocked on exact shop labels, transition authority, and deadline semantics.
- **Owner / external actions**: Before the next schema-backed slice, confirm who owns a next action, which deadline is authoritative, and what qualifies as a recorded blocker.
- **Last verified evidence**: Production deployment `2d498349` uploaded seven changed files, reused 21 existing files, and the canonical production hostname served release marker `17877829113N` on 2026-08-26. Focused syntax, Phase 2, documentation, 320px/393px mobile drill-in navigation, desktop modal regression, artifact, upload, and live-marker checks pass. The Worker, schema, Shopify app/scopes, authentication boundary, and supplier gateway were unchanged. Full audit snapshot: `../../../.impeccable/critique/2026-08-17T21-04-46Z__order-manager-web-index-html.md`. Candidate journey visualization: [Order Detail Journey Map](order-detail-journey-map.html).

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

## Journey + Philosopher Exploration — Candidate

This exploration deliberately questioned the inherited “detail screen” model before refining its tabs. Its output is a set of journey hypotheses, not approved workflow or a replacement for observing representative shop orders. The self-contained visualization is [Order Detail Journey Map](order-detail-journey-map.html).

### Reframed mental model

- **The order is a case moving through commitments, not a static record.** The important unit is often a transition—approve, order, receive, accept, release, complete, hand off—rather than a field category.
- **Order Detail is a checkpoint, not a destination.** Its stable job is to help an operator orient, choose the next safe commitment, act, verify the consequence, and exit or hand off without losing context.
- **Readiness is an evidence-backed claim.** It can be incomplete, stale, contradicted, invalidated by later evidence, or impossible for the system to determine. The UI should expose the proof and uncertainty behind the claim.
- **Work state and knowledge state are different.** “Gang sheet ordered” is a work state; “order reference unverified” is a knowledge state. Compressing both into Ready/Not ready hides whether the shop needs action, evidence, or judgment.
- **The experience crosses systems and time.** Some work happens in Designer Studio, a gang-sheet/vendor tool, receiving, or the physical shop. The detail must preserve a return checkpoint and the evidence needed to continue, rather than pretending every action occurs inside the modal.
- **“Alive” means causally responsive.** After an action, show what committed, which milestone changed, what downstream work became possible, and the new next action. Animation is secondary to this visible cause-and-effect.
- **Exit is part of the workflow.** Closing, interruption, mobile re-entry, shift change, and delegation require safe draft ownership and a recoverable handoff state.

### Three distinct operator arcs

False coherence would hide meaningful variance, so the journey is not one universal happy path.

| Arc | Entry condition | Core need | Successful end |
|---|---|---|---|
| Routine / known next action | Evidence is current and one deterministic action is safe | Orient quickly, act without tab hunting, verify the commit | The new milestone and next action are visible, or the order is complete. |
| Blocked / uncertain | A blocker, stale fact, missing artifact, partial quantity, or contradictory evidence prevents safe release | Understand why, inspect proof, resolve or delegate, and return with evidence | The order is explicitly released or remains blocked with owner, reason, and resolution path. |
| Interrupted / handoff | The operator returns later, changes device, or another person takes over | Recover what changed, draft ownership, pending work, and responsibility | Work resumes without reconstructing history or carrying hidden local state across orders. |

### Stable journey spine

1. **Entry from context**: carry board identity, stage, attention, and the operator's reason for opening the order; do not make the rich endpoint a blank-screen gate.
2. **Orientation checkpoint**: show identity, due/urgency source, freshness, changes since last view, current commitment, and owner.
3. **Decision frame**: show one next safe action when deterministic; otherwise state exactly why the system cannot determine one.
4. **Focused resolution**: open the relevant artwork, gang-sheet/transfer, garment, production, quality, or fulfillment workspace with only the necessary evidence and controls prominent.
5. **Commit boundary**: distinguish local draft, pending write, committed state, conflict, and failed write. Irreversible or externally committed actions require stronger confirmation than reversible local edits.
6. **Consequence state**: identify what changed, which downstream dependency is now satisfied, whether readiness changed, and what comes next.
7. **Exit or handoff**: close safely, retain only intentionally order-scoped drafts, or assign a named next owner with a recoverable checkpoint.

### Device and context variants

- **Desktop / owner or power operator**: keep artwork and production evidence visible while the focused resolver changes; support keyboard acceleration and next-order progression.
- **Embedded mobile / interrupted shop-floor use**: the initial viewport owns orientation, blocker, and next action. Deep evidence is progressively disclosed; the operator should not traverse the desktop pane stack before reaching the selected task.
- **Role handoff**: a designer, receiving operator, production operator, or owner may enter the same order for different reasons. Preserve one canonical state while tailoring the prominent evidence and allowed actions to role/capability rather than duplicating order truth.
- **External-tool handoff**: when work leaves Order Manager, retain the work package identity, expected return evidence, owner, and re-entry action. A generic “open vendor” link without a return contract is incomplete.

### Journey hypotheses to validate

- A representative operator can identify the correct next safe action within 10 seconds without opening another system.
- Current blockers become more useful when each exposes owner, due time, evidence, and a resolution path rather than a badge alone.
- Showing “what changed since last view” reduces history scanning during interruption and shift handoff.
- Separating work state from evidence/knowledge state prevents false release and makes “unknown” actionable.
- Showing the downstream consequence of a commit improves confidence more than decorative motion.
- The three arcs cover most real opens; any common fourth arc should be discovered through representative-order walkthroughs rather than invented from the data model.

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

- [x] Key inline-note drafts by immutable order ID and define close/backdrop/Escape behavior.
- [x] Add the cross-order notes regression test.
- [x] Merge canonical revision, printed count, and readiness flags into the local control model before repaint.
- [x] Add hydration regression coverage for a stale board summary followed by a newer detail response.
- [ ] Correct focusable-element filtering and test wraparound with each tab active. The filter is corrected and contract-covered; authenticated tab-by-tab keyboard acceptance remains pending.
- [x] Capability-gate Edit name and add source-aware copy.
- [x] Fix the missing border token, visible Upload focus, reduced-motion scrolling, nested landmark, and mobile target floor.
- [x] Bring legacy mobile custom-progress and notes mutations under explicit failure/rollback feedback.

### Phase 2 — Validate and specify authoritative workflow

- [ ] Observe or map representative orders: ordinary garment order, artwork-in-design, gang-sheet draft, partial garment receipt, partial transfer receipt, quality hold/remake, local pickup, and shipped order.
- [ ] Approve state names, transition actors, granularity (order/line/placement/work package/sublot), partial-readiness semantics, and override authority.
- [ ] Identify the smallest first schema slice; artwork version/approval, gang-sheet work package, blocker/owner/deadline, and quantity reconciliation are the leading candidates.
- [x] Make “Overview” the default Shopify Order Detail workspace on desktop and mobile, using only current fields until richer workflow semantics are modeled.

### Phase 3 — Versioned data and event contracts

- [ ] Extend the app-owned production schema through an explicit migration/version contract; do not overload existing booleans with new meanings.
- [ ] Keep Shopify commerce immutable and D1 app records rebuildable/relational according to the current data-plane authority.
- [ ] Add append-only events and idempotent transitions with expected revision.
- [ ] Define deterministic next-action/readiness derivation and explainability; keep owner judgment for unresolved tradeoffs.
- [ ] Preserve Legacy Redis isolation and provider-aware identity.

### Phase 4 — Workbench redesign

- [x] Build Overview v1 as the default workspace with current stage, material and print progress, fulfillment, recorded attention, freshness, order facts, and navigation into existing tabs.
- [ ] Add persisted next action/owner/deadline/blocker fields and promote the appropriate summary into the sticky command header after the data contract exists.
- [ ] Add artwork version/approval, materials ledgers, gang-sheet work package, and current blocker stack.
- [ ] Keep commerce and activity as supporting workspaces.
- [ ] Adapt the structure for mobile instead of merely stacking the desktop panes.
- [ ] Apply design tokens and remove always-laid-out closed content/repeated delayed enhancement where safe.

### Phase 5 — Acceptance and rollout

- [x] Run focused syntax, Phase 2, documentation, and diff checks for Overview v1.
- [x] Run the Pages artifact, production upload, and canonical-host release-marker checks for Overview v1.
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
- What are the actual reasons staff open Order Detail, and what percentage of opens follow the routine, blocked, or re-entry/handoff arcs?
- Which external tools participate in artwork, gang-sheet ordering, receiving, and production, and what evidence must return to Order Manager?
- What should “changes since last view” mean for a shared workstation or role account, and whose view timestamp is authoritative?
- When is a handoff an explicit assignment versus an inferred next role, and what prevents an order from becoming ownerless?

### Engineering questions

- Which workstreams belong in the production metafield versus normalized D1 app records?
- How should a gang sheet link several artwork versions and order lines without weakening immutable Shopify identities?
- Which events must be append-only, and which state can be derived from them?
- What is the migration/default behavior for existing orders that have only the four readiness flags?
- How should provider-aware orders advertise mutation capabilities to shared UI controls?

## Progress Log

- **2026-08-24 — Overview v1 production release**: Published production Pages deployment `ca4ad26c` and verified release marker `17876084003N` on the canonical production hostname. Three changed files uploaded and 25 existing files were reused. Worker, database, Shopify scopes/app version, production schema, supplier gateway, and customer/order records were unchanged.
- **2026-08-24 — Overview v1 implementation**: Made Overview the default Shopify Order Detail workspace without changing the production schema. The new workspace derives a transparent navigation recommendation from existing stage, material readiness, print progress, fulfillment, and recorded attention; shows a compact workflow snapshot and order facts; routes into existing tabs; and appears before the artwork/production rail on mobile. No new approval, release, owner, deadline, blocker, artwork-version, gang-sheet, or quality semantics were introduced.
- **2026-08-24 — Phase 1 production release**: Installed the locked dependencies, reran release-level syntax, Phase 1, Phase 2, documentation, and diff checks, built the cache-busted Pages artifact, and published production deployment `5650b797`. The canonical production hostname served release marker `17876050863N`. Worker, database, Shopify scopes/app version, production schema, and supplier gateway were unchanged; authenticated owner acceptance remains pending.
- **2026-08-24 — Phase 1 reliability implementation**: Added provider-aware order draft state, executable cross-order draft and canonical hydration regressions, canonical revision/progress/readiness repaint, rendered-only focus filtering, nested-editor Escape ownership, source-gated customer-name copy, scope-accurate material readiness language, recoverable legacy notes saves, and the bounded mobile/accessibility fixes. Focused syntax and Phase 2 verification pass; authenticated interaction, release, and workflow-state validation remain pending.
- **2026-08-17 — Audit intake**: Preserved the dual-assessment 24/40 audit, separated verified defects from candidate shop states, and defined the reliability-first continuation path. No application behavior or production schema changed.
- **2026-08-17 — Journey + Philosopher exploration**: Reframed Order Detail as a checkpoint for evidence-backed commitments, separated routine, blocked/uncertain, and interruption/handoff arcs, documented the stable orient → decide → resolve → commit → consequence → exit spine, and added a self-contained HTML journey map. All findings remain candidate until representative-order walkthroughs and owner validation.
