-- One current check/recovery record per enrolled variant, not a price-history store.
CREATE TABLE IF NOT EXISTS inventory_sync_costs (
 variant_id TEXT PRIMARY KEY,
 product_id TEXT NOT NULL,
 sku TEXT NOT NULL,
 checked_at INTEGER NOT NULL,
 observed_at TEXT,
 source_cost TEXT,
 shopify_cost TEXT,
 state TEXT NOT NULL,
 error TEXT,
 before_cost TEXT,
 written_cost TEXT,
 written_at INTEGER
);
