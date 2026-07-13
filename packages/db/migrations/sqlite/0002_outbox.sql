-- B7/DM1: the transactional OUTBOX. Every durable side-effect (calendar event
-- write-out, webhook delivery) is recorded as a row here the moment it is due,
-- then a worker drains it with retry+backoff — so a provider outage or a crash
-- never silently loses the effect (the fire-and-forget path did). One row per
-- unit of work: per booking-lifecycle calendar transition, per webhook
-- subscriber delivery. The row IS the delivery log (status/attempts/last_error).
--
-- SAFE migration: a single CREATE of a NEW table + its index. Touches no
-- existing table, takes no long lock (C16). Nothing to guard with lock_timeout.
CREATE TABLE IF NOT EXISTS outbox (
  id              TEXT PRIMARY KEY,
  -- 'calendar' | 'webhook'
  kind            TEXT NOT NULL,
  -- calendar: 'create' | 'delete' | 'reschedule'; webhook: the lifecycle event name
  action          TEXT NOT NULL,
  -- calendar jobs address a booking; webhook jobs address an account + subscriber
  booking_uid     TEXT,
  account_id      TEXT,
  webhook_id      TEXT,
  -- JSON body for webhook deliveries ({event,data}); null for calendar jobs
  payload         TEXT,
  -- 'pending' | 'done' | 'failed'
  status          TEXT NOT NULL DEFAULT 'pending',
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 5,
  -- due when next_attempt_at <= now (ms); the worker bumps it on each retry
  next_attempt_at INTEGER NOT NULL,
  last_error      TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- The worker's poll: pending rows that are due, oldest first.
CREATE INDEX IF NOT EXISTS outbox_due_idx ON outbox (status, next_attempt_at);
