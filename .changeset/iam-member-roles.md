---
'@quill/db': minor
'@quill/shared': patch
---

Member roles are fully editable from this product when the identity service is
behind a workspace, and removal follows its rule.

- Demoting an admin to member now works: the identity service replaces a
  membership's role, so "make them a member" assigns its `workspace_editor`
  system role (what the Dapta app's role dialog does when a non-admin role is
  picked). Promotion assigns `workspace_admin` as before. Both are resolved BY
  NAME from the upstream role catalog (`GET /role`, cached 5 min) because the
  ids differ per environment. Inviting as member sends the editor role too, so
  what the invitee lands with is what the inviter picked, in both apps.
- `workspace_owner` upstream reads as `admin` here (alongside `workspace_admin`).
- Making someone an owner (or un-owning them) is a 409: ownership is a
  membership TYPE upstream, not a role, and nothing this product calls transfers it.
- Removing a member is OWNER-only, the identity service's rule, on the local
  path too so a fork and an identity-backed deployment agree. Admins still
  invite, promote, demote and disable.
- `listWorkspacesForIdentity` rows carry `memberCount` (active members), for
  the workspace cards in Account settings.
- The web API client takes a per-call `{ workspace }` override so a workspace can
  be managed by id without switching into it; a 403 on an override never resets
  the cookie's workspace.
