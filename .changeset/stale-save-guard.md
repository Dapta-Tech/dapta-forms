---
'@quill/db': patch
'@quill/types': patch
---

Editor saves and publishes carry an optimistic lock.

Two people (or two tabs) editing the same form used to be last-writer-wins
with no warning: every autosave sent the whole snapshot, and whichever landed
last silently threw away the other's edits. A redirect URL was lost this way
on 2026-09-17 while a customer and the team edited one form together.

`PUT /v1/forms/:id` and `POST /v1/forms/:id/publish` accept an optional
`expectedUpdatedAt`: the `updatedAt` the client loaded or last received. A
write whose stamp is behind the row is refused with 409 `STALE`, and the
refusal carries the row as it is now. Without the field, behavior is
unchanged, so tabs open across the deploy keep saving.

The editor sends the stamp on every save, the publish, and the unload flush.
A refusal whose server content is what this editor last saved (only the stamp
moved: its own slug rename, a CRM mapping save) is resolved silently. Anything
else shows a banner with the two ways out: see the saved version (the local
backup offers this tab's edits back on reload) or keep mine.
