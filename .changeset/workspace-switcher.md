---
'@quill/db': minor
---

Let a person work in more than one workspace.

The data model always allowed it — uniqueness on `member` is per account, and
`inviteMember` writes a row into the INVITING account — but nothing ever read it
back. Login resolved a single row and stopped (`ORDER BY created_at LIMIT 1`), so
an invited teammate signed in and landed in their own oldest account. Every
invitation was a dead end.

`listWorkspacesForIdentity` is the query that was missing: every account where a
person holds a membership, matched on the IAM subject when there is one and on
their email address otherwise, because an invite only ever knew the address.
Invited rows are listed — an invitation you cannot see is one that does not work,
and opening it is what accepting means. Disabled rows never appear.

`findMembership` is the authorization check behind the switch, and the reason
this is safe: the workspace is named by a request header, that header proves
nothing, and membership is re-derived from the database on every request. An
account the caller has no row in is a 403 — deliberately not a quiet fall back to
their home account, because a quiet fallback puts writes into a tenant the person
did not believe they were in.
