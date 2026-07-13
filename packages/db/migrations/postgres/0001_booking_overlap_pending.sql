-- Widen the anti-double-booking EXCLUDE constraint to also cover 'pending'.
--
-- The app treats a requiresConfirmation booking (status='pending') as
-- slot-holding: the overlap check is status IN ('accepted','pending'). But the
-- baseline constraint (0000_init) gated only on 'accepted', so under concurrency
-- on Postgres two pending bookings for the same host/slot could both be created
-- — the DB backstop never fired and the "pending holds the slot" invariant was
-- violated. This aligns the DB guarantee with the app: at most one
-- accepted-OR-pending booking per host per [start_ms, end_ms) interval. The
-- race loser's INSERT raises 23P01, which createBooking maps to 409 SLOT_TAKEN.
--
-- Migration safety: at this pre-launch baseline the booking table is small, so
-- DROP + re-ADD (a brief ACCESS EXCLUSIVE lock + GiST index rebuild) is SAFE.
-- lock_timeout keeps it from blocking behind a long transaction. On a large live
-- table this same change would be a RISKY rewrite and must be scheduled with
-- care — do not copy it blindly onto a populated table.
SET lock_timeout = '5s';

ALTER TABLE booking DROP CONSTRAINT IF EXISTS booking_no_overlap;

ALTER TABLE booking ADD CONSTRAINT booking_no_overlap
  EXCLUDE USING gist (
    host_member_id WITH =,
    int8range(start_ms, end_ms, '[)') WITH &&
  ) WHERE (status IN ('accepted', 'pending') AND host_member_id IS NOT NULL);
