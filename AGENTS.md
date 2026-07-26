# AGENTS.md

> Primary AI-agent entry point for PrintMO Order Management. Keep this file compact: it contains only universal authority, retrieval, safety, and completion rules. Subsystem details live in scoped `AGENTS.md` files and routed documentation.

## 1. Source-of-Truth Hierarchy

When facts conflict, use this order:

1. **Live executable code and executable configuration**: `main.js`, `preload.js`, `renderer.js`, `order-manager-web/`, `order-manager-proxy/`, migrations, and package scripts.
2. **Current-state documentation**: `docs/official-docs/architecture/`, `workflows/`, `runbooks/`, and `reference/`.
3. **Active implementation state and future plans**: `docs/official-docs/future-plans/`.
4. **Quarantined history**: `docs/official-docs/legacy/`. It is excluded from normal search and must never be treated as current behavior.

Code wins over prose, but discovering stale authoritative prose creates durable maintenance work: correct it in the same task when the correction is safely in scope.

## 2. Progressive Retrieval Protocol

Do not scan the repository or load all documentation.

1. Run `npm run repo -- route "<task, symptom, error, path, or symbol>"`.
2. Read only the highest-ranked document section and inspect only its listed source symbols.
3. Use `docs/official-docs/context-router.md` as the human fallback when no confident route is returned.
4. Load adjacent documents only when the first route identifies a cross-boundary dependency.
5. Stop at the route's approval condition.

Prefer symbol, route, selector, error-string, and test-name searches over brittle numeric line ranges.

## 3. Operational Memory Loop

Documentation expands selectively while real work is performed:

1. **Search first**: reuse existing docs, tools, tests, and runbooks.
2. **Solve and verify**: establish behavior from live code and evidence.
3. **Classify the discovery**:
   - task-local detail;
   - reusable procedure;
   - repository invariant or semantic boundary;
   - recurring known failure;
   - consequential architecture decision;
   - uncertain candidate knowledge;
   - obsolete or superseded knowledge.
4. **Promote only durable value**:
   - repeated or error-prone procedures become repository tools;
   - verified recurring failures become troubleshooting entries or playbooks;
   - cross-system constraints become invariants;
   - consequential rationale becomes an ADR when one is actually needed;
   - shipped feature facts graduate into current-state docs.
5. **Retire stale knowledge**: correct, supersede, consolidate, or quarantine it rather than layering a second explanation on top.
6. Run `npm run docs:check`.

Do not turn ordinary task recaps, obvious code behavior, speculative conclusions, or every failed attempt into permanent documentation.

## 4. Current Architectural Boundaries

- Electron uses `contextIsolation: true` and `nodeIntegration: false`. Renderer/backend interaction goes through `window.api` from `preload.js`.
- Electron authenticates with OIDC and calls the Worker. It contains no direct Redis or S&S connection and packages no infrastructure secrets.
- The **Legacy Redis** view is an isolated pre-cutover fallback reached through authenticated Worker/Render legacy routes.
- The **Shopify board** uses Shopify commerce, the app-owned production metafield, D1 projections/app records, and private R2 assets. Candidate writes do not mirror to Redis.
- Shopify is the per-order production authority; D1 is not a second canonical order store.
- Browser and renderer code must never contain infrastructure credentials.
- Final cutover, live S&S ordering, broader protected-customer-data access, migration overwrite, and permanent Redis deletion remain owner-gated.

## 5. Reusable Tooling

Use `npm run repo -- tools` before creating a helper script. The registered parent interface provides routing, verification, documentation checks, legacy backup, parity, migration, and build commands.

Promote a new script only when it is likely to recur, encodes non-obvious repository knowledge, replaces an error-prone sequence, or provides important validation. Promoted tools require:

- a safe default and explicit mutation mode;
- useful `--help`;
- predictable exit codes;
- documented prerequisites, outputs, and verification;
- registration in `docs/official-docs/retrieval-manifest.json`;
- an entry in `docs/official-docs/reference/tool-registry.md`.

## 6. Verification and Definition of Done

Select targeted verification through the route result and `docs/official-docs/reference/test-map.md`.

Minimum universal checks for applicable changes:

- `node --check main.js`
- `node --check preload.js`
- `node --check order-manager-proxy/worker.js`
- `npm run verify:phase1`
- `npm run verify:phase2`
- `npm run docs:check`

A task is complete when:

- relevant executable and manual verification passed;
- security, source-isolation, and secret boundaries remain intact;
- genuinely durable knowledge was promoted or corrected;
- feature state and current-state docs agree with live code;
- no unrelated diary-style documentation was added.
