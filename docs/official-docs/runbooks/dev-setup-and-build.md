# Developer Setup & Build Runbook

## Use This When
- You are setting up your local development environment for the first time.
- You are running local Electron development builds, packaging production executables, or preparing Cloudflare Pages uploads.

## Skip This When
- You are troubleshooting runtime bugs or sync failures $\rightarrow$ read [runbooks/troubleshooting.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/runbooks/troubleshooting.md).
- You are checking code mapping lines $\rightarrow$ read [reference/source-map.md](file:///e:/PrintMO/PrintMO-Order-Management/docs/official-docs/reference/source-map.md).

## Section Map
- [1. Prerequisites & Environment Setup](#1-prerequisites--environment-setup)
- [2. Development Workflow Commands](#2-development-workflow-commands)
- [3. Production Packaging & Distribution](#3-production-packaging--distribution)
- [Common Failure Modes & Recovery](#common-failure-modes--recovery)

---

## 1. Prerequisites & Environment Setup

1. **Node.js**: Requires Node.js 18.x or later.
2. **Redis**: Ensure a Redis instance is accessible locally (`redis://localhost:6379`) or via cloud provider (e.g. Upstash).
3. **Environment Configuration**: Create a `.env` file in the project root:
   ```env
   REDIS_URL=redis://localhost:6379
   SS_API_KEY=your_ss_api_key_here
   SS_ACCOUNT_NUMBER=your_ss_account_number
   SHOPIFY_WEBHOOK_SECRET=your_shopify_secret
   ```

---

## 2. Development Workflow Commands

```bash
# 1. Install dependencies
npm install

# 2. Verify code syntax
node --check main.js
node --check order-manager-proxy/worker.js

# 3. Launch Electron Desktop app in dev mode
npm start
```

---

## 3. Production Packaging & Distribution

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
| `electron-builder` fails packaging `.env` | Missing `.env` file in root folder | Ensure `.env` exists; `extraResources` in `package.json` requires `.env` during build. |
| Redis connection ECONNREFUSED | Redis server is not running locally | Start local Redis service (`redis-server`) or update `REDIS_URL` in `.env`. |
| Cloudflare script permission denied | Bash execution permission missing | Run `bash scripts/prepare-cloudflare-pages-upload.sh` directly. |
