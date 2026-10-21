---
'@quill/mcp': minor
'@quill/config': minor
'@quill/shared': minor
---

The dForms MCP server: `POST /mcp` on the API, with the workspace API keys (`Authorization: Bearer dforms_...`).

- New `@quill/mcp` package: ten tools (`whoami`, `list_forms`, `get_form`, `create_form`, `update_form`, `publish_form`, `revert_form`, `list_responses`, `get_form_analytics`, `get_form_guide`), each with a title and the read-only, destructive, idempotent and open-world hints. No delete tools. Stateless Streamable HTTP on the official TypeScript SDK, serving 2026-07-28 clients and 2025-era `initialize` clients.
- The tools run the API's own form handlers in process, so an agent is held to every rule the web and the REST API apply: the workspace comes from the key (another workspace's form is `NOT_FOUND`), the member's current role, the strict API-key validation and the normalized config. A refused config answers `VALIDATION_FAILED` with every problem and its path. Forms created through the MCP record `created_via = 'mcp'`, and their product events carry `via: 'mcp'`.
- The door refuses anonymous requests (401 with a `Bearer` challenge), bad or revoked keys (401, never downgraded), credentials in the URL (400), browser origins outside `MCP_ALLOWED_ORIGINS` (403), a `Host` outside `MCP_ALLOWED_HOSTS` when set (403), anything but a JSON `POST` (405, 415), and a key past its bucket (429 with `Retry-After`). Write tools have a tighter bucket and every call has a timeout. One audit line per tool call, with the key prefix and a hash of the redacted arguments, never the key or any content.
- Responses come back inside `respondent_supplied`, cleaned of control characters, HTML and markdown links and cut to length. Analytics come back with the definition of every metric.
- `@quill/mcp/guide` holds the config JSON Schema, the rules and the examples, shared with the API skill zip.
- `@quill/config`: `MCP_ENABLED`, `MCP_ALLOWED_ORIGINS`, `MCP_ALLOWED_HOSTS`, `MCP_RATE_LIMIT_CAPACITY`, `MCP_RATE_LIMIT_REFILL_PER_SEC`, `MCP_WRITE_RATE_LIMIT_CAPACITY`, `MCP_WRITE_RATE_LIMIT_REFILL_PER_SEC` and `MCP_TOOL_TIMEOUT_MS`, all optional; a blank value reads as unset.
- `@quill/shared`: the setup guide on the MCP page now connects Claude Code, Codex and Cursor to the MCP server (the key in `DFORMS_API_KEY`, then each agent's entry, with a one-click link for Cursor), in English and Spanish. The skill zip stays as the way in for agents without MCP. The web app reads the address at runtime from `MCP_PUBLIC_URL`, else the public API address plus `/mcp`.
