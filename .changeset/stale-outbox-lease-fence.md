---
'@quill/db': patch
---

Fence outbox settlement updates to the worker lease that claimed the row.
Settlement calls now report whether the lease still owns the row. The worker
claims rows one at a time and renews a long-running lease while it delivers.
