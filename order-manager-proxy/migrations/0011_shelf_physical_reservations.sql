-- Physical shelf quantity stays unchanged when stock is reserved. Pulling is
-- the only order action that removes a blank from the physical shelf count.
DROP TRIGGER shelf_stock_insert_audit;
DROP TRIGGER shelf_stock_update_audit;
DROP TRIGGER shelf_claim_insert_check;
DROP TRIGGER shelf_claim_insert_apply;
DROP TRIGGER shelf_claim_update_check;
DROP TRIGGER shelf_claim_update_apply;

ALTER TABLE shelf_stock ADD COLUMN on_shelf INTEGER NOT NULL DEFAULT 0 CHECK (on_shelf >= 0);
ALTER TABLE shelf_claims ADD COLUMN pulled_qty INTEGER NOT NULL DEFAULT 0 CHECK (pulled_qty >= 0);
ALTER TABLE shelf_events ADD COLUMN on_shelf_after INTEGER;
ALTER TABLE shelf_events ADD COLUMN pulled_after INTEGER;

-- Pre-existing claims were reservations, never confirmed physical pulls.
UPDATE shelf_stock SET on_shelf = available + COALESCE((
  SELECT SUM(qty) FROM shelf_claims
  WHERE shelf_claims.shop_id = shelf_stock.shop_id AND shelf_claims.variant_gid = shelf_stock.variant_gid
), 0);

CREATE TRIGGER shelf_stock_insert_guard BEFORE INSERT ON shelf_stock BEGIN
  SELECT (CASE WHEN NEW.available <> NEW.on_shelf THEN RAISE(ABORT, 'SHELF_COUNT_INCONSISTENT') END);
END;
CREATE TRIGGER shelf_stock_update_guard BEFORE UPDATE ON shelf_stock BEGIN
  SELECT (CASE WHEN NEW.available <> NEW.on_shelf - COALESCE((
    SELECT SUM(qty - pulled_qty) FROM shelf_claims
    WHERE shop_id = NEW.shop_id AND variant_gid = NEW.variant_gid
  ), 0) THEN RAISE(ABORT, 'SHELF_COUNT_INCONSISTENT') END);
END;

CREATE TRIGGER shelf_stock_insert_audit AFTER INSERT ON shelf_stock BEGIN
  INSERT INTO shelf_events (id, shop_id, variant_gid, order_gid, line_item_gid, kind,
    free_delta, free_after, claim_after, actor, mutation_key, reason, created_at, on_shelf_after, pulled_after)
  VALUES (lower(hex(randomblob(16))), NEW.shop_id, NEW.variant_gid, NULL, NULL, 'count',
    NEW.available, NEW.available, NULL, NEW.updated_by, NEW.mutation_key, NEW.reason,
    NEW.updated_at, NEW.on_shelf, NULL);
END;
CREATE TRIGGER shelf_stock_update_audit AFTER UPDATE ON shelf_stock
WHEN NEW.mutation_key <> OLD.mutation_key AND
  (NEW.mutation_key LIKE 'count:%' OR NEW.mutation_key LIKE 'receive:%') BEGIN
  INSERT INTO shelf_events (id, shop_id, variant_gid, order_gid, line_item_gid, kind,
    free_delta, free_after, claim_after, actor, mutation_key, reason, created_at, on_shelf_after, pulled_after)
  VALUES (lower(hex(randomblob(16))), NEW.shop_id, NEW.variant_gid, NULL, NULL,
    CASE WHEN NEW.mutation_key LIKE 'receive:%' THEN 'receive' ELSE 'count' END,
    NEW.available - OLD.available, NEW.available, NULL, NEW.updated_by,
    NEW.mutation_key, NEW.reason, NEW.updated_at, NEW.on_shelf, NULL);
END;

CREATE TRIGGER shelf_claim_insert_check BEFORE INSERT ON shelf_claims BEGIN
  SELECT (CASE WHEN NEW.pulled_qty <> 0 THEN RAISE(ABORT, 'SHELF_PULL_CONFLICT') END);
  SELECT (CASE WHEN COALESCE((SELECT available FROM shelf_stock
    WHERE shop_id = NEW.shop_id AND variant_gid = NEW.variant_gid), -1) < NEW.qty
    THEN RAISE(ABORT, 'SHELF_STOCK_INSUFFICIENT') END);
END;
CREATE TRIGGER shelf_claim_insert_apply AFTER INSERT ON shelf_claims BEGIN
  UPDATE shelf_stock SET available = available - NEW.qty, version = version + 1,
    updated_at = NEW.updated_at, updated_by = NEW.updated_by, mutation_key = NEW.mutation_key
    WHERE shop_id = NEW.shop_id AND variant_gid = NEW.variant_gid;
  INSERT INTO shelf_events (id, shop_id, variant_gid, order_gid, line_item_gid, kind,
    free_delta, free_after, claim_after, actor, mutation_key, reason, created_at, on_shelf_after, pulled_after)
  VALUES (lower(hex(randomblob(16))), NEW.shop_id, NEW.variant_gid, NEW.order_gid,
    NEW.line_item_gid, 'reserve', -NEW.qty,
    (SELECT available FROM shelf_stock WHERE shop_id = NEW.shop_id AND variant_gid = NEW.variant_gid),
    NEW.qty, NEW.updated_by, NEW.mutation_key, NULL, NEW.updated_at,
    (SELECT on_shelf FROM shelf_stock WHERE shop_id = NEW.shop_id AND variant_gid = NEW.variant_gid), 0);
END;
CREATE TRIGGER shelf_claim_update_check BEFORE UPDATE ON shelf_claims BEGIN
  SELECT (CASE WHEN NEW.shop_id <> OLD.shop_id OR NEW.order_gid <> OLD.order_gid
    OR NEW.line_item_gid <> OLD.line_item_gid OR NEW.variant_gid <> OLD.variant_gid OR NEW.sku <> OLD.sku
    OR NEW.version <> OLD.version + 1 THEN RAISE(ABORT, 'SHELF_CLAIM_CONFLICT') END);
  SELECT (CASE WHEN NEW.pulled_qty > NEW.qty THEN RAISE(ABORT, 'SHELF_PULL_CONFLICT') END);
  SELECT (CASE WHEN NEW.qty > OLD.qty AND
    (SELECT available FROM shelf_stock WHERE shop_id = NEW.shop_id AND variant_gid = NEW.variant_gid) < NEW.qty - OLD.qty
    THEN RAISE(ABORT, 'SHELF_STOCK_INSUFFICIENT') END);
  SELECT (CASE WHEN NEW.pulled_qty > OLD.pulled_qty AND
    (SELECT on_shelf FROM shelf_stock WHERE shop_id = NEW.shop_id AND variant_gid = NEW.variant_gid) < NEW.pulled_qty - OLD.pulled_qty
    THEN RAISE(ABORT, 'SHELF_PHYSICAL_INSUFFICIENT') END);
END;
CREATE TRIGGER shelf_claim_update_apply AFTER UPDATE ON shelf_claims BEGIN
  UPDATE shelf_stock SET available = available + OLD.qty - NEW.qty,
    on_shelf = on_shelf + OLD.pulled_qty - NEW.pulled_qty,
    version = version + 1, updated_at = NEW.updated_at, updated_by = NEW.updated_by,
    mutation_key = NEW.mutation_key
    WHERE shop_id = NEW.shop_id AND variant_gid = NEW.variant_gid;
  INSERT INTO shelf_events (id, shop_id, variant_gid, order_gid, line_item_gid, kind,
    free_delta, free_after, claim_after, actor, mutation_key, reason, created_at, on_shelf_after, pulled_after)
  VALUES (lower(hex(randomblob(16))), NEW.shop_id, NEW.variant_gid, NEW.order_gid,
    NEW.line_item_gid,
    CASE WHEN NEW.pulled_qty > OLD.pulled_qty THEN 'pull'
      WHEN NEW.pulled_qty < OLD.pulled_qty THEN 'return'
      WHEN NEW.qty > OLD.qty THEN 'reserve' ELSE 'release' END,
    OLD.qty - NEW.qty,
    (SELECT available FROM shelf_stock WHERE shop_id = NEW.shop_id AND variant_gid = NEW.variant_gid),
    NEW.qty, NEW.updated_by, NEW.mutation_key, NULL, NEW.updated_at,
    (SELECT on_shelf FROM shelf_stock WHERE shop_id = NEW.shop_id AND variant_gid = NEW.variant_gid),
    NEW.pulled_qty);
END;
