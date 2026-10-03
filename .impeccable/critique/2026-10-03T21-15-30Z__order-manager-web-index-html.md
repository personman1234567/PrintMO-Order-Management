---
target: Order Detail Production tab
total_score: 18
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
timestamp: 2026-10-03T21-15-30Z
slug: order-manager-web-index-html
---
Method: dual-agent (A: /root/production_design_review · B: /root/production_mechanical_review)

The Production tab should lead with print files and give them the full workspace width. The mockup rail is useful reference; Production context and the detailed blanks panel currently displace the actual printing task.

Assessment is based on the supplied screenshots, current repository source, and bounded synthetic diagnostics. The fresh production browser tabs required Shopify sign-in, so authenticated populated-detail behavior was not tested. No application changes or deployment occurred.

## Design health

These are heuristic judgments, not measured user performance.

| Heuristic | Score / 4 | Main issue |
|---|---:|---|
| System status | 2 | Partial upload outcomes unclear |
| Real-world match | 2 | Extras and internal metadata need clearer meaning |
| User control | 2 | Selection immediately uploads |
| Consistency | 3 | Coherent white/slate/blue language |
| Error prevention | 2 | Placement offered without a valid persistence path |
| Recognition | 2 | Long generated filenames obscure identity |
| Efficiency | 1 | Files hidden below administrative content |
| Minimalism | 1 | Context and inventory dominate |
| Error recovery | 1 | Pending files cleared after failure |
| Help | 2 | Intake guidance incomplete |
| Total | 18/40 | Major usability problems |

## Design specificity and impression

The incumbent visual identity fits a busy print-shop tool, but the composition privileges records and implementation metadata over print preparation. The opportunity is a file-first work packet: find the intended design, inspect placement and size, then download it without hunting through inventory.

The detector found two broken-image warnings in order-manager-web/index.html at lines 1003 and 1123, both static false positives for hidden image viewers populated on open. It does not detect the functional issues below. No browser overlay was injected: the available native browser evaluation is read-only, and production detail was unavailable outside authenticated Shopify Admin.

## What works

- Front/back groups give the files a useful placement structure.
- The large mockup remains a useful reference alongside production work.
- Order identity and the selected tab remain clear.

## Priority issues

1. P1 — Extras upload is rejected by the database. manualDesignUploadMetadata maps Extras to an empty string. The upload binds that string into asset_manifests.side, whose migration constraint permits NULL, front, or back. The separate association table legitimately uses an empty string. The user-supplied production error matches this exact mismatch. An in-memory diagnostic using the repository migrations reproduced the failure; NULL in the manifest plus an empty-string association succeeded. Correct the manifest write without weakening the constraint or changing the schema. Add a focused Extras upload/retry regression. Command: harden.

2. P1 — The file enhancement observer triggers its own updates. The observer watches childList changes throughout the file panel, while enhancement rewrites count and extension text nodes on every pass. An isolated browser fixture using the actual helper code recorded 72 callbacks after 1.4 seconds and 91 after 1.7 seconds without user changes. This is a confirmed continuous render loop and a plausible contributor to the reported freezing; it does not prove the cause of every live freeze. Make enhancement idempotent and observe only meaningful external changes. Command: optimize.

3. P1 — File-area scrolling creates a dead zone. The outer tab pane and the inner design body both scroll, while the inner body contains overscroll. A synthetic fixture using current CSS left both scroll positions at zero on wheel input over the file region; allowing chaining moved the outer pane 200px. Prefer one vertical scroll owner for the right workspace and let file groups flow inside it. Retain the existing single mobile detail scroller. Command: layout/adapt.

4. P1 — Files lose the first viewport and available width. Production context and the full shelf-allocation panel precede Design files. Remove the large context card from this task area; place Stage where already summarized and Revision/update data in Activity or quiet details. Keep a compact blanks status and Manage blanks action, with detailed reservation/pull controls disclosed or hosted in Items & financials. Preserve useful stock controls and warnings. Command: distill/layout.

5. P2 — File controls and identity need a clearer hierarchy. Tiny transparent previews, machine-generated names and a separate Preview button make the list hard to scan. Use thumbnail-led file rows and a selected-file inspector with a larger uncropped preview, visible placement, dimensions in inches, file format, known assignment, and Download. Retain full filenames in details and downloads. Source-owned designs remain read-only; only manual files expose removal. Stage uploads, confirm placement, retain failed files and explicitly identify those already saved. Command: clarify/harden.

## Proposed composition

Production                       [Add design]
3 print files · Front 1 · Back 2

File list                        Selected file
Front                            Large uncropped preview
  [thumbnail] readable filename  Front · 4.1 × 1.9 in · PNG
Back                             Applies to items, when known
  [thumbnail] readable filename  Relevant item instructions
  [thumbnail] readable filename  [Download]

▸ Blanks: compact status         [Manage blanks]
▸ Production details

Keep the current mockup rail as reference. On narrow viewports, stack files and selected-file details in the established single scroll area. Intake uses pending previews followed by placement selection and explicit upload, with per-file recovery. Do not invent artwork approval, production readiness, or assignment facts.

## Cognitive load, personas and emotional journey

Cognitive load is high: six main tabs, two artwork areas, internal metadata and six inventory metrics per variant compete before printing files appear. Progressive disclosure and a file-first hierarchy reduce this without removing capability.

The print operator must hunt for the file and infer its identity from a truncated generated name. The owner adding files loses selections after failure and cannot tell which parts of a batch were saved. A new operator must decode Order artwork versus Design files and the unqualified Extras label.

Opening Production should feel like finding a prepared work packet. The current first viewport instead starts with administrative state and inventory caveats. A readable selected-file preview and explicit download/upload outcomes provide reassurance.

## Continuity and boundaries

Related Brain initiatives: order-manager-front-end-performance-and-design-system and order-manager-production-priority. Their broader digital-traveler plan proposes approval, ownership, blockers and release states; those remain separate from this concrete reliability/layout repair. The current repair can reuse existing file APIs and inventory authority without introducing a new production model.

Remaining design choice: clarify whether Extras means any non-front/back placement or should display named placements such as sleeve or left chest. This does not block fixing the database mismatch.

Recommended sequence: harden Extras and upload recovery; optimize the observer; layout/distill the file-first workspace and scroll ownership; clarify file labels; polish desktop/mobile together in the skill's bounded verification passes.
