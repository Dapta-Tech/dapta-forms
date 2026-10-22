---
'@quill/api': patch
---

The MCP backend implements the rest of the API reference by running each REST route's own handler in process, so a tool gets the route's account scope, role check, validation and secret masking. Every handler it reaches is checked against the API-key route allowlist at boot. Deleting a form, a folder or a response through the MCP reads it first, so an id outside the workspace answers NOT_FOUND instead of a silent success. A spec walks `API_REFERENCE` and fails when a documented route has no MCP tool.
