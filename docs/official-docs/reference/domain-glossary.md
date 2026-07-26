# Domain Glossary and Semantic Boundaries

## Use This When

- Two identifiers, states, storage layers, or UI concepts appear interchangeable.
- You are orienting to the repository before changing a cross-system workflow.
- Search results use inconsistent historical terminology.

## Skip This When

- You already know the relevant term and need its full contract: use `npm run repo -- route "<term>"`.
- You are reviewing historical terminology only: read [../legacy/README.md](../legacy/README.md).

## Section Map

- [Semantic Boundaries](#semantic-boundaries)
- [Identifiers](#identifiers)
- [State and Storage](#state-and-storage)
- [Assets and Views](#assets-and-views)
- [Common Failure Modes & Recovery](#common-failure-modes--recovery)

## Semantic Boundaries

| Term | Meaning and authority | Not the same as |
|---|---|---|
| Legacy Redis board | Pre-cutover fallback view reached through authenticated legacy adapter routes | Shopify board or canonical candidate state |
| Shopify board | Redis-free candidate surface backed by Shopify production metadata, D1 projections/app records, and R2 | A mirror of the Redis queue |
| Shopify commerce facts | Order, payment, customer, delivery, discount, and line-item facts owned by Shopify | PrintMO production workflow state |
| Production state | PrintMO stage, readiness, notes, printed count, bundle, batch references, attention, and archive state | Shopify fulfillment or payment status |
| Canonical production metafield | `$app:printmo.production_state_v1`, the only writable per-order production authority | D1 `order_projection` |
| D1 projection | Rebuildable board index plus authoritative app-only operational records | A second canonical Shopify order database |
| Legacy mutation | Mutation of the isolated Redis-backed compatibility view | Candidate Shopify production mutation |
| Candidate cutover | Owner-approved switch making the Shopify board the production default and retiring runtime Redis dependency | Merely deploying Worker or Pages code |

## Identifiers

| Term | Meaning | Boundary |
|---|---|---|
| Shopify GID | Stable GraphQL identifier such as `gid://shopify/Order/...` | Contains `/`; never embed it in fallback idempotency keys |
| Order name | Human-facing Shopify label such as `#1558` | Not a globally stable database identifier |
| Order projection row | D1 board representation keyed to Shopify identity | May be rebuilt from Shopify and canonical metadata |
| Revision | Monotonic production-state version used for optimistic concurrency | Not the Shopify order update timestamp |
| Idempotency key | Client-generated mutation identity using the Worker-accepted character set | Must be independent of Shopify GIDs |
| Delivery ID | Shopify webhook delivery identifier used for deduplication | Not a production mutation ID |

## State and Storage

| Term | Meaning | Boundary |
|---|---|---|
| `blanks_cart` | Supplier order confirmed; operator has not yet marked the blanks as ordered | `blanks_ordered` |
| `blanks_ordered` | Operator-controlled state indicating the order belongs in the Ordered view | Supplier confirmation alone |
| `VERSION_CONFLICT` | Another writer advanced the production revision | Permission failure or generic retryable error |
| `SYNC_PENDING` | Shopify committed but D1 finalization needs repair | False success or permission to resubmit |
| `BOARD_NOT_INITIALIZED` | A new/rebuilt D1 projection has not completed a successful bounded bootstrap | An authoritative empty board |
| `unknown` supplier result | Submission outcome is ambiguous and must be reconciled | A safe-to-retry failure |

## Assets and Views

| Term | Meaning | Boundary |
|---|---|---|
| Asset manifest | D1 metadata describing a private asset and its role/side/line-item relationship | Private R2 object key or asset bytes |
| Private R2 object | Canonical private artwork bytes | Public Designer Studio preview URL |
| Asset ticket | Short-lived authenticated capability used to read a private asset | Permanent public URL |
| Board summary DTO | Bounded data required to render operational cards | Rich Shopify order detail |
| Rich detail | On-demand normalized Shopify detail and production/asset context | Data that should be fetched for every card during board load |
| Source switch | UI choice between isolated Legacy Redis and Shopify board adapters | A data-copy or dual-write operation |

## Common Failure Modes & Recovery

| Confusion | Consequence | Recovery |
|---|---|---|
| Treating D1 as canonical order state | Competing writes and unrecoverable divergence | Re-establish Shopify production metadata as per-order authority. |
| Treating a blank candidate board as authoritative | Production work appears deleted | Check for `BOARD_NOT_INITIALIZED` and preserve the last usable surface. |
| Treating `blanks_cart` and `blanks_ordered` as presentation-only tabs | User selection mutates or loses workflow state | Preserve them as distinct canonical stages with read-only tab selection. |
| Treating asset metadata as a public URL | Private object keys or long-lived access leak | Exchange manifest IDs for short-lived authenticated tickets. |
| Treating order name as stable identity | Wrong-order mutation or collision | Use Shopify GID/canonical identity internally. |
