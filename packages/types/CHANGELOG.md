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

- 9779aac: Score-sourced visibility conditions: a show/hide rule can reference the reserved
  `@score` source (the running score over the steps before the one being decided),
  offered in the builder as "Score so far" with numeric operators. Adds the public
  form title (`config.title`, additive) resolved everywhere through the new
  `publicTitle()` helper, surfaces it in the profile listing, and corrects the
  destination port's idempotency-key documentation.
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

### Patch Changes

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

- Updated dependencies [310f098]
- Updated dependencies [bb7077e]
- Updated dependencies [310f098]
- Updated dependencies [e50736f]
- Updated dependencies [d58e464]
- Updated dependencies [e877d55]
- Updated dependencies [59f1bbf]
- Updated dependencies [310f098]
- Updated dependencies [310f098]
- Updated dependencies [de8df64]
- Updated dependencies [0124b1c]
- Updated dependencies [310f098]
- Updated dependencies [310f098]
- Updated dependencies [c97e73e]
- Updated dependencies [505df64]
- Updated dependencies [a6b7fcf]
- Updated dependencies [91847eb]
- Updated dependencies [d1e9944]
- Updated dependencies [9779aac]
- Updated dependencies [cf9eb95]
- Updated dependencies [d85aeb5]
- Updated dependencies [310f098]
  - @quill/engine@0.1.0
