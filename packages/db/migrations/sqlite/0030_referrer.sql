-- Referral program: one row per referrer, keyed by the PERSON. Additive. See
-- the Postgres twin for the why.
CREATE TABLE IF NOT EXISTS referrer (
  person_id               TEXT PRIMARY KEY,
  code                    TEXT NOT NULL,
  unlocked_at             INTEGER,
  banner_dismissed_until  INTEGER,
  nudge_sent_at           INTEGER,
  created_at              INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS referrer_code_uq ON referrer (code);
