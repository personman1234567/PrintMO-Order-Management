---
title: Blanks Batch Receiving Workflow Plan
status: task_3_complete
date: 2026-05-08
feature_area: order management, blanks ordering, supplies receiving, production readiness
primary_terms: S&S batch, blanks batch, batch manifest, Blanks Cart, Mark In Cart Ordered, received garments, accounted garments, oldest order first
---

# Blanks Batch Receiving Workflow Plan

## Goal

Make the blanks receiving workflow faster, clearer, and less error-prone.

The business problem: S&S blank garments arrive in unpredictable boxes, sometimes split across warehouses and days. Garments are not physically sorted by customer order. Staff need a simple way to confirm that every customer order has the garments needed before printing.

The product goal: count received garments once at the batch level, then let the app update each customer order's accounted garment quantities.

## Core Idea

Create an S&S batch when the actual S&S order is placed.

The batch stores a manifest of every garment expected for the customer orders included in that S&S order. When boxes arrive, staff receive garments against the batch manifest. The app then allocates received garments to customer orders and shows which orders are fully accounted for.

## Key Terms

- Customer order: One customer's order in PrintMO Order Manager.
- Blanks Cart: Staging area for customer orders before the S&S order is actually placed.
- S&S batch: A saved group of customer orders created when `Mark In Cart Ordered` is clicked.
- Batch manifest: The expected garment list for an S&S batch.
- Received quantity: How many garments physically arrived for a manifest line.
- Accounted quantity: How many garments are credited to a specific customer order line.
- Allocation: The app's process for assigning received garments from the batch to customer orders.
- Ready To Print: Production stage for customer orders that can move forward after garments are accounted for.

## Current Workflow Problem

Without a batch manifest, staff must mentally connect messy box contents back to individual customer orders. This creates repeated searching, missed garments, and uncertainty about which orders are ready.

The app should not treat a customer order as the same thing as an S&S order. Multiple customer orders can be submitted in one S&S order. Also, one S&S order can arrive in multiple shipments or boxes.

## Proposed Workflow

1. Staff add customer orders to the Blanks Cart over time.
2. Adding to the Blanks Cart does not create a batch.
3. When the S&S order is actually submitted, staff click `Mark In Cart Ordered`.
4. The app creates one S&S batch from all customer orders currently in the Blanks Cart.
5. The app saves a batch manifest containing all expected garment lines for that batch.
6. When boxes arrive, staff open the batch and enter received quantities by garment variant.
7. The app allocates received garments to customer orders using oldest order first.
8. Customer orders show garment accounting progress, such as `5 / 6 accounted`.
9. Orders with all garments accounted for can move forward to Ready To Print.
10. Orders with missing garments stay flagged until the missing garments are received or manually resolved.

## Batch Manifest Behavior

The batch manifest is created from the garments in all customer orders included in the batch.

Manifest lines should group identical garments together when possible:

- product or style
- color
- size
- variant title
- SKU if available

Example manifest line:

```text
Gildan Softstyle / Black / Large
Expected: 12
Received: 11
Missing: 1
```

## Order Detail Behavior

Each customer order should show garment accounting at both summary and line-item levels.

Order summary example:

```text
Garments accounted for: 5 / 6
```

Line item example:

```text
Gildan Softstyle / Black / Large: 1 / 2 accounted
```

This lets staff inspect one order and immediately understand whether it is ready or what is missing.

## Allocation Rule

When multiple customer orders need the same garment and there are not enough received garments for all of them, allocate received garments to the oldest customer orders first.

Reason: oldest-first is simple, predictable, fair, and easy to explain.

Example:

```text
Garment: Gildan Softstyle / Black / Large
Needed: 3
Received: 2

Allocated:
#1001 oldest order: 1 / 1 accounted
#1002 next oldest order: 1 / 1 accounted
#1003 newest order: 0 / 1 accounted
```

The first version should keep this allocation rule simple. Manual override can be added for edge cases.

## Manual Overrides

The batch should allow basic correction after creation.

Minimum useful overrides:

- Add customer order to batch.
- Remove customer order from batch.
- Adjust received quantity.
- Correct an accounted quantity on an individual order line.

Manual changes should update the same batch and order accounting data. There should not be separate competing truths between the batch screen and the order detail screen.

## UI Concept

Primary batch screen:

- Shows each S&S batch.
- Shows total expected garments.
- Shows total received garments.
- Shows missing count.
- Opens to a receiving checklist grouped by garment variant.

Receiving screen:

- Organized garment-first, not order-first.
- Staff count what physically arrived.
- The app calculates which orders are accounted for.

Order detail screen:

- Shows per-line accounted quantities.
- Allows simple correction if needed.

Ready To Print screen:

- Shows whether each order's garments are fully accounted for.
- Fully accounted orders can proceed with less uncertainty.

## Version 1 Scope

Build the simplest version that proves the workflow:

- Create a batch when `Mark In Cart Ordered` is clicked.
- Save the batch manifest.
- Receive quantities against manifest lines.
- Allocate received quantities oldest-order-first.
- Show order-level accounted progress.
- Show line-level accounted progress in order detail.
- Allow simple manual adjustment.

## Task Breakdown

Task 1: Batch foundation. Completed 2026-05-08.

- Add persistent blanks batch records.
- Create a batch manifest from orders marked ordered from the Blanks Cart.
- Store expected garment lines only; print line items are excluded.
- Preserve the existing Blanks Cart and Blanks Ordered behavior.

Task 2: Receiving and allocation. Completed 2026-05-08.

- Add UI to receive quantities against a batch manifest.
- Allocate received garments to customer orders oldest-first.
- Store accounted quantities per customer order line.

Task 3: Order UI and polish. Completed 2026-05-08.

- Show `x / y accounted` at order and line-item level.
- Add simple manual correction paths.
- Reflect accounted status in production screens.

## Task 1 Implementation Notes

Task 1 added the storage and creation foundation only. It does not add a receiving UI yet.

Implemented files:

- `order-manager-proxy/worker.js`
- `order-manager-web/web-shim.js`
- `order-manager-web/blanks-batches.js`
- `order-manager-web/index.html`

Deployment note:

- Deploy the Cloudflare Worker and the web app together for this task. The web script calls the new Worker endpoint.

New API endpoint:

```text
POST /order-manager/blanks-batches
GET /order-manager/blanks-batches
GET /order-manager/blanks-batches?id={batchId}
```

Storage location:

```text
manual-order-assets/blanks-batches/index.json
manual-order-assets/blanks-batches/{batchId}.json
```

Batch creation trigger:

```text
Mark In Cart Ordered
```

The web script captures the orders currently in the Blanks Cart, lets the existing mark-ordered behavior run, then saves a batch manifest after those orders are successfully marked `blanksOrdered`.

Task 1 intentionally avoids changing the visible workflow. If batch save fails after orders are marked ordered, the app alerts that the S&S batch manifest was not saved.

## Batch Record Shape

Task 1 stores batch records with this conceptual shape:

```text
id
label
status: ordered
source: mark-in-cart-ordered
createdAt
updatedAt
orderNames
orders[]
manifest[]
totals
```

Manifest line shape:

```text
itemKey
title
variantTitle
sku
expectedQty
receivedQty: 0
accountedQty: 0
missingQty
orderLines[]
```

Order line shape:

```text
orderName
orderNumber
customer
lineId
title
variantTitle
sku
expectedQty
accountedQty: 0
```

Important Task 1 behavior:

- Identical garments are grouped by SKU when SKU exists.
- If SKU is missing, grouping falls back to product title plus variant title.
- Print line items are filtered out using the existing print-title list.
- Received/accounted quantities start at zero.
- Allocation is not performed in Task 1.

## Task 2 Implementation Notes

Task 2 added the receiving workflow and oldest-first allocation.

Implemented files:

- `order-manager-proxy/worker.js`
- `order-manager-web/web-shim.js`
- `order-manager-web/blanks-batches.js`
- `order-manager-web/desktop.css`
- `order-manager-web/mobile.css`
- `scripts/prepare-cloudflare-pages-upload.sh`

Updated API endpoint:

```text
PATCH /order-manager/blanks-batches
```

Patch body:

```text
{
  id: batchId,
  updates: [
    { itemKey, receivedQty }
  ]
}
```

Task 2 UI:

- Adds a `Receive Batches` button in the Blanks section.
- Opens a batch list.
- Opens an individual batch manifest.
- Shows expected, received, and missing garment totals.
- Lets staff adjust received counts with minus, input, plus, and `All`.
- Saves received quantities to the Worker.

Task 2 allocation behavior:

- Allocation happens server-side in `order-manager-proxy/worker.js`.
- Each manifest line resets accounted quantities before allocation.
- Received quantity is assigned to customer order lines oldest-first.
- Oldest order is determined from the order `receivedAt` timestamp stored in the batch.
- Ties fall back to order name sorting.
- Shortages are represented by lower `accountedQty` and positive `missingQty`.
- Extra received garments are tracked as `extraQty` on the manifest line.

Task 2 batch updates:

- Manifest lines now store updated `receivedQty`, `accountedQty`, `missingQty`, and `extraQty`.
- Each manifest `orderLines[]` entry stores its allocated `accountedQty`.
- Each batch `orders[]` entry stores `accountedGarments`, `missingGarments`, and `fullyAccounted`.
- Batch `totals` stores expected, received, accounted, missing, and fully accounted order counts.
- Batch `status` becomes `received` when all expected garments are accounted for; otherwise it remains `ordered`.

Task 2 intentionally does not yet change the individual order detail screen or Ready To Print cards. Those UI surfaces are Task 3.

## Task 3 Implementation Notes

Task 3 added production-facing accounting visibility.

Implemented files:

- `order-manager-web/blanks-batches.js`
- `order-manager-web/desktop.css`
- `order-manager-web/mobile.css`
- `Markdown Documents/Blanks Batch Receiving Workflow Plan.md`

Task 3 behavior:

- Hydrates batch accounting for currently loaded orders.
- Derives per-order garment accounting from saved batch manifests.
- Adds accounting chips to Blanks Ordered and Ready To Print cards.
- Aggregates accounting chips on bundled production cards.
- Adds a `Garment Accounting` section to the order detail modal.
- Shows order-level `accounted / expected` totals.
- Shows line-level `accounted / expected` counts for each garment variant.
- Adds `Receive Batch` / `Receive Batches` action from the detail panel.

Card chip examples:

```text
Garments accounted
Supplies 3/5
```

Detail line example:

```text
Gildan Softstyle / Black / Large: 1/2
```

Task 3 correction path:

- Corrections still happen through batch receiving.
- From order detail, staff can click `Receive Batch` to open the related batch manifest and adjust received quantities.
- If an order is tied to multiple batches, the detail action opens the batch list instead of guessing which batch to edit.
- Saving receiving re-runs oldest-first allocation and refreshes card/detail accounting.

Task 3 intentionally does not duplicate accounted quantities into separate queue-order fields. The batch manifest remains the source of truth.

## Future Enhancements

Do not build these first unless needed:

- Damaged item tracking.
- Wrong item tracking.
- Extra garment tracking.
- Receiving history by box or date.
- Advanced allocation rules.
- Shop stock inventory.
- Detailed audit trail.
- S&S order number integration.

These are useful later, but the first goal is to make batch receiving work clearly and quickly.

## Design Principle

Keep the workflow simple:

```text
Blanks Cart -> Mark In Cart Ordered -> Create Batch -> Receive Garments -> Account Orders -> Ready To Print
```

The app should handle grouping and accounting. Staff should only need to answer: what garments arrived, and how many?
