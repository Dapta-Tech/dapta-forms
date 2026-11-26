---
'@quill/db': minor
---

Referral program: a public lookup of the first name behind a referral code, so a landing page can greet the invitee.

- `@quill/api`: `GET /v1/public/referrals/{code}` answers `{ firstName }`, the first word of the name of the person the code belongs to, and nothing else. An unknown code, the program switched off (`REFERRAL_PROGRAM`) and a person with no name that is safe to show answer the same 404; a name that is the person's email, or the part before the @, is never shown. Rate limited and not cached, like the rest of the public surface. A landing on another origin must be listed in `CORS_ORIGINS`.
- `@quill/db` adds `getReferrerByCode` and `personNames`.
