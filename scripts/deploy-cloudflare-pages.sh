#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_NAME="${CLOUDFLARE_PAGES_PROJECT:-print-mo-order-manager}"
MODE=""
PREVIEW_BRANCH=""

usage() {
  cat <<'EOF'
Usage:
  npm run deploy:cloudflare -- --production
  npm run deploy:cloudflare -- --preview [branch]

Builds a fresh Cloudflare Pages artifact, deploys it, and verifies the release
marker served by the resulting URL. Production publishing requires the explicit
--production flag and targets the project's main branch.
EOF
}

case "${1:-}" in
  --production)
    MODE="production"
    shift
    ;;
  --preview)
    MODE="preview"
    PREVIEW_BRANCH="${2:-$(git -C "$ROOT_DIR" branch --show-current)}"
    shift
    [[ $# -gt 0 ]] && shift
    ;;
  --help|-h|"")
    usage
    exit 0
    ;;
  *)
    echo "Unknown deployment mode: $1" >&2
    usage >&2
    exit 2
    ;;
esac

if [[ $# -gt 0 ]]; then
  echo "Unexpected argument: $1" >&2
  usage >&2
  exit 2
fi

if [[ "$MODE" == "preview" && -z "$PREVIEW_BRANCH" ]]; then
  echo "Preview deployments require a branch name." >&2
  exit 2
fi

if command -v git.exe >/dev/null 2>&1 && command -v wslpath >/dev/null 2>&1; then
  git.exe -C "$(wslpath -m "$ROOT_DIR")" diff --check
else
  git -C "$ROOT_DIR" diff --check
fi
RELEASE_ID="$(date +%s%3N)"
export PRINTMO_RELEASE_ID="$RELEASE_ID"

(cd "$ROOT_DIR" && npm run prepare:cloudflare)

ARTIFACT_DIR="$ROOT_DIR/dist/cloudflare-order-manager-web"
MARKER="<meta name=\"printmo-release\" content=\"$RELEASE_ID\">"
if ! grep -Fq "$MARKER" "$ARTIFACT_DIR/index.html"; then
  echo "Prepared artifact does not contain release marker $RELEASE_ID." >&2
  exit 1
fi

if command -v cmd.exe >/dev/null 2>&1 && command -v wslpath >/dev/null 2>&1; then
  DEPLOY_ARTIFACT_DIR="$(wslpath -m "$ARTIFACT_DIR")"
  WRANGLER=(cmd.exe /c npx wrangler)
else
  DEPLOY_ARTIFACT_DIR="$ARTIFACT_DIR"
  WRANGLER=(npx wrangler)
fi

if [[ "$MODE" == "production" ]]; then
  BRANCH="main"
  VERIFY_URL="https://${PROJECT_NAME}.pages.dev/?printmo_release=${RELEASE_ID}"
  TARGET_LABEL="production"
else
  BRANCH="$PREVIEW_BRANCH"
  VERIFY_URL=""
  TARGET_LABEL="preview branch ${BRANCH}"
fi

echo "Deploying release $RELEASE_ID to $TARGET_LABEL for project $PROJECT_NAME..."
if ! DEPLOY_OUTPUT="$("${WRANGLER[@]}" pages deploy "$DEPLOY_ARTIFACT_DIR" --project-name "$PROJECT_NAME" --branch "$BRANCH" 2>&1)"; then
  printf '%s\n' "$DEPLOY_OUTPUT" >&2
  exit 1
fi
printf '%s\n' "$DEPLOY_OUTPUT"

if [[ "$MODE" == "preview" ]]; then
  VERIFY_URL="$(printf '%s\n' "$DEPLOY_OUTPUT" | grep -Eo 'https://[^[:space:]]+\.pages\.dev' | tail -n 1 || true)"
  if [[ -z "$VERIFY_URL" ]]; then
    echo "Preview deployed, but Wrangler did not return a verification URL." >&2
    exit 1
  fi
  VERIFY_URL="${VERIFY_URL}/?printmo_release=${RELEASE_ID}"
fi

for attempt in {1..15}; do
  if LIVE_HTML="$(curl --fail --silent --show-error "$VERIFY_URL" 2>/dev/null)" && [[ "$LIVE_HTML" == *"$MARKER"* ]]; then
    echo "Verified $TARGET_LABEL release $RELEASE_ID at $VERIFY_URL"
    exit 0
  fi
  sleep 2
done

echo "Deployment completed but $TARGET_LABEL did not serve release marker $RELEASE_ID." >&2
exit 1
