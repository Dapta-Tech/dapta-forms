---
'@quill/api': minor
'@quill/web': patch
---

Referral program: a campaign window. `REFERRAL_CAMPAIGN_ENDS_AT` (optional, an ISO 8601 date-time with a time zone such as `2026-12-31T23:59:59Z`) sets when the campaign ends; unset means no end, and any other value refuses to boot. `GET /v1/me` carries `referral.campaignActive`: true while now is before the end, or when none is set. The link, the count and the menu entry stay after the campaign ends; only campaign-scoped surfaces (the top banner, the reminder email) key off the flag. Switched off, the block is still `{ enabled: false }`.
