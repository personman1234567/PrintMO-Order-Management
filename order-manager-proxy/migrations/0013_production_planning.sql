PRAGMA foreign_keys = ON;
-- Optional shop-wide planning; these records never own order production state.
CREATE TABLE production_runs (
  shop_id INTEGER PRIMARY KEY REFERENCES shops(id),
  revision INTEGER NOT NULL DEFAULT 0,
  orders_json TEXT NOT NULL DEFAULT '[]',
  last_mutation_id TEXT,
  updated_by TEXT,
  updated_at TEXT
);
CREATE TABLE production_run_mutations (
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  actor_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
  request_json TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (shop_id, actor_id, idempotency_key)
);
-- Draft preparation is app-owned until its date is promoted into Shopify's
-- existing canonical order production metafield after normal order enrollment.
CREATE TABLE draft_preparation (
  shop_id INTEGER NOT NULL REFERENCES shops(id), draft_gid TEXT NOT NULL,
  target_date TEXT, revision INTEGER NOT NULL DEFAULT 0, last_mutation_id TEXT,
  promoted_revision INTEGER, promoted_order_gid TEXT, promotion_outcome TEXT,
  updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (shop_id, draft_gid)
);
CREATE TABLE draft_preparation_events (
  id TEXT PRIMARY KEY, shop_id INTEGER NOT NULL REFERENCES shops(id),
  draft_gid TEXT NOT NULL, revision INTEGER NOT NULL, target_date TEXT,
  actor_id TEXT NOT NULL, created_at TEXT NOT NULL
);
