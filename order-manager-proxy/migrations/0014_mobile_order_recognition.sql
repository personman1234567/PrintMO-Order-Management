-- Additive derivative metadata. Existing artwork roles and rows stay unchanged.
ALTER TABLE asset_manifests ADD COLUMN preview_kind TEXT NOT NULL DEFAULT '' CHECK (preview_kind IN ('', 'mobile-front'));
ALTER TABLE asset_manifest_links ADD COLUMN preview_kind TEXT NOT NULL DEFAULT '' CHECK (preview_kind IN ('', 'mobile-front'));
ALTER TABLE draft_artwork ADD COLUMN preview_kind TEXT NOT NULL DEFAULT '' CHECK (preview_kind IN ('', 'mobile-front'));
