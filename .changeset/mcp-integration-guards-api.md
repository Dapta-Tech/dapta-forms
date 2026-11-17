---
'@quill/api': patch
---

`PUT /v1/forms/:id/destinations` no longer silently stores a Google Sheets or Salesforce destination that delivers into nothing. With an API key or an MCP connection, a new or changed enabled entry whose provider the workspace has not connected answers 400 `INTEGRATION_NOT_CONNECTED` with `integrationsUrl`, the absolute integrations page. An entry identical to the stored one is kept, so an unrelated edit on a form whose connection was removed still saves. A browser session is never refused, because the Connect tab saves a card switched on before its provider is connected. Every such entry, and a spreadsheet entry with no sheet yet, is listed in a new `warnings` field of the answer.
