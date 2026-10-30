# Staff reach any workspace over an MCP sign-in, judged on the token's verified email

ADR 0003 left staff of the deployment with only the customer workspaces they had opened on the web as staff within a day, because the MCP door had no email it could trust to judge staff, and reading the identity database or holding a credential that reads every person were the things that had failed. Staff need to work in any customer's workspace from an agent without opening the browser first. The token can carry the trusted email itself: AuthKit renders a JWT template into every access token it issues, MCP clients registered through dynamic client registration included, so the deployment adds `"email": {{ user.email }}` and `"email_verified": {{ user.email_verified }}` to the template, and the issuer signs them with the rest of the token.

## Decision

- **Staff is judged on the token.** A sign-in is staff on a request when its access token carries `email_verified: true` (the boolean) and an `email` whose domain is exactly one of `IAM_STAFF_DOMAINS` (`isStaffEmail`, the rule the web applies). An unverified address never counts: anyone can sign up to AuthKit with an address they do not own. A token without the claims (no template, an older token) is not staff, exactly as before. The email decides staff and nothing else: members are still mapped through the subject only.
- **Only next to an active membership of the person's own**, as ADR 0003's grants. A person with no linked, active member anywhere connects and acts nowhere, staff or not.
- **Search reads this database only.** `list_my_workspaces(search)` finds the accounts dForms already knows, by workspace name, a member's email or a form's name (`searchProjectedAccounts`, the web switcher's local source), named by the identity service's workspace id. Only accounts the identity service owns and the projection confirmed at least once (`synced_at`) are listed or entered: a local-only account (`dev:`, `local:`, `legacy:`, none) is never one. Workspaces that never opened dForms are not found; they have no forms to act on.
- **Entry is the web's grant.** Naming a workspace the person is not a member of acts as the `admin` row `grantStaffAccess` mints or finds (`access_grant = 'staff'`). A membership of the person's own there that is not active (disabled, removed, an invitation) is never replaced: `MEMBERSHIP_NOT_ACTIVE`. A workspace of their own is entered as that member.
- **Unchanged from 0003**: no identity database and no shared credential; staff workspaces are never used without `workspace_id` (staff name the workspace on every call); every staff call says `access: 'staff'` and its audit line carries `via: 'staff_grant'`, and each entry logs `mcp.staff_access`; an ambiguous subject is refused; the rate-limit bucket never picks a staff workspace implicitly. The day-long grants a staff web visit stamps keep working for tokens without the claims.

## Consequences

- A person who stops being staff loses the search and every grant entered this way on their next token (AuthKit access tokens are short-lived), much sooner than 0003's day. Grant rows are never revoked, but a row is only reached while the request is staff.
- The template is environment-wide in AuthKit: every product's access tokens gain the two claims. They are additive; other resource servers ignore claims they do not read.
- Whether a workspace is live is read from this database, not upstream. A workspace deleted upstream stays enterable by staff until the projection drops it. Staff can already read that data on the web; reading upstream would need the credential 0003 rejected.
- Without the template configured, nothing changes: no token is staff over a sign-in.

## Considered options

- Ask WorkOS for the person's email with a WorkOS API key on each sign-in: a credential that reads every user, which 0003 rejected for the identity service.
- Stamp "proven staff" on the person on every staff web request and honor it for a while over MCP: still needs the browser, which is what staff asked to stop needing.
