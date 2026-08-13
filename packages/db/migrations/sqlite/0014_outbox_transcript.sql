-- The delivery transcript on outbox rows — additive.
--
-- `payload` is the ENQUEUED snapshot: the destination config plus the context
-- captured at submission time. It is not what went over the wire, and only what
-- went over the wire answers the question every webhook debugging session opens
-- with — "what did my endpoint actually receive, and what did it say back?".
--
-- Until now the admin could show a status and the worker's one-line error. That
-- is enough to know a delivery failed and useless for finding out why: "HTTP
-- 400" from a receiver that rejects one malformed field looks identical to one
-- that rejects the whole schema. The body and the response tell them apart.
--
-- Three nullable columns, no rewrite, no default. NULL means NOT RECORDED — for
-- every row that predates this, and for kinds whose adapter has no single
-- request to report (HubSpot is a sequence of API calls). It never means empty.
--
-- Sensitivity: `request_body` carries the submission's answers, so these are
-- exactly as sensitive as the submission row itself and live under the same
-- account scope. Both bodies are truncated by the writer, so a receiver that
-- answers with a full HTML error page cannot bloat the queue table.
--
-- SQLite has no ADD COLUMN IF NOT EXISTS and does not need one: migrate.ts runs
-- each numbered file exactly once, gated on the _migrations table.
ALTER TABLE outbox ADD COLUMN request_body TEXT;
ALTER TABLE outbox ADD COLUMN response_status INTEGER;
ALTER TABLE outbox ADD COLUMN response_body TEXT;
