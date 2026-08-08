PRAGMA foreign_keys = ON;

-- Provider-aware commerce projection for non-Shopify order sources. Shopify
-- remains in order_projection and its app-owned metafield remains canonical.
-- Shadow rows are never returned by the active board endpoint.
CREATE TABLE IF NOT EXISTS provider_order_projection (
  shop_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  external_order_id TEXT NOT NULL,
  order_key TEXT NOT NULL,
  source_display_number TEXT NOT NULL,
  source_created_at TEXT,
  source_updated_at TEXT,
  commerce_json TEXT NOT NULL,
  eligibility_state TEXT NOT NULL,
  enrollment_state TEXT NOT NULL DEFAULT 'shadow',
  board_enrolled INTEGER NOT NULL DEFAULT 0 CHECK (board_enrolled IN (0, 1)),
  fetched_at TEXT NOT NULL,
  stale_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (shop_id, provider, provider_account_id, external_order_id),
  UNIQUE (shop_id, order_key),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_provider_order_shadow
  ON provider_order_projection(shop_id, provider, enrollment_state, board_enrolled, source_created_at, order_key);

-- D1 is canonical only for non-Shopify provider production state. Initial
-- shadow state is revision zero and remains invisible until a later explicit
-- enrollment gate promotes the order.
CREATE TABLE IF NOT EXISTS provider_production_state (
  shop_id INTEGER NOT NULL,
  order_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  external_order_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  last_mutation_id TEXT,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (shop_id, order_key),
  FOREIGN KEY (shop_id, order_key) REFERENCES provider_order_projection(shop_id, order_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS provider_mutation_requests (
  id TEXT PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  order_key TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  patch_json TEXT NOT NULL,
  state TEXT NOT NULL,
  result_revision INTEGER,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (shop_id, actor_id, idempotency_key),
  FOREIGN KEY (shop_id, order_key) REFERENCES provider_production_state(shop_id, order_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_provider_mutation_pending
  ON provider_mutation_requests(shop_id, state, updated_at);

CREATE TABLE IF NOT EXISTS provider_production_events (
  id TEXT PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  order_key TEXT NOT NULL,
  mutation_request_id TEXT,
  actor_id TEXT NOT NULL,
  old_revision INTEGER,
  new_revision INTEGER,
  changed_fields_json TEXT NOT NULL,
  outcome TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (shop_id, order_key) REFERENCES provider_production_state(shop_id, order_key) ON DELETE CASCADE,
  FOREIGN KEY (mutation_request_id) REFERENCES provider_mutation_requests(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_provider_production_events_order
  ON provider_production_events(shop_id, order_key, created_at);
