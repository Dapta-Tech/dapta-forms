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

- 68aa3b2: HighLevel destination adapter. With a connection (a Private Integration token and a Location ID), the destination factory now builds `GoHighLevelDestination` instead of the no-op: each submission is upserted as a contact of the sub-account (`POST /contacts/upsert`), then its fixed tags are added with `POST /contacts/{id}/tags`, which only adds. Empty answers are never sent, so they never clear a value GHL already has; a phone goes as E.164 when it carries its country; each custom field gets its value in the shape its type takes (a number only when the answer is one, a list for multiple choice and checkbox, a date as the day in the destination's zone). A 401 or 403 from GHL skips the delivery with a reconnect reason and calls `onRejected`; a 400 or 422 skips it with GHL's message; a Cloudflare refusal, 429, 5xx or network error throws so the outbox retries. Without a usable connection the factory keeps the named no-op. The `@quill/types` change only updates comments that said no adapter existed yet.
- 28ab19d: A form can now append every submission to a Google Sheet as a new row.

  The destination stores the spreadsheet, the tab and an ordered list of columns. Columns are a list rather than a map because a spreadsheet's columns are ordered, and they are never derived from a submission's own answers: two respondents answer different optional questions, so a row built from whichever one arrived would put the same question in a different column on every line.

  One API call per delivery. Google's write quota is 60 requests a minute per user, and a submission burst is exactly when a form is worth the most, so the adapter does not read the sheet, look up the tab or write a header row: those are one-time jobs for the admin surface, not per-respondent work.

  Values are written raw, so an answer that begins with `=` stays text instead of becoming a formula in someone else's spreadsheet.

  A delivery that cannot succeed however often it is retried (a deleted spreadsheet, a renamed tab, access revoked) is reported as a no-op naming the cause, and only quota, server errors and transport failures are retried.

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

- 2c41cb0: Webhook payloads now carry a permanent link to every uploaded file.

  Until now a file answer reached a webhook as `{ key, name, size, mime }`, and the
  key points into a private bucket the receiver cannot read, so the file could only
  be opened from the dashboard. Every file answer in the webhook `data` now also has
  a `url`, in both the partial and the complete delivery. The change is additive:
  `key`, `name`, `size` and `mime` are exactly as before.

  The link lives on the deployment's public web address (`PUBLIC_APP_URL`), as
  `/file/<token>`, and opens without signing in. PDFs and images open in the
  browser; every other file downloads under its original name. Which of the two
  is decided by the file extension, never by the type the browser declared at
  upload. Each click is redirected to a fresh signed URL that lives a few minutes,
  so the bucket stays private and nothing long-lived is ever stored.

  The link does not expire. It stops working when the submission is deleted, or
  when the signing key changes, which revokes every link already sent at once.
  Treat it as a secret: whoever holds it can open the file.

  - `@quill/destinations`: `DestinationContext` gains an optional `fileLinks` map
    (step key to link). Only the webhook adapter reads it, adding each link as
    `url` on the matching answer; `data` itself is never modified, so the stored
    submission and the HubSpot destination see the answers exactly as before.
  - `@quill/config`: new optional `FILE_LINK_SECRET`. Unset, the signing key is
    derived from `FORMS_ENCRYPTION_KEY`, so a deployment that already has that key
    needs no new configuration. With neither set, or with `PUBLIC_APP_URL` empty,
    payloads carry no `url` and the link route answers 404; nothing else changes.
  - `@quill/engine`: `file` and `files` are reserved public slugs, so no account
    can claim a code that the link route would shadow.
  - `@quill/db`: `getSubmissionAnswersUnscoped`, the answers of one submission by
    id, for the link route only (its signed token is the authorization).

- a6b7fcf: Pilot-port feature set: per-outcome booking embeds (HubSpot Meetings / Calendly) with a booking callback and durable booking→CRM sync via the outbox; answer-forced outcome overrides; reveal screen duration/subtitle templates/prewarm; per-form tracking config (GTM, Meta Pixel, PostHog, HubSpot); HubSpot destination value maps, outcome property, static properties, company inference and bookingSync; draft→publish workflow (form.draft_config/published_at, additive migration 0003 + booking_event table); respondent confirmation email wiring; normalizeConfig now preserves additive top-level config fields; i18n EN+ES for all new surfaces.
- 115e213: Salesforce as a submission destination. A workspace connects its org once with
  Client Credentials (My Domain, consumer key, consumer secret, stored encrypted
  as one value), and each form maps questions, UTMs, score, submission date and
  fixed values to Lead fields. A delivery finds the respondent by email first
  (a Contact, then an unconverted Lead) and updates it, and creates a Lead only
  when neither exists, so a person who answers twice is not duplicated (two
  submissions from one email at the same instant can still race; an org's own
  duplicate rules close that). Transient refusals (the API limit, lock
  contention, a query timeout) are retried. Complete submissions only.
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

- 4c94c6e: A spreadsheet column whose heading is cleared keeps its place in the sheet.

  - New `sheetCells(columns, written)` and `writtenSheetHeaders(destination)` in `@quill/types`. A column with no heading still stays out of the sheet, unless dForms already wrote a heading at its position: then the position is held (row 1 keeps the old heading, the cell is delivered empty) until the column is named again or deleted. Renaming a middle column no longer moves the columns after it one cell to the left while the new name is being typed.
  - The Google Sheets adapter takes the row 1 dForms last wrote (`writtenHeaders`) and builds each delivered row from the same cells.
  - New catalog strings for the held column's note and the dismiss button of the "your last change was not saved" notice, in English and Spanish.
  - `sheetCells` decides which unnamed column holds a position by position (the layout that changes the sheet least), not by reading headings ahead, so clearing the first of two identical headings no longer shifts the column after it. New `sheetBaselineHeaders(destination)`: the row 1 on record, or for a destination saved before anything was recorded, the stored columns' own headings, so the first edit to an older config is protected too. `writtenSheetHeaders` also reads what was recorded for a row 1 that is not dForms' own.

- f09c56c: One rule for which spreadsheet columns are in the sheet: a column is written if and only if it has a heading.

  - `@quill/types`: a Google Sheets column's `header` may be empty, so a column the author has added but not named yet can be stored. `isWritableSheetColumn` (a heading, nothing else), `writableSheetColumns` and `destinationIsDeliverable` are the one rule every reader uses. A heading with no answer chosen yet is written, with empty cells, which is also what configs with `{header, source: 'answer'}` and no key always meant. Configs stored before this keep parsing unchanged.
  - `@quill/types`: a Sheets destination may also carry `headerForeign`, API-owned bookkeeping for a row 1 it found it may not write, so a failed header sync is retried and a foreign row is not re-read on every save.
  - `@quill/types`: HubSpot and Salesforce destinations may carry `drafts`, the rows an author started and has not finished, stored so they survive a reload and never read by a delivery or the HubSpot mirror form. A Sheets destination may carry `headerBroken`, API-owned, so a sync that failed for good is not retried on every save.
  - `@quill/db`: `duplicateForm` and `withoutOwnedMirrorState` also drop the Google Sheets header bookkeeping (`headerSnapshot`, `headerForeign`, `headerBroken`), which only the API writes.
  - `@quill/db`: `updateFormDestinations` takes an optional `expectedUpdatedAt` for a compare-and-swap write, refused as `STALE` when another write landed since the read. Without it, the write is unchanged.
  - `@quill/destinations`: the Google Sheets adapter writes only the columns that rule names, so a delivered row always lines up with row 1.
  - `@quill/shared`: copy for a column with no heading and for one with nothing chosen to fill it, for a row 1 that fell out of date, for a sheet with no named column, for a change lost after leaving the tab, and a short label for the save pill, in English and Spanish.

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

- a6ae6f7: Groundwork for a HighLevel destination. Nothing can connect or deliver to HighLevel yet, and no screen offers it.

  - `@quill/types`: a `gohighlevel` destination type with its schema (mappings to a standard contact field or to a custom field by id, key and type; UTMs, score and submitted date to custom fields; `dayTimezone`, `staticFields`, `tags`, `source`, `drafts`, `events`), the standard field catalog, the custom field types, which ones each kind of mapping may target (`goHighLevelSlotAccepts`), and the shapes the connect and fields routes and the adapter will use. At most one per form, through `extraOnePerFormDestination`, which also carries the HubSpot and Salesforce rules with their messages unchanged.
  - `@quill/types`: `destinationFiresForPhase` reads an explicit `events` on HubSpot and Salesforce destinations too. Without one, HubSpot still fires on both phases and Salesforce on complete only, so every stored config behaves as before. A HighLevel destination without `events` fires on complete only. Google Sheets stays complete only.
  - `@quill/db`: `gohighlevel` is an integration provider and an outbox kind.
  - `@quill/destinations`: the factory turns a `gohighlevel` delivery into a named no-op until the adapter exists.
  - `@quill/mcp`: the form config JSON Schema (the guide's `config_schema` and the skill's `form-config.schema.json`) leaves out the HighLevel destination and the `events` of HubSpot and Salesforce destinations, which the editor has no control for yet. A refusal for a provider no deployment can connect yet gets its own hint instead of the one that sends the user to whoever runs the deployment.
  - `@quill/shared`: reserved HighLevel copy in English and Spanish: the provider name, the connection errors and the delivery history reasons.

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
- ac635ce: A test delivery carries `test: true` at the top of the webhook payload, apart from `data`, so it can never collide with a step keyed `test`. Real deliveries carry no `test` key.
- Updated dependencies [310f098]
- Updated dependencies [373627e]
- Updated dependencies [4a38827]
- Updated dependencies [bb7077e]
- Updated dependencies [67bd1e2]
- Updated dependencies [11af0cd]
- Updated dependencies [61067f7]
- Updated dependencies [4c94c6e]
- Updated dependencies [f09c56c]
- Updated dependencies [310f098]
- Updated dependencies [d69e261]
- Updated dependencies [531f8d9]
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
- Updated dependencies [68aa3b2]
- Updated dependencies [a6ae6f7]
- Updated dependencies [28ab19d]
- Updated dependencies [dc73f54]
- Updated dependencies [66e0b55]
- Updated dependencies [bd31b39]
- Updated dependencies [036d5fd]
- Updated dependencies [f7875dc]
- Updated dependencies [daaabf2]
- Updated dependencies [6855ca8]
- Updated dependencies [de8df64]
- Updated dependencies [be7d8d1]
- Updated dependencies [310f098]
- Updated dependencies [c6007cb]
- Updated dependencies [64f3baa]
- Updated dependencies [bfece62]
- Updated dependencies [dd911c2]
- Updated dependencies [7b087af]
- Updated dependencies [b8ff7fb]
- Updated dependencies [f790dda]
- Updated dependencies [310f098]
- Updated dependencies [a6b7fcf]
- Updated dependencies [72a7876]
- Updated dependencies [310f098]
- Updated dependencies [1bfeaa1]
- Updated dependencies [5a00a48]
- Updated dependencies [2c072c6]
- Updated dependencies [115e213]
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
- Updated dependencies [4e8fa20]
- Updated dependencies [2f17c60]
  - @quill/types@0.1.0
