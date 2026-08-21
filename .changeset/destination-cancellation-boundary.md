---
'@quill/db': patch
---

Re-submitting a form no longer leaves stale destination deliveries queued, no
longer destroys one that is already being made, and no longer loses the answers
the respondent left last.

The outbox holds three different kinds of pending row and the cancellation path
used to treat them as one. `deletePendingOutbox` is now `deleteUnstartedOutbox`
and deletes only what was never handed off to a worker: `status = 'pending'` AND
`claimed_at IS NULL` AND `attempts = 0`. `skipBackoffOutbox` settles the rows
that were attempted and are waiting to retry (`claimed_at IS NULL` AND
`attempts > 0`), and `listPendingOutbox` reads back everything still queued in
one scope. All of them are scoped to one subject, kind and action exactly as
before.

Deleting on `status = 'pending'` alone destroyed work that had already partly
happened. A row a worker held could vanish mid-request, so nothing was left to
settle it and nothing recorded that the endpoint had been called. A row waiting
out its backoff lost its attempt count and its transcript, which is the only
evidence of what the endpoint said. Neither column implies the other: a first
claim charges no attempt, and a retry clears the claim while leaving the count
above zero.

Leaving the attempted rows alone instead turned out to be its own bug. A queued
row carries a frozen snapshot of the config and answers it was built from, so
once the same session and phase come round again, every retry still on the
schedule would deliver content the form has already replaced, and a destination
the author had switched off went on retrying until it exhausted its attempts.
Those rows are now settled as `skipped`. Only the status moves: the attempt
count, the transcript, the recorded error and the timestamp are all left as they
were, so the row still reads back in the delivery history as the failure it was
and does not jump ahead of a genuinely newer one.

The row a worker is actually holding is the one case nothing may touch, so the
question of whether it is still worth sending moves to the moment it is sent.
Every firing destination is queued unconditionally, and a delivery about to
cross the wire stands down only if a row for the SAME destination, carrying a
different key, was queued strictly later than it was. Nothing is dropped either
way: the latest row is always delivered, and the one that stands down is the one
it replaces. Two rows queued in the same millisecond are not ordered by anything
the queue can trust, so neither retires the other and both go out under their own
keys, which is what at-least-once delivery and receiver-side de-duplication are
for.

That decision needs a key that actually identifies a delivery, so the
idempotency key is now content-addressed:
`submission:<id>:<phase>:<type>:<destination digest>:<content digest>`, two full
SHA-256 digests over canonical JSON. The old key ended in the destination's
INDEX in the form config, which is not an identity: delete the first of two
webhooks and the second inherited its key. The destination digest is an explicit
allowlist of what the form persists about where a delivery goes and never
includes a signing secret, which is not an identity and must not be published in
a header. The content digest covers everything the destination receives except
the key itself and the submission's clock reading, so an unchanged re-submit
keeps its key and a changed one does not.

Alongside this, the API's re-enqueue path reconsiders every destination kind the
config contract names rather than only the kinds enabled on the current pass. A
destination disabled, removed, or narrowed to another phase between two submits
of one session used to drop out of that pass entirely, so the rows it left
behind were never looked at and delivered anyway.
