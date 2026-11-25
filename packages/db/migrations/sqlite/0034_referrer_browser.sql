-- Referral program: the browsers each person was seen in. Additive.
-- See the Postgres twin for the why.
CREATE TABLE IF NOT EXISTS referrer_browser (
  person_id      TEXT NOT NULL,
  browser_hash   TEXT NOT NULL,
  first_seen_at  INTEGER NOT NULL,
  last_seen_at   INTEGER NOT NULL,
  PRIMARY KEY (person_id, browser_hash)
);
