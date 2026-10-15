-- Public API v1: additive. See the Postgres twin for the why.
ALTER TABLE api_key ADD COLUMN member_id TEXT;
CREATE INDEX IF NOT EXISTS api_key_account_member_idx ON api_key (account_id, member_id);

ALTER TABLE form ADD COLUMN created_via TEXT;
ALTER TABLE form ADD COLUMN previous_config TEXT;
ALTER TABLE form ADD COLUMN previous_published_at_ms INTEGER;
