# Etsy Preview Refresh and S&S Blank Recipes

Use this through agent chat only. It is not an Order Manager button, schedule, or Etsy write workflow.

## Use This When

- An Etsy listing gains, loses, or replaces variation-linked mockup images.
- An Etsy listing needs an exact S&S blank SKU mapping before it can be included in an Etsy S&S batch.

## Skip This When

- The task is Shopify catalog setup; Shopify remains governed by its own supplier-SKU workflow.
- The request is to change Etsy media, listings, or an S&S order already submitted.

## Section Map

- [Preview refresh](#preview-refresh)
- [S&S blank recipe](#ss-blank-recipe)
- [Common Failure Modes & Recovery](#common-failure-modes--recovery)

## Preview refresh

When Etsy listing media changes, ask: `refresh Etsy previews for <listing URL>`. The agent first calls the review route and presents each affected variant individually:

- **Unchanged**: Etsy points at the same cached image; no action is needed.
- **Update**: Etsy assigned a different image to an already cached variant; choose whether to replace the private recognition preview.
- **Import**: Etsy newly assigned an image to a previously unpreviewed variant; choose whether to cache it.
- **Archive**: Etsy no longer assigns an image to a cached variant; choose whether to retire the old mapping.

The owner confirms each desired action. The execute request carries only those explicit selectors, so a refresh never silently overwrites or removes a variant preview. Cached previews remain recognition aids, not production-artwork approval.

## S&S blank recipe

When a listing is ready to order, ask: `set up the S&S blank recipe for <listing URL>; style is <brand/style>`. The agent:

1. Reads the listing's exact Etsy property/value selectors.
2. Queries the current dated S&S supplier snapshot locally for exact SKU rows.
3. Shows each Etsy selection and its proposed S&S SKU, color, and size.
4. Requires explicit execute confirmation before storing the recipe.

The stored recipe preserves the optional Etsy source SKU separately and attaches a Print-MO `supplierSku` only when the listing ID and every selected Etsy variation value match exactly. A mapping records the supplier snapshot date, brand, style, color, size, and SKU; it is never guessed from a title.

Once all purchasable lines on an Etsy card resolve to S&S SKUs, an Etsy-only Build Order batch can use the existing S&S gateway. The confirmed batch moves the Etsy record's D1 production state to **In S&S Cart**. Shopify and Etsy cards must be submitted as separate batches because their production authorities remain distinct.

## Common Failure Modes & Recovery

| Symptom | Meaning | Recovery |
|---|---|---|
| A variant is marked `archive` | Etsy no longer links an image to that selector. | Keep it if historical recognition is useful, or explicitly archive only that mapping. |
| No S&S SKU resolves | The listing has no exact blank recipe for the purchased selector. | Review the Etsy selections and configure an exact supplier row; do not guess from title text. |
| Etsy and Shopify cards are selected together | Their production authorities are different. | Submit each source as its own S&S batch. |
| A supplier result is unknown | S&S may already have received the order. | Do not retry; reconcile the supplier result first. |
