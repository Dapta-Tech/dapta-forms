-- B7/DM1: the transactional OUTBOX (see the sqlite migration for the full
-- rationale). Every durable side-effect (calendar write-out, webhook delivery)
-- is recorded here and drained by a worker with retry+backoff, so a provider
-- outage or a crash never silently loses the effect. The row IS the delivery
-- log (status/attempts/last_error).
--
-- SAFE migration: a single CREATE of a NEW table + its index — no lock on any
-- existing table, so no lock_timeout guard is needed (C16). The FIRST migration
-- that ALTERs a hot table must still carry the lock_timeout discipline.
CREATE TABLE IF NOT EXISTS outbox (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,
  action          TEXT NOT NULL,
  booking_uid     TEXT,
  account_id      TEXT,
  webhook_id      TEXT,
  payload         TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 5,
  next_attempt_at BIGINT NOT NULL,
  last_error      TEXT,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS outbox_due_idx ON outbox (status, next_attempt_at);
