-- DH1: make calendar write-out idempotent (see the sqlite migration for the
-- rationale). (booking_id, destination) is UNIQUE so a retried / concurrent
-- confirm cannot double-create the same external event.
ALTER TABLE booking_reference ADD COLUMN IF NOT EXISTS destination TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS booking_reference_booking_destination_uq
  ON booking_reference (booking_id, destination);
