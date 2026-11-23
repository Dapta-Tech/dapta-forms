-- Referral program: one row per referral, keyed by the referee PERSON. Additive.
--
-- A referral is one new person (the referee) credited to one referrer (ADR
-- 0005). Both are persons: the identity service's user id
-- (`member.external_id`), or `email:{lowercased email}` for a member it does
-- not know (local development). No workspace id.
--
-- `referee_person_id` is the primary key, so a person is credited once and the
-- first credit wins: a second claim inserts nothing. `source` says how the
-- referee came: `link` (the referrer's referral link) or `invite` (a teammate
-- invite). Rows are never deleted, not when the referee leaves a workspace and
-- not when a workspace is deleted, so a referrer's count never goes down.
CREATE TABLE IF NOT EXISTS referral (
  referee_person_id   TEXT PRIMARY KEY,
  referrer_person_id  TEXT NOT NULL,
  source              TEXT NOT NULL,
  created_at          BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS referral_referrer_idx ON referral (referrer_person_id);
