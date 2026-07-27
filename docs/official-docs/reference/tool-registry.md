# Repository Tool Registry

## Use This When

- You need to discover an existing repository command before creating a script.
- You need to know whether a command is read-only, locally mutating, or remotely mutating.
- You are promoting a reusable procedure into repository tooling.

## Skip This When

- You are selecting verification for a code subsystem: read [test-map.md](test-map.md).
- You are learning the general living-documentation design: read [living-documentation-system.md](living-documentation-system.md).

## Section Map

- [Registered Commands](#registered-commands)
- [Tool Promotion Contract](#tool-promotion-contract)
- [Common Failure Modes & Recovery](#common-failure-modes--recovery)

## Registered Commands

The machine-readable authority is `../retrieval-manifest.json`. Run `npm run repo -- tools` for the current executable listing.

<!-- tool:route -->
### `route`

- Command: `npm run repo -- route "<task, symptom, error, path, or symbol>"`
- Mode: read-only.
- Purpose: ranks the smallest relevant documentation sections, source symbols, existing tools, verification commands, and stop conditions.
- Structured output: add `--json`.

<!-- tool:docs-check -->
### `docs-check`

- Command: `npm run docs:check`
- Mode: read-only.
- Purpose: validates documentation contracts, links, plan states, manifest targets, registered tools, and numeric source ranges.
- Expected result: `Documentation validation passed`.

<!-- tool:verify-phase1 -->
### `verify-phase1`

- Command: `npm run repo -- verify phase1`
- Mode: read-only.
- Purpose: verifies Electron authentication, secret isolation, and legacy transport contracts.

<!-- tool:verify-phase2 -->
### `verify-phase2`

- Command: `npm run repo -- verify phase2`
- Mode: read-only.
- Purpose: verifies Shopify/D1/R2 candidate behavior, board contracts, private assets, conflict handling, batches, and migration gates.

<!-- tool:redis-backup -->
### `redis-backup`

- Command: `npm run repo -- redis backup`
- Mode: reads remote legacy Redis and writes ignored local artifacts under `backups/`.
- Prerequisite: `REDIS_URL` in the current environment or ignored local `.env`.
- Output: checksummed full queue backup plus redacted fixtures.
- Verification: require zero parse errors and preserve the printed SHA-256.
- Do not use as a restore command; it performs no remote writes.

<!-- tool:migration -->
### `migration`

- Dry-run command: `npm run repo -- migration dry-run --shop <domain> --env <environment> --url <worker-url>`
- Execute command: `npm run repo -- migration execute --shop <domain> --confirm-shop <same-domain> --env <environment> --url <worker-url>`
- Mode: remote read by default; explicit remote mutation in execute mode.
- Prerequisite: `ORDER_MANAGER_BEARER_TOKEN` in the current shell.
- Safety: execution requires the exact shop twice and remains bounded to pages of at most five.
- Procedure: read [../runbooks/shopify-candidate-cutover.md#migration](../runbooks/shopify-candidate-cutover.md#migration).

<!-- tool:parity -->
### `parity`

- Command: `npm run repo -- parity check`
- Mode: remote read-only.
- Prerequisites: `ORDER_MANAGER_API_BASE` and `ORDER_MANAGER_BEARER_TOKEN`.
- Output: PII-redacted legacy/candidate parity counts and mismatches.

<!-- tool:desktop-config -->
### `desktop-config`

- Command: `npm run repo -- build desktop-config`
- Mode: local write.
- Purpose: writes ignored `.build/app-config.json` containing public Worker/OIDC runtime configuration.
- Prerequisites: `OIDC_ISSUER` and `OIDC_CLIENT_ID`.
- Safety: must never copy infrastructure secrets into the artifact.

<!-- tool:cloudflare-bundle -->
### `cloudflare-bundle`

- Command: `npm run repo -- build cloudflare`
- Mode: local build output.
- Purpose: prepares the deployable Cloudflare Pages asset bundle.
- Equivalent existing command: `npm run prepare:cloudflare`.

<!-- tool:cloudflare-deploy -->
### `cloudflare-deploy`

- Command: `npm run repo -- deploy cloudflare -- --production` or `npm run repo -- deploy cloudflare -- --preview [branch]`.
- Mode: remote write; preview and production publishing are explicit.
- Purpose: creates a fresh Pages artifact, deploys to the selected branch, and verifies the release marker served from that target.
- Safety: production requires `--production`, deploys only to `main`, and exits nonzero unless the production hostname serves the exact marker. The bundle preparation step must not alter tracked web source.

## Tool Promotion Contract

Promote a helper only when it is likely to recur, encodes non-obvious repository knowledge, replaces an error-prone sequence, or provides important validation.

Every promoted command must provide:

- a safe default;
- explicit mutation flags and exact target confirmation where relevant;
- environment-only secret input;
- stable exit codes and actionable errors;
- documented inputs, outputs, failure modes, and verification;
- registration in `retrieval-manifest.json`;
- a route from the task or symptom that should discover it.

If a procedure is reusable but cannot be made deterministic, write a runbook or investigation playbook instead of disguising it as a tool.

## Common Failure Modes & Recovery

| Failure | Likely cause | Recovery |
|---|---|---|
| An agent creates a duplicate helper | Existing commands were not searched | Run `npm run repo -- tools`; extend the closest command family. |
| A registered tool is absent from this page | Registry drift | Update both the manifest and this document, then run `npm run docs:check`. |
| A command writes remotely without an explicit mode | Unsafe interface design | Make read-only/dry-run the default and require exact target confirmation. |
| Tool help and documentation disagree | Multiple manually maintained authorities | Treat executable behavior and the manifest as authoritative; correct this registry immediately. |
