---
'@quill/mcp': minor
'@quill/shared': minor
---

The workspace link page through the MCP and the API reference.

- `@quill/mcp`: two tools, `get_link_page` (read only: the stored page or null, the workspace's forms, the brand kit, `public_url` and `live`) and `update_link_page` (replaces the whole page, `page: null` deletes it; destructive and open world, so the agent confirms first). Both run the REST handlers in process and any member can use them. A form button naming a form outside the workspace answers `NOT_FOUND` instead of being dropped. The catalog now has 49 tools.
- `@quill/shared`: `GET /v1/link-page` and `PUT /v1/link-page` in `API_REFERENCE` under a new `linkPage` area, their EN and ES docs prose and Tools page copy, and `linkPageUrl()` for the page's public address.
