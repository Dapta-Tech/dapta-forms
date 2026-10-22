---
'@quill/db': patch
'@quill/shared': patch
---

Staff access grants never replace a membership and never hold a working API key.

- `grantStaffAccess` only mints or reuses a grant row. A member row of the person that is not a grant (active, invited, or disabled by the workspace owner) is left untouched and the call throws the new `StaffGrantRefused` (`code: 'MEMBERSHIP_NOT_ACTIVE'`). A pending invitation by email is no longer adopted as the grant; it stays a member invite.
- `pickHomeAccount` takes `{ includeGrants: false }` to never land on a grant row.
- `findApiKeyPrincipal` returns the member's `accessGrant`; `listApiKeys` leaves out keys whose member is a grant row; a grant that becomes a real membership in `projectMemberships` has its API keys revoked.
- New catalog keys: `admin.developers.keys.staffAccess` and `admin.settings.manageErrorMembershipNotActive`, in English and Spanish.
