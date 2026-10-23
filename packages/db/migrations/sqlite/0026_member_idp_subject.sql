-- See migrations/postgres/0026_member_idp_subject.sql for the rationale.
--
-- member.idp_subject: the external authorization server's user id (`sub`).
-- member.login_seen_at: epoch ms of the last verified web login's token issue
-- time, refreshed at most once a day. Both NULL on every existing row.
-- A unique index keeps one member per subject within an account (SQLite treats
-- NULLs as distinct in a unique index too), and an index on external_id serves
-- the person's other members.
ALTER TABLE member ADD COLUMN idp_subject TEXT;
ALTER TABLE member ADD COLUMN login_seen_at INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS member_idp_subject_account_idx ON member (idp_subject, account_id);
CREATE INDEX IF NOT EXISTS member_external_id_idx ON member (external_id);
