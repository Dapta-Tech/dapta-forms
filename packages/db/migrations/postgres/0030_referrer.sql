-- Referral program: one row per referrer, keyed by the PERSON. Additive.
--
-- A person (one human across workspaces, the identity service's user id,
-- `member.external_id`) gets one referral link with one short random code, the
-- same in every workspace they belong to (ADR 0005). A member the identity
-- service does not know (local development) is keyed `email:{lowercased email}`.
--
-- The row is created lazily, the first time the person's link is asked for, and
-- never deleted by the product: deleting a workspace leaves it. The nullable
-- columns are filled by later steps of the program: when the person reached
-- the goal (`unlocked_at`), until when the banner stays closed
-- (`banner_dismissed_until`) and when the one reminder email was sent
-- (`nudge_sent_at`).
CREATE TABLE IF NOT EXISTS referrer (
  person_id               TEXT PRIMARY KEY,
  code                    TEXT NOT NULL,
  unlocked_at             BIGINT,
  banner_dismissed_until  BIGINT,
  nudge_sent_at           BIGINT,
  created_at              BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS referrer_code_uq ON referrer (code);
