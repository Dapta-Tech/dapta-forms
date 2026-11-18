# @quill/db

## 0.1.0

### Minor Changes

- 8961511: The admin API now returns each form's links: `publicUrl` and `editorUrl`.

  An agent working through the API had no way to hand a person the form it just
  built: the link was never in a response, so it had to guess the shape, and most
  guesses were wrong. Every route that returns a form (`POST /v1/forms`,
  `GET /v1/forms/:id`, each item of `GET /v1/forms`, `PUT /v1/forms/:id`,
  `PUT /v1/forms/:id/slug`, duplicate and publish, plus the `current` form of a
  409 `STALE` answer) now carries both:

  - `publicUrl` is the form's public link, the same one the dashboard copies: the
    workspace's current public code (its vanity slug once it claims one) and the
    form's current slug, so it follows a rename.
  - `editorUrl` opens the form in the builder.

  Both are absolute URLs on `PUBLIC_APP_URL`. A deployment that leaves it empty
  gets `null` for both, and nothing else changes.

  To keep one rule for the link, `publicFormPath` and `PUBLIC_FORM_SEGMENT` moved
  from the web app into `@quill/shared`, next to a new `formEditorPath` and a
  `formLinks` helper that joins both onto the app URL; the web re-exports them
  from where it always imported them. `@quill/db` gains `getAccountPublicCode`,
  which reads one workspace's canonical public code.

- 73f3727: API keys for the admin API: create them on the Developers page, send them as `Authorization: Bearer dforms_...`.

  - `GET`, `POST` and `DELETE /v1/api-keys`, with a session only. A member lists and revokes their own keys; an owner or admin, every active key of the workspace and who created it. The key in clear comes back once, in the `POST` response (`{ id, name, last4, createdAt, key }`); only its SHA-256 is stored. The 11th active key of one person in one workspace answers 409 `KEY_LIMIT`.
  - A key acts as the member who created it, in that workspace, with their current role (`via: 'api_key'` on the principal). A revoked key, or one whose member is no longer active there, answers 401 `INVALID_API_KEY` on the next call; an `x-quill-workspace` header naming another workspace answers 403 `WORKSPACE_FORBIDDEN`.
  - A key may call the routes that build and run forms (forms, folders, destinations, responses, CSV, analytics, brand kit, notifications, `GET /v1/me`, reading integrations). Every other admin route answers 403 `KEY_NOT_ALLOWED`, and a route added later is refused to keys until it is allowlisted.
  - 120 calls a minute per key (the public limiter's token bucket, in memory per pod): past that, 429 `{ error: 'RATE_LIMITED', retryAfterSec }` with a `Retry-After` header. `last_used_at_ms` moves at most once a minute.
  - Forms record how they were born: `form.created_via` is `api` with a key and `web` from the dashboard and the onboarding, on create and on duplicate. `form_created` and `form_published` carry the same `via`, and a new `forms_api_key_created` event fires when a key is made.
  - `/openapi.json` documents the bearer scheme and the key routes.
  - `@quill/db`: `insertApiKey` (the count and the insert in one statement), `listApiKeys`, `getApiKeyById`, `revokeApiKey`, `findApiKeyPrincipal`, `touchApiKeyLastUsed`, `API_KEY_LIMIT_PER_MEMBER`, and a `createdVia` input on `createForm` and `duplicateForm`.

- e3e43ab: Add the schema the public API v1 builds on, in both dialects (migration 0024).

  Purely additive: every new column is nullable, no existing row is rewritten, and
  nothing reads or writes the new columns yet.

  - `api_key.member_id`, the member who created the key, plus the
    `api_key_account_member_idx` index on `(account_id, member_id)` for listing a
    workspace's keys or one member's keys in it.
  - `form.created_via` (`web`, `api` or `mcp`; NULL for every form created before
    the column).
  - `form.previous_config` and `form.previous_published_at_ms`, the live config a
    publish replaced and when it had been published, for reverting a publish.

  Both Drizzle schemas expose them as `apiKey.memberId`, `form.createdVia`,
  `form.previousConfig` and `form.previousPublishedAtMs`.

- 04d39c0: Revert a form to its previously published version, by API or from the editor.

  Publishing directly is safe because it can be undone in one click.

  - Every publish now keeps the live config it replaces (`previous_config`) and
    when that version went live (`previous_published_at_ms`: the last publish,
    or the form's creation for a form that was live before its first publish).
  - `POST /v1/forms/:id/revert` puts the previous version back live, and the
    version it replaces becomes the previous, so reverting twice undoes the
    revert. The destinations the form has now are kept, and a pending draft is
    not touched. With nothing to go back to it answers 409 `NOTHING_TO_REVERT`.
    An API key may call it. The public form serves the reverted version as soon
    as the call returns.
  - Form responses carry `previousPublishedAt` (epoch-ms, or null when there is
    nothing to revert to). The stored version itself stays on the server.
  - In the editor, the Publish button gains a menu with "Revert to the previous
    published version". It shows when that version went live, is disabled while
    there is none, and asks first in a dialog that names the date and says the
    draft does not change.
  - `@quill/db` gains `revertForm` and `FormRow.previousPublishedAt`;
    `@quill/shared` gains the `admin.publish` revert copy (EN + ES).

- 38633bb: API v1 follow-ups from the review of the second wave.

  - With an API key, any config the editor produces can be read with `GET /v1/forms/:id` and saved back unchanged with `PUT`: `message` and `scheduler` steps may have a blank title, like `reveal` (the editor saves them that way), and `branding.clientLogos` and a slider's `sliderUnitLabel` pass when they equal what the form already stores, so a brand kit changed after the form was made, or a template's slider unit, no longer breaks the round trip. Legacy fields still answer `UNSUPPORTED_FIELD`.
  - The "Customer feedback" template carries its processing screen as a reveal step, the shape the builder edits, instead of the legacy form-level reveal.
  - A key follows its member: disabling or removing a member, or the identity service marking them inactive or no longer listing them, revokes their API keys in the same transaction. Reactivating the member does not bring the old keys back, and `GET /v1/api-keys` never lists the keys of a member who is not active. `@quill/db` gains `runAtomically` and `revokeKeysOfInactiveMembersSql`.
  - The "How to use the API" section of the Developers page (EN and ES) explains error paths with the body prefix, the editor defaults a key may send back, that `PUT /v1/forms/:id` ignores `destinations`, and that a revert takes no body, answers 200 with the form and that every form carries `previousPublishedAt`.

- 908f088: The admin API explains its validation errors and holds API keys to what the editor can show.

  - Every validation 400 of the form, branding and destinations routes now carries `issues: [{ path, message, code }]` with every problem at once. `path` is the dot path inside the request body (`config.steps.2.question`); `message` is still the first issue's, so nothing that reads only `message` changes.
  - `POST /v1/forms` drops `formGuid` and `formSignature` from HubSpot destinations, for every caller, as duplicating already did. A config copied from another form no longer points the new form at the original's HubSpot mirror form. `@quill/db` exports the helper both paths use, `withoutOwnedMirrorState`.
  - With an API key only (a browser session saves exactly as before, legacy fields included), a form config is refused with `UNSUPPORTED_FIELD` and the field's exact path when it carries a field the editor has no control for: `outcomes[].booking`, `steps[].buttonText`, `steps[].sliderUnitLabel`, `steps[].reveal.subtitleTemplate`, `steps[].reveal.enabled`, `steps[].scheduler.prefill`, `steps[].flowGroup`, `branding.clientLogos`, the webhook `signatureHeader` and `timeoutMs` (checked where destinations are written: `POST /v1/forms` and `PUT /v1/forms/:id/destinations`; `PUT /v1/forms/:id` drops destinations from the draft, so it does not refuse them), and the legacy `config.reveal`, `config.revealAfterStep` and `steps[].triggersReveal`. The value the editor itself writes passes, so a form read and sent straight back saves: the derived `flowGroup`, the step defaults `buttonText` "Continue", `reveal.enabled` true and `scheduler.prefill` true (on any step, since changing a step's type in the builder keeps them), and the brand kit's own client logos.
  - With an API key, a step without a question is refused with `EMPTY_QUESTION` (a reveal step asks nothing and is exempt), and `PUT /v1/forms/:id` with a config that has no `steps` answers 400 `STEPS_REQUIRED` and writes nothing.
  - With an API key, the saved config is the engine's normalized one (`normalizeConfig`: unique step keys, deduplicated option values, derived flow groups and scoring), and the response returns it.

- 373627e: Paying Dapta AI workspaces can turn off the "Made with dForms" attribution.

  **One rule.** `showAttribution` in `@quill/shared` decides, from the
  workspace's choice and its cached paid verdict: the attribution is hidden only
  when the workspace asked for it and the deployment runs `PREMIUM_FEATURES=open`
  or the verdict reads paid and is under `ATTRIBUTION_VERDICT_MAX_AGE_MS` (30
  days) old. A stale verdict fails closed: the attribution shows again until a
  member opens dForms. So does one stamped more than
  `ATTRIBUTION_VERDICT_MAX_SKEW_MS` (5 minutes) in the future. The deployment rule (`NEXT_PUBLIC_SIGNUP_URL`,
  `NEXT_PUBLIC_HIDE_BADGE`) still applies on top.

  **Data.** Migration 0028 adds `account.hide_attribution` (0/1, default 0, so
  every existing workspace keeps showing it), `account.dapta_paid` (1/0, null
  until seen) and `account.dapta_paid_checked_at`. The choice and the verdict are
  kept apart, so a lapsed subscription keeps the choice and brings the
  attribution back on its own. `getAttributionSwitch`, `setHideAttribution` and
  `cacheDaptaPaid` read and write them; a projected membership (and a staff
  grant) can carry `paid`, which is written with the time of the read, and a
  read without one keeps the old verdict.

  **Payloads.** `PublicForm` and `PublicLinkPage` gain an optional
  `showAttribution`; absent reads as shown, exactly as before.

  **Emails.** `SubmissionNotifier.sendSubmissionReceived` and
  `sendSubmissionConfirmed` take an optional `{ growthCta: false }` that sends
  the email with no growth button and no text line, decided at send time.

  **Config.** `PREMIUM_FEATURES` is optional now. Read it through
  `vanityPremiumMode` (unset is `open`, as it always was) or
  `attributionPremiumMode` (unset is `locked` when `iamWorkspacesEnabled`, that
  is `IAM_BASE_URL` with `AUTH_PROVIDER=workos`, else `open`).

  **Copy.** `admin.attributionSetting` (the Brand kit row) and
  `admin.editor.design.badgeSizeHiddenHint`, in English and Spanish.

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

- e50736f: A form's public link can be renamed, and the old link keeps working.

  The third segment of a form's URL (`/{accountCode}/{handle}/{slug}`) was
  written once, derived from the form's name at creation, with nothing in the
  product to change it. It is editable now, from a pencil beside Copy link in the
  builder's topbar: the one place that already shows the URL is where people go to
  change it.

  Renaming does not break what is already published. The previous slug is retired
  into a new `form_alias` ledger rather than dropped, so a QR code on a printed
  flyer, a campaign email already sent, an iframe embedded on someone else's site
  and a CRM property holding the old URL all keep resolving. The public page then
  sends the visitor on to the canonical URL, forwarding the query string untouched
  so campaign parameters, `?embed=1` and `?step=N` survive the hop.

  That redirect resolves in the browser rather than as a redirect status: Next 16
  has already begun streaming by the time the page resolves the form, so the
  response is a 200 carrying a client-side redirect. Alongside it the page emits
  `<link rel="canonical">` naming the current URL, which is what a crawler, a link
  checker or a social unfurler reads. A retired slug therefore still points
  everything at one address, but non-browser clients learn it from the tag, not
  from a status code.

  Details worth knowing:

  - `PUT /v1/forms/{id}/slug` is the new endpoint. 409 `SLUG_TAKEN` when another
    form in the account holds the slug (as its current one OR as one it retired),
    409 `SLUG_INVALID` on shape. Any member of the account may call it, the same
    gate as editing the form.
  - A `slug` sent to `PUT /v1/forms/{id}` now renames through the same path, so
    the field that predates this feature retires the old value too instead of
    silently discarding it. Its own contract is unchanged: it still slugifies what
    it is given rather than rejecting it, and it now applies before the rest of
    the request so a refused slug leaves the form untouched.
  - New form slugs skip values another form retired. Handing one out would let a
    new form quietly inherit somebody else's already-published traffic.
  - Member public pages list forms by slug (`profile.formSlugs`). They now match a
    form's retired slugs too, so a rename cannot drop a form off a page that
    listed it, and pages saved before this heal themselves.
  - Deleting a form releases the slugs it retired.

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
- 59f1bbf: Feedback round (V3): authored step order is now authoritative at runtime —
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
- 40fe6fe: The file question, end to end: build it, answer it, download it.

  The storage groundwork shipped separately; this is the half a person can see.
  A form owner adds a "File upload" question from the builder gallery, a visitor
  picks a file and watches it upload, and the owner opens it from the submissions
  table.

  **Builder.** The gallery gets a File upload tile in the Text group. Its settings
  are four preset groups (documents, images, spreadsheets, archives) over a plain
  extension field, because "pdf, doc, docx, odt, rtf" is not a decision a form
  author wants to make and a bare text box is how a question nobody can answer
  gets published. Ticking a preset writes its extensions into the same list the
  field edits, so the two never disagree. The size field caps at the deployment's
  own ceiling, which the API reports rather than the dashboard assuming. An empty
  type list is called out, since it is almost never what the author meant.

  The canvas preview draws the real drop zone rather than a text placeholder: the
  canvas is the only place an author checks their work before publishing, and a
  question that previewed as an empty input would be lying about what it is.

  **Public form.** The upload starts the moment a file is chosen, not on Continue,
  so a visitor with a 9 MB document is watching a progress bar instead of a frozen
  button. It uses XMLHttpRequest because fetch still cannot report upload
  progress, and a progress bar is the whole difference between this feeling broken
  and feeling normal on a slow connection. Size and extension are checked in the
  browser first as a courtesy, and again on the server as the actual rule. Both
  layouts carry it, slides and vertical.

  The bytes go straight from the browser to the bucket. The presign request goes
  through a server action so the visitor's own address still reaches the API's
  rate limiter, and so no embed origin ever needs adding to an allowlist.

  **Submissions table.** A file answer renders as its filename with a download
  control instead of `[object Object]`, which is what the generic cell formatter
  produced. The signed URL is fetched on click rather than rendered into the page:
  a table of fifty rows would otherwise carry fifty short-lived credentials in its
  HTML, most of them expired before anyone clicked one. The endpoint behind it
  resolves the submission through a join on the caller's own account, so a guessed
  id from another workspace returns nothing rather than a working link.

  **Deployments with no bucket.** The tile is offered but disabled, with the
  reason on it, and the public input renders nothing at all. A bare fork sees a
  question type it cannot use rather than one that fails on the first click.

  Copy is EN and ES throughout. HubSpot auto-mapping suggests no property for a
  file question and no longer lets the words in "upload your company logo" map a
  PDF into a text property; the webhook test body carries the real answer shape.

- b8322ea: First-run onboarding wizard, behind `ONBOARDING_WIZARD` (**default on**).

  A brand-new workspace is asked three questions — role, industry, and what they
  want to use Forms for — and then picks the template its first form is built from,
  replacing the demo form that used to be seeded for everyone. The two are mutually
  exclusive by construction: the seed only writes into an account with zero forms,
  so `ONBOARDING_WIZARD` suppresses it rather than relying on operators to switch
  both correctly.

  > **Upgrading a self-hosted deployment:** because the flag defaults to on, this
  > release also turns `SEED_DEMO_FORM` inert — a new workspace gets the wizard and
  > the template it picks, not the seeded demo form. Set `ONBOARDING_WIZARD=false`
  > to keep the previous behaviour.
  - `@quill/types`: `accountOnboardingSchema` and the answer enums, the template id
    union, and the use-case → template mapping.
  - `@quill/db`: migration 0011 (`account.onboarding`, `account.onboarding_completed_at`,
    backfilled so accounts that predate the wizard are never sent through it), the
    progress/claim repository, and four form templates.
  - `@quill/shared`: `admin.onboarding.*` copy in English and Spanish.
  - `@quill/config`: the `ONBOARDING_WIZARD` flag.

  Progress is written on every step advance, not only at completion, so an
  abandoned onboarding leaves a record — `account.onboarding.lastStep` joins to the
  first-touch tags already on `account.attribution`, which makes drop-off per
  campaign a single query.

- acb8823: Folders and keyboard search on the forms list.

  A workspace with more than a screenful of forms had one flat list and no
  way to find or group anything. The forms page is now one list grouped by
  folder, searchable from the keyboard.

  - **Folders** (`form_folder`, migration 0021): flat, one level, named only,
    unique per workspace without regard to case, alphabetical. A form is filed
    in at most one (`form.folder_id`, null = unfiled, which every existing form
    is). Deleting a folder unfiles its forms and never deletes them. Any active
    member may organise forms, the same rule as creating them.
  - **API**: `GET/POST /v1/folders`, `PATCH/DELETE /v1/folders/:id` (409
    `NAME_TAKEN`, idempotent delete), `PATCH /v1/forms/:id/folder` (`{ folderId
| null }`), `POST /v1/forms` accepts `folderId`, duplicating keeps the
    folder, `GET /v1/forms` returns `folderId`. Moving never touches
    `updated_at`.
  - **List**: "Unfiled" first, then each folder as a collapsible section (the
    fold is remembered per browser) with its count, a "New form" that creates
    straight into it, and Rename / Delete behind a kebab. Rows drag onto a
    section by their grip; the row kebab's "Move to folder" is the keyboard
    route to the same move. Without folders the list looks exactly as before,
    and every row keeps its test ids.
  - **Search**: a search box over the loaded list, focused with Ctrl/Cmd+K or
    `/` (outside inputs), matching name or link without case or accents,
    highlighting the hit, hiding sections without one, Escape clears, arrows
    walk the rows and Enter opens the editor.
  - `@quill/types`: `folderInputSchema`, `folderViewSchema`,
    `formFolderPatchSchema`, `formCreateInputSchema`, `formViewSchema.folderId`.
    `@quill/db`: `NAME_TAKEN` on `CrudResult`, `folders.ts`.
  - i18n: `admin.forms.search*`, `admin.forms.*folder*`, `dialog.deleteFolderTitle` (EN + ES).

- 45aa63e: `upsertIntegration` takes extra display hints to keep in a connection's `meta`, `markIntegrationRejected` records that a provider refused the stored credential (only while the row still holds that credential), and a `gohighlevel` connection's status carries `locationId` and `rejectedAt`.
- ef213f9: Google Sheets connects through Google's own consent flow, the first provider whose credential is not pasted.

  `account_integration` gains the `google-sheets` provider. What it stores is the OAuth refresh token the flow hands back; the client id and secret that redeem it stay in the deployment's environment (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`), so the storage contract is unchanged: one opaque, encrypted secret per account. No migration: `provider` is a text column.

  All three variables unset leaves the integration off, exactly as a missing token does for the other providers.

  The consent asks for the `drive.file` scope only, the one Google classes as non-sensitive, so a self-hosted deployment's consent screen needs no Google verification. `GOOGLE_PICKER_API_KEY` is optional and turns on choosing an existing spreadsheet; without it a form can still have one created for it. `GOOGLE_PICKER_APP_ID` is read off the client id when unset.

  The connections page gains the Google Sheets card that starts that flow, so the copy catalog gains its strings in English and Spanish. The page subtitle no longer names the two providers it used to list, which went stale the moment a third one joined them.

- c3a3154: Member roles are fully editable from this product when the identity service is
  behind a workspace, and removal follows its rule.

  - Demoting an admin to member now works: the identity service replaces a
    membership's role, so "make them a member" assigns its `workspace_editor`
    system role (what the Dapta app's role dialog does when a non-admin role is
    picked). Promotion assigns `workspace_admin` as before. Both are resolved BY
    NAME from the upstream role catalog (`GET /role`, cached 5 min) because the
    ids differ per environment. Inviting as member sends the editor role too, so
    what the invitee lands with is what the inviter picked, in both apps.
  - `workspace_owner` upstream reads as `admin` here (alongside `workspace_admin`).
  - Making someone an owner (or un-owning them) is a 409: ownership is a
    membership TYPE upstream, not a role, and nothing this product calls transfers it.
  - Removing a member is OWNER-only, the identity service's rule, on the local
    path too so a fork and an identity-backed deployment agree. Admins still
    invite, promote, demote, disable, and may retract an invitation that has not
    been accepted (an `invited` row is not a membership yet).
  - `listWorkspacesForIdentity` rows carry `memberCount` (active members), for
    the workspace cards in Account settings.
  - The web API client takes a per-call `{ workspace }` override so a workspace can
    be managed by id without switching into it; a 403 on an override never resets
    the cookie's workspace.

- f7875dc: The identity service's workspaces ARE the workspaces.

  Until now one local `account` was born per identity-service ACCOUNT (the billing
  layer above workspaces): a person with three workspaces upstream had exactly one
  here, and a workspace created here was invisible upstream. From migration 0015 on,
  `account.external_id` means the upstream WORKSPACE id and the local
  `account`/`member` rows are a projection of what the identity service says: read
  on login (at most once per TTL), on demand when the switcher opens, and after
  every write, which goes upstream first.

  - `packages/db/src/workspaces.ts`: `projectMemberships`, `projectRoster`,
    `rebindLegacyAccount`, `pickHomeAccount`, `createLocalWorkspace`,
    `humanHasCompletedOnboarding`. Three additive columns: `account.iam_account_id`,
    `account.synced_at`, `member.iam_workspace_user_id`.
  - Home is the workspace the person opened LAST, in either app: the upstream
    `feature_flags.last_workspace`, which this product now also writes on every
    switch. Pre-0015 rows are rebound lazily on the next login of anyone whose token
    names that upstream account, keeping their id, public code and forms.
  - New: create a workspace (upstream first, under the caller's own account, then
    projected), rename it, refresh the list; the switcher is always visible and is
    where "New workspace" lives.
  - Members: the roster is re-projected from the upstream `users[]`; invitations,
    their email and their acceptance live upstream; removals and role changes go
    upstream first. Pending invitations are listed and can be resent.
  - Roles: `OWNER` → owner, `MEMBER` holding `workspace_admin` → admin, any other →
    member; one function (`roleFromIam`) so a future `forms` permission component
    changes exactly one place.
  - Onboarding is per person, not per workspace: someone who finished the wizard is
    not sent through it again for a workspace projected from upstream.
  - Upstream is the authority on status: a membership disabled locally BEFORE
    `IAM_BASE_URL` was set is revived on that person's next login if upstream
    still lists them active. Disable them upstream (or via Settings, which now
    writes upstream) instead.
  - Without `IAM_BASE_URL` (every fork, plain local dev) nothing changes: the same
    operations act on local rows only.

- f90861f: In-app announcements. `@quill/shared` adds the announcement list (`ANNOUNCEMENTS`), the rule that picks the one a person gets and where it shows (`pickAnnouncement`: within its dates, allowed on the deployment; the pop-up until closed or followed, the rail mark until its page is opened, the banner while it runs) and the EN and ES copy. `@quill/db` adds migration 0029, a new `announcement_state` table on SQLite and Postgres that stores, per person and announcement, when the pop-up was first seen, closed and followed, with its repository functions.
- daaabf2: Record where a workspace came from, once. A campaign link arrives with its UTM
  tags on the query string, but the root page redirects into the identity provider
  and that round-trip leaves our origin — the tags never come back, so nothing was
  ever stored and every signup looked like it appeared out of nowhere.

  `parseAttribution` maps the URL's snake_case tags onto the camelCase shape
  `attributionSchema` has always declared for this column (plus `gclid`/`fbclid`,
  the paid-click ids), allowlisting and truncating as it goes.
  `claimAccountAttribution` writes them to `account.attribution` while it is still
  NULL **and the account is newborn** — NULL alone is not evidence of a new
  workspace, since every account predating this feature has a NULL column, so
  without the age bound the first tagged login by a long-time customer would
  permanently stamp their workspace with a campaign it predates. The web parks the
  tags in a short-lived httpOnly cookie across the login hand-off. First touch,
  not last: overwriting on a later untagged visit is how paid campaigns lose the
  signups they paid for.

- 620ae1b: The MCP door can take MCP connections signed in through OAuth next to API keys, and a connection can act in every workspace where the person holds an active member.

  - `@quill/mcp`: `McpDoorOptions.oauth`, the door's OAuth side (`isApiKey`, `authenticate`, `resourceMetadataUrl`). A bearer it recognizes as an API key takes the key path, unchanged, and a dead key gets the key's 401, which never points at a login. Anything else is the OAuth side's: a request without a credential, a header that is not a plain `Bearer <token>`, or a token that does not verify gets a 401 whose `WWW-Authenticate` carries `resource_metadata` (RFC 9728), so a client can find the login. The `challenge` option is gone. Without `oauth`, the door behaves exactly as before.
  - `@quill/mcp`: the OAuth side resolves an `McpConnection`: the person (`personId`, `email`), with one `McpCaller` per workspace they may act in. It can throw `DoorRefusal` (a 403 with its message, for a sign-in that verifies but names nobody the host knows), `DoorUnavailable` (a 503 with its message and `Retry-After: 30`, for a sign-in that cannot be checked right now, never a 401 that would start a new login) or `DoorThrottled` (a 429 with `Retry-After`, for lookups past their budget). Each of the three is also charged to the client address.
  - `@quill/mcp`: new tool `list_my_workspaces` (name, role and id). Every tool that acts in a workspace takes an optional `workspace_id`: an API key keeps its own workspace and refuses any other (`WORKSPACE_MISMATCH`); a connection with several workspaces must name one (`WORKSPACE_REQUIRED`, which points at `list_my_workspaces`), uses its only one without asking, and answers `NOT_FOUND` for any workspace it cannot act in. A connection with no workspace is let in, and its tools answer `NO_WORKSPACE` with what to do. Every result names the workspace it acted in, in the structured content and the text summary. `whoami` reports the person and every workspace, with `key: null` for a connection, and `get_form_guide` explains how to choose a workspace.
  - `@quill/mcp`: the door counts a connection's requests per member of the workspace each call names (or its only one), and a request that acts in none against the person; write tools take their token from the same member. The audit line names the person, the member and the workspace, never the token. `McpCaller` carries `workspaceName` and, for a connection, `personId`.
  - `@quill/mcp`: tool errors speak to the credential that made the call: a signed-in person is never told about a key or a key's owner (`FORBIDDEN`, `RATE_LIMITED`, `INVALID_API_KEY`). `toFailure` takes the credential kind. `FormsMcpServerOptions.appUrl` names the address a person opens to get a first workspace, and `openDFormsOnce` is the one wording for it.
  - `@quill/db`: `findApiKeyPrincipal` also returns the key's workspace name (`accountName`). `listWorkspacesForIdentity` keeps an account's active member before an invited one when it collapses to one row per account, so a stale invitation no longer hides a membership that works, and takes `emailOnlyWhenUnbound`, which matches by email only a member that nobody holds yet or that this same person holds.

- af7d5c2: The MCP no longer answers OK when it did something other than what an agent
  asked.

  - `discard_draft` (new tool) throws away an unpublished draft so the form goes
    back to its live version. `revert_form` now says it only rolls back a
    publish and must never be used to undo unpublished edits.
  - `list_responses` and `get_form_analytics` refuse a `from` or `to` they
    cannot read (an impossible day, a word, epoch seconds), a `from` after `to`
    and an unknown `time_zone`, instead of reading everything.
  - `get_form`, `list_forms` and every form result carry `is_live` and
    `live_step_count`; a form never published with a step is named in the
    summary so its empty link is not shared.
  - `create_form` and `update_form` refuse, path by path, what the API would
    otherwise change without a word: unknown fields, repeated step keys, option
    values and outcome ids, a `goto` or condition naming a step that does not
    exist, `@score` with op `in`, a min above its max. `update_form` refuses to
    drop the form's `branding` (`BRANDING_MISSING`, `null` removes it on
    purpose) and warns when it ignores `destinations`; `create_form` says when it
    filled `branding` in. A problem of these kinds the form already had in the
    config the agent read is saved as it was, with a warning; one the API
    refuses anyway says it came with the form. The REST API keeps its v1
    behaviour.
  - A `publish_form` with no draft pending answers `nothing_published`, and a
    retry after it went through answers that instead of `STALE`.
  - `list_responses` gives each answer its `step_key` and `type`, each completed
    response its `outcome`, and keeps answers to removed steps (`step_removed`).
  - `get_form_analytics` warns when the funnel does not add up (responses
    created through the API), flags `daily_truncated`, and names the first
    drop-off row "(form opened)".
  - `list_forms` matches names without regard to accents, `get_form` leaves
    `destinations` out of the config, and the guide's config schema speaks of
    `create_form` and `update_form` (`formConfigJsonSchema('mcp')`).
  - `@quill/mcp`: `FormsBackend.discardDraft`, and the optional
    `FormListItem.liveStepCount`, `ResponseItem.outcome` and
    `ResponseAnswer.stepKey`, `type` and `stepRemoved`.
  - `@quill/db`: `discardDraft` and `listLiveStepCounts`.
  - `@quill/engine`: `summarizeAnswersByStep`, the summary rows with each
    step's key and type; `summarizeAnswers` is built on it and unchanged.
  - `@quill/shared`: `POST /v1/forms/:id/discard-draft` in the API reference,
    with its description in English and Spanish. An API key may call it.

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

- 310f098: Metrics accuracy: Starts now count sessions that started answering (`start` OR `step_complete`) instead of "saw the first question", which degenerated into Views on cover-less and vertical forms; a Bookings card joins the Analytics dashboard (unique booked sessions, cohort-anchored); the vertical layout's drop-off funnel counts answers (`step_complete`) instead of views, since every question is visible on load there; and the builder's question spine nudges authors to set a partial-capture point after their email question when none is configured.
- c6007cb: Correct the funnel metrics and add the Trends series.

  Four dashboard metrics were wrong at runtime and are now fixed: Starts derive from
  the first-question view (`step_view` idx 0) instead of the cover-only `start`
  event, so a form without a cover no longer reports 0 starts and 0% completion;
  Views count distinct sessions, so an in-tab refresh no longer inflates them; and
  Time to complete is the median of open→complete (anchored on the session's first
  `view`) rather than an average of `completed_at − started_at`, which was 0
  whenever no partial had been persisted. Each metric now windows by its own
  timestamp initially — since revised, see below.

  New: the analytics response carries a gap-filled per-day `trends` series holding
  every metric per bucket, backing a Trends chart with a metric selector.

  Revised: every metric now windows by the session's COHORT ANCHOR (its earliest
  `form_event`, falling back to `started_at`) instead of its own per-metric
  timestamp. Windowing each metric independently let a session start before a
  query range and complete inside it, contributing a submission with no matching
  start — the mechanism behind completion rates rendering above 100% and a
  session's activity splitting across a UTC-midnight trend boundary. A session now
  belongs to exactly one window, in every metric, by construction.

  Fixed: the drop-off table could attribute a view to the wrong question on any
  form using show/hide/goto conditional logic — the renderer's `step_index` is a
  position in that SESSION's visible-step order, which shifts under conditional
  logic, but the table mapped it positionally onto the form's authored step order.
  `form_event` gains an additive `step_key` column; the renderer now tags every
  step event with the step's stable key, and the drop-off table groups by key when
  present (falling back to the old positional mapping only for rows recorded
  before this migration).

  `completionRate` and `timeToComplete` are nullable: null (not 0%/0s) when there
  is no denominator or no derivable duration in the window — a fabricated zero
  was indistinguishable from a real one.

  Breaking: the analytics response field `avgTimeToComplete` is renamed
  `timeToComplete` (it is a median, not an average) and both `timeToComplete` and
  `completionRate` are now `number | null`. `@quill/db` replaces `eventTypeCounts` /
  `submissionAggregates` / `stepViewCounts`'s old `Map<number, number>` with
  `uniqueViewCount`, `startCount`, `completedSubmissions`, `partialCount`,
  `dailyViewSessions`, `dailyStartSessions`, and a `stepViewCounts` returning
  `{ byKey, byIndex }`. `@quill/shared` swaps the analytics range presets
  (`rangeLast7`/`rangeLast30`/`rangeLast90` → `rangeToday`/`rangeWeek`/`rangeMonth`/
  `rangeYear`) and adds the Trends + landing-row + range-empty strings in both
  locales. `formEventSchema` gains an optional `stepKey`.

  Additive migrations: `0003_metrics_indexes` indexes the metrics read path
  (`submission(form_id, completed_at)`, `form_event(form_id, session_id, type)`);
  `0004_form_event_step_key` adds the nullable `step_key` column.

- 64f3baa: A workspace can keep several link pages, up to 20 (one per trade fair, one for the Instagram bio, one per country). The default page keeps answering at `/{accountCode}`; every other page answers at `/{accountCode}/p/{slug}`.

  - `@quill/db`: a new `link_page` table and a `link_page_alias` ledger (migration `0027_link_pages`, both dialects, additive). The migration copies every existing `account.link_page` into a default page with the slug `main` and the exact same content, so every existing page keeps its address and what it shows. `account.link_page` stays readable as a fallback for one release and is kept in step with the default page. Exactly one default page per workspace (a partial unique index), slugs unique per workspace, at most 20 pages, the default page cannot be deleted, and a renamed slug keeps redirecting to the new one.
  - `@quill/types`: `linkPageSlugSchema` (the vanity slug rules and reserved words), the create, update and duplicate bodies, `LinkPageSummary`, `LINK_PAGE_MAX_PAGES`, and an optional `colors` field on a page (its own primary, background and text colours over the brand kit; absent keeps the kit's). `PublicLinkPage` gains `pageSlug` and `isDefault`.
  - `@quill/shared`: `linkPageUrl()` takes the page, the API reference documents `/v1/link-pages`, and the catalog gains the page list and the editor's name, address and colour fields, in English and Spanish.
  - `@quill/mcp`: `list_link_pages`, `create_link_page`, `duplicate_link_page` and `delete_link_page`; `get_link_page` and `update_link_page` take an optional `page_id` (the default page when absent, as before) and `update_link_page` can rename a page, change its slug or make it the default.

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

- 7b087af: Cohort-aware onboarding wizard + Dapta-estate sync.

  - `@quill/types`: the onboarding blob and steps grow `phone`, `crm`,
    `lead_volume`, `lead_source`, a `cohort` (`cold`/`dapta`) and per-answer
    `sources`; the industry enum becomes the IAM's 52-value bank.
  - `@quill/db`: migration 0012 rewrites stored industry answers to the new
    bank (a stale enum value would otherwise take the whole blob down on read);
    new outbox kind `dapta_sync`.
  - `@quill/shared`: EN/ES copy for the new questions.
  - `@quill/config`: optional `IAM_BASE_URL`, `IAM_API_KEY`,
    `DAPTA_SYNC_FLOW_URL`, `DAPTA_SYNC_FLOW_KEY` (all unset = feature off).

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
- cd45db5: Product analytics groundwork — additive migration 0010 (Postgres + SQLite) adding five nullable columns. `account.activated_at` and `account.first_viewed_at` are write-once MILESTONE CLAIMS (`UPDATE … WHERE <col> IS NULL … RETURNING`), so exactly one caller can ever win and a funnel counts accounts reaching a stage rather than actions taken; both are backfilled from existing submissions and view events so a milestone that already happened is never re-announced. `form.created_by` records the author (authorship for per-user analytics, never authorization; ownership stays with account_id). `member.last_seen_at` turns "N members exist" into "N exist, M came back". `account.attribution` is reserved — nothing writes it yet. Every column is nullable and NULL stays a meaningful "not known"; the drizzle schemas are updated in parity across both dialects.
- c8f6b74: The five product-analytics events, emitted at their real call sites: `forms_signup_completed` (from a new SignupObserver port — accounts are materialized just-in-time inside the auth provider, so there is no signup endpoint to instrument), `forms_form_created` (create and duplicate), `forms_form_published` (carrying `is_first_publish`, emitted only when `publishForm`'s own UPDATE reports it fired), `forms_form_first_view` and `forms_activation`.

  The two milestone events are guarded by an ATOMIC CLAIM on the account row, not a read-then-act query: the obvious "does an earlier one exist?" check double-fires on a re-submitted session and, worse, permanently misses when two answers land at the same instant — both reproduced against the real service and now covered by regression tests.

  What a bare fork does: `account.activated_at` and `account.first_viewed_at` are claimed UNCONDITIONALLY, because they are facts about a workspace rather than telemetry. Recording them lazily would mean every account that crossed a milestone while analytics was off announced it the day a key was finally set — the same false-conversion wave migration 0010's backfill prevents, just triggered by env timing. The cost is one primary-key UPDATE that matches nothing (no row lock, no WAL) after the first answer. Everything else IS gated: no event is captured, no outbox row is written, `member.last_seen_at` is not touched, and no browser script is loaded without a key. The claims never throw into a user path — a lost claim is retried by the next answer; a failed submission is not recoverable.

  Also writes `form.created_by` from the resolved principal, never request input.

- 72a7876: Product analytics plumbing (no events emitted yet). Adds `attributionSchema` to @quill/types (the contract for the first-touch acquisition blob that migration 0010 persists on `account.attribution`), an `analytics` outbox kind, and the `PRODUCT_ANALYTICS_KEY` / `NEXT_PUBLIC_PRODUCT_ANALYTICS_KEY` env pair (plus hosts). Server-side events enqueue through the outbox and drain with retry/backoff — never inline, because the most important event fires on the public submission path. The browser half loads only on the admin dashboard, identifies by email, and registers `product: 'forms'` plus a `forms_account` group as super properties. Deliberately NOT named `NEXT_PUBLIC_POSTHOG_*`: those already exist and belong to the form owner's own pixels on their public form page. Unset (the default) = fully off, so a bare fork makes zero third-party requests.
- 310f098: Build the public member page the handle URL always promised.

  `/[accountCode]/[handle]` has existed in the routing shape since the first
  public form link, but nothing was ever built at that level — only
  `[handle]/[slug]` — so trimming a form link back to see "who is this" hit a real 404. It was never broken; it was never written.

  `memberProfileSchema` is the contract (versioned like the form config, extended
  the same way: add optional fields, never repurpose one), stored as one JSON blob
  on a new nullable `member.profile` column. One column rather than a
  bio/links/design column each, matching the `form.config` pattern — which is
  exactly why this is the only schema change in the whole branch.

  **Nothing is published by default.** The column defaults to NULL and `enabled`
  defaults to false, and the endpoint returns 404 for a missing member, a missing
  profile and a disabled one alike. A migration that quietly published a page
  about every member would be the wrong default in every sense.

  `formSlugs` absent lists every published form; `formSlugs: []` lists none, and
  the two are deliberately different — an author who unlists everything must not
  get everything back. Only a form's name and slug cross the boundary: no steps,
  no destination config, no drafts.

  The page reuses `resolveDesign` and the public stylesheet rather than inventing
  a second set of colours and typefaces, so a profile and the forms it links to
  can be made to match. Handles match case-insensitively, since a handle URL gets
  typed by hand far more often than a slug does.

  Migration `0008_member_profile` in both dialects. Additive and nullable: old
  code ignores the column entirely, so deploy order does not matter and a rollback
  needs no down-migration.

- 115e213: Salesforce as a submission destination. A workspace connects its org once with
  Client Credentials (My Domain, consumer key, consumer secret, stored encrypted
  as one value), and each form maps questions, UTMs, score, submission date and
  fixed values to Lead fields. A delivery finds the respondent by email first
  (a Contact, then an unconverted Lead) and updates it, and creates a Lead only
  when neither exists, so a person who answers twice is not duplicated (two
  submissions from one email at the same instant can still race; an org's own
  duplicate rules close that). Transient refusals (the API limit, lock
  contention, a query timeout) are retried. Complete submissions only.
- 002d388: Optional spam protection: a human check before a form's final submit, verified by the API.

  A form owner turns it on per form in the Connect tab, and it applies on Publish. It
  runs right above the button that ends the form (the one-page Submit, or the last
  step's button in slides), loading once the person has started and that button is on
  screen, so the page never changes for it; a finish with no button (a single choice
  that advances by itself, a reveal or a scheduler as the last step) runs it on the
  submitting screen instead. In Automatic mode most people never see it; in Strict
  mode everyone sees the check, and the API adds two checks of its own: a hidden
  field no person can reach, and a minimum fill time of 2 s from the session's first
  view (a session with no recorded view is never blocked).

  With protection on, one rule: a partial is saved and never delivered; a complete
  is verified, then saved and delivered. The submissions endpoint is public, so the
  API is the gate: a complete without a valid token is refused with 403 and nothing
  is written, whoever sends it. When the check cannot run (the widget fails, or the
  provider is down), the answers are kept as a partial and the respondent is asked
  to try again. The booking callback can no longer upsert a CRM contact for a session
  that has not completed when the sync runs, unless the booking provider itself
  returned the invitee.

  - `@quill/types`: `formConfigSchema.spamProtection` (additive, absent is off),
    `publicFormSchema.captcha`, `submissionSchema.captchaToken` and `hp`, and
    `captchaCData` and `CAPTCHA_ACTION`, the session stamp and the action both
    halves compare.
  - `@quill/config`: `CAPTCHA_SITE_KEY`, `CAPTCHA_SECRET_KEY`, `CAPTCHA_PROVIDER`
    (`none` is a kill switch) and `CAPTCHA_VERIFY_TIMEOUT_MS`, plus `captchaSettings`.
    Both keys unset is the default and means the feature does not exist; one key
    without the other refuses to boot.
  - `@quill/db`: the account webhook inventory says whether the owning form has the
    switch on, and `firstSessionViewAt` reads a session's first view.
  - `@quill/shared`: the respondent copy (the check's prompt, its failure and outage
    messages, the reload notice for a page opened before protection was turned on,
    and localized `RATE_LIMITED` and `ANSWER_TOO_LONG`, which respondents used to
    read in English) and the editor copy, in English and Spanish.

- c265f0f: Type-to-find in the workspace switcher, and estate-wide access for the
  deployment's staff.

  - The switcher's menu has a search box (from six workspaces, or always for
    staff): typing filters your own workspaces instantly. Own workspaces list
    first; the ones you hold by access grant carry a Staff badge.
  - `IAM_STAFF_DOMAINS` (comma-separated email domains; unset = nobody, every
    fork) names the deployment's staff. With the identity service configured,
    a person on one of those domains ALSO searches the whole estate, the way the
    Dapta app's sidebar does (`GET /workspace/search?query=`), and can enter any
    workspace of it. Nothing is projected by looking: entering one re-reads the
    workspace upstream, projects it (no onboarding stamp, no demo form, no signup
    event) and mints an `admin` row marked `member.access_grant = 'staff'`.
  - Migration 0016: `member.access_grant` (nullable). Grant rows are excluded
    from rosters and member counts (a customer's team list never shows staff),
    never send the wizard to the staff member, are never pruned by the
    membership projection, and turn into a real membership the moment upstream
    names the person. "First member" (demo form, signup) counts real memberships
    only, so an account a grant created ahead of its owner still welcomes the
    owner.
  - API: `GET /v1/workspaces/search?q=&page=`, `POST
/v1/workspaces/estate/:workspaceId/enter`; `/v1/me` carries `staff` and
    `accessGrant`.

- 27c3a63: Submissions: `deleteSubmissionsForAccount` deletes a selection of one form's submissions in a single statement, scoped to the account like the single delete (a foreign id is never touched), at most `MAX_BULK_SUBMISSIONS` (100) ids. `allSubmissionsForExport` takes an optional `ids` list so a CSV can carry only the selected rows.
- 0b8b150: One `SubmissionFilter` for the submissions table, its CSV export, the Summary
  and its answer search: status, a `started_at` window, inclusive score bounds
  (`scoreMin`, `scoreMax`, rounded inward to whole numbers and held to int32, so
  `5.5` or `1e20` narrows instead of failing the query on Postgres) and answer
  filters (`answers`, question key to the
  values accepted). Within one key any value matches, and a multi-select matches
  when any of its picks is accepted; across keys every one must match. The
  answers are read from the stored JSON on both dialects (Postgres `jsonb_each`,
  SQLite `json_each`, the key compared as a value so any key matches the same on
  both), a single stored value and an array alike, trimmed the way
  the Summary counts them, with the key and every value as bound parameters.
  Callers must check the keys against the form's own choice steps first.

  `querySubmissions` and `allSubmissionsForExport` take a `sort` (`newest`,
  `oldest`, `score_desc`, `score_asc`), every order ending on the id so a page
  boundary never shuffles ties. `SUBMISSION_SORTS` lists them.

  `submissionFacetCounts(db, formId, keys)` counts what the header filters offer
  in the database: the total, completed and partial, and per question key how
  many responses answered it and how many picked each trimmed value. Only counts
  leave the database, however many responses a form has.

- 504224b: `searchSubmissionAnswers(db, formId, fields, query)` pages through one
  question's answers, newest first, with the total before pagination: a
  case-insensitive substring match (accents are not folded), the needle always a
  bound parameter, on SQLite and Postgres alike, under the same status and date
  filter as the submissions table. `getSubmissionAnswersForAccount` now returns
  the whole submission row (id, score, started, completed and partial instants
  next to `formId` and `data`), still read through the account join.

  `submissionsForSummary(db, formId, filter)` reads every submission matching the
  table's filter, newest first, with only the columns the Summary aggregates
  (id, answers, started, completed and partial instants).

- 8e84fcf: The language of the product is a setting you can change.

  The admin has been translated into English and Spanish since the first-run
  wizard, but the wizard was the only thing that ever chose: it read the browser's
  `Accept-Language` once, stored it, and there was no control anywhere to change
  it afterwards. Anyone whose browser asked for the wrong one, or who simply
  changed their mind, was stuck with it.

  Account settings has a fifth entry, Preferences, and the choice lives there. It
  is the area's only per-person setting, so unlike its four neighbours it names no
  workspace: your language follows you into every workspace you open, and a
  teammate reading the same workspace in the other language is not a conflict. It
  is not admin-gated either, for the same reason.

  The whole admin re-renders immediately, not just the page carrying the control.
  The two options are written each in its own language ("English", "Español") and
  never translate, because the person most likely to be looking for this control
  is the one who cannot currently read the page it is on.

  Details worth knowing:

  - `PUT /v1/me/locale` is the new endpoint. Scoped to the caller's own
    membership, which is what makes it safe not to gate: there is no parameter
    through which one person could set another's language.
  - The choice is stored on the member row, not only in a browser cookie. That is
    what makes it a user setting rather than a per-device one, and `member.locale`
    is also what selects the language of the submission notification emails an
    account sends. That column has been read for those emails all along and never
    written, so until now every one of them went out in English.
  - Signing in on a browser that has no cookie yet now picks the stored choice up,
    instead of starting over in English.
  - `<html lang>` carries the language actually being rendered. It was hardcoded
    `en`, so a Spanish dashboard had been telling screen readers, translation
    tools and search engines it was English. Public forms declare their own
    language on their own subtree, which is decided by `?lang=` and the visitor's
    browser as before: an author's dashboard preference does not follow a
    respondent.
  - A member who has never chosen still renders in English, exactly as today.

- 310f098: Workspace brand kit: one place to define the account's look, snapshotted into
  forms.

  `brandKitSchema` (types) is the identity subset of a form's branding — logo,
  client logos, the three colors, typography, radius, button style — with
  `BRAND_KIT_FIELDS` as the single source of truth for what an apply overwrites.
  The kit is stored per account in the new additive `account_branding` table
  (migration 0009, both dialects), and forms snapshot it: new forms merge it into
  their initial config, and `applyBrandKit` merges only the kit-managed fields
  into each selected form's live config AND a pending draft (so publishing can't
  silently undo the brand), backing up the previous branding in the new
  `form.brand_backup` column so `revertBrandKit` is an exact one-level undo.
  Nothing resolves live at render — the engine and public renderer are untouched.

- 4e8fa20: Add the workspace link page: one public page per workspace at
  `/{accountCode}`, with the workspace's logo, name and bio, an ordered column of
  buttons that mixes the forms the team chose with custom links, and a row of
  social icons (Instagram, X, YouTube, TikTok, WhatsApp).

  `linkPageSchema` is the contract, versioned like the form config. Socials are
  normalized on the way in: a handle or a link without its scheme becomes an
  `https://` link on that network's own hosts (handles follow each network's
  rules, so `@your.brand` works on Instagram and TikTok). A WhatsApp number must
  be entered with its country code (`+` or `00`), is stored as digits and opens
  as a `wa.me` click-to-chat link; `parseStoredLinkPage` and `linkPageToInput`
  read a stored page back. `LINK_PAGE_MAX_BODY_BYTES` is the body ceiling the
  save route accepts, above the largest page the schema allows. A form
  button points at the form by id, so renaming its link never drops it, and a
  deleted form drops out of the page instead of leaving a broken button.
  `resolveLinkPage` decides what the page shows, for the public page and the
  editor's preview alike. The brand kit styles the page live, on top of the
  colours a new form is born with.

  Stored as one JSON blob on a new nullable `account.link_page` column (migration
  `0025_workspace_link_page`, both dialects). Additive: nothing is published by
  the migration, and the page answers 404 until someone in the workspace turns it
  on.

  The catalog gains the page's public strings (`linkPage`) and its editor
  (`admin.linkPage`), in English and Spanish.

- 310f098: Let a person work in more than one workspace.

  The data model always allowed it — uniqueness on `member` is per account, and
  `inviteMember` writes a row into the INVITING account — but nothing ever read it
  back. Login resolved a single row and stopped (`ORDER BY created_at LIMIT 1`), so
  an invited teammate signed in and landed in their own oldest account. Every
  invitation was a dead end.

  `listWorkspacesForIdentity` is the query that was missing: every account where a
  person holds a membership, matched on the IAM subject when there is one and on
  their email address otherwise, because an invite only ever knew the address.
  Invited rows are listed — an invitation you cannot see is one that does not work,
  and opening it is what accepting means. Disabled rows never appear.

  `findMembership` is the authorization check behind the switch, and the reason
  this is safe: the workspace is named by a request header, that header proves
  nothing, and membership is re-derived from the database on every request. An
  account the caller has no row in is a 403 — deliberately not a quiet fall back to
  their home account, because a quiet fallback puts writes into a tenant the person
  did not believe they were in.

- 2f17c60: A workspace timezone: every date in the admin, the analytics day cuts and the CSV local columns read in one shared zone.

  Until now every timestamp in the dashboard was rendered on the server's clock
  (UTC) and the analytics buckets were UTC days, so a team in Bogota read its
  evening submissions as tomorrow's. The workspace now carries one IANA zone
  (`account.timezone`, migration 0020) that everyone in it shares.

  - **Default**: the first owner or admin to open the dashboard while the zone
    is unset seeds it from their browser (a write-once claim, so two admins in
    different zones cannot flip it), with a toast saying where to change it.
    Staff entering an estate workspace never seed it. Until then dates read in
    UTC, exactly as before.
  - **Two places to change it**, both writing the same column through
    `PATCH /v1/workspaces/current/timezone` (admin/owner): Account settings,
    under the workspace name, and a dropdown beside the submissions filter.
    A member sees the zone with a lock and the note that only an admin can
    change it.
  - **Dates**: the forms list, the submissions table, the delivery history,
    the webhook health line and the brand kit stamp all go through
    `formatDateTime` / `formatDate` in `@quill/shared` (Intl only; an unknown
    zone renders as UTC with a warning, never a 500).
  - **Analytics**: day buckets are named in the workspace zone inside SQL
    (`(col + offset) / 86400000` with the offset picked by a CASE over the DST
    boundaries of the queried window), the range presets and custom dates cut
    at local midnight, the picker's "today" is the zone's today, `?tz=` can
    override per request, the response echoes `range.timeZone`, and a caption
    under the trends chart names the zone.
  - **CSV export** keeps `started_at` / `completed_at` in UTC (`Z`) and adds
    `started_at_local` / `completed_at_local` as ISO with the zone offset
    (`2026-09-03T18:30:15-05:00`).
  - `@quill/shared`: `datetime.ts` (`isValidTimeZone`, `resolveTimeZone`,
    `tzOffsetMs`, `localDayIndex`, `zonedMidnightMs`, `dayBoundsInZone`,
    `isoDateInZone`, `utcOffsetSegments`, `formatDateTime`, `formatDate`,
    `formatIsoWithOffset`). `@quill/types`: `timeZoneSchema`,
    `workspaceTimezoneSchema`, `analyticsResponseSchema.range.timeZone`.
  - i18n: `admin.settings.workspaceTimezone*`, `admin.submissions.timezone*`,
    `admin.analytics.timezoneNote`, `admin.chrome.timezoneAutoSet` (EN + ES).

### Patch Changes

- 3497551: Make concurrent final submissions claim completion atomically so only one caller reports the first completion.
- f09c56c: One rule for which spreadsheet columns are in the sheet: a column is written if and only if it has a heading.

  - `@quill/types`: a Google Sheets column's `header` may be empty, so a column the author has added but not named yet can be stored. `isWritableSheetColumn` (a heading, nothing else), `writableSheetColumns` and `destinationIsDeliverable` are the one rule every reader uses. A heading with no answer chosen yet is written, with empty cells, which is also what configs with `{header, source: 'answer'}` and no key always meant. Configs stored before this keep parsing unchanged.
  - `@quill/types`: a Sheets destination may also carry `headerForeign`, API-owned bookkeeping for a row 1 it found it may not write, so a failed header sync is retried and a foreign row is not re-read on every save.
  - `@quill/types`: HubSpot and Salesforce destinations may carry `drafts`, the rows an author started and has not finished, stored so they survive a reload and never read by a delivery or the HubSpot mirror form. A Sheets destination may carry `headerBroken`, API-owned, so a sync that failed for good is not retried on every save.
  - `@quill/db`: `duplicateForm` and `withoutOwnedMirrorState` also drop the Google Sheets header bookkeeping (`headerSnapshot`, `headerForeign`, `headerBroken`), which only the API writes.
  - `@quill/db`: `updateFormDestinations` takes an optional `expectedUpdatedAt` for a compare-and-swap write, refused as `STALE` when another write landed since the read. Without it, the write is unchanged.
  - `@quill/destinations`: the Google Sheets adapter writes only the columns that rule names, so a delivered row always lines up with row 1.
  - `@quill/shared`: copy for a column with no heading and for one with nothing chosen to fill it, for a row 1 that fell out of date, for a sheet with no named column, for a change lost after leaving the tab, and a short label for the save pill, in English and Spanish.

- d25eef2: A delivery the provider refused is no longer shown as delivered.

  When Salesforce, HubSpot or Google Sheets refused a response for good (a
  validation error such as a last name that is too long, a sheet that no longer
  exists, a CRM that is not connected, a response with no email to key on), the
  delivery was recorded as `done` and the form's history showed it as
  "Delivered", even though the lead never arrived. Those rows are now recorded
  as `skipped`, with the provider's reason, and are never retried.

  - `@quill/db`: `markOutboxSkipped` accepts an optional `transcript`, so a
    skipped row keeps what was sent and what the provider answered, the same
    way `done`, retried and `failed` rows already do. Without one, the stored
    transcript is left alone.
  - `@quill/shared`: the history label for a skipped row reads "Not delivered"
    ("No entregada") instead of "Skipped" ("Omitida"), and the Spanish history
    help text speaks to the reader with "tú".

- 8699deb: Duplicating a form no longer copies the HubSpot mirror-form pointer (`settings.formGuid` / `formSignature`). The pointer is API-owned state naming the mirror form minted for the ORIGINAL: a copy that inherited it posted its submissions at the original's form (every lead the copy collected showed up attributed to the original), and integration saves on either form renamed the shared mirror back and forth. The copy now sheds the pair, so its first integrations save mints a mirror of its own; everything else in the config still copies verbatim.
- a6ae6f7: Groundwork for a HighLevel destination. Nothing can connect or deliver to HighLevel yet, and no screen offers it.

  - `@quill/types`: a `gohighlevel` destination type with its schema (mappings to a standard contact field or to a custom field by id, key and type; UTMs, score and submitted date to custom fields; `dayTimezone`, `staticFields`, `tags`, `source`, `drafts`, `events`), the standard field catalog, the custom field types, which ones each kind of mapping may target (`goHighLevelSlotAccepts`), and the shapes the connect and fields routes and the adapter will use. At most one per form, through `extraOnePerFormDestination`, which also carries the HubSpot and Salesforce rules with their messages unchanged.
  - `@quill/types`: `destinationFiresForPhase` reads an explicit `events` on HubSpot and Salesforce destinations too. Without one, HubSpot still fires on both phases and Salesforce on complete only, so every stored config behaves as before. A HighLevel destination without `events` fires on complete only. Google Sheets stays complete only.
  - `@quill/db`: `gohighlevel` is an integration provider and an outbox kind.
  - `@quill/destinations`: the factory turns a `gohighlevel` delivery into a named no-op until the adapter exists.
  - `@quill/mcp`: the form config JSON Schema (the guide's `config_schema` and the skill's `form-config.schema.json`) leaves out the HighLevel destination and the `events` of HubSpot and Salesforce destinations, which the editor has no control for yet. A refusal for a provider no deployment can connect yet gets its own hint instead of the one that sends the user to whoever runs the deployment.
  - `@quill/shared`: reserved HighLevel copy in English and Spanish: the provider name, the connection errors and the delivery history reasons.

- 2fd4ed6: MCP review fixes. `get_response` carries the same answer shape (`step_key`, `type`, `step_removed`) and `outcome` as `list_responses`. `list_deliveries` says it reads failed and skipped deliveries by default, as the REST route does, and its summary counts the two apart. `search_answers` steps `next_offset` by the page read, so a page the service trimmed is never read twice. `export_responses_csv` documents that its character cap counts the header and that the first row always comes back. `@quill/db` adds `firstSubmissionsForExport`: the first rows of the CSV export, same filter and order, with the count of the whole export.
- 4fd4097: `notePersonLogins` stamps one person's active memberships in the accounts the identity service confirmed and `staffGrantsBySubject` reads the grants an MCP sign-in may reach. The MCP server never uses a workspace reached through a staff access grant without `workspace_id`, even when it is the only one.
- 14ee2b0: The link an MCP sign-in maps through, in both dialects (migration 0026, additive): the nullable `member.idp_subject` (the external authorization server's user id, one member per account) and `member.login_seen_at` (when the identity service last vouched for the member at a verified web login), with `recordMemberIdpSubject`, `noteMemberLogin`, `memberIdpLink` and `membershipsBySubject` to write and read it. The SQLite `txn` handle takes `{ immediate: true }`. The config adds `OAUTH_LINK_MAX_AGE_DAYS` (30 by default, 1 to 365) and drops the `IAM_DB_*` settings.
- 350a76f: Apply each migration script and its tracking marker in one dialect-native transaction, so a failed migration leaves no partial schema and concurrent migrators apply it exactly once.
- fb87b34: The demo seed prints its form at the neutral link, `/acme/f/lead-qualifier`.

  A form's public URL no longer names a member: every link the product hands out
  is `/{accountCode}/f/{slug}`, and `seed()` now returns `formPath` in that same
  shape, so `pnpm db:seed` and `pnpm db:reset` stop teaching the old one. The
  seeded owner keeps the `alex-rivera` handle, and the old link still serves the
  form.

- e39084f: `google-sheets` is an outbox kind. A destination's outbox kind is its type, and
  Google Sheets was missing from the list, behind a cast.
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

- 6598cd6: A partial save can no longer overwrite a submission that was completed while it was in flight.

  `upsertSubmission` already ignored a partial that arrived after the complete, but only by what its first read saw. A partial that read the row while it was still open, and wrote after the complete committed, replaced the completed data and score with its own. The partial's update now carries `completed_at IS NULL` in its `WHERE`, so the race resolves in the database: the completed row is left as it is. This matters now that the public form sends its partial and complete saves in parallel.

- d1e9944: Retune the platform's default look, and make the light theme a real one.

  **Tokens.** The accent now has three jobs and three values instead of one:
  `--primary` is the FILL, `--primary-ink` the LETTERS, `--primary-edge` the LINES.
  That third one is what the light theme was missing — the raw lime measures 1.27:1
  on paper, so every border, focus ring and selected outline drawn with it was an
  indicator nobody could see. `formThemeVars` now emits `--pf-primary-edge` for an
  authored form too, clamped only when the author's colour would have been
  invisible: a colour that already reads is passed through untouched, exactly like
  `--pf-primary` itself.

  `--faint` gains a real value on dark (it measured 4.28:1 on `--muted`, under AA
  for the 10px it carries) and `--brand-ink` / `--brand-ink-foreground` arrive as
  the one pair in the file that does NOT flip with the theme — a ground for fixed
  colour third-party artwork, which cannot follow a scheme it does not know about.

  The dark block is now `:root, [data-theme='dark']` rather than `:root` alone. One
  declaration, no second copy, and it makes the palette re-establishable on a
  SUBTREE: that is what lets a public form pin itself to the product default inside
  an admin document that chose light.

  **Engine.** `DEFAULT_FORM_FONT` moves to Figtree, and `FORM_FONTS` swaps `visby`
  for `figtree`. The retired value never left an unpushed branch, so no stored
  config references it. The list may only ever hold freely-redistributable faces —
  `next/font` bakes every curated face into the build and therefore into the
  repository, so a licensed commercial face cannot be a member of this union no
  matter how well it reads.

  **Db.** The seeded demo form's accent stops being stock Tailwind indigo. Its job
  is to show that a form carries its OWNER's brand, and the colour nobody picked
  made the largest saturated object on the builder screen look like an unstyled
  default sitting next to our own Publish.

- c4b02d6: Security update of production dependencies.

  - `@quill/db`: drizzle-orm 0.45.4 (SQL injection through improperly escaped
    identifiers in earlier releases). A failed Postgres query still throws the
    driver's own error, with its SQLSTATE `code` and without the bound parameter
    values that drizzle-orm 0.44 and later add to the error message.
  - `@quill/notifications`: nodemailer 10.6.0 (address parser DoS, a raw message
    option that skipped the file and URL access guards, TLS validation in the
    OAuth2 token fetch). nodemailer now ships its own types, so
    `@types/nodemailer` is gone. The SMTP adapter's options and behavior are
    unchanged.

- 883ebd2: A completed response is now checked against the form it answers.

  `validateSubmission(config, answers)` walks the path the answers actually took
  (`answeredPath`: skip logic, forward jumps, cut at the first terminal step) and
  runs `validateAnswerCode` on every step on it, the same check the renderers run
  on each button. The API calls it on every complete, so an option the question
  does not have or a missing required answer is refused with `INVALID_ANSWERS`
  instead of being stored with an outcome. Steps off the path, hidden steps, URL
  prefills nobody saw and UTMs are never read, and partial saves are not checked.

  `renderer.errors.invalid_answers` is the respondent's copy for that refusal, in
  English and Spanish. `recordSettledDelivery` also records a `skipped` delivery,
  which the owner notice now uses when it has nobody to address.

- 9779aac: Score-sourced visibility conditions: a show/hide rule can reference the reserved
  `@score` source (the running score over the steps before the one being decided),
  offered in the builder as "Score so far" with numeric operators. Adds the public
  form title (`config.title`, additive) resolved everywhere through the new
  `publicTitle()` helper, surfaces it in the profile listing, and corrects the
  destination port's idempotency-key documentation.
- 42af101: A personal workspace whose upstream id equals its account id no longer destroys itself. `rebindLegacyAccount`'s two lookups resolved to the same row for those workspaces, so on the owner's second session the account parked itself (or, with no forms, deleted itself through the absorb branch), and every later login crashed on the parked row's unique `external_id`: a permanent lockout behind the "Something went wrong" screen. The rebind now recognizes the row as already bound and returns it untouched, and migration 0018 moves the stranded forms of every self-parked pair into their live twin, suffixing colliding slugs and retiring the parked account's public codes into `account_alias` so shared URLs keep resolving.
- 98b9031: Staff access grants never replace a membership and never hold a working API key.

  - `grantStaffAccess` only mints or reuses a grant row. A member row of the person that is not a grant (active, invited, or disabled by the workspace owner) is left untouched and the call throws the new `StaffGrantRefused` (`code: 'MEMBERSHIP_NOT_ACTIVE'`). A pending invitation by email is no longer adopted as the grant; it stays a member invite.
  - `pickHomeAccount` takes `{ includeGrants: false }` to never land on a grant row.
  - `findApiKeyPrincipal` returns the member's `accessGrant`; `listApiKeys` leaves out keys whose member is a grant row; a grant that becomes a real membership in `projectMemberships` has its API keys revoked.
  - New catalog keys: `admin.developers.keys.staffAccess` and `admin.settings.manageErrorMembershipNotActive`, in English and Spanish.

- 6f8004c: API keys a staff access grant holds are a workspace's keys like any other.

  - `listApiKeys` lists keys whose member is a staff access grant row, with the new `createdBy.staff: true`.
  - A grant that becomes a real membership in `projectMemberships` keeps its API keys: they become that member's keys, with the member's role.
  - `findApiKeyPrincipal`'s `accessGrant` is informational now: a grant's key authenticates.
  - New catalog key `admin.developers.keys.createdByStaff`; `admin.developers.keys.staffAccess` now explains what a key created through staff access is, in English and Spanish.

- 59054fe: Staff requests stop crawling, and the staff search finds workspaces by what staff actually hold.

  - A staff person's workspace refresh no longer pages through the whole estate (to a staff token the unscoped upstream search answers with every workspace there is; reading thousands of rows on every TTL and every switcher open made each request take 10 to 50 seconds). It now reads the workspaces of their own upstream account (the search scoped with `accountId`) plus, in parallel, every workspace this database already knows them in, so revoked memberships are still disabled and a grant whose workspace now names them still becomes the real membership. A membership in someone else's account that was never projected is found when they enter it from the estate search, which projects that one workspace directly.
  - The staff search also matches the accounts this database already projected by workspace name, member email or form name (the identity service only knows names, and staff usually hold a form link or the customer's address). Such rows say why they matched (the email, or "Form: name"), in the switcher and on the Account settings cards.

- 3863535: Fence outbox settlement updates to the worker lease that claimed the row.
  Settlement calls now report whether the lease still owns the row. The worker
  claims each row immediately before its effect.

  Each claim now receives an opaque `claimed_by` token. Stale or ambiguous claims
  cannot settle another generation. Each stale reclaim charges one attempt, and
  `maxAttempts` bounds replay. Mixed versions are unsupported and require a
  coordinated stop/drain cutover. Delivery remains at-least-once: a
  crash-before-effect can consume one attempt, and a prior effect can still
  succeed after the row is recorded as outcome-unknown failed.

- 9850238: Editor saves and publishes carry an optimistic lock.

  Two people (or two tabs) editing the same form used to be last-writer-wins
  with no warning: every autosave sent the whole snapshot, and whichever landed
  last silently threw away the other's edits. A redirect URL was lost this way
  on 2026-09-17 while a customer and the team edited one form together.

  `PUT /v1/forms/:id` and `POST /v1/forms/:id/publish` accept an optional
  `expectedUpdatedAt`: the `updatedAt` the client loaded or last received. A
  write whose stamp is behind the row is refused with 409 `STALE`, and the
  refusal carries the row as it is now. Without the field, behavior is
  unchanged, so tabs open across the deploy keep saving.

  The editor sends the stamp on every save, the publish, and the unload flush.
  A refusal whose server content is what this editor last saved (only the stamp
  moved: its own slug rename, a CRM mapping save) is resolved silently. Anything
  else shows a banner with the two ways out: see the saved version (the local
  backup offers this tab's edits back on reload) or keep mine.

- 3337eb6: `upsertSubmission` now reports `wasCompletedBefore` — whether the session's row
  was already completed when the write arrived. The row was always idempotent per
  session; this flag lets callers make its downstream effects (emails, CRM
  deliveries) idempotent too, firing them only on the first completion instead of
  on every transport-retry re-landing of the same one.
- 7654c59: Account settings names workspaces by the same id the Dapta app does.

  - `/admin/account/workspaces/<id>` now carries the identity service's workspace id when the workspace was projected from one (the local account id otherwise). Both ids are accepted; a link with the local id of a projected workspace redirects to the canonical one.
  - The workspace page shows that id in its header with a copy control, so support threads, the admin panel and the two apps all name a workspace the same way.
  - Workspace rows (`GET /v1/workspaces`, the search) carry `workspaceId` (the upstream id, null for local-only accounts) next to `accountId`; the API itself still speaks `accountId` everywhere.
  - Account settings, Workspaces: the deployment's staff search the whole estate from the cards page too, the same way the rail switcher does; estate workspaces appear under their own heading with Open only.

- Updated dependencies [310f098]
- Updated dependencies [373627e]
- Updated dependencies [4a38827]
- Updated dependencies [bb7077e]
- Updated dependencies [2769426]
- Updated dependencies [67bd1e2]
- Updated dependencies [11af0cd]
- Updated dependencies [2364cd1]
- Updated dependencies [61067f7]
- Updated dependencies [4c94c6e]
- Updated dependencies [f09c56c]
- Updated dependencies [310f098]
- Updated dependencies [d69e261]
- Updated dependencies [b612c96]
- Updated dependencies [919dbdb]
- Updated dependencies [531f8d9]
- Updated dependencies [9b42f40]
- Updated dependencies [468262a]
- Updated dependencies [e50736f]
- Updated dependencies [7eea7be]
- Updated dependencies [d58e464]
- Updated dependencies [e877d55]
- Updated dependencies [59f1bbf]
- Updated dependencies [cbcef9c]
- Updated dependencies [8009d2d]
- Updated dependencies [40fe6fe]
- Updated dependencies [b8322ea]
- Updated dependencies [310f098]
- Updated dependencies [acb8823]
- Updated dependencies [42ec808]
- Updated dependencies [0a83bde]
- Updated dependencies [68aa3b2]
- Updated dependencies [a6ae6f7]
- Updated dependencies [28ab19d]
- Updated dependencies [dc73f54]
- Updated dependencies [310f098]
- Updated dependencies [bd31b39]
- Updated dependencies [036d5fd]
- Updated dependencies [f7875dc]
- Updated dependencies [daaabf2]
- Updated dependencies [6855ca8]
- Updated dependencies [de8df64]
- Updated dependencies [be7d8d1]
- Updated dependencies [af7d5c2]
- Updated dependencies [310f098]
- Updated dependencies [c6007cb]
- Updated dependencies [64f3baa]
- Updated dependencies [88795e5]
- Updated dependencies [bfb3d2c]
- Updated dependencies [bfece62]
- Updated dependencies [dd911c2]
- Updated dependencies [0124b1c]
- Updated dependencies [7b087af]
- Updated dependencies [b8ff7fb]
- Updated dependencies [f790dda]
- Updated dependencies [310f098]
- Updated dependencies [11435a8]
- Updated dependencies [310f098]
- Updated dependencies [c97e73e]
- Updated dependencies [505df64]
- Updated dependencies [dfc514f]
- Updated dependencies [2c41cb0]
- Updated dependencies [a6b7fcf]
- Updated dependencies [91847eb]
- Updated dependencies [d1e9944]
- Updated dependencies [72a7876]
- Updated dependencies [310f098]
- Updated dependencies [883ebd2]
- Updated dependencies [e802b03]
- Updated dependencies [1bfeaa1]
- Updated dependencies [c50ed94]
- Updated dependencies [d62a3b5]
- Updated dependencies [115e213]
- Updated dependencies [9779aac]
- Updated dependencies [59a4a66]
- Updated dependencies [002d388]
- Updated dependencies [9850238]
- Updated dependencies [b8fcd1c]
- Updated dependencies [0b8b150]
- Updated dependencies [504224b]
- Updated dependencies [cf9eb95]
- Updated dependencies [e7cb7a0]
- Updated dependencies [d85aeb5]
- Updated dependencies [8e84fcf]
- Updated dependencies [310f098]
- Updated dependencies [310f098]
- Updated dependencies [4e8fa20]
- Updated dependencies [2f17c60]
  - @quill/engine@0.1.0
  - @quill/types@0.1.0
