# @quill/db

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

- 3497551: Make concurrent final submissions claim completion atomically so only one caller reports the first completion.
- 350a76f: Apply each migration script and its tracking marker in one dialect-native transaction, so a failed migration leaves no partial schema and concurrent migrators apply it exactly once.
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
- Updated dependencies [bb7077e]
- Updated dependencies [67bd1e2]
- Updated dependencies [310f098]
- Updated dependencies [9b42f40]
- Updated dependencies [d58e464]
- Updated dependencies [e877d55]
- Updated dependencies [59f1bbf]
- Updated dependencies [b8322ea]
- Updated dependencies [310f098]
- Updated dependencies [310f098]
- Updated dependencies [bd31b39]
- Updated dependencies [036d5fd]
- Updated dependencies [f7875dc]
- Updated dependencies [daaabf2]
- Updated dependencies [de8df64]
- Updated dependencies [310f098]
- Updated dependencies [c6007cb]
- Updated dependencies [bfece62]
- Updated dependencies [0124b1c]
- Updated dependencies [7b087af]
- Updated dependencies [310f098]
- Updated dependencies [310f098]
- Updated dependencies [505df64]
- Updated dependencies [a6b7fcf]
- Updated dependencies [91847eb]
- Updated dependencies [d1e9944]
- Updated dependencies [72a7876]
- Updated dependencies [310f098]
- Updated dependencies [9779aac]
- Updated dependencies [cf9eb95]
- Updated dependencies [d85aeb5]
- Updated dependencies [310f098]
- Updated dependencies [310f098]
  - @quill/engine@0.1.0
  - @quill/types@0.1.0
