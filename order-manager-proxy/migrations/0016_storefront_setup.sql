PRAGMA foreign_keys = ON;
-- Private setup plans only. These records neither publish Shopify commerce nor
-- enable a report owner, and are not production/order or payment authority.
CREATE TABLE storefront_setup_drafts (
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  draft_json TEXT NOT NULL CHECK (json_valid(draft_json)),
  last_mutation_id TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (shop_id, id)
);
CREATE INDEX storefront_setup_drafts_updated ON storefront_setup_drafts(shop_id, updated_at DESC, id);
CREATE TABLE storefront_setup_mutations (
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (shop_id, actor_id, idempotency_key)
);
