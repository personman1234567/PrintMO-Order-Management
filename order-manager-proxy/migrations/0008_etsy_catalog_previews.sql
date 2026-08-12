-- Private, recognition-only catalog previews for Etsy listing variations.
-- This deliberately does not reuse asset_manifests: that table is tied to a
-- Shopify order_gid, while a catalog preview is provider/listing scoped and
-- must exist before any Etsy receipt is enrolled.

CREATE TABLE IF NOT EXISTS etsy_catalog_preview_blobs (
  id TEXT PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  sha256 TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  UNIQUE (shop_id, sha256, byte_size, content_type)
);

CREATE TABLE IF NOT EXISTS etsy_catalog_preview_mappings (
  id TEXT PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  etsy_shop_id TEXT NOT NULL,
  etsy_listing_id TEXT NOT NULL,
  property_id TEXT NOT NULL DEFAULT '',
  value_id TEXT NOT NULL DEFAULT '',
  listing_image_id TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('etsy', 'printmo_override')),
  resolution_mode TEXT NOT NULL CHECK (resolution_mode IN ('direct', 'replace', 'fallback')),
  blob_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('active', 'deleted')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  FOREIGN KEY (blob_id) REFERENCES etsy_catalog_preview_blobs(id) ON DELETE RESTRICT,
  UNIQUE (shop_id, etsy_listing_id, property_id, value_id, source_type, resolution_mode)
);

CREATE INDEX IF NOT EXISTS idx_etsy_catalog_preview_mapping_lookup
  ON etsy_catalog_preview_mappings (
    shop_id, etsy_listing_id, property_id, value_id, source_type, resolution_mode, state
  );

CREATE INDEX IF NOT EXISTS idx_etsy_catalog_preview_mapping_blob
  ON etsy_catalog_preview_mappings (blob_id, state);
