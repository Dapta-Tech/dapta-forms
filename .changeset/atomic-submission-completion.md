---
'@quill/db': patch
---

Make concurrent final submissions claim completion atomically so only one caller reports the first completion.
