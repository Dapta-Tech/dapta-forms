-- Referral program: the browsers each person was seen in. Additive.
--
-- A referral must not count when the new person signs up from the same
-- browser the referrer uses (one person opening several accounts from their
-- own browser to reach the referral unlock). The web app keeps a random,
-- opaque, first-party browser id in a long-lived cookie (`dforms_bid`) and
-- forwards it to the API; the API stores only its SHA-256 here, never the raw
-- value, and nothing about the person beyond their person key.
--
-- `person_id` is a person key like `referrer.person_id` (the identity
-- service's user id, or `email:{lowercased email}` in local development). One
-- row per person and browser: the pair is the primary key. Written when a
-- signed-in person loads the dashboard (with the program on), `last_seen_at`
-- refreshed at most hourly, and capped to the person's 20 most recently seen
-- browsers. Read at claim time: a referral whose browser is among the
-- referrer's is refused. A network address is never stored or compared.
CREATE TABLE IF NOT EXISTS referrer_browser (
  person_id      TEXT NOT NULL,
  browser_hash   TEXT NOT NULL,
  first_seen_at  BIGINT NOT NULL,
  last_seen_at   BIGINT NOT NULL,
  PRIMARY KEY (person_id, browser_hash)
);
