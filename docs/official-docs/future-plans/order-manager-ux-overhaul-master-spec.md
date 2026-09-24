# Print-MO Order Manager: Master UX Overhaul & Shop-Floor Architecture Specification

- **Status**: `[In Progress]`
- **Owner / Target Milestone**: `Print-MO / staged UX improvements`

## Summary & Intent

This is the broad design proposal for making Order Manager easier to use on the shop floor. Implement each workflow area independently; current behavior is documented in the workflow and reference pages.

## Current Continuation State

- **Current state**: Supplier receiving is live as the first candidate improvement. Other overhaul areas remain proposals.
- **Next safe action**: Validate receiving with real shop staff, then choose the next independent area.
- **Remaining blockers**: Carrier delivery and packing-slip feeds are not integrated.
- **Owner / external actions**: Confirm any future supplier integration scope before enabling automated delivery events.
- **Last verified evidence**: `scripts/verify-phase2.js` passed; Worker version `5429ec7c-6375-48b4-af2b-49f5ea308803` and Pages release `17902781023N` were served on 2026-09-24. Live shop acceptance remains separate.

## Open Questions & Brainstorming

See the detailed sections below for order detail, readiness, receiving, and print-run ideas. Keep physical receipt separate from carrier delivery.

## Technical Specification & Task Checklist

The numbered sections below contain the proposed UX and architecture. The shipped receiving subset is described in [../workflows/blanks-batching.md](../workflows/blanks-batching.md).

## Progress Log

- 2026-09-24: Supplier receiving shipped as the first independent improvement; operational acceptance remains open.

> **Document Status:** Authoritative Master Specification  
> **Target Audience:** Codex, Software Engineers, UI/UX Designers, and Autonomous Implementation Agents  
> **Scope:** Front-end (`order-manager-web`), Cloudflare Worker Backend (`order-manager-worker`), Cloudflare D1/R2 Storage, and Shopify Theme Integration  
> **Source Repository:** `e:\PrintMO\PrintMO-Order-Management`  

---

## 1. Executive Summary & Intent Alignment

### 1.1 The Problem
The Print-MO Order Manager was built incrementally to coordinate custom apparel production, supplier blank purchasing, DTF transfer scheduling, and Shopify fulfillment. Over successive feature additions, the user interface accumulated significant **visual noise, cognitive friction, and modal interaction traps**:
1. **The Order Detail Modal** felt sluggish, crowded, and disorienting. A redundant "Overview" tab forced an extra click just to view line items. The "Production" tab squeezed artwork into a tiny bottom-right corner, trapped mouse scrolling via nested overflow containers, and displayed irrelevant metadata ("Production Context") instead of clear, high-resolution print files and physical dimensions.
2. **The Readiness Lifecycle** relied on 4 disconnected binary checkboxes that failed to reflect shop-floor realities (e.g. blanks sitting in an S&S cart, or prints staged onto a gang sheet). Progress could only be updated individually inside modals.
3. **The "Receive Batches" Feature** was severely disconnected from physical shop operations. Deliveries from S&S Activewear arrive as physical boxes with printed packing slips, PO numbers, and tracking IDs—frequently split across multiple warehouses and delivery days. The software forced these into artificial, timestamped "batch" folders (e.g., `Batch 2026-09-20 14:32`), locked the user with unsaved draft alerts (`dirty` flag), and lacked any direct search by S&S PO # or clear indication of which customer orders were actually ready to print.

### 1.2 Core Tenet: "Get Rid of the Noise"
Every screen and control must align 1-to-1 with the physical reality of the print shop. If a UI element does not directly inform a production decision, speed up unboxing, or trigger a press run, **it is eliminated**.

```
+---------------------------------------------------------------------------------------------------+
|                                 CORE WORKFLOW TRANSFORMATION                                      |
+------------------------------------+--------------------------------------------------------------+
| OLD PARADIGM (Fragmented & Trapped)| NEW PARADIGM (Streamlined & Physical-First)                 |
+------------------------------------+--------------------------------------------------------------+
| * 6 tabs in Order Detail modal     | * 4 focused tabs; opens straight to Items & Financials       |
| * Overview tab with redundant data | * Target date promoted to header with inline [Edit]          |
| * Squeezed artwork preview in tab  | * Full-width Master Artboard Canvas (~400px height)          |
| * Nested scroll freeze on artboard | * Clean modal flow; no trapped inner scrolling               |
| * Pill buttons competing with tabs | * Recessed macOS-style segmented control bar                 |
| * Undefined print dimensions       | * Explicit print product labeling + manual width/height (in) |
| * 4 disconnected binary checkboxes | * Two linear 3-step tracks: [In Cart->Ordered->Ready]        |
| * Individual modal-only updates    | * In-card board steppers (+1 Print) & bulk floating toolbar  |
| * Timestamped S&S "batches"        | * S&S PO # / Packing Slip / Tracking # lookup                |
| * Unsaved draft modal traps        | * 0ms Optimistic auto-save across all steppers & checkboxes  |
| * No idea which order is ready     | * Instant "Ready to Print" alert as soon as box is received  |
+------------------------------------+--------------------------------------------------------------+
```

---

## 2. Order Detail Modal Overhaul

### 2.1 Tab Architecture Consolidation
The previous 6-tab system (`Overview`, `Production`, `Fulfillment`, `Items & financials`, `Customer`, `Activity`) created decision paralysis.

```
OLD TABS: [ Overview ] [ Production ] [ Fulfillment ] [ Items & financials ] [ Customer ] [ Activity ]
              │             │              │                     │                  │            │
              └── DELETE    │              └─────── MERGE ───────┴──────── MERGE ───┘            │
                            ▼                                                                    ▼
NEW TABS:            [ Items & financials ]  [ Production ]  [ Customer & shipping ]  [ Activity ]
                            ▲
                   (Default Landing Tab)
```

1. **Delete the `Overview` Tab:**
   - **Rationale:** Opening an order should immediately show what shirts were ordered and what was paid. The overview tab added an unnecessary step before seeing line items.
   - **Header Promotion:** The target deadline is moved directly into the modal header:
     ```
     Order #1042 – Sarah Jenkins  |  Target Date: Oct 12, 2026 [✎ Edit]  |  Status: Blanks (Ordered)
     ```
2. **Default Tab Landing:**
   - Opening an order now renders `Items & financials` immediately.
3. **Consolidate `Customer` and `Fulfillment` into `Customer & shipping`:**
   - Shipping address, fulfillment status, carrier tracking, package weights, and customer contact details live in one unified view.
4. **Retain `Activity` as a secondary audit tab:**
   - Clean, quiet timeline of status transitions, notes, and staff actions.

---

### 2.2 Left Sidebar Decluttering & Flow
The persistent left sidebar of the modal provides context at a glance, but previously duplicated information and buried critical customer instructions.

```
+------------------------------------------+--------------------------------------------------------+
| PREVIOUS LEFT SIDEBAR                    | REDESIGNED LEFT SIDEBAR                                |
+------------------------------------------+--------------------------------------------------------+
| [Customer Name] (Duplicate of header)    | [Garment Mockup Carousel] (With dynamic design sync)   |
| [Small Garment Mockup]                   |                                                        |
|                                          | [Amber Callout]: "Customer Note: Please ensure..."     |
| [Empty "Shop Instructions" Box]          |                                                        |
|                                          | [✎ + Add internal note] (Collapsed if empty)           |
| [Production Status Checkboxes]           |                                                        |
|   [ ] Blanks Ordered                     | [Production Readiness Pipeline]                        |
|   [ ] Prints Ordered                     |   Blanks: [ In Cart ] -> [ Ordered ] -> [ ✓ Ready ]   |
|                                          |   Prints: [ On Sheet] -> [ Ordered ] -> [ ✓ Ready ]   |
| [Fulfillment Info Button]                |                                                        |
|                                          | [Production Progress Bar]: 8 / 12 Printed              |
|                                          |   [+1 Print]  [✓ Mark All (12/12)]                     |
|                                          |   [✓ Complete Production & Move to Fulfillment]        |
+------------------------------------------+--------------------------------------------------------+
```

1. **Remove Duplicate Customer Name:** Header already shows `Order #1042 – Sarah Jenkins`.
2. **Dynamic Mockup Switching:** In multi-garment orders (e.g. 5 Black Hoodies with Front Print, 10 White Tees with Left Chest Print), selecting or hovering a line item automatically updates the mockup to that garment's artwork.
3. **High-Visibility Customer Notes:** Customer checkout notes render as a distinct **amber banner** immediately below the mockup so special requests (e.g., "Must arrive before Friday event") are never missed.
4. **Collapsible Internal Shop Instructions:** If empty, shop instructions collapse to a quiet `[✎ + Add internal note]` link rather than occupying dead screen space.
5. **Direct Production Actions:** Added `[Mark All Done (12/12)]` and `[✓ Complete Production & Move to Fulfillment]` directly in the sidebar.

---

### 2.3 Items & Financials Tab Enhancements
1. **1-Click Blanks Receiving in Table Header:**
   - Added a direct table action button: `[✓ Receive All Blanks (12 pcs)]`. If a single order arrives, staff can check in all blanks with one click without opening the batch modal.
2. **Filtered Garment Table:**
   - Automatically hides 0-quantity rows and dummy Shopify print-service line items. Only actual physical garments and billable addons are displayed.

---

## 3. Production Tab & Artwork Artboard Redesign

### 3.1 Problem Analysis
The previous Production tab suffered from critical layout bugs:
- **"Production Context" Card:** Displayed raw metadata that clutter the screen without aiding print operations.
- **Nested Scrolling Freeze:** An inner container used `overflow-y: auto`, capturing mousewheel events and trapping the user inside the artboard rather than scrolling the modal.
- **Squeezed Bottom-Right Preview:** The actual design preview was restricted to a small box in the lower corner of the screen.

### 3.2 Master Artboard Canvas
The new Production tab is an uncluttered, high-resolution artboard workspace:

```
+---------------------------------------------------------------------------------------------------+
| PRODUCTION TAB WORKSPACE                                                                          |
+---------------------------------------------------------------------------------------------------+
|  Location Switcher:  [ Front Print ]  |  Back Print  |  Left Chest  |  Sleeve                     |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
|                                                                                                   |
|                          .---------------------------------------.                                |
|                          |    ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   |                                |
|                          |    ░░░░░░░  MASTER ARTBOARD  ░░░░░░   |                                |
|                          |    ░░░░░░░   TRANSPARENCY    ░░░░░░   |                                |
|                          |    ░░░░░░░   CHECKERBOARD    ░░░░░░   |                                |
|                          |    ░░░░░░░     ~400px H      ░░░░░░   |                                |
|                          |    ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   |                                |
|                          '---------------------------------------'                                |
|                                                                                                   |
+---------------------------------------------------------------------------------------------------+
|  Print Spec: Full Front Print [✎]    Dimensions: Width [ 10.7 ]" × Height [ 11.7 ]"   [Save Specs] |
|  Artwork File: Sarah_Senior_Front_10.7x11.7.png (300 DPI)                     [↓ Download High-Res] |
+---------------------------------------------------------------------------------------------------+
```

1. **Eliminate "Production Context":** All redundant context cards are removed.
2. **Master Canvas Dimensions:** Centered artboard with minimum height of `400px`, maximum width scaling to the modal body, and a subtle transparent checkerboard pattern (`#f8fafc` / `#e2e8f0`).
3. **Natural Scrolling:** Removed `overflow-y: auto` on inner canvas elements. Scrolling flows naturally with the outer modal body.
4. **Segmented Control Switcher (NO PILL SHAPES):**
   - **Styling:** Recessed macOS-style card bar (`background: rgba(0,0,0,0.05)`, border radius `8px`, subtle inset shadow). Active segment uses `background: #ffffff` with crisp drop shadow.
   - **Rationale:** The user explicitly rejected pill-shaped buttons. Pills visually collide with the primary underline tab navigation.
   - **Dynamic Locations:** Automatically reflects all print locations present on the order (`Front`, `Back`, `Left Chest`, `Neck Label`, etc.).
5. **Print Product Labeling & Manual Dimension Controls:**
   - **Automatic Labeling:** Pulls print variant title from Shopify line items (e.g. `Full Front Print`, `Pocket Print`). Editable via an inline pencil icon.
   - **Manual Inch Dimensions:** Exact physical print dimensions configurable directly below the artboard:
     ```html
     Width [ 10.7 ]"  ×  Height [ 11.7 ]"  [Save Specs]
     ```
   - **Direct Download:** Prominent `[↓ Download High-Res PNG]` button linking to the uncompressed asset in Cloudflare R2 / Shopify CDN.

---

## 4. Board & Kanban Lifecycle Overhaul

### 4.1 3-Step Pipeline Readiness Tracks
The old system used 4 binary checkboxes (`Blanks In S&S Cart`, `Blanks Ordered`, `Prints On Sheet`, `Prints Ordered`). The detail modal only tracked `Ordered` booleans, ignoring staging phases and forcing staff to guess status.

```
+---------------------------------------------------------------------------------------------------+
| BLANKS READINESS PIPELINE                                                                         |
|                                                                                                   |
|   [ In Cart ] ------------> [ Ordered ] ------------> [ ✓ Ready ]                                 |
|   (Blanks staged in S&S)    (Order placed with S&S)   (Blanks unboxed & on shelf)                 |
+---------------------------------------------------------------------------------------------------+
| PRINTS READINESS PIPELINE                                                                         |
|                                                                                                   |
|   [ On Sheet ] -----------> [ Ordered ] ------------> [ ✓ Ready ]                                 |
|   (Artwork nested on gang)  (DTF print order placed)  (Transfers cut & in shop)                   |
+---------------------------------------------------------------------------------------------------+
```

- **Interactive Advancement:** Clicking any stage transitions the order immediately via **0ms optimistic UI**.
- **Visual Feedback:** 
  - `In Cart` / `On Sheet`: Neutral slate blue.
  - `Ordered`: Amber warning (waiting on supplier delivery).
  - `Ready`: Vivid emerald green with checkmark.

---

### 4.2 In-Card Quick Controls & Bulk Operations

#### In-Card Board Stepper
Opening a modal just to increment completed prints was a major point of friction. Kanban cards on the board now feature an inline print counter:
```
+----------------------------------------------+
| #1042 · Sarah Jenkins               Oct 12   |
| Comfort Colors 1717 (Pepper) x 12            |
| Blanks: [✓ Ready]   Prints: [✓ Ready]        |
|----------------------------------------------|
| Printed: 8 / 12       [ +1 Print ]  [✓ Mark] |
+----------------------------------------------+
```

#### Sticky Bulk Action Toolbar
When multiple cards are selected (via checkbox or Shift+Click), a floating toolbar slides up from the bottom of the viewport:
```
+---------------------------------------------------------------------------------------------------+
|  [ ✓ 6 Orders Selected ]   [ Move to Ordered (S&S) ]   [ Mark Prints On Sheet ]   [ Deselect All ] |
+---------------------------------------------------------------------------------------------------+
```

#### Board Drag-and-Drop Enhancements
1. **Spring-Loaded Tab Switching:** Dragging a card over the `In S&S Cart` or `Ordered` tab automatically flips the view after 300ms hover.
2. **1-Click Card Action:** Every card in `In S&S Cart` features a direct `[→ Ordered]` button to quickly advance cards without dragging.
3. **Elimination of `batch-correction-dialog`:** Dragging an order out of a batch no longer triggers an invasive modal (`"Remove from Batch & Move vs Move Only"`). The system cleanly updates membership in the background.

---

## 5. Supplier Receiving Hub (S&S Deliveries)

### 5.1 Deep Problem Analysis & Shop-Floor Reality
The previous "Receive Batches" feature was the single most confusing and fragmented workflow in the Order Manager.

#### Why the Old System Failed:
1. **Mental Model Mismatch:** S&S Activewear ships physical boxes containing physical packing slips. A packing slip contains an **S&S Order Number**, a **PO Number**, a **carrier tracking number**, and a list of specific garments packed into that box. The software, however, grouped orders into arbitrary timestamped records like `Batch 2026-09-20 14:32`.
2. **Split Shipments Across Warehouses:** S&S frequently splits an order (e.g. Box 1 with black tees arrives Tuesday from Olathe; Box 2 with white hoodies arrives Thursday from Fort Worth). The old system forced all garments into a single monolithic batch, leaving staff unable to tell which box arrived or what was still on the truck.
3. **The Unsaved Draft Trap:** Touching a stepper locked the entire modal with a `dirty` flag. Trying to switch tabs or click back triggered a blocking alert: `"You have unsaved receiving changes. Discard them?"`.
4. **Order Picker Chaos:** The "Add Orders" picker displayed confusing states like `Move from Batch X` or `Ordered · no saved batch`.
5. **Customer Order Blindness:** After receiving 30 shirts, staff had no idea which customer jobs were actually ready to be pressed versus which ones were still missing blanks.

---

### 5.2 Redesigned Architecture: The Supplier Receiving Hub

```
+---------------------------------------------------------------------------------------------------+
| SUPPLIER RECEIVING HUB                                                                [Close ✕]   |
+---------------------------------------------------------------------------------------------------+
|  Search PO / Tracking: [ S&S # 2489104 or Tracking...       ]  [ 🔍 Search ]                      |
|  Filter: (●) Awaiting Delivery (4)    ( ) Completed Archive (28)                                  |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
|  SHIPMENT: S&S PO #2489104 · Placed Sep 22 · 3 Orders (36 Garments)                              |
|  Tracking: 1Z9999999999999999 (UPS Ground)                                                        |
|                                                                                                   |
|  [✓ RECEIVE FULL BOX (36 PCS)]                                                                    |
|                                                                                                   |
|  Garments in this Shipment:                                                                       |
|  • Comfort Colors 1717 - Pepper / L      Expected: 12   Received: [ - ] [ 12 ] [ + ]  [✓ Match]   |
|  • Gildan 5000 - White / M               Expected: 14   Received: [ - ] [ 14 ] [ + ]  [✓ Match]   |
|  • Bella+Canvas 3001 - Black / XL        Expected: 10   Received: [ - ] [ 0  ] [ + ]  [On Truck]  |
|                                                                                                   |
+---------------------------------------------------------------------------------------------------+
|  🎉 INSTANT PRODUCTION UNLOCK (Orders Ready to Print):                                            |
|  ┌─────────────────────────────────────────────────────────────────────────────────────────────┐  |
|  │  ✓ Order #1042 (Sarah Jenkins)   12/12 Blanks Arrived   --> [ SEND TO READY TO PRINT ]      │  |
|  │  ✓ Order #1043 (St. Jude Run)    14/14 Blanks Arrived   --> [ SEND TO READY TO PRINT ]      │  |
|  │  ⏳ Order #1045 (Dave Miller)     0/10 Blanks (Waiting on Truck - Box 2)                    │  |
|  └─────────────────────────────────────────────────────────────────────────────────────────────┘  |
+---------------------------------------------------------------------------------------------------+
```

#### Core Operational Rules:
1. **Upfront PO / Order Tagging:**
   - When clicking **"Mark In Cart Ordered"** on the board, a lightweight popover appears:
     ```
     Mark 4 Orders as Ordered with S&S
     Enter S&S PO # or Order ID: [ 2489104        ]
     (Optional) Tracking #:      [                ]
     [ Confirm & Move Cards ]
     ```
   - If using the automated S&S API integration, the PO number is captured and linked automatically.
2. **Packing Slip / PO Lookup:**
   - Unboxing staff grab the physical S&S packing slip, locate the S&S PO # or Order #, and type/scan it into the Receiving Hub search bar.
   - The exact shipment matching that packing slip loads instantly.
3. **1-Click "Receive Full Box":**
   - In 90%+ of cases, S&S packing slips match the box contents.
   - Staff click **`[✓ Receive Full Box]`** once. All items in the shipment are marked received, and the underlying database ledger updates immediately.
   - If an item was shorted or damaged, staff use quick `[ - ] [ + ]` steppers on that row to adjust the actual count.
4. **Instant "Ready to Print" Customer Alerts:**
   - As garments are checked in, the system reconciles them against customer orders oldest-first.
   - A high-visibility banner immediately alerts staff which customer orders are now **100% complete with blanks**:
     ```
     Order #1042 (Sarah Jenkins) - All 12 blanks accounted for! [Move to Ready to Print]
     ```
5. **Split-Shipment & "Waiting on Truck" Tracking:**
   - If an order has 10 shirts in Box 1 and 10 shirts in Box 2, Box 1 check-in marks the order as `Blanks: 10/20 Received (Waiting on Box 2)`.
   - The card remains in `Ordered` with clear fractional progress, rather than stalling in an ambiguous state.
6. **Automatic Archiving to "Completed":**
   - Active view displays only shipments currently awaiting delivery or partially received.
   - The moment a shipment reaches 100% received, it auto-archives into the `Completed Archive` tab.
7. **Zero-Trap Auto-Save:**
   - Every stepper click and button tap auto-saves immediately with **0ms optimistic UI**.
   - The manual `Save Receiving` button, `dirty` flag, and blocking `confirmDiscardDraft()` alerts are completely eliminated.
8. **Bi-Directional Real-Time Synchronization:**
   - Checking in garments in the **Supplier Receiving Hub** instantly updates the inline garment check-in inside the **Order Detail Modal** (`[✓ Receive All Blanks]`), and vice versa.

---

## 6. Technical Architecture & Data Contracts

### 6.1 Cloudflare D1 Database Schema Updates
To support PO tagging, split shipments, and clean order allocation, the D1 schema expands to formalize receiving manifests into relational tables:

```sql
-- Supplier Batches / Purchase Orders
CREATE TABLE IF NOT EXISTS supplier_batches (
  id TEXT PRIMARY KEY,                       -- UUID or generated ID
  supplier TEXT NOT NULL DEFAULT 'ss',       -- 'ss', 'sanmar', 'alpha', etc.
  po_number TEXT,                            -- S&S PO # or Order # from packing slip
  tracking_number TEXT,                      -- Carrier tracking number
  label TEXT NOT NULL,                       -- Human readable label (e.g. "S&S PO #2489104")
  status TEXT NOT NULL DEFAULT 'active',     -- 'active' (pending delivery), 'completed' (100% received)
  expected_garments INTEGER NOT NULL DEFAULT 0,
  received_garments INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

-- Batch Line Items (SKU Level Aggregation)
CREATE TABLE IF NOT EXISTS supplier_batch_lines (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES supplier_batches(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,                    -- Hash of title + sku + variant
  title TEXT NOT NULL,
  variant_title TEXT,
  sku TEXT NOT NULL,
  expected_qty INTEGER NOT NULL DEFAULT 0,
  received_qty INTEGER NOT NULL DEFAULT 0,
  UNIQUE(batch_id, item_key)
);

-- Order-to-Batch Mapping with Allocation
CREATE TABLE IF NOT EXISTS supplier_batch_orders (
  batch_id TEXT NOT NULL REFERENCES supplier_batches(id) ON DELETE CASCADE,
  order_gid TEXT NOT NULL,                   -- Shopify Order GID (gid://shopify/Order/...)
  order_name TEXT NOT NULL,                  -- Display name (e.g. "#1042 - Sarah Jenkins")
  expected_qty INTEGER NOT NULL DEFAULT 0,
  received_qty INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (batch_id, order_gid)
);
```

---

### 6.2 Worker API Contracts

#### 1. Commit S&S Batch (`POST /v1/batches/commit`)
Invoked when marking orders ordered or submitting to the S&S gateway.
- **Request Payload:**
  ```json
  {
    "orderGids": ["gid://shopify/Order/5812948192", "gid://shopify/Order/5812948193"],
    "poNumber": "2489104",
    "trackingNumber": "1Z9999999999999999",
    "idempotencyKey": "batch-commit-1727192400"
  }
  ```
- **Response Payload:**
  ```json
  {
    "success": true,
    "batch": {
      "id": "batch_c8f2a1b9",
      "poNumber": "2489104",
      "label": "S&S PO #2489104",
      "expectedGarments": 36,
      "receivedGarments": 0,
      "status": "active"
    }
  }
  ```

#### 2. Update Receiving (`POST /v1/supplier/receive`)
Invoked on 1-click receive or stepper adjustment.
- **Request Payload:**
  ```json
  {
    "batchId": "batch_c8f2a1b9",
    "receiveAll": true,
    "lineAdjustments": [
      { "itemKey": "cc1717-pepper-l", "receivedQty": 12 }
    ]
  }
  ```
- **Response Payload:**
  ```json
  {
    "success": true,
    "batch": {
      "id": "batch_c8f2a1b9",
      "expectedGarments": 36,
      "receivedGarments": 36,
      "status": "completed"
    },
    "completedOrders": [
      {
        "orderGid": "gid://shopify/Order/5812948192",
        "orderName": "#1042 – Sarah Jenkins",
        "fullyAccounted": true
      }
    ]
  }
  ```

---

## 7. Phased Implementation Roadmap for Codex

```
+---------------------------------------------------------------------------------------------------+
| IMPLEMENTATION ROADMAP FOR CODEX & SUBSEQUENT AGENTS                                              |
+---------------------------------------------------------------------------------------------------+
| PHASE 1: Order Detail Modal Polish & Production Artboard                                          |
|   • Delete Overview tab; route default open directly to Items & Financials.                      |
|   • Promote Target Date to modal header with inline edit control.                                 |
|   • Delete "Production Context" card; remove nested overflow-y scrolling freeze.                  |
|   • Implement ~400px Master Artboard Canvas with transparent checkerboard pattern.                |
|   • Implement macOS-style recessed segmented control for print locations (NO pills).              |
|   • Add print product variant auto-labeling and manual inch dimension controls [Width x Height].  |
|   • Consolidate Customer and Fulfillment tabs into Customer & Shipping.                           |
|   • Add 1-click [✓ Receive All Blanks] button in Items & Financials table header.                 |
+---------------------------------------------------------------------------------------------------+
| PHASE 2: Board Quick Actions & Readiness Pipelines                                                |
|   • Replace 4 binary checkboxes with linear 3-step tracks (In Cart -> Ordered -> Ready).          |
|   • Add +1 Print counter stepper and [✓ Mark All] button directly on Kanban cards.                |
|   • Implement floating multi-select bulk toolbar at bottom of screen.                             |
|   • Add spring-loaded drag-over tab switching (In S&S Cart <-> Ordered).                          |
|   • Add 1-click [→ Ordered] button to cart cards.                                                 |
|   • Remove `batch-correction-dialog` modal prompt on card movement.                               |
+---------------------------------------------------------------------------------------------------+
| PHASE 3: Supplier Receiving Hub Overhaul                                                          |
|   • Add S&S PO # and Tracking prompt to "Mark In Cart Ordered" action.                            |
|   • Redesign `#blanks-receive-overlay` into the Supplier Receiving Hub.                           |
|   • Implement instant PO # / Tracking # search bar.                                              |
|   • Add 1-click [✓ Receive Full Box] action with instant auto-save.                               |
|   • Build "Ready to Print" customer order completion banner upon check-in.                        |
|   • Implement Active vs. Completed Archive tabs with automatic archiving.                         |
|   • Eliminate `dirty` draft flag, unsaved warnings, and "Move Batch Order" dialogs.               |
+---------------------------------------------------------------------------------------------------+
| PHASE 4: Dual Sync & Regression Verification                                                      |
|   • Connect bi-directional real-time sync between Order Detail and Receiving Hub.                 |
|   • Verify optimistic UI rollback on network error.                                               |
|   • Run focused Vitest suites and build contract verification (`npm run build:contract`).          |
+---------------------------------------------------------------------------------------------------+
```

---

## 8. Verification & Guardrails

1. **Proportional Testing Scope:**
   - Follow repo guardrails from `AGENTS.md`. Focus verification on affected UI contracts, D1 mutations, and R2 compatibility.
   - Do not trigger full release verification (`npm run verify`) for isolated CSS/DOM changes.
   - Run focused tests:
     ```powershell
     npx vitest run test/blanks-batches.test.js
     npx vitest run test/order-detail.test.js
     ```
2. **Build Verification:**
   - Execute `npm run build` and `npm run build:contract` to ensure no bundled chunk regressions occur.
3. **No Breaking Metafield Changes:**
   - Ensure `readiness.blanksOrdered`, `readiness.blanksReady`, `readiness.printsOrdered`, and `readiness.printsReady` maintain backward compatibility with existing Shopify order records.
