---
'@quill/types': minor
'@quill/shared': minor
'@quill/config': minor
'@quill/db': minor
---

Optional spam protection: a human check before a form's final submit, verified by the API.

A form owner turns it on per form in the Connect tab, and it applies on Publish. It
runs on the submitting screen, the one point every way of finishing a form passes
through, in both layouts. In Automatic mode most people never see it; in Strict
mode everyone sees the check, and the API adds two checks of its own: a hidden
field no person can reach, and a minimum fill time of 2 s from the session's first
view (a session with no recorded view is never blocked).

With protection on, one rule: a partial is saved and never delivered; a complete
is verified, then saved and delivered. The submissions endpoint is public, so the
API is the gate: a complete without a valid token is refused with 403 and nothing
is written, whoever sends it. When the check cannot run (the widget fails, or the
provider is down), the answers are kept as a partial and the respondent is asked
to try again. The booking callback can no longer upsert a CRM contact for a session
that never completed, unless the booking provider itself returned the invitee.

- `@quill/types`: `formConfigSchema.spamProtection` (additive, absent is off),
  `publicFormSchema.captcha`, `submissionSchema.captchaToken` and `hp`, and
  `captchaCData`, the session stamp both halves compare.
- `@quill/config`: `CAPTCHA_SITE_KEY`, `CAPTCHA_SECRET_KEY`, `CAPTCHA_PROVIDER`
  (`none` is a kill switch) and `CAPTCHA_VERIFY_TIMEOUT_MS`, plus `captchaSettings`.
  Both keys unset is the default and means the feature does not exist; one key
  without the other refuses to boot.
- `@quill/db`: the account webhook inventory says whether the owning form has the
  switch on, and `firstSessionViewAt` reads a session's first view.
- `@quill/shared`: the respondent copy (the check's prompt, its failure and outage
  messages, and localized `RATE_LIMITED` and `ANSWER_TOO_LONG`, which respondents
  used to read in English) and the editor copy, in English and Spanish.
