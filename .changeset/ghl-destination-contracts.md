---
'@quill/types': minor
'@quill/db': patch
'@quill/destinations': patch
'@quill/shared': patch
'@quill/mcp': patch
---

Groundwork for a HighLevel destination. Nothing can connect or deliver to HighLevel yet, and no screen offers it.

- `@quill/types`: a `gohighlevel` destination type with its schema (mappings to a standard contact field or to a custom field by id, key and type; UTMs, score and submitted date to custom fields; `dayTimezone`, `staticFields`, `tags`, `source`, `drafts`, `events`), the standard field catalog, the custom field types, which ones each kind of mapping may target (`goHighLevelSlotAccepts`), and the shapes the connect and fields routes and the adapter will use. At most one per form, through `extraOnePerFormDestination`, which also carries the HubSpot and Salesforce rules with their messages unchanged.
- `@quill/types`: `destinationFiresForPhase` reads an explicit `events` on HubSpot and Salesforce destinations too. Without one, HubSpot still fires on both phases and Salesforce on complete only, so every stored config behaves as before. A HighLevel destination without `events` fires on complete only. Google Sheets stays complete only.
- `@quill/db`: `gohighlevel` is an integration provider and an outbox kind.
- `@quill/destinations`: the factory turns a `gohighlevel` delivery into a named no-op until the adapter exists.
- `@quill/mcp`: the form config JSON Schema (the guide's `config_schema` and the skill's `form-config.schema.json`) leaves out the HighLevel destination and the `events` of HubSpot and Salesforce destinations, which the editor has no control for yet. A refusal for a provider no deployment can connect yet gets its own hint instead of the one that sends the user to whoever runs the deployment.
- `@quill/shared`: reserved HighLevel copy in English and Spanish: the provider name, the connection errors and the delivery history reasons.
