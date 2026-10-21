# Optional In Cart Garment View

- **Status**: `[Implemented Candidate]`
- **Owner / Target Milestone**: PrintMO owner / cart verification

## Summary & Intent

Add a local Cards/Garments choice to the Board's In Cart section. Cards remain the first-visit default and remain mounted when Garments is selected. The overall Board/List layout, Build Order, Ordered, and the other columns retain their behavior. This is an expected-requirements reference for manual comparison with S&S, not a live supplier-cart reconciliation.

## Current Continuation State

- **Current state**: Restored to production on 2026-10-20 as Pages `5b1037b0`, release `1792541198369`, preserving the latest owned garment icons and manual print-placement release. A later isolated release had omitted the original cart loaders. Exact-SKU aggregation, order grouping, inline order contributions, visible sizes, and explicit manual/other items are available in the local In Cart view. Device storage remembers only this layout and grouping. Native Shopify shelf snapshots load on demand with at most four requests in flight and a one-minute cache. Changed order fingerprints, shelf notifications, and returning to the document invalidate allocation data. Unknown/changed allocations preserve needed quantities and show unresolved supplier quantities; they never substitute a full-order total.
- **Next safe action**: Obtain representative shop acceptance against the real S&S cart.
- **Remaining blockers**: Authenticated post-release screen verification did not complete. Original release checks left the embedded frame at about:blank, with a Shopify App Bridge failed-fetch error observed. After restoration, reload and reopening from Shopify navigation again left an empty about:blank frame before app execution. Canonical release and asset verification succeeded; the cause of this separate launch blocker is unresolved. The unrelated existing List test suite has eight failures in its unchanged adapter and save-feedback fixtures; the new modules are not loaded by those failing fixtures.
- **Owner / external actions**: Owner explicitly authorized production deployment on 2026-10-20. Real S&S comparison remains pending. No supplier or production mutations are part of this feature.
- **Last verified evidence**: 2026-10-20: seven model tests, Phase 1/2, syntax, documentation, and runtime-bundle checks pass. Synthetic browser checks cover aggregation (16 shared red shirts becomes 10 and 6 by order), a two-unit shelf allocation, manual quantities, twenty distinct garments, failure/retry, Legacy isolation, Cards/Ordered restoration, and 1920/1440/1050/390/320px layouts. Fresh visual review returned ship for the populated states and for the corrected desktop/phone empty state. These checks do not establish actual-shop acceptance.

## Open Questions & Brainstorming

- Match the list against a representative real supplier cart after release, especially shared SKUs, manual garments, and shelf-covered lines.
- Supplier-cart readback and remembered verification marks remain outside scope.

## Technical Specification & Task Checklist

- [x] `cart-garment-model.js`: read-only exact-SKU model, current positive quantities, supplier/manual distinction, shelf uncertainty, stable provider/order identity.
- [x] `cart-garment-view.js` and `.css`: local controls, grouped tables, native inline disclosures, retained cards, responsive wrapping, and keyboard targets.
- [x] `index.html`: load the isolated modules after the incumbent dashboard.
- [x] `scripts/cart-garment-model.test.js`: aggregation, source isolation, exclusions, shelf subtraction, missing allocations, and exact labels.
- [x] Verify the prepared release includes the three new runtime assets with source-matching content and cache-busted references.
- [x] Complete fresh visual review; preserve the incumbent system and record the local surface contract.
- [x] Deploy when requested and verify the canonical release marker and live runtime files against reviewed source.
- [ ] Accept the representative shop comparison against S&S.

## Progress Log

- 2026-10-20: Owner authorized implementation of the optional center-column view after reviewing the cart-wide and order-grouped concepts. Existing cards are an explicit requirement. Local implementation and synthetic verification completed; release remains pending.
- The empty-state review caught an incumbent `:has(#col-blanks:empty)` flex rule collapsing the new scroll region. A Garments-only override preserves the existing Cards empty state and restores visible empty guidance; desktop and phone recaptures were reviewed as resolved.
- 2026-10-20: Authorized production deployment completed as Pages `66e4c467`, release `1792531496701`. Canonical HTML and all three feature assets plus the shared renderer match the reviewed source byte-for-byte. This verifies release delivery; representative S&S comparison remains separate.
- 2026-10-20: Diagnosed the missing live feature: icon/placement release `1792537883878` came from an isolated HEAD-based checkout without the cart HTML loaders. Source remained intact. Compared current production runtime assets and icon sprite against the combined local source (identical after line-ending normalization); HTML differed only by release metadata and the three cart loaders. Restored Pages `5b1037b0`, release `1792541198369`; canonical loaders and eleven cart/icon/placement runtime assets match source byte-for-byte. All 27 focused cart, garment-summary, and print-placement tests, Phase 1/2, syntax, and documentation checks passed. The Pages workflow now explicitly requires preservation of previously shipped features when publishing an isolated checkout.
