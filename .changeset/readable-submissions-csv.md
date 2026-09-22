---
'@quill/engine': patch
---

Export `stepLabel` and `formatAnswerValue` from the answer summary.

The submissions CSV and the admin submissions table now read answers the way the owner notification email already did: a step is headed by its question (trimmed, falling back to the key), an option prints its label instead of the stored value, a file prints its name, and every value is trimmed. `formatAnswerValue` joins a multi-select with `; ` by default; the email summary keeps its `, `.
