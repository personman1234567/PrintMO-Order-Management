# Phase 0 baseline and verification checkpoint

November 11, 2026. Partial Phase 0 evidence for the [Storefront Reports plan](../../../storefront-reports-workspace-plan.md). No report feature, deployment, message, bill, payment, migration, permission change or new dependency was introduced.

## What passed

- The registered local Cloudflare build completed. The artifact includes concurrent working-tree changes; it is not a clean-HEAD or deployed-production snapshot.
- Six isolated prepared-artifact startup samples displayed all 120 synthetic orders without page errors. Live operational requests were intercepted and blocked; App Bridge and order responses were substituted.
- A same-origin PDF generation worker and PDFjs preview worked under the exact artifact CSP. Four synthetic pages and the unchanged two-page design reference rendered and supported text extraction. Worker termination and viewer/canvas cleanup passed this single lifecycle check.
- The actual Order Manager app identity/grants and read path were verified using its CLI-provided credentials, held only in memory. Three representative Dr. Dallas orders were readable, including a June 2026 order beyond 60 days. Sampled line and fulfillment connections were complete. No commerce mutation or operational board GET handler was called.

## Startup comparison fixture

| Observation | Desktop, 3 samples | Mobile viewport, 3 samples |
| --- | --- | --- |
| DOMContentLoaded observed | 182.7–232.1 ms | 188.9–195.1 ms |
| Startup-ready state with a card observed | 313.1–562.6 ms | 283.0–294.4 ms |
| Complete queue state observed | 457.7–497.2 ms | 438.3–448.4 ms |
| Local resource transferSize | 2,075,228 bytes each | 2,075,228 bytes each |
| Post-GC JS heap | 5,100,502–5,138,859 bytes | 5,885,718–5,889,924 bytes |
| Long tasks over 50 ms | One 55 ms task | None |

Installed Edge headless 157.0.4341.42, GPU disabled; 1280×800 and 393×650 viewports. Fresh contexts share a browser process and host caches. Synthetic fixture: 120 orders across three pages, 50 ms delay per page, no images. No network/CPU throttling. Blocked operational responses are excluded from startup work.

These are logical DOM observations, not paint/LCP measurements or live startup guarantees. Ready state and enumeration are independently gated; queue completion can precede ready state. Bytes came from uncompressed local serving, not production compressed transfer. Fresh-context heaps do not prove repeated-visit memory stability. Compare future builds under the same fixture; do not derive production workload caps from these samples.

## Evidence and provenance

- [Verification summary](verification.json): deidentified exact-app capability checks, council disposition and open gates.
- The local `baseline.json` records metric definitions, six samples, resource entries and intercepted-request decisions.
- [PDF compatibility result](pdf-proof.json): CSP, rendering/text counts, mobile viewport fit and cleanup.
- The local `artifact-source-manifest.json` and `artifact-source-manifest.sha256` capture 103 files / 2,955,218 bytes, source identity, concurrent paths and measurement hashes. The manifest was captured after measurement; it is not a filesystem lock or pre-run attestation.

The unchanged redesigned PDF remains the style authority. Its invented amounts and rates have no financial authority. The worker proof used standard Helvetica, not custom font embedding; previewing the supplied PDF does not implement its dynamic template. No production package/dependency decision follows solely from the bundled libraries used in the proof.

Task-local scripts, original measurements and screenshots remain at the local path below. The live-read summary there includes order references but no financial amounts or customer fields; it is deliberately not copied into this repository evidence bundle. Credentials/tokens were never persisted. Scripts are isolated experiments, not registered repository tools. Re-running the browser script overwrites its output; use a new evidence directory for a later comparison.

`G:/My Drive/Print-MO/tmp/storefront-reports-phase0`

## Remaining gates and next action

Historical access is proven; complete reporting-period coverage and correct earnings are not. Current collection membership is only candidate attribution. Approved effective-dated owner/rate records remain unverified; no particular Dr. Dallas product price is required to build the general shell/template.

The collection has a partner metaobject reference, but the actual app returned a null record and lacks read_metaobjects. Null does not distinguish access from a stale/deleted reference. Resolve this without implicitly changing permissions; a text/missing-logo fallback is viable for local template work.

Continue with bounded offline custom-font/logo and representative-volume checks, then the lazy workspace/synthetic template. Keep live financial completion gated on approved attribution/rates and complete read/reconciliation tests. Numeric workload caps, cross-session API protection, actual embedded/mobile compatibility, cancellation races, and repeated preview/polling resource stability remain unproven. Do not enable/deploy or introduce sending/payment behavior.

Two independently briefed same-model investigators reviewed the baseline/renderer and data/read-safety evidence. Follow-up corrected measurement and coverage claims. No unresolved factual dispute requires another council round; the listed limits remain explicit rather than being treated as passed.
