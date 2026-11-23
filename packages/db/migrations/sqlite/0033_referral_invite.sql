-- Referral program: who invited which address as a teammate. Additive.
-- See the Postgres twin for the why.
CREATE TABLE IF NOT EXISTS referral_invite (
  email              TEXT PRIMARY KEY,
  inviter_person_id  TEXT NOT NULL,
  account_id         TEXT NOT NULL,
  created_at         INTEGER NOT NULL
);
