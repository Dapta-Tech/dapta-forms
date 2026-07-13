-- Backfill (SAFE): null out schedule references that point at schedule rows
-- that no longer exist. There are no FKs, and deleteSchedule used to leave
-- dangling ids behind — the silent "slots: []" failure. NULL means "fall back
-- to the member's default schedule" at read time. deleteSchedule now re-points
-- on delete, so this is a one-time cleanup of already-drifted data.

UPDATE event_type SET schedule_id = NULL
WHERE schedule_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM schedule s WHERE s.id = event_type.schedule_id);

UPDATE event_type_host SET schedule_id = NULL
WHERE schedule_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM schedule s WHERE s.id = event_type_host.schedule_id);

UPDATE member SET default_schedule_id = NULL
WHERE default_schedule_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM schedule s WHERE s.id = member.default_schedule_id);
