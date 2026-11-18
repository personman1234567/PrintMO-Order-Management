# Storefront Reports Workspace Implementation Plan

- **Status**: `[Implemented Candidate]`
- **Owner / Target Milestone**: Print-MO owners / manual internal reporting V1, with Dr. Dallas as the live pilot.
- **Authorization**: The owner authorized implementation, real Shopify data with Dr. Dallas testing, and deployment to Order Manager through the normal menu. Report sending, bills and payments remain excluded. No additional approval is required for routine reversible local implementation.
- **Plan finalized**: November 11, 2026, America/Chicago.

## Summary & Intent

Add one internal Storefront Reports workspace to Order Manager. Staff select one or multiple owners, select an order-placed date range, generate reports, preview one owner's PDF at a time, and download individual PDFs or an archive of selected completed reports.

Use the owner's [redesigned PDF](assets/storefront-reports/redesigned-reference.pdf) as the visual template. Preserve its pale blue field, navy typography, restrained blue accents, both logos, bounded white tables, alternating row backgrounds, status bands, aligned amounts, and clear totals. Adapt row counts and pagination to real data; the supplied two-page example is not a fixed page-count requirement.

The calculation/renderer are reusable. As of November 12, the backend accepts explicit registered storefront identities and catalog links with independent branding; the earlier Dallas-only gate has been generalized. The manual feature should expose a reusable report model and renderer for possible later scheduling; no scheduling or financial execution is included now.

## Current Continuation State

- **Current state**: Real Shopify reporting is deployed: Pages release `1794876293004` (`178119ab`), Worker version `b84a14c2-4fe8-4274-a4c1-4fdd3b0f21c7` (November 16, 2026). Menu / More → Storefront Reports starts with owner selection and dates, without a live introduction, source badge or permanent explanatory panel. Calculation context is available in a collapsed details section below Generate. It supports owner selection, Central-time dates, query-only generation, actual PDF previews, individual PDFs and completed-report ZIP. Dr. Dallas is the configured live pilot; standalone preview without the app API remains clearly synthetic.
- **Approved calculation, November 16**: Orders placed from `2026-11-16T23:50:59.000Z` use saved, effective-dated garment-plus-print fulfillment prices. Already-paid Dallas periods retain their previous deductions; the paid historical cohort reconciles unchanged. An owner-authorized dated correction includes unpaid November 16 order #1872 under the new pricing. The November 11 catalog-once instruction remains the pre-change rule only. No sending or payment policy is added.
- **Owner result / next action**: On November 12, 2026, the owner confirmed the report worked and Dallas is the only current storefront owner. No further owner setup is needed now. The [onboarding procedure](../workflows/web-shopify-porting.md#add-another-storefront-owner-to-reporting) now uses Storefronts registration and explicit product/catalog source links. New merchandise creation carries its source link automatically; older unmapped merchandise can require technical assistance. Each future real owner still needs its own known-order/zero/PDF checks. Native Shopify mobile acceptance remains open.
- **Evidence and limits**: Authenticated published API checks reconciled the June 10–November 5 cohort to the prior owner-confirmed report and verified a successful zero-activity November 1–11 report. The published UI generated the PDF from the exact verified snapshot; actual exported text, page rendering, embedded branding and totals were checked. Browser viewport tests do not establish native Shopify-device acceptance.
- **Release isolation**: Worker publication replaced only two reporting blocks in the fresh downloaded production baseline; reverse-patch hashing proved preservation of that baseline, and post-release source/binding readback matched. Pages packaging preserved unrelated existing assets except release stamps and the corrected public app identity. Concurrent Prepared Orders changes were not published wholesale.

## Fulfillment pricing — November 16, 2026

Owner authorized implementation and live Order Manager deployment, explicitly excluding earlier orders because the prior period was already paid. The default activation instant is 5:50:59 PM America/Chicago on November 16. The owner subsequently clarified that #1872, placed at 22:23:30Z and not yet paid out, must be included. That product has an additional correction version beginning at the order placement time, with the original activation version retained. The live report now gives a 1,597-cent base and 900-cent earnings for that order, while the already-paid historical cohort is unchanged. Shopify merchant-owned definitions (readable by admin/integrations) are product JSON `printmo_reports.fulfillment_pricing` and variant money `printmo_reports.fulfillment_price`. The JSON is the canonical version history; the money field is the current display value. New versions append with compare-digest concurrency and retained earlier versions. Reports are still query-only: stable per-order deductions are selected from immutable variant amounts by placed timestamp, and rows carry their pricing version; no report-time order/projection writes or payable ledger are introduced.

Storefronts → Products → Edit product → Fulfillment pricing selects Chest print, Full front print or Front hat print; Refresh garment & print prices explicitly prepares a new version even when print type is unchanged. Save product commits it. New-product creation requires a print selection and writes fulfillment pricing after the unpublished product is created; a pricing failure leaves a recoverable draft, not a published product. Source SKU/options and actual normal catalog prices are verified. Current print charges come from the existing DTF Print variants, not an inferred global flat fee. Retail prices, supplier SKUs and publication are not changed by fulfillment pricing.

Dallas active lineup: 36 chest, eight full-front (Giddy Up and original Clubhouse Critic, four garments each), one hat. The four unpublished Clubhouse Critic: Remastered drafts were not assumed approved. 1,424 active variants have verified prices; 183 legacy apparel options lack a source or have ambiguous source prices and remain Needs pricing. They never use zero or a guessed deduction. A product with some unresolved options can price its verified options; orders for unresolved options remain Needs review. Resolving that catalog coverage is separate from the completed print-charge correction.

Verification: focused pricing/management/report/setup tests; desktop and 320/390px embedded fixtures including print selection/new-product/save; authenticated existing DRAFT Dallas product changed chest→full→chest while preserving retail/SKU/status; actual paid June–November historical totals and pre-activation order #1872 remained unchanged. New-order calculations are tested synthetically using the same pricing reader; no fake live order was created. The shared reporting/data-plane tests pass.

## Open Questions & Brainstorming

The product choices are settled: Order Manager location, single/multi-owner selection, order-placed dates, fulfilled/pending separation, manual preview/download, the redesigned PDF, and a Dr. Dallas pilot. The following are implementation evidence gates, not reasons to reopen those decisions:

1. Verified against the deployed backend app: `read_orders` and `read_all_orders` permit the pilot history. Pages now uses the same public app identity as the backend (Order Manager, client ID `119d00a9567e8b0d647409f27c939d5d`). The older Pages key belonged to another app; do not substitute that app's local credentials for the backend identity. The later storefront management grant now provides metaobject reads. The selected owner uses its own branding with a safe owner-specific fallback; no other owner inherits the Dallas logo.
2. Implemented: versioned server-only pilot profile, explicit product-to-catalog links, exact shared-SKU matching, unambiguous structured-option fallback and catalog-price evidence. Two discontinued historical 2XL variants use the owner-confirmed November 5 report's base rate only during its June 10–November 5 period; they are not future prices. Do not migrate supplier SKUs as part of reporting.
3. Implemented: same-origin PDF worker, embedded Manrope/branding, actual PDFjs preview under current CSP, desktop/mobile viewport checks, cancellation and cleanup. No external renderer/subscription was introduced.
4. Reader limits are explicit: custom/ordinary ranges retain maximum 366 calendar days, 150 GraphQL reads and 500 cohort orders. Explicit All time removes the lower placed-date filter and one-year cap, with a separate 250-read/2,500-order bound. Both retain 500 discovered collections and 2,500 rows per nested/catalog connection. One active generation per shop, identical-request coalescing and a reserved operational API-cost margin bound contention. Hitting a limit is incomplete data, never zero activity.
5. Refund/base-reversal policy remains unresolved for affected cases; those rows produce Needs review. V1 is current-restated linked-product reporting, not an amount due, prior-payment ledger or historical month-end reconstruction.

## Technical Specification & Task Checklist

### 1. Scope and explicit exclusions

V1 provides one staff-only workspace, owner lookup, date presets/custom ranges, generation progress/cancel, per-owner completeness states, an actual PDF preview, individual download, and one ZIP containing the explicitly selected completed reports.

V1 excludes email sending, report schedules, QuickBooks integration, bills, payment reconciliation, amount-due calculations, payment release, owner self-service access, a rate-editing UI, a permanent report archive, broad Order Manager refactoring, and changes to production or supplier workflows.

Use the existing Shopify/Worker/Pages architecture and existing staff authentication. No external PDF service or paid subscription is part of this approved plan. Adding one requires a concrete renderer-gate decision. Keep Legacy Redis outside the report data path.

### 2. User flow and states

1. Open Storefront Reports through the existing workspace navigation and leave guards.
2. Choose owners by stable ID using checkboxes. Small lists show owners directly; search appears for more than six owners. Larger lists start collapsed with the current selection summarized, and can expand for search/bulk selection. Provide Select all and Clear with a visible selected count. The live pilot may initially enable only Dr. Dallas; validate multi-owner behavior using isolated synthetic fixtures until other owners are configured.
3. Choose This month so far (default), Last month, All time, or Custom dates. All time sends an explicit preset without client date bounds, requires read_all_orders, and scans the available history through a captured server cutoff. It resolves the actual first shop-order date in Central time for preview, PDF and export filenames. Empty shop history resolves to today and a zero report. Date inputs are hidden for All time; no arbitrary epoch date or rolling-year window is presented as all time. Show Central time explicitly. Reject reversed ranges and future dates; a custom range ending today uses the generation cutoff for the unfinished day.
4. Generate once with an immutable copy of the selections. Display named stages: reading sales, checking calculations, preparing PDFs. A second click coalesces the same work rather than starting another run.
5. List a separate result for each requested owner: generating, ready, no activity, needs review, failed, or cancelled. No activity is a successful zero-activity PDF; failed retrieval is not.
6. Select one result to preview its actual PDF bytes. Download uses those exact bytes, not a fresh financial query. Changing owner/range marks previous results as belonging to their original selection; it cannot silently relabel them.
7. Download all packages the selected ready reports, one file per owner, in a lazy ZIP step. Show omitted/failed owners explicitly; never label a partial selection as fully successful.
8. Cancel or leave. Cancel queued work and outstanding reads where possible, reject late responses, and release viewers, canvases, workers and temporary URLs. Keep only small selection/date preferences; reopening generates fresh report data.

Working controls and data lead the live screen. No repeated source subtitles, instructional intro or decorative empty preview precedes the task. Calculation help is collapsed below Generate; results appear when a run starts. Keep sample-mode identification explicit. Show actual owner-read failures, date errors, incomplete-result/review warnings, stale selections and export omissions when relevant.

Provide accessible labels, keyboard selection, visible focus and textual status. Keep controls reachable in Shopify's constrained mobile viewport. Generation failure stays inside Reports and leaves normal Order Manager actions usable.

### 3. Reporting periods and financial meaning

- Membership is based on Shopify `createdAt` (orders placed), not production stage, payment date, fulfillment date, or whichever orders happen to be on the board.
- Interpret local custom dates as a half-open interval: local start midnight inclusive to midnight after the end date exclusive. Use `America/Chicago` with daylight-saving transitions rather than adding fixed 24-hour durations. Month-to-date ends at the captured server generation time.
- V1 is a current-restated sales-cohort report: choose orders placed in the interval, then show the currently verified financial and fulfillment state retrieved during generation. Later refunds on those orders can change a regenerated historical report. It does not claim to recreate what was known at a past month-end, and does not sweep unrelated older-order adjustments into this cohort.
- Show both the orders-placed period and the source-status/retrieval window. Shopify multi-request reads are not an atomic snapshot: detect affected-record `updatedAt` drift, perform bounded revalidation, and mark unresolved drift incomplete.
- Fetch unpaid, cancelled and test status so exclusions are explicit. Exclude test and cancelled activity from earnings; retain appropriate exception/exclusion counts. Unpaid and partially paid orders must not inflate collected merchandise sales or earned totals. Show pending-payment exceptions separately; do not invent a payment allocation across owners or items.
- Keep payment state distinct from fulfillment. Split fulfilled and pending quantities using Shopify line-level evidence, including partial fulfillment and refunds. PrintMO's printed/completed production stage is not evidence of Shopify fulfillment.
- Pending-fulfillment earnings are projected amounts under the approved profile, never payable/approved/amount due. Clearly label any estimated category. The summary and detail must use consistent definitions.
- Use actual merchandise amounts after allocated discounts and approved refund treatment. Exclude tax and customer shipping. Do not subtract fees, overhead, reserves or additional deductions without an applicable approved agreement.
- Use exact decimal or currency minor-unit arithmetic, a declared rounding rule, and explicit currency. First live acceptance is USD; unsupported or mixed currencies produce a clear exception rather than silent conversion or summation.

### 4. Owner and rate configuration

Maintain a report-specific, versioned configuration contract containing shop ID, owner ID, display name, collection/metaobject references, product/variant associations, effective interval, approved rate/formula profile, rounding and adjustment treatment, and source/approval evidence.

The implementation uses a versioned server-only profile in `storefront-report-profiles.mjs`, with source evidence and explicit product links. No database migration or new financial store was needed. Future configuration changes must preserve evidence and effective intervals; do not repurpose production-state tables or copy orders into a second order database.

Owner attribution applies to individual order lines. Mixed-owner orders are split correctly. Product titles, current collection membership, tags and current costs may identify candidates but are insufficient to establish historical ownership/rates on their own. The report scope is explicitly linked storefront products. Ordinary unrelated lines and unknown/deleted lines outside positively attributed owner orders produce count-only coverage warnings. Ambiguous/deleted lines inside a positively attributed owner order require review without leaking unrelated owner details. A rate change creates a new effective version; it cannot rewrite an existing generated snapshot.

Resolve owner identity and logo from the appropriate Partner Branding metaobject (`custom.partner_reference` -> `name`, `logo`) when granted and populated. Retain Print-MO branding as a controlled asset. Accept only safe supported image types/approved asset hosts, preserve aspect ratios, optimize embed size, and show a missing-logo warning/text fallback rather than breaking financial calculations. Never execute partner custom CSS or arbitrary SVG/script content.

### 5. Implemented architecture and contracts

Logical flow: workspace loader -> authenticated report reader -> approved attribution/rate resolver -> normalized calculation snapshot -> worker-based PDF renderer -> one active preview/download.

Implemented module boundaries:

| Area | Responsibility |
| --- | --- |
| Small Reports loader and navigation registration | Enter/leave hooks; no expensive startup work. |
| Reports workspace/controller and scoped CSS | Selection, dates, result states, generation IDs, cancellation and preview lifecycle. |
| Dedicated backend report reader/query module | Staff authorization, bounded complete Shopify reads, metadata/rate reads, and sanitized report DTO. |
| Pure calculation/snapshot module | Owner/quantity attribution, exact money, exceptions, version metadata and reconciliation checks. |
| On-demand PDF renderer and browser worker | Reusable document layout using the supplied visual reference; no network credentials. |
| Preview/download adapter | Actual generated bytes, mobile-compatible fallback, lazy ZIP and resource release. |

The report request contract includes selected owner IDs, explicit period/timezone, report mode, and a request/generation identifier. The server validates owner authorization, normalizes the range and establishes cutoffs. Never trust a browser-supplied shop identity.

Each owner result carries a snapshot ID, normalized request, retrieval start/end, source/query schema version, attribution/rate versions, currency, line-level evidence/status, summaries, completeness, exclusions and actionable exceptions. Render only from this snapshot. A refresh makes a new snapshot rather than mutating an already displayed result.

The reader uses dedicated Shopify queries with full order and required nested-connection pagination. Deduplicate by stable IDs and detect nonadvancing cursors, missing fields, partial GraphQL responses, permission gaps, throttling and unsupported volume. Missing money is unknown, never zero. A failed or capped fetch blocks a normal earnings PDF for the affected owner while allowing an explicitly incomplete on-screen inspection. Unaffected owners may finish with their own completeness evidence.

Reuse the authenticated transport and the shop-wide Shopify cost coordinator, but no operational enrollment/refresh/detail helper that writes projections or imports assets. Report generation is query-only against Shopify and approved configuration. Its call graph must not invoke production patches, D1 order/projection writes, R2 asset imports, draft checkout, supplier calls, messages or financial mutations. Any infrastructure authentication bookkeeping must be isolated and documented, not hidden in a report calculation helper.

Prefer transient server calculation data and browser-memory snapshots/PDFs for V1. Do not save financial reports in localStorage, public buckets or persistent application caches. Preserve backend `no-store`. If report persistence becomes necessary, stop and design separate private records, authorization, retention and deletion; do not silently introduce an archive.

### 6. Performance and operational isolation

- Only the navigation entry, empty root and small loader may be eager. No report CSS, PDF library, viewer, fonts, logos, owner enumeration or historical query before Reports is opened; expensive rendering waits for Generate.
- Do not reuse or enlarge `allOrders`, the board DTO, board hydration, queue polling or production rendering to support financial reporting.
- Load PDF/ZIP dependencies on demand. Render one owner at a time; retain compact snapshots within measured limits, not an unbounded collection of decoded previews. Release old bytes/canvases before replacing the preview.
- Bound report work across staff sessions and owners at the authenticated backend. Add a low-priority report workload lane/budget to the existing cost-coordination boundary while preserving operational defaults. If priority cannot be proven without a broad refactor, stop at that gate and propose a narrower scheduling alternative.
- Throttling, timeout and cancellation must leave partial state explicit and use bounded retries. A separate compute service does not remove the shared app/store Shopify allowance.
- Scope styles and events under Reports. Avoid global table/button/body rules, whole-app mutation observers, recurring report timers and coupling to the global Orders Refresh handler.
- Use the existing navigation guard. Preserve saved run/order state and unsaved-edit protections. Address the current temporary production-filter reset in a focused change; explicitly document which open dialogs close on navigation and verify filter/selection restoration instead of promising exact restoration without evidence.
- On leave or selection change, invalidate request generations, abort eligible fetches, stop/terminate report workers, destroy preview instances and revoke blob URLs after download/preview use ends. Late responses cannot replace newer results or rehydrate a closed workspace.
- Keep heavy PDF/browser engines out of the shared Cloudflare Worker initialization. Its finite CPU/memory and normal order traffic must be included in the renderer gate.

### 7. PDF and preview specification

Owner-facing PDFs contain report facts, not development/process commentary. Do not render internal pricing-basis notes, activation/migration history, pilot exceptions, source-link mechanics or logo-loading diagnostics. Keep those in admin diagnostics and documentation. Preserve reporting dates/cutoff, actual sales/deductions/earnings, fulfilled/pending separation, sample identification and genuine incomplete-report warnings. The renderer explicitly ignores internal basis-note fields; generated-PDF text tests enforce this across live/sample/zero/review fixtures.

The supplied PDF is the design authority for layout/style; its fictional values and example rates establish no policy. Use a proper data-driven renderer with selectable text, embedded fonts, optimized logos, right-aligned currency, repeated table headers, clear status bands and a distinct total row. Never paste a screenshot of the reference as a report background.

Keep the existing first-page hierarchy: owner/period, fulfilled and pending amounts, supporting counts/sales, then product breakdown. Detail pages show order/date, product/variant, quantity, relevant status and amounts with reconciliation. Add exception sections as needed without concealing unresolved financial inputs. Label synthetic fixtures prominently; actual previews use accurate preview/status labels rather than a fictional-data label.

Test long names, more than two pages, partial quantities, missing logos, font embedding, grayscale legibility and accessible text extraction. Do not shrink an arbitrary number of rows into a fixed two-page layout. Preview and download must share the same PDF bytes.

Select a viewer compatible with current CSP, Shopify iframe/mobile behavior and the authenticated asset boundary. `object-src 'none'` currently prohibits assuming a native object/embed viewer will work. Avoid external document-viewer services and broad CSP exemptions. Provide an explicit open/download fallback if inline viewing is unsupported.

### 8. Privacy, packaging and release

Reports remain internal staff data. Owner selection is a filter, not authorization. Revalidate authentication and permitted owners for report/asset requests. Export one owner's rows/logo/totals only; omit unnecessary customer contact/address data, notes, artwork identifiers, supplier costs, bank/tax information and secrets.

Cache/coalescing keys must include the shop, authorized audience, normalized owners, period/timezone, status basis, currency and configuration/query versions. No cross-owner result reuse. Logs contain correlation IDs, stages, counts and failure codes rather than customer-bearing payloads, PDF bytes, credentials or signed URLs.

Version dynamically loaded modules, worker files, fonts and template assets together; current HTML cache busting alone does not cover every dynamic import. Add packaging checks for those files and their release identity. The live workspace is enabled in the normal menu by owner request. Live API failures remain Reports-local and never silently switch to sample data. Keep new server contracts additive and compatible with the existing deployed client; absence/disablement produces a Reports-local unavailable state, not a broken Orders startup.

Any eventual migration is additive and report-specific, with a preview/backup/reversal plan. Deployment is separately authorized; verify exact Pages and Worker targets and the matched artifact. Release the endpoint before enabling its client, then pilot Dr. Dallas. Roll back/disable Reports independently; do not roll back unrelated production workflows or delete accumulated source data.

### 9. Three delivery steps

- [x] **Build the manual sample generator:** working owner/date selection, redesigned PDF, preview/download/ZIP, cancellation and cleanup. Historical-read capability and startup baseline retained in [Phase 0 evidence](assets/storefront-reports/phase0/README.md). Desktop/mobile browser flows and actual Order Manager navigation pass with all operational traffic intercepted.
- [x] **Connect read-only Shopify data:** dedicated complete-period/nested queries, approved owner/rate resolution, exact calculations, explicit missing-input states and shared API protection. Start with Dr. Dallas; do not invent a universal rate or use board totals as accounting evidence.
- [x] **Reconcile and hand off:** real Dallas source/detail/summary/PDF reconciled; financial edge cases, zero activity, workload isolation and published API/UI verified. Real-data deployment is complete. Owner review and native Shopify-device acceptance remain pending; sends, bills and payments remain excluded.

### 10. Acceptance and verification matrix

| Area | Required evidence |
| --- | --- |
| Startup | Same prepared artifact/data/device/network conditions before/after; report assets/queries absent until entry. Compare shell-ready, first useful orders, complete enumeration, network bytes and long tasks against measured baseline variability. |
| Responsiveness/resources | Open/close and replace previews repeatedly, including during normal order polling. No growing retained PDF workers, URLs/listeners or per-visit heap trend after cleanup. Orders remains usable while report work runs; no unsupported numeric latency claim. |
| Navigation/regressions | Desktop and Shopify mobile: menu/heading placement, board/list state, selected orders, pending actions, unsaved quantities, planner/filter/checklist behavior, focus, scrolling, source boundaries and failed rendering. |
| Accuracy | One owner, multiple owners, mixed-owner cart, date/DST boundaries, changed rates, deleted variants, discounts, partial fulfillment, refund/cancellation/edit cases, unpaid/partial payment, unsupported currency and zero activity. Quantities and exact money reconcile across detail, summary and PDF. |
| Completeness/concurrency | More than one page of orders/lines, repeated cursor, capped volume, denied history scope, partial GraphQL result, throttle/timeout, source updates during fetch, rapid selection changes, two staff sessions and cancellation. Never turn missing data into zero or display an obsolete owner/range. |
| Read-only safety | Synthetic spies/mocks fail on Shopify mutations, production/order D1 writes, R2 writes/imports, draft checkout, supplier endpoints, sends or financial actions in generate/preview/download. Configuration setup is separate from generation. |
| Privacy | Denied/expired auth, tampered owner/shop request, cross-owner cache reuse and export isolation; no unnecessary sensitive fields/public URLs/persistent browser financial data. |
| PDF | Actual bytes render in supported desktop/mobile surfaces; exact match between preview/download, intact logos/fonts/tables, readable multi-page content and correct labels. |
| Packaging/rollback | All lazy assets/worker/fonts match the release; old/new client/server compatibility, disabled/unavailable endpoint behavior and independent feature disablement verified. |

Run owning focused tests first, then repository-required verification for the actual changed contracts. UI/Worker/package changes use the relevant scoped AGENTS and test map; broad suites are not a substitute for the matrix. Owning checks: `npm run test:storefront-reports` (installed Edge; UI browser harness needs installed Playwright via `NODE_PATH`), `node --test scripts/cloudflare-pages-native.test.cjs`, `npm run verify:phase2`, the registered local Pages build, and `npm run docs:check`. The focused command covers 50 service/Worker/model/PDF/browser tests. Unit/browser operational fixtures are synthetic. Separate authenticated published API reads verify the Dallas cohort and zero period; published UI verification uses live owner/zero reads and the exact already-verified historical response while blocking operational writes. Phase 2 and packaging checks passed. These checks establish the deployed pilot behavior, not owner acceptance or native-device support.

### 11. Sources and reference provenance

- [Query-only report service](../../../order-manager-proxy/storefront-reports.mjs), [approved pilot configuration](../../../order-manager-proxy/storefront-report-profiles.mjs), [service tests](../../../order-manager-proxy/storefront-reports.test.mjs), and [Worker route/coordinator tests](../../../scripts/storefront-reports-worker.test.cjs).
- [Workspace navigation](../../../order-manager-web/workspace-navigation.js), [Prepared Orders lazy loader](../../../order-manager-web/prepared-orders.js), [preview lifecycle](../../../order-manager-web/prepared-orders-workspace.js), [navigation reset behavior](../../../order-manager-web/production-planner.js).
- [Worker](../../../order-manager-proxy/worker.js): `handleV1OrdersGet`, `handleV1OrderDetailGet`, `refreshSummaries`, `d1Shop`, `OrderSyncCoordinator`, board and detail queries. Existing board maintenance is not a report query contract.
- [Data ownership](../architecture/shopify-primary-data-plane.md#ownership), [order-field inventory](../reference/order-data-visualization-inventory.md#source-and-authority-boundaries), [web startup/navigation contract](../workflows/web-shopify-porting.md#source-switched-operational-board), [documentation governance](../runbooks/doc-governance.md).
- [Shopify GraphQL cost limits](https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits), [Cloudflare resource limits](https://developers.cloudflare.com/workers/platform/limits/), and [browser worker execution](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers). Reverify changing provider constraints during implementation.
- Design reference: exact unchanged copy of the owner's `C:/Users/Modal/Downloads/Print-MO_Storefront_Earnings_Redesigned.pdf`, supplied November 11, 2026. SHA-256: `8d271d921bd70327b5ebcea6eb3823a796857038c270f21c27a9907554241858`. Retained as a fictional visual reference; no actual financial policy is promoted from it.

## Progress Log

- November 11, 2026: Final planning specification consolidated from owner decisions, supplied PDF and completed independent source reviews; at that milestone implementation and deployment were unstarted and unauthorized.
- November 11, 2026: Owner authorized starting implementation with baseline/verification. Phase 0 captured an unpublished working-tree build, six isolated synthetic startup samples, actual-app Dr. Dallas historical-read proof and worker/PDFjs CSP compatibility. Independent review narrowed claims to measured DOM state/read capability; full financial coverage, template/platform/resource limits remain open. No Reports runtime feature or external mutation was introduced.

- November 11, 2026: Implemented the working local sample generator and reduced delivery to three steps. Actual browser checks verified two-page Dallas rendering, custom fonts/logos, multi-owner isolation, preview/download and ZIP byte identity, zero activity, date errors, cancellation, cleanup, lazy navigation and Legacy-source rejection. Live Shopify earnings remain the next integration step.

- November 11, 2026: Owner authorized live Order Manager deployment. Enabled the normal Reports menu and published Pages release `1794439191278`, verified on production with a working two-page sample preview. Feature-scope audit confirmed unrelated backend changes were not packaged and all non-Reports existing files matched production (apart from release stamps). Existing deployed public Shopify identity was preserved; local app configuration differs, so verify the deployed app identity/grants when connecting the future live reader.

- November 11, 2026: Connected and deployed the real query-only Shopify reader and approved catalog-price-once calculation. Verified historical reconciliation, zero activity, incomplete states, actual branded PDF output and production source/binding isolation. Current continuation above supersedes the sample-only milestone and earlier identity uncertainty.

- **2026-11-12, controls-first report UI**: Pages 1794531192456 (`fa32891d`) removes the live intro/source badge/blue explanation and redundant owner labels. Owner/date/generate controls lead; reference details are collapsed below them, large owner lists can collapse, and empty output is hidden until needed. Sample identification, preview/export identity and actual review/error behavior remain verified. Backend/calculations/PDF generation are unchanged.

- **2026-11-12, All time preset**: Added the additional date option and explicit preset transport through the web adapter/Worker. All time checks complete-history access, paginates without a lower date bound, resolves actual covered dates and preserves owner isolation, current-restated calculations, review flags and query bounds. Focused tests cover older-than-one-year data, >500-order pagination, missing history access, empty history, sample mode and browser preview transport.
