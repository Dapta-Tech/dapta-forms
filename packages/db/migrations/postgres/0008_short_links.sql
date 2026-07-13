-- Short public links (additive + SAFE):
--   - account.vanity_slug — premium vanity code (globally unique when set)
--   - account.dapta_entitlement / entitlement_checked_at — cached IAM verdict
--     (IAM is the source of truth; Calendars has NO billing state of its own)
--   - account_alias — retired public codes (legacy acct-…/dev-…) that resolve
--     forever; the web layer 308-redirects them to the canonical code.
-- The code/handle backfills are JS data fixups run by migrate() (they need the
-- random short-code generator, which portable SQL can't express).

ALTER TABLE account ADD COLUMN IF NOT EXISTS vanity_slug TEXT;
ALTER TABLE account ADD COLUMN IF NOT EXISTS dapta_entitlement TEXT;
ALTER TABLE account ADD COLUMN IF NOT EXISTS entitlement_checked_at BIGINT;
CREATE UNIQUE INDEX IF NOT EXISTS account_vanity_slug_uq ON account (vanity_slug) WHERE vanity_slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS account_alias (
  alias      TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS account_alias_account_idx ON account_alias (account_id);
