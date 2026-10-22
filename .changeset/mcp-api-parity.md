---
'@quill/mcp': minor
---

The MCP serves every route the API docs page documents: 35 new tools beside the first eleven, one per route of `API_REFERENCE`.

- Forms: `set_form_slug`, `duplicate_form`, `move_form`, `delete_form`. Folders: `list_folders`, `create_folder`, `rename_folder`, `delete_folder`. Destinations: `set_destinations`, `ping_webhook`.
- Responses: `get_response`, `get_response_file` (a short-lived link, never the bytes), `export_responses_csv` (the CSV text, capped by `max_rows` and 100,000 characters, with `truncated`), `delete_responses`, `delete_response`, `list_deliveries`. Analytics: `get_form_summary`, `get_response_facets`, `search_answers`.
- Brand kit: `get_brand_kit`, `update_brand_kit`, `apply_brand_kit`, `revert_brand_kit`. Notifications: `list_notifications`, `update_notification`, `reset_notification`, `list_form_notifications`, `update_form_notification`, `reset_form_notification`. Integrations, read only: `list_integrations`, `list_webhooks`, `list_hubspot_properties`, `list_calendly_event_types`. Identity: `get_my_profile`, `get_workspace_link_code`.
- Deletes, resets, `set_destinations` and the brand kit apply and revert carry `destructiveHint`, and their descriptions tell the agent to name what will change and wait for the user's yes. A 404 names what was missing (form, folder, response, file, question), and `NAME_TAKEN`, `SLUG_TAKEN` and `NO_WEBHOOK` say what to do next.
- Text from the public (answers, file names, delivery bodies, the summary's latest answers) comes back cleaned under `respondent_supplied` or `untrusted`. The audit line redacts the new content-bearing arguments too.
- `ApiParityBackend` is the port for these routes; `FormsBackend` extends it. `CATALOG` is what the server registers (the core `TOOLS`, then `PARITY_TOOLS`), and `API_ROUTE_TOOLS` maps each documented route to its tool, with `API_ROUTE_EXCLUSIONS` (empty) for any left out on purpose.
- The server instructions and `get_form_guide` mention the new tools, the confirm-first rule and the owner and admin routes.
