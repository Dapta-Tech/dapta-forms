-- Additive (SAFE): external identity projection for the `workos` auth provider.
-- Adds a nullable external_id to account + member and a uniqueness guard so a
-- JIT-provisioned tenant/user is created at most once. No data rewrite, no drop,
-- no lock of consequence — existing rows keep external_id = NULL.

ALTER TABLE account ADD COLUMN external_id TEXT;
ALTER TABLE member  ADD COLUMN external_id TEXT;

-- NULLs are distinct in a SQLite unique index, so seeded/local rows (external_id
-- NULL) are unaffected; only real external ids are constrained.
CREATE UNIQUE INDEX account_external_id_idx ON account (external_id);
CREATE UNIQUE INDEX member_account_external_id_idx ON member (account_id, external_id);
