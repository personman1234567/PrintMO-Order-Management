# AGENTS.md

> **Primary AI-Agent Entrypoint & Operational Guidance for PrintMO Order Management**

This document serves as the top-level orientation guide for AI coding agents operating within this codebase. AI agents MUST follow the rules, source-of-truth hierarchy, and lookup protocols defined herein.

---

## 1. Source-of-Truth Hierarchy

When evaluating system behavior or resolving conflicts, adhere to the following hierarchy:

1. **Live Executable Code**: Real implementations in `main.js`, `preload.js`, `renderer.js`, `order-manager-web/*`, and `order-manager-proxy/worker.js` override any documentation.
2. **Current-State Documentation (`docs/official-docs/`)**:
   - `architecture/`: System boundaries, state ownership, IPC contracts, Redis schemas, API contracts.
   - `workflows/`: End-to-end execution paths (Order ingestion, Kanban drag-and-drop, S&S blank batching).
   - `runbooks/`: Build/verification steps, troubleshooting, environmental traps, governance.
   - `reference/`: Code mapping (`source-map.md`) and verification map (`test-map.md`).
3. **Feature Progression Engine (`docs/official-docs/future-plans/`)**: Unshipped specs, roadmaps, and active feature drafts. *Never treat future plans as active code behavior.*
4. **Quarantined Historical Notes (`docs/official-docs/legacy/`)**: Obsolete notes and historical plans kept strictly for reference.

---

## 2. Progressive Loading & Fast Navigation Protocol

**Do NOT scan the full directory or read all files at once.** Follow this 3-step routing sequence:

1. Read [docs/official-docs/context-router.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/context-router.md).
2. Match your current task or symptom to locate the **First Doc to Read** and **Primary Source Files**.
3. Open *only* the specific target document and target source code lines. Bail out early if your task meets the doc's `## Skip This When` criteria.

---

## 3. Quick Task Execution & Build Verification

Before claiming completion of any task, run the appropriate verification steps:

- **Syntax & Compilation Validation**:
  - Main Electron process: `node --check main.js`
  - Cloudflare Worker proxy: `node --check order-manager-proxy/worker.js`
  - Web client scripts: `node --check order-manager-web/renderer.js`
- **Application Boot & Execution**:
  - Run desktop app in development: `npm start`
  - Build production Electron packages: `npm run dist`
  - Prepare Cloudflare Pages upload asset: `npm run prepare:cloudflare`

---

## 4. Non-Negotiable Architectural Boundaries & Environment Traps

1. **Electron Context Isolation**:
   - `main.js` enables `contextIsolation: true`.
   - The renderer process (`renderer.js`) CANNOT import Node modules (`fs`, `net`, `path`) directly.
   - All backend/system interactions MUST go through `window.api.*` defined in `preload.js`.
2. **Redis Queue Integrity & Heavy Payloads**:
   - `shopifyOrdersQueue` in Redis is the operational source of truth.
   - File attachments are stored as Base64 strings directly in order list items. Avoid fetching or mutating entire queue lists synchronously in high-frequency loops; target specific list indices.
3. **Web vs Desktop Surface Parity**:
   - `order-manager-web/` is a full production web interface embedded in Shopify Admin, not a scaled-down companion.
   - Web mode uses `web-shim.js` and `storage-browser.js` to simulate or interface with backend services without native IPC (`window.api`).
4. **Environment Secrets**:
   - Secrets (`REDIS_URL`, `SS_API_KEY`, etc.) belong in `.env` for Electron main process or environment variables for Cloudflare Worker. *Never expose secrets client-side in renderer scripts or web code.*

---

## 5. Definition of Done (DoD) for AI Agents

Every change, bug fix, or feature implementation MUST satisfy:

- [ ] **Verification Passed**: Code syntax validated (`node --check`) and relevant application workflow tested.
- [ ] **No Regression in Boundaries**: Security (`contextIsolation`), environment variable handling, and IPC contracts preserved.
- [ ] **Documentation Maintenance**:
  - If a core architecture or workflow changes, update the corresponding document in `docs/official-docs/architecture/` or `docs/official-docs/workflows/`.
  - If a new feature is shipped from `future-plans/`, execute the **Graduation Protocol** (migrate facts to current-state docs, update `context-router.md`, and set status to `[Graduated]`).
