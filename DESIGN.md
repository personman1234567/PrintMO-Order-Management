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
