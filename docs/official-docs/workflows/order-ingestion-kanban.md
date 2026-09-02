# Order Ingestion and Shared Kanban Workflow

## Use This When

- You are changing order enrollment, shared board rendering, stage transitions, card drag/drop, or detail opening.
- You need to understand how Legacy Redis and Shopify-board data reach the same renderer without sharing mutation authority.

## Skip This When

- You are changing supplier aggregation or submission → read [Blanks batching](blanks-batching.md).
- You are changing Electron transport → read [IPC and storage](../architecture/ipc-and-storage.md).
- You are changing Shopify production ownership or D1/R2 → read [Shopify-primary data plane](../architecture/shopify-primary-data-plane.md).

## Section Map

- [Order Enrollment](#order-enrollment)
- [Shared Board Render and Mutation Flow](#shared-board-render-and-mutation-flow)
- [Stage and View Semantics](#stage-and-view-semantics)
- [Card and Detail Interactions](#card-and-detail-interactions)
- [Common Failure Modes & Recovery](#common-failure-modes--recovery)

## Order Enrollment

```mermaid
sequenceDiagram
    autonumber
    participant Commerce as Shopify / Etsy
    participant Worker
    participant Canonical as Shopify metafield
    participant D1 as D1 projections / Etsy production
    participant Legacy as Legacy adapter / Redis

    Commerce->>Worker: verified source read or paid event
    Worker->>D1: deduplicate and update source-isolated projection
    alt Shopify order
        Worker->>Canonical: create production metafield when absent
    else explicitly enrolled Etsy order
        Worker->>D1: create revisioned provider production state
    end
    opt LEGACY_INGEST_ENABLED=1 before cutover
        Worker->>Legacy: forward isolated legacy enrollment
    end
```

Candidate enrollment and legacy fallback ingestion may coexist before cutover, but their reads and mutations remain isolated. Automatic Etsy enrollment remains off during the synthetic/manual pilot.

## Shared Board Render and Mutation Flow

The desktop and embedded clients reuse the board renderer through different adapters:

```mermaid
flowchart LR
    Legacy["Legacy Redis view"] --> LegacyAdapter["legacy window.api adapter"]
    Candidate["Unified Shopify/provider page"] --> CandidateAdapter["source-aware web-shim adapter"]
    LegacyAdapter --> Renderer["shared renderBoard / openDetail"]
    CandidateAdapter --> Renderer
    Renderer --> LegacyMutation["legacy mutation route"]
    Renderer --> CandidateMutation["canonical production mutation"]
```

- Legacy mode maps legacy queue objects into the renderer and persists through authenticated `/legacy/` routes.
- Candidate mode maps bounded Shopify and enrolled-provider DTOs into the renderer and persists through the same versioned production endpoint surface. Shopify writes remain canonical in its app metafield; Etsy pilot writes remain canonical in provider-owned D1 state.
- Cards and detail headers carry an always-visible source text badge. Etsy also uses an orange rail; synthetic fixtures add a separate `TEST` badge, so color is never the only source signal.
- Supplier batching remains Shopify-only. The adapter rejects an S&S submission containing an Etsy order, and Etsy pilot artwork upload remains disabled until a provider-safe asset contract exists.
- Source selection is a view/adapter choice, not a copy or dual-write operation.
- Candidate queue loads are generation-guarded and repaint only changed columns.
- Slow private assets hydrate after commerce/production cards are usable.

Candidate moves are optimistic and atomic:

1. Derive the complete destination stage.
2. Snapshot local status fields.
3. Repaint immediately.
4. Send one canonical production patch with expected revision and idempotency.
5. On one `VERSION_CONFLICT`, adopt current state and retry at most once when still needed.
6. On terminal failure, restore the snapshot and show a non-blocking error.

## Stage and View Semantics

Candidate stages are:

- `received`
- `to_order`
- `blanks_cart`
- `blanks_ordered`
- `print`
- `completed`

`blanks_cart` and `blanks_ordered` are distinct canonical stages. **In S&S Cart** and **Ordered** tabs filter those stages; selecting a tab alone is read-only. A confirmed supplier submission enters `blanks_cart`; an operator later marks it `blanks_ordered`. After confirmation, the client repaints both `to_order` and `blanks_cart` immediately and opens **In S&S Cart**. Adapter-side batch metadata must not preempt the renderer's source/destination-column calculation.

The Shopify board keeps commerce fulfillment separate from PrintMO production state. Ready to Print has two internal views: **To Print** renders canonical `print` orders and **Printed** renders canonical `completed` orders. Completed but unfulfilled work remains in Printed for customer handoff. Exact Shopify `FULFILLED` removes an order from every active dashboard section without rewriting its production stage. The preserved order appears in the lazy-loaded, view-only **Previous Orders** desktop menu or **History** mobile menu; the list contains no asset summaries, and complete detail/artwork loads only after an order is opened.

Shopify cancellation and fulfillment are source-driven rather than operator production actions. When an authoritative summary reports `cancelledAt` or exact `FULFILLED`, the Worker keeps the D1 projection and production history but marks the projection inactive. Production edits, batch reconciliation, and clearing a PrintMO archive cannot reactivate it while Shopify continues to report either condition. A fulfillment reversal restores the preserved stage when the order is otherwise active; cancelled orders remain outside this first history view.

Saving the nonzero garment total as `printedCount` from a `print` order sends `printed_count` and `stage: completed` in one versioned production patch. Lowering a completed order below its garment total sends `stage: print` in the same patch. The selected Ready to Print tab remains stable; count badges and an accessible status notice communicate the move.

Legacy status values remain compatibility data for the Legacy Redis view only.

## Card and Detail Interactions

- `renderer.js → renderBoard` owns shared card rendering.
- `renderer.js → openDetail` opens the shared detail overlay.
- `renderer.js → splitOrderAssets` normalizes legacy/manual/Designer Studio asset containers.
- Candidate summary cards use bounded board DTOs and never fetch rich detail during initial board load.
- Candidate rich detail is fetched on demand.
- Provider identity uses `_orderKey`/`orderKey`; combined customer/order display names remain presentation text only.
- Candidate source switching preserves the last usable board if the requested source fails.
- The shared detail's current limitations and the reliability-first redesign path are documented in [Order Detail Digital Traveler Redesign](../future-plans/order-detail-digital-traveler-redesign-plan.md). Do not infer complete production eligibility from the current four readiness flags.

## Common Failure Modes & Recovery

| Symptom | Cause | Recovery |
|---|---|---|
| Candidate card reverts after a move | Canonical write failed or concurrent revision advanced | Preserve optimistic rollback and bounded conflict reconciliation; inspect structured error details. |
| Legacy card reverts | Legacy adapter mutation failed | Confirm authenticated legacy transport and stable order identity; do not add direct Redis IPC. |
| Shopify board appears empty after failure | Failed bootstrap was treated as authoritative empty data | Preserve previous board and surface `BOARD_NOT_INITIALIZED`. |
| One malformed legacy asset blanks the board | Asset container was assumed to be an array | Preserve `splitOrderAssets` normalization and run regression verification. |
| Detail click throws before opening | Shared renderer assumed an optional surface-specific control exists | Keep optional controls guarded and run Phase 2 verification. |
