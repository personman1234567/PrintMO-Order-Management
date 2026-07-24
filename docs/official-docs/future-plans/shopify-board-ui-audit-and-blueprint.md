# Shopify Board UI Audit & Information Blueprint

- **Status**: `[Spec Ready]`
- **Owner / Target Milestone**: `v1.4 Shopify cutover polish`

## Summary & Intent

This plan turns the proven Shopify/D1/R2 candidate into a calmer, more informative production workspace without changing its data-plane boundaries. It covers the collapsed order cards, dashboard hierarchy, responsive behavior, and the relationship between summary cards and on-demand detail.

The visual direction remains PrintMO's existing **Precision Workbench**: white and cool-slate surfaces, system UI typography, compact production density, and Action Blue only for active state or the primary action. This is a refinement of the established product, not a replacement design.

This document is planning-only. No dashboard or card redesign described here is active until separately implemented and verified. The Legacy Redis view is outside the redesign scope and must remain behaviorally and visually unchanged during Shopify-board iteration.

## Audit Scope & Evidence

The audit reviewed:

- `order-manager-web/index.html`
- `order-manager-web/desktop.css`
- `order-manager-web/mobile.css`
- `order-manager-web/accessibility-hardening.css`
- `order-manager-web/shopify-preview.css`
- `order-manager-web/dashboard-triage-enhancements.js`
- `order-manager-web/detail-overlay-enhancements.js`
- shared `renderer.js`
- the current desktop Shopify-board and detail screenshots verified on 2026-07-23
- `PRODUCT.md`, `DESIGN.md`, and the current UI container reference

The Impeccable static detector reported 750 candidate findings:

- 13 warnings: 6 layout-property transitions, 4 side-accent treatments, 2 intentionally empty viewer images, and 1 bounce-like easing.
- 737 design-system advisories: 491 literal colors, 181 off-ramp font sizes, and 65 off-ramp radii.

The two empty image findings are not current broken-image defects: the hidden asset/storage viewers assign `src` only when opened. The remaining counts are directional evidence, not 748 independent backlog items. They point to three systemic problems: CSS accumulation, token drift, and inconsistent component vocabulary.

Current stylesheet size also confirms accumulation:

| File | Approximate lines | Literal hex colors | Design-token uses | `!important` uses |
|---|---:|---:|---:|---:|
| `desktop.css` | 5,478 | 572 | 3 | 35 |
| `mobile.css` | 6,146 | 489 | 26 | 40 |
| `accessibility-hardening.css` | 98 | 7 | 0 | 9 |
| `shopify-preview.css` | 897 | 117 | 0 | 1 |

The established palette itself is sound. Verified examples include muted slate on Cool Canvas at 4.55:1, muted slate on white at 4.76:1, and white on Action Blue at 4.51:1. The problem is not the core colors; it is the large number of ungoverned near-duplicates around them.

## Audit Health Score

| # | Dimension | Score | Key finding |
|---|---|---:|---|
| 1 | Accessibility | 3/4 | Focus containment, keyboard movement, labels, and live announcements are present; several compact controls and dense states still fall short of the 44px product target. |
| 2 | Performance | 2/4 | The board awaits hydration of every private asset before rendering and retains object URLs for the session; accumulated CSS and layout-property transitions add avoidable work. |
| 3 | Responsive design | 3/4 | Mobile is a complete workflow with dedicated navigation and detail layouts, but extensive override layers make behavior difficult to reason about and regress safely. |
| 4 | Theming | 1/4 | `DESIGN.md` has a coherent token vocabulary, but live CSS overwhelmingly uses hard-coded values and parallel near-duplicate ramps. |
| 5 | Anti-patterns | 3/4 | The product feels purpose-built, not like a generic AI dashboard; nested cards, side accents, excess pills, and repeated container treatments weaken the hierarchy. |
| **Total** |  | **12/20** | **Acceptable; operationally credible, with significant polish and maintainability work remaining.** |

## Anti-Patterns Verdict

**Pass, with qualifications.** The surface does not look like a generic generated dashboard. It clearly reflects PrintMO's actual production workflow, uses real order assets, and has a recognizable blue/slate identity.

The risks are accumulated product-UI habits rather than a wholesale visual failure:

- too many bordered/rounded containers inside bordered/rounded panels;
- header color doing the job that explicit stage and next-action text should do;
- pills used for filters, counts, status, age, and warnings without enough hierarchy between them;
- multiple one-off blue, slate, green, warning, radius, and font-size values;
- side-accent and inset-stripe treatments in a few states;
- a bounce-like easing and width/height transitions in a task-focused tool.

## Executive Summary

- **Audit Health Score:** 12/20 (Acceptable)
- **Actionable findings:** 0 P0 after the detail-open regression repair; 4 P1; 6 P2; 3 P3
- **Best existing qualities to preserve:** real workflow topology, compact information density, full mobile capability, strong keyboard/focus hardening, private asset handling, and the blue/slate Precision Workbench identity.
- **Highest-value change:** redesign the order card around identity, attention, stage/next action, and quantities before adding any more fields.
- **Most important implementation constraint:** card data must remain list-query data. Shipping addresses, conversion history, full timeline, and other rich detail stay on the on-demand order endpoint.

## Detailed Findings

### P1 — Board rendering waits for all private asset bytes

- **Location:** `order-manager-web/web-shim.js`, `loadCandidateQueue()` and `hydrateCandidateAssets()`
- **Category:** Performance
- **Impact:** A slow or unavailable asset ticket/object can delay the whole board even though order text and production state are already usable. Up to 500 orders can be enumerated, and every discovered asset is hydrated before the first card render.
- **Recommendation:** Render summary DTOs immediately. Hydrate only the visible card's primary mockup with bounded concurrency; hydrate the rest of an order's assets only when its detail screen opens. Revoke object URLs when cards leave the active result set or the source changes.
- **Suggested command:** `$impeccable optimize`

### P1 — Collapsed cards do not state the operational decision

- **Location:** shared `renderer.js`, `makeCard()`; `.pipeline-card` styles
- **Category:** Anti-pattern / product hierarchy
- **Impact:** Order number, age, customer, counts, mockup, and subtotal are visible, but stage, blocker, fulfillment method, and next action are either inferred from location/color or absent. Operators must mentally reconcile the card with the surrounding panel.
- **Recommendation:** Give every card one explicit production-state label and one compact attention/next-action line. Keep the information order consistent across every stage.
- **Suggested command:** `$impeccable layout`

### P1 — Untrusted order strings are interpolated into HTML

- **Location:** shared `renderer.js`, `makeCard()` and line-item rendering in `openDetail()`
- **Category:** Security / hardening
- **Impact:** Customer names, product titles, variants, and asset URLs originate outside the renderer and are inserted through `innerHTML`. A malicious or malformed value could alter the DOM inside the embedded admin.
- **Recommendation:** Build card and detail rows with DOM nodes and `textContent`; validate image protocols before assigning `src`. If templates remain temporarily, use one well-tested escaping function for every text and attribute context.
- **Suggested command:** `$impeccable harden`

### P1 — The design system exists on paper but not as a live token layer

- **Location:** all four web stylesheets
- **Category:** Theming / maintainability
- **Impact:** Visual changes require hunting through hundreds of near-duplicate literal values. Fixes stack as later overrides, making desktop/mobile parity and contrast regression harder to guarantee.
- **Recommendation:** Introduce a small CSS custom-property layer matching `DESIGN.md`: canvas, surface, ink, text, muted, border, action, semantic states, spacing, radii, and elevation. Migrate one component family at a time; do not perform a blind global replacement.
- **Suggested command:** `$impeccable extract`

### P2 — Container hierarchy is visually over-segmented

- **Location:** `.panel`, `.sub-section`, detail `.detail-section`, context chips, summary metrics
- **Category:** Anti-pattern / hierarchy
- **Impact:** When every group has a border, radius, fill, or shadow, the eye cannot tell which boundaries represent workflow versus decoration.
- **Recommendation:** Keep strong containment for the three workflow regions and temporary overlays. Within them, prefer spacing, dividers, aligned rows, and tonal sections over nested cards.
- **Suggested command:** `$impeccable distill`

### P2 — Status relies too heavily on blue/green/yellow surfaces

- **Location:** card header/footer state classes and production readiness treatments
- **Category:** Accessibility / clarity
- **Impact:** Color and position communicate more than the words do. This is slower to scan and less robust for color-vision differences.
- **Recommendation:** Pair every state with a short text label and reserve semantic color for a small badge/icon or completion marker. Do not recolor the whole card header just to indicate readiness.
- **Suggested command:** `$impeccable clarify`

### P2 — Compact action targets are inconsistent

- **Location:** accessibility move buttons and several desktop chips/controls
- **Category:** Accessibility / responsive
- **Impact:** Some desktop controls are 36px high while the product standard is 44px. They are usable with a mouse but weaker for touch, zoom, or hurried shop-floor use.
- **WCAG/standard:** WCAG 2.2 target-size guidance; project `DESIGN.md` 44px requirement.
- **Recommendation:** Make primary operational controls 44px. Allow compact 36px controls only for secondary desktop-only actions with sufficient spacing and a 44px mobile override.
- **Suggested command:** `$impeccable adapt`

### P2 — Board filters explain categories but not resulting work

- **Location:** Pipeline filter chips and sort control
- **Category:** Clarity
- **Impact:** “Attention,” “Stale,” “No Mockup,” and “Ready” are useful, but the board does not summarize why the current result set needs action or what filter combination is active when the list becomes small/empty.
- **Recommendation:** Add one concise result sentence above the list, such as “11 orders need attention · 9 missing a mockup,” and a visible reset when any non-default filter is active.
- **Suggested command:** `$impeccable clarify`

### P2 — Desktop and mobile CSS are override histories, not one component contract

- **Location:** `desktop.css` and `mobile.css`
- **Category:** Responsive / maintainability
- **Impact:** Similar selectors are redefined many times. A safe local change can be silently overridden hundreds or thousands of lines later.
- **Recommendation:** Extract card, toolbar, workflow-panel, and detail primitives into shared component sections. Keep only structural breakpoint changes in mobile rules.
- **Suggested command:** `$impeccable adapt`

### P2 — Layout-property transitions and bounce easing do not fit the task

- **Location:** detector-confirmed width/height transitions and `cubic-bezier(..., 1.12)`
- **Category:** Performance / anti-pattern
- **Impact:** Width/height animation can cause extra layout work; overshoot motion feels decorative in a production tool.
- **Recommendation:** Use 150–220ms opacity/transform transitions with ease-out-quart. For expandable content, use an instant state change or a controlled grid-row pattern, and preserve reduced-motion behavior.
- **Suggested command:** `$impeccable animate`

### P3 — Two hidden viewer images trigger static broken-image warnings

- **Location:** `#asset-viewer-img`, `#storage-detail-image`
- **Category:** Markup polish
- **Impact:** No observed user-facing defect because both containers are hidden until a source is assigned, but the lifecycle is implicit.
- **Recommendation:** Keep the image hidden until `src` is assigned and remove `src` plus restore the hidden state on close.
- **Suggested command:** `$impeccable harden`

### P3 — Side-accent treatments are inconsistent with the established system

- **Location:** detector-confirmed desktop side borders/inset stripes
- **Category:** Anti-pattern
- **Impact:** These accents introduce a second state grammar beside badges, fills, and timeline markers.
- **Recommendation:** Replace with a full subtle state background, a compact leading status icon, or the existing badge vocabulary.
- **Suggested command:** `$impeccable quieter`

### P3 — Detail repeats some order summary information

- **Location:** detail header summary and Customer context chips
- **Category:** Hierarchy
- **Impact:** Order number, received time, and item counts appear in more than one nearby group.
- **Recommendation:** Keep order identity, customer, stage, age, and total in the sticky header. Use the first content section for contact/delivery/notes rather than repeating header facts.
- **Suggested command:** `$impeccable distill`

## Positive Findings

- The Shopify board reuses a proven operational workflow rather than falling back to a generic table.
- The current source switch keeps the Legacy Redis board isolated from Shopify candidate writes.
- Keyboard users receive explicit card-open and stage-move controls, focus containment, focus restoration, Escape handling, and live announcements.
- Reduced-motion handling exists for the accessibility control layer.
- The mobile view preserves the complete workflow instead of becoming read-only.
- Order detail is loaded on demand, protecting Shopify rate limits and initial board responsiveness.
- Private Designer Studio assets use authenticated short-lived tickets and object URLs rather than exposing R2 object keys.
- The core Action Blue/slate palette meets AA on the documented principal combinations.
- The existing cards already establish a useful scan rhythm: order/age, visual, customer, quantities, and money.

## Blueprint: The Production Signal Card

### Primary job

A collapsed card must answer, in order:

1. **Which order is this?**
2. **Does it need attention now?**
3. **Where is it in production, and what happens next?**
4. **What am I producing?**
5. **Is the order financially/fulfillment-wise safe to act on?**

It must not attempt to reproduce the entire detail screen.

### Information anatomy

```text
┌──────────────────────────────────────────────┐
│ #1571             Received · 1d        [•••] │
│ Emory Neeman                  [Needs mockup] │
├──────────────────────────────────────────────┤
│ [primary mockup]  1 apparel · 2 prints       │
│                   Terracotta / Small          │
│                   Ground Advantage            │
├──────────────────────────────────────────────┤
│ Next: add to blanks cart       $26.17 · Paid │
└──────────────────────────────────────────────┘
```

This is one card with three bands, not nested cards.

### Required card fields

| Priority | Field | Presentation | Source/budget rule |
|---|---|---|---|
| 1 | Order number | Strong first item | Shopify summary |
| 1 | Production stage | Text badge, never color alone | Canonical app-owned metafield |
| 1 | Age/staleness | Relative time; warning only after threshold | Shopify summary + local calculation |
| 1 | Attention | At most one primary reason on card; `+N` for more | D1/production attention |
| 1 | Customer | One line, safe truncation | Shopify summary/protected data when returned |
| 1 | Primary mockup | Fixed-ratio preview or informative empty state | R2 manifest; lazy visible-card hydration |
| 1 | Apparel/print quantities | Icon + text/accessible label | Shopify summary line items |
| 1 | Next action | Plain-language footer line | Derived from stage/readiness/attention |
| 2 | Payment state | Quiet semantic badge | Shopify summary |
| 2 | Fulfillment/delivery type | One short label (`Ship`, `Pickup`, method when already available) | Summary only; never trigger per-card detail fetch |
| 2 | Total | Right-aligned money | Shopify summary |
| 2 | Representative variant | One line; use `+N more` | Shopify summary line items |
| 3 | Bundle | Compact identity modifier | Canonical production metadata |
| 3 | Sync freshness | Show only when stale/error, not when healthy | D1 projection metadata |

### Attention hierarchy

Only one high-attention message occupies the card:

1. Sync/reconciliation failure
2. Payment or cancellation problem
3. Missing required production asset
4. Stale at current stage
5. Readiness/next-step requirement

Additional reasons collapse into `+N`. A card must never show separate “Attention,” “Stale,” and “Missing files” pills for the same root problem.

### Asset states

- **Ready:** show the primary mockup.
- **Loading:** reserve the same aspect ratio with a neutral skeleton; do not delay card text.
- **No design expected:** show no warning; use a quiet garment placeholder.
- **Design expected but unresolved:** show “Mockup missing” with a text cue.
- **Asset unavailable:** retain the order card and controls; show “Preview unavailable.”

## Blueprint: Dashboard

### Desktop topology

Keep the familiar three-work-region model:

1. **Pipeline** — new/received work and triage.
2. **Blanks Cart** — orders selected for supplier batching.
3. **Production & Fulfillment** — blanks ordered and ready-to-print work.

Refine the hierarchy rather than adding a metric-card row:

- A single compact command bar owns source, search, filter, sort, refresh, and last-sync feedback.
- Each work region has one title, count, and one primary action cluster.
- Filters belong to the region they affect.
- The active result summary sits directly above the cards.
- Empty regions explain the next valid action instead of displaying a large blank box.
- Inner sub-sections use dividers and headings, not another full card shell unless they are independent drop targets.

### Command bar

Left-to-right on desktop:

1. `Shopify board` source indicator/switch
2. Search by order/customer
3. Filter control with active-count badge
4. Sort control
5. Last successful sync + stale/error state
6. Refresh

“Storage Browser” remains navigation, not an order-filter action, and should be visually separated from refresh/source controls.

### Pipeline region

- Default sort: needs attention, then oldest stage age.
- Filter vocabulary: All, Needs attention, Missing mockup, Stale, Ready for next step.
- Show a concise result sentence.
- Cards use a stable minimum width; increase information vertically before shrinking type.
- Do not visually elevate every card equally. Selected, dragging, stale, and failed are the only elevated/semantic exceptions.

### Blanks Cart region

- The drop/staging area and selected-order list are one workflow.
- Empty state: “Drag orders here to build the next blanks order.”
- Sticky summary shows order count, garment pieces, estimated supplier lines, and the one primary submit action.
- Supplier-specific detail stays in the batch review, not on each order card.

### Production & Fulfillment region

- Preserve separate Blanks Ordered and Ready to Print queues.
- Give each a count and meaningful empty state.
- Use the same card anatomy, with the next-action line adapting to `receive blanks`, `start printing`, or `complete printing`.
- Printed progress replaces, rather than competes with, the ordinary next-action line when an order is actively printing.

### Responsive behavior

At `<=900px`, preserve complete capability:

- Bottom navigation selects Pipeline, Blanks, Print, or Storage.
- Source switching lives in one secondary sheet or compact control, not a second persistent navigation row.
- Cards become full-width list rows with a 96–120px preview and the same information priority.
- Card actions remain 44px and are exposed through a standard overflow/action sheet; drag remains optional when accessible move actions exist.
- Detail becomes a full-height surface with a sticky identity/stage header and section navigation.
- No horizontal order-card grid and no clipped dropdown inside a scrolling panel.

## Detail Relationship

The detail screen is the second layer, not a larger card. It owns:

- complete customer/contact/delivery information;
- all line items and custom attributes;
- all mockups and design files;
- notes and tags;
- editable production stage/readiness/progress;
- complete totals, discounts, payment/fulfillment context;
- recent Shopify timeline and audit context.

Open detail from any card without fetching these fields in the list query. Show the overlay immediately with known summary data, then progressively fill rich sections from `GET /order-manager/v1/orders/:gid`. A detail-fetch failure must leave the summary and retry action visible.

## Key States & Copy

| State | Required behavior/copy |
|---|---|
| Initial loading | Render board structure and card skeletons; do not block on artwork bytes. |
| Refreshing | Keep the current board visible; show “Refreshing…” in the command bar. |
| Fresh | Quiet “Updated just now” feedback; no success toast per routine refresh. |
| Stale projection | Preserve cards and show “Showing last synced data · Retry.” |
| Empty pipeline | “No incoming orders match these filters.” Include reset when filtered. |
| Empty blanks cart | “Drag orders here to build the next blanks order.” |
| Empty production queue | “No orders are waiting at this stage.” |
| Missing mockup | “Mockup missing,” only when a design is expected. |
| Failed detail | Keep summary visible: “Couldn’t load full order details. Retry.” |
| Saved production change | Inline “Saved” near the changed control; revision conflict offers refresh/retry. |
| Archived/cancelled | Remove from active workflow through explicit state handling, not a silent disappearance. |

## Implementation Sequence

### Pass 1 — Contract and tokens

- [ ] Define the card summary view model and derived attention/next-action rules.
- [ ] Confirm every card field is available from the bounded board DTO.
- [ ] Add shared CSS tokens that exactly map to `DESIGN.md`.
- [ ] Add fixture states for no asset, stale, attention, bundle, partial readiness, and active printing.

### Pass 2 — Card

- [ ] Build the Production Signal Card with DOM APIs/escaped content.
- [ ] Make visible-card mockup hydration lazy and failure-isolated.
- [ ] Preserve keyboard open/move actions and 44px touch controls.
- [ ] Verify visual and accessible state without relying on color.

### Pass 3 — Dashboard

- [ ] Consolidate command bar and result summary.
- [ ] Simplify panel/sub-section containment.
- [ ] Replace empty boxes with workflow-specific empty states.
- [ ] Preserve drag/drop, batching, bundle, and source isolation.

### Pass 4 — Responsive and hardening

- [ ] Consolidate shared component CSS and leave structural changes in breakpoint files.
- [ ] Test 320px, 375px, 768px, 1024px, 1440px, Shopify iframe constraints, and 200% zoom.
- [ ] Test keyboard-only, reduced motion, slow assets, asset failure, stale D1, and detail failure.
- [ ] Re-run Impeccable audit and target at least 18/20 before calling the redesign polished.

## Acceptance Criteria

- The Legacy Redis view has no changed rendering or mutation behavior.
- Shopify board first meaningful order text is not delayed by asset hydration.
- Every card names its stage and next action without relying on panel position or color.
- A normal card shows no more than one high-attention message.
- No card fetches rich detail on page load.
- All text/attribute data is safely rendered.
- All primary operational controls are at least 44px in touch layouts.
- Empty, loading, stale, partial-error, and asset-error states preserve usable work.
- Desktop and mobile expose the same operational capability.
- CSS values are drawn from the documented token layer except for reviewed, named exceptions.
- Syntax, Phase 2 verification, accessibility checks, and representative Shopify-board workflows pass.

## Recommended Impeccable Execution Order

1. **[P1] `$impeccable harden`** — eliminate unsafe HTML interpolation and define resilient partial/error states.
2. **[P1] `$impeccable optimize`** — decouple first render from private asset hydration.
3. **[P1] `$impeccable extract`** — make `DESIGN.md` a real shared token/component vocabulary.
4. **[P1] `$impeccable layout`** — implement the Production Signal Card and board hierarchy.
5. **[P2] `$impeccable adapt`** — consolidate responsive contracts and verify constrained Shopify viewports.
6. **[P2] `$impeccable clarify`** — finalize state, attention, empty, and next-action copy.
7. **[P3] `$impeccable animate`** — replace layout/bounce motion with restrained state feedback.
8. **[P3] `$impeccable polish`** — final visual/interaction consistency pass.

Re-run `$impeccable audit` after these passes and record the new score here.

## Open Questions & Brainstorming

No blocking visual-direction question remains. The restrained light Precision Workbench is established by `PRODUCT.md`, `DESIGN.md`, and the current Shopify Admin environment. Before implementation, the owner should confirm only the exact stage-age thresholds that define “stale”; those are operational policy, not a visual choice.

## Progress Log

- **2026-07-23**: Impeccable technical audit completed against the live candidate code and verified Shopify-board/detail screenshots. Blueprint established for cards, dashboard, states, responsive behavior, and implementation order. No redesign code shipped in this pass.
- **2026-07-23**: The separate detail-open compatibility repair shipped in Pages deployment `3da86eec`; this does not implement any part of the planned redesign.
