-- In-app announcements: what each person did with each one. Additive. See the
-- Postgres twin for the why.
CREATE TABLE IF NOT EXISTS announcement_state (
  user_id          TEXT NOT NULL,
  announcement_id  TEXT NOT NULL,
  sessions_seen    INTEGER NOT NULL DEFAULT 0,
  last_seen_at     INTEGER,
  dismissed_at     INTEGER,
  clicked_at       INTEGER,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  PRIMARY KEY (user_id, announcement_id)
);
