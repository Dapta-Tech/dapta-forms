-- Outbox worker claim/lease (H2) — additive, nullable columns.
-- A due row is atomically CLAIMED (claimed_at + claimed_by set) via
-- UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) before it is
-- processed, so multiple API replicas (prod runs an HPA) draining the same table
-- never deliver the same row twice. A claim older than the worker's stale
-- threshold is reclaimable (a crashed worker's rows are not stranded).
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS claimed_at BIGINT;
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS claimed_by TEXT;
