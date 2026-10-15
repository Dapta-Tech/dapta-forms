---
'@quill/db': minor
'@quill/shared': patch
---

API v1 follow-ups from the review of the second wave.

- With an API key, any config the editor produces can be read with `GET /v1/forms/:id` and saved back unchanged with `PUT`: `message` and `scheduler` steps may have a blank title, like `reveal` (the editor saves them that way), and `branding.clientLogos` and a slider's `sliderUnitLabel` pass when they equal what the form already stores, so a brand kit changed after the form was made, or a template's slider unit, no longer breaks the round trip. Legacy fields still answer `UNSUPPORTED_FIELD`.
- The "Customer feedback" template carries its processing screen as a reveal step, the shape the builder edits, instead of the legacy form-level reveal.
- A key follows its member: disabling or removing a member, or the identity service marking them inactive or no longer listing them, revokes their API keys in the same transaction. Reactivating the member does not bring the old keys back, and `GET /v1/api-keys` never lists the keys of a member who is not active. `@quill/db` gains `runAtomically` and `revokeKeysOfInactiveMembersSql`.
- The "How to use the API" section of the Developers page (EN and ES) explains error paths with the body prefix, the editor defaults a key may send back, that `PUT /v1/forms/:id` ignores `destinations`, and that a revert takes no body, answers 200 with the form and that every form carries `previousPublishedAt`.
