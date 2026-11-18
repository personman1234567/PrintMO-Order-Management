# Storefront Management Workspace

- **Status**: `[Implemented Candidate]`
- **Owner / Target Milestone**: Print-MO owner; unified staff management and new-storefront setup, deployed November 12, 2026.

## Summary & Intent

Storefronts is the staff workspace for managing an owner's actual Shopify branding and products. New storefronts use the same interface. Existing saved work, catalog selection, uploads and unpublished drafts are retained. Owners currently send assets to Ethan; there is no owner login or owner-facing intake portal.

## Current Continuation State

- **Current state**: Menu → Storefronts on desktop, More → Storefronts on phones. Choose Manage storefront, then a plain task row: Appearance, Products, Reports or Contact & notes. Reports opens the generator directly. Appearance saves update that storefront's existing Partner Branding record independently. Existing-product edits update the same product. Add product creates an unpublished product using the selected owner's existing branding. Add storefront creates draft branding and an unpublished collection, then opens the same management workspace.
- **Next safe action**: Use Dallas's Appearance and Products for ordinary management. For a real new owner, create the storefront, add its branding and first product, check its report against a known order and a no-activity period, then obtain separate launch authorization. No new feature baseline or Dallas acceptance request is needed.
- **Remaining limits**: No product/collection publication, report sending, bills, payments or owner portal. Existing product editing covers names, plain-text descriptions, existing variant prices and gallery photos; changing assortment options, print artwork production, inventory/shipping and launch acceptance remain outside this editor. Native physical-phone acceptance is not established by viewport testing.
- **Owner / external actions**: Owner authorized actual centralized storefront management and live Order Manager deployment. Existing live appearance/product edits are explicit saves. New products remain DRAFT; new storefront branding remains DRAFT. Current shop has the required optional product/metaobject/definition/file access; no new permission was added this release.
- **Earlier management evidence (November 12)**: Worker `890e24ba-c173-4fe6-b1cb-f5a8c719a902`; Pages `1794529274910` (`cf249e5d`); migration `0018` unchanged. Local SQLite/service, authenticated routes, partial/lost-response retry, owner isolation and desktop/390px browser checks passed. Real live API saves changed Dallas's original branding record and restored it. Native embedded UI Appearance → Save appearance also confirmed the change and restoration. A new Dallas DRAFT product reused the original branding; its title/description/price were edited in place then restored, with status and SKU preserved. Historical Dallas reporting still reconciles. No publication, sending or payments occurred.

## Fulfillment pricing continuation — November 16, 2026

Live release: Worker `b84a14c2-4fe8-4274-a4c1-4fdd3b0f21c7`, Pages `1794874483178` (`4abfc310`). Source/bindings, production asset bytes, existing historical reports and actual DRAFT pricing saves were verified.

Products now select printing and save per-variant garment-plus-print fulfillment amounts with an immutable effective-dated history. New products require a print selection; existing products can change it or explicitly refresh current garment/print prices. Earlier orders keep the rate version applicable when placed. See [reporting pricing contract](storefront-reports-workspace-plan.md#fulfillment-pricing--november-16-2026) for authority, activation, Shopify fields, tests and remaining legacy catalog coverage. Missing source prices remain Needs pricing, not zero.

## Open Questions & Brainstorming

The management framing and shared new-owner interface are settled. Remaining acceptance concerns are physical-phone behavior, real second-owner reconciliation and separately authorized storefront/cart/shipping launch review. Older unmapped merchandise may need verified source-link assistance; no speculative price or automatic payment behavior is implied.

## Technical Specification & Task Checklist

### One real storefront identity

[storefront-management.mjs](../../../order-manager-proxy/storefront-management.mjs) owns management, with [the controller](../../../order-manager-web/storefront-management-workspace.mjs) and [migration 0018](../../../order-manager-proxy/migrations/0018_storefront_management.sql). Registry rows bind shop + storefront to explicit partner and collection GIDs. Merely discovering a Shopify collection does not enroll it: Manage storefront validates/adopts that explicit relationship. New storefront creation uses stable UUID-derived handles with partial checkpoints. Branding is DRAFT and the collection is unpublished; no publish API exists.

The authenticated `/order-manager/v1/storefront-management` routes provide list/create/register, get, appearance/details saves, paged products, in-place product get/save, saved work, new product preparation and product draft creation. App Bridge identity and existing API-cost coordination apply. The workspace remains lazy-loaded and Shopify-source-only; no catalog reads or PDF loading are added to board startup.

### Daily appearance and product edits

1. Open Storefronts → Manage storefront → Appearance. Current values load from Shopify automatically. Change public name, colors, logo or desktop/mobile banner; upload PNG/JPEG/WebP (up to 20 MB) or use verified Shopify file URLs. Save appearance updates only changed fields on the same metaobject, preserving its status and unrelated fields. No product is required.
2. Products → Edit product changes the existing product's name, plain-text description, existing variant prices or gallery photos. Product identity, status, supplier SKUs, options and owner/source links are preserved. Products with mismatched owner references open a Shopify review link instead of an editor. An ACTIVE product stays ACTIVE, so its explicit save affects the live product.
3. Products → Add product reuses the existing catalog/variant/photo constructor. Save for later retains unfinished work. Create product draft creates a DRAFT merchandise product under this owner's existing branding/collection; it does not create another branding copy.
4. Contact & notes saves team-only contact name/email/notes independently. Do not collect banking/tax details here. Saved work and product drafts preserve earlier entries. Earlier separately branded drafts open for review in Shopify; no silent ownership migration occurs.

Product descriptions use a plain-text editor. Saving a changed description replaces its HTML with escaped paragraph/line-break content; unchanged descriptions preserve their HTML. Rich-text formatting and variant option/assortment editing are not supported here.

### New storefront through the same interface

Add storefront → enter its name → Create storefront. This creates draft Partner Branding and an unpublished partner-storefront collection with explicit references. The owner lands in Appearance; Products and Reports use the same interface as an established storefront. Setup can be resumed without a first product. Before launch, verify actual inventory, shipping, layout/cart behavior, logos/banners and selected options. Draft readiness is not launch acceptance.

### Mobile task and viewport layout

The home contains four divided task rows, without decorative owner/branding badges or dashboard tiles. Contact fields are in their own editor. Contextual headers replace the repeated title/tab stack. Existing product status appears as plain text only where it informs merchandise management.

Management and new-product preparation each have one shrinking inner scroll body and a compact opaque action row outside it. No 110px bottom filler or extra safe-area reserve is added by this workspace; the app shell owns navigation safe-area allocation. Logo/banner controls show previews and named upload buttons; URL entry is disclosed on demand. Color swatches support hex entry. Product creation says what it actually does, not setup-plan language.

The owning browser fixture now embeds the app in an iframe between simulated Shopify host bars and loads the actual app navigation CSS. It checks 1280×900, 390×844, 390×600 and 320×568, plus notes reachability, non-overlapping save/navigation regions, upload controls, creation-footer bounds, save/retry/leave behavior and no horizontal overflow. Short viewport coverage does not certify an actual iPhone keyboard.

### Persistence and recovery

D1 stores registry/contact data, product-to-catalog links, private product work and operation receipts separately from orders/payments. Shopify remains authoritative for branding/products and current prices. Appearance/product saves compare current Shopify versions; conflicting changes retain staff edits. A store-level save lease and immutable idempotency identity protect simultaneous/duplicate operations. Partial product saves retry outstanding changes without repeating confirmed content; lost appearance/details responses reconcile already-applied values. Failed image transfers retain upload identity; only READY files can be assigned.

The original [setup service](../../../order-manager-proxy/storefront-setup.mjs), [execution service](../../../order-manager-proxy/storefront-setup-execution.mjs), [product constructor](../../../order-manager-web/storefront-setup-workspace.mjs) and migrations 0016/0017 remain reusable. Legacy standalone draft-copy execution retains its earlier behavior; the management path explicitly reuses existing branding. Do not treat an old saved setup plan as the current live storefront.

### Reporting enrollment and pricing

Registered storefronts are explicit reporting configuration. New-product creation carries its normal catalog product link into reporting; explicitly sourced existing products can import their link when opened. The reader validates partner/collection identities, supports independent owner branding, and isolates a missing owner's configuration. No arbitrary Shopify discovery auto-enrolls owners. Older manually created products without an explicit catalog source still need a verified mapping; ambiguous rates yield Needs review, never invented zero.

New orders use approved versioned garment-plus-print fulfillment prices. Earlier Dallas deductions and dated historical exceptions remain protected. Reports are current-restated placed-date cohorts and are not payable balances. See [reporting onboarding](../workflows/web-shopify-porting.md#add-another-storefront-owner-to-reporting). Scheduling, sending and payments remain separate.

### Verification and release boundary

Run `npm run test:storefront-management` with installed Playwright/Edge (browser coverage must run, not silently skip), plus setup checks when changing the reused constructor/executor, Worker Phase 2 for route integration, and `npm run docs:check`. Focused tests cover SQLite/shop isolation, stale versions, lost responses, partial retries, direct appearance saves without products, in-place product preservation, shared new-owner workflow and desktop/390px layout. Live validation uses actual Shopify/D1; native embedded save was also observed. No physical-phone or new-owner public launch is certified.

Shared working tree contains unrelated uncommitted backend work. Release used five bounded patches against the freshly downloaded production Worker; exact reverse restoration and all 30 binding fingerprints were checked. Pages artifact changed only the management/reused-constructor/shim assets and release stamps. Public app identity remains `119d00a9567e8b0d647409f27c939d5d`. Keep additive migrations and saved work during rollback. Worker predecessor is `9bab326f-97b4-4622-99b3-420dfd85f7fc`; Pages predecessor is `1794510427116`. Check current release before reverting another chat's work.

## Progress Log

- **2026-11-12, original two steps**: Deployed server-saved preparation, then Shopify draft-copy execution and direct uploads. Preserved as reusable product preparation and earlier work.
- **2026-11-12, management correction**: Owner requested actual storefront management. Added stable owner registry, independent live appearance saves, in-place product edits, shared new-owner setup, preserved earlier work and explicit reporting enrollment. Deployed and verified with Dallas; publication, sending and payments remain excluded.

- **2026-11-12, mobile correction**: Deployed a task home, focused editors, separate compact action region, previews/hex controls and corrected product creation copy. Removed owner/branding status pills per the owner. Pages-only release; backend, prices and reporting calculations unchanged.
