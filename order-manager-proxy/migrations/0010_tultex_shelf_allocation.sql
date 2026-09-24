-- Staff-only Tultex 202 shelf stock. Shopify inventory remains untouched.
CREATE TABLE IF NOT EXISTS shelf_stock (
  shop_id INTEGER NOT NULL,
  variant_gid TEXT NOT NULL,
  sku TEXT NOT NULL,
  available INTEGER NOT NULL CHECK (available >= 0),
  version INTEGER NOT NULL DEFAULT 0,
  counted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  mutation_key TEXT NOT NULL,
  reason TEXT NOT NULL,
  PRIMARY KEY (shop_id, variant_gid),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shelf_claims (
  shop_id INTEGER NOT NULL,
  order_gid TEXT NOT NULL,
  line_item_gid TEXT NOT NULL,
  variant_gid TEXT NOT NULL,
  sku TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty >= 0),
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  mutation_key TEXT NOT NULL,
  PRIMARY KEY (shop_id, order_gid, line_item_gid),
  FOREIGN KEY (shop_id, variant_gid) REFERENCES shelf_stock(shop_id, variant_gid)
);

CREATE INDEX IF NOT EXISTS idx_shelf_claims_order ON shelf_claims(shop_id, order_gid);

CREATE TABLE IF NOT EXISTS shelf_events (
  id TEXT PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  variant_gid TEXT NOT NULL,
  order_gid TEXT,
  line_item_gid TEXT,
  kind TEXT NOT NULL,
  free_delta INTEGER NOT NULL,
  free_after INTEGER NOT NULL,
  claim_after INTEGER,
  actor TEXT NOT NULL,
  mutation_key TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shelf_events_variant ON shelf_events(shop_id, variant_gid, created_at);

CREATE TABLE IF NOT EXISTS shelf_operations (
  shop_id INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  affected INTEGER NOT NULL CHECK (affected = 1),
  created_at TEXT NOT NULL,
  PRIMARY KEY (shop_id, idempotency_key)
);

CREATE TRIGGER IF NOT EXISTS shelf_stock_insert_audit AFTER INSERT ON shelf_stock BEGIN
  INSERT INTO shelf_events VALUES (lower(hex(randomblob(16))), NEW.shop_id, NEW.variant_gid,
    NULL, NULL, 'count', NEW.available, NEW.available, NULL, NEW.updated_by,
    NEW.mutation_key, NEW.reason, NEW.updated_at);
END;
CREATE TRIGGER IF NOT EXISTS shelf_stock_update_audit AFTER UPDATE ON shelf_stock
WHEN NEW.mutation_key LIKE 'count:%' AND NEW.mutation_key <> OLD.mutation_key BEGIN
  INSERT INTO shelf_events VALUES (lower(hex(randomblob(16))), NEW.shop_id, NEW.variant_gid,
    NULL, NULL, 'count', NEW.available - OLD.available, NEW.available, NULL, NEW.updated_by,
    NEW.mutation_key, NEW.reason, NEW.updated_at);
END;

CREATE TRIGGER IF NOT EXISTS shelf_claim_insert_check BEFORE INSERT ON shelf_claims BEGIN
  SELECT (CASE WHEN (SELECT available FROM shelf_stock WHERE shop_id = NEW.shop_id AND variant_gid = NEW.variant_gid) < NEW.qty
    THEN RAISE(ABORT, 'SHELF_STOCK_INSUFFICIENT') END);
END;
CREATE TRIGGER IF NOT EXISTS shelf_claim_insert_apply AFTER INSERT ON shelf_claims BEGIN
  UPDATE shelf_stock SET available = available - NEW.qty, version = version + 1,
    updated_at = NEW.updated_at, updated_by = NEW.updated_by, mutation_key = NEW.mutation_key
    WHERE shop_id = NEW.shop_id AND variant_gid = NEW.variant_gid;
  INSERT INTO shelf_events VALUES (lower(hex(randomblob(16))), NEW.shop_id, NEW.variant_gid,
    NEW.order_gid, NEW.line_item_gid, 'claim', -NEW.qty,
    (SELECT available FROM shelf_stock WHERE shop_id = NEW.shop_id AND variant_gid = NEW.variant_gid),
    NEW.qty, NEW.updated_by, NEW.mutation_key, NULL, NEW.updated_at);
END;
CREATE TRIGGER IF NOT EXISTS shelf_claim_update_check BEFORE UPDATE ON shelf_claims BEGIN
  SELECT (CASE WHEN NEW.shop_id <> OLD.shop_id OR NEW.order_gid <> OLD.order_gid
    OR NEW.line_item_gid <> OLD.line_item_gid OR NEW.variant_gid <> OLD.variant_gid OR NEW.sku <> OLD.sku
    OR NEW.version <> OLD.version + 1 THEN RAISE(ABORT, 'SHELF_CLAIM_CONFLICT') END);
  SELECT (CASE WHEN NEW.qty > OLD.qty AND
    (SELECT available FROM shelf_stock WHERE shop_id = NEW.shop_id AND variant_gid = NEW.variant_gid) < NEW.qty - OLD.qty
    THEN RAISE(ABORT, 'SHELF_STOCK_INSUFFICIENT') END);
END;
CREATE TRIGGER IF NOT EXISTS shelf_claim_update_apply AFTER UPDATE ON shelf_claims BEGIN
  UPDATE shelf_stock SET available = available + OLD.qty - NEW.qty, version = version + 1,
    updated_at = NEW.updated_at, updated_by = NEW.updated_by, mutation_key = NEW.mutation_key
    WHERE shop_id = NEW.shop_id AND variant_gid = NEW.variant_gid;
  INSERT INTO shelf_events VALUES (lower(hex(randomblob(16))), NEW.shop_id, NEW.variant_gid,
    NEW.order_gid, NEW.line_item_gid, CASE WHEN NEW.qty > OLD.qty THEN 'claim' ELSE 'release' END,
    OLD.qty - NEW.qty,
    (SELECT available FROM shelf_stock WHERE shop_id = NEW.shop_id AND variant_gid = NEW.variant_gid),
    NEW.qty, NEW.updated_by, NEW.mutation_key, NULL, NEW.updated_at);
END;
