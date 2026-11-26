---
'@quill/db': minor
---

A referral no longer counts when the new person signs up in the referrer's own browser.

- **Web**: a random, opaque browser id in a long-lived httpOnly cookie
  (`dforms_bid`, two years), minted on the login routes and on dashboard loads,
  never cleared on logout or an account switch. Forwarded to the API in the
  `x-quill-browser` header on every server-side call, the sign-in callback's
  attribution record and referral claim included.
- **API**: the header is checked and hashed (SHA-256) on the way in. `/v1/me`
  records the hash against the person; a link claim or a teammate invite credit
  from a browser the referrer was seen in answers `{ credited: false }`, as every
  other refusal does, and sends `forms_referral_refused` with
  `{ reason: 'same_browser', referral_code, referral_source }`. A request without
  the header counts as before. A network address is never used.
- **DB**: migration `0034_referrer_browser` (both dialects): one row per person
  and browser hash, the 20 most recently seen kept. `creditReferralVerdict`
  returns why a referral was refused; `creditReferral` is unchanged.
