# Official Documentation Index & Governance Guide

> **Directory Root**: `docs/official-docs/`

Welcome to the official documentation directory for **PrintMO Order Management**. This system is structured to provide human developers and AI agents with targeted, low-token context retrieval.

---

## 1. Directory Structure & Sub-System Orientation

- [context-router.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/context-router.md): **Fast Tabular Router** for mapping tasks or symptoms directly to docs and source code.
- **`architecture/`**: System models, runtime contracts, state ownership, security, and external APIs.
  - [system-overview.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/architecture/system-overview.md)
  - [ipc-and-storage.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/architecture/ipc-and-storage.md)
  - [external-apis.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/architecture/external-apis.md)
- **`workflows/`**: Pipeline docs for end-to-end trigger-to-outcome sequences.
  - [order-ingestion-kanban.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/workflows/order-ingestion-kanban.md)
  - [blanks-batching.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/workflows/blanks-batching.md)
  - [web-shopify-porting.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/workflows/web-shopify-porting.md)
- **`features/`**: Current state of shipped user-facing feature sets.
- **`runbooks/`**: Operational, development, and maintenance procedures.
  - [dev-setup-and-build.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/runbooks/dev-setup-and-build.md)
  - [troubleshooting.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/runbooks/troubleshooting.md)
  - [doc-governance.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/runbooks/doc-governance.md)
- **`reference/`**: Detailed mapping files.
  - [source-map.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/reference/source-map.md)
  - [test-map.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/reference/test-map.md)
- **`future-plans/`**: **Feature Progression Engine** for capturing ideas, specifications, and active work.
  - [README.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/future-plans/README.md): Roadmap index & active progress matrix.
- **`legacy/`**: Quarantined historical documentation and deprecated notes.
  - [README.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/legacy/README.md)

---

## 2. Documentation Header Contracts

### A. Current-State Docs (`architecture/`, `workflows/`, `features/`, `runbooks/`)
Every current-state document MUST begin with the following structure:
```markdown
# [Doc Title]

## Use This When
- Bullet points of exact tasks, bugs, or contexts where this doc applies.

## Skip This When
- Explicit conditions to stop reading and route elsewhere.

## Section Map
- Anchor links to internal sections.

[Core Content & Invariants]

## Common Failure Modes & Recovery
- Past bugs, environmental traps, and exact steps to diagnose/fix.
```

### B. Future Plan Docs (`future-plans/`)
Every plan file in `future-plans/` MUST begin with this header:
```markdown
# [Feature / Plan Name]

- **Status**: `[Draft / Idea]` | `[Spec Ready]` | `[In Progress]` | `[Graduated]`
- **Owner / Target Milestone**: e.g., `v1.4` or `Q3 Backlog`

## Summary & Intent
- Purpose and operational objective.

## Open Questions & Brainstorming
- (For draft / half-baked ideas).

## Technical Specification & Task Checklist
- (For ready / in-progress plans).

## Progress Log
- Real-time updates as sub-tasks are completed.
```

---

## 3. Governance Rules & Feature Graduation

1. **Isolation**: Never document unreleased features in `architecture/`, `workflows/`, or `features/`. Keep them strictly in `future-plans/`.
2. **Graduation Protocol**: When a feature ships:
   - Move operational contracts and facts into the appropriate current-state folder.
   - Update `context-router.md` to index the new current-state docs.
   - Change the plan status in `future-plans/` to `[Graduated]`.
3. **Definition of Done**: A code pull request or change task is incomplete until matching docs updates have been made.
