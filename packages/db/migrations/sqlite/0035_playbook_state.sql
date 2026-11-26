-- Playbooks: what each person has opened in the in-app gallery. Additive. See
-- the Postgres twin for the why.
CREATE TABLE IF NOT EXISTS playbook_state (
  user_id        TEXT NOT NULL,
  playbook_slug  TEXT NOT NULL,
  first_seen_at  INTEGER NOT NULL,
  last_seen_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, playbook_slug)
);
