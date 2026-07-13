-- Team bio (P1 team-create page parity): a short description shown on the team's
-- public booking page. Nullable + additive → SAFE, backward-compatible.
ALTER TABLE team ADD COLUMN IF NOT EXISTS bio TEXT;
