-- Playbooks: what each person has opened in the in-app gallery. Additive.
--
-- The playbooks themselves live in code (`PLAYBOOKS` in
-- @quill/shared/playbooks, written as markdown in content/playbooks): publishing
-- one is a pull request. This table only remembers, per person and per
-- playbook, when they first opened it and when they last did. The key is the
-- PERSON (`user_id`, the same key as `announcement_state.user_id`: the
-- identity service's user id, `member.external_id`, or `member:{member.id}`
-- for a member it does not know), not a member row, so someone in three
-- workspaces reads the same gallery state in all three (ADR 0006).
--
-- One reserved slug, `_gallery`, records the person's visits to the gallery
-- itself: a playbook published after its `last_seen_at` is "New" for them.
-- Playbook slugs are lowercase words joined by hyphens, so it cannot collide.
--
-- Rows are never deleted by the product. A slug is never reused for another
-- playbook, so an old row can only ever describe the playbook it names.
CREATE TABLE IF NOT EXISTS playbook_state (
  user_id        TEXT NOT NULL,
  playbook_slug  TEXT NOT NULL,
  first_seen_at  BIGINT NOT NULL,
  last_seen_at   BIGINT NOT NULL,
  PRIMARY KEY (user_id, playbook_slug)
);
