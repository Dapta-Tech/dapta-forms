---
'@quill/shared': minor
'@quill/web': patch
---

A "Dapta Agents" door in the admin rail, and the public badge signs itself as
Forms again.

**The attribution pill reads "Made with Dapta Forms" and draws the Forms `F`.**
Copy and mark move together (`growth.madeWith` in both locales, `BrandMark` in
`made-with-badge.tsx`), and so does the destination: the published image now
defaults `NEXT_PUBLIC_LANDING_URL` to the Forms landing on the platform's site,
with the trailing slash the host requires to keep the query string. The pill's
`utm_medium` is `form-button` (was `badge`); the thank-you CTA keeps
`confirmation`. Reports filtering on the medium have to accept both spellings
across the release date. Nothing changes for a fork: the loop is still gated on
`NEXT_PUBLIC_SIGNUP_URL` and hidden by `NEXT_PUBLIC_HIDE_BADGE`.

**"Dapta Agents" in the admin nav.** Last item of the rail, on every viewport
(expanded, 64px collapsed, mobile drawer), rendered only when the deployment
sets `NEXT_PUBLIC_PLATFORM_URL`, so a fork's rail carries no dead item. It is a
plain anchor to a new tab with the same trailing arrow as the app-switcher rows,
never `aria-current`, tagged `utm_source=forms&utm_medium=sidebar` through the
new `lib/suite.ts` helper that the app-switcher now shares. The switcher's
first row is renamed to "Dapta Agents" too, so one destination has one name.

The confirmation CTA drops its em dash ("Get Dapta Forms, free").
