# @quill/shared

## 0.1.0

### Minor Changes

- 310f098: Connections tells the truth about a server-supplied token, and the Trends chart
  stops distorting itself.

  **The chart was stretched, not styled that way.** It drew a fixed 720-unit
  viewBox with `preserveAspectRatio="none"` into a container roughly twice that
  wide, so every mark was scaled ~2x horizontally and not at all vertically. The
  tell was the isolated-day marker: a `<circle>` rendered as an ellipse, and
  horizontal strokes came out twice as thick as vertical ones. The viewBox now
  tracks the measured container width, so one unit is one pixel and nothing is
  scaled. Date ticks follow that width too — a fixed three-tick rule left a wide
  chart with two labels and a gap between them.

  **The metric picker was the last native `<select>` in the admin**, so the
  operating system drew its chevron hard against the control's border and its
  popup ignored the theme. It uses the shared `Select` now, like every other
  control.

  **"Not connected" was wrong whenever the deployment supplied the token.** A
  provider can be fully working through its env fallback while
  `account_integration` is empty — the page reported the empty table and said
  nothing about the working integration, which reads as broken. `GET
/v1/integrations` now also returns which providers the server supplies, and the
  page has a third state for it that explains connecting your own replaces it for
  that account. Env knowledge stays in the API; `@quill/db` still never reads the
  environment.

  Also: the Connect buttons line up. The action row had no `mt-auto`, so HubSpot's
  two-line description pushed its button a line below Calendly's. And the two
  providers get real brand marks instead of a generic sync/calendar glyph —
  inline SVG, because a fork has to render with no CDN reachable.

  New `admin.connections` strings in EN and ES: `serverProvided`,
  `serverProvidedTitle`, `serverProvidedBody`.

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

- 63b7eb5: Split "is the growth loop on?" from "where does it point?". `growthTarget` gates
  on `NEXT_PUBLIC_SIGNUP_URL` exactly as before — unset still renders no badge and
  no CTA — but the destination now prefers `NEXT_PUBLIC_LANDING_URL` when the
  deployment sets one. Both surfaces address a stranger, so a landing page suits
  them better than a login screen.
- 310f098: Say why a HubSpot sync cannot work, and let an author test a webhook without
  waiting for a respondent.

  **A form with no email address silently never syncs.** HubSpot's upsert is keyed
  on email — it matches a contact by address and creates one when there is none —
  so a submission that carries no address arrives with nothing to identify. That
  delivery resolves as a permanent no-op: no error, no retry, no contact, and
  nothing an author would ever look at. The editor now says so while the form is
  being built, before any lead is lost. New pure helper `emailSourceFor(config)`
  returns where an address could come from: an `email` question (a hidden one
  counts — it still captures `?email=`), else a scheduler, since Calendly collects
  the invitee's address at booking. A question wins over a scheduler because it
  does not depend on anyone booking.

  The Connect tab also explains what the sync actually does. "Map a question to a
  property" never told anyone the contact is matched by email and created when
  absent, which is the single rule that decides whether a lead lands.

  **Webhook test delivery.** A new admin-only endpoint posts one sample body to the
  form's configured webhook — the real payload shape with sample answers built
  from the form's own steps, signed the same way, carrying `test: true` and a
  `test-submission` id so a receiver cannot mistake it for a lead. It runs through
  the real `WebhookDestination`, which is the point: an endpoint that makes the
  SERVER fetch a URL the USER supplied is the textbook internal-network probe, and
  reusing the adapter means the SSRF guard cannot be forgotten. Private, reserved
  and cloud-metadata addresses are refused with no request leaving the process.
  Loopback is permitted only when the stored hostname is literally `localhost` —
  the same carve-out the URL validator makes for a local catcher — so an https
  host that merely resolves to 127.0.0.1 stays blocked.

  New `admin.integrations` strings in EN and ES for the email gate, the sync
  explanation, and the test button.

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

- 0124b1c: Map a booking's own fields from the question panel. A scheduler step answers with
  a booking — the meeting time under its own key, the invitee's name and phone under
  theirs — but the builder offered one unlabelled "Map to" picker that bound only
  the first of those and never said which. `bookingFieldsFor` names the whole set so
  the question panel and the Connect screen read one list.
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

- 310f098: Finishes the option-card work: a real icon picker, centred cards, a canvas that
  matches the chosen layout, and logos confined to cards.

  The Icon field was a raw text box, which told an author nothing about emoji or
  initials being valid — so it only ever received URLs. It is now a picker with a
  tab per kind: an emoji library (a curated local set, no new dependency), one or
  two letters, and an image URL.

  `resolveOptionIcon` becomes the single answer to "what do I draw for this
  option", shared by the public renderer, the builder canvas and the live preview
  so the three cannot disagree. It also enforces that images are card-only: in a
  list an image URL degrades to the label's initials rather than rendering as a
  sliver, which means an already-saved list+URL config can't show the broken
  combination either. The editor matches by dropping the Image tab under List.

  Cards are laid out with wrapping centred flex instead of a fixed three-track
  grid, which had stranded a single card in the left third and pinned two cards to
  the left edge. Any count now centres, and the per-row count adapts to the width.

  `optionInitials` supplies the fallback glyph: up to two letters from the first
  two words ("HubSpot Sales" → "HS", "Hubspot" → "H").

- 310f098: Builder: dropdown and multiple-choice questions can now import their options from a spreadsheet paste — one or two columns (option + optional score), TSV/CSV/semicolon or one-per-line, with automatic header detection (EN/ES), per-row validation that never blocks the rest of the paste, duplicate de-duplication, and replace/append modes.
- a6b7fcf: Pilot-port feature set: per-outcome booking embeds (HubSpot Meetings / Calendly) with a booking callback and durable booking→CRM sync via the outbox; answer-forced outcome overrides; reveal screen duration/subtitle templates/prewarm; per-form tracking config (GTM, Meta Pixel, PostHog, HubSpot); HubSpot destination value maps, outcome property, static properties, company inference and bookingSync; draft→publish workflow (form.draft_config/published_at, additive migration 0003 + booking_event table); respondent confirmation email wiring; normalizeConfig now preserves additive top-level config fields; i18n EN+ES for all new surfaces.
- 91847eb: Give a form two independently editable logos. `resolveFormLogos` resolves the
  form's own logo (`branding.logo`) and the cover screen's (`cover.logo`) as
  separate axes, where `null` means "show none" and an absent value inherits — so
  clearing a logo removes it instead of falling through to the other surface's,
  and a logo snapshotted from a workspace brand kit is finally visible and
  editable from the Design tab. Configs written before this render unchanged.
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
