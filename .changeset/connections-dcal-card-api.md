---
"@quill/api": patch
---

`GET /v1/integrations` reports whether dCal exists on the deployment and where
event types are created. Salesforce connect calls give up after 8 seconds each,
so both fit inside the button's wait and an unreachable org is reported as such.
