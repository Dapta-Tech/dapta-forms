# QA context — pilot-port e2e (read me first)

Repo: this monorepo, branch `feature/pilot-features`. All pilot-port features are merged.

## Environment (boot with `bash qa/dev-sqlite.sh` if not already running)
- Web: http://localhost:3400 · API: http://localhost:4400 (SQLite `.data/qa.db`, seeded)
- Auth is the `local` dev stub: admin pages and `/v1/*` admin API need NO credentials (the principal account may NOT be `acme` — resolve it from `GET /v1/me` instead of hardcoding). Admin API base: `http://localhost:4400/v1`.
- Seeded demo form: `/acme/alex-rivera/lead-qualifier`. Imported pilot-style form: `/acme/me/pilot-lead-qualifier`.
- Node >= 20 required (on machines whose default Node is too new for better-sqlite3, put a Node 20/22 bin first on PATH).
- Run a spec: `cd <repo root> && npx playwright test -c qa/playwright.config.ts qa/e2e/<file> --reporter=list` (config has `reuseExistingServer: true`, so it uses the live :3400).

## Conventions for specs
- **Create your own form** per spec via the admin API so specs stay independent:
  `POST http://localhost:4400/v1/forms` with `{name, config}` (JSON). The response returns `{id, slug}`. Public URL: `/<accountCode from GET /v1/me>/me/<slug>`.
  NOTE draft/publish semantics: `PUT /v1/forms/:id` stores config as a DRAFT. To make config live either include it in the initial POST (create writes live config) or `POST /v1/forms/:id/publish` after a PUT.
- **Direct DB assertions** (outbox rows, booking_event, submissions): import better-sqlite3 from the repo root within the spec:
  ```ts
  import Database from 'better-sqlite3';
  const db = new Database('.data/qa.db', { readonly: true });
  db.prepare(`SELECT * FROM outbox WHERE kind = ? ORDER BY created_at DESC`).all('booking_sync');
  ```
  Tables: `form`, `submission`, `form_event`, `booking_event`, `outbox` (cols: kind, action, subject_uid, payload, status, attempts...). The outbox worker polls every 5s — poll with `expect.poll` for async rows.
- **Booking completion simulation**: the message listener is ORIGIN-allowlisted. `window.postMessage(...)` from page context carries the page origin and is (correctly) ignored. Use:
  ```js
  await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', {
    origin: 'https://calendly.com',
    data: { event: 'calendly.event_scheduled', payload: {
      event: { uri: 'https://api.calendly.com/scheduled_events/EV1' },
      invitee: { uri: 'https://api.calendly.com/scheduled_events/EV1/invitees/INV1' } } },
  })));
  // HubSpot variant:
  window.dispatchEvent(new MessageEvent('message', { origin: 'https://meetings.hubspot.com', data: { meetingBookSucceeded: true } }));
  ```
- **Useful testids**: booking `booking-iframe-hubspot`, `booking-embed-calendly`; tracking `tracking-gtm`, `tracking-gtm-noscript`, `tracking-meta-pixel`, `tracking-posthog`, `tracking-hubspot` (+`-noscript` variants).
- Public form flow selectors: cover CTA = the only `.pf__btn` on the cover; steps show `.pf__question`; continue button `.pf__btn--inline`; choice options are buttons/radios inside `.pf__fields`; done screen `.pf-done__title`; reveal `.pf-reveal__headline`; progress `.pf__topbar`. Prefer role/text selectors where stable.
- External requests: block third-party hosts with `page.route('**/*', ...)` interception when a test would otherwise hit calendly/hubspot/googletagmanager — assert the REQUEST was attempted or the tag exists, never let real requests through.
- Keep each spec self-contained and idempotent (fresh form per run; do not depend on rows from other specs).

## formConfig v1 quick reference (what specs POST)
```jsonc
{
  "version": 1,
  "cover": { "enabled": true, "headline": "...", "ctaText": "Start" },
  "steps": [
    { "key": "email", "type": "email", "question": "Email?", "required": true },
    { "key": "leads", "type": "slider", "question": "Leads?", "min": 0, "max": 100, "default": 10,
      "sliderScoring": [{ "min": 0, "max": 50, "points": 1 }], "flowGroup": "qualification" },
    { "key": "pick", "type": "multiple_choice", "question": "Pick", "flowGroup": "qualification",
      "options": [{ "label": "A", "value": "a", "points": 5 }, { "label": "B", "value": "b", "points": 0 }] },
    { "key": "bye", "type": "message", "question": "Not a fit", "terminal": true,
      "showWhen": { "field": "pick", "values": ["b"] } }
  ],
  "scoring": { "enabled": true },
  "outcomes": [
    { "id": "p1", "label": "P1", "minScore": 5, "redirectUrl": "https://example.com/p1",
      "booking": { "provider": "hubspot_meetings", "url": "https://meetings.hubspot.com/example/p1", "prefill": true } },
    { "id": "p0", "label": "P0", "minScore": -100,
      "overrides": [{ "field": "leads", "maxValue": 0 }] }
  ],
  "reveal": { "enabled": true, "headline": "Matching…", "durationMs": 1200,
    "subtitleTemplate": "Advisor for [pick]", "prewarm": true },
  "partialSubmitAfterStep": 2,
  "tracking": { "gtmId": "GTM-TEST123" },
  "destinations": [{ "type": "hubspot", "enabled": true, "fieldMappings": { "email": "email" },
    "valueMaps": { "pick": { "a": "Option A" } }, "outcomeProperty": "bucket",
    "staticProperties": { "source": "forms" }, "inferCompanyFromEmail": true,
    "bookingSync": { "stageProperty": "stage", "stageValue": "SQL", "hoursProperty": "hours", "dateProperty": "date" } }]
}
```
Steps with `triggersReveal: true` show the reveal after completing that step. `partialSubmitAfterStep` is 1-based over the runtime steps.

## V2 additions (feedback round — read for V2 specs)
- **Encryption + HubSpot connected**: the QA env now has `FORMS_ENCRYPTION_KEY` set (so `GET /v1/integrations` → `encryptionAvailable:true`) AND HubSpot is already connected at the account level (real token). `GET /v1/integrations` lists provider `hubspot` connected. The property picker returns the real 856 properties.
- **Integration connect API**: `GET /v1/integrations` (status, token-free), `POST /v1/integrations/:provider/connect {token}`, `DELETE /v1/integrations/:provider`. Never assert on a raw token.
- **Notifications API**: `GET /v1/notifications`, `PUT /v1/notifications/:emailKey {enabled?,subject?,body?}` (emailKey ∈ submission_received|submission_confirmed), `POST /v1/notifications/:emailKey/reset`.
- **New admin UIs**: `/admin/integrations` = account connections (cards per provider, connect/disconnect). Per-form mapping at `/admin/forms/:id/integrations` (Typeform-style, only usable when connected; branded searchable property `Select`; "Auto-map" button toasts a count). `/admin/settings` has a Notifications section (per-email enable toggle, subject input, body textarea, {{token}} chips, live preview, reset).
- **Editor header** (`/admin/forms/:id/edit`): `editor-copy-link`, `editor-embed` and `editor-open-form` are three ICON-ONLY buttons, directly visible beside Publish (the interim single share-menu was reverted). Labels live on `title`/`aria-label`.
- **Branded dropdowns**: admin `<select>`s are now a custom combobox (`components/ui/select.tsx`) — the trigger is a `<button aria-haspopup="listbox">`; the panel is `role="listbox"` with `role="option"`s. NOT a native `<select>`. The public `dropdown` step is still the pf-* SearchableDropdown.
- **Phone step**: public phone renders `apps/web/components/public/phone-input.tsx` — a `.pf-phone` combobox (country flag+dial trigger opens a searchable `.pf-phone__panel` listbox of countries) + a digits input. Value stored E.164 (`+<dial><digits>`). Default country from locale (en→US, es→MX).
- **Interpolation fix**: a question like `"[firstname], what problem…"` with no firstname answered renders `"What problem…"` (no leading comma). The pilot form's Q2 exercises this (qualification shows before the name step).
- **Webhook events**: webhook destination has optional `events:('partial'|'complete')[]` (absent=both). UI: Partial/Complete checkboxes in the webhook card, ≥1 must stay checked.

## V3 additions (feedback round — read for V3 specs)
- **WYSIWYG step order**: `runtimeSteps` no longer reorders — the public form renders steps exactly in authored `config.steps` order (`flowGroup` = scoring only). Specs must not assume lead-capture-last.
- **Public banner**: `.pf__banner` is pinned to the top in every phase; phase content is wrapped in `.pf__main` (topbar/body/cover are children of `.pf__main`, not `.pf`).
- **Forms list** (`/admin/forms`): single-column rows. Testids: `form-row`, `form-row-edit`, `form-row-submissions`, `form-row-analytics`, `form-row-connect` (→ `edit?tab=connect`), `form-row-copy`, `form-row-open`, `form-row-menu` (kebab = Duplicate + Delete only).
- **Branded confirm dialog**: all destructive confirms use `data-testid="confirm-dialog"` + `confirm-dialog-confirm` / `confirm-dialog-cancel` (role=alertdialog, ESC/overlay = cancel). No native `page.on('dialog')` handlers anywhere.
- **Editor tabs**: Build · Logic · Connect · Design, synced to `?tab=` (deep-linkable). Testids `editor-tab-<id>`. **The duplicate mobile tab bar is gone** — one tab row at every width, so `editor-tab-<id>-mobile` no longer exists. **The Results tab is gone too**: its points list is Logic → Scoring and its score ranges are Logic → Outcomes. `?tab=results` still parses (it resolves to Build) so old links don't dead-end, but there is no tab to click. Old `/admin/forms/:id/integrations` route redirects to `edit?tab=connect`.
- **Logic tab**: a pan/zoom canvas at `lg` and up (`logic-map` → `logic-canvas-viewport`, `logic-node`, `logic-outcome`, `logic-start`, `logic-edge-flow|goto|outcome`, `logic-zoom-in|out|fit`, `logic-auto-arrange`, `logic-node-edit`); the old vertical list still renders below `lg`. Alternatives (steps gated on the same source, and outcomes) share a column as parallel rows — do NOT assert them as a vertical sequence.
- **Form-wide logic dialogs**, opened from the Logic toolbar: `toolbar-branching` → `branching-dialog`, `toolbar-scoring` → `scoring-dialog`, `toolbar-outcomes` → `outcomes-dialog`. Every outcome/points testid is unchanged (`outcome-row`, `outcome-label`, `outcome-minscore`, `outcome-redirect`, `outcome-message`, `results-add-range`, `points-card`, `points-question-number`, …) — only the door moved.
- **Branching edits INLINE (R7)** — no per-step Edit button, no handoff to the per-question dialog. Each `branching-step` block carries: `branching-always` (a wrapper div around the branded Always-go-to combobox; drive it via the trigger `role=button` named `Always go to — <question>` / for schedulers `After a booking`, then pick a `role=option`), `branching-rules` (the shared `LogicRules` rows, option types only, catch-all excluded), and `branching-visibility` (the shared `LogicConditions`, from step 2 on). Absent controls are deliberate — a type that can't do a thing shows nothing, never an explanation. The catch-all `goto` (`values:['*']`) is always written LAST in the array.
- **Per-question logic** moved out of the Advanced accordion: the Build panel shows a read-only summary (`question-logic`, `question-logic-count`, `question-logic-show|hide|goto|booking`) and `question-logic-edit` opens the shared `logic-dialog`, which is where `logic-show`/`logic-hide` and the rule editor now live.
- **Preview is an iframe** (`preview-iframe`) rendering the REAL public renderer at a true viewport, fed the in-memory draft by postMessage. Reach inside with `frameLocator('[data-testid="preview-iframe"]')`; `live-preview` now lives in that document and carries `data-preview-state="waiting"|"ready"`. Three presets: `preview-device-mobile` (390×844) · `preview-device-tablet` (768×1024) · `preview-device-desktop` (1280×800), read back from `preview-viewport`. There is no screen picker — walk the form like a respondent.
- **Editor topbar is two rows.** Row 1 (whole-form scope): back · name · save status · centred labelled tabs · the three share icons · Publish. Row 2 (`editor-toolbar`, section scope) changes with the active tab — on Build: `toolbar-add-question` (the ONE add button; the spine's dashed duplicate is gone), the `canvas-device-*` switch, and `toolbar-preview` (▷) right beside it; there is NO `toolbar-design` (the tab row already says Design). On non-Build tabs `toolbar-preview` sits at the row's end. The device switch MOVED here from the canvas sub-header, which now carries only the "Question n of N" caption.
- **Connect tab**: `connect-panel` with `connect-integrations` (embedded integrations editor), Tracking & Pixels inputs (`tracking-gtm`, `tracking-meta`, `tracking-posthog-key`, `tracking-posthog-host`, `tracking-hubspot` → write `config.tracking`, injected on the public page), and `connect-emails` (per-form overrides).
- **Mapping key dropdowns**: custom mappings + value maps use grouped searchable selects — `mapping-key-select` / `mapping-key-custom`, `valuemap-key-select` / `valuemap-key-custom` (groups: form questions, UTM system fields, custom escape).
- **Per-question Map to**: question settings HubSpot section — `qs-hubspot-section`, `qs-hubspot-mapto`, `qs-hubspot-connect-cta`, `qs-hubspot-saved`; writes live `fieldMappings` via `PUT /v1/forms/:id/destinations`.
- **Partial submit point**: spine marker `partial-point-row` (+ `partial-point-add`, `partial-point-remove`, `partial-point-info`, `partial-point-handle`, root `question-spine`). Keyboard-draggable via dnd-kit; Design tab has only `partial-point-design-note`.
- **Per-form emails**: `GET/PUT /v1/forms/:id/notifications(/:emailKey)` + `POST …/reset`; precedence form → account → stock (per field; a form row's `enabled` wins). UI testids `connect-email-{key}`, `connect-email-customize-{key}`, `connect-email-use-account-{key}`, `connect-email-save-{key}`, `connect-email-{key}-subject|-body`. Migration 0005 (`notification_setting.form_id`, partial uniques) applied to the QA DB.
- **@ token picker**: canvas title textarea = `canvas-title-input` (role=combobox); dropdown `token-picker` with `token-option[data-key]`; hint `token-hint`; warnings `token-warning[data-kind="later"|"unknown"]`. Only earlier capturing steps' keys (name subfields included) are offered.
- **Name placeholders**: public name inputs default to localized "First name"/"Last name" (es: Nombre/Apellidos); canvas previews live (`canvas-name-first`, `canvas-name-second`); settings placeholder fields `name-placeholder-0/1`.

## Traps that cost a spec an hour (found during the builder-redesign triage)

- **A builder `Field` label is NOT the control's sibling.** `_components/fields.tsx`
  renders `<div><span><label>Badge</label></span><control/></div>` and sets no
  `htmlFor`, so **both** `label:text-is("X") + input` and
  `getByText('X').locator('xpath=following-sibling::div[1]')` match nothing.
  Reach the control through the wrapper instead — `label:text-is("X")` +
  `xpath=ancestor::div[1]`, or `xpath=../following-sibling::div[1]`. (`getByLabel`
  only works where the `<label>` *wraps* the input, e.g. the client-logo rows.)
- **Open Advanced before touching Behavior.** `Ends the form`, `Hidden`,
  `Show reveal screen after`, the field-key editor and the default-answer row all
  live inside `advanced-settings`, which is COLLAPSED by default — but
  auto-opens when the step already carries a badge (dynamic / ends-form / hidden
  / default / scored). A blind click therefore closes it. Toggle only when
  `aria-expanded` is not `"true"`.
- **Per-question conditions are in the dialog, not the panel.** `logic-show` /
  `logic-hide` (and the `Show when — Field` / `Hide when — Field` comboboxes)
  render inside `logic-dialog`, opened by `question-logic-edit`. Close it with
  `logic-dialog-close` before driving the topbar (save status / Publish).
- **The public API rate limit will bite any spec that walks several forms.**
  Per-IP token bucket, **60 burst / 1-per-second refill**
  (`RATE_LIMIT_CAPACITY`, `RATE_LIMIT_REFILL_PER_SEC`; 429 carries
  `Retry-After: 1`). Every spec drains the SAME bucket, because public traffic
  reaches the API from the **Next server**, not the browser — a `page.on('request')`
  listener sees zero `/v1/public/*` calls, so the drain is invisible from the
  page. Reproduce it deterministically with
  `for i in $(seq 1 70); do curl -s -o /dev/null http://localhost:4400/v1/public/forms/<code>/nope-$i; done`
  (the guard runs before the handler, so even 404s spend tokens).
  Three symptoms and their fixes:
  - **Page LOAD throttled** → `getJson` throws → the public subtree renders its
    error boundary, **"This page didn't load"**, with no `.pf__*` markup at all,
    and a naive `expect(input).toBeVisible()` just times out. Fix: goto-retry with
    a ~5s refill pause (`gotoPublic` in `builder-gaps.spec.ts`, `openFirstStep` in
    `v6-scheduler-booking.spec.ts`, `openForm` in `v5-reveal-positions.spec.ts`).
  - **Final SUBMIT throttled** → `finalize` sets the error and puts the phase back
    to `steps`, so the last question returns with `.pf__error` and its Continue
    button. Fix: retry the click like a respondent (`runToCompletion` in
    `v5-reveal-positions.spec.ts`, the terminal test in `builder-gaps.spec.ts`).
    Walking mid-form steps is pure client work — only the submit crosses the wire.
  - **A submit you cannot re-trigger** (a scheduler booking: `handleSchedulerBooked`
    marks the step booked *before* it posts and never runs twice, so re-dispatching
    the Calendly message is ignored and the run strands on the scheduler step).
    Fix: put the bucket in a KNOWN state before walking — spend it to empty, then
    wait a fixed refill (`awaitPublicApiHeadroom` in `v6-scheduler-booking.spec.ts`,
    ~20s buys one whole walk). A single probe cannot distinguish "full" from
    "one token left", so probing alone is not enough.
- **Do not scroll the settings COLUMN to assert a row is reachable.** The HubSpot
  "Map to" section renders *below* the Advanced group, so the column's maximum
  scrollTop puts the HubSpot card in frame and the last advanced row off the top.
  Scroll to the ROW (`scrollIntoViewIfNeeded`) and assert the ROW.

## Known environmental gaps in a `dev-sqlite.sh`-only QA DB

These are fixture gaps, not product regressions. Do not "fix" the specs that hit
them by weakening assertions — reproduce the fixture or skip.

- **No HubSpot token.** `GET /v1/integrations` → `{"providers":[],"serverProvided":["hubspot"]}`.
  Anything asserting "HubSpot connected", the 856-property picker, or real
  HubSpot property names fails. (The V2 section above describes an environment
  that HAD a token connected at account level.) Affects e.g.
  `v3-shots.spec.ts › shot · editor Connect tab`.
- **No imported pilot form.** `/…/pilot-lead-qualifier` renders "Not found":
  `qa/import-pilot-form.ts` is a MANUAL step and the seed never creates it. All 5
  `suite-regression.spec.ts` tests depend on it, and the forms-list shot used to
  gate on its display names ("Pilot Lead Qualifier", "Test").
- **Only a handful of seeded workspaces.** The app-switcher panel's content is
  ~116px, so `v9-rail-menus.spec.ts › a panel taller than the space available
  clamps and scrolls in place` cannot reach its overflow branch even at a 160px
  viewport (measured `scrollHeight === clientHeight === 116`). The test guards a
  real behaviour; it needs either more seeded workspaces or a shorter viewport.
