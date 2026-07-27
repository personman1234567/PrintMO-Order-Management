# Embedded Web Client Instructions

- Read the `web-shopify-port` or `kanban-ui` route before editing this surface.
- `web-shim.js` owns the source-aware `window.api` adapter. Preserve complete isolation between Legacy Redis and Shopify-board mutations.
- Shopify commerce fields remain read-only; production changes use canonical Worker endpoints with revision and idempotency.
- Keep first board render independent of private asset-ticket hydration.
- Preserve optimistic move rollback, per-order serialization, and at most one conflict reconciliation retry.
- Mobile Shopify Admin is a fixed application viewport. Preserve an explicit inner vertical scroll owner and prevent horizontal/page-shell chaining.
- Candidate-only layout changes must remain scoped so Legacy Redis presentation is unchanged.
- Do not introduce secrets, permanent public asset URLs, or direct infrastructure access.
- Run syntax checks, `npm run verify:phase2`, and `npm run prepare:cloudflare` when the deployment bundle changes.
- Publish Pages only with `npm run repo -- deploy cloudflare -- --production`; a successful upload is not a live release until the command verifies the production release marker.
