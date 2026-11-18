---
'@quill/api': minor
---

An API key (or MCP connection) can now set `events` on HubSpot and Salesforce destinations, since the integrations cards show the partials switch; it is still refused on HighLevel. HubSpot and Salesforce always receive complete responses, so a list without `complete` is refused there (`UNSUPPORTED_FIELD`): the switch could not show it. The OpenAPI `Destination` schema documents `events` and each kind's default.
