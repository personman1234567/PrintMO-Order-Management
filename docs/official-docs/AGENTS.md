# Documentation-Scope Agent Instructions

These instructions apply while editing `docs/official-docs/`.

## Required Workflow

1. Determine the artifact type before editing:
   - current fact or invariant → `architecture/`, `workflows/`, `runbooks/`, or `reference/`;
   - unshipped feature or uncertain design → `future-plans/`;
   - obsolete history with continuing rationale → `legacy/`;
   - reusable command metadata → `retrieval-manifest.json` and `reference/tool-registry.md`.
2. Update an existing canonical entry before creating a duplicate.
3. Prefer exact sections, symbols, routes, selectors, errors, and commands over source line ranges.
4. Use relative Markdown links. Never add machine-specific `file:///` links.
5. Keep retrieval summaries compact; put explanation in the routed leaf document.
6. Update `context-router.md` and `retrieval-manifest.json` when a new task class, error class, major source boundary, or reusable tool becomes routable.
7. Run `npm run docs:check`.

## Durable Knowledge Test

Permanent documentation is justified when the information is expensive to rediscover and at least one of these is true:

- it defines a cross-system invariant, authority, or semantic distinction;
- it is required to resume meaningful partial implementation;
- it records a verified recurring failure and its fastest safe diagnosis;
- it explains consequential rationale that code cannot show;
- it documents a reusable operational procedure or tool;
- it changes verification scope or blast radius.

Task narration, ordinary command output, obvious function behavior, and unsupported hypotheses do not qualify.

## Confidence and Lifecycle

- Current-state prose must describe verified live behavior.
- Unverified findings remain in the active plan's open questions or current-state block until confirmed.
- Plans use only the lifecycle values defined in `future-plans/README.md`.
- Superseded knowledge should link to its replacement or move to `legacy/`; do not silently leave two competing truths.
- Release identifiers and dated evidence must say what they prove and should not masquerade as timeless architecture.

## Current-State Document Contract

Every file in `architecture/`, `workflows/`, `runbooks/`, and `reference/` requires:

- `## Use This When`
- `## Skip This When`
- `## Section Map`
- `## Common Failure Modes & Recovery`

The documentation validator enforces this contract.
