---
'@quill/destinations': minor
'@quill/types': patch
---

Post completed submissions to a HubSpot mirror form, so they appear as a "Form
submission" activity on the contact.

The HubSpot destination could only attach a Note. A Note is a different object:
it shows on the timeline as a note, it does not say which form produced it, and
it cannot list the properties the submission set. The activity a CRM user
recognises — "X submitted <form>", "Updated N properties", each one named — is
HubSpot's own Form object, and the only way to produce one is to have a form in
the portal and post a submission to it. That is exactly what Typeform's
integration does: its forms are all `formType: hubspot`, one per typeform.

Adds `hubspot-form.ts`: the pure builders for that mirror form and its
submissions. `mirrorFormProperties` derives the fields from the same options the
adapter builds its contact payload from, so the activity lists what the
submission actually set rather than a list kept in step by hand.

`hubspotDestinationSchema.settings` gains an optional `formGuid`, and the adapter
two options — `formGuid` and `portalId`. All additive: absent means no activity
and nothing else changes.

The shape of the create payload is MEASURED, not documented — the endpoint
rejects payloads for reasons its errors describe poorly, so each rule is pinned
by a test:

- `createdAt` is required on create, at the ROOT of the form object.
- `validation` is required on an `email` field and must be absent on a text one;
  sending `{}` on a text field is rejected.
- `single_line_text` carries any property, including an `enumeration` — the
  property's own type governs, so the mirror never mirrors a portal's picklists.

The submission is a non-throwing TAIL effect, after the contact upsert. It needs
a scope the upsert does not (`form-submissions-write`), it targets a different
host (`api.hsforms.com`), and it is not idempotent — so a thrown error would be
retried by the outbox into a duplicate activity on a contact that already
synced. A missing scope surfaces as a 403 and is reported in the delivery detail,
never retried. Partial submissions are left alone.

Not included here: creating the mirror form. That needs the database the guid is
recorded in, which this package does not have, so it belongs to the API.
