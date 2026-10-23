# MCP sign-ins map to people through web logins, not the identity database

> Partly superseded by [0004](0004-mcp-sign-in-link-first-directory-fallback.md): the link stays and is tried first, the person directory comes back as an optional fallback that never blocks the boot, any active role connects, and staff reach any workspace again.

ADR 0001 mapped an MCP sign-in's token to a person by reading the identity service's database (the person directory), and ADR 0002 used the same database to let the deployment's staff search and enter any workspace over MCP. That made the API depend on another service's database and on a credential borrowed from another product, and a missing key in one environment kept the API from booting. We now map the sign-in the way the sibling calendars product does: the identity service's session token already carries the person's WorkOS user id (`workos_user_id`), every verified web request records it on the member it acts as (`member.idp_subject`) together with when the identity service vouched for that member (`member.login_seen_at`, the token's issue time), and the MCP door finds the token's `sub` among those members, honoring only links vouched for within `OAUTH_LINK_MAX_AGE_DAYS` and only active owners and admins. dForms reads no identity database and holds no credential for one. This supersedes the person directory in 0001 and the MCP part of 0002; everything else in them holds.

## Consequences

- A workspace counts once the person opens it in the web app, and again at least once per link window: dForms is not told when someone is removed upstream, so MCP access ends when the web's would. A sign-in that reaches no workspace gets a 403 that says to open the workspace in dForms, never a 401 that would loop the login. Stamping every membership a fresh projection confirms upstream would let one visit reach them all; it is left out to match the calendars product, and can come later.
- A person blocked in the identity service keeps MCP access until the link window lapses, because the block does not reach the authorization server that issues MCP tokens. The old directory saw a block within a minute. Closing this belongs at the source (the block revoking the person's sessions at the authorization server), which would cover every product that signs MCP clients in through it.
- Only owners and admins reach a workspace over a sign-in, as in the calendars product; a `member` uses an API key an admin creates.
- Nothing is matched by email at the MCP door. With the identity service's workspaces on (`IAM_BASE_URL`), an invitation becomes a member bound to the person through their next web visit, and opening it links it. Without them, a member that only an email ever matched is bound to nobody and is not reached over a sign-in.
- The subject and the stamp are written only on a member bound to the same person the session token names. The web switcher also matches a row by email, and a row bound to someone else who kept that address is theirs to vouch for, never the caller's.
- Staff of the deployment act over an MCP sign-in in their own memberships only. To work in a customer's workspace from an agent they enter it in the web switcher and create an API key there (0002's rule for keys still holds).
- A `sub` that two different people carry is refused rather than resolved, as the directory did.

## Considered options

- Keep reading the identity database: the dependency and the shared credential are what failed.
- Ask the identity service over HTTP with a service key for each sign-in: dForms would hold a credential that reads every person and workspace, for a mapping the session token already gives it.
- Staff search over the identity service's HTTP API with that key: same credential, and the door has no session email it can trust to judge staff. Left out; it can come back if staff need it, behind its own decision.
