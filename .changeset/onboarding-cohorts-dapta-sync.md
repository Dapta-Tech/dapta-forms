---
'@quill/types': minor
'@quill/db': minor
'@quill/shared': minor
'@quill/config': minor
---

Cohort-aware onboarding wizard + Dapta-estate sync.

- `@quill/types`: the onboarding blob and steps grow `phone`, `crm`,
  `lead_volume`, `lead_source`, a `cohort` (`cold`/`dapta`) and per-answer
  `sources`; the industry enum becomes the IAM's 52-value bank.
- `@quill/db`: migration 0012 rewrites stored industry answers to the new
  bank (a stale enum value would otherwise take the whole blob down on read);
  new outbox kind `dapta_sync`.
- `@quill/shared`: EN/ES copy for the new questions.
- `@quill/config`: optional `IAM_BASE_URL`, `IAM_API_KEY`,
  `DAPTA_SYNC_FLOW_URL`, `DAPTA_SYNC_FLOW_KEY` (all unset = feature off).
