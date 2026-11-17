-- The workspace's choice to hide the "Made with dForms" attribution, and the
-- cached Dapta AI paid verdict that choice depends on (additive + SAFE). The
-- same split as the sibling calendars product (its account.hide_branding).
--
--   - account.hide_attribution: 0 (the default, the attribution shows) or 1
--     (the workspace asked to hide it). A CHOICE, not a verdict: the public
--     render hides the attribution only while the verdict below also reads
--     paid (or the deployment runs PREMIUM_FEATURES=open). When a subscription
--     lapses the choice stays stored, the attribution comes back on its own,
--     and a workspace that pays again gets its choice back untouched.
--   - account.dapta_paid: 1 / 0, the identity service's last word on whether
--     the workspace's owning account pays for Dapta AI, read from the rows it
--     already returns with the caller's own token (`isPaid` on the workspace
--     search, `account.account_status_id` on the detail). NULL = never seen.
--     Only this boolean is kept: no plan, no status, no billing id.
--   - account.dapta_paid_checked_at: epoch ms that verdict was written. A paid
--     verdict older than 30 days counts as not paid (see
--     ATTRIBUTION_VERDICT_MAX_AGE_MS in @quill/shared).
--
-- INTEGER 0/1, not BOOLEAN, so it reads the same as on SQLite. The DEFAULT
-- backfills every existing workspace to "attribution on": no live page moves.
--
-- Migration safety: three ADD COLUMNs; the NOT NULL one has a constant
-- default, which Postgres 11+ stores in the catalog (no rewrite, no scan).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

ALTER TABLE account ADD COLUMN IF NOT EXISTS hide_attribution INTEGER NOT NULL DEFAULT 0;
ALTER TABLE account ADD COLUMN IF NOT EXISTS dapta_paid INTEGER;
ALTER TABLE account ADD COLUMN IF NOT EXISTS dapta_paid_checked_at BIGINT;
