---
'@quill/types': minor
'@quill/engine': minor
'@quill/shared': minor
'@quill/db': minor
'@quill/notifications': minor
---

Feedback round (V2): graceful variable interpolation (sweeps orphaned
punctuation when a `[field]` resolves empty); country-code phone input
(bundled ISO 3166-1 data + E.164 value + subscriber-digit validation);
branded admin dropdown combobox; account-level integration connect flow with
AES-256-GCM encrypted-at-rest token storage (`account_integration` table,
migration 0004, per-account token resolution with env fallback); Typeform-style
per-form HubSpot mapping with smart auto-map; editable notification email
templates (subject/body with `{{token}}` interpolation, escaped); webhook
per-event triggers (`events: partial|complete`); soft banner styling; HubSpot
booking-embed fallback.
