---
'@quill/db': patch
---

Re-submitting a form no longer destroys a destination delivery that is already
being made, and it now clears out the stale queued work it can safely reach.

The outbox holds three different kinds of pending row and the cancellation path
used to treat them as one. `deletePendingOutbox` is now `deleteUnstartedOutbox`
and deletes only what was never handed off to a worker: `status = 'pending'` AND
`claimed_at IS NULL` AND `attempts = 0`. `skipBackoffOutbox` settles the rows
that were attempted and are waiting to retry (`status = 'pending'` AND
`claimed_at IS NULL` AND `attempts > 0`) by moving `status` to `skipped` and
nothing else. Both are scoped to one subject, kind and action exactly as before.

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
the author had switched off had nothing left in its own config to stop it
retrying. The rows that are unclaimed when the pass runs are now settled as
`skipped`. Only the status moves: the attempt count, the transcript, the
recorded error and the timestamps are all left as they were, so the row still
reads back in the delivery history as the failure it was.

WHERE THE BOUNDARY SITS. Configuration decides what gets queued and what stops
being retried. It cannot reach work a worker is already holding: that request
may already have crossed the wire, and its row is the only record that it did,
so settling it belongs to the worker side rather than to configuration. If the
worker that took the lease abandons it, the row stays claimed and another worker
may reclaim it; what configuration still cannot do is settle it. What
configuration can do is terminally settle already-attempted, unclaimed,
scheduled work without deleting its record.

A pass speaks for the queue as it finds it, and not for what the queue becomes
afterwards. A row a worker is holding when the pass runs is left alone, and the
pass cannot bound what happens to it next. That attempt may succeed, in which
case its frozen snapshot is delivered and the row finishes `done`. It may fail,
in which case the worker clears the claim and the row waits out a backoff,
unclaimed and due again later. Its lease may simply expire, in which case the
row stays claimed and another worker may reclaim it.

So Dapta Forms can send the older payload after the newer one. The row the
current pass queues is due immediately, while a held row that fails is not due
again until its backoff elapses, which makes this a real sequence: the newer
payload delivered, then the older one delivered on a later retry, then that
older row marked `done`. `max_attempts` does not prevent it, because it caps
how many further retries follow rather than un-sending the attempts already
made. What a receiver makes of the two is outside Dapta Forms.

A later pass for the same session and phase settles such a row if it has come
back into backoff and is unclaimed by then, but no later pass is guaranteed: a
partial phase can come round again, while a re-landed complete does not
re-enqueue at all. That residual is bounded and deliberate: the only way to
close it would be to let configuration settle a row a worker owns, which is
exactly what this boundary exists to prevent.

Editing a destination is therefore not a synchronous cancel of anything in
flight, and this change does not claim to make it one. Every firing destination
is queued unconditionally on each pass, so a request still on the wire and the
answers the respondent just left both go out. Both rows carry the same
positional idempotency key, which this change leaves exactly as it was; a
webhook delivery sends that key as a header, the HubSpot adapter does not read
it at all, and what any particular receiver does with it is outside Dapta Forms.

Alongside this, the API's re-enqueue path reconsiders every destination kind the
config contract names rather than only the kinds enabled on the current pass. A
destination disabled, removed, or narrowed to another phase between two submits
of one session used to drop out of that pass entirely, so the rows it left
behind were never looked at and delivered anyway.
