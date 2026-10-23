---
'@quill/db': patch
'@quill/config': patch
---

The link an MCP sign-in maps through, in both dialects (migration 0026, additive): the nullable `member.idp_subject` (the external authorization server's user id, one member per account) and `member.login_seen_at` (when the identity service last vouched for the member at a verified web login), with `recordMemberIdpSubject`, `noteMemberLogin`, `memberIdpLink` and `membershipsBySubject` to write and read it. The SQLite `txn` handle takes `{ immediate: true }`. The config adds `OAUTH_LINK_MAX_AGE_DAYS` (30 by default, 1 to 365) and drops the `IAM_DB_*` settings.
