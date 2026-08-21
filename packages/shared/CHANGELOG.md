# @quill/shared

## 0.1.0

### Minor Changes

- 6579900: Settings moved behind the profile button, and became Account settings.

  The rail is Home · Forms · Submissions · Analytics · Integrations. Bottom-left
  sits a profile button (avatar, name, email) whose menu lists the account
  entries under an "Account settings" eyebrow (Workspaces · Brand kit ·
  Notifications · Public page) and Log out, the way the Dapta app's admin panel
  does it. `/admin/account` is the area behind it, with the same four entries as
  a sub-nav:

  - **Workspaces**: every workspace the person belongs to, as cards (role,
    active member count, Current / Invited badges) with Open (switch into it),
    Manage (members and invitations of THAT workspace, without switching; hidden
    on an invitation, which is accepted by opening) and New workspace. Managing
    a workspace by id sends the API a per-call workspace header instead of the
    cookie; every action carries the id explicitly.
  - **Workspace detail**: rename, Members table (role change, Activate /
    Deactivate, Remove for owners; admins may retract invitations) and
    Invitations table (pending invitations from the identity service with
    Resend, plus locally invited members), invite dialog.
  - **Brand kit**, **Notifications**, **Public page** (with the person's identity
    fields) moved from `/admin/branding` and `/admin/settings`; both old URLs
    redirect. Brand kit and Notifications name the workspace they act on.
  - i18n: `admin.chrome.profileMenu.*`, `admin.account.*` (EN + ES);
    `admin.chrome.nav.branding/settings`, `admin.chrome.signOut/viewPublic`,
    `admin.settings.appearance*` and the orphaned settings headings are gone.

- 35d1586: List every form's webhook on the account's integrations page — and make failed deliveries visible at all.

  The Connections page offers HubSpot and Calendly, the two things you connect once
  per account. Webhooks are configured per form, so they were nowhere on it: the
  only way to answer "which of my forms send data out, and where?" was to open each
  form's Connect tab in turn. The dashboard's own shortcut to that page has always
  been labelled "Integrations & webhooks", a promise the page did not keep.

  It keeps it now. Below the connections grid — a separate section, not a fourth
  card, because a webhook has no token and no connection state to report — sits an
  inventory: one row per webhook, with the form that owns it, the endpoint, whether
  a signing secret is set, which submission phases it fires on, whether it is
  enabled, and a link into that form's Connect tab. Editing stays with the form.
  Disabled webhooks are listed rather than hidden; one that quietly stopped firing
  is the case worth finding here. A form that stores two webhooks shows two rows,
  because two is a legal configuration and an inventory that rounds it down would
  disagree with what is stored.

  Fixing the delivery column turned up a bug that predates it. The admin matched an
  outbox row to a form by a top-level `formId` in its payload, but destination rows
  carry `{ destination, ctx }` with the id in `ctx` — so **no webhook or HubSpot
  failure had ever been visible in the admin**, including in the per-form "deliveries
  that did not land" panel built to show exactly that. Only `booking_sync` rows
  matched, which is why every test passed over the hole. The matcher now reads both
  shapes. That panel starts working on forms where it had always rendered nothing,
  and the account inventory can show a failure count without any new storage: same
  rows, same account scope in SQL, grouped per form.

  There is deliberately no "healthy" badge. Successful deliveries are not queried,
  so a queue with no failures cannot be told apart from a webhook that has never
  run, and claiming health for the second is worse than saying nothing.

  Adds `admin.connections.webhooks` to the message catalog in both locales.

- 8985783: A "Dapta Agents" door in the admin rail, and the public badge signs itself as
  Forms again.

  **The attribution pill reads "Made with Dapta Forms" and draws the Forms `F`.**
  Copy and mark move together (`growth.madeWith` in both locales, `BrandMark` in
  `made-with-badge.tsx`), and so does the destination: the published image now
  defaults `NEXT_PUBLIC_LANDING_URL` to the Forms landing on the platform's site,
  with the trailing slash the host requires to keep the query string. The pill's
  `utm_medium` is `form-button` (was `badge`); the thank-you CTA keeps
  `confirmation`. Reports filtering on the medium have to accept both spellings
  across the release date. Nothing changes for a fork: the loop is still gated on
  `NEXT_PUBLIC_SIGNUP_URL` and hidden by `NEXT_PUBLIC_HIDE_BADGE`.

  **"Dapta Agents" in the admin nav.** Last item of the rail, on every viewport
  (expanded, 64px collapsed, mobile drawer), rendered only when the deployment
  sets `NEXT_PUBLIC_PLATFORM_URL`, so a fork's rail carries no dead item. It is a
  plain anchor to a new tab with the same trailing arrow as the app-switcher rows,
  never `aria-current`, tagged `utm_source=forms&utm_medium=sidebar` through the
  new `lib/suite.ts` helper that the app-switcher now shares. The switcher's
  first row is renamed to "Dapta Agents" too, so one destination has one name.

  The confirmation CTA drops its em dash ("Get Dapta Forms, free").

- 41ec9f2: Branded date picker for the analytics custom range.

  The From and To fields behind the "Custom" chip on a form's Analytics page were
  OS-native date inputs, so their popup came from the browser: unthemed, off-brand,
  and different on every platform. They are now a token-styled trigger plus a mini
  calendar popover that follows the light and dark theme like every other admin
  control, with the accent used for the selected day and a rim on today.

  The calendar opens on the current value (or today), pages by month, starts the
  week on Monday for Spanish and Sunday for English, and is fully keyboard
  operable: arrows move by day and week, Home and End jump to the week's ends,
  PageUp and PageDown page months (Shift pages years), Enter picks, Escape closes
  and returns focus to the field. A clear button empties the field. Bounds are
  unchanged (From cannot pass To, To cannot pass today, all in UTC like the server),
  and Apply still swaps a reversed range before it reaches the URL.

  New catalog keys under `admin.datePicker` (placeholder, dialog label, previous
  and next month, clear) in both locales.

- 5a29839: New i18n strings for transport-resilient autosave: `admin.editor.saveOffline`, `admin.integrations.saveOffline`, and `admin.integrations.saveRetrying` (EN + ES) — shown when a save request never reaches the server and autosave is retrying on its own.
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

- c28dc85: Make dark the theme, and light the opt-in — no more "System".

  The colour scheme had three values and the third one served nobody. `System`
  followed the OS by stamping no `data-theme` at all, so a viewer on a light-mode
  machine got a dashboard neither they nor we had chosen, and the choice they
  thought they had made was really a choice not to make one. The product is
  authored dark, an unbranded public form is pinned dark regardless of any cookie
  (`lib/form-design.ts`), and the one surface that followed the OS was the admin
  chrome — the only place the inconsistency could show.

  Dark is now the default and light is a deliberate opt-in. The sidebar control
  becomes a two-state flip instead of a three-state cycle, and the Settings picker
  names both. `admin.chrome.theme.system` is gone from the message catalog in both
  locales.

  No migration: `isThemePref` no longer recognises `system`, and `getThemePref`
  already falls back to `dark` for anything it does not recognise, so a browser
  still carrying the old cookie lands on the new default rather than on a scheme
  that can no longer be selected.

  The token sheet's `@media (prefers-color-scheme: light)` block stays. Dapta Forms
  can no longer reach it — the root layout now always stamps `dark` or `light` —
  but it is the fallback for a self-host that embeds these tokens without our
  layout, which would otherwise be stuck on the dark base with no way to opt out.

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

- 451908b: Onboarding wizard copy follows the quiz-parity rework: the phone screen's
  `skip` string is gone (no question is skippable any more), and `leadVolume`
  trades its bucket option labels for a single `unit` label ("leads / month")
  shown beside the slider's number. The buckets still exist as STORED values —
  only the copy for rendering them as choices is removed.
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

- a79683f: Put the brand on the reveal screen, and stop making people retype HubSpot values
  by hand.

  **The reveal screen shows the form's logo.** It was the last of three blockers
  named for migrating the live forms over (the top banner and the cover logo landed
  already). The logo comes from `branding.logo` — the FORM's logo, not the cover's;
  the reveal is a phase inside the form, not its front door. Both renderers show it,
  and so does the `submitting` screen they draw inline, so it does not blink out at
  the moment of submission. The builder canvas draws its own reveal, so it shows the
  logo too — a preview that disagrees with the published form is the bug, not a
  follow-up.

  `FormLogo` gained `fallback="none"` for this. Its text fallback prints the FORM
  NAME, which is the author's internal name; a respondent must never be shown
  "Q3 paid-ads lead gen v2" because an image 404'd. A form with no logo renders
  byte-identically to before.

  **The HubSpot property picker now carries each property's allowed values**, and
  two places that made you type an internal value exactly — static properties, and
  the right-hand side of a value map — became dropdowns.

  - Values ride along only for enumeration properties; the key is omitted, not
    empty, so the response doesn't gain ~400 empty arrays. Options HubSpot marks
    `hidden` are dropped: it hides them from its own pickers, so offering one lets
    you configure a write HubSpot then rejects.
  - Their order is HubSpot's own and is never re-sorted — a picklist's order carries
    meaning (stages, seniority, sizes). Properties themselves stay sorted by label.
  - A value map is keyed by QUESTION, and a question can be mapped to several
    properties. The offered values are the **intersection** of those properties',
    not the union: the adapter writes one translated value to all of them, so a
    value only one accepts is a guaranteed half-written contact. A hint under the
    header names the targets, so a text box on a fanned-out question reads as a
    reason rather than a broken picker.
  - A stored value the list doesn't contain opens in text mode showing that value.
    In a dropdown it would render as an empty box — still configured, still saved,
    and looking unset.
  - Nothing constrains the value (no mapping, a text property, a portal without the
    picker configured)? The same free-text input as before. No config shape changed.

  **Value-map groups collapse**, showing the question and how many translations are
  inside. A fifty-value industry map turned this panel into a scroll with no
  landmarks. A group with nothing filled in yet stays open — there is nothing to
  summarise, and collapsing the rows out from under someone who just picked a
  question would be worse than the scroll.

  The growth badge now reads **"Powered by Dapta"** ("Con tecnología de Dapta"),
  naming the platform rather than this one product.

- 9779aac: Score-sourced visibility conditions: a show/hide rule can reference the reserved
  `@score` source (the running score over the steps before the one being decided),
  offered in the builder as "Score so far" with numeric operators. Adds the public
  form title (`config.title`, additive) resolved everywhere through the new
  `publicTitle()` helper, surfaces it in the profile listing, and corrects the
  destination port's idempotency-key documentation.
- 53ff215: Draw the share card in the form's own design — and fix the card that was never drawing the form at all.

  Every form on the platform was unfurling as the same image: a near-black
  rectangle with the word "Form" on it. The route reads `params` — which is a
  Promise in this major — synchronously, so `accountCode` and `slug` were both
  `undefined`, the lookup went to `/v1/public/forms/undefined/undefined`, took the
  404, and rendered the "no form" fallback. Nothing about it was a colour bug: the
  card had simply never seen a form. `generateMetadata` on the same page awaits its
  params, which is why the unfurl's title was right while its image was not.

  With the form actually in hand, the card is now generated from that form's own
  design rather than from a two-colour approximation of it — the palette and its
  whole derived surface ladder, the typeface, the corner radius, the button style,
  the background treatment, the logo and its placement, the content alignment, and
  the progress signal, all read through the same `resolveDesign` and
  `@quill/shared` colour helpers the page itself renders with. A form that turned
  progress off does not get a progress bar on its card; a form with square corners
  gets a square card. A form that set no branding is drawn on the product's own
  console palette, the same call `formDesignProps` already makes when it pins an
  unbranded form to the dark theme.

  The author's logo is drawn only when the author also chose the background. A logo
  is artwork with a fixed colour and no idea what is behind it; on a ground the
  author picked, that pairing is one they have seen, and on the product console it
  is a coin flip a URL cannot settle. Backing it with a white plate was worse than
  omitting it — `dapta-mark.png` is white artwork (mean luminance of its opaque
  pixels: 236/255), so the plate meant to rescue a dark logo erased a light one.
  Without one the Dapta Forms mark takes the rail instead.

  Two things Satori cannot do are handled rather than hoped for. It reads no WebP —
  the format most CMSs now serve — so an author's logo is fetched, type-checked and
  dropped when undecodable, with a timeout, a size cap and a private-address refusal
  around a fetch that is now server-side. And it needs font binaries in a format
  `next/font` does not emit, so the nine curated faces are vendored as TrueType
  under the same OFL that already lets the build redistribute them.

  The card also describes itself now: `og:image:alt` was the literal string "Form"
  for every form on the platform, because a route file's `alt` export is a
  constant and cannot see which form it is rendering. It comes from
  `generateImageMetadata` instead, which moves the image's URL from
  `…/opengraph-image` to `…/opengraph-image/card`. Responses carry a ten-minute
  shared-cache window so a link pasted into a busy channel is not re-rendered per
  reader.

  Adds `growth.shareCardSteps` and `growth.shareCardUntitled` to the message
  catalog in both locales.

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

- 7654c59: Account settings names workspaces by the same id the Dapta app does.

  - `/admin/account/workspaces/<id>` now carries the identity service's workspace id when the workspace was projected from one (the local account id otherwise). Both ids are accepted; a link with the local id of a projected workspace redirects to the canonical one.
  - The workspace page shows that id in its header with a copy control, so support threads, the admin panel and the two apps all name a workspace the same way.
  - Workspace rows (`GET /v1/workspaces`, the search) carry `workspaceId` (the upstream id, null for local-only accounts) next to `accountId`; the API itself still speaks `accountId` everywhere.
  - Account settings, Workspaces: the deployment's staff search the whole estate from the cards page too, the same way the rail switcher does; estate workspaces appear under their own heading with Open only.

### Patch Changes

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

- 7682569: Stop the Connect tab from deleting a form's other webhooks.

  A form may legitimately store several webhooks — only HubSpot is capped at one —
  but the Connect tab's webhook card reads the FIRST and used to be the only one
  the save path wrote back. So on a form with two, any edit made on that tab
  deleted the second: not just an edit to the webhook, but a HubSpot toggle or a
  tracking field, because autosave rewrites the whole `destinations` array. It
  happened silently and could not be noticed, since the deleted webhook was never
  rendered on that screen.

  The save path now carries every webhook the card does not edit, verbatim and in
  its stored order, on all three of its branches — including the one where clearing
  the URL removes the first webhook, which must not take its siblings with it. They
  sit beside the edited one rather than at the end, because a destination's index
  in that array is part of its delivery idempotency key.

  The card says so too, in the slot that survives the card being switched off — the
  state where it matters most, since flipping that switch is itself an edit. Unlike
  the HubSpot notice it sits next to, this one reports something kept rather than
  something about to be lost, and points at the account's Integrations page, where
  all of a form's webhooks are now listed.

  Not fixed here: the card still edits only the first webhook. Making it manage
  several means add/remove controls and a test-delivery endpoint that can be told
  which webhook to ping — a change to the API contract, not to this screen.

  Adds `admin.integrations.carriedWebhooks*` to the message catalog in both locales.

- 59054fe: Staff requests stop crawling, and the staff search finds workspaces by what staff actually hold.

  - A staff person's workspace refresh no longer pages through the whole estate (to a staff token the unscoped upstream search answers with every workspace there is; reading thousands of rows on every TTL and every switcher open made each request take 10 to 50 seconds). It now reads the workspaces of their own upstream account (the search scoped with `accountId`) plus, in parallel, every workspace this database already knows them in, so revoked memberships are still disabled and a grant whose workspace now names them still becomes the real membership. A membership in someone else's account that was never projected is found when they enter it from the estate search, which projects that one workspace directly.
  - The staff search also matches the accounts this database already projected by workspace name, member email or form name (the identity service only knows names, and staff usually hold a form link or the customer's address). Such rows say why they matched (the email, or "Form: name"), in the switcher and on the Account settings cards.

- 7fe4744: Dashboard fixes from the August 2026 UI review: every button shows a pointer
  cursor again (Tailwind v4 had dropped it), Home's shareable link is the member's
  public page and only while it is published, long outcome labels no longer spill
  over the score bar, and a workspace card opens Manage from anywhere on the card.
