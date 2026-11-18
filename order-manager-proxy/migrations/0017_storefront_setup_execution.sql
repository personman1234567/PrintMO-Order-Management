-- Setup execution state is separate from plans and all order/payment records.
CREATE TABLE storefront_setup_execution (
 shop_id INTEGER NOT NULL REFERENCES shops(id), draft_id TEXT NOT NULL,
 revision INTEGER NOT NULL, state TEXT NOT NULL, lease_id TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
 result_json TEXT NOT NULL DEFAULT '{}', updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(shop_id,draft_id)
);
CREATE TABLE storefront_setup_uploads (
 shop_id INTEGER NOT NULL REFERENCES shops(id), draft_id TEXT NOT NULL, id TEXT NOT NULL,
 filename TEXT NOT NULL, resource_url TEXT NOT NULL, file_id TEXT,
 created_at TEXT NOT NULL, PRIMARY KEY(shop_id,draft_id,id)
);
