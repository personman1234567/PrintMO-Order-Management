# Future Work and Feature Progression

> Unshipped proposals and meaningful partial implementation state. Future plans are not current behavior.

## Feature Lifecycle Stages

```text
[Draft / Idea]
→ [Spec Ready]
→ [In Progress]
→ [Implemented Candidate]
→ [Graduated]
```

| State | Meaning |
|---|---|
| `[Draft / Idea]` | Problem, options, or requirements are still forming. |
| `[Spec Ready]` | Decisions, boundaries, acceptance, and implementation sequence are sufficient to begin. |
| `[In Progress]` | Implementation is active and the continuation block names the next safe action. |
| `[Implemented Candidate]` | Code exists, but acceptance, rollout, permissions, migration, or owner approval remains. |
| `[Graduated]` | Stable facts moved into current-state docs and routing/verification are current. |

## Active Roadmap and Progression Matrix

| Feature / plan | Status | Milestone | Graduation authority | Plan |
|---|---|---|---|---|
| Blanks Batch Receiving Workflow | `[Implemented Candidate]` | v1.4 Backlog | `features/batch-receiving.md` | [blanks-batch-receiving-plan.md](blanks-batch-receiving-plan.md) |
| Date Range and Customer Filters | `[Draft / Idea]` | v1.4 Backlog | `features/dashboard-filtering.md` | [date-range-customer-filters-plan.md](date-range-customer-filters-plan.md) |
| Multi-Supplier Routing and Threshold Batching | `[Draft / Idea]` | v1.4 Backlog | `workflows/multi-supplier-batching.md` | [multi-supplier-routing-and-batching-plan.md](multi-supplier-routing-and-batching-plan.md) |
| Quality of Life and Shop Efficiency | `[Draft / Idea]` | v1.5 Backlog | `workflows/qol-shop-efficiency.md` | [qol-workflow-and-shop-efficiency-plan.md](qol-workflow-and-shop-efficiency-plan.md) |
| Shopify Draft Orders and Invoicing | `[Draft / Idea]` | v1.5 Backlog | `workflows/draft-orders-invoicing.md` | [shopify-draft-orders-invoicing-plan.md](shopify-draft-orders-invoicing-plan.md) |
| Shopify Live API, Admin Block, and Redis-Free Cutover | `[Implemented Candidate]` | v1.4 | `architecture/shopify-primary-data-plane.md` | [shopify-live-api-sync-admin-blocks-plan.md](shopify-live-api-sync-admin-blocks-plan.md) |
| Shopify Board UI Audit and Blueprint | `[Spec Ready]` | v1.4 polish | `reference/ui-containers-and-views.md` | [shopify-board-ui-audit-and-blueprint.md](shopify-board-ui-audit-and-blueprint.md) |
| In-House Blank Inventory and Digital Whiteboard | `[Spec Ready]` | v1.5 Backlog | `features/in-house-inventory.md` | [in-house-inventory-blanks-tracking-plan.md](in-house-inventory-blanks-tracking-plan.md) |
| Supplies Column and Dashboard Layout Redesign | `[In Progress]` | v1.5 Backlog | `reference/ui-containers-and-views.md` | [supplies-dashboard-layout-redesign-plan.md](supplies-dashboard-layout-redesign-plan.md) |
| Etsy Order Source Integration | `[In Progress]` | Etsy connection proof, then provider-aware rollout | Worker/D1 connection proof and owner acceptance | [etsy-order-source-integration-plan.md](etsy-order-source-integration-plan.md) |


Graduated historical example: Web UI Storage and Decoupling is documented in [../workflows/web-shopify-porting.md](../workflows/web-shopify-porting.md); its old plan is quarantined under `legacy/`.

## Plan File Contract

Every plan requires:

```markdown
# Feature Name

- **Status**: `[allowed lifecycle value]`
- **Owner / Target Milestone**: `...`

## Summary & Intent

## Current Continuation State
- **Current state**:
- **Next safe action**:
- **Remaining blockers**:
- **Owner / external actions**:
- **Last verified evidence**:

## Open Questions & Brainstorming

## Technical Specification & Task Checklist

## Progress Log
```

Numbered headings may wrap the technical checklist, but the phrase `Technical Specification & Task Checklist` must remain discoverable.

Progress logs record meaningful milestones, not every command or task recap.

## Active Data-Plane Dependency Rule

All new plans target the Shopify/D1/R2 architecture defined in [../architecture/shopify-primary-data-plane.md](../architecture/shopify-primary-data-plane.md):

- no new Redis schemas or direct datastore IPC;
- Shopify owns commerce facts and the canonical app-owned production metafield;
- D1 owns rebuildable projections and app-only relational records;
- R2 owns large private bytes;
- the Worker remains the authenticated public boundary.

The Legacy Redis view is a pre-cutover fallback, not the target architecture for future features.

## Graduation

Follow [Documentation Governance](../runbooks/doc-governance.md#feature-progression-and-graduation). Graduation moves stable facts into current authorities, updates routing/tools/verification, removes stale continuation state, and marks the plan `[Graduated]`.
