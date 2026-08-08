PRAGMA foreign_keys = ON;

-- Short-lived PKCE material for an owner-initiated Etsy OAuth request.
-- The state value is stored only as a SHA-256 digest, and the verifier is
-- encrypted with the server-only ETSY_TOKEN_ENCRYPTION_KEY binding.
CREATE TABLE IF NOT EXISTS etsy_oauth_sessions (
  state_hash TEXT PRIMARY KEY,
  code_verifier_ciphertext TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  requested_scope TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_etsy_oauth_sessions_expiry
  ON etsy_oauth_sessions(expires_at, consumed_at);

-- This Seller App connects only Print-MO's own Etsy shop. OAuth tokens are
-- encrypted as one authenticated blob; no receipt or buyer payload is stored
-- by the connection proof.
CREATE TABLE IF NOT EXISTS etsy_connections (
  id TEXT PRIMARY KEY CHECK (id = 'primary'),
  etsy_user_id TEXT NOT NULL,
  etsy_shop_id TEXT NOT NULL,
  shop_name TEXT NOT NULL,
  scope TEXT NOT NULL,
  token_ciphertext TEXT NOT NULL,
  access_expires_at TEXT NOT NULL,
  connected_by TEXT NOT NULL,
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_tested_at TEXT,
  last_test_result_json TEXT
);
