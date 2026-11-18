---
'@quill/shared': minor
'@quill/db': minor
---

In-app announcements. `@quill/shared` adds the announcement list (`ANNOUNCEMENTS`), the rule that picks the one a person gets (`pickAnnouncement`: within its dates, allowed on the deployment, not followed, at most five sessions, the newest card not closed first) and the EN and ES copy. `@quill/db` adds migration 0029, a new `announcement_state` table on SQLite and Postgres that stores, per person and announcement, the sessions seen and when the card was closed or followed, with its repository functions.
