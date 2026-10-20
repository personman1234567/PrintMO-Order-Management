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
  control: "6px"
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
    rounded: "{rounded.control}"
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
    rounded: "{rounded.control}"
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
- **Rush priority:** A scoped plum marker (`#68326C` on `#F3E8F4`) identifies an explicit rush-service line. It does not replace existing source, readiness, or deadline colors.

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

- **Shape:** Dashboard actions use compact rectangular controls with 6px corners and explicit 14px type. Layout selection uses an 8px enclosing segment with 6px options. Targets are at least 44px high.
- **Primary:** Action Blue with white text, used once per decision cluster.
- **Hover / Focus:** Darken on hover, compress subtly on press, and show a visible 2px focus outline with offset. Disable decorative motion under reduced-motion preferences.
- **Secondary:** White or Cool Canvas with Working Slate text and a Structural Line border; never compete with the primary action.

### Chips

- **Style:** Dashboard filters use modest rectangular corners. Counts are plain metadata. Source and production-status labels retain their semantic identity.
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

Desktop navigation uses quiet text tabs with pale-blue selection and an Action Blue underline. Board/List and Refresh live beside navigation in the workspace drawer; other workspaces and Draft Orders hide the layout control. Labels remain available to assistive technology.

### Shopify Dashboard Controls

`dashboard-controls.js/.css` owns the candidate dashboard composition. Legacy controls return to their original DOM homes; order-detail styles and mutation handlers remain independent.

- **Navigation:** Pipeline, Supplies, and Production tabs share 14px labels, 44px targets, blue selected text/underline and a pale-blue wash. Counts stay plain, tabular metadata. Subtle blue panel-header surfaces give the dashboard structure without changing green, amber or provider meanings.
- **Supplies actions:** In S&S Cart exposes one Cart actions popover, with Mark cart ordered first, the eligible Manual Add checklist, and Receive Batches for linking separate shipments. Ordered exposes Receive Batches directly. The original buttons and supplier/receiving handlers are retained, including the required supplier order number, partial-save feedback and busy guard.
- **Popover:** Cart actions is a named nonmodal dialog in the native top layer, with a fixed-position fallback and 12px viewport margins. Opening focuses the first enabled action; arrows/Home/End navigate actions; Escape restores the trigger. A view/source change dismisses it, and action activation restores a visible opener before the existing prompt or dialog opens.
- **Card metadata:** Pale Pipeline footers use dark garment/print quantities and dark icons; age labels are quiet rectangular metadata. Production and source color meanings remain unchanged.
- **Workspace shell:** `dashboard-shell.js/.css` removes the candidate toolbar and redundant destination label entirely. The original Board/List and Refresh controls join navigation in the right-edge native modal drawer. Menu occupies the existing Production header on desktop Board, List heading on desktop List, and destination headers elsewhere. On phone it replaces Sync within the existing workflow navigation; Refresh remains in the drawer. The drawer overlays the app without resizing columns, confines keyboard focus, closes on Escape or outside click, and returns focus to its launcher. Legacy controls return to their original header.
- **Viewport:** Candidate content fills the iframe with 8px vertical outer gutters. The App Bridge bottom pseudo-element spacer is suppressed for this workspace, allowing content behind floating Sidekick. Board queues retain independent scroll owners; List retains its own result scroller. No card sizing or information hierarchy is compressed.
- **Shared section anatomy:** Shopify Board uses equal header tracks, 16px sentence-case titles, plain counts and aligned local tabs. Wide headers measure 73px including the divider; narrower desktop and phone headers use 97px to preserve 44px targets. Supplies actions move into its header on desktop and return to Blanks on phone or Legacy. The redundant desktop Blanks header is removed. The 44px garment summary reveals its source explanation on demand; incomplete costs and retry remain visible, and open/focus state survives hydration.
- **Motion and save feedback:** `dashboard-motion.js/.css` retains 120ms, 2% pointer-press feedback, 150ms trigger-origin menu entrances and acknowledgment-based save feedback. `dashboard-shell.js` adds a persistent 180ms travelling tab indicator, a 200ms drawer entrance with a 140ms exit, 120ms explicit view reveals and 150ms positional continuity for disclosures. Motion is interruptible; keyboard actions stay immediate and reduced motion removes movement. Polling and financial values do not animate. List workflows retain their detailed partial/uncertain results; mixed outcomes never receive an all-saved check.

### Order Workflow Card

The order card is the signature component. It prioritizes order identity, customer, mockup availability, stage, urgency, and production state while keeping secondary detail behind the detail view. Drag feedback must preserve spatial continuity; selection and drag state must never be visually confused.

Shopify/provider cards with a finish-by date or recorded rush fee use one compact `.order-schedule` line immediately beneath the header, ahead of artwork. Dates use neutral Due, amber Due today/tomorrow with the actual date retained, or red Overdue; complete/history stays neutral Target. The plum Rush marker has 4px corners and no button affordance or animation. Undated ordinary cards receive no row. Narrow cards wrap readable labels rather than truncate them. Bundles show Includes rush and the earliest active member date, falling back to neutral dates only when no active dated member exists. List places Rush beside order identity and dates in its existing Due / Age area, visible before phone expansion. Rush only stays in collapsed filters, and Rush first is an opt-in sort.

### Shopify Order Pipeline

The Shopify Pipeline keeps local filtering and sorting in the compact Filter & sort overlay.

- **Header:** Pipeline uses the shared section anatomy above: heading and plain count above Orders / Draft Orders, with Filter & sort alongside. Board/List stays in the app shell. The count uses tabular numerals and shows visible/total when filtered.
- **Responsive arrangement:** Narrower desktop headers put contextual actions beside the title and tabs on the next track. Phone uses heading/count/selection above tabs and a compact Filter label; the accessible label still describes sorting and current settings. Controls retain at least 44px targets and the Pipeline keeps its inner scroll owner.
- **View overlay:** The named, nonmodal Pipeline view dialog is portaled to the document body and uses the native popover top layer when available, with a fixed-position fallback. It is at most 300px wide, fits within 12px viewport margins, and scrolls internally when height is constrained. Checkmarked filter rows with aligned counts offer All, Attention, Stale, No Mockup, and Ready. A labeled sort select offers Newest first, Needs attention, Oldest first, and Highest total; Reset view restores the defaults.
- **State and accessibility:** Each fresh page load starts Shopify at All / Newest first. Manual filter and sort choices remain during the visit, including source/view switching. A blue indicator marks a nondefault view, and the trigger's accessible label and tooltip summarize the current filter and sort. Opening focuses the selected filter; Escape or Close restores trigger focus. Clicking outside or moving focus outside dismisses the overlay, as does leaving the Orders workspace. Draft Orders hides the order count, selection controls, and View trigger.
- **Scoped visual details:** The compact heading (1rem), overlay body (.875rem/1.4), hover corners (6px), quiet divider (#E2E8F0), trigger hover wash (#F1F5F9), and selected-filter wash (#EFF6FF) belong to this Pipeline component. The white overlay uses 12px corners and a structural shadow (`0 8px 24px rgba(15, 23, 42, .18)`); keyboard focus uses the existing 2px Action Blue outline. These adaptations do not extend the global type, color, radius, or elevation scales.
- **Boundary:** Legacy Redis retains its inline triage toolbar and All / Needs attention defaults, with separate visit state. This component does not redefine order cards, Draft Orders internals, other panels, or global navigation.

### Shopify Order List Selection / Review

The candidate List extends the Precision Workbench with exact-order selection and reviewed actions. First visits default to Board; subsequent visits restore only layout and sort from device storage. These conventions are local to `order-list-foundation.js/.css` and `order-list-workflows.js`.

- **Selection and hierarchy:** Keep the existing eight table columns; place a 44px checkbox target beside order identity rather than adding an action column. Selected rows use the existing pale-blue wash (#EFF6FF). A compact shared strip shows the selected count, Clear selection, one action dropdown, and the blue Review action button. Explain unavailable actions in a quiet Action availability disclosure. Selection covers only matching orders currently shown and is reconciled when the view changes; bundle membership never silently expands the selected set.
- **Review:** Use a named native modal with an explicit order list, action consequence, optional required field, Cancel, and Confirm action. The white dialog is at most 560px wide with 16px viewport margins, 12px corners, 24px padding, and internal scrolling; reduce padding to 16px at 600px or less. Keep confirmation separate from choosing an action and return focus to the available source control.
- **Results and recovery:** Present saved and unresolved outcomes as text in a compact disclosure above the order scroller. Expand partial results, identify each order, and retain unresolved selection. Offer reviewed retry only for known remaining steps; uncertain supplier outcomes require inspection. The result region is bounded to 25vh and the selection strip to 28vh so order browsing retains space.
- **Browse composition:** Mount Board/List in the active Orders header. Use the established 1.2rem heading, 8–12px spacing, a single stage strip with inline counts and 6px corners, and a shared search/filter/sort/clear/receiving toolbar. Flatten outer framing and result feedback; keep partial results open and successful results collapsed. Empty feedback consumes no space. Retain the eight desktop columns, existing 14px working text and 12px metadata, white/slate surfaces and meaningful status tones.
- **Responsive arrangement:** From 601–1199px, preserve all eight fields in labeled two-column rows. At 600px or less, keep identity/customer/source, stage, target, quantities, materials/progress and attention visible. A separate 44px More details control reveals payment/total, age, bundle, physical receiving and supplier observations within the keyed row. Expansion survives sort, same-order updates and detail return, but resets when the row leaves results or the workspace changes. Keep stage filters in a horizontal scroller, selection controls in two columns, the list as the inner vertical scroll owner, readable wrapping, and a visible 2px Action Blue focus outline with 3px offset. Announce selection and save feedback through a polite status region.
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

### Board recognition cards

Board movement preserves neighboring card elements and healthy preview pixels.
Open a space sized to the destination's card type, then settle the dropped card
once with an interruptible 180ms translation. Do not hide and reintroduce it on
save acknowledgment. Keep the drag copy and target space through required batch
checks, hiding the origin until the real destination card paints. Only that paint
triggers the landing; pending-status updates must not trigger layout motion.
Pending moves use a delayed, static 2px Action Blue line at
the card's bottom edge with an accessible save/check label; material-status green
keeps its existing meaning. Background queue paints wait for the interaction to
settle. Fast saves produce no flashing toast; failures retain explicit feedback.

Individual embedded-board cards lead with a full, two-line customer name and a
quiet order/source/age row. Reserve a 138px media frame on desktop and 152px on
phone, with 6px corners and uncropped foreground imagery. Extend the outermost
pixel strips into unused space and soften the backing with a 12px blur, keeping
the original edge colors at full opacity and the foreground sharp. Repaint only
when the image or frame dimensions change. Unavailable previews use the garment/print icon
vocabulary with real item context; quantities stay explicitly labeled below.
Garment and print counts retain their status icons: green for Ordered or Ready,
neutral for Not ordered. Show the explicit state beneath each quantity, using
the separate ordered/ready flags so ordering never implies readiness.
Blockers and printed-garment progress remain visible without coloring the entire
header/footer. Preserve source text badges and the thin Etsy source marker.

Local card adaptations use 15px/16px customer names, 12px facts and progress,
11px metadata, and a 10px additional-preview label. Working Slate #475569,
surface #F1F5F9 and dividers #E2E8F0 extend the incumbent slate vocabulary here.
Use the owner's `Assets/order-preview-mark.svg` for the shirt/list mark. Loading
shows it in color with a separate scan bar confined to the list rows. Confirmed
absence uses a smaller muted static mark and `No preview available`; failed
lookups use `Preview could not load`. Neither terminal state has a scan bar.
The Order Detail selected preview reuses this same mark and loading motion at
92px by 80px, with smaller static marks for absent or failed previews. Stop the
scan bar when the selected image loads, fails, or leaves view; block full-size
opening until the real image is available.
Loading motion belongs only to the visible print-sheet mark; stop it offscreen
and in hidden documents. Preview reveal is a single 180ms opacity transition.
Use existing acknowledged-save feedback and drag continuity; no polling entrance
sequence. The inline native-paste fallback uses a 16px text field, 44px controls,
visible focus and explicit status feedback.

List composition keeps Orders, stage filters and Menu in one desktop row, with
search, result count and tools below. Draft Orders belongs in the workspace drawer.
Sticky column headings include the full checkbox target within about 44px; do not
add another layer of vertical padding around it or reserve empty feedback rows.

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

Garment summaries replace unavailable mockups within the existing media frame. Use a bounded color-family palette, front/back garment geometry, and only recorded placement associations. Keep the original product/color name; acknowledge additional combinations without adding card rows. Source labels and receiving status use plain text. Remove candidate card deletion buttons and the redundant prints-pending warning; retain confirmed removal in detail Order actions.

The garment-summary palette is intentionally illustrative: black #34383E, white #FAF9F5, gray #A3A8AE, navy #304665, blue #477DB5, red #B94C4D, pink #D68AA5, purple #806398, green #567C62, teal #4C8E91, yellow #E2C76B, orange #CF8856, brown #896B58, tan #C9B99B, unknown #CBD0D5. These colors identify families, not print-proof fabric swatches. Diagram seams switch between light and dark for legibility.
