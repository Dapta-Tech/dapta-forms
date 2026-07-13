-- DH1: make calendar write-out idempotent. A booking_reference now records the
-- DESTINATION (the connection ref) it was created for, and (booking_id,
-- destination) is UNIQUE — so a retried / concurrent confirm cannot create the
-- same external event twice (the second INSERT loses the claim and skips it).
ALTER TABLE booking_reference ADD COLUMN destination TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS booking_reference_booking_destination_uq
  ON booking_reference (booking_id, destination);
