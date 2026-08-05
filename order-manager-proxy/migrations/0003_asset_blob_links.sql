PRAGMA foreign_keys = ON;

-- A manifest is the stored private blob. Links preserve every Shopify line-item
-- association without storing identical Designer Studio bytes more than once.
CREATE TABLE IF NOT EXISTS asset_manifest_links (
  asset_id TEXT NOT NULL,
  line_item_id TEXT NOT NULL DEFAULT '',
  design_ref TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '' CHECK (role IN ('', 'mockup', 'design')),
  side TEXT NOT NULL DEFAULT '' CHECK (side IN ('', 'front', 'back')),
  source_key TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (asset_id, line_item_id, design_ref, role, side),
  FOREIGN KEY (asset_id) REFERENCES asset_manifests(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_asset_manifest_links_line
  ON asset_manifest_links(line_item_id, asset_id);

INSERT OR IGNORE INTO asset_manifest_links (
  asset_id, line_item_id, design_ref, role, side, source_key, created_at
)
SELECT
  id,
  COALESCE(line_item_id, ''),
  COALESCE(design_ref, ''),
  COALESCE(role, ''),
  COALESCE(side, ''),
  COALESCE(source_key, ''),
  created_at
FROM asset_manifests
WHERE state = 'active';

-- Move every association onto one canonical blob for identical bytes in the
-- same order. Existing duplicate R2 objects are intentionally left in place;
-- this migration is metadata-only and a later audited cleanup may remove them.
INSERT OR IGNORE INTO asset_manifest_links (
  asset_id, line_item_id, design_ref, role, side, source_key, created_at
)
SELECT
  canonical.id,
  COALESCE(duplicate.line_item_id, ''),
  COALESCE(duplicate.design_ref, ''),
  COALESCE(duplicate.role, ''),
  COALESCE(duplicate.side, ''),
  COALESCE(duplicate.source_key, ''),
  duplicate.created_at
FROM asset_manifests AS duplicate
JOIN asset_manifests AS canonical
  ON canonical.id = (
    SELECT MIN(candidate.id)
    FROM asset_manifests AS candidate
    WHERE candidate.shop_id = duplicate.shop_id
      AND candidate.order_gid = duplicate.order_gid
      AND candidate.sha256 = duplicate.sha256
      AND candidate.byte_size = duplicate.byte_size
      AND candidate.content_type = duplicate.content_type
      AND candidate.state = 'active'
  )
WHERE duplicate.state = 'active';

DELETE FROM asset_manifest_links
WHERE asset_id IN (
  SELECT duplicate.id
  FROM asset_manifests AS duplicate
  WHERE duplicate.state = 'active'
    AND duplicate.id <> (
      SELECT MIN(candidate.id)
      FROM asset_manifests AS candidate
      WHERE candidate.shop_id = duplicate.shop_id
        AND candidate.order_gid = duplicate.order_gid
        AND candidate.sha256 = duplicate.sha256
        AND candidate.byte_size = duplicate.byte_size
        AND candidate.content_type = duplicate.content_type
        AND candidate.state = 'active'
    )
);

UPDATE asset_manifests AS duplicate
SET state = 'deleted',
    deleted_at = COALESCE(deleted_at, updated_at)
WHERE duplicate.state = 'active'
  AND duplicate.id <> (
    SELECT MIN(candidate.id)
    FROM asset_manifests AS candidate
    WHERE candidate.shop_id = duplicate.shop_id
      AND candidate.order_gid = duplicate.order_gid
      AND candidate.sha256 = duplicate.sha256
      AND candidate.byte_size = duplicate.byte_size
      AND candidate.content_type = duplicate.content_type
      AND candidate.state = 'active'
  );
