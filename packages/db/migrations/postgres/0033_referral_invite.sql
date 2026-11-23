-- Referral program: who invited which address as a teammate. Additive.
--
-- The identity service's invitation carries no inviter, and neither does a
-- member row, so this is the only record of who brought a teammate in. One row
-- per invited address (trimmed, lowercased): `email` is the primary key, so the
-- FIRST inviter of an address keeps it and a re-invite from anyone else inserts
-- nothing. `inviter_person_id` is a person key like `referrer.person_id` (the
-- identity service's user id, or `email:{lowercased email}` in local
-- development); `account_id` is the workspace the invite was sent from, kept
-- for the record only (the credit is per person, ADR 0005).
--
-- Read when the address first shows up as a NEW person, which credits the
-- inviter with a referral of source `invite`. Rows are never deleted.
CREATE TABLE IF NOT EXISTS referral_invite (
  email              TEXT PRIMARY KEY,
  inviter_person_id  TEXT NOT NULL,
  account_id         TEXT NOT NULL,
  created_at         BIGINT NOT NULL
);
