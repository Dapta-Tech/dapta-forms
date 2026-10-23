---
'@quill/api': patch
---

An MCP sign-in (`MCP_OAUTH_PROVIDER=workos`) now tries the link a verified web login records first and, for a person that link covers only partly or not at all, the read-only person directory again (docs/adr/0004).

- **Link first.** When the link covers every active membership the person holds, it is the answer and no identity database is read.
- **Directory fallback, optional.** `PersonDirectory`, its identity database adapter, its per-pod cache and `IAM_DB_SSL_CA` are back. With `IAM_DB_*` missing, incomplete or malformed the API boots, logs one warning, and maps through the link alone; nothing about the directory refuses a boot any more. A directory outage is a 503 for a sign-in the link does not reach, and the linked workspaces alone for one it reaches.
- **Any active role connects** (owner, admin or member); write permissions are still the per-tool role checks.
- **Staff** (`IAM_STAFF_DOMAINS`, judged on every call from the directory's email or the email on the person's linked members) search and enter any workspace through a staff access grant again. Without the directory, only workspaces dForms already projected.
- A sign-in that reaches nothing gets a 403 that says to open dForms on the web, or log out there and back in, then connect again; refusals log `not_linked`, `no_workspace` or `ambiguous`.
