---
'@quill/db': patch
---

Fence outbox settlement updates to the worker lease that claimed the row.
Settlement calls now report whether the lease still owns the row. The worker
claims each row immediately before its effect.

Each claim now receives an opaque `claimed_by` token. Stale or ambiguous claims
cannot settle another generation. Each stale reclaim charges one attempt, and
`maxAttempts` bounds replay. Mixed versions are unsupported and require a
coordinated stop/drain cutover. Delivery remains at-least-once: a
crash-before-effect can consume one attempt, and a prior effect can still
succeed after the row is recorded as outcome-unknown failed.
