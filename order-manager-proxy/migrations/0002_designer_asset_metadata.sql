ALTER TABLE asset_manifests ADD COLUMN line_item_id TEXT;
ALTER TABLE asset_manifests ADD COLUMN design_ref TEXT;
ALTER TABLE asset_manifests ADD COLUMN role TEXT CHECK (role IS NULL OR role IN ('mockup', 'design'));
ALTER TABLE asset_manifests ADD COLUMN side TEXT CHECK (side IS NULL OR side IN ('front', 'back'));

CREATE INDEX IF NOT EXISTS idx_asset_manifests_source
  ON asset_manifests(shop_id, order_gid, source_key, state);
