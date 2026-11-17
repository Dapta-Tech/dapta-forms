---
'@quill/mcp': patch
'@quill/shared': patch
---

MCP copy and contracts catch up with every destination and scheduler.

- `list_event_types` takes a required `provider` (`calendly` or `dcal`) with no default: new scheduler steps default to dCal while a step with no provider reads as Calendly, so no default fits every caller. A call without it is refused. `list_calendly_event_types` is unchanged.
- An `INTEGRATION_NOT_CONNECTED` refusal for a provider the deployment cannot connect at all (Google Sheets without a Google OAuth client) gets its own hint, on `set_destinations` and `create_form`: there is no page to hand over and no retry, so the destination is left out or switched off until whoever runs the deployment sets it up.
- Descriptions that listed only webhooks and HubSpot (`get_form`, `update_form`) now name Google Sheets and Salesforce too, and the `INVALID_API_KEY` hint no longer sends the user to a dashboard screen for API keys that is gone.
- The Tools page names Google Sheets, Salesforce and dCal in the integrations group, `list_integrations`, `set_destinations` and `list_event_types`, in English and Spanish.
