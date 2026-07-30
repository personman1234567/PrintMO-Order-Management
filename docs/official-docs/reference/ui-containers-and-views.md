# UI Containers, Displays & Views Reference

## Use This When
- You are adding, modifying, or auditing any UI component, Kanban card tile, modal overlay, or display container in `index.html`, `renderer.js`, or `order-manager-web/`.
- You need to determine what data fields are rendered in a specific UI container and where those fields originate from in either the legacy Redis queue or the Shopify candidate adapter.
- You are adding new fields, badges, or buttons to collapsed order cards or detail overlays.

## Skip This When
- You are editing backend IPC handlers or main-process logic → read [IPC and storage](../architecture/ipc-and-storage.md).
- You are looking for current S&S API contracts → read [External APIs](../architecture/external-apis.md).

## Living Documentation Rule
> **MANDATORY MAINTENANCE CONTRACT**: Any time the UI layout, card tile structure, container contents, or modal fields change in the codebase, this document **MUST** be updated concurrently to match the live implementation.

## Section Map
- [Global Application Layout & Top-Level Containers](#global-application-layout--top-level-containers)
- [Collapsed Order Card Tile Specification](#collapsed-order-card-tile-specification)
- [Complete Modal Overlays & Display Inventory](#complete-modal-overlays--display-inventory)
- [Data Field Source & Pipeline Mapping Table](#data-field-source--pipeline-mapping-table)
- [Common Failure Modes & Recovery](#common-failure-modes--recovery)

---

## Global Application Layout & Top-Level Containers

The primary user interface is built as a three-column grid layout (`.container`) in desktop view, adapting to a tabbed navigation bar (`#mobile-tab-bar`) in constrained/mobile/Shopify Admin iframe views. The embedded web app normally uses the **Shopify board** only. Legacy Redis remains an isolated debug fallback at `?printmo_debug_legacy=1`; it receives the original queue shape, while Shopify maps the Worker board DTO into the renderer shape without reading or mutating Redis.

On the **Shopify board at desktop widths above 900px**, the middle panel becomes the tabbed **Supplies** workspace: `Build Order`, `In S&S Cart`, and `Ordered`. The existing `#blanks-section` is moved into that panel only for this candidate desktop presentation; the right panel then gives `#print-section` its full height. Legacy Redis and the mobile layout preserve the original placement. The diagram below is that retained Legacy/mobile base layout.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 PRINTMO ORDER MANAGER                                 │
├──────────────────────────┬───────────────────────────┬─────────────────────────────────┤
│ PANEL 1: ORDER PIPELINE  │ PANEL 2: CREATE BLANKS    │ PANEL 3: PRODUCTION FULFILLMENT │
│ (.panel.pipeline)        │ (.panel.create)           │ (.panel.fulfillment)            │
│                          │                           │ ┌─────────────────────────────┐ │
│ ┌──────────────────────┐ │ ┌───────────────────────┐ │ │ SUB-SECTION: BLANKS ORDERED   │ │
│ │ Header & Order Count │ │ │ Drag Drop Zone        │ │ │ (#blanks-section / #col-blanks)│ │
│ └──────────────────────┘ │ │ (#col-toOrder)        │ │ └─────────────────────────────┘ │
│ ┌──────────────────────┐ │ └───────────────────────┘ │ ┌─────────────────────────────┐ │
│ │ Ingested Cards Grid  │ │ ┌───────────────────────┐ │ │ SUB-SECTION: READY TO PRINT   │ │
│ │ (#col-received)      │ │ │ Picked Cards Container  │ │ │ (#print-section / #col-print) │ │
│ └──────────────────────┘ │ │ (#picked-cards)       │ │ └─────────────────────────────┘ │
│                          │ └───────────────────────┘ │                                 │
│                          │ ┌───────────────────────┐ │                                 │
│                          │ │ Batch Summary Drawer  │ │                                 │
│                          │ │ (.summary)            │ │                                 │
│                          │ └───────────────────────┘ │                                 │
└──────────────────────────┴───────────────────────────┴─────────────────────────────────┘
```

### Top-Level Containers

| Container Name | DOM Selector | Primary Responsibilities | Children / Sub-Containers |
|---|---|---|---|
| **Main Grid Shell** | `.container` | Outer responsive grid wrapper establishing 3 primary workspace columns. | `.panel.pipeline`, `.panel.create`, `.panel.fulfillment` |
| **Order Pipeline Column** | `.panel.pipeline` | Houses incoming unpaid/paid customer orders awaiting batch assignment. | Header count (`#pipeline-count`), Bundle controls, Cards container (`#col-received`). |
| **Create Blanks / Supplies Panel** | `.panel.create` | Legacy: interactive staging area for aggregating orders into S&S/SanMar batch orders. Shopify desktop: tabbed Supplies workspace. | Legacy/Build: drag target (`#col-toOrder`), picked cards grid (`#picked-cards`), batch summary (`.summary`). Shopify desktop also hosts the existing Blanks section (`#col-blanks`) for `In S&S Cart` and `Ordered`. |
| **Production & Fulfillment** | `.panel.fulfillment` | Legacy: split column managing active production states. Shopify desktop: full-height Ready to Print workspace. | Legacy: Blanks (`#col-blanks`) and Ready to Print (`#col-print`). Shopify desktop: Ready to Print (`#print-section` / `#col-print`) with **To Print** (`print`) and **Printed** (`completed`) tabs over one filtered card grid. |
| **Mobile Tab Bar** | `#mobile-tab-bar` | Bottom navigation bar active in mobile/Shopify Admin viewports (`<1400px`). | Navigation buttons (`Pipeline`, `Blanks Cart`, `Blanks Ordered`, `Ready To Print`). |

---

## Collapsed Order Card Tile Specification

An **Order Card** (`.pipeline-card`, `.card`) is the fundamental visual unit displayed in Kanban columns *before* a user clicks to open the Order Detail overlay.

```
┌──────────────────────────────────────────────┐
│  #1001 (Order Name)         [ 2h ago ] (Pill)│ ─── Header Bar (.card-header)
├──────────────────────────────────────────────┤
│  Customer Name (John Doe)                    │
│  [ Mockup Artwork Thumbnail Preview ]        │ ─── Body Container (.card-body)
│  📦 12 Items   🖨️ 24 Prints                  │
├──────────────────────────────────────────────┤
│  Total Items: 12        [ 75% Complete ]     │ ─── Footer Bar (.card-footer)
└──────────────────────────────────────────────┘
```

### Card Elements & Data Sources

| Visual Component | DOM Class / Element | Information Displayed | Data Source & Logic |
|---|---|---|---|
| **Header Bar** | `.card-header` | Order identifier & time-ago pill. | Background color reflects status enum or bundle state (`.bundle-card`, `.status-yellow`). |
| **Order Name / ID** | `.card-header h3` / `.cust-name` | Shopify Order Name (e.g., `#1001`) or Bundle Label (e.g., `1001-1003`). | Source: `order.name` (or `order.bundle` if grouped). |
| **Time-Ago Pill** | `.time-ago-pill` | Relative elapsed time since creation (e.g., `15m ago`, `2d ago`). | Source: Computed dynamically from ISO-8601 timestamp string `order.created_at`. |
| **Delete Trigger** | `.delete-btn` | Circle trash icon button (`×`). | Source: Calls `window.api.deleteOrder(orderName)`. Hidden when in bundle mode. |
| **Customer Title** | `.cust-name` | Full customer name or custom customer label. | Source: `order.customer` or `order.shipping_address.name` (editable via Name Modal). |
| **Mockup Slot** | `.mockup-slot` | Product artwork thumbnail preview image on Pipeline, In S&S Cart/Ordered, and Ready to Print cards. Ready to Print reserves the slot from first paint and shows loading, available, or unavailable state without changing card height. Its accounting badges mount in a separate status region so they cannot create extra grid rows or displace progress. | Source: first manual R2 mockup, otherwise the first private Designer Studio mockup resolved progressively after first paint. |
| **Garment Count** | `.counts .count-items` | Garment icon + total apparel piece count. | Source: Calculated by summing `item.qty` for all line items in `order.items`. |
| **Print Count** | `.counts .count-prints` | Printer icon + total print impressions needed. | Source: Calculated by inspecting `order.items[].prints` or print location tags. |
| **Footer Bar** | `.card-footer` | Item count summary or production progress. | Displays item total; on `Ready To Print` cards (`.print-card`), displays percentage complete progress bar (`75%`). |

---

## Complete Modal Overlays & Display Inventory

Below is the complete inventory of all 10 modal overlays and secondary screens embedded in `index.html`.

### 1. Order Detail Modal (`#detail-overlay`, `#detail-card`)
- **Purpose**: Responsive order workbench for production decisions and Shopify commerce inspection. Desktop uses a split canvas; mobile adapts it into one continuous full-screen workflow.
- **Displayed Data & Topology**:
  - **Header Bar** (`#detail-header`, `#detail-header-bar`): Order identifier (`#detail-order-id`), customer name (`#detail-header-customer`), financial and fulfillment badges (`#badge-financial`, `#badge-fulfillment`), received timestamp (`#detail-timestamp`), item and total summaries, readiness summary, and the canonical close control (`#detail-close`).
  - **Always-visible Production Pane (~39% desktop)** (`#detail-left-pane`):
    - **Order Artwork** (`#detail-mockups-strip`): Large selected preview (`#detail-mockup-feature`, `#detail-mockup-main`) above a horizontal thumbnail track (`#detail-mockups-track`), with upload and paste controls. Selecting a thumbnail updates the large preview; the large preview opens the asset viewer.
    - **Production Progress** (`#detail-production-card`): Progress bar and printed-piece count, `+1 Print`, custom quantity, and visible save feedback.
    - **Readiness** (`#ready-controls`): Two independent two-step sequences: `Blanks ordered` → `Blanks ready` and `Prints ordered` → `Prints ready`. Ready controls are blocked until their corresponding ordered milestone is set, and changed values are explicitly saved with `#ready-apply`.
    - **Customer & Shop Instructions** (`#detail-notes-wrapper`): Customer name, compact instructions preview, inline desktop editor, and the expanded notes viewer. This production-critical context remains visible while other tabs change.
  - **Tabbed Workspace (~61% desktop)** (`#detail-right-pane`):
    - **Accessible Tabs** (`#detail-tabs-header`): Action Blue active line, click navigation, arrow-key navigation, and synchronized `tab`/`tabpanel` ARIA state.
      1. `Items & financials` (`#tab-items`, default): Line items, custom attributes, discount, and order total.
      2. `Production` (`#tab-production`): Customer checkout note banner and the full-width Design Files workspace (`#detail-design-panel`), grouped into `Front prints`, `Back prints`, and `Extras`.
      3. `Fulfillment` (`#tab-logistics`): Shipping address and tracking.
      4. `Customer & history` (`#tab-customer`): Customer email/phone with protected-data fallback states and the order event timeline.
  - **Mobile adaptation**: `#detail-content` is the sole vertical scroll owner. Both panes become intrinsic-height blocks, tabs scroll horizontally and remain sticky within the workbench, design groups collapse to one column, controls retain at least 44px touch targets, and safe-area padding is honored.
  - **Surface-specific file access**: The desktop detail retains the legacy aggregate `#detail-files-btn` and attachments modal. The Shopify web detail intentionally omits that button because mockups and design files render inline. Shared renderer code treats `#detail-files-btn` as optional.

### 2. Batch Order Summary Drawer (`.summary`)
- **Purpose**: Displays pre-submission totals for blank apparel orders staged in `#col-toOrder`.
- **Displayed Data**: Picked order count, line item quantity total (`#cart-total`), summary list (`#summary-list`), and action buttons: `Clear` (`#clear-picked`) and `Submit To S&S` / `Submit To SanMar` (`#order-submit`).

### 3. File Attachments Modal (`#files-overlay`, `#files-modal`)
- **Purpose**: Upload, view, or remove file attachments (PDFs, artwork proofs, vectors, raster images) associated with an order.
- **Displayed Data**: Interactive drag-and-drop zone (`#file-drop`), file list grid with thumbnail previews (`#file-list`), and control buttons (`#files-remove-btn`, `#files-delete-btn`, `#files-cancel-btn`).

### 4. Production Notes Editor Modal (`#notes-overlay`, `#notes-modal`)
- **Purpose**: Multi-line text editor for modifying order-level shop instructions.
- **Displayed Data**: Textarea element (`#notes-input`) pre-populated with `order.notes`, and `Confirm` / `Cancel` buttons.

### 5. Customer Name Editor Modal (`#name-overlay`, `#name-modal`)
- **Purpose**: Inline editor for changing displayed order/customer names.
- **Displayed Data**: Text input (`#name-input`) pre-populated with `order.customer`, and `Confirm` / `Cancel` buttons.

### 6. Print Progress Input Modal (`#progress-overlay`, `#progress-modal`)
- **Purpose**: Modal prompt for manually setting the exact completed item count.
- **Displayed Data**: Numeric input field (`#progress-input`) with `min="0"` bound to `order.total_items`, and `Confirm` / `Cancel` buttons.

### 7. Full-Screen Notes Viewer Modal (`#view-notes-overlay`, `#view-notes-modal`)
- **Purpose**: Read-only, expanded view for lengthy order notes or customer instructions.
- **Displayed Data**: Pre-wrapped text paragraph (`#view-notes-text`) displaying full un-truncated notes content.

### 8. High-Resolution Asset Viewer Lightbox (`#asset-viewer`)
- **Purpose**: Full-screen modal overlay for zooming and inspecting high-resolution artwork files and mockups.
- **Displayed Data**: Centered image element (`#asset-viewer-img`) with close button (`#asset-viewer-close`).

### 9. Bundle Manager Overlays (`#bundle-overlay`, `#bundle-name-overlay`)
- **Purpose**: Grouping multiple orders into a single consolidated production bundle.
- **Displayed Data**:
  - `#bundle-name-modal`: Text input (`#bundle-name-input`) for entering a bundle name.
  - `#bundle-modal`: Title header (`#bundle-title`), grid container displaying child cards (`#bundle-cards`), and `Destroy Bundle` button (`#bundle-destroy`).

### 10. Full-Screen Column Overlays (`#blanks-overlay`, `#print-overlay`, `#blanks-section.fullscreen`, `#print-section.fullscreen`)
- **Purpose**: Expands `Blanks Ordered` or `Ready to Print` columns into a dedicated 5-column full-screen view for shop-floor display monitors.
- **Displayed Data**: Scaled 5-column grid layout of active cards with full-screen toggle buttons (`#blanks-fullscreen-btn`, `#print-fullscreen-btn`).

---

## Data Field Source & Pipeline Mapping Table

This table maps the established renderer contract to its visual destinations. In Legacy Redis mode these fields come from `shopifyOrdersQueue`; in Shopify board mode `order-manager-web/web-shim.js` derives the commerce fields from Shopify/D1 DTOs and the writable production fields from the canonical Shopify metafield.

| Data Field (JSON Schema) | Type | UI Destination & Element ID | Rendered Transformation / Format |
|---|---|---|---|
| `order.name` | String | Card Header, `#detail-order-id` | Displayed directly (e.g. `#1002`). |
| `order.customer` | String | Card `.cust-name`, `#detail-cust-name` | Displayed as customer name header. |
| `order.created_at` | String (ISO) | Card `.time-ago-pill`, `#detail-timestamp` | Converted to relative time string (e.g. `4h ago`) or formatted date. |
| `order.status` | String (Enum) | Column placement (`#col-received`, `#col-blanks`, `#col-print`) | Determines card's column container and color status class. |
| `order.items` | Array | Card `.counts`, `#detail-items` tbody, `#summary-list` | Iterated to render table rows (`Qty`, `Title`, `Variant`, `Price`) and sum garment counts. |
| `order.items[].qty` | Number | Card `.count-items`, `#detail-items td:nth-child(1)` | Summed for total items; displayed per line item. |
| `order.items[].price` | Number/String | `#detail-items td:nth-child(4)` | Formatted as currency `$XX.XX`. |
| `order.total_price` | Number/String | `#detail-total` | Formatted as currency `$XX.XX` total. |
| `order.total_discounts` | Number/String | `#detail-discount` | Formatted as currency `$XX.XX` discount. |
| `order.notes` | String | `#detail-notes`, `#notes-input`, `#view-notes-text` | Rendered as text; defaults to `No special instructions` if empty. |
| `order.printed_count` | Number | `#progress-bar`, `#progress-text`, Card Footer progress | Calculates percentage: `(printed_count / total_items) * 100%`. |
| `order.files` | Array (Base64) | `#file-list`, `#detail-design-panel` | Rendered as clickable image thumbnails or PDF icon placeholders. |
| `order.mockup` | String (Base64) | Card `.mockup-slot`, `#detail-mockups-track` | Rendered inside `<img>` tag as base64 data URL. |
| `order.bundle` | String/Boolean | Card `.bundle-card`, `#bundle-title` | Alters card styling to blue bundle style and displays bundle name. |

## Common Failure Modes & Recovery

| Failure | Cause | Recovery |
|---|---|---|
| Documented selector does not exist | UI inventory drifted after a refactor | Update this reference in the same task and run `npm run docs:check`. |
| Candidate-only styling changes Legacy Redis | Source scoping was removed | Restore `body[data-order-source="shopify"]` or equivalent candidate scope. |
| Shopify desktop shows multiple Supplies bodies or a wide single card | A final dashboard layout rule overrode the tab visibility or two-column grid | Keep explicit candidate-scoped inactive-body hiding and `repeat(2, minmax(0, 1fr))` queue grids in the final desktop layer. |
| Card field is fetched through rich detail during board load | Summary/detail boundary was ignored | Add the bounded field to the proper summary contract or defer it until detail opens. |
| Mobile content is clipped | Fixed shell has no explicit inner scroll owner | Preserve the routed mobile detail scroll contract. |
