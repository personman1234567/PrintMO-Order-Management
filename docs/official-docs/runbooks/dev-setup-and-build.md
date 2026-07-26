# Developer Setup & Build Runbook

## Use This When
- You are setting up your local development environment for the first time.
- You are running local Electron development builds, packaging production executables, or preparing Cloudflare Pages uploads.

## Skip This When
- You are troubleshooting runtime bugs or sync failures → read [Troubleshooting](troubleshooting.md).
- You are locating source ownership → read [Source map](../reference/source-map.md).

## Section Map
- [Prerequisites & Environment Setup](#prerequisites--environment-setup)
- [Development Workflow Commands](#development-workflow-commands)
- [Production Packaging & Distribution](#production-packaging--distribution)
- [Common Failure Modes & Recovery](#common-failure-modes--recovery)

---

## Prerequisites & Environment Setup

1. **Node.js**: Requires Node.js 22.5 or later because Phase 2 verification uses `node:sqlite`.
2. **Render data adapter**: The sibling `E:\PrintMO\shopify-ss-integration` service owns the Redis Cloud connection. Its server environment requires `REDIS_URL` and `ORDER_MANAGER_ADMIN_KEY`; do not copy either into this repository or Cloudflare Pages.
3. **Cloudflare Worker configuration**: Configure the Shopify client credentials/shop, identity allowlists, legacy bridge variables, and authenticated upstream gateway variables. Provision `ORDER_DB`, both R2 bindings, and the Durable Object declared in `order-manager-proxy/wrangler.jsonc`. Keep `SS_TEST_ORDER=1` during candidate acceptance; see `shopify-candidate-cutover.md`.
4. **Desktop public configuration**: Generate the public Worker/OIDC config with the existing build script. Electron packages must not contain Redis, Shopify Admin API, R2, or S&S secrets.

For local development of the Render adapter only, use an ignored `.env` in that sibling repository:
   ```env
   REDIS_URL=redis://your-private-redis-connection
   ORDER_MANAGER_ADMIN_KEY=your-shared-worker-to-render-key
   ```

---

## Development Workflow Commands

```bash
# 1. Install dependencies
npm install

# 2. Verify code syntax
node --check main.js
node --check order-manager-proxy/worker.js
npm run docs:check
npm run verify:phase1
npm run verify:phase2

# 3. Launch Electron Desktop app in dev mode
npm start
```

Use `npm run repo -- tools` to discover repository commands and `npm run repo -- route "<task>"` to select minimal context and verification.

---

## Production Packaging & Distribution

### A. Packaging Desktop App (Electron Builder)
```bash
# Package cross-platform desktop application
npm run dist
```
- Output artifacts generated under `dist/`:
  - macOS: `.dmg`, `.zip`
  - Windows: `.exe` (NSIS installer), `.zip`

### B. Preparing Cloudflare Web Assets
```bash
# Execute Cloudflare Pages upload build script
npm run prepare:cloudflare
```
- Bundles `order-manager-web/` assets for deployment to Cloudflare Pages.

---

## Common Failure Modes & Recovery

| Symptom / Trap | Root Cause | Diagnosis & Recovery |
|---|---|---|
| Electron tries to load `.env` or connect to Redis | Stale pre-Phase-1 build/code | Rebuild from the current branch; Electron must call the Worker and must not package `.env`. |
| Render reports Redis `ECONNREFUSED` | Its private `REDIS_URL` is missing or invalid | Correct the Render service environment; do not move `REDIS_URL` to the Worker or clients. |
| Cloudflare script permission denied | Bash execution permission missing | Run `bash scripts/prepare-cloudflare-pages-upload.sh` directly. |
