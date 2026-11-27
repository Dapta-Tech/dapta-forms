---
'@quill/types': minor
'@quill/db': minor
'@quill/notifications': minor
---

Signing up from the resource hub: a two question onboarding and the playbook by email.

- Someone who arrives with a playbook as their return path (`/admin/playbooks/<slug>`) is asked `lead_source` and `use_case` only, whatever their cohort. Everyone else sees the wizard as before.
- `@quill/types`: `ONBOARDING_FLOWS`, `ONBOARDING_HUB_STEPS` and `onboardingSteps(cohort, flow)`. `account.onboarding` gains `flow`, and the progress and completion bodies accept `flow`; the completion also accepts `playbook` and `playbookLocale`. All optional, and a bad value reads as absent.
- The onboarding events carry `flow: "hub"` on this path. Questions it leaves out are never sent empty to the contact sync, and a signup with no IAM answer makes no IAM request.
- `@quill/db`: `enqueueOutboxOnce` (a unit of work keyed to happen once) and `isFoundingMember`. No migration.
- `@quill/notifications`: `sendPlaybookPdf`, the email in English and Spanish with a button to the playbook. It is queued once per person and playbook, for whoever founded the workspace, and only with `PUBLIC_APP_URL` set.
