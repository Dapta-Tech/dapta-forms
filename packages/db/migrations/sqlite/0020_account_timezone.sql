-- Workspace timezone: additive. See the Postgres twin for the why.
ALTER TABLE account ADD COLUMN timezone TEXT;
