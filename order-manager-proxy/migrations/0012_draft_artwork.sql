PRAGMA foreign_keys = ON;
-- Commerce snapshots are rebuildable. Private artwork and explicit assignments are app-owned.
CREATE TABLE draft_order_projection (
  shop_id INTEGER NOT NULL, draft_gid TEXT NOT NULL, status TEXT NOT NULL,
  order_gid TEXT, summary_json TEXT NOT NULL, shopify_updated_at TEXT NOT NULL,
  synced_at TEXT NOT NULL, deleted_at TEXT,
  PRIMARY KEY (shop_id, draft_gid), FOREIGN KEY (shop_id) REFERENCES shops(id)
);
CREATE INDEX idx_draft_order_conversion ON draft_order_projection(shop_id, order_gid);
CREATE TABLE draft_artwork (
  id TEXT PRIMARY KEY, shop_id INTEGER NOT NULL, draft_gid TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE, filename TEXT NOT NULL, content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL, sha256 TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('mockup', 'design')), placement TEXT NOT NULL,
  items_json TEXT NOT NULL, item_kind TEXT NOT NULL CHECK (item_kind IN ('draft', 'order')),
  revision INTEGER NOT NULL DEFAULT 1, state TEXT NOT NULL CHECK (state IN ('active', 'removed')),
  converted_order_gid TEXT, converted_revision INTEGER, sync_error TEXT,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY (shop_id) REFERENCES shops(id)
);
CREATE INDEX idx_draft_artwork_owner ON draft_artwork(shop_id, draft_gid, state);
CREATE TABLE draft_artwork_events (
  id TEXT PRIMARY KEY, shop_id INTEGER NOT NULL, draft_gid TEXT NOT NULL,
  asset_id TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY (shop_id) REFERENCES shops(id)
);
ALTER TABLE asset_manifest_links ADD COLUMN placement TEXT NOT NULL DEFAULT '';
ALTER TABLE asset_manifest_links ADD COLUMN assignment_status TEXT NOT NULL DEFAULT '';
ALTER TABLE asset_manifest_links ADD COLUMN assignment_label TEXT NOT NULL DEFAULT '';
ALTER TABLE asset_manifest_links ADD COLUMN origin_draft_gid TEXT NOT NULL DEFAULT '';
