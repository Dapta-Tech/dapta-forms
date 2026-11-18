---
'@quill/db': minor
---

`upsertIntegration` takes extra display hints to keep in a connection's `meta`, `markIntegrationRejected` records that a provider refused the stored credential (only while the row still holds that credential), and a `gohighlevel` connection's status carries `locationId` and `rejectedAt`.
