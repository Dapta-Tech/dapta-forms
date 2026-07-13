-- Additive (SAFE): account-level roles on `member`. Adds `role`
-- (owner|admin|member) and `status` (active|invited|disabled) so a workspace can
-- distinguish admins from staff and enforce permissions. Distinct from
-- `team_membership.role` (per-team), which is unchanged.
--
-- Pure additive DDL: ADD COLUMN of a NOT NULL column WITH a constant DEFAULT is a
-- metadata-only change on modern Postgres (no table rewrite). Existing rows read
-- back role='member', status='active'.

ALTER TABLE member ADD COLUMN IF NOT EXISTS role   TEXT NOT NULL DEFAULT 'member';
ALTER TABLE member ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

-- Backfill: every existing account must have exactly one owner. Promote the
-- earliest-created member of each account (id as a deterministic tiebreak). At
-- this point all rows are 'member', so no account already has an owner.
UPDATE member SET role = 'owner'
WHERE id IN (
  SELECT (
    SELECT m2.id FROM member m2
    WHERE m2.account_id = a.id
    ORDER BY m2.created_at ASC, m2.id ASC
    LIMIT 1
  )
  FROM account a
);
