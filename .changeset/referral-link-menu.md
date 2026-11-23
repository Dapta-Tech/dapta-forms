---
'@quill/api': minor
'@quill/web': minor
'@quill/db': minor
'@quill/shared': minor
---

Referral program, first step: a personal referral link, off by default behind `REFERRAL_PROGRAM`.

- `@quill/db` adds migration 0030, a new `referrer` table on SQLite and Postgres keyed by the person (not the workspace), with a unique short random code and empty columns for the program's later steps.
- `@quill/api`: with `REFERRAL_PROGRAM=true`, `GET /v1/me` carries `referral: { enabled, link, count, goal }`, the same link in every workspace the person belongs to. The link points at the landing when the deployment has one, else the app, as `/?ref=<code>`. The person's code is created the first time it is asked for. Off, or with no URL to link to, it is `{ enabled: false }` and nothing is stored.
- `@quill/web`: an "Invite friends" entry in the left menu with the progress (0/5), opening a dialog with the link, a copy button and sharing to WhatsApp, email and X with the message already written in English or Spanish. Product analytics records `referral_link_copied` and `referral_link_shared` with the channel.
- `@quill/shared` adds the referral link and share-link builders and the EN and ES copy.
