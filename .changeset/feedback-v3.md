---
'@quill/engine': minor
'@quill/db': minor
'@quill/shared': minor
---

Feedback round (V3): authored step order is now authoritative at runtime —
`runtimeSteps` no longer partitions steps into qualification-first /
lead-capture-last, so the public form renders questions exactly as ordered
in the editor (`flowGroup` continues to drive scoring exclusion only).
Per-form email template overrides: `notification_setting` gains a nullable
`form_id` (migration 0005, partial unique indexes on both dialects), repo
helpers accept a form scope, and resolution merges form → account → stock
per field. Shared i18n grows catalogs for the editor Connect tab (tracking
pixels UI), guided HubSpot mapping copy, branded confirm dialogs, the @
token picker, per-form email overrides, and localized name-step placeholder
defaults (EN + ES).
