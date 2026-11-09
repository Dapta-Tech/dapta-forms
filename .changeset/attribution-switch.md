---
'@quill/shared': minor
'@quill/db': minor
'@quill/types': minor
'@quill/config': minor
'@quill/notifications': minor
---

Paying Dapta AI workspaces can turn off the "Made with dForms" attribution.

**One rule.** `showAttribution` in `@quill/shared` decides, from the
workspace's choice and its cached paid verdict: the attribution is hidden only
when the workspace asked for it and the deployment runs `PREMIUM_FEATURES=open`
or the verdict reads paid and is under `ATTRIBUTION_VERDICT_MAX_AGE_MS` (30
days) old. A stale verdict fails closed: the attribution shows again until a
member opens dForms. The deployment rule (`NEXT_PUBLIC_SIGNUP_URL`,
`NEXT_PUBLIC_HIDE_BADGE`) still applies on top.

**Data.** Migration 0028 adds `account.hide_attribution` (0/1, default 0, so
every existing workspace keeps showing it), `account.dapta_paid` (1/0, null
until seen) and `account.dapta_paid_checked_at`. The choice and the verdict are
kept apart, so a lapsed subscription keeps the choice and brings the
attribution back on its own. `getAttributionSwitch`, `setHideAttribution` and
`cacheDaptaPaid` read and write them; a projected membership (and a staff
grant) can carry `paid`, which is written with the time of the read, and a
read without one keeps the old verdict.

**Payloads.** `PublicForm` and `PublicLinkPage` gain an optional
`showAttribution`; absent reads as shown, exactly as before.

**Emails.** `SubmissionNotifier.sendSubmissionReceived` and
`sendSubmissionConfirmed` take an optional `{ growthCta: false }` that sends
the email with no growth button and no text line, decided at send time.

**Config.** `PREMIUM_FEATURES` is optional now. Read it through
`vanityPremiumMode` (unset is `open`, as it always was) or
`attributionPremiumMode` (unset is `locked` when `iamWorkspacesEnabled`, that
is `IAM_BASE_URL` with `AUTH_PROVIDER=workos`, else `open`).

**Copy.** `admin.attributionSetting` (the Brand kit row) and
`admin.editor.design.badgeSizeHiddenHint`, in English and Spanish.
