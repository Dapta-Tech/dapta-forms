---
'@quill/api': patch
---

MCP connections of the deployment's staff reach every workspace, the way the web app's switcher lets them.

- Staff is the switcher's rule, now one shared pure function (`isStaffEmail`): the email's exact domain is on `IAM_STAFF_DOMAINS`. Over MCP the email is the person directory's (the identity service's user row), never the request's. It is judged again on every request, so a person who stops being staff loses every workspace they reached through a grant on the next call, although grant rows are never revoked.
- `list_my_workspaces(search)` for staff searches the accounts dForms already knows (`searchProjectedAccounts`) and the identity service's live workspaces, read from its database by the person directory (new `workspaceOf` and `searchWorkspaces`; one workspace by id is kept a minute per pod).
- A staff call into a workspace where the person is not a member checks the workspace is live (and that the identity service does not already name them a member there: `MEMBERSHIP_NOT_SYNCED`, open it once in dForms), then reuses `grantStaffAccess` (an `admin` row with `access_grant = 'staff'`, the switcher's) and acts as it, read and write. Each such call is logged (`mcp.staff_access`, `channel: 'mcp'`, `via: 'staff_grant'`).
- API keys and people who are not staff are unchanged.
