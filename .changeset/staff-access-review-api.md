---
'@quill/api': patch
'@quill/web': patch
---

Staff access in the web app now ends when the person stops being staff, as it already did over MCP.

- The auth provider says on each request whether the person is staff (the email the session token carries, on `IAM_STAFF_DOMAINS`). The header check, the home workspace, the workspace list and `enter` ignore staff access grant rows unless it does, so someone whose email left the staff domains, or whose domain was dropped from the list, no longer enters the workspaces they reached through a grant.
- A staff access grant never holds a working API key: creating one answers 403 `STAFF_ACCESS_NO_KEYS`, and a key whose member is a grant row answers 401 `INVALID_API_KEY`. The developers page turns the create button off for staff access and says why.
- Staff entering a workspace where their own membership is disabled or pending get `MEMBERSHIP_NOT_ACTIVE` (web and MCP), with the membership left as it was; the workspace cards say why.
- `isStaffEmail` accepts only a single `local@domain` address: `evil@x.com@<staff domain>` is not staff.
- The MCP staff search over the identity database folds accents and case on both sides, under any collation.
