---
'@quill/mcp': patch
---

Staff workspace search and workspace results, from end-to-end QA:

- A staff search names each workspace by one id, the identity service's, before and after dForms first projects it. It used to switch to the local id once the workspace had been used, so the same workspace showed up under a new id, which read as a different workspace with the same name. Either id still works as `workspace_id`.
- Every search result says why it matched (`matched_on`: `name`, `account_name`, `member_email` or `form_name`), so a workspace found by a member's email no longer looks like a wrong hit.
- `list_my_workspaces` says `truncated: true`, with a `next_step` to narrow the search, when more workspaces matched than it shows.
- Every result's `workspace` carries `access` (`member` or `staff`), `whoami` included, and `whoami` always has a `next_step`.
- `WORKSPACE_REQUIRED` and `NOT_FOUND` say "staff of this deployment" once.
