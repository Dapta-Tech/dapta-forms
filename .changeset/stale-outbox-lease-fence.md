---
'@quill/db': patch
---

Fence outbox settlement updates to the worker lease that claimed the row.
Settlement calls now report whether the lease still owns the row. The worker
claims rows one at a time and caps one delivery before it records a fenced
retry or failure. Timed-out effects are counted separately while they finish.
Mixed old and new workers require the documented stop/drain cutover.

Each claim now receives an opaque `claimed_by` token. Stale or ambiguous claims
cannot settle another generation, including during a rolling deploy. Delivery
remains at-least-once: a crash after an external effect and before settlement
can still replay that effect.
