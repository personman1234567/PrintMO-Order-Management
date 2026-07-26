# Documentation Governance and Maintenance Runbook

## Use This When

- You are updating documentation, retrieval routes, repository tools, or feature progression.
- Verified work produced potentially durable knowledge.
- A feature is moving from proposal through implementation, candidate acceptance, or graduation.
- You are correcting stale or conflicting repository guidance.

## Skip This When

- You need a known technical recovery procedure: read [troubleshooting.md](troubleshooting.md).
- You want the repository-independent system design: read [../reference/living-documentation-system.md](../reference/living-documentation-system.md).

## Section Map

- [Core Documentation Rules](#core-documentation-rules)
- [Knowledge Promotion and Retirement](#knowledge-promotion-and-retirement)
- [Artifact Selection](#artifact-selection)
- [Feature Progression and Graduation](#feature-progression-and-graduation)
- [Routing and Tool Maintenance](#routing-and-tool-maintenance)
- [Change Triggers](#change-triggers)
- [Definition of Done](#definition-of-done)
- [Common Failure Modes & Recovery](#common-failure-modes--recovery)

## Core Documentation Rules

1. **One authority per concept**: update the canonical entry and link to it instead of duplicating schemas, diagrams, commands, or architecture explanations.
2. **Live facts stay separate from plans**: `architecture/`, `workflows/`, `runbooks/`, and `reference/` describe verified behavior. Unshipped work remains in `future-plans/`.
3. **History is quarantined**: obsolete material with useful rationale moves to `legacy/`, which is excluded from default search.
4. **Stable references**: prefer symbols, routes, selectors, errors, table names, and test names over numeric line ranges.
5. **Portable links**: use repository-relative Markdown links, never machine-specific `file:///` URLs.
6. **Progressive disclosure**: route to exact sections and keep index summaries smaller than leaf explanations.
7. **Evidence over confidence**: current claims must be supported by live code, tests, executable configuration, migration state, or explicit acceptance evidence.

Every current-state document requires:

- `## Use This When`
- `## Skip This When`
- `## Section Map`
- `## Common Failure Modes & Recovery`

Run `npm run docs:check` to enforce structural contracts.

## Knowledge Promotion and Retirement

Do not produce a permanent recap for every task. After verified work, ask whether the task created knowledge that is expensive to rediscover.

| Classification | Durable action |
|---|---|
| Task-local implementation detail | No documentation |
| Unsupported hypothesis | Keep task-local or in the active plan's open questions |
| Reusable deterministic procedure | Extend or create a registered tool |
| Cross-system invariant | Update architecture/scoped instructions and enforcement |
| Semantic distinction | Update the domain glossary |
| Verified recurring failure | Update troubleshooting or add a playbook when diagnosis branches |
| Consequential design rationale | Add an ADR when the decision merits one |
| Meaningful partial implementation | Update the active plan's continuation state/checklist |
| Obsolete or competing knowledge | Correct, consolidate, supersede, or quarantine |

Promotion is appropriate on the first occurrence when the discovery is high-risk, expensive, cross-system, or dangerous to reconstruct. Otherwise, a second independent occurrence is a useful signal. Repeated system failures should trigger prevention or design repair rather than indefinitely expanding troubleshooting prose.

When knowledge stops being true:

1. Identify the current authority.
2. Correct all high-authority entry points first.
3. Remove duplicate current claims.
4. Preserve rationale only when it remains useful.
5. Link superseded decisions to replacements or move historical material to `legacy/`.
6. Update routes, tools, and verification.

## Artifact Selection

| Need | Artifact |
|---|---|
| Ownership, boundaries, contracts, invariants | `architecture/` |
| Trigger-to-outcome execution path | `workflows/` |
| Predictable operational procedure | `runbooks/` |
| Schema, glossary, source/test/tool map | `reference/` |
| Unshipped or partially implemented work | `future-plans/` |
| Obsolete material retained for rationale | `legacy/` |
| Deterministic recurring operation | Registered repository tool |
| Uncertain diagnostic class | Playbook created on demand |
| Consequential rationale | ADR created on demand |

Do not create empty artifact categories in anticipation of possible future need.

## Feature Progression and Graduation

Allowed plan lifecycle states:

```text
[Draft / Idea]
→ [Spec Ready]
→ [In Progress]
→ [Implemented Candidate]
→ [Graduated]
```

- **Draft / Idea**: problem and options are still forming.
- **Spec Ready**: decisions, boundaries, acceptance, and implementation sequence are sufficient to begin.
- **In Progress**: code work is active and the continuation block identifies the next safe action.
- **Implemented Candidate**: code is present but acceptance, rollout, permissions, migration, or owner approval remains.
- **Graduated**: shipped facts have moved to current-state authorities and routing/verification are current.

Active plans should lead with:

```markdown
## Current Continuation State

- **Current state**:
- **Next safe action**:
- **Remaining blockers**:
- **Owner / external actions**:
- **Last verified evidence**:
```

Keep progress logs concise and milestone-based.

### Graduation procedure

1. Move stable contracts into `architecture/`, workflows into `workflows/`, procedures into `runbooks/`, and mappings into `reference/`.
2. Update `retrieval-manifest.json` and `context-router.md`.
3. Update the verification map and registered tools.
4. Set the plan to `[Graduated]`.
5. Remove stale next steps and duplicate current-state explanations.
6. Preserve only useful rationale/history.
7. Run `npm run docs:check` and relevant code verification.

## Routing and Tool Maintenance

The retrieval manifest is the structured authority for routes and tools. The context router is its human-readable companion.

Update routing when:

- a new task or recurring symptom class appears;
- a major source boundary changes;
- a new error code needs a fast diagnosis;
- a reusable command is added;
- a feature graduates;
- a document moves or an anchor changes.

A route should identify:

- task/error/path/symbol signals;
- exact first section;
- source symbols;
- existing tool;
- minimum verification;
- stop or approval condition.

Before creating a helper script, run `npm run repo -- tools`. Promoted tools must satisfy the contract in [../reference/tool-registry.md#tool-promotion-contract](../reference/tool-registry.md#tool-promotion-contract).

## Change Triggers

| Change | Required knowledge maintenance |
|---|---|
| API route or DTO changes | Architecture/reference, route symbols, contract verification |
| State authority or storage ownership changes | Architecture, glossary, root/scoped invariants |
| Workflow changes | Workflow doc and manual verification |
| New reusable command | Parent interface, manifest, tool registry, route, tests |
| New recurring failure | Existing troubleshooting entry or playbook; fastest safe diagnosis |
| Consequential architecture choice | ADR when rationale is not evident from current architecture |
| Feature becomes a candidate | Plan status and continuation block |
| Feature ships | Graduation procedure |
| Source file/symbol renamed | Manifest, source map, affected routes |
| Knowledge becomes obsolete | Correct/supersede/quarantine and remove stale routes |

## Definition of Done

- [ ] Live behavior and current documentation agree.
- [ ] Relevant syntax, automated, and manual checks passed.
- [ ] Durable knowledge was promoted only when it met the value threshold.
- [ ] Existing canonical entries were updated instead of duplicated.
- [ ] Feature continuation or graduation state is current when applicable.
- [ ] New tools are registered, discoverable, safe by default, and verified.
- [ ] Retrieval routes point to exact useful sections/symbols.
- [ ] `npm run docs:check` passes.

## Common Failure Modes & Recovery

| Failure | Root cause | Recovery |
|---|---|---|
| An agent writes an unreleased feature into current architecture | Plan/current boundary was ignored | Move the proposal to `future-plans/` and restore current facts. |
| Every task adds a recap | Promotion is treated as mandatory narration | Delete task-local prose and keep only reusable knowledge. |
| Two documents both claim authority | Facts were copied during graduation | Name one authority, link to it, and remove the duplicate claim. |
| A script exists but future agents recreate it | Tool is not routed or registered | Add it to the parent command, manifest, tool registry, and relevant route. |
| Router points to an irrelevant whole document | Route lacks anchor/symbol precision | Route to the exact section, symbols, command, and check. |
| Stale numeric ranges waste investigation time | Source moved without documentation edits | Replace ranges with stable symbols and run the validator. |
| Historical results pollute normal searches | Quarantine is not enforced at search time | Add the legacy path to `.rgignore`; access it deliberately when required. |
