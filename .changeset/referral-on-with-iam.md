---
'@quill/config': minor
---

Referral program: on by default where the identity service runs. `REFERRAL_PROGRAM` is now optional: unset, the program is on exactly when `AUTH_PROVIDER=workos` and `IAM_BASE_URL` are set (the same "unset follows the deployment" rule as `PREMIUM_FEATURES`), and off for a fork or a local dev. An explicit `true` or `false` still wins, and `false` remains the kill switch. New helper `referralProgramEnabled(env)` in `@quill/config/env`.
