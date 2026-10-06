CREATE TABLE IF NOT EXISTS inventory_sync_variants (
  variant_id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  product_id TEXT NOT NULL DEFAULT '',
  missing_policy TEXT NOT NULL CHECK (missing_policy IN ('hold', 'block')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  registered_at INTEGER NOT NULL,
  last_success_at INTEGER,
  next_due_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS inventory_sync_due ON inventory_sync_variants(enabled, next_due_at, variant_id);
CREATE INDEX IF NOT EXISTS inventory_sync_product ON inventory_sync_variants(product_id);
CREATE TABLE IF NOT EXISTS inventory_sync_jobs (
  name TEXT PRIMARY KEY,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'idle',
  updated_at INTEGER NOT NULL,
  result_json TEXT,
  error TEXT
);
