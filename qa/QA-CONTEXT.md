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
- **Editor header** (`/admin/forms/:id/edit`): new buttons `data-testid="editor-copy-link"` and `data-testid="editor-open-form"` between Preview and Publish.
- **Branded dropdowns**: admin `<select>`s are now a custom combobox (`components/ui/select.tsx`) — the trigger is a `<button aria-haspopup="listbox">`; the panel is `role="listbox"` with `role="option"`s. NOT a native `<select>`. The public `dropdown` step is still the pf-* SearchableDropdown.
- **Phone step**: public phone renders `apps/web/components/public/phone-input.tsx` — a `.pf-phone` combobox (country flag+dial trigger opens a searchable `.pf-phone__panel` listbox of countries) + a digits input. Value stored E.164 (`+<dial><digits>`). Default country from locale (en→US, es→MX).
- **Interpolation fix**: a question like `"[firstname], what problem…"` with no firstname answered renders `"What problem…"` (no leading comma). The pilot form's Q2 exercises this (qualification shows before the name step).
- **Webhook events**: webhook destination has optional `events:('partial'|'complete')[]` (absent=both). UI: Partial/Complete checkboxes in the webhook card, ≥1 must stay checked.
