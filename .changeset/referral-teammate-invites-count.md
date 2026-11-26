---
'@quill/db': minor
---

Referral program: a new person invited as a teammate counts as a referral for whoever invited them.

- `@quill/db` adds migration 0033, a new `referral_invite` table on SQLite and Postgres: the invited address (trimmed, lowercased, unique, so the first inviter keeps it), the inviter person, the workspace and when. The identity service's invitations carry no inviter, so this is the only record of one. `creditReferral` takes `newPerson` for a caller that judged newness itself.
- `@quill/api`: inviting a teammate (`POST /v1/members`, through the identity service or locally) records the inviter while the program is on, and never fails the invite over it. When the invited address first signs in as a new person (no member row bound to them before that sign-in, staff access grants aside, whatever the age of the invite row they adopt), the inviter is credited with a referral of source `invite` and `referral_signup` is recorded with `referral_source: invite`. It runs on the workspace projection, the fallback sign-in path and local development, under the same rules as a link (no self-referral, first credit wins, one credit per person), and a failure in it never fails a sign-in.
