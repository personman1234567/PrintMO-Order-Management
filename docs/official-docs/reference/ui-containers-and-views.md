# UI Containers, Displays & Views Reference

## Use This When
- You are adding, modifying, or auditing any UI component, Kanban card tile, modal overlay, or display container in `index.html`, `renderer.js`, or `order-manager-web/`.
- You need to determine what data fields are rendered in a specific UI container and where those fields originate from in either the legacy Redis queue or the Shopify candidate adapter.
- You are adding new fields, badges, or buttons to collapsed order cards or detail overlays.

## Skip This When
- You are editing backend IPC handlers or main process logic $\rightarrow$ read [architecture/ipc-and-storage.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/architecture/ipc-and-storage.md).
- You are looking for S&S/SanMar API schemas $\rightarrow$ read [architecture/external-apis.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/architecture/external-apis.md).

## Living Documentation Rule
> **MANDATORY MAINTENANCE CONTRACT**: Any time the UI layout, card tile structure, container contents, or modal fields change in the codebase, this document **MUST** be updated concurrently to match the live implementation.

## Section Map
- [1. Global Application Layout & Top-Level Containers](#1-global-application-layout--top-level-containers)
- [2. Collapsed Order Card Tile Specification](#2-collapsed-order-card-tile-specification)
- [3. Complete Modal Overlays & Display Inventory](#3-complete-modal-overlays--display-inventory)
- [4. Data Field Source & Pipeline Mapping Table](#4-data-field-source--pipeline-mapping-table)

---

## 1. Global Application Layout & Top-Level Containers

The primary user interface is built as a three-column grid layout (`.container`) in desktop view, adapting to a tabbed navigation bar (`#mobile-tab-bar`) in constrained/mobile/Shopify Admin iframe views. In the embedded web app, the **Legacy Redis / Shopify board** source control reuses this same renderer. Legacy mode receives the original queue shape; Shopify mode maps the Worker board DTO into the renderer shape without reading or mutating Redis.

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
| **Create Blanks Panel** | `.panel.create` | Interactive staging area for aggregating orders into S&S/SanMar batch orders. | Drag target (`#col-toOrder`), Picked cards grid (`#picked-cards`), Batch summary drawer (`.summary`). |
| **Production & Fulfillment** | `.panel.fulfillment` | Split column managing active production states. | Sub-section: Blanks Ordered (`#col-blanks`), Sub-section: Ready to Print (`#col-print`). |
| **Mobile Tab Bar** | `#mobile-tab-bar` | Bottom navigation bar active in mobile/Shopify Admin viewports (`<1400px`). | Navigation buttons (`Pipeline`, `Blanks Cart`, `Blanks Ordered`, `Ready To Print`). |

---

## 2. Collapsed Order Card Tile Specification

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
| **Mockup Slot** | `.mockup-slot` | Product artwork thumbnail preview image. | Source: Base64 data URL string in `order.mockup` or first item's image URL. |
| **Garment Count** | `.counts .count-items` | Garment icon + total apparel piece count. | Source: Calculated by summing `item.qty` for all line items in `order.items`. |
| **Print Count** | `.counts .count-prints` | Printer icon + total print impressions needed. | Source: Calculated by inspecting `order.items[].prints` or print location tags. |
| **Footer Bar** | `.card-footer` | Item count summary or production progress. | Displays item total; on `Ready To Print` cards (`.print-card`), displays percentage complete progress bar (`75%`). |

---

## 3. Complete Modal Overlays & Display Inventory

Below is the complete inventory of all 10 modal overlays and secondary screens embedded in `index.html`.

### 1. Order Detail Modal (`#detail-overlay`, `#detail-card`)
- **Purpose**: Comprehensive inspection and management screen for a single order.
- **Displayed Data**:
  - **Header**: Order Name (`#detail-order-id`), Created ISO Date/Time (`#detail-timestamp`).
  - **Artwork Mockups Strip** (`#detail-mockups-strip`): Horizontal scrolling thumbnail carousel of generated artwork mockups (`#detail-mockups-track`).
  - **Customer & Notes**: Editable Customer Name (`#detail-cust-name`, `#detail-edit-name-btn`), Special Instructions/Notes box (`#detail-notes`, `#detail-view-notes-btn`, `#detail-edit-notes-btn`).
  - **Production Progress**: Dynamic progress bar (`#progress-bar`) displaying completed items vs total (`#progress-text`), with `+1` (`#progress-plus1`) and `Custom Amount` (`#progress-custom`) increment buttons.
  - **Line Items Table** (`#detail-items`): Tabular breakdown listing `Qty`, `Description` (product title), `Variant` (size/color), and `Price` (unit cost).
  - **Financial Summary** (`#detail-summary`): Line item discount totals (`#detail-discount`) and Order Grand Total (`#detail-total`).
  - **Checklist Controls** (`#ready-controls`): Status toggle checkboxes (`chk-blanks`, `chk-prints`, `chk-blanks-ordered`, `chk-prints-ordered`) and `Apply` button (`#ready-apply`).
  - **Design Files Side Panel** (`#detail-design-panel`): Dedicated print file sidebar categorized by `Front Prints` (`#design-front-list`), `Back Prints` (`#design-back-list`), and `Extras` (`#design-extras-list`), with file download triggers.
  - **Surface-specific file access**: The desktop detail retains the legacy aggregate `#detail-files-btn` and attachments modal. The Shopify web detail intentionally omits that button because mockups and design files render inline. Shared renderer code must treat `#detail-files-btn` as optional; an unconditional listener assignment prevents the web overlay from opening.

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

## 4. Data Field Source & Pipeline Mapping Table

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
