# MCP sign-ins try the web login link first, then an optional person directory

ADR 0003 replaced the person directory with the link a verified web login records (`member.idp_subject`, `member.login_seen_at`), so the API would never again fail to boot over the identity database's secret. That goal holds. Running 0003 in production showed that the link alone leaves real people out: a web session opened before the release records no link until the person logs out and back in; everyone has to open the web app before connecting and again every link window; a person who is a plain `member` of a workspace cannot connect at all (and since the dashboard no longer creates API keys, has no other way in); and staff of the deployment lost the search and entry into customer workspaces that 0002 gave them and that the sibling MCP server still gives its staff. We now map a sign-in in two steps. The link comes first: when it covers every active membership the person holds in dForms, it is the answer and no identity database is read. The read-only person directory of 0001 comes second, for a person the link reaches only partly or not at all, and its answer is the full list. The directory is optional: with `IAM_DB_*` missing, incomplete or malformed the API boots, logs one warning, and maps through the link alone. Any active role connects, and staff reach any workspace through a staff access grant again, as in 0002. This supersedes in 0003 the removal of the person directory, the owner and admin only rule and the removal of staff access over MCP; the link itself, its recording on the web, migration 0026, the refusal of a subject two people carry and the bounded issuer fetches stay as 0003 decided.

## Consequences

- Boot never depends on the identity database or its secret: an incomplete `IAM_DB_*` turns the directory off with one warning, and only the link works. A directory that cannot be read at runtime is a 503 for a sign-in the link does not reach, and the linked workspaces alone for one it reaches; never a crash and never a way in.
- People who used the web app before the link existed, or not within the window, connect without visiting the web again, as long as the directory is configured. Without it, 0003's rule applies: open dForms on the web (or log out and back in), then connect again, which is what the 403 says.
- A person who is fully linked costs no identity database read. The directory is asked only when the link reaches part of the person's memberships or none, and its answer is cached per pod as before.
- A `member` connects like an owner or admin; what each role may write is decided by the same handler checks the web uses, on every call.
- Staff are judged on every request from the directory's email for the person, or from the email on their linked members. With the directory, they search the identity service's live workspaces and the ones dForms knows; without it, only the workspaces dForms already projected, which nothing can confirm are still live upstream.
- A person blocked upstream is refused within a minute when the directory is asked, but keeps the linked workspaces until the window lapses when the link covers them, as in 0003.
- Hosted deployments need the read-only identity database secret back in their configuration to get the fallback and staff search; leaving it out is safe and only narrows MCP sign-ins to the link.

## Considered options

- Revert 0003: brings back a boot that refuses without the secret, which is the failure 0003 fixed.
- Keep 0003 and stamp every membership a projection confirms: helps people who open the web app, not the ones who do not, members or staff.
- Directory first, link as fallback: every sign-in would read the identity database even for people the link already covers.
