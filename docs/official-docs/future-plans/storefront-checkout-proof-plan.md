# Storefront Merchandise Checkout Proof

- **Status**: `[In Progress]` (owner-deferred; isolated proof/adapter only, shared integration incomplete)
- **Owner / Target Milestone**: Print-MO owner; preserve the checkout proof and architecture findings for a separately authorized future checkout task.
- **Scope**: Unshipped shared-feature candidate plus an owner-authorized isolated live proof, November 13, 2026. See the isolated-live-proof section for precise deployed and data-write boundaries.

## Summary & Intent

Record the bounded standalone merchandise/mixed checkout proof, its lifecycle limits, and the subsequent architecture assessment. The owner has deferred all cart/checkout work. Current storefront work is formatting cleanup only; it does not add a storefront Review Your Order screen, which belongs to Designer. The initial recommendation is native Shopify retail purchase plus the existing Designer direct checkout, with combined checkout remaining an optional future decision.

## Current Continuation State

- **Verified locally**: The actual Studio quote handler and Prepared completion/calculation/attachment path accept merchandise-only and mixed orders using an isolated Shopify/R2 fixture. Merchandise remains a real variant, receives no extra print/export charge and cannot contribute to custom bulk qualification. Repeated checkout with the same quote/session reuses its draft. New Shopify query is schema-validated against Admin API 2026-07.
- **Not verified**: Payment/completed-order ingestion/reporting, tax, shipping, stock reservation, physical/browser Back behavior or general customer later-session recovery. Real isolated calculation/creation was subsequently verified below; fixtures alone cannot establish live behavior.
- **Next safe action**: No cart/checkout implementation, replacement research, app installation or deployment is authorized by the current task. Preserve these findings and resume only when the owner separately prioritizes checkout work and chooses the intended purchase/recovery behavior. Storefront formatting cleanup is independent of this plan.
- **Release stop**: Do not enable `STUDIO_MERCHANDISE_PROOF_ENABLED` on the shared service, deploy the shared shopping candidate, or describe return/edit as ready. Only the isolated fixed-scenario experiment below is deployed. Three executable TODO gates remain in `studio-checkout-return.test.mjs`. A test process with TODOs is not release acceptance.
- **External prerequisite**: Owner selected Designer Testing, which shares the actual shop. Real paid/completed-order or payment-race testing still needs an appropriate test-payment environment; it is not established by a theme preview.

## Technical Specification & Task Checklist

### Invariants and Candidate Contract

The Designer's direct Shopify draft checkout and canonical server-priced bulk method remain the required custom-order engine. The isolated mixed/retail proof reuses that engine; it does not establish that every future retail basket should use draft checkout. No custom order is sent through the ordinary Shopify cart, no dummy workspace represents merchandise, and no client supplies prices, discounts, product roles or partner ownership.

[studio-merchandise.mjs](../../../order-manager-proxy/studio-merchandise.mjs) accepts only `{id, variantId, quantity}` rows under the disabled-by-default proof flag. Variant IDs are real Shopify GIDs. IDs and quantities are bounded; duplicate IDs/variants and extra properties are rejected. Current price, available-for-sale state, product ACTIVE status, Online Store publication and server-owned `custom.partner_reference` are reread at checkout. Parent bundles and subscription-only products are outside this proof.

Merchandise uses separate `merchandise` group/batch roles and preserves actual product/variant identity. Private quote inputs bind variant, quantity, price and partner identity. When the proof flag is enabled, the custom-item adapter rejects partner merchandise submitted as a garment. This was added after independent review reproduced twelve retail units receiving a custom bulk tier when misclassified by a caller.

[studio-checkout.mjs](../../../order-manager-proxy/studio-checkout.mjs) stores validated merchandise in its private snapshot. Mixed/custom quotes still use the existing garment-price and artwork validators. [prepared-order-links.mjs](../../../order-manager-proxy/prepared-order-links.mjs) permits empty custom selections only with trusted merchandise lines, and checks the final 200 expanded-line/10,000 primary-unit bounds after services and merchandise are included. [prepared-order-discounts.mjs](../../../order-manager-proxy/prepared-order-discounts.mjs) reads merchandise price from its typed variant item while custom qualification still counts only eligible garment-role lines. Merchandise batches never receive custom bulk savings.

No browser UI or global cart merge is implemented. The proof does not import the existing Shopify cart, which can contain unrelated or legacy custom lines.

## Executable Local Evidence

Run `npm run test:studio-order-proof`. The initial result is **11 passing tests and 3 failing TODO release gates**. TODOs intentionally keep unfinished behavior visible; Node's zero exit status with TODOs must not be interpreted as a successful lifecycle proof.

| Case | Local result | Boundary |
|---|---|---|
| Merchandise only, one $19.97 variant | One real-variant draft line; $19.97; no print/export/upload or bulk saving | Simulated Shopify |
| Twelve custom $10 garments + twelve $5 prints + $19.97 merchandise | $199.97 gross, $9.00 custom discount, $190.97 subtotal; artwork attaches only to custom garment | Simulated Shopify |
| Eleven custom garments plus twenty merchandise units | Eligible quantity remains eleven; no twelve-unit discount | Simulated Shopify |
| Remove last custom garment before checkout | New merchandise-only quote contains no stale printing or artwork | Before any checkout has been issued |
| Return unchanged, same quote/session | Same URL/draft; private snapshot retained | Does not establish browser persistence or completed-payment detection |
| Retail submitted as custom | Rejected using Shopify-owned partner classification | Proof flag enabled |
| Client price/role/quantity tampering, changed availability/price/publication, unsupported product | Rejected before creation | Simulated Shopify |
| Return and edit an issued checkout | **TODO: two independent OPEN drafts** | Not safe to expose |
| New session on same reviewed quote | **TODO: second draft** | Durable order attempt missing |
| Resume after completion | **TODO: cached URL returned without fresh completion check** | Completion reconciliation missing |

Focused regression run: Studio, bulk calculation, Prepared links and recipient tests plus merchandise tests: **50 passed**. These preserve the existing default Designer path. The new retail tests are also registered in `test:prepared-orders`.

## Open Questions & Brainstorming

### Lifecycle Gaps and the Separate Cancellation Question

The current checkout hash includes a client session ID, quote identity and artwork signature. It is not a persistent customer-order identity. A changed quote generates another attempt; a different browser session can do the same. A ready checkout record is currently returned without rereading Shopify completion. Studio snapshots expire after thirty minutes, so they are not a later-return basket/project store.

Shopify documents that [draftOrderUpdate](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/draftOrderUpdate) detaches a started checkout and does not prevent that checkout from creating an order. The draft may remain OPEN after that detached checkout completes. Therefore OPEN status or a successful draft update is insufficient evidence that an old payment page is inactive. The [draftOrderDelete](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/draftOrderDelete) contract documents draft deletion, but does not promise cancellation of a checkout already in progress. A successful mocked delete cannot prove safe replacement.

Do not repair lifecycle gaps by routing Designer purchases to Shopify cart or claiming duplicate payable checkouts are safely replaced. Returning to edit saved selection/artwork, recovering an unchanged attempt, and detecting payment completion are distinct from an absolute guarantee that a payment already in progress can never finish. The latter was added as a stricter acceptance requirement during investigation; it must not be represented as an original prerequisite for storefront formatting. A documented cancellation guarantee is absent; deletion has not been proved universally ineffective.

## Development-Shop Acceptance

Deferred reference criteria only; these steps authorize no current testing or implementation. Before resuming, agree the actual customer journey and replacement policy. The strict old-payment retirement criterion in steps 3-4 is a separately proposed guarantee, not evidence that saved-order editing itself requires it.

Use isolated test products and test payments, never production payment/order tests by default. Preserve the Designer direct engine throughout.

1. Merchandise-only and mixed orders must calculate and create actual Shopify drafts with the exact reviewed real variants, garment/print groups, USD amounts and custom-only savings. Confirm tax/shipping and unavailable stock; verify resulting production and partner-report attribution.
2. Open checkout and return without editing. A reload/new tab must restore the same durable order and attempt, retain product selection/artwork, and resume rather than create a second payable attempt. A paid order must open completion/recovery rather than a fresh payment flow.
3. Leave an old checkout open in another tab. Return, change merchandise quantity or custom size/design, review the new server quote and invoke the candidate retirement/replacement strategy. Test both invoice reopen and the already-open payment page, including payment concurrent with retirement. The old revision must not remain independently payable.
4. Simulate timeout/unknown retirement state, failed creation, lost response and simultaneous tabs. Preserve edits; create no replacement until authoritative state permits it. Reconcile payment/order facts instead of guessing from draft OPEN state.
5. Remove the last custom item after a checkout was issued and repeat the same lifecycle check. Merchandise-only recovery must not depend on mounting Designer or retaining a canvas export in browser memory.

These gates apply to a future shared-checkout candidate under the agreed lifecycle policy. They do not gate the existing branded storefront formatting or navigation work. No storefront Review Your Order screen is in the current scope; Designer retains its review screen.

## Progress Log

- **2026-11-13**: Added disabled retail/mixed direct-checkout adapter and executable local proofs. Independent review found and closed client-side product-type misclassification; classification is checked at quote and checkout. Return/edit counterexamples remain explicit TODO gates. No production or payment action occurred.

## Isolated Live Proof — November 13, 2026

The owner selected Designer Testing and then explicitly authorized Wrangler, noting concurrent Order Manager work. The requested website `./push.ps1` built successfully for Testing 2 (`163707977976`), but Shopify identity verification blocked upload. No theme publication is claimed.

A separate, bearer-gated `printmo-studio-checkout-proof` Worker was deployed from a pinned 18-module snapshot. The shared `worker.js` was excluded; the shared Order Manager Worker was not deployed by this task. [Proof entry](../../../order-manager-proxy/studio-checkout-proof-worker.mjs), [isolated config](../../../order-manager-proxy/wrangler.checkout-proof.jsonc), and [five security tests](../../../order-manager-proxy/studio-checkout-proof-worker.test.mjs) own this bounded experiment. Live D1 draft-artwork columns were checked read-only; no migration was applied.

The proof binds the existing Shopify coordinator across Workers, uses private prefixed snapshots, accepts only two fixed server-owned scenarios, tags its own drafts, preserves one canonical session per scenario, rejects unknown inputs, and expires at 2026-11-14T23:00:00Z. Access is private; no credential is stored in repository source. The existing draft-artwork service writes only the proof's own projection/artwork/events to shared D1/R2. There are no production routes, cron jobs or deployment changes to the shared app.

**Real Shopify results**: merchandise-only $19.97, no prints/discount; mixed twelve Tultex garments at $5.97 + twelve $2 prints + $19.97 merchandise, $115.61 gross minus $4.78 bulk savings = **$110.83 subtotal**. Shopify draft audit confirmed actual variant IDs, quantities, garment/print batch relationships, merchandise role and totals. One test SVG was attached only to the custom garment line; merchandise-only had no artwork. Both drafts remained OPEN with no purchased order. Both actual checkout pages rendered their expected subtotal at 1440×1000 and 390×844 without horizontal overflow. Reopening an unchanged fixed scenario reread Shopify state and reused the same checkout.

No contact/address/payment information was entered, no payment or completed order was submitted, and no invoice was emailed. Real shipping/tax/stock acceptance, paid-order production/reporting and edit-retirement/payment races remain unverified. Printing is still displayed as a separate Shopify checkout line, preserving the existing Designer method.

The two fixed scenarios do not implement a universal basket, actual browser Back restoration, arbitrary edits, or the customer review UI. The shared adapter's three TODO gates remain. Do not equate this successful real creation/resume experiment with safe customer return-and-edit. Final isolated version: `68f68b06-b0b0-4a18-a3fe-6f2c6d757410`.

## Replacement Contract Review — November 13, 2026

At this earlier stage, the owner authorized resolving replacement first and then implementing behind the testing flag, with Designer direct checkout/bulk pricing preserved. The later owner decision defers all cart/checkout work and supersedes that continuation. The investigation below records the documented limits of a strict replacement guarantee; it does not establish that every acceptable return/edit journey requires that guarantee.

**Verified shop capability:** the actual shop currently reports Basic, not Plus. The private proof catalog query was extended only with a read-only shop-plan field and schema-validated against 2026-07. Isolated proof version is now `8a9ab887-a28b-4819-8391-88e5e85e0d14`; no new draft/order/payment was created by this investigation, and the shared Order Manager Worker was not deployed.

**Platform contract:**

- [draftOrderUpdate](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/draftOrderUpdate) explicitly allows an already-started detached checkout to complete. Updating the same draft therefore does not establish safe replacement.
- [draftOrderDelete](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/draftOrderDelete) documents draft deletion, without promising cancellation of already-started checkout/payment. This investigation does not prove deletion is universally ineffective; it establishes that the required guarantee is unavailable from the documented contract.
- [Checkout validation Functions](https://shopify.dev/docs/api/functions/2026-07/cart-and-checkout-validation) support draft checkout and can block checkout on Shopify's servers. However, [Shopify's eligibility table](https://help.shopify.com/en/manual/checkout-settings/customize-checkout-configurations/checkout-apps) permits Functions in public apps on Basic, but custom apps containing Functions require Plus.
- No public app has been verified to implement the exact dynamic order/revision check or resolve an already-in-progress payment race. Generic address/quantity validation is not evidence of that capability.

Local CAS/leases and durable attempts prevent duplicate issuance by our server; they cannot revoke a payment page already owned by Shopify. A one-off two-tab experiment can disprove a cancellation strategy, but cannot supply the absent platform contract. Repeating the successful basket/pricing proofs does not resolve this issue.

**Superseded decision framing:** the earlier validation-app-or-freeze choice was too narrow. No public validation app has been verified to solve the dynamic revision or in-progress payment race, so it is not a recommended solution. The owner can separately choose native retail with custom direct checkout, a durable shared order with an explicit post-checkout policy, or a stricter retirement requirement supported by additional evidence. None silently changes the intended journey. No app installation, billing, plan upgrade, broader permissions, or contact with Shopify was performed.

The general integration remains disabled and all further cart/checkout work is deferred by owner. Do not claim automatic replacement is safe or infer cancellation from a successful draft mutation. Preserve the proof and possible durable order/revision/attempt design for a separately authorized task; the design is an option, not a commitment to shared checkout.


## Read-Only Architecture Assessment and Owner Deferral - November 13, 2026

### Recommended Initial Purchase Boundary

Keep native Shopify retail products/cart and the existing Designer direct draft checkout as the initial baseline. This preserves the custom bulk-pricing/export path and the storefront's existing real-product, variant, responsive purchase and partner-return contracts. Original priorities were a reusable branded storefront, standalone products, straightforward continued shopping and saved work; mixed custom/merchandise checkout was optional if feasible. The proof demonstrates calculation and unpaid draft creation, not a complete shared shopping lifecycle. This recommendation is an explicit scope tradeoff, not permission to silently drop a firm combined-checkout requirement.

The customer cost is separate baskets/checkouts and potentially two orders and separate shipping charges, plus separate recovery surfaces. Actual shipping consolidation has not been verified. A future implementation of this baseline must clearly explain which items each checkout includes and preserve return/navigation and saved work; it must not imply a single saved basket or consolidated delivery. No such behavior is implemented by this documentation update.

### Durable State Versus Derived Quotes

The existing checkout engine is worth preserving; its current state owners are not a universal shopping-order model. Studio issues random quote IDs and thirty-minute private snapshots. Prepared completion keys attempts by snapshot/quote, client session and artwork rather than stable shopping-order identity. The website's useStudioCheckout hook keeps quote, session and opened-checkout identity in React state/refs. Designer local persistence saves workspaces/designs, while Customer Projects saves revision-checked design templates/assets; neither currently owns the complete basket/payment lifecycle. Persisting a session reference or extending quote lifetime alone does not supply that lifecycle.

If combined checkout becomes a firm priority, prefer a minimal durable shopping-order layer above the existing engine. It would own a stable order identity/access capability, revision-checked typed custom and merchandise lines, project/artwork references, return context, and recoverable checkout attempts. Quotes remain derived price authorizations. Designer remains the custom-item editor; merchandise-only review/recovery must work without mounting its canvas or inventing a dummy workspace. Shopify remains commerce/payment authority; the layer must not become a second canonical paid-order store. This is meaningful persistence, concurrency and reconciliation work, not an engine rewrite or a review-screen-only change.

A single saved basket/checkout, frequent mixed purchases, or a firm one-order/delivery-charge promise would justify that shared layer sooner. Broader native retail needs, low mixed demand and storefront-launch priority favor the separate baseline. These business facts remain to be decided when checkout work resumes.

### What the Durable Layer Does Not Solve

Stable identity can prevent accidental duplicate issuance, preserve edits, recover the same unchanged attempt and reconcile completion. It cannot by itself revoke an already-open Shopify payment page. Snapshot correctness, saved-order editing and absolute old-payment cancellation are separate contracts. No validation provider is verified as a remedy. No delete/update-and-recreate strategy is accepted as safe; conversely, absent deletion guarantees are not proof that every deletion strategy fails. Select and verify the intended post-checkout policy before implementing it, without assuming either frozen editing or guaranteed retirement.

### Current Authorized Scope

All cart/checkout functionality, shared shopping UI, lifecycle experiments and deployment are deferred. Only documentation of the findings is authorized here; separate storefront formatting cleanup must not add a storefront Review Your Order screen. Preserve earlier experiment outcomes as bounded evidence, and resume checkout work only under new owner direction.
