-- Agent-managed Etsy listing setup. Preview refresh decisions and supplier
-- blank recipes are listing-scoped; they never modify Etsy or Shopify data.

CREATE TABLE IF NOT EXISTS etsy_listing_blank_recipes (
  id TEXT PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  etsy_shop_id TEXT NOT NULL,
  etsy_listing_id TEXT NOT NULL,
  supplier TEXT NOT NULL CHECK (supplier = 'ss'),
  supplier_snapshot_date TEXT NOT NULL,
  supplier_brand TEXT NOT NULL,
  supplier_style TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'archived')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  UNIQUE (shop_id, etsy_listing_id),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS etsy_listing_supplier_skus (
  id TEXT PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  recipe_id TEXT NOT NULL,
  selector_key TEXT NOT NULL,
  supplier_sku TEXT NOT NULL,
  supplier_color TEXT NOT NULL,
  supplier_size TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'archived')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  UNIQUE (recipe_id, selector_key),
  UNIQUE (shop_id, recipe_id, supplier_sku),
  FOREIGN KEY (recipe_id) REFERENCES etsy_listing_blank_recipes(id) ON DELETE CASCADE,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_etsy_listing_supplier_sku_lookup
  ON etsy_listing_supplier_skus(shop_id, recipe_id, selector_key, state);
