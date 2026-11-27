---
'@quill/db': minor
'@quill/types': minor
---

Referral program, second step: a signup through a referral link counts.

- `@quill/types`: `ref` joins the signup attribution allowlist, stored as `referralCode`, so a referral link rides the root page hand-off and the login cookie like the UTMs.
- `@quill/db` adds migration 0031, a new `referral` table on SQLite and Postgres: the referee person (unique, so the first credit wins), the referrer person, the source (`link` or `invite`) and when. Rows are never deleted.
- `@quill/api`: `POST /v1/me/referral/claim` credits the caller to the owner of a code. Any role may call it; API keys may not. It credits only a new person (their first membership, staff access grants aside, is under 10 minutes old), never a self-referral (same person or same email), never an unknown code and never a person already credited, and every refusal answers `{ credited: false }`. `GET /v1/me.referral.count` is now the real count. A credited claim records `referral_signup` with the code, and sets `referred_by` on the invitee.
- `@quill/web`: the sign-in callback sends a parked `ref` to the claim after the attribution record, and never fails the login over it. The dashboard sets `referral_code` on the person while the program is on.
