---
'@quill/api': minor
---

HighLevel reaches agents. `GET /v1/integrations/gohighlevel/fields` can be called with an API key (read only: field metadata, never the token) and backs the MCP tool `list_gohighlevel_fields`; connecting HighLevel stays session only. An agent may set `events` on a HighLevel destination, now that its card has the partials switch. The OpenAPI document lists `gohighlevel` in the provider and destination enums, documents the HighLevel destination with `events`, the `locationId` and `rejectedAt` of its integration entry, the fields route (with the API key scheme, derived from the allowlist as before) and the connect route (session only).
