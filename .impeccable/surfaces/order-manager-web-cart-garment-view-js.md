---
version: 1
slug: "order-manager-web-cart-garment-view-js"
primary_target: "order-manager-web/cart-garment-view.js"
related_targets: ["order-manager-web/cart-garment-view.css","order-manager-web/cart-garment-model.js"]
---

# In Cart garment view

Mode: Operate. Extend the existing center-column In Cart workspace. The shop operator compares exact garment/color/size quantities against S&S, then traces shared quantities back to customer orders. Cards remain available and are the first-visit default. No supplier-cart writes, order mutations, global List redesign, or new visual identity.

## Direction contract

THESIS: A single purchasing reference exposes all expected cart requirements while preserving order traceability and the incumbent cards.

OWN-WORLD: Inherit the Precision Workbench: white/slate surfaces, system sans, quiet structural dividers, rectangular controls, Action Blue for the active view and disclosures. Aligned tabular quantities lead comparison.

STORY: Select Garments, compare exact supplier variants across orders, then group by Order or reveal contributions without opening Order Detail. Shelf and manual uncertainty remain explicit.

FIRST VIEWPORT: The existing center header and estimate stay in place. A compact Cards/Garments switch and Group by select precede one scrolling list. Item identity and exact color lead left, size stays visible, S&S quantity aligns right. The side columns stay intact.

FORM: First-ranked local extension of the existing surface; code-led. A concept seed is not applicable: new-work explicitly excludes local extensions and precisely specified narrow requests from the roll.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Quality bar

Both grouping modes preserve totals. Unknown shelf allocations show unresolved quantities rather than invented supplier counts. Manual/other items retain needed quantities. Cards/Ordered/Build Order and Legacy behavior remain available. Controls have visible focus and 44px targets. Desktop and phone rows wrap without horizontal overflow. Switching views never changes production or supplier state. No shipping raster assets are added.
