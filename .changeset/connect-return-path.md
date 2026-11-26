---
'@quill/web': minor
---

The campaign entry takes a destination, so a link from the landing lands on the page it promised (the API keys, the API docs, a playbook) even for someone who has no account yet.

- `app.dforms.ai/?next=/admin/developers/keys` (or `/admin/developers/docs`, `/admin/playbooks`, `/admin/playbooks/<slug>`): signed in, it goes straight there. Signed out, the destination rides through the hosted login (parked in the httpOnly `quill_next` cookie for 30 minutes) and the callback lands on it instead of `/admin`. On a first visit the onboarding wizard ends there instead of on the form it created, and that is where the cookie is spent.
- The campaign tags, the referral code and the landing's PostHog id still travel exactly as before.
- Only a plain dashboard path is accepted (`/admin` and below, at most 200 characters; no host, no scheme, no query, no `..`), so the parameter cannot be used as an open redirect. A login that asks for no destination, or for one it refuses, clears an old one.
