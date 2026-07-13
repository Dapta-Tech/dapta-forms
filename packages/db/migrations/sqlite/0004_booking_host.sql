-- Team scheduling methods: a booking can have MORE THAN ONE assigned host
-- (collective = everyone attends; fixed_round_robin = fixed host + one rotating).
-- booking.host_member_id stays the primary/organizer for backward compatibility;
-- booking_host records the full assigned set so calendar write-out and
-- notifications fan out to every host. Round-robin bookings write no rows here
-- (the single host_member_id already covers them).
CREATE TABLE booking_host (
  id            TEXT PRIMARY KEY,
  booking_id    TEXT NOT NULL,
  member_id     TEXT NOT NULL,
  is_fixed      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX booking_host_booking_member_idx ON booking_host (booking_id, member_id);
CREATE INDEX booking_host_member_idx ON booking_host (member_id);
