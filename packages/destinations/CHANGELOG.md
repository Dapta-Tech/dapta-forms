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

- 7eea7be: Record the page a form is answered on, and pass the landing's HubSpot visit along with it.

  An embedded form used to reach HubSpot without the visitor's tracking cookie
  (`hubspotutk`) and without the page it sat on, so the contact lost its original
  source and its earlier page views; it even lost the landing's UTM parameters,
  since the iframe only reads its own fixed `src`. The host page's `embed.js` can
  read all of that, and now answers when the form asks for it: at mount, and again
  right before each partial and complete submit, so the cookie is the one current
  at that moment. A bare iframe, or an old cached script, costs the submit at most
  150 ms and saves with the referrer as the page; a page that sets
  `data-dapta-forms-context="off"` on the iframe passes nothing. The script reads
  cookies and never writes one, leaves the cookie out when the visitor opted out of
  HubSpot tracking, and answers only our frames, at the origin of their `src`.

  On a direct link the page is the form's own URL without its prefill parameters,
  and the form's own `hubspotutk` goes along when the form loads its own HubSpot
  tracking ID.

  - `@quill/types`: `submissionSchema.visit`, a tolerant `submissionVisitSchema`
    (every field is checked on its own and dropped when it fails; a malformed visit
    never refuses a submission), `parseSubmissionVisit`, and the dashboard's safe
    view, `submissionVisitViewSchema` / `toSubmissionVisitView`, which carries a
    "HubSpot cookie received" flag (`hubspotCookie`) and never the cookie.
    `submissionViewSchema` gains `visit`.
  - `@quill/db`: migration 0023 adds the nullable `submission.visit` column in both
    dialects. `upsertSubmission` stores it with COALESCE, so a later save without a
    visit keeps the one already stored, and returns the merged row. The dashboard
    read side maps it to the safe view.
  - `@quill/destinations`: `DestinationContext.visit` (the contract's
    `SubmissionVisit`), and `formTitle`, the public title that names a page which
    reported none. The HubSpot mirror submission
    sends `hutk`, `pageUri`, `pageName` and `pageId` as its context, leaves out any
    empty key, and after a 400 retries once with the context it always sent; the
    Note names the page, the delivery detail says `+visit`, the cookie never
    reaches a log, and a cookie from another portal is reported. The webhook
    envelope gains a top-level `visit` (`pageUri`, `pageName`, `embedded`, and
    `hutk` when there is one), covered by the signature. The delivery history shows
    that body, and the receiver's answer, with the cookie hidden (`scrubHutk`), so
    a receiver that echoes its request cannot put it on screen. Without a visit,
    both send exactly what they sent before.
  - `@quill/shared`: the Page row, the HubSpot chip and the CSV's Page URL column,
    and the help of the HubSpot form submission switch and of the HubSpot tracking
    ID, in English and Spanish.

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

- 468262a: The dForms look: the admin, the editor and the forms list wear the new brand, and the forms list reports each form's publish state.

  - **Tokens** (`@quill/shared`): `tokens.css` is rewritten around paper, ink and
    Signal Green (`--signal`), with `--score` for points, `--warning` for work
    that is not live yet, and `--panel` / `--sidebar` as work surfaces. Light and
    dark are both defined. This is the look of the admin; a public form does not
    read it for its base colours (see "Existing forms" below).
  - **Existing forms do not change.** A form published before the rebrand stored
    no colours, and an absent colour keeps meaning what it always meant: the dark
    ground, Signal White text and Program Lime accent, with Figtree. `DEFAULT_ACCENT`
    and `DEFAULT_CANVAS` in `@quill/shared` keep their old values, an unbranded
    public form is still pinned dark, and `public-form.css` owns the dark palette
    a form's own colours are drawn over instead of following the app's new tokens.
    The `legacy-markup` snapshots confirm it: the only differences in the rendered
    markup are the attribution text and the full stop below.
  - **New forms are born with the dForms look** (`@quill/engine`):
    `withNewFormBranding` writes a white ground, ink text and Signal Green into the
    config of a form created from nothing (the dashboard and `POST /v1/forms`, and
    the onboarding wizard), filling only what the caller left out. A copy of a form
    keeps its original's look. The editor shows the dForms preset card as selected.
  - The first-run wizard is a `.pf` surface that is the product's own screen, not
    a customer's form, so it wears the dForms colours (white, ink, Signal Green)
    written inline on its root instead of the dark ground a public form now owns.
  - **Theme presets** (`@quill/engine`): a `dforms` preset leads the list. The
    `control-room` preset keeps its id, so a form that stored it still shows its
    card as selected.
  - **Forms list** (`@quill/db`): `listForms` returns `hasDraft`, true while a
    form holds unpublished changes. It is computed in SQL from
    `draft_config IS NOT NULL`, so the draft itself is never read. `GET /v1/forms`
    documents the field, and the list shows it as a Published or Unpublished
    changes chip beside each form's submissions and completion figures.
  - **Editor**: one top bar with Build, Logic, Design and Connect as tabs, the
    unpublished chip beside the name, compact question rows with their points, a
    flat settings panel, a narrow Design panel beside a larger preview, and
    Connect in two columns. No control was removed.
  - **Submissions and Analytics**: one header for a form's screens ("Forms / the
    form's name" with its publish state, then Edit, Submissions, Analytics and
    Integrations as tabs), with each screen's own controls on its right: the
    workspace timezone and the CSV export on Submissions, the date range on
    Analytics. The table draws a sheet's grid and keeps its checkboxes away
    until Select is pressed, its selection bar floats over the foot of the page, a
    response reads as a flat list of questions and details, the Summary lays its
    cards out in two columns, and Analytics shows its figures as one band above
    Trends and then the drop-off list, both drawn in Signal Green. No control
    was removed.
  - **Search in the submissions table** (`@quill/db`): `SubmissionFilter` takes
    `search`, a case-insensitive substring looked for in the form's written
    answers (text, contact and URL questions; a name by its first and last name
    together). It is one more filter, so the table, the CSV export, the Summary
    and its answer search all follow it. The API reads it as `?search=` on those
    routes; the page keeps it in its own URL, shows it as a chip, and offers it
    as a box in the header of the Submissions screen and in the bar of the
    full-screen sheet. Accents are not folded.
  - **Summary**: every text card opens with its latest answers and "Show more",
    the contact questions (name, email, phone) included; they used to show a
    search box and nothing else. The panel a card opens has the Delete button
    the table's panel has, and deleting there refreshes the cards.
  - The fallback wordmark on a public form (a form with no logo) no longer appends
    a full stop to the form's name, for every form: on someone else's form it read
    as a typo in their title.
  - **No monospaced face**: the admin no longer loads a monospaced font or uses
    `font-mono`; URLs, keys, hex values and code samples are set in the sans.
  - **Name**: the product reads dForms everywhere a person sees it: invitation
    emails, the webhook note, the onboarding logo, the HubSpot mirror form's
    suffix ("<form> (dForms)", renamed in place the next time a form's mirror
    syncs) and the page title. A build is Dapta's own when
    `NEXT_PUBLIC_PRODUCT_NAME` is `dForms` or the old `Dapta Forms`, and shows
    `dForms` either way.
  - **Home**: the shortcuts no longer float in a column beside the list. The two
    that repeated the rail (Integrations, Analytics) are gone, and the two that
    lead somewhere the rail does not (Brand kit, Public page) form one band under
    the list, the width of the figures above it.
  - **Account settings**: a two-line statement header like Home's, and every
    screen without nested cards. A workspace opens with its tile, name, a Current
    chip and its id, then its name and timezone side by side, its tabs with Add
    member on the same row, and flat tables. Brand kit lays its settings out as
    rows (what it is on the left, the control on the right) with the three
    colours as swatches, the preview in a grey well and "Apply to existing forms"
    beside them; the preview shows how a NEW form would look (white, ink and
    Signal Green for what the kit leaves out). Notifications keeps both emails on
    the page and puts the live preview beside the fields from `xl`. Public page
    and Preferences use the same rows. No control, `data-testid` or heading the
    e2e specs read was removed. The Members and Invitations tables no longer make
    the page scroll sideways on a narrow screen.
  - **Email preview as an inbox**: the email preview, on Account settings and on a
    form's Connect tab, has an expand button that opens a mock of an inbox: the
    subject under its label, the sender, and the message on the grey page an HTML
    email draws itself on, with the answers as the two-column table the real email
    carries. It follows what you type. It draws no third-party logo and says it is
    a mock.
  - **Icons**: the admin draws its icons from a generated `icons.css` (built from
    `lucide-static` by `pnpm --filter @quill/web icons`) instead of `primeicons`.
    Class names are unchanged.
  - **QR codes**: on the Dapta brand the code carries the dForms mark in its
    centre, at error correction level H so it still scans.
  - The attribution pill under a public form reads "Made with dForms", and the
    sign-up line on the thank-you screen "Get dForms, free".
  - i18n: `admin.forms.col*`, `admin.forms.status*`, `admin.forms.noCompletion`,
    `admin.submissions.selectMode`, `admin.submissions.selectModeDone`,
    `admin.submissions.filters.searchResponses*`, `admin.submissions.filters.searchChip`,
    `admin.brandKit.notSetShort`, `admin.notifications.previewExpand`,
    `admin.notifications.previewMock.*` (EN + ES). `admin.home.integrations*` and
    `admin.home.analytics*` are removed; `admin.account.subtitle` and
    `admin.brandKit.subtitle` are shorter.

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
- Updated dependencies [4a38827]
- Updated dependencies [bb7077e]
- Updated dependencies [67bd1e2]
- Updated dependencies [310f098]
- Updated dependencies [d69e261]
- Updated dependencies [9b42f40]
- Updated dependencies [e50736f]
- Updated dependencies [7eea7be]
- Updated dependencies [e877d55]
- Updated dependencies [cbcef9c]
- Updated dependencies [8009d2d]
- Updated dependencies [40fe6fe]
- Updated dependencies [b8322ea]
- Updated dependencies [310f098]
- Updated dependencies [acb8823]
- Updated dependencies [42ec808]
- Updated dependencies [bd31b39]
- Updated dependencies [036d5fd]
- Updated dependencies [f7875dc]
- Updated dependencies [daaabf2]
- Updated dependencies [de8df64]
- Updated dependencies [be7d8d1]
- Updated dependencies [310f098]
- Updated dependencies [c6007cb]
- Updated dependencies [bfece62]
- Updated dependencies [dd911c2]
- Updated dependencies [7b087af]
- Updated dependencies [310f098]
- Updated dependencies [a6b7fcf]
- Updated dependencies [72a7876]
- Updated dependencies [310f098]
- Updated dependencies [9779aac]
- Updated dependencies [59a4a66]
- Updated dependencies [002d388]
- Updated dependencies [9850238]
- Updated dependencies [cf9eb95]
- Updated dependencies [e7cb7a0]
- Updated dependencies [d85aeb5]
- Updated dependencies [8e84fcf]
- Updated dependencies [310f098]
- Updated dependencies [310f098]
- Updated dependencies [2f17c60]
  - @quill/types@0.1.0
