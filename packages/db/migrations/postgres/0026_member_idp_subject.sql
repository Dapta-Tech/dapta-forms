-- The member's user id at the external OAuth authorization server that MCP
-- clients sign in with, and when a verified web login last vouched for the
-- member (additive + SAFE). The same columns and index as the sibling
-- calendars product (its 0028_member_idp_subject.sql).
--
--   - member.idp_subject: the `sub` of that server's access tokens for this
--     person. The host login provider records it on every verified web
--     request, writing only when it is missing or different. A sign-in token at
--     the MCP door finds the person by it, then the person's members in every
--     account through `external_id` (the same upstream user id in each). NULL
--     until the person signs in to the web app with a login that carries it,
--     and on every deployment whose login provider records none.
--   - member.login_seen_at: epoch ms the identity service last vouched for the
--     member (the issue time of the token of a verified web login), refreshed
--     at most once a day, never backwards. The MCP door honors only members
--     seen within OAUTH_LINK_MAX_AGE_DAYS: this app is not told when someone is
--     removed upstream, so MCP access ends when the web's would. NULL until the
--     member's next web login. Not `last_seen_at` (0010): that one is stamped
--     by every authenticated request, API keys and MCP calls included.
--
-- One member per subject within an account: the latest web login wins (the
-- previous holder is cleared in the same transaction). The unique index makes
-- that an invariant rather than a convention, and its leading column serves the
-- door's lookup by subject across accounts. NULLs are distinct in a Postgres
-- unique index, so every existing row (all NULL) is unaffected.
--
-- member_external_id_idx serves the person's other members (an equality join
-- on external_id): the only index on that column so far leads with account_id.
--
-- Migration safety: two ADD COLUMNs, nullable, no default: catalog-only (no
-- rewrite, no scan). The two indexes are built over the small member table
-- inside the migrator's transaction (it cannot run CONCURRENTLY). Every step is
-- bounded by lock_timeout and statement_timeout, scoped to this transaction, so
-- a long transaction elsewhere makes the boot fail fast and retry, never hang.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

ALTER TABLE member ADD COLUMN IF NOT EXISTS idp_subject TEXT;
ALTER TABLE member ADD COLUMN IF NOT EXISTS login_seen_at BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS member_idp_subject_account_idx ON member (idp_subject, account_id);
CREATE INDEX IF NOT EXISTS member_external_id_idx ON member (external_id);
