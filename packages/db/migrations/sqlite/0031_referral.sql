-- Referral program: one row per referral, keyed by the referee PERSON. Additive.
-- See the Postgres twin for the why.
CREATE TABLE IF NOT EXISTS referral (
  referee_person_id   TEXT PRIMARY KEY,
  referrer_person_id  TEXT NOT NULL,
  source              TEXT NOT NULL,
  created_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS referral_referrer_idx ON referral (referrer_person_id);
