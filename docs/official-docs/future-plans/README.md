# Dedicated Future Work & Feature Progression Engine

> **Directory**: `docs/official-docs/future-plans/`

This subsystem manages the lifecycle of future plans, unbuilt ideas, feature specifications, and ongoing implementation progress for PrintMO Order Management.

---

## 1. Feature Lifecycle Stages

```text
[Stage 1: Draft / Idea] ──> [Stage 2: Spec Ready] ──> [Stage 3: In Progress] ──> [Stage 4: Graduated]
  Raw concepts, open          Fleshed requirements,    Active task checklist,     Moved to live docs,
  design questions            APIs, blast radius       blockers tracked           status set to Graduated
```

---

## 2. Active Roadmap & Progression Matrix

| Feature / Plan Name | Status | Target Milestone | Target Live Doc on Graduation | Plan File Link |
|---|---|---|---|---|
| Blanks Batch Receiving Workflow | `[Draft / Idea]` | v1.4 Backlog | `features/batch-receiving.md` | [blanks-batch-receiving-plan.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/future-plans/blanks-batch-receiving-plan.md) |
| Date Range & Customer Filters | `[Draft / Idea]` | v1.4 Backlog | `features/dashboard-filtering.md` | [date-range-customer-filters-plan.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/future-plans/date-range-customer-filters-plan.md) |
| Multi-Supplier Routing & Threshold-Optimized Batching | `[Draft / Idea]` | v1.4 Backlog | `workflows/multi-supplier-batching.md` | [multi-supplier-routing-and-batching-plan.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/future-plans/multi-supplier-routing-and-batching-plan.md) |
| Shopify Live API Sync & Admin Blocks Integration | `[Draft / Idea]` | v1.4 Backlog | `workflows/shopify-live-sync-admin-blocks.md` | [shopify-live-api-sync-admin-blocks-plan.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/future-plans/shopify-live-api-sync-admin-blocks-plan.md) |
| Web UI Storage & Decoupling | `[Graduated]` | v1.3 | `workflows/web-shopify-porting.md` | Archived in `legacy/` |

---

## 3. Plan File Metadata Contract

Every feature plan file in this folder MUST begin with this header:

```markdown
# [Feature / Plan Name]

- **Status**: `[Draft / Idea]` | `[Spec Ready]` | `[In Progress]` | `[Graduated]`
- **Owner / Target Milestone**: `[vX.Y / Backlog]`

## Summary & Intent
- Operational intent and target problem.

## Open Questions & Brainstorming
- (Active design questions or architectural options).

## Technical Specification & Task Checklist
- (Detailed implementation steps, API changes, and task checklists).

## Progress Log
- Timestamps and completion notes.
```
