---
'@quill/api': patch
'@quill/web': patch
---

API keys under staff access now work like Dapta's own MCP: a key is a credential of the workspace, not of the person.

- Staff in a workspace through a staff access grant (only while they are staff, judged on each request) create, list and revoke its API keys like any admin, from the Developers page or `/v1/api-keys`. The create button is on again, with a note on what such a key is. `STAFF_ACCESS_NO_KEYS` is gone.
- A key created through a grant acts as the grant's `admin` row, in that workspace only, and keeps working until someone revokes it, even after its creator stops being staff. It no longer answers 401 `INVALID_API_KEY`.
- The workspace's owners and admins see such keys in their list, marked as created by Dapta staff (`createdBy.staff` in the API), and can revoke them.
- The `api_key_created` product event carries `staff_access: true` for such a key, so adoption metrics can leave staff out.
