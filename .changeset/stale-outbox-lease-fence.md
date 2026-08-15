---
'@quill/db': patch
---

Fence outbox settlement updates to the worker lease that claimed the row.
Settlement calls now report whether the lease still owns the row. The worker
claims each row immediately before its effect.

Each claim now receives an opaque `claimed_by` token. Stale or ambiguous claims
cannot settle another generation. Mixed versions are unsupported and require a
coordinated stop/drain cutover. Delivery remains at-least-once: a crash, a slow
effect, a hung replica, a late success after peer terminalization, or an
adapter success-then-throw can still replay or misrecord an external effect.
