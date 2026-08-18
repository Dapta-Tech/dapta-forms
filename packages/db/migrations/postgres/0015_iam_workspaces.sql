-- Workspaces ARE the identity service's workspaces — additive.
--
-- Until now one local `account` was born per identity-service ACCOUNT (the
-- billing/company layer above workspaces): `account.external_id` carried the
-- token's `account_id`, so a person with three workspaces upstream had exactly
-- one workspace here, and a workspace created here was invisible upstream.
--
-- From this migration on, `account.external_id` means the upstream WORKSPACE
-- id, and the local `account`/`member` rows are a PROJECTION of what the
-- identity service says: refreshed on login, on demand, and after every write
-- that goes upstream first. Three nullable columns carry what the projection
-- needs and nothing else:
--
--   account.iam_account_id          — the upstream ACCOUNT the workspace hangs
--                                     from (billing; also what a create must
--                                     name). Backfilled from `external_id`,
--                                     because before this migration that column
--                                     held exactly this value.
--   account.synced_at               — epoch-ms of the last successful
--                                     projection refresh for this workspace.
--                                     NULL = never projected (a purely local
--                                     account: seed, dev stub, or a legacy row
--                                     awaiting its first post-migration login).
--   member.iam_workspace_user_id    — the upstream `workspace_users.id` for
--                                     this membership, which is what removing
--                                     or re-roling a member upstream is keyed
--                                     on. NULL for rows the identity service
--                                     does not know (invited-by-email locally,
--                                     dev stub, seed).
--
-- The legacy `external_id = <account_id>` rows are NOT rewritten here: which
-- upstream workspace they map to depends on that person's memberships, which
-- only their next login can read (with their own token). The auth provider does
-- that rebind lazily; this migration only makes it possible.
ALTER TABLE account ADD COLUMN IF NOT EXISTS iam_account_id TEXT;
ALTER TABLE account ADD COLUMN IF NOT EXISTS synced_at BIGINT;
ALTER TABLE member ADD COLUMN IF NOT EXISTS iam_workspace_user_id TEXT;

UPDATE account SET iam_account_id = external_id
  WHERE iam_account_id IS NULL AND external_id IS NOT NULL AND external_id NOT LIKE 'dev:%';

CREATE INDEX IF NOT EXISTS account_iam_account_idx ON account (iam_account_id);
