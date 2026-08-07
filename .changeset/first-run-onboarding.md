---
'@quill/types': minor
'@quill/db': minor
'@quill/shared': minor
'@quill/config': minor
---

First-run onboarding wizard, behind `ONBOARDING_WIZARD` (default off).

A brand-new workspace is asked three questions — role, industry, and what they
want to use Forms for — and then picks the template its first form is built from,
replacing the demo form that used to be seeded for everyone. The two are mutually
exclusive by construction: the seed only writes into an account with zero forms,
so `ONBOARDING_WIZARD` suppresses it rather than relying on operators to switch
both correctly.

- `@quill/types`: `accountOnboardingSchema` and the answer enums, the template id
  union, and the use-case → template mapping.
- `@quill/db`: migration 0011 (`account.onboarding`, `account.onboarding_completed_at`,
  backfilled so accounts that predate the wizard are never sent through it), the
  progress/claim repository, and four form templates.
- `@quill/shared`: `admin.onboarding.*` copy in English and Spanish.
- `@quill/config`: the `ONBOARDING_WIZARD` flag.

Progress is written on every step advance, not only at completion, so an
abandoned onboarding leaves a record — `account.onboarding.lastStep` joins to the
first-touch tags already on `account.attribution`, which makes drop-off per
campaign a single query.
