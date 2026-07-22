#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT_DIR/order-manager-web"
OUT_DIR="$ROOT_DIR/dist/cloudflare-order-manager-web"
ZIP_FILE="$ROOT_DIR/dist/cloudflare-order-manager-web.zip"

rm -rf "$OUT_DIR" "$ZIP_FILE"
mkdir -p "$OUT_DIR"

rsync -a \
  --exclude '.assetsignore' \
  --exclude 'shopify-mobile-preview.html' \
  --exclude '.DS_Store' \
  --exclude 'Assets/.DS_Store' \
  --exclude 'Assets/PrintMO_Orders.icns' \
  --exclude 'Assets/PrintMO_Orders.ico' \
  "$SRC_DIR"/ "$OUT_DIR"/

for required in index.html renderer.js web-shim.js storage-browser.js blanks-batches.js desktop.css mobile.css accessibility-hardening.css accessibility-hardening.js shopify-embedded-mobile.js; do
  if [[ ! -f "$OUT_DIR/$required" ]]; then
    echo "Missing required deploy file: $required" >&2
    exit 1
  fi
done

if command -v zip >/dev/null 2>&1; then
  (
    cd "$OUT_DIR"
    zip -qr "$ZIP_FILE" .
  )
fi

echo "Prepared Cloudflare upload folder:"
echo "  $OUT_DIR"
if [[ -f "$ZIP_FILE" ]]; then
  echo "Prepared Cloudflare upload zip:"
  echo "  $ZIP_FILE"
else
  echo "Skipped optional upload zip (zip utility not installed)."
fi
