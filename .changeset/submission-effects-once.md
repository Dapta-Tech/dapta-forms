---
'@quill/db': patch
---

`upsertSubmission` now reports `wasCompletedBefore` — whether the session's row
was already completed when the write arrived. The row was always idempotent per
session; this flag lets callers make its downstream effects (emails, CRM
deliveries) idempotent too, firing them only on the first completion instead of
on every transport-retry re-landing of the same one.
