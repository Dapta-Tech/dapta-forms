-- Account-level integration credentials (paste-token model) — additive.
--
--   account_integration — one row per (account, provider). Holds a third-party
--                         API token the account owner pastes in the UI, so a
--                         multi-tenant deployment serves a distinct token per
--                         account (the env HUBSPOT_PRIVATE_APP_TOKEN /
--                         CALENDLY_API_TOKEN remain a single-tenant fallback for
--                         OSS/self-host). The token is stored ENCRYPTED at rest
--                         (AES-256-GCM via FORMS_ENCRYPTION_KEY); the plaintext
--                         never leaves the server and is never returned to the
--                         browser. `meta` (TEXT JSON) holds display-only,
--                         non-secret hints (token last4, connected label/hub id).
CREATE TABLE IF NOT EXISTS account_integration (
  id               TEXT PRIMARY KEY,
  account_id       TEXT NOT NULL,
  provider         TEXT NOT NULL,
  encrypted_token  TEXT NOT NULL,
  meta             TEXT,
  connected_at     INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  UNIQUE (account_id, provider)
);
CREATE INDEX IF NOT EXISTS account_integration_account_idx ON account_integration (account_id);
