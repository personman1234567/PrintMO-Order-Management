# Official Documentation Index

> Repository operational memory for targeted human and agent retrieval.

## Fast Entry

1. Run `npm run repo -- route "<task, symptom, error, path, or symbol>"`.
2. Read only the highest-ranked section and inspect its listed source symbols.
3. Use [context-router.md](context-router.md) when a human-readable overview is preferable.
4. Run `npm run docs:check` after documentation or routing changes.

## Documentation Planes

- [architecture/](architecture/): verified ownership, boundaries, contracts, security, and invariants.
- [workflows/](workflows/): verified trigger-to-outcome execution paths.
- [runbooks/](runbooks/): operational, development, recovery, cutover, and governance procedures.
- [reference/](reference/): source/test/tool mappings, UI inventory, terminology, and the reusable living-documentation design.
- [future-plans/](future-plans/): unshipped proposals and meaningful partial implementation state.
- [legacy/](legacy/): quarantined history excluded from ordinary search.
- [retrieval-manifest.json](retrieval-manifest.json): machine-readable task/error/path/symbol routes and tool registry.

## High-Value References

- [Context Router](context-router.md)
- [Documentation Governance](runbooks/doc-governance.md)
- [Tool Registry](reference/tool-registry.md)
- [Domain Glossary](reference/domain-glossary.md)
- [Verification Map](reference/test-map.md)
- [Source Map](reference/source-map.md)
- [Order Data Visualization Inventory](reference/order-data-visualization-inventory.md)
- [Living Documentation as an Operational Memory System](reference/living-documentation-system.md)

## Operating Principle

This system preserves reusable understanding, not everything that happened.

Durable knowledge includes verified invariants, cross-system relationships, meaningful feature continuation state, recurring failure recovery, consequential rationale, reusable procedures, tool contracts, and verification expectations.

Ordinary task recaps, obvious code behavior, command transcripts, unsupported hypotheses, and one-off implementation details remain task-local.

See [Documentation Governance](runbooks/doc-governance.md) for promotion, retirement, graduation, and Definition of Done.
