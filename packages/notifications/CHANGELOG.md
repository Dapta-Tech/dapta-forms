# @quill/notifications

## 0.1.0

### Minor Changes

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

- e877d55: Feedback round (V2): graceful variable interpolation (sweeps orphaned
  punctuation when a `[field]` resolves empty); country-code phone input
  (bundled ISO 3166-1 data + E.164 value + subscriber-digit validation);
  branded admin dropdown combobox; account-level integration connect flow with
  AES-256-GCM encrypted-at-rest token storage (`account_integration` table,
  migration 0004, per-account token resolution with env fallback); Typeform-style
  per-form HubSpot mapping with smart auto-map; editable notification email
  templates (subject/body with `{{token}}` interpolation, escaped); webhook
  per-event triggers (`events: partial|complete`); soft banner styling; HubSpot
  booking-embed fallback.
- 310f098: Actually tell someone they were invited, and stop showing them as pending once
  they arrive.

  `inviteMember` inserted a member row with status `invited` and stopped. There
  was no invitation email anywhere in `@quill/notifications` — the invited person
  was simply never told, and the only way in was for an admin to message them
  out of band.

  `renderMemberInvited` (EN + ES) is the copy, `SubmissionNotifier.sendMemberInvited`
  sends it, and the API enqueues it through the outbox like every other
  side-effect — never inline from the request handler, so a mail provider being
  down cannot fail an invite that already succeeded. The notice is anchored on the
  member id, so a retried delivery cannot read as a second invitation. With no
  `PUBLIC_APP_URL` configured the sign-in line is dropped rather than printing a
  broken link.

  The copy stays deliberately plain: it names the workspace, who added them, and
  where to sign in. There is no token and no accept step because none is needed —
  `resolveByEmail` already matches an existing member by address, so signing in
  with the invited email is what binds the account.

  New `activateInvitedMember` flips `invited` → `active` on first resolve.
  Nothing did this before, so someone who accepted stayed "invited" in the members
  list forever and an admin could not tell a pending invite from an active
  teammate. The transition is deliberately narrow — a `disabled` member logging in
  stays disabled, which is the whole point of disabling them, and an already-active
  member is never rewritten.

- dd911c2: Submission notifications can be sent to up to five addresses, set per account and overridden per form.

  The new-submission notice had no audience to configure. It went to the account
  owner because the send path looked the owner up, so a team that runs on email
  rather than a CRM had to forward it by hand or wire a webhook into an
  automation tool to do what a field should do.

  Settings → Notifications now carries a **Send to** list on that email, and the
  same control appears on a form's Connect tab, where a form can set its own.
  Addresses are rows with add and remove, not a comma-separated box, so a
  malformed one is marked where it is rather than reported as "something failed".
  Five is the ceiling, enforced by the API and not only by the browser, which also
  rejects a malformed address and the same mailbox listed twice.

  Each address gets its **own** email rather than sharing a To line, and each one
  is its own queued row: an address that bounces retries by itself, without
  costing the other four their delivery, and every copy shows up separately in
  the form's delivery history.

  Inheritance is per field, like the subject and body beside it. A form with no
  list of its own follows the account's, and the card says so. Emptying the list
  on one form is a decision rather than a blank: that form notifies the owner
  alone while the account keeps telling everyone else. An account that configures
  nothing keeps receiving exactly what it received before, at the owner's address,
  in one email.

  - `notification_setting.recipients` (migration 0022, both dialects): a JSON
    array in TEXT, like `reminder_lead_minutes` on the same table. `null`
    inherits, `[]` is the stored "owner only", a list replaces.
  - `notificationSettingPatchSchema` gains `recipients`, shared by the account PUT
    and the per-form PUT. It is refused on `submission_confirmed`, which is
    addressed to the respondent and would never read it.
  - The submission email's idempotency key now names its addressee. The single
    key it carried before would have had a de-duplicating transport drop every
    copy but the first, with no error and no log.
  - i18n: `admin.notifications.recipients*` (EN + ES).

- dfc514f: The owner notice now carries the answers, a working submissions link and a real HTML body.

  Until now the "new submission" email told the owner that someone answered and
  nothing else: the answers were never passed to the template, the
  `{{formLink}}` token had no producer (so the "View submissions" line always
  dropped out and custom templates looked half rendered), and the HTML body was
  a bare `<p>` with `<br/>` separators, which most clients showed as plain text.

  - `summarizeAnswers(config, answers)` in the engine resolves a submission to
    `{label, value}` rows in step order: the question the respondent actually
    saw, option values mapped back to their labels, multi-selects joined with
    commas, bookings as `YYYY-MM-DD HH:mm UTC`, values capped at 2000 characters.
  - New `{{answers}}` token, available in both submission emails and included
    by default in the owner notice only (blank line, the answers, blank line,
    then the link). In text it renders one `Label: value` line per answer; in
    HTML a two-column table with every cell escaped.
  - `{{formLink}}` now points the owner at `PUBLIC_APP_URL/admin/forms/:id/submissions`
    (absent in a bare fork without `PUBLIC_APP_URL`; never on the respondent receipt).
  - Every email is a complete responsive HTML document (doctype, viewport,
    600px card, system font stack, real `</body></html>` so the transactional
    service can splice its footer). Stock and custom bodies follow one rule: a
    line is dropped only when it has tokens and all of them resolved empty, so
    blank spacer lines and sign-offs survive. Runs of blank lines left behind by
    dropped lines collapse to one, and leading or trailing blank lines are
    trimmed.
  - Migration 0019 appends `{{answers}}` to every custom owner-notice body that
    lacks it (account and per-form rows), so templates edited before the token
    existed also get the answers. Idempotent.
  - An owner without an email no longer enqueues a row that fails five times;
    rows already queued with no recipient are skipped once instead of retried.
  - Settings and the Connect tab show an "Answers" variable chip and a permanent
    notice on the owner notice when its body lacks `{{answers}}`; the preview
    sample shows the answers block. The respondent card no longer offers the
    `{{formLink}}` chip, which that email never produces. The chip label reads
    "Submissions link".
  - i18n: `admin.notifications.tokenAnswers`, `answersMissing` (EN + ES).

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

- a6b7fcf: Pilot-port feature set: per-outcome booking embeds (HubSpot Meetings / Calendly) with a booking callback and durable booking→CRM sync via the outbox; answer-forced outcome overrides; reveal screen duration/subtitle templates/prewarm; per-form tracking config (GTM, Meta Pixel, PostHog, HubSpot); HubSpot destination value maps, outcome property, static properties, company inference and bookingSync; draft→publish workflow (form.draft_config/published_at, additive migration 0003 + booking_event table); respondent confirmation email wiring; normalizeConfig now preserves additive top-level config fields; i18n EN+ES for all new surfaces.
