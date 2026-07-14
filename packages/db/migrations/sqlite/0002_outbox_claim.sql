-- Outbox worker claim/lease (H2) — additive, nullable columns.
-- A due row is atomically CLAIMED (claimed_at + claimed_by set) before it is
-- processed, so multiple API replicas draining the same table never deliver the
-- same row twice. A claim older than the worker's stale threshold is reclaimable
-- (a crashed worker's rows are not stranded). SQLite runs a single writer, so
-- the claim UPDATE is atomic without row locks.
ALTER TABLE outbox ADD COLUMN claimed_at INTEGER;
ALTER TABLE outbox ADD COLUMN claimed_by TEXT;
