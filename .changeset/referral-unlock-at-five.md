---
'@quill/db': minor
'@quill/shared': minor
---

Referral program: 5 referrals unlock hiding the "Made with dForms" badge, for life.

- `@quill/db` adds migration 0032, a nullable `account.hide_attribution_chosen_at` on SQLite and Postgres: when the workspace last saved the attribution switch (either way), NULL when it never did. `setHideAttribution` stamps it. New helpers `markReferralUnlocked`, `applyReferralUnlock` and `isAccountReferralUnlocked`. A workspace created for a referral-unlocked owner (projection or local create) starts hidden.
- `@quill/api`: the referral that brings a person to 5 sets `referrer.unlocked_at` once, hides the badge on every workspace they own that never chose, and sends `referral_unlocked`. `ReferralService.afterCredit` is the one hook every referral source calls. The badge rule's referral source is real: a workspace is unlocked when any of its owners holds an unlock, with no expiry, next to the paid verdict, so the public form, link pages, `/v1/me.attributionBadge` and the emails all obey and `PUT /v1/account/attribution-badge` accepts hiding it. `GET /v1/me` adds `referral.unlocked`; `GET /v1/account/attribution-badge` adds `referralUnlocked`. A refusal keeps the `DAPTA_SUBSCRIPTION_REQUIRED` code.
- `@quill/web`: while locked and the program is on, an owner sees "Invite 5 or pay for Dapta AI" under the badge switch in Brand kit and in the form's Design panel, with a replica of the badge, a progress bar and their link with a copy button. Unlocked by a referral, the switch works and says why.
- `@quill/shared` adds the EN and ES copy, and the Spanish share dialog names the badge «Hecho con dForms».
