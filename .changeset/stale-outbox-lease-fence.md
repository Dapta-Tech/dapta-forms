---
'@quill/db': patch
---

Fence outbox settlement updates to the worker lease that claimed the row.
Settlement calls now report whether the lease still owns the row. The worker
claims rows one at a time and renews a long-running lease while it delivers.
Renewal errors leave the final fenced settlement to determine ownership.
The worker retries a renewal error before it relies on that settlement.

Each claim now receives an opaque `claimed_by` token. Stale or ambiguous claims
cannot settle another generation, including during a rolling deploy. Delivery
remains at-least-once: a crash after an external effect and before settlement
can still replay that effect.
