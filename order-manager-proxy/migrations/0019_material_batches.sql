-- App-only print purchase grouping; Shopify remains production-status authority.
CREATE TABLE IF NOT EXISTS print_material_batches (
  shop_id INTEGER NOT NULL, id TEXT NOT NULL, data_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  lease_token TEXT, lease_until INTEGER,
  PRIMARY KEY (shop_id, id)
);
CREATE TABLE IF NOT EXISTS print_material_members (
  shop_id INTEGER NOT NULL, batch_id TEXT NOT NULL, order_key TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (shop_id, batch_id, order_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS print_material_member_active
  ON print_material_members(shop_id, order_key) WHERE active = 1;
