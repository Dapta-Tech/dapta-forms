-- Additive (SAFE): external identity projection for the `workos` auth provider.
-- Adds a nullable external_id to account + member and a uniqueness guard so a
-- JIT-provisioned tenant/user is created at most once. Pure additive DDL —
-- ADD COLUMN of a nullable column takes only a brief catalog lock (no table
-- rewrite/backfill); index builds on empty/near-empty external_id. Existing rows
-- keep external_id = NULL. Classified SAFE.

ALTER TABLE account ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE member  ADD COLUMN IF NOT EXISTS external_id TEXT;

-- NULLs are distinct in a Postgres unique index, so seeded/local rows (external_id
-- NULL) are unaffected; only real external ids are constrained.
CREATE UNIQUE INDEX IF NOT EXISTS account_external_id_idx ON account (external_id);
CREATE UNIQUE INDEX IF NOT EXISTS member_account_external_id_idx ON member (account_id, external_id);
