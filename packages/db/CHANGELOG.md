# @quill/db

## 0.1.0

### Minor Changes

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

### Patch Changes

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

- 9779aac: Score-sourced visibility conditions: a show/hide rule can reference the reserved
  `@score` source (the running score over the steps before the one being decided),
  offered in the builder as "Score so far" with numeric operators. Adds the public
  form title (`config.title`, additive) resolved everywhere through the new
  `publicTitle()` helper, surfaces it in the profile listing, and corrects the
  destination port's idempotency-key documentation.
- Updated dependencies [310f098]
- Updated dependencies [310f098]
- Updated dependencies [e877d55]
- Updated dependencies [59f1bbf]
- Updated dependencies [b8322ea]
- Updated dependencies [310f098]
- Updated dependencies [310f098]
- Updated dependencies [daaabf2]
- Updated dependencies [de8df64]
- Updated dependencies [310f098]
- Updated dependencies [c6007cb]
- Updated dependencies [0124b1c]
- Updated dependencies [310f098]
- Updated dependencies [310f098]
- Updated dependencies [a6b7fcf]
- Updated dependencies [91847eb]
- Updated dependencies [d1e9944]
- Updated dependencies [72a7876]
- Updated dependencies [310f098]
- Updated dependencies [9779aac]
- Updated dependencies [310f098]
- Updated dependencies [310f098]
  - @quill/engine@0.1.0
  - @quill/types@0.1.0
