-- Additive (SAFE): persisted connection health on `connected_calendar` so the
-- Calendars page can show OK/error with last-checked info instead of relying
-- only on a live probe. NULL last_check_at = never checked.

ALTER TABLE connected_calendar ADD COLUMN IF NOT EXISTS last_check_at BIGINT;
ALTER TABLE connected_calendar ADD COLUMN IF NOT EXISTS last_check_ok INTEGER;
ALTER TABLE connected_calendar ADD COLUMN IF NOT EXISTS last_check_detail TEXT;
