-- In-app announcements: what each person did with each one. Additive.
--
-- The announcements themselves live in code (`ANNOUNCEMENTS` in
-- @quill/shared): publishing one is a pull request. This table only remembers,
-- per person and per announcement, how many distinct sessions it was on screen,
-- and whether the person closed the home card or followed it. An announcement
-- is shown once per person, so the key is the PERSON (`user_id`, the identity
-- service's user id, `member.external_id`), not a member row of one workspace:
-- someone in three workspaces would otherwise see it three times. A member the
-- identity service does not know is keyed `member:{member.id}`.
--
-- Rows are never deleted by the product. An id is never reused for another
-- announcement, so an old row can only ever describe the announcement it names.
CREATE TABLE IF NOT EXISTS announcement_state (
  user_id          TEXT NOT NULL,
  announcement_id  TEXT NOT NULL,
  sessions_seen    INTEGER NOT NULL DEFAULT 0,
  last_seen_at     BIGINT,
  dismissed_at     BIGINT,
  clicked_at       BIGINT,
  created_at       BIGINT NOT NULL,
  updated_at       BIGINT NOT NULL,
  PRIMARY KEY (user_id, announcement_id)
);
