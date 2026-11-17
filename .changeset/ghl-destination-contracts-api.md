---
'@quill/api': patch
---

A `gohighlevel` destination is accepted by the destinations schema but cannot deliver yet: an API key or MCP connection saving one is refused with `INTEGRATION_NOT_CONNECTED` (marked `unavailable`, since nothing can connect it yet), a browser session is warned, and a stored one is recorded as skipped with a reason instead of reaching the network. The generic `/v1/integrations/:provider` routes do not serve it. The one-per-form rule now also covers HighLevel.

An API key or MCP connection that sends `events` on a HubSpot or Salesforce destination is refused with `UNSUPPORTED_FIELD`, because the Connect tab has no switch for it yet.
