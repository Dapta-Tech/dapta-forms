-- Public API v1: additive.
--
-- The schema the API keys, the strict API validation, the revert and the
-- created-via metric build on. Nothing here changes behavior on its own: every
-- column is nullable and no existing row is rewritten.
--
--   api_key.member_id               the member who created the key. A key acts
--                                   as that person: their role is read on every
--                                   request, and the key stops working when they
--                                   leave the workspace. NULL only on rows from
--                                   before this column (the table was unused).
--   api_key_account_member_idx      listing a workspace's keys, or one member's
--                                   keys in it (and counting them against the
--                                   per-member limit), without a scan.
--   form.created_via                how the form was born: 'web', 'api' or 'mcp'.
--                                   NULL = created before this column, which is
--                                   every existing form; never backfilled, since
--                                   there is no honest value to put there.
--   form.previous_config            the live config that the last publish
--                                   replaced, so a revert can bring it back (and
--                                   a second revert undoes the first). NULL =
--                                   nothing to revert to.
--   form.previous_published_at_ms   epoch-ms of when that previous config was
--                                   published; NULL alongside previous_config.
--
-- api_key.scopes and api_key.expires_at_ms stay unused by v1.
ALTER TABLE api_key ADD COLUMN IF NOT EXISTS member_id TEXT;
CREATE INDEX IF NOT EXISTS api_key_account_member_idx ON api_key (account_id, member_id);

ALTER TABLE form ADD COLUMN IF NOT EXISTS created_via TEXT;
ALTER TABLE form ADD COLUMN IF NOT EXISTS previous_config JSONB;
ALTER TABLE form ADD COLUMN IF NOT EXISTS previous_published_at_ms BIGINT;
