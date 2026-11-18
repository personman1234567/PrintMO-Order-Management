---
version: 1
slug: "order-manager-web-storage-browser-js"
primary_target: "order-manager-web/storage-browser.js"
related_targets: ["order-manager-web/studio-activity.css", "order-manager-web/studio-activity-model.js", "order-manager-web/studio-usage.js", "order-manager-web/studio-usage.css", "order-manager-web/studio-usage-model.js", "order-manager-web/index.html", "order-manager-proxy/studio-usage.mjs", "order-manager-proxy/studio-usage-outcomes.mjs", "order-manager-web/web-shim.js"]
---

# Studio activity

Mode: Operate. Shop owners find recent creations and inspect recorded Studio activity, project/account outcomes, problems and period comparisons. Creations remains the default; Usage extends the incumbent workspace and visual system.

## Direction contract

THESIS: Creations makes recent work recognizable by its pictures; Usage distinguishes estimated activity from distinct saved-project and account records, making problems inspectable without overstating what either source proves.

OWN-WORLD: Inherit the Precision Workbench's white/slate surfaces, system sans, quiet borders and dark action blue. Use rectangular controls with 2px corners, no pills, contained images and purposeful labels. Reports use flat sections, aligned counts and quiet chart rules.

STORY: Browse creations or open Usage, choose dates, inspect opens and design actions, then investigate saved projects, accounts or recorded problems. Compare two equal-length periods when checking a change. Units and coverage remain explicit; measurement detail stays disclosed below working content.

FIRST VIEWPORT: The compact Studio activity heading precedes Creations/Usage text tabs. Creations keeps its date selector, filters, search and date-grouped pictures. Usage leads with compact dates, Compare periods and the local time zone, then estimated Studio opens, Uploads accepted and AI images generated. The opens chart and Design actions occupy the main desktop column; Saved work and account counts occupy the supporting column, with Problems below the main report. Phone stacks the same content in its scrollable workspace. Placement sources and measurement detail are disclosures. Keep existing app navigation; do not recreate Shopify Admin's left menu.

FORM: Approved Creations compositions plus four separate telemetry-extension references: overview and Projects & accounts, each on phone and desktop. Problems and Compare periods extend the incumbent report patterns. This is an ordinary Operate extension of the existing visual world; no concept-seed roll applies.

FINISH: Review the implemented surface, resolve material findings, and keep this brief plus the official Studio Usage workflow aligned with source. Preserve the existing global design specification and sidecar. Mockups and captures are review artifacts; this extension ships no new raster assets.

## Surface decisions

- Preserve complete uncropped artwork in feed and detail. Related-file thumbnails change the selected file within the same detail experience.
- Bundle mockup exports only when explicit design reference, workspace and identity scope establish their relationship. Same customer, product or date alone does not establish an export bundle; legacy files remain independently accessible.
- Date and search controls stay compact. Coverage information and technical metadata remain disclosed below working content; source failures and empty results provide direct status and recovery where applicable.
- Keep shared detail focus/return behavior, visible keyboard focus, 44px targets and existing navigation. The phone detail fills the workspace above app navigation; desktop uses a bounded panel.

## Usage decisions and quality bar

- Keep event totals separate from record counts. Studio opens, Uploads accepted and AI images generated are sampling-weighted production/external event estimates. Opens include reloads; repeat uploads can count again. Accepted uploads describe local file intake before placement confirmation; text additions are never uploads.
- Design actions show existing text-addition and garment-selection events alongside successful committed artwork placements. Placement sources separate uploaded, AI and saved artwork; accepted-upload/reuse events are not proof of a committed placement. Missing placement coverage is an em dash, with partial or unavailable history stated.
- Any selected single local calendar day uses hourly bars; longer periods use daily bars. Local midnight bounds allow 23/25-hour DST days, and repeated hour labels include zone suffixes. The toolbar identifies the browser's local zone. The generated-at snapshot controls the partial hour/day and future blank buckets; the in-progress note remains truthful when the current count is zero. Hourly/daily count tables remain available by disclosure.
- Saved work and Projects & accounts use the private Designer ledger report, not sampled telemetry. Saves and reopens count distinct projects within the dates; the same project may occur in both counts. Created projects use existing project records. Save and reopen coverage start separately, with null rendered as an em dash rather than an invented zero; partial coverage excludes earlier activity and is disclosed.
- Project activity shows up to 20 recent project previews as flat thumbnail/title/time rows. Reuse the existing private lazy-image loader and shared detail/return behavior through `StudioActivity.projectMedia/openProject`. Missing previews have a textual state; deleted projects are excluded from preview rows. Usage does not enumerate the Creations gallery or eagerly read its media.
- Accounts after a save prompt show new accounts, existing accounts signed in, accounts with a saved project and unresolved account type as separate date-scoped records. New/existing use sign-in-return dates; saved accounts use successful-save dates. Initial guest/signed-in state events may include reloads and cannot identify account creation. These counts do not form a conversion funnel.
- Problems use the existing AI, upload rejection, preview, save/restore and cart failure categories. The detail keeps cart starts, successful handoffs, failures, categorical reasons and the hourly/daily failure chart. Direct checkout is excluded; retries may repeat.
- Compare periods accepts two non-overlapping periods of equal local calendar length, at most 31 days each, and an optional change name. Compare recorded counts without inferring unique people, paid orders, conversion rates or a causal effect. Traffic mix is not matched. Active editing time, cross-visit identity and revenue attribution are not measured or linked.
- The authenticated `/order-manager/studio-usage` route queries existing `pm_designer_telemetry` with server-only `STUDIO_ANALYTICS_TOKEN`. Production/external filtering excludes marked internal/test traffic; unmarked staff activity can remain. Reports are bounded by 90-day telemetry retention and normally cached server-side for 60 seconds; unavailable ledger responses use a five-second cache. Private project thumbnail reads stay staff authenticated and expose opaque project references only.
- Entering Usage or leaving Studio aborts gallery listing and queued reads. Usage has no gallery-progress listener that rebuilds report controls or queries telemetry. Open creations for these dates explicitly returns to the selected-date gallery. Keep 16px editable inputs, 44px targets, visible focus, stable return focus, responsive stacking and explicit loading/retry/previous-successful-load feedback.

## References and status

Approved Creations compositions: `G:/My Drive/Print-MO/output/studio-activity-mobile-mockups/01-studio-activity-all.png`, `02-studio-activity-mockups.png`, `03-studio-export-detail.png`.

Approved telemetry-extension compositions are four separate images in `G:/My Drive/Print-MO/output/studio-activity-telemetry-plan-2026-11-17/mockups/`: `01-overview-mobile.png`, `02-overview-desktop.png`, `03-projects-accounts-mobile.png`, `04-projects-accounts-desktop.png`. Illustrative counts do not establish live production outcomes.

Local Creations finish captures remain `tmp/studio-activity-ui/{393,320,1280}-{all,mockups,detail}.png`. Current Usage captures are `.impeccable/review/studio-usage-20261117/{320,393,1440}-usage-{overview,overview-lower,today,projects,projects-lower,failures,comparison}.png`. The 21 synthetic nested-iframe captures cover top/lower scrolling states rather than a signed-in Shopify production acceptance. Mockups and captures are review artifacts, not shipping raster assets.

Finish review: `tmp/studio-telemetry-release-20261117/finish-review.md`. Its disposition was FIX, then ship: remove the duplicated Problems heading, make the partial-period note independent of a rendered bar, and update this stale brief. The two product fixes are present in current source; this brief resolves the documentation finding. The existing detector report is `tmp/studio-telemetry-release-20261117/design-detector.json`; no detector rerun or global DESIGN/sidecar drift repair is part of this documentation pass. The user's pinned rectangular 2px/no-pill direction governs this surface.

Telemetry extension deployed 2026-11-17: production Pages release `1794950312023` (`0c4bd7df`); all 133 served assets match the artifact SHA-256 values, 125 unrelated assets are unchanged, and the placement editor is identical. Order Manager Worker `d5eede5b-3514-47d9-a9eb-03f20d35b4f1` preserves 31 bindings/configuration; Designer Worker `0b29c7ba-882b-41c5-a708-d97eb95afa1e` preserves 58, with migration `0008` applied. The live Designer Studio Release 2 theme `163682582776` serves `designer-entry.DmHqiZof.js`. All 17 referenced assets return 200; the entry and task-changed chunks match the build bytes. This is not a blanket byte-parity claim for shared CDN assets. Canonical publishing also verified Designer Testing 2.

Save history starts `2026-11-17T21:05:14.712Z`; reopen and frontend history start `2026-11-17T21:17:08.646Z`. Newly added placement/auth-state Analytics summary events apply that cutoff independently, rounded up to whole-second timestamp precision, while legacy full-period metrics retain their prior scope. The final Pages wording explicitly separates telemetry estimates from project/account stored records; composition is unchanged. Both finish-review product fixes and this brief's documentation finding are resolved for the narrow release.

A live public mobile check recorded one initial guest-state event, one accepted file and one committed placement; telemetry POSTs returned 200 and browser errors were empty. The test segment was excluded from business metrics and guest capture was stubbed to avoid retained-file pollution. A SELECT-only live D1 check composed the exact deployed producer locally with actual aggregate Analytics and returned 200/ready, validating SQL and the new DTO. This does not establish remote staff-authenticated report/thumbnail endpoint acceptance. Automatic approval review denied a separate live-configuration credential read; no retrieval retry was made. Evidence: `tmp/studio-telemetry-release-20261117/pages-served-verification.json`, `designer-production-runtime.json` and `cutoff-patch/verification/readonly-d1-integration.json` under the same release directory.