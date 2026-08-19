---
'@quill/web': minor
'@quill/api': patch
'@quill/db': patch
'@quill/shared': patch
---

Account settings names workspaces by the same id the Dapta app does.

- `/admin/account/workspaces/<id>` now carries the identity service's workspace id when the workspace was projected from one (the local account id otherwise). Both ids are accepted; a link with the local id of a projected workspace redirects to the canonical one.
- The workspace page shows that id in its header with a copy control, so support threads, the admin panel and the two apps all name a workspace the same way.
- Workspace rows (`GET /v1/workspaces`, the search) carry `workspaceId` (the upstream id, null for local-only accounts) next to `accountId`; the API itself still speaks `accountId` everywhere.
- Account settings, Workspaces: the deployment's staff search the whole estate from the cards page too, the same way the rail switcher does; estate workspaces appear under their own heading with Open only.
