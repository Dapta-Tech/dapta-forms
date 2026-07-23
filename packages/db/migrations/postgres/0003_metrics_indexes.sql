-- Metrics read-path indexes (additive, idempotent).
-- Analytics windows completed submissions by completed_at (not started_at), and
-- reconstructs each session's open time from its first form_event `view`. These
-- back the date-ranged aggregates + the per-session open lookup so they
-- range-seek instead of scanning a form's whole history.
CREATE INDEX IF NOT EXISTS submission_form_completed_idx ON submission (form_id, completed_at);
CREATE INDEX IF NOT EXISTS form_event_session_idx ON form_event (form_id, session_id, type);
