---
'@quill/mcp': minor
'@quill/shared': patch
---

MCP tools tell the truth about integrations that cannot deliver.

- `set_destinations` reports `warnings`: every enabled entry that was saved but delivers nothing yet, because its provider is not connected or a spreadsheet entry has no sheet or no headed column. A refusal with `INTEGRATION_NOT_CONNECTED` carries the dForms integrations page, since connecting Google or Salesforce only happens in a browser. Its description now covers Google Sheets and Salesforce, with the Salesforce destination shape.
- `list_integrations` names all four providers (HubSpot, Calendly, Google Sheets, Salesforce), lists the ones not connected and the ones the deployment cannot connect (`unavailable`), and says whether the deployment has dCal.
- New `list_event_types` tool with a `provider` of `calendly` or `dcal`. Calendly event types are listed as before. dCal event types need a signed-in Dapta session, which no MCP credential carries, so `dcal` answers with that reason and the editor as the place to pick the event. `list_calendly_event_types` keeps working unchanged under its first name.
- The form guide documents `dcal` as a scheduler provider and says new scheduler steps default to it.
- The API docs describe the new refusal and the `unavailable` and `dcal` fields of `GET /v1/integrations`.
