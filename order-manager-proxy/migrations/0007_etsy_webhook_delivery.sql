PRAGMA foreign_keys = ON;

-- Etsy webhook payloads are intentionally not retained. This ledger stores
-- only delivery identity, the validated provider tuple, processing state, and
-- redacted error codes required for replay protection and recovery.
CREATE TABLE IF NOT EXISTS etsy_webhook_deliveries (
  webhook_id TEXT PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  etsy_shop_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('received', 'processing', 'processed', 'ignored', 'retry', 'failed')),
  outcome_code TEXT,
  error_code TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  triggered_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  next_attempt_at TEXT,
  processed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_etsy_webhook_recovery
  ON etsy_webhook_deliveries(shop_id, state, next_attempt_at, updated_at);

CREATE INDEX IF NOT EXISTS idx_etsy_webhook_receipt
  ON etsy_webhook_deliveries(shop_id, etsy_shop_id, receipt_id, received_at);
