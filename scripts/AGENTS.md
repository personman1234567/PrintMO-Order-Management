# Scripts-Scope Agent Instructions

Use these rules when creating or changing reusable repository tooling.

## Before Creating a Script

1. Run `npm run repo -- tools`.
2. Extend an existing subcommand when the capability belongs to an existing command family.
3. Keep one-off investigation code task-local unless it encodes durable repository knowledge or is likely to recur.

## Promoted Tool Contract

- Safe behavior is the default.
- Remote or destructive mutation requires explicit flags and exact target confirmation.
- Secrets come from environment variables, never command-line arguments or output.
- Provide actionable errors, stable exit codes, and machine-readable output when useful.
- Export testable parsing or core functions where practical.
- Register the tool in `docs/official-docs/retrieval-manifest.json`.
- Document it in `docs/official-docs/reference/tool-registry.md`.
- Route it from the relevant task class.
- Add or update verification.

Run `node --check` on changed JavaScript tools and `npm run docs:check`.
