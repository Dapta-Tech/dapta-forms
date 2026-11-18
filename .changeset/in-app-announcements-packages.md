---
'@quill/shared': minor
'@quill/db': minor
---

In-app announcements. `@quill/shared` adds the announcement list (`ANNOUNCEMENTS`), the rule that picks the one a person gets and where it shows (`pickAnnouncement`: within its dates, allowed on the deployment; the pop-up until closed or followed, the rail mark until its page is opened, the banner while it runs) and the EN and ES copy. `@quill/db` adds migration 0029, a new `announcement_state` table on SQLite and Postgres that stores, per person and announcement, when the pop-up was first seen, closed and followed, with its repository functions.
