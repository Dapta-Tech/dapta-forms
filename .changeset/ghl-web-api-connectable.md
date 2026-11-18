---
'@quill/api': patch
---

HighLevel is no longer reported as a provider this deployment cannot connect. Saving a HighLevel destination while HighLevel is not connected now gets the same answer as Salesforce: a browser is warned with the Integrations page, and an agent is refused with `INTEGRATION_NOT_CONNECTED`, the page to connect it on and `unavailable: false`. Once the workspace connects a sub-account the entry saves normally.
