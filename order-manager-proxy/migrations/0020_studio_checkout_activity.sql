ALTER TABLE draft_order_projection ADD COLUMN studio_checkout_ready_at TEXT;
CREATE INDEX idx_studio_checkout_activity
  ON draft_order_projection(shop_id, studio_checkout_ready_at DESC, draft_gid)
  WHERE studio_checkout_ready_at IS NOT NULL;
