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

- Updated dependencies [310f098]
- Updated dependencies [310f098]
- Updated dependencies [e877d55]
- Updated dependencies [59f1bbf]
- Updated dependencies [310f098]
- Updated dependencies [310f098]
- Updated dependencies [de8df64]
- Updated dependencies [0124b1c]
- Updated dependencies [310f098]
- Updated dependencies [310f098]
- Updated dependencies [a6b7fcf]
- Updated dependencies [91847eb]
- Updated dependencies [d1e9944]
- Updated dependencies [9779aac]
- Updated dependencies [310f098]
  - @quill/engine@0.1.0
