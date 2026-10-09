---
version: alpha
name: PrintMO Order Management
description: The precision workbench for PrintMO's complete order-production workflow.
colors:
  action-blue: "#1A73E8"
  action-blue-hover: "#1765C1"
  ink: "#0F172A"
  text: "#334155"
  muted: "#64748B"
  canvas: "#F8FAFC"
  surface: "#FFFFFF"
  border: "#CBD5E1"
  success: "#16A34A"
  success-soft: "#DCFCE7"
  warning: "#92400E"
  danger: "#B42318"
typography:
  headline:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0em"
  title:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "1.2rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0em"
  body:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "0.95rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0em"
  label:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "0.78rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0em"
  caption:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "0.72rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0em"
rounded:
  card: "8px"
  control: "10px"
  section: "12px"
  panel: "22px"
  full: "999px"
spacing:
  micro: "4px"
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
components:
  button-primary:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "8px 14px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.action-blue-hover}"
    textColor: "{colors.surface}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "44px"
  filter-chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "6px 10px"
  filter-chip-active:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.surface}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "44px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "16px"
  order-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "8px"
---

# Design System: PrintMO Order Management

## Overview

**Creative North Star: "The Precision Workbench"**

The interface should feel like a well-organized production surface: every tool and piece of order information has a clear place, the next action is visible, and nothing competes for attention without an operational reason. The visual register is restrained and work-focused, using a white and slate foundation with Action Blue reserved for active state and primary action.

Density is allowed because this is a real shop tool, but structure must do the work. Spacing, alignment, type weight, progressive disclosure, and consistent state styling should make complex order data feel calm. Desktop and mobile are two complete arrangements of the same workflow; mobile is not a reduced companion.

The system explicitly rejects generic dashboard conventions that are disconnected from PrintMO's real workflow, visual density that becomes noisy or overwhelming, and unrelated card accumulation as the product expands.

**Key Characteristics:**

- Purpose-built around the order-production sequence
- Compact, legible, and low-noise
- Clear state, urgency, and action hierarchy
- Complete capability across desktop and Shopify Admin mobile viewports
- Modular enough to accept new stages without losing coherence

## Colors

The palette is a restrained operational system: crisp neutral surfaces, dark slate information, Action Blue for interaction, and semantic colors only when they communicate real status.

### Primary

- **Action Blue:** The rare high-attention color for the current view, primary actions, selection, and focus. It must always carry meaning.
- **Pressed Action Blue:** The darker response color for hover, pressed, and committed-action states.

### Secondary

- **Production Green:** Completion, successful saves, and positive production state.
- **Completion Wash:** A low-chroma success surface that supports green text and icons without flooding the interface.
- **Attention Umber:** Warnings and work that needs review, never decorative warmth.
- **Failure Red:** Errors, destructive consequences, and failed operations only.

### Neutral

- **Shop Ink:** Primary headings, critical order identifiers, and high-value data.
- **Working Slate:** Default labels, controls, and supporting content.
- **Muted Slate:** Secondary metadata that remains readable at WCAG AA contrast.
- **Cool Canvas:** The app background and scrollable work areas.
- **Tool Surface:** Panels, cards, fields, and overlays.
- **Structural Line:** Dividers, input outlines, and quiet component boundaries.

### Named Rules

**The One Active Signal Rule.** Action Blue marks what is active or what should happen next; it is forbidden as ambient decoration.

**The Status Must Mean Something Rule.** Green, umber, and red appear only when the underlying order state justifies them, and every state also has a text or icon cue.

## Typography

**Display Font:** System UI sans-serif
**Body Font:** System UI sans-serif

**Character:** One familiar interface family keeps the tool fast, native-feeling, and readable inside Shopify Admin. Hierarchy comes from weight, size, spacing, and placement rather than a decorative type pairing.

### Hierarchy

- **Headline** (700, 1.5rem, 1.2): Page and major overlay titles only.
- **Title** (700, 1.2rem, 1.2): Panel headers and high-level workflow regions.
- **Body** (400, 0.95rem, 1.4): Instructions, order detail, notes, and supporting content.
- **Label** (700, 0.78rem, 1.2): Controls, compact status labels, table headers, and action text.
- **Caption** (600, 0.72rem, 1.3): Timestamps, counts, and secondary metadata; never reduce contrast to make it disappear.

### Named Rules

**The Scan Before Read Rule.** Order number, customer, status, blocker, and next action must be distinguishable before the user reads supporting detail.

**The No Decorative Type Rule.** Display fonts, excessive tracking, and oversized fluid headings are forbidden in this task surface.

## Elevation

Depth is light and structural. Borders and tonal layers separate most content; shallow shadows distinguish movable cards and primary panels. Strong elevation is reserved for temporary overlays, drag ghosts, and the mobile navigation dock where physical separation from scrolling content is necessary.

### Shadow Vocabulary

- **Card Rest** (`0 1px 3px rgba(15, 23, 42, 0.08)`): Movable order cards and small raised controls.
- **Panel Rest** (`0 2px 6px rgba(0, 0, 0, 0.10)`): Main workflow panels when a tonal boundary is insufficient.
- **Section Lift** (`0 2px 9px rgba(15, 23, 42, 0.05)`): Detail sections and nested operational groups.
- **Overlay Lift** (`0 18px 44px rgba(15, 23, 42, 0.28)`): Dialogs and drag previews only.

### Named Rules

**The Structural Shadow Rule.** A shadow must explain stacking or movement. Never pair a one-pixel decorative border with a wide soft shadow on an ordinary card or button.

**The One Floating Layer Rule.** Translucency and backdrop blur are reserved for the compact mobile dock; they must not spread to panels or cards.

## Components

### Buttons

- **Shape:** Compact and tactile with 10px corners for ordinary controls or full-pill treatment for view switching; mobile targets are at least 44px high.
- **Primary:** Action Blue with white text, used once per decision cluster.
- **Hover / Focus:** Darken on hover, compress subtly on press, and show a visible 2px focus outline with offset. Disable decorative motion under reduced-motion preferences.
- **Secondary:** White or Cool Canvas with Working Slate text and a Structural Line border; never compete with the primary action.

### Chips

- **Style:** Full-pill filters with compact counts, white at rest and Action Blue when selected.
- **State:** Selected state changes background, text, and `aria-pressed` or `aria-selected`; count badges inherit the state rather than introducing another color.

### Cards / Containers

- **Corner Style:** Order cards use 8px corners; internal sections use 12px; the 22px panel radius is reserved for the largest workflow containers.
- **Background:** Tool Surface over Cool Canvas.
- **Shadow Strategy:** Card Rest for movable cards; flat tonal grouping for static content where possible.
- **Border:** Use Structural Line only when it clarifies grouping or interaction.
- **Internal Padding:** 8px for dense cards, 12px for operational groups, and 16px for major panel content.

### Inputs / Fields

- **Style:** White field, Structural Line outline, 10px corners, body-size text, and a 44px mobile minimum height.
- **Focus:** Action Blue border plus a clearly visible focus ring; never rely on color alone.
- **Error / Disabled:** Explain the problem or limitation in plain language. Disabled controls remain readable and must not look interactive.

### Navigation

Desktop navigation uses quiet pill controls with one Action Blue active state. Mobile uses a five-destination bottom dock because the constrained Shopify Admin viewport cannot present the three-column desktop topology. Labels remain available to assistive technology even when compact icon presentation is required.

### Order Workflow Card

The order card is the signature component. It prioritizes order identity, customer, mockup availability, stage, urgency, and production state while keeping secondary detail behind the detail view. Drag feedback must preserve spatial continuity; selection and drag state must never be visually confused.

### Shopify Order Pipeline

The Shopify Pipeline keeps the order workspace visible and moves filtering and sorting into a compact View overlay. This is a local component adaptation of the Precision Workbench.

- **Header:** A single row (64px minimum height, 8px by 12px padding) places the heading, plain count, Orders / Draft Orders tabs, and View trigger together at desktop column widths such as 544px. The count uses tabular numerals and shows visible/total when filtered. The text-led active tab uses blue text and a 2px underline; it does not inherit the filled-pill navigation treatment.
- **Responsive arrangement:** At Pipeline column widths of 490px or less, or mobile viewport widths of 900px or less, the header uses two rows: heading/count and selection above tabs/View. Tabs and controls retain at least 44px targets. Preserve the Pipeline's existing inner scroll ownership.
- **View overlay:** The named, nonmodal Pipeline view dialog is portaled to the document body and uses the native popover top layer when available, with a fixed-position fallback. It is at most 300px wide, fits within 12px viewport margins, and scrolls internally when height is constrained. Checkmarked filter rows with aligned counts offer All, Attention, Stale, No Mockup, and Ready. A labeled sort select offers Newest first, Needs attention, Oldest first, and Highest total; Reset view restores the defaults.
- **State and accessibility:** Each fresh page load starts Shopify at All / Newest first. Manual filter and sort choices remain during the visit, including source/view switching. A blue indicator marks a nondefault view, and the trigger's accessible label and tooltip summarize the current filter and sort. Opening focuses the selected filter; Escape or Close restores trigger focus. Clicking outside or moving focus outside dismisses the overlay, as does leaving the Orders workspace. Draft Orders hides the order count, selection controls, and View trigger.
- **Scoped visual details:** The compact heading (1rem), overlay body (.875rem/1.4), hover corners (6px), quiet divider (#E2E8F0), trigger hover wash (#F1F5F9), and selected-filter wash (#EFF6FF) belong to this Pipeline component. The white overlay uses 12px corners and a structural shadow (`0 8px 24px rgba(15, 23, 42, .18)`); keyboard focus uses the existing 2px Action Blue outline. These adaptations do not extend the global type, color, radius, or elevation scales.
- **Boundary:** Legacy Redis retains its inline triage toolbar and All / Needs attention defaults, with separate visit state. This component does not redefine order cards, Draft Orders internals, other panels, or global navigation.

### Shopify Order List Selection / Review

The candidate List preview extends the Precision Workbench with exact-order selection and reviewed actions. Board remains the default; these conventions are local to `order-list-foundation.js/.css` and `order-list-workflows.js`.

- **Selection and hierarchy:** Keep the existing eight table columns; place a 44px checkbox target beside order identity rather than adding an action column. Selected rows use the existing pale-blue wash (#EFF6FF). A compact shared strip shows the selected count, Clear selection, one action dropdown, and the blue Review action button. Explain unavailable actions in a quiet Action availability disclosure. Selection covers only matching orders currently shown and is reconciled when the view changes; bundle membership never silently expands the selected set.
- **Review:** Use a named native modal with an explicit order list, action consequence, optional required field, Cancel, and Confirm action. The white dialog is at most 560px wide with 16px viewport margins, 12px corners, 24px padding, and internal scrolling; reduce padding to 16px at 600px or less. Keep confirmation separate from choosing an action and return focus to the available source control.
- **Results and recovery:** Present saved and unresolved outcomes as text in a compact disclosure above the order scroller. Expand partial results, identify each order, and retain unresolved selection. Offer reviewed retry only for known remaining steps; uncertain supplier outcomes require inspection. The result region is bounded to 25vh and the selection strip to 28vh so order browsing retains space.
- **Responsive arrangement:** Below 1200px, preserve all eight fields in labeled two-column cards with identity and stage spanning the card. At 600px or less, contain stage filters in one horizontal scroller and arrange selection controls in two columns with the dropdown spanning both. Keep the order list as the inner vertical scroll owner, 44px control targets, readable wrapping, and a visible 2px dark-blue focus outline with 3px offset. Announce selection and save feedback through a polite status region.
- **Visual boundary:** Reuse system sans, white surfaces, slate text, restrained borders, 8px control corners, and the incumbent dark Action Blue (#1765C1). The dialog's dim backdrop (`rgb(15 23 42 / .4)`) establishes its temporary layer. These are component adaptations, not new global tokens or a new visual world.

### Shopify Draft Browse / Tiles

Draft browsing extends the Pipeline workbench with compact artwork-preparation tiles. These conventions apply only inside the Draft Orders workspace.

- **Browse controls:** Leave 16px between the Pipeline header and the workspace controls. Use two rows with an 8px gap: a full-width search field with an embedded submit icon, then the status select, a quiet count of drafts shown, and a refresh icon. Submit and refresh retain 44px targets and explicit accessible names; the count uses tabular numerals and a polite live region.
- **Grid and tile shape:** Use two equal columns with a 12px gap when each tile can be at least 220px wide; switch to one column at browse widths of 451px or less. Align tiles at the top and let their content determine height rather than stretching a tile without artwork to match its illustrated neighbor. Tiles retain white surfaces, 8px corners, 12px padding, and visible keyboard focus.
- **Information order:** Lead with draft identity and a quiet text status, then the mockup when present, customer, item quantity and total, artwork counts, and updated date. Keep customer names wrapping, totals aligned and unbroken, and secondary metadata readable. Show an explicit Artwork sync pending message when that state applies.
- **Mockup treatment:** Reserve a full-width 16:9 frame only for an attached mockup. Fit the complete image inside it with contain sizing. Drafts without a mockup use a compact No mockup line instead of an empty image frame. Retain the same frame through idle/loading and unavailable-preview states so resolving an image does not change the tile's geometry; show Loading preview… or Preview unavailable until the image can be displayed.
- **Loading and feedback:** Initial/reset loading uses static tile skeletons with no shimmer. Keep loading and error text separate from the decorative skeletons, expose list busy state, and provide recovery through Refresh drafts or Load more drafts. Appending drafts preserves existing tiles and resolved images; previews load as their tiles approach the workspace viewport.

### Shopify Draft Artwork Detail

The opened Shopify draft uses a focused, file-first artwork workspace in a native modal dialog. It extends the existing Order Detail workbench without changing the global visual system or commerce workflow.

- **Dialog and scroll ownership:** The desktop dialog is at most 1200px wide with 20px viewport margins (`min(1200px, calc(100vw - 40px))`) and is `min(92dvh, 960px)` high. Its 16px corners and Overlay Lift establish one temporary layer above the pipeline. Keep the identity header outside the scrolling body; only that body scrolls, with contained overscroll. The header uses 20px by 24px padding and the body 24px padding. Returning to Drafts restores the visit's search/filter state, browse scroll position, and opener focus.
- **File-first composition:** Put Artwork and its plain file count above a thumbnail-led list and selected-file inspector. Desktop uses `minmax(0, 1.15fr) minmax(320px, .85fr)` columns with a 32px gap. File rows show the filename, purpose, placement, and concise item assignment, with a quiet overflow action. Long names wrap; assignments clamp to two lines while their full identities remain available through title text and accessible item labels. Thumbnails are 72px squares; the selected preview is 260px high with contain sizing so artwork stays uncropped. Keep Order items as a compact reference beneath the selected file, and put commerce/internal-file guidance inside About draft artwork disclosure.
- **Local responsive arrangement:** At viewport widths of 760px or less, the dialog fills `100dvh` and the full viewport width with square corners. The header stacks Back/Refresh, identity, then Shopify link; the body retains its sole scroll ownership. The artwork columns stack with a 24px gap and 20px by 16px body padding. Thumbnails become 56px squares and the selected preview 220px high. Selecting a file focuses and scrolls the inspector title into view on this viewport.
- **Action hierarchy and intake:** Add files is Action Blue while no upload is pending; Paste image remains secondary. File selection, artwork-area drop, and image clipboard input stage local previews in Pending upload before exposing purpose, placement, and Applies to items controls. An all-SVG selection defaults to Print file; raster/pasted images default to Mockup. Require the user to select at least one current item before Upload artwork, and state that the assignment applies to all pending files in a batch. While adding, Upload artwork is primary; when pending files are kept while inspecting an attachment, Continue upload restores their form as the primary action. Selecting existing artwork retains pending files. Editing an existing assignment retains its preview and locks purpose; removal lives in a named overflow menu with confirmation.
- **Feedback and recovery:** Keep Loading preview… and Preview unavailable in fixed preview frames. Display explicit Needs reassignment warnings beside the file and inspector. Inline polite status feedback explains empty/unavailable clipboard input, unsupported formats, limits, and save failures. Accept files up to 50 MB each and at most 100 attachments including staged files. Print files accept PNG/SVG and mockups PNG/JPG/WebP. Upload batches run sequentially: completed files remain attached and unresolved files keep their staging previews, assignment, and upload IDs after failure. Busy controls prevent duplicate work; leaving or refreshing asks before discarding pending or unsaved assignment changes.
- **Existing API boundary:** Use `getDraftOrder(id)` and private `getDraftArtworkUrl(assetId)` previews. Upload through `uploadDraftArtwork(id, file, { role, placement, lineItemIds, uploadId })`; purpose is `mockup` or `design` and item selections use exact current item IDs. Edit through `assignDraftArtwork(id, assetId, { revision, placement, lineItemIds })`; remove through `removeDraftArtwork(id, assetId, revision)`. Preserve optimistic revision checks, draft-to-order transfer, and the purchased-order/assignment-review notices. Quotes, invoices, and payment remain in Shopify.
- **Accessibility:** The native dialog is labeled by the draft title, which receives focus on open. File-selection buttons expose `aria-pressed`; item options have complete accessible labels; status feedback uses a polite live region and saving marks the detail busy. Keep 44px minimum controls, a visible 2px Action Blue outline with 2px offset, and textual warning/error cues. Escape closes the modal through the unsaved-change guard; Escape in the file menu restores its trigger focus. Assignment actions focus the relevant form control, validation focuses the item picker, and completion/cancel returns focus to an available action. Clipboard paste does not intercept input, textarea, or editable-text targets.
- **Scoped visual adaptations:** Draft title and Artwork heading use 1.2rem; the title becomes 1.05rem on mobile. File names and selected metadata use .875rem; summaries, assignments, controls, and help use .8125rem where implemented. These local sizes supplement the incumbent body size rather than extending the global type scale. Use the existing Tool Surface/Cool Canvas and Action Blue, with local quiet dividers (#E2E8F0), hover wash (#F1F5F9), and selection/drop wash (#EFF6FF). Selected rows, inspector, picker, and help grouping use 8px corners; thumbnail/preview frames and file-select hover corners use 6px. The modal backdrop uses `rgba(15, 23, 42, .64)`, and overflow menus use the Pipeline overlay shadow. These are component adaptations, not new global tokens.

### Shopify Production Artwork Workspace

The Production tab keeps the existing workbench and mockup rail while making print files its primary content. `production-artwork-workspace.js` owns the candidate-only selected-file inspector and staged upload flow.

- Use two equal `minmax(0, 1fr)` columns with a 24px gap: placement-grouped thumbnail rows beside the selected file. Stack at 1150px. Rows use 56px thumbnails; the uncropped preview is 280px high, or 240px on mobile. No inner vertical scroller; let the desktop tab pane or mobile detail-content scroll naturally even while the cursor is over artwork.
- Keep format, placement, known physical dimensions, exact item scope, and matching instructions together. Retain full filenames in a disclosure; trim only generated UUID prefixes from visible labels. Unknown size and unassigned order-level files must be stated explicitly. The dark-background checkbox helps inspect white artwork without changing the file.
- Add design and file drop open a staged batch with one reviewed placement. Saving is explicit. Preserve failed/interrupted files, identify files already saved, skip acknowledged saves on retry, and guard leaving with pending files. Only manual files expose confirmed removal; history retains preview/download but no mutations.
- Use quiet disclosures for all item instructions and Production details below the files. Detailed blank reservations/pulling belongs in Items & financials; the Production summary links there through Manage blanks.
- Local type sizes follow the neighboring draft workspace: .875rem filenames, .8125rem metadata/controls, .75rem supporting copy, .95rem inspector/upload headings, and .65rem thumbnail loading status. Reuse Action Blue and slate; local preview surface/divider #E2E8F0, selection wash #EFF6FF, and 6px thumbnail corners are existing artwork adaptations, not new global tokens. Preserve 44px controls, visible Action Blue focus, textual warnings, polite status messages, and selected-row aria-pressed state.

### Shopify Items & Financials Workspace

The item breakdown is the primary content of Items & financials. Preserve the artwork pane, default Overview, and existing tabs. This refinement uses the artwork workspace's plain labels, slate text, quiet dividers, and rectangular controls; do not add metric cards, count pills, eyebrows, or explanatory filler.

- Keep total garment cost in the persistent detail header beside the commerce total, across tabs and on mobile. Use a plain, labeled amount with a 44px navigation target into the cost details. Show Calculating, Unavailable, Partial, saved-capture provenance, and Items changed explicitly when applicable; never substitute zero for an unknown cost. The amount includes shelf garments and is separate from supplier purchasing cost and customer charges.
- Lead Items with garment/print counts and the table. The normal table shows compact receipt status with its garment variant. Receive garments reveals the existing editors and batch entry point; Hide receiving preserves typed values without implicitly saving. Keep 44px controls, explicit Save/Enter, existing immediate stepper saves, and variant/SKU context in accessible names. The broader delivery-first receiving redesign is deferred.
- Place the garment-cost disclosure after commerce totals. Its shelf/supplier split, exclusions, capture date, retry, and per-garment breakdown remain available. Preserve disclosure state for the same order and reset it for another order.
- Place Tultex 202 shop-stock details below the main item section, closed by default. The summary contains needed/reserved/pulled/S&S quantities; review, cancellation, and purchasing-lock messages remain visible. Use a compact variant table and one shared uncounted-stock instruction. Production's Manage blanks opens and focuses this workspace. Reserve, pull, return, and stock authority retain their existing contracts.
- Keep the outer detail pane as the scroll owner. Desktop table headings remain visible while scrolling; mobile retains the existing quantity/item/variant/total arrangement and a persistent financial header, without horizontal overflow.
- **Visual finish:** Concentrate the existing pale-blue wash (#EFF6FF) in the shared financial header, table headings, and expanded cost body. Use 18px semibold header amounts, dark action blue (#1765C1) for the cost navigation amount, 14px commercial rows, and quieter 12px SKUs. Desktop columns allocate 7/43/14/24/12 percent to quantity/description/SKU/variant/price; long descriptions remain readable rather than clamped. Commerce totals occupy at most 420px, aligned right, with a stronger divider and 18px final total. Supporting disclosures share a 48px row and drawn chevron; tax counts are plain text. The cost body has 16px padding and subtle column separators that disappear when its values stack on mobile. Keep white rows, quiet hover/focus feedback, and rectangular receiving controls; do not introduce decorative animation or new status colors. Candidate header composition spans the full detail width at intermediate desktop sizes as well as mobile.

## Do's and Don'ts

### Do:

- **Do** use Action Blue only for the current state, focus, selection, and the primary action in a decision cluster.
- **Do** use the 4px micro-step and the 8px, 12px, and 16px rhythm to keep dense layouts orderly.
- **Do** preserve the complete workflow on desktop and mobile, including mockups, batching, production detail, and stage changes.
- **Do** maintain at least 44 by 44 CSS-pixel touch targets, visible focus, and WCAG 2.2 AA contrast.
- **Do** provide immediate feedback for state changes and a safe recovery path wherever practical.
- **Do** extend the interface through the existing workflow model when new stages or shop operations are added.

### Don't:

- **Don't** use generic dashboard conventions that are disconnected from PrintMO's real workflow.
- **Don't** allow visual density to become noisy or overwhelming; remove or progressively disclose information that is not needed for the current task.
- **Don't** accumulate new capabilities as unrelated panels or generic cards; connect them to the order-production sequence.
- **Don't** reduce mobile to a read-only or feature-limited companion, or assume a full-screen mobile browser outside Shopify Admin.
- **Don't** use gradient text, decorative side-stripe borders, repeating stripe or grid backgrounds, or decorative glass panels.
- **Don't** combine one-pixel borders with wide soft shadows, use card radii above 25px, or animate layout properties for decoration.
- **Don't** use color as the only status cue or hide secondary text with low contrast.
