---
'@quill/destinations': patch
---

Let the mirror-form submission be what SETS the contact's properties, so the
"Form submission" activity lists them instead of reading "Updated 0 properties".

HubSpot reports, on that activity, the properties the submission changed. The
delivery upserted every mapped value through the CRM API and only then posted the
same values to the mirror, so the post changed nothing: the card appeared, named
the form, and listed nothing — strictly worse than the note it was built to
replace. Typeform's integration never touches the CRM API; the submission is the
write, which is why its cards list fields.

When a mirror is configured, the upsert is now cut back to the contact's key and
the values ride in on the post. The upsert still runs, and still runs FIRST: it
is the retryable half of the delivery, it guarantees the contact exists even if
the portal refuses the post, and the note needs its id.

Three things had to stay true, and each is pinned by a test:

- a refused post falls back to the full upsert, so a portal missing
  `form-submissions-write` never silently costs an author their mappings. That
  write may throw — no activity was created, so a retry cannot duplicate one.
- nothing retryable follows a SUCCESSFUL post. The properties the mirror does not
  declare (`company`/`website` from `inferCompanyFromEmail`) are written after
  it, best effort: losing an inferred company beats retrying a delivery into a
  second card on a real contact's timeline.
- a form with no mirror, and every partial submission, behave exactly as before —
  one upsert carrying everything.
