-- C11: at most ONE destination calendar per member (R20) — DB backstop behind
-- the app-level exclusivity in updateConnection.
CREATE UNIQUE INDEX IF NOT EXISTS connected_calendar_one_destination_uq
  ON connected_calendar (member_id) WHERE is_destination = 1;
