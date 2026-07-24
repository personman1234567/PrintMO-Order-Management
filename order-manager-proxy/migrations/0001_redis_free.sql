PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS shops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_domain TEXT NOT NULL UNIQUE,
  installed_at TEXT NOT NULL,
  uninstalled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_projection (
  shop_id INTEGER NOT NULL,
  order_gid TEXT NOT NULL,
  display_name TEXT,
  stage TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  production_revision INTEGER NOT NULL DEFAULT 0,
  production_digest TEXT,
  production_json TEXT NOT NULL,
  commerce_json TEXT,
  shopify_updated_at TEXT,
  fetched_at TEXT,
  stale_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (shop_id, order_gid),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_order_projection_stage
  ON order_projection(shop_id, active, stage, created_at, order_gid);
CREATE INDEX IF NOT EXISTS idx_order_projection_stale
  ON order_projection(shop_id, active, stale_at);

CREATE TABLE IF NOT EXISTS mutation_requests (
  id TEXT PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  order_gid TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'complete', 'failed')),
  requested_patch_json TEXT NOT NULL,
  expected_revision INTEGER,
  result_json TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (shop_id, actor_id, idempotency_key),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mutation_requests_pending
  ON mutation_requests(shop_id, state, updated_at);

CREATE TABLE IF NOT EXISTS production_events (
  id TEXT PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  order_gid TEXT NOT NULL,
  mutation_request_id TEXT,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  old_revision INTEGER,
  new_revision INTEGER,
  changed_fields_json TEXT NOT NULL,
  outcome TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  FOREIGN KEY (mutation_request_id) REFERENCES mutation_requests(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_production_events_order
  ON production_events(shop_id, order_gid, created_at);

CREATE TABLE IF NOT EXISTS webhook_receipts (
  webhook_id TEXT PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  topic TEXT NOT NULL,
  order_gid TEXT,
  state TEXT NOT NULL CHECK (state IN ('received', 'processed', 'failed')),
  triggered_at TEXT,
  error_code TEXT,
  received_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_webhook_receipts_expiry
  ON webhook_receipts(received_at);

CREATE TABLE IF NOT EXISTS reconciliation_checkpoints (
  shop_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  checkpoint TEXT,
  last_started_at TEXT,
  last_completed_at TEXT,
  last_result_json TEXT,
  PRIMARY KEY (shop_id, name),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  po_number TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('prepared', 'submitting', 'confirmed', 'unknown', 'failed')),
  line_hash TEXT NOT NULL,
  request_json TEXT NOT NULL,
  response_json TEXT,
  expires_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (shop_id, po_number),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS batch_orders (
  batch_id TEXT NOT NULL,
  order_gid TEXT NOT NULL,
  production_revision INTEGER NOT NULL,
  quantity_hash TEXT NOT NULL,
  PRIMARY KEY (batch_id, order_gid),
  FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS supplier_attempts (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  attempt_type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  http_status INTEGER,
  response_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS asset_manifests (
  id TEXT PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  order_gid TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'active', 'quarantined', 'deleted')),
  source_key TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_asset_manifests_order
  ON asset_manifests(shop_id, order_gid, state, created_at);

CREATE TABLE IF NOT EXISTS migration_ledger (
  id TEXT PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  source_key TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  order_gid TEXT,
  destination_key TEXT,
  state TEXT NOT NULL CHECK (state IN ('planned', 'migrated', 'verified', 'quarantined', 'failed')),
  reason TEXT,
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (shop_id, source_type, source_key, source_sha256),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);
