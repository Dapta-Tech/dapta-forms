---
'@quill/engine': patch
---

Export `stepLabel`, `formatAnswerValue` and `formatAnswerCell` from the answer summary.

The submissions CSV and the admin submissions table now read answers the way the owner notification email already did: a step is headed by its question (trimmed, falling back to the key), an option prints its label instead of the stored value, a file prints its name, and every value is trimmed. `formatAnswerValue(step, value, { separator, timeZone })` joins a multi-select with `; ` by default and reads a booking in `timeZone` (UTC by default); the email summary keeps its `, ` and UTC. `formatAnswerCell` is the same, except that a boolean prints as a check or nothing, the way the submissions table shows it.
