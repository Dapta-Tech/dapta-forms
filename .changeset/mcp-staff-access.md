---
'@quill/mcp': minor
---

Staff of the deployment can work in any workspace over an MCP connection.

- `McpConnection.staff` (`McpStaffAccess`): set by the host only when the person is staff on that request. `search(query, limit)` finds workspaces of the whole deployment; `enter(workspaceId)` returns a caller for a workspace the person is not a member of (through a staff access grant), or null. `McpCaller.access` is `'staff'` for such a caller.
- `resolveWorkspace` is now async. Staff always name a workspace (`WORKSPACE_REQUIRED` otherwise, even with one of their own); a `workspace_id` outside their own goes through `staff.enter`, and one no live workspace has answers `NOT_FOUND`. People who are not staff, and API keys, behave exactly as before.
- `list_my_workspaces` takes `search` and `limit` (default: every workspace that applies; the result says how many were left out). Each workspace carries `account_name` and `access` (`member` or `staff`), and the result says whether the person is `staff`. For staff, `search` covers every workspace: at least 3 letters or digits (`SEARCH_TOO_SHORT` otherwise), at most 20 results, never the full list. `whoami` says `staff` too.
- A result acted in through staff access names its workspace with `access: 'staff'` and starts `In workspace "<name>" (staff access):`; its audit line carries `via: 'staff_grant'`.
- The server instructions, `whoami`, `list_my_workspaces` and the guide tell the agent to confirm the workspace with the user before the first call that reads or changes anything in it, even when only one matched.
- Every tool of the catalog, the parity tools included, resolves its workspace the same way, so staff can use all of them in a workspace they are not a member of.
- `whoami`'s `member` now carries every field `GET /v1/me` documents: `status` and `locale` join `id`, `name`, `email` and `role`. `WhoAmI` gains `status` and `locale`.
- New exports: `normalizeWorkspaceSearch`, `STAFF_SEARCH_MIN_CHARS`, `STAFF_SEARCH_MAX_RESULTS`, `STAFF_WORKSPACE_HINT`.
