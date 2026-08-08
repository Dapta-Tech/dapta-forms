---
'@quill/shared': minor
---

Split "is the growth loop on?" from "where does it point?". `growthTarget` gates
on `NEXT_PUBLIC_SIGNUP_URL` exactly as before — unset still renders no badge and
no CTA — but the destination now prefers `NEXT_PUBLIC_LANDING_URL` when the
deployment sets one. Both surfaces address a stranger, so a landing page suits
them better than a login screen.
