-- Draft/publish workflow + booking events (pilot port, phase 1) — additive.
--
--   form.draft_config  — the unpublished working copy of the form config; NULL
--                        when no draft is pending. Publish copies it into
--                        `config` and clears it.
--   form.published_at  — epoch-ms of the last publish; NULL = never published
--                        via the draft flow (legacy forms keep serving `config`).
--   booking_event      — one row per scheduling callback (HubSpot Meetings /
--                        Calendly) reported by the public renderer, tied to the
--                        submission session via (form_id, session_id).
ALTER TABLE form ADD COLUMN IF NOT EXISTS draft_config JSONB;
ALTER TABLE form ADD COLUMN IF NOT EXISTS published_at BIGINT;

CREATE TABLE IF NOT EXISTS booking_event (
  id           TEXT PRIMARY KEY,
  form_id      TEXT NOT NULL,
  session_id   TEXT NOT NULL,
  provider     TEXT NOT NULL,
  event_uri    TEXT,
  invitee_uri  TEXT,
  start_time   BIGINT,
  payload      JSONB,
  created_at   BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS booking_event_form_session_idx ON booking_event (form_id, session_id);
