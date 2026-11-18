---
'@quill/api': minor
---

HighLevel can be connected through the API, still hidden from the dashboard, the MCP and the public API reference. `POST /v1/integrations/gohighlevel/connect` takes a Private Integration token and a Location ID (or the sub-account's URL), checks the three scopes the destination needs against HighLevel before storing anything, and refuses with `GOHIGHLEVEL_REJECTED` and a `reason` (`token_format`, `invalid_token`, `wrong_location`, `missing_scope`, `unreachable`). The connection is stored encrypted, shows the sub-account's name, its Location ID and the token's last 4 characters, and replacing the token keeps every form's mapping. `DELETE /v1/integrations/gohighlevel` disconnects it. `GET /v1/integrations/gohighlevel/fields` lists the standard contact fields and the location's mappable custom fields, cached for five minutes, and never fails once signed in. Both new routes are refused to API keys.

Saving a HighLevel destination now refuses a custom field whose type cannot take what is mapped to it (a text field for the score, for example), naming the field and the type it needs. A delivery is handed the stored connection, the live custom-field types and a callback that marks the connection when HighLevel stops accepting the token.
