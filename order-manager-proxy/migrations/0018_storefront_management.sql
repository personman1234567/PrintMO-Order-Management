CREATE TABLE storefronts (
 shop_id INTEGER NOT NULL REFERENCES shops(id), id TEXT NOT NULL,
 partner_gid TEXT, collection_gid TEXT, name TEXT NOT NULL,
 workspace_plan_id TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}',
 appearance_json TEXT NOT NULL DEFAULT '{}', branding_status TEXT NOT NULL DEFAULT 'DRAFT', revision INTEGER NOT NULL DEFAULT 1,
 reporting_enabled INTEGER NOT NULL DEFAULT 0 CHECK(reporting_enabled IN(0,1)),
 lease_id TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(shop_id,id), UNIQUE(shop_id,collection_gid), UNIQUE(shop_id,partner_gid)
);
CREATE TABLE storefront_product_links (
 shop_id INTEGER NOT NULL, storefront_id TEXT NOT NULL, product_gid TEXT NOT NULL,
 source_product_gid TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(shop_id,product_gid), FOREIGN KEY(shop_id,storefront_id) REFERENCES storefronts(shop_id,id)
);
CREATE TABLE storefront_product_work (
 shop_id INTEGER NOT NULL, storefront_id TEXT NOT NULL, plan_id TEXT NOT NULL,
 product_gid TEXT, created_at TEXT NOT NULL,
 PRIMARY KEY(shop_id,plan_id), FOREIGN KEY(shop_id,storefront_id) REFERENCES storefronts(shop_id,id)
);
CREATE TABLE storefront_management_operations (
 shop_id INTEGER NOT NULL, storefront_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
 kind TEXT NOT NULL, request_json TEXT NOT NULL, state TEXT NOT NULL,
 progress_json TEXT NOT NULL DEFAULT '{}', result_json TEXT,
 actor_id TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(shop_id,storefront_id,idempotency_key), FOREIGN KEY(shop_id,storefront_id) REFERENCES storefronts(shop_id,id)
);
