# @quill/destinations

## 0.1.0

### Minor Changes

- d69e261: HubSpot date writes now follow the target property's type. A shared destination-level `dayTimezone` (IANA zone, blank = UTC) names the calendar day for every `date`-type property the destination writes (the submitted date and the booking date), while `datetime`-type targets receive the exact instant and never use it. The submit-time adapter takes `datePropertyType` and `dayTimezone` options, a meeting-time property that turns out to be `date`-typed gets the meeting day instead of a value HubSpot rejects, and the shared `dayMidnightMs`/`utcMidnightMs` helpers move into `@quill/destinations`. The editor reveals a searchable timezone picker beside each date-type pick, all instances editing the one shared value; `bookingSync.dateTimezone` remains as the read fallback so stored configs keep their zone.
- 9b42f40: Every integration carries its own delivery log, and a delivery can be read back.

  **The failure list was loud in the wrong place.** The Connect tab rendered one
  flat "Deliveries that did not land" block, sitting loose between the integrations
  and Tracking and mixing all four outbox kinds. It answered "something is broken"
  without answering "which of these three integrations", and on a form with a dead
  endpoint its retries pushed Tracking and Emails off the screen — the diagnosis
  was louder than everything it was diagnosing. Each card now owns its history, so
  the reason a webhook is failing is read beside the URL that is failing.

  The log does not live _inside_ the card either. A card is a settings form, and
  twenty-five rows of history in the middle of one buries the endpoint URL the
  reader came for. The card carries a single line — a count, red when something
  failed — and the log opens in a dialog where a long list is free to be long.

  **It is a history, not a failure list.** The queue never deleted its `done` rows;
  nothing had ever asked for them, so a webhook that works and a webhook that has
  never fired looked identical. `listFormDeliveries` takes `kinds` and `statuses`
  (defaulting to the original failures-only answer, so existing callers are
  unaffected), and the `kinds` filter runs in SQL — which is what makes asking for
  landed rows viable at all, since they are most of the table. A new
  `(account_id, kind, updated_at)` index serves that read; the only index this
  table had served the worker's opposite question.

  **Deliveries can now be read back.** Three nullable columns record the request
  body actually sent and the status and body that came back. The enqueued `payload`
  is not those bytes, and only those bytes answer the question every webhook
  debugging session opens with. `NULL` means NOT RECORDED — an older row, or a kind
  whose adapter has no single request to report — never "an empty body was sent".
  Both bodies are truncated on write. An attempt that reports no transcript leaves
  the stored one alone, so the last retry of a host that stopped resolving cannot
  erase what the endpoint used to say.

  **Test deliveries are listed.** The admin's "Send test" is synchronous and never
  passed through the queue, so the log stayed empty during exactly the session it
  exists to help — wiring up an endpoint, when the test is often the only delivery
  that has run. It is a real signed POST, so it is recorded, badged as a test, and
  written already-terminal so the worker can never send it a second time.

  **Email rows can be attributed to a form.** `SubmissionNotification` never
  carried `formId` — it was used to resolve the template and then dropped — so no
  email delivery could be traced to the form that sent it. Additive; rows enqueued
  before this stay unattributable.

- bd31b39: Post completed submissions to a HubSpot mirror form, so they appear as a "Form
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

- a6b7fcf: Pilot-port feature set: per-outcome booking embeds (HubSpot Meetings / Calendly) with a booking callback and durable booking→CRM sync via the outbox; answer-forced outcome overrides; reveal screen duration/subtitle templates/prewarm; per-form tracking config (GTM, Meta Pixel, PostHog, HubSpot); HubSpot destination value maps, outcome property, static properties, company inference and bookingSync; draft→publish workflow (form.draft_config/published_at, additive migration 0003 + booking_event table); respondent confirmation email wiring; normalizeConfig now preserves additive top-level config fields; i18n EN+ES for all new surfaces.
- 310f098: Say why a webhook test delivery failed.

  The toast read `Test failed: webhook delivery failed: HTTP 400` — true, and
  useless. A status code alone sends the author to check the wrong thing.

  `WebhookHttpError` now carries the status and a truncated copy of the endpoint's
  own response body, which names the real reason far more often than the code does.
  Its `message` is byte-identical to what the adapter always threw, because the
  outbox stores that string and two tests assert on it — it is a contract, not
  prose.

  The classification is deliberately conservative. Only 405/501 lets us state that
  POST is refused, because that is the one status which actually says so. A 400
  means the endpoint read the request and rejected the body; claiming the method
  was wrong there would be right often enough to be trusted and wrong often enough
  to waste an afternoon. So 4xx copy states what we send — POST, `application/json`
  — and lets the endpoint's own message do the rest.

### Patch Changes

- 98e0a3b: Let the mirror-form submission be what SETS the contact's properties, so the
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

- 9779aac: Score-sourced visibility conditions: a show/hide rule can reference the reserved
  `@score` source (the running score over the steps before the one being decided),
  offered in the builder as "Score so far" with numeric operators. Adds the public
  form title (`config.title`, additive) resolved everywhere through the new
  `publicTitle()` helper, surfaces it in the profile listing, and corrects the
  destination port's idempotency-key documentation.
- Updated dependencies [310f098]
- Updated dependencies [bb7077e]
- Updated dependencies [67bd1e2]
- Updated dependencies [310f098]
- Updated dependencies [d69e261]
- Updated dependencies [9b42f40]
- Updated dependencies [e50736f]
- Updated dependencies [e877d55]
- Updated dependencies [b8322ea]
- Updated dependencies [310f098]
- Updated dependencies [bd31b39]
- Updated dependencies [036d5fd]
- Updated dependencies [f7875dc]
- Updated dependencies [daaabf2]
- Updated dependencies [de8df64]
- Updated dependencies [310f098]
- Updated dependencies [c6007cb]
- Updated dependencies [bfece62]
- Updated dependencies [7b087af]
- Updated dependencies [310f098]
- Updated dependencies [a6b7fcf]
- Updated dependencies [72a7876]
- Updated dependencies [310f098]
- Updated dependencies [9779aac]
- Updated dependencies [cf9eb95]
- Updated dependencies [d85aeb5]
- Updated dependencies [8e84fcf]
- Updated dependencies [310f098]
- Updated dependencies [310f098]
  - @quill/types@0.1.0
