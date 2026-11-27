# @quill/types

## 0.1.0

### Minor Changes

- 310f098: Give the question panel a hierarchy, and surface the URL prefill nobody could
  find.

  The panel was seventeen sections in one flat scroll, all weighted the same, so
  the two controls an author touches constantly sat beside the one that renames an
  answer key and cascades through every condition, goto, variant and CRM mapping.
  Conditional visibility, dynamic question, behaviour flags, the field key and
  per-question scoring now live in a collapsed **Advanced settings** group.

  **Skip-logic stays out of it.** Forward rules (`goto`) are the reason someone
  picks this over a plain form builder; burying them would hide the product's own
  argument. Show/hide conditions moved in, per the same judgement applied the other
  way: they are declarative and rarely revisited once set.

  **The badges are load-bearing, not decoration.** A collapsed group that hid a
  question being conditional, terminal or hidden would be strictly worse than the
  flat list it replaces — the author would see a clean question and have no idea it
  behaves differently. The header names what is configured inside, in the same
  vocabulary the left spine already uses, and the group opens on its own when
  anything is set.

  **URL prefill existed and was invisible.** `capturePrefill` already seeds any
  declared field key from the query string, visible questions included — the
  runtime has done this all along. What never existed was any way to learn that the
  parameter _is_ the field key. The new row states it and shows a copyable example
  built from the question's own type and options, so a choice question does not
  demonstrate itself with an email address. A `name` step shows both of its
  subfield parameters, because showing one would be wrong. A key beginning `utm_`
  gets a warning instead of an example: those are captured separately as campaign
  data, so prefill silently does nothing for them.

  **New: a default answer.** `defaultValue` on a step, seeded by `captureDefaults`
  in both renderers with the precedence `default < URL < what the person types`. A
  campaign link carrying `?email=` has to beat a default the author set months
  earlier, or the link would quietly do nothing. `name` and `scheduler` steps take
  none — one writes two subfields, the other's answer is a booking.

  The per-question HubSpot mapping leaves the panel. The Connect tab already
  carries the full mapping with auto-map, custom rows and value maps; two places to
  set the same thing is how they drift apart.

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

- 4a38827: Forms can render the attribution badge at a smaller size, chosen in the Design panel. Existing forms are unchanged.

  The "Made with" pill is fixed at one size on every public surface, and on a form
  run as a paid-traffic landing page it is the loudest thing on screen that is not
  the author's own brand. Design now offers it as an axis, `badgeSize`, beside the
  logo controls: two values, Small and Medium.

  Two values rather than three. `logoSize` carries a Large because the host's own
  logo is the point of the page; nobody has asked for the attribution to be bigger
  than it already is, and every value is CSS plus a toggle segment forever.

  Medium is the default and is the size the pill has always rendered at, so an
  absent value resolves to the exact pixels a published form already shows. That
  is the same additive-config rule every other design axis follows.

  Small shrinks the pill AND the wrapper around it. Shrinking the pill alone would
  leave the space it used to fill, and the resulting hole reads worse than the
  larger badge did. The wrapper has four context-dependent paddings (the base, the
  cover footer, the one-page layout, and the wide band where the pill attaches
  under the centred card), and all four come down together.

  The badge needs no new props: the design attributes are stamped on the form root
  and the pill is a descendant of it on all five of its call sites, so the live
  preview and the public page pick the size up at once. The builder canvas is not
  one of them, because it never draws the badge at all.

  It stays a per-form setting rather than joining the workspace brand kit, which
  carries identity (logo, colors, type, shape) and deliberately excludes every
  size token.

- bb7077e: An authorable promo banner, a reveal screen with a look, and client logos that
  can leave the cover.

  `cover.bannerColor`, `cover.bannerTextColor` and `cover.bannerSize` give the
  promo strip a fill, a text colour and one of three heights. Absent on any axis
  keeps the derived tint and padding the stylesheet has always applied.

  `formRevealSchema` gains a presentation: `loader` picks the animation
  (`spinner` — the default and the existing look — `bar`, `versus`, or `none`),
  `loaderSize` and `textSize` scale the mark and the copy across four steps,
  `accentBackground` floods the screen with the form's accent, and
  `versusYouLabel` / `versusMatchLabel` / `versusStatusLabel` name the two sides
  of the `versus` layout and the live status under the match. The new pure helper
  `resolveRevealPresentation` owns the defaults so the builder canvas and the
  public renderer cannot disagree about them. The `md` mark is pinned to the size
  this screen has always drawn, so an unconfigured reveal — and every form's
  submitting screen, which shares the same spinner — is unchanged.

  `cover.clientLogosScope` chooses where the "trusted by" marquee renders: the
  cover (absent — every existing config, and the only place it has ever shown),
  the reveal interstitial, or both. Resolved by the new pure helper
  `showClientLogosOn`, which keeps the existing `showClientLogos` master switch
  deciding first.

  **Behaviour change:** the one-page (`vertical`) layout now honours
  `cover.showClientLogos`. It previously ignored the toggle entirely, so a stored
  config with `layout: 'vertical'` and `showClientLogos: false` was still showing
  its marquee; after this it is hidden, as the slides layout already did.

  `@quill/shared` also exports `blendHex`, the TS twin of CSS `color-mix`, so the
  editor can run a contrast readout against a surface the stylesheet derives
  rather than stores.

- 67bd1e2: The booking date property records the day the lead BOOKED, and a form may carry
  only one HubSpot destination.

  **Behaviour change:** `hubspot.bookingSync.dateProperty` now receives the
  calendar day the booking happened, not the day of the meeting. The two differ
  whenever someone books ahead, and this property is what monthly "meetings
  booked" reporting counts by — a demo booked Aug 31 for Sep 3 was landing in
  September. The meeting's own start time is unaffected: it has always been, and
  remains, `hoursProperty`.

  Two consequences follow from the same change. The day is no longer gated on a
  resolvable meeting start — a provider that reports no start time still tells us
  a booking happened, so the date is written and only `hoursProperty` is skipped
  (this restores parity with the pilot this flow replaced). And the new
  `bookingSync.dateTimezone` chooses the IANA zone that day is floored in;
  blank/absent stays UTC, the platform default, so no stored config changes
  meaning. A portal reporting in `America/Bogota` should set it, or every booking
  from 19:00 local onwards is recorded on tomorrow. An unusable zone warns and
  falls back to UTC rather than failing the delivery.

  `@quill/types` also exports `hasExtraHubspotDestination` and
  `ONE_HUBSPOT_DESTINATION_MESSAGE`: a form may be written with at most one
  HubSpot destination. A second one is a trap because the three readers resolve
  the pair three different ways: the Connect screen edits the FIRST regardless of
  `enabled`, submit delivers EVERY enabled destination, and booking resolves the
  first ENABLED one. The second is therefore always invisible in the admin, and
  which of the two is doing anything depends on flags that screen never shows —
  on a disabled-first pair it is the second that runs bookings. It was a workaround
  from when a field mapping was one question → one property; a mapping now fans
  out to several, so the case is covered. Enforced on the two paths that AUTHOR a
  destinations array (`PUT /v1/forms/:id/destinations` and `POST /v1/forms`);
  `PUT /v1/forms/:id` stages a draft, and drafts strip the key. Deliberately NOT
  in `formConfigSchema` — a form that already stores two must keep parsing and
  stay editable, which is how it gets fixed — and deliberately not on duplicate,
  which copies stored state rather than authoring it, so the copy inherits the
  violation instead of becoming uncopyable. Multiple webhooks are unaffected.

  The rule is "never go UP", not "never hold two": `hasExtraHubspotDestination`
  takes the STORED array as its second argument and refuses only an increase.
  Several screens edit one field and write the whole array back — the builder's
  per-question property picker and its field-key rename both do — so a form that
  already carries two round-trips two on every unrelated save, and a count-only
  guard would refuse those writes and make the picker unusable on precisely the
  forms this rule exists to clean up.

  The Connect screen now says so: a form storing more than one HubSpot destination
  shows a notice on the HubSpot card that the extra one is invisible, is not
  running at booking time, and will be dropped when the tab next saves — the
  collapse was already the behaviour, silently.

- 11af0cd: Button text color, phone placeholder and no phone focus on a one-page form.

  - `branding.buttonTextColor` (`formBrandingSchema` and `FormBranding`): optional, nullable, validated as a CSS color. The label color of a solid button (`buttonStyle` resolved to `solid`): the Next / Submit button and the CTA of the final screen. Absent, `null` or blank keeps the automatic color that contrasts with `primaryColor`; ignored for `outline` and `soft`. Not part of the brand kit.
  - A `phone` step's `placeholder` now replaces the automatic number mask when it is not blank; absent or blank keeps the mask, which still follows the country.
  - On the one-page layout no question takes focus on load, the phone included, so an embedded form no longer scrolls its host page. Slides is unchanged.
  - i18n (EN + ES): `admin.editor.design.buttonTextColor`, `buttonTextAuto`, `buttonTextLowContrast`.
  - MCP: `branding.buttonTextColor` in the config schema with its description; the `phone` step type explains its placeholder.

- 61067f7: A `checkbox` question type: one native box with text beside it, for a consent line such as "I accept the privacy policy".

  - `FORM_FIELD_TYPES` gains `'checkbox'` (last), so `formFieldType`, the API v1 schema and the MCP schema accept it. No new step fields: `question` is the text beside the box, `required` blocks submit until it is checked, `helper` is an optional line under it.
  - Links in the text as `[text](https://url)`. Only http(s) links render as links (new tab); any other scheme stays literal text. Engine: `parseInlineLinks`, `inlineLinksPlainText`, `isCheckboxChecked`, `isHiddenStep`.
  - Checked stores `true`; unchecked stores nothing (never `false`). `canonicalizeAnswer` turns `'true'` into `true`. A checkbox question is shown as written: no `[key]` tokens and no question variants.
  - Validation: `validateAnswerCode` returns the new code `'consent'` for a required box left unchecked and `'option'` for any other value; `validateAnswer` says "Check the box to continue.". i18n: `renderer.errors.consent` (EN + ES).
  - `hidden`, `defaultValue` and URL prefill have no effect on a checkbox: it always shows and always starts unchecked.
  - `goto` and `terminal` have no effect on a checkbox either: `resolveGoto` and `answeredPath` skip them, and `resolveStepDisplay` drops both from the resolved step.
  - Answers: a check in the table, the CSV, the response panel, the owner email and the MCP; the column header shows the links as their text (`stepLabel`, `summarizeAnswersByStep`). `stepLabel` accepts an optional `type`.
  - MCP `get_form_guide`: the `checkbox` step type and a note that its question takes no placeholders.

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

- 310f098: Two new cover toggles, and an editor topbar that stops overflowing.

  `cover.bannerScope` chooses where the promo banner renders — every screen (the
  default, and what every existing config keeps doing) or the cover alone.
  `cover.showClientLogos` switches the "trusted by" marquee off without deleting
  the logos; only an explicit `false` hides it, so existing configs still show
  theirs. Both are additive optional fields, resolved by the new pure helpers
  `showBanner` and `showClientLogos`.

  The editor topbar no longer wraps its controls onto a second line or pushes
  Publish off-screen: the form-name input is now the bar's only elastic child,
  and the tab labels, link labels and publish pill each reveal at the width where
  they actually fit rather than all at once.

- d69e261: HubSpot date writes now follow the target property's type. A shared destination-level `dayTimezone` (IANA zone, blank = UTC) names the calendar day for every `date`-type property the destination writes (the submitted date and the booking date), while `datetime`-type targets receive the exact instant and never use it. The submit-time adapter takes `datePropertyType` and `dayTimezone` options, a meeting-time property that turns out to be `date`-typed gets the meeting day instead of a value HubSpot rejects, and the shared `dayMidnightMs`/`utcMidnightMs` helpers move into `@quill/destinations`. The editor reveals a searchable timezone picker beside each date-type pick, all instances editing the one shared value; `bookingSync.dateTimezone` remains as the read fallback so stored configs keep their zone.
- 531f8d9: Add dCal as a third scheduling provider, beside Calendly and HubSpot Meetings.
  `bookingProvider` and `formSchedulerSchema.provider` accept `dcal`, and the
  public booking callback gains an optional `bookingUid`: dCal names a booking
  rather than addressing it, and `eventUri` is validated as a URL and fetched as
  one by the HubSpot booking sync, so a uid could not share that field.

  dCal needs no connected credential. It projects the same identity service this
  app does, so the author's own session is what lists their event types, and the
  page it embeds is a plain URL.

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
- cbcef9c: Open an uploaded file in the dashboard instead of only downloading it.

  Every signed URL was an attachment, so the filename in the submissions table
  put a copy on disk and nothing else. An owner reading fifty applications ended
  up with fifty files in a downloads folder to read fifty documents. The filename
  now opens a dialog that shows the file, with the download inside it.

  Images, PDFs and plain text are drawn by the browser from the URL itself. Word
  documents are converted in the dashboard and shown in a frame that can run
  nothing, which is what makes it safe to render a stranger's document without
  picking through its markup first. The conversion is readable rather than exact,
  it loses columns and page furniture, and the dialog says so instead of implying
  the layout survived. Anything else, a spreadsheet or an archive or a Word file
  older than 2007, downloads on the first click as before: a dialog whose only
  content is a download button is a click of ceremony in front of the thing the
  person already asked for.

  What may be shown, and as what, is decided by the API from the file's
  EXTENSION, and the URL that renders it carries a Content-Type derived from the
  same place. The type recorded on the answer is not used for this and never
  could be: it is the string the browser typed when it asked to upload, nothing
  on the way in checked it, and it is also what the bucket stored. A real image
  whose answer claims to be a page would otherwise have been served as one. The
  extension is the single claim about an upload that was verified, against the
  file's own leading bytes, before it was accepted.

  Both URLs are still minted per click and live minutes, so nothing durable is
  rendered into a table of fifty rows. The download control re-mints rather than
  reusing the URL the dialog opened with, because a dialog can sit open longer
  than a signature lives and the download is the one action that must not fail
  after someone has decided to keep the file. A preview that expires offers a
  reload rather than a broken frame.

  The two upload routes are described in the OpenAPI document for the first time.

- 8009d2d: Groundwork for a "file" question type: object storage, presigned uploads, and
  server-side verification.

  This is the backend half. The type exists in the engine and the API, but no
  builder gallery entry and no public input render it yet, so no form can ask for
  a file until the renderer lands.

  The file never travels through the app. The browser asks the API for permission
  (`POST /v1/public/forms/:accountCode/:slug/uploads`, behind the same per-IP rate
  limit as the rest of the public surface), gets a presigned PUT that can write one
  key for a few minutes with one exact content type, and uploads straight to the
  bucket. That is what lets a 10 MB file exist at all: the current path caps the
  request body at 1 MB in the server action and 100 kb in the API.

  Two prefixes carry the difference between "a stranger wrote this" and "we
  checked it":

  - `incoming/{accountId}/{formId}/{sessionId}/{uuid}.{ext}` is the only place a
    browser may write. A bucket lifecycle rule expires it, so a visitor who
    uploads and abandons the form costs nothing.
  - `uploads/` is written by the API alone, after verification, and is the only
    prefix a stored submission ever points at.

  On submit, every file answer is checked before anything is persisted or scored:
  the object exists, its REAL size is within the limit (the size the client
  claimed is not evidence), its key is under this session's own staging prefix, and
  its first bytes match the extension it arrived under. A format with no signature
  to check, such as .txt or .csv, is accepted only under an extension that is
  genuinely signature-free. Executables and active documents (html, svg) are
  refused whatever the form owner configured. Verification is idempotent, so a
  partial save followed by a complete submit promotes the file once.

  Nothing in the bucket is public. Downloads are minted per click as short-lived
  signed URLs and always as an attachment, so an uploaded page cannot execute on
  an origin of ours. Deletion removes every VERSION of an object, because a
  versioned bucket turns an ordinary delete into a recoverable delete marker.

  Configuration is one variable in the normal case. `STORAGE_BUCKET` turns the
  feature on and the AWS SDK finds the pod's own role, so there is no key to
  configure; `STORAGE_PROVIDER=none` is an explicit off switch for a deployment
  that has a bucket but does not want the feature. Unset, which is the default and
  every bare fork, means the question type does not exist and the deployment boots
  and runs exactly as before. `UPLOAD_MAX_FILE_MB` (10 by default) is a ceiling a
  form owner can lower but never raise, and `STORAGE_REGION`, `STORAGE_ENDPOINT`
  and `STORAGE_FORCE_PATH_STYLE` cover S3-compatible storage.

  An answer rides in the existing answers JSON as `{ key, name, size, mime }`, so
  there is no migration and no new column. `parseFileAnswer` is the only reader of
  that shape; answer summaries print the respondent's own filename and never the
  object key, which keeps it out of notification emails and CSV exports.

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

- 310f098: A real design system for a form, replacing a single accent color.

  `branding` gains fifteen optional axes — `background`, `foreground`,
  `backgroundStyle`/`backgroundImage`/`backgroundOverlay`, `fontFamily` +
  `customFont`, `radius`, `buttonStyle`, `buttonFullWidth`, `progressStyle`,
  `logoSize`, `logoPosition`, `contentAlign`, `contentWidth`, `transition` — plus
  `themePreset` (editor bookkeeping) and `ogImage`. Every one is optional and
  resolves, when absent, to the look the renderer already had: `resolveDesign`
  keeps that mapping in one frozen table (`LEGACY_FORM_DESIGN`) so no published
  form changes appearance, pinned by tests.

  `resolveDesign` and `designAttributes` (`@quill/engine/form-design`) are the
  single answer to "what does this form look like", shared by the public renderer,
  the live preview and the builder canvas. Two axes are cross-validated rather
  than trusted: an `image` background with no usable URL falls back to `solid`,
  and a `custom` typeface with an incomplete source falls back to the brand face,
  so a combination that renders as a blank page cannot be reached even from a
  hand-edited config.

  **Colors are rendered exactly as chosen — nothing is corrected.** `formThemeVars`
  paints the author's color everywhere, because a silently substituted color reads
  as a bug: you set lime, the page shows olive, and nothing you click explains it.
  Legibility is handled where the author can act on it, in the editor: risky pairs
  are measured and warned about, with `suggestReadable` offering a readable
  alternative in one click, and the decision stays theirs. The only derived value
  left is the label ON a solid accent, since nobody picks the color of button text.

  Nor is any text accent-coloured. Three rules used to be — the cover eyebrow, the
  slider's value, and the dot after the form name — which meant a bright or pale
  brand color silently erased whatever it was applied to. The accent is now only
  ever a fill or a border, so the whole class of problem is gone rather than warned
  about.

  **Bug fixed in `@quill/shared`'s color math:** `clampAccent` took no background
  and always lightened toward white, which was correct only because the public
  form was always dark. On a light ground it pushed a pale color further into
  unreadable and then reported it as safe. The corrected walk (ground-aware
  direction) now lives in one place and backs both `clampAccent` and
  `suggestReadable`. `accentWasAdjusted` is removed — the render path it served no
  longer exists.

  New: `suggestReadable`, `contrastRatio`, `contrastGrade`, `isLightColor`,
  `readableOn`, `resolveThemeMode`, and `formThemeVars`, which derives the
  supporting tokens (card, muted, border) by mixing the author's ground toward
  their text — so an arbitrary background gets a coherent palette instead of a
  fixed light or dark one.

  Setting a background LOCKS the form's theme: it stops following the visitor's
  light/dark preference. A page cannot honour both an author's chosen palette and
  an OS setting without one of them being wrong, and the author is the one who saw
  the result.

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

- 42ec808: A form can name its language and its button copy.

  Until now the public form's chrome (Start, Back, Next, Submit, the progress
  counter, the thank-you copy, the confirmation email) followed each visitor's
  browser, with no way for the author to decide. Two additive config fields fix
  that; a form saved before they existed renders exactly as it did.

  - `config.language` (`en` | `es`, absent = Auto). Precedence on the public
    page: `?lang=` on the URL, then the form's language, then the browser,
    then English. The page description, the social card, the `lang` attribute
    on the form's subtree and the respondent's confirmation email follow the
    same resolution (the submission now carries the locale the respondent saw).
  - `config.labels` (`back`, `next`, `submit`, up to 80 characters each) at the
    form level. A step's own `buttonText` still wins for that step; the cover
    keeps `cover.ctaText`. `resolveFormLabels(config, locale)` in `@quill/shared`
    is the single resolver both renderers and the builder preview use.
  - Design tab: a Language selector (Auto / English / Spanish) and Button text
    fields (Submit only on the one-page layout) at the top of the panel, with
    the stock copy of the chosen language as placeholders. The live preview and
    the Preview modal render in the FORM's language, not the editor's.
  - New forms are stamped with their author's language (dashboard "New form"
    and the onboarding wizard alike). Existing forms stay on Auto.
  - The public error boundary and the 404 speak the visitor's language.
  - i18n: `admin.editor.design.language*` / `labels*` / `label*`, and
    `renderer.error*` / `notFound*` (EN + ES).

- a6ae6f7: Groundwork for a HighLevel destination. Nothing can connect or deliver to HighLevel yet, and no screen offers it.

  - `@quill/types`: a `gohighlevel` destination type with its schema (mappings to a standard contact field or to a custom field by id, key and type; UTMs, score and submitted date to custom fields; `dayTimezone`, `staticFields`, `tags`, `source`, `drafts`, `events`), the standard field catalog, the custom field types, which ones each kind of mapping may target (`goHighLevelSlotAccepts`), and the shapes the connect and fields routes and the adapter will use. At most one per form, through `extraOnePerFormDestination`, which also carries the HubSpot and Salesforce rules with their messages unchanged.
  - `@quill/types`: `destinationFiresForPhase` reads an explicit `events` on HubSpot and Salesforce destinations too. Without one, HubSpot still fires on both phases and Salesforce on complete only, so every stored config behaves as before. A HighLevel destination without `events` fires on complete only. Google Sheets stays complete only.
  - `@quill/db`: `gohighlevel` is an integration provider and an outbox kind.
  - `@quill/destinations`: the factory turns a `gohighlevel` delivery into a named no-op until the adapter exists.
  - `@quill/mcp`: the form config JSON Schema (the guide's `config_schema` and the skill's `form-config.schema.json`) leaves out the HighLevel destination and the `events` of HubSpot and Salesforce destinations, which the editor has no control for yet. A refusal for a provider no deployment can connect yet gets its own hint instead of the one that sends the user to whoever runs the deployment.
  - `@quill/shared`: reserved HighLevel copy in English and Spanish: the provider name, the connection errors and the delivery history reasons.

- 28ab19d: A form can now append every submission to a Google Sheet as a new row.

  The destination stores the spreadsheet, the tab and an ordered list of columns. Columns are a list rather than a map because a spreadsheet's columns are ordered, and they are never derived from a submission's own answers: two respondents answer different optional questions, so a row built from whichever one arrived would put the same question in a different column on every line.

  One API call per delivery. Google's write quota is 60 requests a minute per user, and a submission burst is exactly when a form is worth the most, so the adapter does not read the sheet, look up the tab or write a header row: those are one-time jobs for the admin surface, not per-respondent work.

  Values are written raw, so an answer that begins with `=` stays text instead of becoming a formula in someone else's spreadsheet.

  A delivery that cannot succeed however often it is retried (a deleted spreadsheet, a renamed tab, access revoked) is reported as a no-op naming the cause, and only quota, server errors and transport failures are retried.

- 66e0b55: Signing up from the resource hub: a two question onboarding and the playbook by email.

  - Whoever founds a workspace with a published playbook as their return path (`/admin/playbooks/<slug>`) is asked `lead_source` and `use_case` only, whatever their cohort. Everyone else sees the wizard as before.
  - `@quill/types`: `ONBOARDING_FLOWS`, `ONBOARDING_HUB_STEPS` and `onboardingSteps(cohort, flow)`. `account.onboarding` gains `flow`, and the progress and completion bodies accept `flow`; the completion also accepts `playbook` and `playbookLocale`. All optional, and a bad value reads as absent.
  - The onboarding events carry `flow: "hub"` on this path. Questions it leaves out are never sent empty to the contact sync, and this flow makes no IAM request.
  - `GET /v1/me` adds `foundingMember` while the wizard is owed.
  - `@quill/db`: `enqueueOutboxOnce` (a unit of work keyed to happen once) and `isFoundingMember`. No migration.
  - `@quill/notifications`: `sendPlaybookPdf`, the email in English and Spanish with a button to the playbook. It is queued once per person and playbook, for whoever founded the workspace, and only with `PUBLIC_APP_URL` set.

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

- 6855ca8: Connect HubSpot, Google Sheets and Salesforce from a form's Connect tab, and keep a spreadsheet's header row in line with its columns.

  - `@quill/types`: a Google Sheets destination's `settings` may carry `headerSnapshot`, the header row dForms last wrote and where. The API owns it and ignores any value a client sends.
  - `@quill/shared`: new copy for connecting in place, for a member who cannot connect, and for each header-row outcome. Every mention of the account page now says Integrations (Integraciones in Spanish), and the Spanish copy uses tú throughout (the last voseo forms are gone).

- de8df64: Add `config.logicLayout` — builder-only node positions for the Logic canvas,
  keyed by step key.

  Additive and optional, so every existing config keeps parsing and every
  published form renders identically. The engine and both renderers ignore it
  entirely: nothing about how a form RUNS may depend on where its author dragged a
  box. An absent entry is the normal case — the canvas lays itself out from step
  order, and a stored position is only ever an override of that.

  Because the key is a step key it is a POINTER, and both places that move
  pointers now move it too: `renameStepKey` carries a position across a rename,
  and `normalizeConfig` remaps it through the same rename map as `goto[].target`
  and prunes entries whose step is gone. Without that a rename or a delete would
  leave a node pinned to coordinates its step no longer occupies — the exact kind
  of stale lie the canvas exists to remove. Coordinates are validated `.finite()`
  so a NaN can never reach the config and fail the whole form's autosave.

- be7d8d1: Long text questions can require a minimum number of characters and cap the maximum, with a live counter on the public form.

  A question like "tell us about your project" is answered in one word often
  enough that the answer stops being worth reading, and there was nothing an
  author could do about it: the only lever was Required, which a single character
  satisfies.

  A long text question now carries its own `minChars` and `maxChars`, both
  optional. The slider's `min` and `max` live on the same step and are a different
  pair entirely, which is why these have names of their own rather than reusing
  those.

  The floor stops the respondent from continuing, so it is a rule and not a
  suggestion, and it comes with a live character counter. Without the counter the
  minimum is an invisible wall: you write, you press Continue, and you are bounced
  without ever having been told how much was missing. The counter appears only
  when the question actually sets a limit, so a question with none looks exactly
  as it always has.

  Falling short and running over now say so. They used to have no way to be said
  at all, and the nearest existing message, "this field is required", is a plain
  untruth when somebody has written ten characters. Both messages ship in English
  and Spanish.

  The ceiling is also enforced when the submission arrives, because the submission
  contract put no bound on an answer string at all and a request that skips the
  browser could carry any payload. The floor stays browser side, matching how
  Required and the phone minimum have always worked. A floor above a ceiling is
  refused when the form is saved, and the editor squeezes each box against the
  other so the pair can never be typed in the first place.

  Nothing changes for a long text question that sets no limits: no counter, no cap
  on typing, no new way for an answer to be rejected.

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

- b8ff7fb: One-page forms built for an embed can drop their chrome: the header, the answered counter, and a count that started above zero.

  - `branding.showHeader` (new, optional). Only the `vertical` layout reads it. `false` removes the header above the questions (the form logo, or the form name when there is no logo), and the logo on the reveal and submitting screens. Absent or `true` keeps today's header. `slides` ignores it. `resolveDesign` resolves it to `true` when absent; no new `data-pf-*` attribute, so existing markup is unchanged. It is not part of the brand kit.
  - `progressStyle: "none"` on a one-page form now hides the whole progress strip, the "X of N answered" label included, not only the bar. Any other value keeps the bar and the label. A one-page form that already stores `"none"` loses its counter.
  - The answered counter no longer counts a value the page put there: a question's `defaultValue` and a URL prefill only count once the person touches the question. A terminal question with a default or a prefill no longer cuts the page on load.
  - Design tab: a "Show header" switch on one-page forms, and the progress toggle offered there with two options (Bar, Hidden). i18n: `admin.editor.design.showHeader` and `showHeaderHint` (EN + ES).
  - MCP `get_form_guide`: descriptions for `branding.showHeader` and `branding.progressStyle` in `config_schema`, and a rule for embedded one-page forms.

- f790dda: One-page forms can look like a regular web form: two short fields side by side, a label above each name input, and compact spacing.

  - `steps[].width` (new, optional: `'full' | 'half'`). Only the `vertical` layout reads it. Two consecutive `half` steps share a row from 640 px wide and stack below that; three in a row make a pair plus a full row, never three columns. Only `text`, `email`, `phone`, `url` and `dropdown` can be half; any other type, a hidden step, or a half step with no half neighbour renders full width. Pairing runs on the live walk, after logic. Engine: `FORM_STEP_WIDTHS`, `HALF_WIDTH_TYPES`, `canHalfWidth`, `onePageRows`.
  - `steps[].fieldLabels` (new, optional, keyed like `placeholders`). On a `name` step in the `vertical` layout, a visible label above each input; the question title stays for screen readers and the response column. A sub-field with no label shows the localized default. Engine: `nameFieldLabels`. Ignored on slides and on any other step type.
  - `branding.density` (new, optional: `'comfortable' | 'compact'`). `compact` drops the lines between questions and spaces fields 16 px apart. `resolveDesign` resolves it to `comfortable` when absent; `designAttributes` is unchanged (the vertical renderer adds `data-pf-density="compact"` itself), so existing markup is byte-identical. Not part of the brand kit. Slides ignores it.
  - Editor: a Width toggle (Full, Half) on short questions of one-page forms, a Label field per name sub-field, and a Density toggle in Design. i18n: `admin.editor.design.density`, `densityHint`, `densityComfortable`, `densityCompact`, `admin.editor.nameStep.label`, `labelHint` (EN + ES).
  - MCP `get_form_guide`: descriptions for `steps.[].width`, `steps.[].fieldLabels` and `branding.density` in `config_schema`, and a rule on making a one-page form look like a regular web form.

- 310f098: Choice questions can now render their options as a card grid, on purpose.

  The grid already existed but was reachable only through `showIcons`, a flag no
  editor control ever set — so in practice only the seeded demo form had it. It is
  now `optionLayout: 'list' | 'cards'`, chosen from a "Show options as" toggle on
  the question. `showIcons` is deprecated and still read as the fallback by the new
  `resolveOptionLayout`, so a config saved before this keeps its grid.

  Each option's `icon` may be an emoji or an image URL, and the two are rendered
  differently rather than identically: `isImageIcon` tells them apart, a glyph
  centres in a circle, and an image gets a rectangle it letterboxes into with
  `object-fit: contain` — so a wide logo is no longer cropped to its middle by a
  circular mask. A broken image URL falls back to the glyph treatment instead of a
  torn-image box. The icon cap grew from 64 to 512 characters to fit a real CDN
  URL, and any icon that looks like an image must also pass `isSafeImageUrl`.

  Uploading an image is not part of this — icons are an emoji or a URL, matching
  how the form logo and client logos already work.

- a6b7fcf: Pilot-port feature set: per-outcome booking embeds (HubSpot Meetings / Calendly) with a booking callback and durable booking→CRM sync via the outbox; answer-forced outcome overrides; reveal screen duration/subtitle templates/prewarm; per-form tracking config (GTM, Meta Pixel, PostHog, HubSpot); HubSpot destination value maps, outcome property, static properties, company inference and bookingSync; draft→publish workflow (form.draft_config/published_at, additive migration 0003 + booking_event table); respondent confirmation email wiring; normalizeConfig now preserves additive top-level config fields; i18n EN+ES for all new surfaces.
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

- 1bfeaa1: A form can forward the visitor's UTM parameters to its redirect (#310).

  **Config.** The form-level `ending` takes an optional `forwardUtm` boolean. Absent or `false` changes nothing, so every stored config keeps behaving as before.

  **Engine.** `appendUtm(url, utm)` appends the `utm_*` entries of `utm` to a URL. It ignores every other key, never overwrites a `utm_*` key the owner already wrote (compared case-insensitively), keeps the existing query bytes and the `#hash`, and returns the URL unchanged when there is nothing to append or it does not parse. `forwardedUtm(config, utm)` hands the UTMs through only when `ending.forwardUtm` is on. `resolveEnding` takes a `utm` option and `redirectUrlFor` an optional `utm` argument; both append the UTMs after the `[key]` tokens are filled or stripped.

  **Renderers.** With `forwardUtm` on, both layouts append the same UTMs the submission carried (the form's own, else the landing's) to every redirect: the ending's, an outcome's own `redirectUrl`, and the redirect after a booking, immediate or delayed. The UTMs are forwarded on an embedded form too, because they are campaign data, not answers. The `http(s)` check still runs on the final URL.

  **Editor.** The ending panel shows a "Forward UTM parameters" switch as soon as the form or any score range has a redirect. The redirect hints, in the ending panel and the outcomes dialog, now warn that an answer such as an email placed in the URL ends up in the destination site's browser history and server logs. English and Spanish.

  **Agent docs.** The API skill and the MCP guide document `ending.forwardUtm` and the same privacy warning.

- 5a00a48: Referral program, second step: a signup through a referral link counts.

  - `@quill/types`: `ref` joins the signup attribution allowlist, stored as `referralCode`, so a referral link rides the root page hand-off and the login cookie like the UTMs.
  - `@quill/db` adds migration 0031, a new `referral` table on SQLite and Postgres: the referee person (unique, so the first credit wins), the referrer person, the source (`link` or `invite`) and when. Rows are never deleted.
  - `@quill/api`: `POST /v1/me/referral/claim` credits the caller to the owner of a code. Any role may call it; API keys may not. It credits only a new person (their first membership, staff access grants aside, is under 10 minutes old), never a self-referral (same person or same email), never an unknown code and never a person already credited, and every refusal answers `{ credited: false }`. `GET /v1/me.referral.count` is now the real count. A credited claim records `referral_signup` with the code, and sets `referred_by` on the invitee.
  - `@quill/web`: the sign-in callback sends a parked `ref` to the claim after the attribution record, and never fails the login over it. The dashboard sets `referral_code` on the person while the program is on.

- 2c072c6: `submissionSchema` accepts an optional `analyticsId`: a random id the public renderer mints per response, used as the product-analytics distinct id of the new `forms_response_completed` server event. Anything that is not a UUID is dropped, never refused, so a malformed value cannot fail a submit.
- 115e213: Salesforce as a submission destination. A workspace connects its org once with
  Client Credentials (My Domain, consumer key, consumer secret, stored encrypted
  as one value), and each form maps questions, UTMs, score, submission date and
  fixed values to Lead fields. A delivery finds the respondent by email first
  (a Contact, then an unconverted Lead) and updates it, and creates a Lead only
  when neither exists, so a person who answers twice is not duplicated (two
  submissions from one email at the same instant can still race; an org's own
  duplicate rules close that). Transient refusals (the API limit, lock
  contention, a query timeout) are retried. Complete submissions only.
- 9779aac: Score-sourced visibility conditions: a show/hide rule can reference the reserved
  `@score` source (the running score over the steps before the one being decided),
  offered in the builder as "Score so far" with numeric operators. Adds the public
  form title (`config.title`, additive) resolved everywhere through the new
  `publicTitle()` helper, surfaces it in the profile listing, and corrects the
  destination port's idempotency-key documentation.
- 59a4a66: Screens: several questions on one slides screen.

  An optional `screenGroup` on each step puts consecutive steps that share it on
  one screen of the slides layout, with one button. Absent, which every stored
  config is, means a screen of its own, so every form saved before this renders
  and walks exactly as it did. Logic keys, scoring, CSV, the Summary tab, emails,
  webhook and CRM mapping and the analytics API keep working per question.

  - `@quill/types`: `formStepSchema.screenGroup` (additive, 1 to 64 characters).
    The API must know it before or together with the web: a schema without it
    strips the field on save and the author silently loses their screens.
  - `@quill/engine`: one definition of a screen, shared by the renderer, the
    builder and the server score. `authoredScreens` and `screenIds` (a run of two
    or more consecutive steps with the same id; `reveal`, `scheduler` and `file`
    always stand alone, hidden steps are transparent, a run of one means nothing,
    the same id in two separate runs makes two screens, and the one-page layout
    ignores every id), `runtimeScreens`, `screensActive`, `canShareScreen`,
    `SOLO_SCREEN_TYPES` and `MAX_SCREEN_SIZE` (10, the builder's cap; the engine
    does not cap). A jump from a question on a screen now runs when the
    respondent leaves the screen, so the whole screen is still shown and scored
    and the first rule from the top that goes somewhere wins (one that goes
    nowhere is ignored, as it always was); a target inside a screen, even one
    logic hides, lands on its first visible question. `normalizeScreenGroups` (also run
    by `normalizeConfig`) keeps ids only where they make a screen and returns the
    same array when nothing changes, and `setScreenBoundary` joins or splits the
    boundary above a question. A legacy reveal after a question on a screen
    becomes a step after the whole screen.

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

- d85aeb5: A `url` question type: a single-line input that only accepts a web address.

  It sits in the builder's Text group ("Website"), between long text and the
  slider. It is not a contact field: `LEAD_CAPTURE_TYPES` and `isContactType` are
  unchanged, it lands in the qualification flow group, and it does not score.

  Validation is a pure regex, no `new URL`, so the engine stays free of platform
  APIs and both apps agree on the verdict. `acme.com`, `www.acme.com/x?y=1`,
  `https://acme.com:8443/p` and `http://x.io` pass; `acme`, `ftp://acme.com`,
  `javascript:alert(1)`, `https://` and `acme .com` are rejected with the new
  `url` validation code (`renderer.errors.url` in the catalog, en + es). Empty is
  still the required check's job, as for every other type.

  The stored value always carries a scheme. `normalizeUrl(raw)` trims and prepends
  `https://` when no `http(s)://` prefix is present (idempotent), and
  `canonicalizeAnswer(step, value)` applies it to `url` answers that pass the
  validator (a typo like `acme` stays as typed, so the error is about what was
  written) and is the identity for everything else. The public renderers call it at their commit
  points, right before `validateAnswerCode`, so the Enter path and the button path
  hand the same shape to the engine, the partial save and the CRM, and a HubSpot
  `website` property receives a full URL. `createEmptyStep('url')` seeds the
  placeholder `https://` to hint at that shape.

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

- 310f098: Forms can now render as a single vertical page, not only as slides.

  `config.layout: 'slides' | 'vertical'` (additive — absent means `'slides'`, so
  every published form renders exactly as before; `resolveFormLayout` is the one
  place that default lives). The vertical renderer walks the same pure engine
  (`runtimeSteps` recomputed on every answer), so skip-logic, goto jumps, dynamic
  question variants and branch closing all apply live on the one page.

  Layout-specific behavior: the cover renders as a hero header (no Start gate,
  its CTA text is unused), reveal steps never play mid-page (one reveal plays
  after Submit, before the result), a terminal step with an answer hides
  everything after it instead of auto-submitting, schedulers embed inline and
  lazy-mount near the viewport, and validation is inline on blur plus a
  submit-time sweep that scrolls to the first invalid question.

  Funnel events keep their metric semantics across layouts: `step_view` fires
  when a question enters the viewport (index 0 on load matches a cover-less
  slides form, so Starts stays comparable), `step_complete` when a question first
  holds a valid answer, `partial_submit` when the threshold answer becomes valid.

  The builder follows: a layout picker in the create dialog and the Design tab,
  the canvas drops the per-step progress bar and Next button on vertical, the
  cover CTA field is replaced by a note, the reveal switch explains where it
  actually plays, and the Design-tab preview sketches the one-page shape.

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

- 68aa3b2: HighLevel destination adapter. With a connection (a Private Integration token and a Location ID), the destination factory now builds `GoHighLevelDestination` instead of the no-op: each submission is upserted as a contact of the sub-account (`POST /contacts/upsert`), then its fixed tags are added with `POST /contacts/{id}/tags`, which only adds. Empty answers are never sent, so they never clear a value GHL already has; a phone goes as E.164 when it carries its country; each custom field gets its value in the shape its type takes (a number only when the answer is one, a list for multiple choice and checkbox, a date as the day in the destination's zone). A 401 or 403 from GHL skips the delivery with a reconnect reason and calls `onRejected`; a 400 or 422 skips it with GHL's message; a Cloudflare refusal, 429, 5xx or network error throws so the outbox retries. Without a usable connection the factory keeps the named no-op. The `@quill/types` change only updates comments that said no adapter existed yet.
- dc73f54: A form's Connect tab can now set up its Google Sheets destination: create a spreadsheet for the form in one click (named after the form, with its header row already written), or choose one you already have in Google Drive, then pick the tab and say what each column holds. The column plan starts from the form's own questions, in the form's own order.

  There is no field to paste a spreadsheet link into, on purpose. The app asks Google only for access to the files it creates and the ones you choose, so a pasted link to any other spreadsheet could not be opened.

  A spreadsheet destination now fires on completed submissions only. A sheet is append-only, so a partial would land as one row from halfway through the form with a fuller row underneath it, and nothing in either saying they are the same person. Every other destination kind is unchanged.

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

- 036d5fd: Build and maintain the HubSpot mirror form when the integration is saved.

  `hubspotDestinationSchema.settings` gains two more optional fields beside
  `formGuid`: `formActivity`, the author's switch, and `formSignature`, what the
  mirror was last built from.

  They are separate on purpose. Turning the switch off STOPS posting; it does not
  delete the form, whose past submissions are activities on real contacts —
  deleting it to represent "off" would erase history nobody asked to lose, and
  turning it back on reuses the same form rather than orphaning them. The
  signature exists because the Connect tab autosaves: without it, every keystroke
  would rebuild a form in the customer's portal. It covers the mapped properties
  AND the form's name, since the name is what labels the activity, and a renamed
  form whose mirror still carries the old title is the confusion this feature
  exists to remove.

  Adds `admin.integrations.formActivity*` to the message catalog in both locales,
  including the line shown when HubSpot refuses — a missing scope has to say so
  where the author turned the switch on, not in a log.

- bfece62: Remove the last two em dashes a user could see, and make the check that finds
  them usable in CI.

  Two were still on screen. The webhook health cell rendered a bare em dash as its
  empty state; the rows already carry borders, so an empty cell reads as empty,
  which is what the submissions table settled on. And
  `ONE_HUBSPOT_DESTINATION_MESSAGE` is returned as an API error `message` that
  `question-hubspot-actions.ts` hands to the editor verbatim, so it is copy rather
  than an internal string.

  `scripts/dash-check.sh` could not go into CI before this. It reported 586
  failures of which 260 held no dash at all: CI runs with `LANG` unset, and in the
  C locale grep degrades a bracket class of multi-byte characters into the set of
  their bytes, so the class of em dash and horizontal bar became `{E2,80,94,95}`
  and matched every General Punctuation character, all of which begin with byte
  `E2`. Arrows, typographic apostrophes, ellipses and bullets were all reported as
  em dashes. Matching each full sequence as an alternation is correct in either
  locale.

  The check now separates the two things it looks at. User-visible copy is at zero
  and blocks on the whole tree. Docs and changesets carry roughly 320 older
  occurrences, most in changesets that already shipped and cannot be revised, so
  those block only on the lines a PR adds. Comment lines and spec titles are
  skipped in the copy paths, which removes the last structural false positives:
  a prose comment with a code span on either side of a dash satisfied "a dash
  between two backticks" while holding no string at all.

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

- cf9eb95: Let an outcome carry the range it covers, instead of implying it.

  An outcome stored only where it STARTED. Its end was read off whichever
  neighbour started next, so a range was never something an author typed — it was
  something they inferred, from a badge on the far side of the row they were
  editing, showing a number derived from a different row. Widening a range meant
  changing someone else's threshold, and two ranges could quietly claim the same
  score, leaving one of them dead with nothing on screen saying so.

  `formOutcomeSchema` gains an optional integer `maxScore`: the inclusive upper
  bound. Absent means the range runs open-ended upwards, which is exactly how
  every stored range behaved before the field existed. `resolveOutcome` reads the
  STORED bound and never a derived one, so a config carrying no `maxScore` at all
  resolves to the same outcome it always did — pinned by a test, because that is
  the whole back-compat claim. The top range is meant to stay unbounded: something
  has to catch a score above every ceiling.

  Adds three pure helpers to `@quill/engine`, so the several screens that draw a
  range stop each deriving it for themselves:

  - `outcomeRanges` — the span each outcome covers, filling in the implicit end
    for configs written before `maxScore`. Order-independent: the implicit end is
    the smallest start above this one, not "the next array element".
  - `overlappingOutcomes` — indexes whose span collides with an earlier one. Never
    a legitimate state: only one outcome can win a score, so the other is dead.
    Ranges with no explicit bounds tile by construction, so no already-stored form
    starts reporting one.
  - `outcomeGaps` — scores between the ranges that match nothing. A real choice
    (those respondents see the form's own ending), so it is reported and not
    refused. It invents no floor below the lowest range; scores go negative and the
    bottom of the scale is not this function's to guess.

- e7cb7a0: Report a signing failure as a typed error instead of a bare 500.

  Minting an upload or download URL reaches AWS for credentials, and that is the
  one step in the flow that fails for reasons the visitor did not cause: no role
  attached to the pod, a role whose session expired, a bucket in another account.
  Unguarded, every one of those surfaced as an Internal Server Error with a stack
  in the log and "that upload did not finish" on screen, which names neither the
  cause nor who can fix it. They now return `UPLOAD_UNAVAILABLE` with a 503.

  The owner's download route stopped forcing every failure into a 404 as well.
  "No such file" and "storage is unreachable" are different answers, and
  collapsing them told an owner their file was gone during an outage.

- Updated dependencies [310f098]
- Updated dependencies [4a38827]
- Updated dependencies [bb7077e]
- Updated dependencies [2769426]
- Updated dependencies [11af0cd]
- Updated dependencies [2364cd1]
- Updated dependencies [61067f7]
- Updated dependencies [310f098]
- Updated dependencies [b612c96]
- Updated dependencies [919dbdb]
- Updated dependencies [531f8d9]
- Updated dependencies [468262a]
- Updated dependencies [e50736f]
- Updated dependencies [d58e464]
- Updated dependencies [e877d55]
- Updated dependencies [59f1bbf]
- Updated dependencies [8009d2d]
- Updated dependencies [310f098]
- Updated dependencies [42ec808]
- Updated dependencies [0a83bde]
- Updated dependencies [310f098]
- Updated dependencies [de8df64]
- Updated dependencies [be7d8d1]
- Updated dependencies [af7d5c2]
- Updated dependencies [88795e5]
- Updated dependencies [bfb3d2c]
- Updated dependencies [0124b1c]
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
- Updated dependencies [883ebd2]
- Updated dependencies [e802b03]
- Updated dependencies [1bfeaa1]
- Updated dependencies [c50ed94]
- Updated dependencies [d62a3b5]
- Updated dependencies [9779aac]
- Updated dependencies [59a4a66]
- Updated dependencies [b8fcd1c]
- Updated dependencies [0b8b150]
- Updated dependencies [504224b]
- Updated dependencies [cf9eb95]
- Updated dependencies [d85aeb5]
- Updated dependencies [310f098]
  - @quill/engine@0.1.0
