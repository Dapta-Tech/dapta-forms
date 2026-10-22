---
'@quill/db': patch
'@quill/shared': patch
---

API keys a staff access grant holds are a workspace's keys like any other.

- `listApiKeys` lists keys whose member is a staff access grant row, with the new `createdBy.staff: true`.
- A grant that becomes a real membership in `projectMemberships` keeps its API keys: they become that member's keys, with the member's role.
- `findApiKeyPrincipal`'s `accessGrant` is informational now: a grant's key authenticates.
- New catalog key `admin.developers.keys.createdByStaff`; `admin.developers.keys.staffAccess` now explains what a key created through staff access is, in English and Spanish.
