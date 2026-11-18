# @quill/config

## 0.1.0

### Minor Changes

- 0624475: The API can keep answering on an old host while telling callers to move, and
  show which API keys still use it.

  A deployment that moves its API to a new domain cannot redirect the old host
  while keys still call it: a redirect drops `Authorization: Bearer dforms_...`.
  `API_DEPRECATED_HOSTS` (optional, comma-separated hostnames) names the hosts
  that keep serving but are on their way out. Unset, nothing changes. Set, every
  response on a listed host, errors included, carries `Deprecation` (RFC 9745,
  from `API_DEPRECATION_DATE`), a `Link` to the same path on `API_SUCCESSOR_URL`
  with `rel="successor-version"` and, when `API_SUNSET_DATE` is set, `Sunset`.
  Each call made there with an API key, on the REST routes or on `/mcp`, is
  logged once as a JSON line with the key's id, its workspace, the method, the
  route pattern, the status and the host; never the key and never the query. A
  call without a key gets the headers and no line.

  The host is the `Host` header, compared case-insensitively without the port;
  `X-Forwarded-Host` is not read. Health checks and in-cluster calls use names
  nobody lists, so they are never affected. The successor URL and the
  deprecation date are required with the list, and a malformed entry, a
  successor that is not a plain https origin or lists itself, a bad date, or a
  sunset before the deprecation refuses to boot.

  - `@quill/config`: `API_DEPRECATED_HOSTS`, `API_SUCCESSOR_URL`,
    `API_DEPRECATION_DATE`, `API_SUNSET_DATE`, and `apiDeprecation`, the
    resolved settings (null when off).
  - `@quill/mcp`: `McpDoorOptions.onAuthenticated`, an optional hook called with
    the request and the caller once a credential resolves, before its rate
    limit.

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

- afa9620: Spam protection can accept challenge tokens from more than one host.

  `CAPTCHA_HOSTNAMES` (optional, comma-separated hostnames) lists the hosts a
  deployment serves its public forms on when it has more than one, for example
  while it moves to a new domain with both hosts live. Unset, nothing changes: a
  token must come from the host of `PUBLIC_APP_URL`, and the host is not checked
  when that is empty. Set, a token must come from one of the listed hosts or from
  the host of `PUBLIC_APP_URL`, which is always included. Entries are trimmed and
  lowercased and blanks are dropped (an empty value reads as unset); an entry
  written as an origin is reduced to its hostname, and a wildcard or a
  `host:port` refuses to boot while the check is on. The action and session
  checks are unchanged.

  - `@quill/config`: `CAPTCHA_HOSTNAMES` and `captchaHostnames`, the resolved
    list (null when the host is not checked).

- ba2b728: Add `DCAL_API_BASE_URL` and `DCAL_APP_URL`, the two hosts of dCal: its API
  serves `/v1`, its app serves the booking pages and the event-type editor.

  There is deliberately no token beside them. dCal projects the same identity
  service this app does, so the author's own session is forwarded to it and
  nothing is stored or encrypted. Both are absent in a bare fork, which reports
  dCal unavailable and offers Calendly, the same graceful degradation every other
  integration has.

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

- ef213f9: Google Sheets connects through Google's own consent flow, the first provider whose credential is not pasted.

  `account_integration` gains the `google-sheets` provider. What it stores is the OAuth refresh token the flow hands back; the client id and secret that redeem it stay in the deployment's environment (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`), so the storage contract is unchanged: one opaque, encrypted secret per account. No migration: `provider` is a text column.

  All three variables unset leaves the integration off, exactly as a missing token does for the other providers.

  The consent asks for the `drive.file` scope only, the one Google classes as non-sensitive, so a self-hosted deployment's consent screen needs no Google verification. `GOOGLE_PICKER_API_KEY` is optional and turns on choosing an existing spreadsheet; without it a form can still have one created for it. `GOOGLE_PICKER_APP_ID` is read off the client id when unset.

  The connections page gains the Google Sheets card that starts that flow, so the copy catalog gains its strings in English and Spanish. The page subtitle no longer names the two providers it used to list, which went stale the moment a third one joined them.

- 3af3eed: Settings for MCP connections signed in through OAuth. All optional; with `MCP_OAUTH_PROVIDER` unset or blank, the default, none of the others is read and the MCP server takes API keys only.

  - `MCP_OAUTH_PROVIDER` (unset, or `workos`), `WORKOS_AUTHKIT_DOMAIN` (the issuer, an https origin) and `MCP_PUBLIC_URL` (the `/mcp` endpoint customers reach, every token's audience). `mcpOAuth` returns the resolved settings, or null when off. With a provider set, a missing or malformed value refuses to boot.
  - `IAM_DB_HOST`, `IAM_DB_PORT` (5432 when unset), `IAM_DB_NAME`, `IAM_DB_SCHEMA`, `IAM_DB_USER` and `IAM_DB_PASS`: read-only access to the identity database, where the API maps a signed-in person to the user id members carry.
  - `IAM_DB_SSL_CA`: the CA of that database's certificate, as the PEM itself or the path of a file holding it. Set, the certificate and its host name are verified (verify-full). Unset, the connection is encrypted but the certificate is not verified.

- 55beb72: The dForms MCP server: `POST /mcp` on the API, with the workspace API keys (`Authorization: Bearer dforms_...`).

  - New `@quill/mcp` package: ten tools (`whoami`, `list_forms`, `get_form`, `create_form`, `update_form`, `publish_form`, `revert_form`, `list_responses`, `get_form_analytics`, `get_form_guide`), each with a title and the read-only, destructive, idempotent and open-world hints. No delete tools. Stateless Streamable HTTP on the official TypeScript SDK, serving 2026-07-28 clients and 2025-era `initialize` clients.
  - The tools run the API's own form handlers in process, so an agent is held to every rule the web and the REST API apply: the workspace comes from the key (another workspace's form is `NOT_FOUND`), the member's current role, the strict API-key validation and the normalized config. A refused config answers `VALIDATION_FAILED` with every problem and its path. Forms created through the MCP record `created_via = 'mcp'`, and their product events carry `via: 'mcp'`.
  - The door refuses anonymous requests (401 with a `Bearer` challenge), bad or revoked keys (401, never downgraded), credentials in the URL (400), browser origins outside `MCP_ALLOWED_ORIGINS` (403), a `Host` outside `MCP_ALLOWED_HOSTS` when set (403), anything but a JSON `POST` (405, 415), and a key past its bucket (429 with `Retry-After`). Write tools have a tighter bucket and every call has a timeout. One audit line per tool call, with the key prefix and a hash of the redacted arguments, never the key or any content.
  - Responses come back inside `respondent_supplied`, cleaned of control characters, HTML and markdown links and cut to length. Analytics come back with the definition of every metric.
  - `@quill/mcp/guide` holds the config JSON Schema, the rules and the examples, shared with the API skill zip.
  - `@quill/config`: `MCP_ENABLED`, `MCP_ALLOWED_ORIGINS`, `MCP_ALLOWED_HOSTS`, `MCP_RATE_LIMIT_CAPACITY`, `MCP_RATE_LIMIT_REFILL_PER_SEC`, `MCP_WRITE_RATE_LIMIT_CAPACITY`, `MCP_WRITE_RATE_LIMIT_REFILL_PER_SEC` and `MCP_TOOL_TIMEOUT_MS`, all optional; a blank value reads as unset.
  - `@quill/shared`: the setup guide on the MCP page now connects Claude Code, Codex and Cursor to the MCP server (the key in `DFORMS_API_KEY`, then each agent's entry, with a one-click link for Cursor), in English and Spanish. The skill zip stays as the way in for agents without MCP. The web app reads the address at runtime from `MCP_PUBLIC_URL`, else the public API address plus `/mcp`.

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

- 1e4b762: Load the deployment's own GTM container on platform pages — login, onboarding,
  and the admin dashboard — never on a public form page.

  The marketing site already carries the container; the platform lives on a
  different domain, so until now the funnel went dark the moment someone crossed
  from the landing to the product. `PlatformGtm`
  (`components/analytics/platform-gtm.tsx`) closes that gap from the three
  platform entry points, reusing `buildGtmSnippet` and the noscript iframe shape
  from the public-page tracking module.

  The boundary is the same one `ProductAnalytics` already draws, for the same
  reason: a public form page's visitor is a form owner's respondent, and that page
  may already carry the OWNER's GTM container via `NEXT_PUBLIC_GTM_ID` / per-form
  config. Loading ours beside it would cross-fire both containers through the
  shared `dataLayer` and file a customer's traffic under our marketing account —
  which is also why the Script id (`platform-gtm`) differs from `tracking-gtm`:
  next/script dedupes by id, and the two must never suppress one another.

  Configured by the new `NEXT_PUBLIC_PLATFORM_GTM_ID` (client env schema,
  `@quill/config`). Resolution is server-side at request time — every mount point
  is a dynamic route — with a fallback that keeps both standing invariants true at
  once: on an `AUTH_PROVIDER=workos` build (every Dapta deployment) a missing env
  var falls back to Dapta's own container in code, so the platform cannot ship a
  silent no-op the way a missing build-time `NEXT_PUBLIC_` once did; anywhere else
  (every bare fork) it resolves to nothing, and the fork keeps making zero
  third-party requests.

- 72a7876: Product analytics plumbing (no events emitted yet). Adds `attributionSchema` to @quill/types (the contract for the first-touch acquisition blob that migration 0010 persists on `account.attribution`), an `analytics` outbox kind, and the `PRODUCT_ANALYTICS_KEY` / `NEXT_PUBLIC_PRODUCT_ANALYTICS_KEY` env pair (plus hosts). Server-side events enqueue through the outbox and drain with retry/backoff — never inline, because the most important event fires on the public submission path. The browser half loads only on the admin dashboard, identifies by email, and registers `product: 'forms'` plus a `forms_account` group as super properties. Deliberately NOT named `NEXT_PUBLIC_POSTHOG_*`: those already exist and belong to the form owner's own pixels on their public form page. Unset (the default) = fully off, so a bare fork makes zero third-party requests.
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

### Patch Changes

- 919dbdb: dCal counts as configured only when BOTH `DCAL_API_BASE_URL` and `DCAL_APP_URL`
  are set. With just the API host every booking URL the picker built was relative,
  so the picker offered event types whose save then failed validation.
- bbf5cdf: A question screen keeps its Continue button on screen. A long option list (or a
  screen of several questions) scrolls inside the card instead of pushing the
  button below the fold; the Build canvas shows the same cap. The editor gets a
  Results link that opens the form's responses.

  Notification emails wear the dForms brand: an accent bar, the wordmark (served
  from `PUBLIC_APP_URL`, with the name as type when there is none), a bordered
  card, a ruled answers table and real links. The message now names its language,
  so the transactional service's footer matches the body, and the page's side
  padding sits on `<body>`, which also insets that footer.

  Both submission emails end with a green "Create your form, free" button (in the
  email's language) when the deployment has the growth loop on, the same rule as
  the "Made with" badge. The API now reads `NEXT_PUBLIC_SIGNUP_URL`,
  `NEXT_PUBLIC_LANDING_URL` and `NEXT_PUBLIC_HIDE_BADGE` too; the links carry
  `utm_medium=email-receipt` or `email-notice`.

- 14ee2b0: The link an MCP sign-in maps through, in both dialects (migration 0026, additive): the nullable `member.idp_subject` (the external authorization server's user id, one member per account) and `member.login_seen_at` (when the identity service last vouched for the member at a verified web login), with `recordMemberIdpSubject`, `noteMemberLogin`, `memberIdpLink` and `membershipsBySubject` to write and read it. The SQLite `txn` handle takes `{ immediate: true }`. The config adds `OAUTH_LINK_MAX_AGE_DAYS` (30 by default, 1 to 365) and drops the `IAM_DB_*` settings.
- f999dda: Add `OPENAI_APPS_CHALLENGE_TOKEN`: the API serves it as plain text at `/.well-known/openai-apps-challenge`, the domain check OpenAI runs before a ChatGPT app built on the MCP server can be submitted. Unset (the default), that path answers 404.
