-- App-owned attempt protection; independent of confirmed/receiving membership.
CREATE TABLE IF NOT EXISTS supplier_order_holds (
  shop_id INTEGER NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('shopify', 'etsy')),
  order_key TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (shop_id, provider, order_key),
  FOREIGN KEY (batch_id) REFERENCES batches(id)
);
CREATE INDEX IF NOT EXISTS supplier_order_holds_batch ON supplier_order_holds(shop_id, batch_id);

-- Preserve original request membership, including orders removed after partial success.
INSERT OR IGNORE INTO supplier_order_holds (shop_id, provider, order_key, batch_id, created_at)
SELECT b.shop_id, CASE WHEN json_extract(b.request_json, '$.provider') = 'etsy' THEN 'etsy' ELSE 'shopify' END,
  j.value, b.id, b.created_at
FROM batches b, json_each(CASE WHEN json_valid(b.request_json) THEN
  COALESCE(json_extract(b.request_json, '$.orderIds'), json_extract(b.request_json, '$.orderKeys'), '[]') ELSE '[]' END) j
WHERE b.state IN ('submitting', 'unknown', 'confirmed')
  OR (b.state = 'failed' AND EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(b.response_json)
    THEN COALESCE(json_extract(b.response_json, '$.acceptedLines'), '[]') ELSE '[]' END) accepted
    WHERE CAST(json_extract(accepted.value, '$.acceptedQty') AS REAL) > 0))
ORDER BY b.created_at ASC;

CREATE TABLE IF NOT EXISTS supplier_cart_reconciliations (
  id TEXT PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  batch_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  order_key TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_json TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (provenance = 'owner_attested'),
  state TEXT NOT NULL CHECK (state IN ('pending', 'saved', 'failed', 'unknown')),
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (shop_id, actor_id, idempotency_key, provider, order_key),
  FOREIGN KEY (batch_id) REFERENCES batches(id)
);
