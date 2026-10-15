---
'@quill/db': patch
---

A partial save can no longer overwrite a submission that was completed while it was in flight.

`upsertSubmission` already ignored a partial that arrived after the complete, but only by what its first read saw. A partial that read the row while it was still open, and wrote after the complete committed, replaced the completed data and score with its own. The partial's update now carries `completed_at IS NULL` in its `WHERE`, so the race resolves in the database: the completed row is left as it is. This matters now that the public form sends its partial and complete saves in parallel.
