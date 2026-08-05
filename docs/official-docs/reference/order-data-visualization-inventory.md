# Order Data Visualization Inventory

## Use This When

- You are deciding what order information a new board, card, order-detail, search, filter, or shop-floor experience may need to visualize.
- You need to distinguish what the current UI displays from what PrintMO already fetches and what Shopify can provide with an expanded GraphQL selection.
- You are changing the board summary DTO, rich order-detail DTO, production metadata, artwork presentation, or protected-customer-data usage.

## Skip This When

- You are implementing a layout that has already selected its data contract; use [UI Containers, Displays & Views](ui-containers-and-views.md) and the routed UI workflow instead.
- You are changing Shopify/D1/R2 authority, mutation, webhook, or reconciliation behavior; use [Shopify-Primary Candidate Data Plane](../architecture/shopify-primary-data-plane.md).
- You are diagnosing a live detail permission failure; use [Shopify live detail scope failure](../runbooks/troubleshooting.md#shopify-live-detail-scope-failure).

## Section Map

- [Purpose and status vocabulary](#purpose-and-status-vocabulary)
- [Source and authority boundaries](#source-and-authority-boundaries)
- [What the product currently visualizes](#what-the-product-currently-visualizes)
- [Current Shopify query and DTO coverage](#current-shopify-query-and-dto-coverage)
- [Visualization-relevant Shopify inventory](#visualization-relevant-shopify-inventory)
- [Complete Shopify Order field coverage](#complete-shopify-order-field-coverage)
- [PrintMO production, artwork, and operational inventory](#printmo-production-artwork-and-operational-inventory)
- [Access, privacy, freshness, and payload constraints](#access-privacy-freshness-and-payload-constraints)
- [Questions reserved for the layout phase](#questions-reserved-for-the-layout-phase)
- [Source anchors](#source-anchors)
- [Common Failure Modes & Recovery](#common-failure-modes--recovery)

## Purpose and Status Vocabulary

This is the pre-layout data inventory. It deliberately records available information without deciding card density, hierarchy, navigation, responsive behavior, or final visual treatment.

Availability labels:

| Label | Meaning |
|---|---|
| **Board** | Rendered by the shared operational board/card experience now. |
| **Shared detail** | Rendered by `renderer.js → openDetail` now. |
| **Live detail** | Rendered by the separate Shopify-live diagnostic detail in `shopify-preview.js` now. |
| **Returned, not visualized** | Already present in a current Worker DTO or renderer object but not shown on the corresponding current surface. |
| **API available, not queried** | Exposed by Shopify Admin GraphQL API 2026-07 but absent from the current PrintMO selection/DTO. |
| **Conditional** | Depends on order shape, shop feature, Shopify plan, protected-customer-data approval, or an additional fulfillment scope. |
| **PrintMO-owned** | Comes from the production metafield, D1 app records, or private R2 assets rather than Shopify commerce. |

Display-relevance labels are inventory guidance, not layout decisions:

| Relevance | Meaning |
|---|---|
| **Primary** | Routinely needed to identify the order or perform production work. |
| **Detail** | Useful when inspecting or resolving an order, but not necessarily on every collapsed card. |
| **Exception/history** | Most useful when something is late, blocked, changed, canceled, refunded, or disputed. |
| **Usually hidden** | Technical, sensitive, unstable, or low-value data that should not be a normal visual element. |

## Source and Authority Boundaries

An order experience combines several authorities. The UI must keep their meanings distinct.

| Source | Owns | Does not own |
|---|---|---|
| **Shopify order** | Commerce facts: identity, customer, products, quantities, prices, discounts, taxes, payments, delivery, fulfillment, returns, refunds, conversion, and Shopify timeline | PrintMO production stage, readiness, print progress, internal production notes, or private artwork |
| **`$app:printmo.production_state_v1`** | Per-order PrintMO stage, readiness, printed count, bundle, batch references, internal notes, attention/archive state, revision, and actor/timestamps | Shopify commerce |
| **D1** | Rebuildable order projection plus app-only mutation, audit, webhook, reconciliation, batch, supplier-attempt, asset-manifest, and migration records | A second canonical Shopify order |
| **Private R2** | Manual mockups and imported Designer Studio mockup/design bytes | Commerce or production state |
| **Legacy Redis** | Isolated pre-cutover fallback data for the Legacy Redis view | Candidate Shopify-board reads or mutations |

Shopify commerce fields remain read-only in the current board. A future visual must not make a Shopify fact appear editable merely because a nearby PrintMO production field is editable.

## What the Product Currently Visualizes

### Shared operational board

The board uses the bounded Shopify/D1 summary mapped through `web-shim.js` into the established renderer contract.

| Current visual | Current data | Notes |
|---|---|---|
| Column and tab placement | PrintMO production `stage`; `blanks_cart` and `blanks_ordered` remain distinct; `print` and `completed` map to **To Print** and **Printed** | Stage is both data and board position. |
| Column counts | Number of active projected orders per visible stage/view | A view count, not a Shopify order field. |
| Order number/name | Shopify `Order.name` mapped to the card order-number segment | Example: `#1572`. |
| Customer/recipient name | Shipping name, then billing name, then customer first/last name | Falls back to `Name unavailable`; protected fields may be redacted. |
| Relative age | Shopify `createdAt` | Rendered as a time-ago pill. |
| Mockup thumbnail | First manual R2 mockup, otherwise first private Designer Studio mockup | Present on pipeline card styles that include a mockup slot; private tickets hydrate after first paint. |
| Apparel count | Sum of non-print renderer line-item quantities | Derived from mapped line items. |
| Print count | Sum of renderer items classified as print items | Derived compatibility concept; Shopify does not supply a PrintMO print-impression count directly. |
| Subtotal | Shopify current subtotal | Current amount after applicable edits/returns/refunds. |
| Readiness state | PrintMO blanks/prints readiness and ordered flags | Communicated by status color and green/neutral icons. |
| Print progress | PrintMO `printedCount` divided by apparel quantity | Used by the Ready to Print card style as a percentage. Reaching the nonzero garment total from `print` atomically advances the board stage to `completed`; correcting a completed count below the total returns it to `print`. |
| Bundle | PrintMO `bundleId` | Bundled orders collapse into a bundle card with order count/readiness. |
| Archive/delete affordance | PrintMO archive mutation in Shopify view | The control archives candidate orders; it does not delete the Shopify order. |

### Shared order detail

`renderer.js → openDetail` currently displays:

- Shopify order number and created date/time.
- Operational recipient/customer name.
- Manual and Designer Studio mockup carousel.
- Front, back, and extra private design files with preview/download behavior.
- PrintMO internal production notes.
- Print progress as printed pieces versus total apparel.
- Line-item quantity, title, SKU, variant title, and calculated line total; internal asset metadata stays out of the item table.
- Current subtotal, named shipping or local-pickup selection, discount when applied, tax total, and total. Tax breakdown is available behind a collapsed disclosure.
- Shopify delivery/fulfillment, conversion, discounts, and timeline data when returned, plus a separate PrintMO production history.
- PrintMO blanks/prints ordered and ready controls.

The shared Shopify-board workbench first paints from the bounded board object, then loads and renders the canonical `GET /order-manager/v1/orders/:gid` response. Optional Shopify permission failures remain partial-data notices rather than order exceptions.

### Separate Shopify-live detail

The diagnostic/live detail currently displays substantially more data than the shared operational detail:

- order payment and fulfillment statuses;
- received, processed, and Shopify-updated timestamps;
- sales channel, current item quantity, test-order flag, Shopify note, and tags;
- current subtotal, shipping, discount, tax, total, received, refunded, and outstanding amounts;
- payment transaction kind, gateway, time, amount, and status;
- customer name, email, phone, and locale when returned;
- shipping and billing addresses;
- checkout shipping selections and prices;
- fulfillment-order status, request status, delivery method, service code, and delivery window;
- completed fulfillment status, item quantity, delivery estimate/actual date, carrier, tracking number, and tracking link;
- conversion readiness, customer order index, days to conversion, and first/last attributed visit;
- discount application label/type/target/value;
- all paginated line items with title, variant, custom attributes, SKU, original/current quantity, unit price, discount, and current total;
- operational order detail preserves those canonical lines but presents repeated title/SKU/variant combinations as one consolidated row with summed quantity and current total; internal batch/link identities remain hidden and unchanged;
- the 25 most recent Shopify order events;
- editable PrintMO stage, printed count, bundle, internal notes, readiness, blanks PO references, production revision, and last-saved time.

This rich detail is a separate surface. Its existence does not mean those fields are in the normal board card or shared order detail.

## Current Shopify Query and DTO Coverage

### Board summary selection

The current board projection queries:

- identity/lifecycle: `id`, `name`, `createdAt`, `updatedAt`, `cancelledAt`;
- status: `displayFinancialStatus`, `displayFulfillmentStatus`;
- money: `currencyCode`, `currentSubtotalPriceSet`, `currentTotalDiscountsSet`, `currentTotalPriceSet`;
- quantity: `currentSubtotalLineItemsQuantity`;
- operational name candidates: customer first/last/display name, shipping name, billing name;
- every line item through pagination: line-item ID, SKU, title, variant title/ID, original/current quantity, original unit price, and allowlisted custom attributes used for Designer Studio artwork.

The board DTO also returns sync freshness/partial-error metadata, production state, attention state, and asset manifest metadata.

### Canonical rich-detail selection

`GET /order-manager/v1/orders/:gid` adds Shopify order note, approved customer email/phone/locale when returned, fuller shipping/billing addresses, fulfillment/tracking records, and line-item discount allocations. The shared Shopify-board workbench loads these values on demand after its bounded summary first paint.

### Shopify-live diagnostic selection

The diagnostic query additionally fetches and normalizes:

- processed/closed/canceled timestamps and cancel reason;
- tags, test flag, source name, order/customer email and phone, and customer locale;
- full current totals, payment gateways, and up to 25 transactions;
- up to 10 shipping lines and 10 fulfillment orders;
- fulfillments and tracking;
- conversion summary;
- up to 10 discount applications;
- the 25 most recent order events;
- complete line-item pagination with vendor, fulfillment quantities, shipping requirement, pricing, discounts, and custom attributes.

### Already returned but not visualized on the shared board/detail

These fields are especially easy to overlook because no new Shopify query is required before using them:

| Data | Current availability | Current gap |
|---|---|---|
| Financial status | Board DTO | Not shown on shared cards/detail. |
| Fulfillment status | Board DTO | Not shown on shared cards/detail. |
| Cancellation timestamp | Board DTO | Not shown on shared cards/detail. |
| Currency code | Board DTO | Amounts are formatted with a hard-coded dollar sign in the shared renderer. |
| Shopify last-updated time | Board DTO | Not shown on shared cards/detail. |
| Current subtotal line-item quantity | Board DTO | Renderer derives counts from line items instead. |
| Line-item ID, variant ID, SKU, and custom attributes | Board DTO/renderer object | SKU is shown in its own shared-detail column; only allowlisted asset attributes are used outside the table. |
| Line-item pagination completeness and sync errors/freshness | Board DTO | No stale/partial/error indicator is shown on shared cards. |
| Attention required/reasons | Board DTO | Not shown by the shared renderer. |
| Shopify order note | Canonical detail DTO | Shown separately from PrintMO internal notes in shared detail. |
| Full shipping/billing address | Canonical detail DTO | Shown in the shared Fulfillment tab when returned. |
| Fulfillment tracking | Canonical detail DTO | Shown in the shared Fulfillment tab when returned. |
| Line-item discount allocations | Canonical detail DTO | Shared detail shows only aggregate discount. |

## Visualization-Relevant Shopify Inventory

### Order identity, lifecycle, and state

| Data point | Shopify path | Availability now | Relevance |
|---|---|---|---|
| Stable order ID | `Order.id` | Returned, not visualized | Usually hidden; required for links, mutations, and joins. |
| Admin-facing order name | `name` | Board, shared detail, live detail | Primary. |
| Numeric order number | `number` | API available, not queried | Detail; do not assume it is globally unique or consecutive. |
| Customer-facing confirmation number | `confirmationNumber` | API available, not queried | Detail/support. |
| Created, processed, updated | `createdAt`, `processedAt`, `updatedAt` | Created on all current surfaces; processed/updated on live detail | Primary/detail. |
| Closed state/time | `closed`, `closedAt` | Time queried in live detail | Exception/history. |
| Cancellation details | `cancelledAt`, `cancelReason`, `cancellation` | Timestamp on board DTO; basic reason/time on live detail; structured cancellation not queried | Exception/history; cancellation should be visually unambiguous. |
| Shopify financial and fulfillment display status | `displayFinancialStatus`, `displayFulfillmentStatus` | Board DTO; live detail | Primary/detail. |
| Confirmed, edited, test | `confirmed`, `edited`, `test` | Test on live detail; others not queried | Exception/history. |
| Order note and tags | `note`, `tags` | Live detail; note also canonical detail DTO | Detail. Keep separate from PrintMO internal notes. |
| Custom order attributes | `customAttributes` | API available, not queried | Detail when operational attributes exist. |
| Shopify alerts | `alerts` | API available, not queried | Exception; can expose Shopify-required action. |
| Timeline/comment presence and events | `hasTimelineComment`, `events` | Events on live detail; comment flag not queried | Exception/history. |
| Status-page URL | `statusPageUrl` | API available, not queried | Usually hidden or support-only; treat as customer-access data. |

### Customer, recipient, and B2B identity

| Data point | Shopify path | Availability now | Relevance |
|---|---|---|---|
| Operational recipient name | shipping name → billing name → customer first/last | Board, shared detail, live detail | Primary. |
| Customer ID and display name | `customer.id`, name fields | ID live detail; name all current surfaces | Detail/technical. Guest checkout may have no Customer object. |
| Order email and phone | `email`, `phone`; customer email/phone | Live detail | Detail; protected customer data. |
| Customer locale | `customerLocale` | Live detail | Detail/support. |
| Shipping and billing addresses | `shippingAddress`, `billingAddress` | Live detail; canonical detail DTO | Detail; protected customer data. |
| Display address and address match | `displayAddress`, `billingAddressMatchesShippingAddress` | API available, not queried | Detail. |
| Marketing consent at purchase | `customerAcceptsMarketing` | API available, not queried | Usually hidden from production UI. |
| B2B purchasing entity | `purchasingEntity` | API available, not queried | Detail for company orders. May expose company, contact, and location context. |
| Purchase-order number | `poNumber` | API available, not queried | Detail for B2B; distinct from PrintMO/S&S batch PO. |

### Line items and production inputs

Shopify's `LineItem` object can provide all of the following. Bolded groups are especially relevant to PrintMO production.

| Group | Fields | Availability now | Relevance |
|---|---|---|---|
| **Identity and description** | `id`, `name`, `title`, `variantTitle`, `sku`, `vendor` | ID/title/variant/SKU now; vendor live detail; `name` not queried | Primary. |
| **Ordered/current/remaining quantities** | `quantity`, `currentQuantity`, `unfulfilledQuantity`, `nonFulfillableQuantity`, `refundableQuantity` | Quantity/current on board; unfulfilled on live DTO; others not queried | Primary/detail/exception. |
| **Product/variant references** | `product`, `variant` | Variant ID now; full product/variant not queried | Detail; useful for product image, option, inventory, barcode, weight, and product status context. |
| **Product image** | `image` | API available, not queried | Detail/thumbnail fallback; distinct from artwork mockup. |
| **Custom properties** | `customAttributes` | Board DTO and live detail | Primary/detail for personalization and Designer Studio references. |
| **Pricing** | `originalUnitPriceSet`, `originalTotalSet`, `discountedUnitPriceSet`, `discountedUnitPriceAfterAllDiscountsSet`, `discountedTotalSet`, `priceAfterAllDiscountsBeforeTaxesSet`, `totalDiscountSet` | Original unit/total, total discount, and current total in live DTO; only unit price in shared renderer | Detail. Preserve shop and presentment currency meaning. |
| **Allocated adjustments** | `discountAllocations`, `taxLines`, `duties` | Discounts current; taxes/duties not queried | Detail/exception. |
| **Fulfillment attributes** | `requiresShipping`, `restockable`, `merchantEditable` | Requires shipping live DTO; others not queried | Detail/exception. |
| **Physical attributes** | `weight` | API available, not queried | Detail; useful for shipping or blank-product verification. |
| **Special product types** | `isGiftCard`, `sellingPlan`, `contract`, `lineItemGroup` | API available, not queried | Conditional/detail. |
| **Return support** | `suggestedReturnReasonDefinitions` | API available, not queried | Usually hidden unless returns enter scope. |
| **Staff attribution** | `staffMember` | API available, not queried | Conditional/history. |

PrintMO must continue distinguishing:

- apparel-piece quantity from print-impression quantity;
- Shopify product/variant imagery from customer-specific artwork mockups;
- original quantity from current quantity after edits/refunds;
- Shopify line-item custom attributes from trusted, private asset manifests.

### Money, discounts, tax, duties, and payment

| Data point | Shopify path | Availability now | Relevance |
|---|---|---|---|
| Shop and presentment currency | `currencyCode`, `presentmentCurrencyCode`; `MoneyBag` values | Shop currency queried; presentment values not normalized | Primary/detail for non-USD correctness. |
| Current subtotal, shipping, discount, tax, total | `currentSubtotalPriceSet`, `currentShippingPriceSet`, `currentTotalDiscountsSet`, `currentTotalTaxSet`, `currentTotalPriceSet` | Board has subtotal/discount/total; canonical shared detail and live detail have all | Primary/detail. |
| Original totals | `subtotalPriceSet`, `originalTotalPriceSet`, original shipping/tax/discount fields | API available, mostly not queried | Detail/history; compare only with clear “original” labeling. |
| Received, outstanding, refundable/capturable | `totalReceivedSet`, `totalOutstandingSet`, `netPaymentSet`, `totalCapturableSet`, `capturable`, `refundable` | Received/outstanding live detail; others not queried | Detail/exception. |
| Refund totals | `totalRefundedSet`, `totalRefundedShippingSet`, `refundDiscrepancySet` | Total refunded live detail | Exception/history. |
| Discounts | `discountApplications`, `discountCode`, `discountCodes`, line/shipping allocations | Applications and allocations live detail; code convenience fields not queried | Detail. |
| Tax | `currentTaxLines`, `taxLines`, `taxesIncluded`, `taxExempt`, `estimatedTaxes` | Aggregate tax and line-item tax lines in canonical shared detail; tax breakdown is collapsed by default | Detail/exception. |
| Duties and fees | `additionalFees`, current/original duties and additional-fee sets, `dutiesIncluded` | API available, not queried | Conditional/detail for international orders. |
| Tips and cash rounding | `totalTipReceivedSet`, `totalCashRoundingAdjustment` | API available, not queried | Conditional/detail. |
| Payment gateways and transactions | `paymentGatewayNames`, `transactions`, `transactionsCount` | Gateways/transactions live detail | Detail/exception. |
| Payment collection and terms | `paymentCollectionDetails`, `paymentTerms`, `agreements` | API available, not queried | Conditional/detail for deferred/B2B payments. |
| Payment state helpers | `fullyPaid`, `unpaid`, `canMarkAsPaid` | Fully paid/unpaid live DTO; helper not queried | Detail/exception. |
| Suggested refund | `suggestedRefund` | API available, not queried | Usually hidden unless refund operations enter scope. |

Transaction detail available from Shopify includes amount, kind, status, gateway, processing time, error code, masked account, payment details/icon, manual/capture flags, authorization expiry, refundable/unsettled amount, fees, settlement currency/rate, parent transaction, POS location/device/staff, and Shopify Payments details. The live detail currently shows only kind, gateway, time, amount, status, and normalized error data. Raw `receiptJson` is gateway-specific and should not become a UI or business-logic contract.

### Shipping, fulfillment, pickup, and tracking

| Data point | Shopify path | Availability now | Relevance |
|---|---|---|---|
| Requires shipping / fulfillable | `requiresShipping`, `fulfillable` | Order-level fields not queried | Primary/detail for physical-production routing. |
| Shipping selection | `shippingLines`: title, code, source, category, custom flag, original/current price, discounts | Canonical shared detail and live detail | Detail. |
| Legacy first shipping line | `shippingLine` | API available, not queried | Usually hidden; prefer the connection. |
| Fulfillment-order status | `fulfillmentOrders.status`, `requestStatus` | Live detail | Primary/detail. |
| Assigned location | `fulfillmentOrders.assignedLocation` | API available, not queried | Detail; useful if production/fulfillment location varies. |
| Delivery method/window | delivery method type, presented name, service code, min/max delivery time | Live detail | Detail. |
| Fulfill-at / fulfill-by | `fulfillAt`, `fulfillBy` | Live detail DTO | Primary/detail for due-date risk. |
| Destination | `fulfillmentOrders.destination` | API available, not queried | Detail; protected customer data may apply. |
| Fulfillment-order line items | line item, total/remaining quantity | API available, not queried | Primary/detail when orders split across locations or holds. |
| Holds and supported actions | `fulfillmentHolds`, `supportedActions` | API available, not queried | Exception. |
| Shipment/fulfillment records | name, status/display status, timestamps, quantity | Live detail | Detail/history. |
| Tracking | carrier, number, URL | Live detail and canonical detail DTO | Detail/support. |
| Delivery milestones | in-transit, estimated delivery, delivered time, fulfillment events | Estimate/delivered live detail; in-transit/events not queried | Exception/history. |
| Fulfillment origin/location/service | origin address, location, service | API available, not queried | Conditional/detail. |

`Order.fulfillmentOrders` is scope-filtered. The current installation requests merchant-managed and third-party fulfillment-order read scopes, but the UI must still tolerate partial/null results.

### Conversion and attribution

| Data point | Shopify path | Availability now | Relevance |
|---|---|---|---|
| Attribution readiness | `customerJourneySummary.ready` | Live detail | Detail; prevents treating incomplete attribution as final. |
| Customer order index | `customerOrderIndex` | Live detail | Detail; useful repeat-customer context, not the Shopify order number. |
| Days to conversion | `daysToConversion` | Live detail | Detail/analytics. |
| First and last visit | occurred time, source, source description/type, landing page, referrer, referral code | Live detail | Detail/analytics. |
| Full interaction timeline | `moments`, `momentsCount` | API available, not queried | Usually hidden or analytics-only; can be expensive and must be paginated. |
| Order attribution object | `Order.attribution` | API available, not queried | Conditional/analytics. |

### Returns, refunds, disputes, and risk

| Data point | Shopify path | Availability now | Relevance |
|---|---|---|---|
| Returns and return status | `returns`, `returnStatus` | API available, not queried | Exception; important if production should stop or quantities changed. |
| Refund records | `refunds` | Only aggregate refunded amount is shown live | Exception/history; can include refund line items, duties, shipping, adjustments, transactions, and timestamps. |
| Non-fulfillable line items | `nonFulfillableLineItems` | API available, not queried | Exception. |
| Risk summary | `risk` | API available, not queried | Exception; access/meaning should be reviewed before exposure. |
| Disputes | `disputes` | API available, not queried | Exception/history. |
| Shopify Protect | `shopifyProtect` | API available, not queried | Conditional/exception. |
| Restockable/refundable state | `restockable`, `refundable` | API available, not queried | Exception. |

### Source, channel, staff, and extensibility

| Data point | Shopify path | Availability now | Relevance |
|---|---|---|---|
| Source/channel | `sourceName`, `sourceIdentifier`, `registeredSourceUrl`, `publication`, `app` | Source name live detail | Detail. |
| Retail location | `retailLocation` | API available, not queried | Conditional for POS. |
| Staff member | `staffMember` | API available, not queried | Conditional/history. |
| Merchant/business entity | `merchantBusinessEntity`, `merchantOfRecordApp` | API available, not queried | Conditional/detail. |
| Localized fields | `localizedFields` | API available, not queried | Conditional. |
| Order metafields | `metafield`, `metafields` | PrintMO production metafield is read separately | Detail only for explicitly approved namespaces/keys; never enumerate indiscriminately into the browser. |

### Technical or sensitive fields not intended for routine visualization

| Data | Reason |
|---|---|
| `cartToken`, `checkoutToken` | Correlation tokens, not operational display data. |
| `clientIp` | Personal/sensitive fraud signal; no routine production-UI need. |
| `legacyResourceId` | Compatibility identifier; prefer GraphQL GID internally. |
| Raw transaction `receiptJson` | Gateway-specific, unstable, and potentially sensitive. |
| Private R2 object keys, Shopify access tokens, infrastructure IDs/secrets | Must never enter browser DTOs or logs. |
| Full status-page URL | Customer-access/support data; expose only after a security and workflow decision. |

## Complete Shopify Order Field Coverage

This index accounts for every non-deprecated field listed on Shopify Admin GraphQL API 2026-07 `Order`. It is a schema coverage checklist, not a recommendation to query or display every field.

| Domain | Exact `Order` fields |
|---|---|
| Identity and lifecycle | `id`, `legacyResourceId`, `name`, `number`, `confirmationNumber`, `createdAt`, `processedAt`, `updatedAt`, `closed`, `closedAt`, `cancellation`, `cancelledAt`, `cancelReason`, `confirmed`, `edited`, `test`, `note`, `tags`, `customAttributes`, `alerts`, `hasTimelineComment`, `events`, `statusPageUrl` |
| Customer, address, and B2B | `customer`, `email`, `phone`, `customerLocale`, `customerAcceptsMarketing`, `billingAddress`, `shippingAddress`, `displayAddress`, `billingAddressMatchesShippingAddress`, `purchasingEntity`, `poNumber`, `canNotifyCustomer` |
| Source and merchant context | `app`, `attribution`, `sourceName`, `sourceIdentifier`, `registeredSourceUrl`, `publication`, `retailLocation`, `staffMember`, `merchantBusinessEntity`, `merchantOfRecordApp`, `productNetwork` |
| Status and actionability | `displayFinancialStatus`, `displayFulfillmentStatus`, `fullyPaid`, `unpaid`, `capturable`, `canMarkAsPaid`, `refundable`, `restockable`, `fulfillable`, `requiresShipping`, `merchantEditable`, `merchantEditableErrors`, `returnStatus`, `risk`, `disputes`, `shopifyProtect` |
| Items and physical totals | `lineItems`, `nonFulfillableLineItems`, `currentSubtotalLineItemsQuantity`, `subtotalLineItemsQuantity`, `currentTotalWeight`, `totalWeight` |
| Current money and adjustments | `currencyCode`, `presentmentCurrencyCode`, `currentCartDiscountAmountSet`, `currentShippingPriceSet`, `currentSubtotalPriceSet`, `currentTaxLines`, `currentTotalAdditionalFeesSet`, `currentTotalDiscountsSet`, `currentTotalDutiesSet`, `currentTotalPriceSet`, `currentTotalTaxSet`, `netPaymentSet`, `refundDiscrepancySet` |
| Original/aggregate money | `cartDiscountAmountSet`, `subtotalPriceSet`, `originalTotalAdditionalFeesSet`, `originalTotalDutiesSet`, `originalTotalPriceSet`, `totalCapturableSet`, `totalCashRoundingAdjustment`, `totalDiscountsSet`, `totalOutstandingSet`, `totalPriceSet`, `totalReceivedSet`, `totalRefundedSet`, `totalRefundedShippingSet`, `totalShippingPriceSet`, `totalTaxSet`, `totalTipReceivedSet` |
| Discounts, tax, duties, fees | `discountApplications`, `discountCode`, `discountCodes`, `taxLines`, `taxesIncluded`, `taxExempt`, `estimatedTaxes`, `dutiesIncluded`, `additionalFees` |
| Payment | `paymentGatewayNames`, `transactions`, `transactionsCount`, `paymentCollectionDetails`, `paymentTerms`, `agreements`, `suggestedRefund` |
| Shipping and fulfillment | `shippingLine`, `shippingLines`, `fulfillmentOrders`, `fulfillments`, `fulfillmentsCount` |
| Post-purchase | `refunds`, `returns` |
| Conversion | `customerJourneySummary` |
| Extensibility and localization | `metafield`, `metafields`, `localizedFields` |
| Technical/sensitive | `cartToken`, `checkoutToken`, `clientIp` |

When Shopify adds, removes, or changes fields in a future pinned API version, update this index only after comparing the new schema with the live queries and DTOs.

## PrintMO Production, Artwork, and Operational Inventory

These data points are not Shopify commerce even when some are stored on a Shopify order metafield.

### Canonical production metafield

| Data point | Current visualization | Relevance |
|---|---|---|
| Schema version | None | Usually hidden; migration/compatibility. |
| Monotonic production revision and compare digest | Revision shown in live detail; digest hidden | Usually hidden except conflict/support state. |
| Last mutation ID | None | Usually hidden; idempotency/repair. |
| Stage | Board position, tabs, live editor | Primary. |
| Blanks ordered, blanks ready, prints ordered, prints ready | Card status/icon treatment, shared detail controls, live editor subset | Primary. |
| Printed count | Print card percentage, shared detail progress, live editor | Primary. |
| Bundle ID | Bundle card and editors | Primary/detail. |
| Batch/PO references | Live detail | Detail/history. |
| Internal production notes | Shared detail and live editor | Primary/detail; never conflate with Shopify order note. |
| Attention required, reasons, acknowledgment | Returned on board DTO, not shown in shared renderer | Exception. |
| Archived at/by | Archive action; timestamp/actor not displayed | Exception/history. |
| Updated time and actor | Live editor shows last-saved time; actor not shown | History/audit. |

### Artwork and asset manifests

| Data point | Current visualization | Relevance |
|---|---|---|
| Manual R2 mockups | First card thumbnail and shared detail carousel | Primary. |
| Designer Studio mockups | Card fallback thumbnail and detail carousel | Primary. |
| Front/back/extra design files | Shared detail design panel | Primary/detail. |
| Asset ID, filename, type, byte size, role, side, line-item ID, design reference, state, created/updated time | Filename/type/role/side affect current rendering; most metadata is not shown | Detail/technical. |
| Private read-ticket availability/error | Placeholder or preview-unavailable state | Exception. |
| Checksum, source key, private object key | Never visualized | Security/integrity only. |
| Manual checklist item ID/label/metadata/checked state | Separate manual checklist workflow | Primary/detail when that workflow is in scope. |

### D1 operational and audit records

| Data family | Potentially useful information | Relevance |
|---|---|---|
| Projection sync | fetched/fresh/stale times, partial flag, errors, Shopify updated time | Exception/support; stale data must not masquerade as live. |
| Mutation requests | actor, requested patch, expected revision, state, result/error, timestamps | History/support. |
| Production events | actor, action, old/new revision, changed fields, outcome, time | History/audit. |
| Webhook receipts | topic, order, delivery state, triggered/received time, error | Support only. |
| Reconciliation checkpoints | job, last start/completion/result | Support only. |
| Batches | PrintMO/S&S PO number, state, line hash, creator, timestamps, response/expiry | Primary/detail/history for blank ordering. |
| Batch membership | order, captured production revision, quantity hash | Detail/history. |
| Supplier attempts | attempt type, outcome, HTTP status, time | Exception/support; raw response should remain server-side. |
| Migration ledger | source identity/hash, target, state, attempts, error, timestamps | Support only. |

## Access, Privacy, Freshness, and Payload Constraints

- The app currently requests `read_orders`, `write_orders`, `read_all_orders`, `read_merchant_managed_fulfillment_orders`, and `read_third_party_fulfillment_orders`.
- Shopify limits ordinary `read_orders` access to the recent order window; `read_all_orders` is required for older production work.
- Names, address lines/geolocation/ZIP codes, email, and phone are individually protected customer fields. The API can return `null` plus GraphQL errors for unapproved fields. The UI must support absent/redacted data without turning a partial response into “order not found.”
- Data minimization still applies even when a field is technically accessible. Query and expose only data needed by an approved operational experience.
- Fulfillment-order connections return only the subset allowed by installed fulfillment scopes.
- Shopify connections such as line items, events, returns, fulfillment orders, moments, metafields, and discount applications are paginated. A visible count or “complete” claim requires complete pagination or an explicit partial indicator.
- Board summary reads must stay bounded. Rich, expensive, protected, or rarely used fields belong behind on-demand detail or a purpose-specific endpoint.
- Money values must retain currency code and whether the value is shop or presentment currency. The current shared renderer's hard-coded `$` formatting is not a safe general contract.
- “Current” Shopify money/quantity fields reflect edits, returns, refunds, and cancellations; original fields do not. Never combine them under an unlabeled generic total.
- Shopify timeline, transactions, customer journey, risk, returns, and fulfillment data can change after order creation. Their fetch time and stale/partial state matter.
- Product images and customer artwork are different assets. A product/variant image is never proof that a custom design file or production mockup exists.
- Browser DTOs and logs must never expose infrastructure secrets, Shopify tokens, R2 object keys, or unbounded raw gateway/supplier payloads.

## Questions Reserved for the Layout Phase

This inventory intentionally leaves these decisions open:

- Which fields belong on every collapsed card versus only in on-demand detail?
- Which exceptions deserve badges, blocking states, or proactive alerts?
- Which time concept should drive urgency: order age, production-stage age, fulfill-by date, or promised delivery window?
- How should original versus current quantities/totals be compared?
- How should Shopify order note, line-item properties, and PrintMO internal notes be separated?
- Which customer/contact fields are genuinely required by each staff role?
- How should split fulfillments, returns, canceled items, and partial refunds affect production counts?
- Which audit/history data should be available to operators versus administrators/support?
- What is the mobile information hierarchy and what remains desktop-only?
- Which summary fields justify adding to the bounded board projection instead of loading on demand?

Answer these during layout/UX work; do not infer them by placing every available field on screen.

## Source Anchors

Repository evidence:

- `renderer.js → makeCard, openDetail, splitOrderAssets`
- `order-manager-web/web-shim.js → candidateOrderToBoard`
- `order-manager-web/shopify-preview.js → renderOrderDetail, createProductionForm`
- `order-manager-proxy/worker.js → SHOPIFY_PREVIEW_ORDER_DETAIL_QUERY, ORDER_SUMMARIES_QUERY, ORDER_DETAIL_QUERY, normalizeShopifySummary, productionForClient`
- `order-manager-proxy/migrations/0001_redis_free.sql`
- `order-manager-proxy/migrations/0002_designer_asset_metadata.sql`
- `order-manager-proxy/shopify.app.toml`

Shopify schema/access references:

- [Order — Admin GraphQL API 2026-07](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Order)
- [LineItem — Admin GraphQL API 2026-07](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/LineItem)
- [OrderTransaction — Admin GraphQL API 2026-07](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/OrderTransaction)
- [FulfillmentOrder — Admin GraphQL API 2026-07](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/FulfillmentOrder)
- [Fulfillment — Admin GraphQL API 2026-07](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Fulfillment)
- [CustomerJourneySummary — Admin GraphQL API 2026-07](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/CustomerJourneySummary)
- [Protected customer data](https://shopify.dev/docs/apps/launch/protected-customer-data)

## Common Failure Modes & Recovery

| Symptom | Likely cause | Recovery |
|---|---|---|
| A field is marked “currently displayed” because it appears in a Worker response | DTO availability was confused with a visual destination | Verify the exact renderer function and classify Board, Shared detail, Live detail, or Returned/not visualized separately. |
| Shopify order note overwrites production instructions | `Order.note` and `production.internalNotes` were merged | Restore separate labels, fields, and mutation authority. |
| Customer or address data is blank or the entire detail is reported missing | Protected fields were redacted and a partial GraphQL response was treated as a missing order | Preserve partial data, show a scoped unavailable state, and review approved protected fields before changing scopes. |
| Item totals or production counts disagree | Original/current/refunded quantities or apparel/print concepts were mixed | Label the quantity basis and derive production counts from an explicit, tested contract. |
| A card says data is live while Shopify refresh failed | D1 projection freshness/error metadata was discarded | Show or honor stale/partial state and retain manual refresh/recovery behavior. |
| A new “Shopify” field cannot be queried in production | The field requires a scope, protected-data approval, plan feature, or different API version | Check the pinned schema, installed app scopes, GraphQL error path, and order/shop feature before UI implementation. |
| Board load becomes slow after adding detail fields | Rich connections were added to the bounded summary query | Keep the board contract small and move paginated/rare data to on-demand detail. |
| Currency is wrong | Amount was rendered with `$` or shop/presentment values were mixed | Carry amount plus currency code and label the money basis. |
| Product image is shown as the production proof | Catalog media and customer artwork were conflated | Keep Shopify product image and PrintMO private mockup/design roles distinct. |
