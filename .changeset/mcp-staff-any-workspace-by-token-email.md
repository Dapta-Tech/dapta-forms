---
'@quill/api': minor
---

Staff of the deployment reach any customer workspace over an MCP sign-in, without opening the web first, when their access token carries a verified email on `IAM_STAFF_DOMAINS` (AuthKit JWT template: `email`, `email_verified`). `list_my_workspaces(search)` finds every synced workspace by name, member email or form name, and naming one enters it through a staff access grant, always named and audited as staff. Unverified emails never count; tokens without the claims behave as before (docs/adr/0004).
