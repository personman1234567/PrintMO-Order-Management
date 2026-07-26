---
target: Shopify order detail screen
total_score: 13
p0_count: 2
p1_count: 4
timestamp: 2026-07-26T18-31-03Z
slug: order-manager-web-index-html
---
# Shopify Order Detail Critique and Technical Audit

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 1 | Readiness changes, tab activation, and saves lack reliable visible feedback. |
| 2 | Match System / Real World | 3 | The vocabulary matches PrintMO's workflow. |
| 3 | User Control and Freedom | 2 | Escape paths exist, but several apparent controls are dead and mutations lack recovery. |
| 4 | Consistency and Standards | 1 | New markup, old CSS/enhancement contracts, and a stale web renderer conflict. |
| 5 | Error Prevention | 1 | Four production flags can change without clear sequencing, pending state, or rollback. |
| 6 | Recognition Rather Than Recall | 1 | Artwork is thumbnail-sized and production state is invisible. |
| 7 | Flexibility and Efficiency | 1 | Tabs and artwork selection lack a working keyboard or fast expert path. |
| 8 | Aesthetic and Minimalist Design | 2 | The palette is restrained, but space allocation and nested panels are inefficient. |
| 9 | Error Recovery | 1 | Most failures have no inline diagnosis or retry path. |
| 10 | Help and Documentation | 0 | Readiness semantics and failed affordances are unexplained. |
| **Total** |  | **13/40** | **Poor** |

## Audit Health Score

| # | Dimension | Score | Key finding |
|---|---|---:|---|
| 1 | Accessibility | 1 | Hidden readiness inputs have no replacement state; tabs lack semantics and keyboard behavior. |
| 2 | Performance | 3 | No severe runtime performance issue was proven, but duplicate/conflicting CSS increases layout complexity. |
| 3 | Responsive Design | 1 | The new DOM removed the mobile header and sole-scroll-owner contracts. |
| 4 | Theming | 1 | Inline and hard-coded colors/type sizes drift from DESIGN.md. |
| 5 | Anti-Patterns | 1 | Generic borrowed composition, nested bordered cards, and border-plus-wide-shadow styling are present. |
| **Total** |  | **7/20** | **Poor** |

## Anti-Patterns Verdict

The palette itself is restrained, but the surface has moderate-to-high product slop: it looks familiar while behaving subtly wrong. The source describes the tabs as “Figma/Linear Style,” but the composition is not organized around PrintMO's highest-risk decisions. The result is a generic split-pane shell with a large empty right canvas while the correct artwork, readiness state, and design files are minimized.

The deterministic detector found 11 items in `order-manager-web/index.html`: two `broken-image` warnings, six colors outside DESIGN.md, two type sizes outside the documented ramp, and one flat-type-hierarchy warning. The two missing-`src` image warnings are false positives because `#asset-viewer-img` and `#storage-detail-image` are dynamic targets populated by JavaScript. The color/type findings are legitimate drift signals, although they are lower priority than the broken interaction contracts.

## Overall Impression

The direction is recoverable, but this is not primarily a spacing problem. The new detail markup replaced the functional structure without preserving the selectors and semantics used by the existing renderer, enhancement layer, accessibility layer, desktop CSS, and mobile controller. Fixing this by stacking more CSS overrides would make the regression harder to control. The correct recovery is to restore one coherent detail DOM contract, then implement the new composition on top of it.

## What's Working

- The order-detail data model contains the correct operational ingredients: artwork, production progress, readiness, design files, commerce, logistics, and customer history.
- The restrained white/slate foundation and Action Blue active signal align with the Precision Workbench design system.
- The `+1 Print` and `Custom Amount` controls meet the 44px height requirement.

## Priority Issues

### P0 — The Shopify page loads a stale renderer, so the detail tabs are inert

The root `renderer.js` contains click wiring for `.detail-tab-item`, but `order-manager-web/index.html` loads `order-manager-web/renderer.js`, whose bundled source does not contain that controller. Users cannot reach line items, financials, logistics, or customer history.

Fix: establish one authoritative detail controller for both root and Shopify web surfaces, implement real tab semantics (`tablist`, `tab`, `tabpanel`, `aria-selected`, `aria-controls`, roving focus, arrows/Home/End), reset the active tab on each open, and add a verification contract against the asset the page actually loads.

### P0 — The mobile detail contract was structurally removed

The established mobile implementation expects `#detail-header` and `#detail-content` as the sole vertical scroll owner. The new markup replaces them with `#detail-header-bar` and `#detail-split-canvas`, while `shopify-embedded-mobile.js` still queries `#detail-content`. Existing mobile CSS therefore misses the new structure.

Fix: retain or deliberately remap the canonical header and scroll-owner structure. The detail must fill the embedded app viewport, keep a sticky order header and 44px close action, inert the underlying app, expose a scrollable/sticky tab row, and use exactly one vertical scroll owner. Validate at 320px and 393px.

### P1 — Featured mockup and thumbnail selection contracts were removed

The new markup places `#detail-mockups-track` inside the large frame and leaves `#detail-mockups-strip` empty. The renderer only creates 56px `.mockup-thumb` elements. The enhancement layer expects `#detail-mockup-feature`, `#detail-mockup-main`, `#detail-mockup-main-content`, and `#detail-mockup-count`; because these are gone, selected-preview synchronization exits early. Its capture handler then suppresses non-first thumbnail clicks before calling the no-op sync.

Fix: restore a real selected-preview element and a separate horizontal thumbnail strip. Selection must update the large preview, expose selected state with text/ARIA as well as color, support Enter/Space/arrows, and open the high-resolution viewer from the main preview. Preserve loading, unavailable, one/many asset, and manual-remove states.

### P1 — Readiness controls are visually state-less

The new labels use `.readiness-chip`, but existing CSS hides every checkbox inside `#ready-controls`. The replacement marker/state styles and enhancement logic only apply to `.production-step`, which the new markup removed.

Fix: restore the production-step contract or use visible native checkboxes. Each 44px row needs a visible marker plus explicit state text. Distinguish pending selection from persisted completion, show the count of pending changes, and provide Saving, Saved, Error, Retry, and rollback behavior.

### P1 — Space is allocated opposite to operational importance

The left pane is capped at 38%/580px and contains artwork, print progress, readiness, and design files. The default right tab consumes the remaining space for only customer name and notes. This starves design files while preserving a large empty canvas.

Fix: keep artwork and compact progress/readiness in the production rail, but move the design-file browser into the default production workspace below the compact customer/instructions block. Let empty note regions collapse. Give design files a real min-height, counts, responsive tile/list layout, and their own internal overflow only when needed.

### P1 — The new DOM broke multiple established enhancement and accessibility contracts

The visible close button differs from the close control registered by `accessibility-hardening.js`; design-file markup no longer matches `.design-file-row`; former count/summary elements were removed; status badge text changes without updating its semantic color class.

Fix: create and test an explicit required-selector contract for the detail overlay. Either preserve those selectors or update every consumer in the same change. Do not ship a partial DOM migration.

## Cognitive Load

Six of eight checks fail: single focus, visual hierarchy, one thing at a time, minimal choices, working memory, and progressive disclosure. Chunking and grouping narrowly pass. The most damaging inversion is that empty canvas dominates while the two shop-critical questions—“Is this the correct art?” and “What is actually ready?”—are visually weakest.

## Persona Red Flags

- **Alex, power user:** cannot inspect alternate art quickly, navigate tabs, or use a keyboard tab model.
- **Sam, accessibility-dependent:** hidden checkboxes have no replacement state; tabs lack ARIA and keyboard behavior; the visible close control is not the dialog layer's registered close control.
- **Casey, distracted mobile user:** loses persistent order identity and exit, sees underlying navigation compete with the detail, and must traverse oversized empty blocks.
- **Busy PrintMO owner:** the two highest-risk production checks are the least trustworthy, encouraging manual cross-checks or wrong-production mistakes.

## Minor Observations

- The customer header color inherits styling intended for the former blue header and becomes nearly invisible on the pale header.
- Fulfillment badge text is updated without synchronizing its status class.
- The visible close control is smaller than 44px.
- The 1399px stacking breakpoint is disconnected from the product's 900px mobile boundary and will collapse many embedded laptop views prematurely.
- Emoji tab icons are visually inconsistent across operating systems.
- The new detail card pairs a one-pixel border with a 50px-blur shadow, matching the banned ghost-card pattern.

## Questions to Consider

- Should the primary detail workflow be organized by Shopify data categories, or by the shop decision sequence: verify art, confirm materials/prints, record output, then inspect fulfillment?
- Are the four readiness flags independent facts or a sequence? The interface should encode the answer.
- Is there a product reason to maintain two different order-detail controllers, or should one canonical detail contract serve Electron and Shopify web?
