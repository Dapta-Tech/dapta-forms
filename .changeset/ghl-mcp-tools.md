---
'@quill/mcp': minor
'@quill/shared': patch
---

Agents can configure a HighLevel destination through the MCP.

- `@quill/mcp`: `list_integrations` lists HighLevel with the connected sub-account (`label`, `locationId`, last 4 of the token), names it in `not_connected` when it is not, adds `rejected` (connected, but the provider stopped accepting the credential: HighLevel after a 401 or 403) and `integrations_url`, the dashboard page where an owner or admin connects it by pasting a Private Integration token. No tool connects it.
- `@quill/mcp`: new tool `list_gohighlevel_fields`: the standard contact fields and the sub-account's mappable custom fields (`id`, `key`, `name`, `dataType`, `options`), with `refresh` to skip the 5-minute copy, and `enabled: false` with `reason` (`not_connected`, `rejected`), a sentence and the dashboard page when it cannot list them.
- `@quill/mcp`: `set_destinations` and `create_form` describe the HighLevel destination (standard and custom targets, tags, source, UTMs to text fields, the score to a number field, the submitted date to a date field, no fixed value on email or phone, `events` with partials off by default), and the guide's `config_schema` and the skill's `form-config.schema.json` publish its variant. A HighLevel refusal for a workspace that has not connected it carries the usual hint: hand the user the page, then send the call again.
- `@quill/shared`: the API reference documents `GET /v1/integrations/gohighlevel/fields`, in English and Spanish, and the MCP tool catalog names the new tool.
