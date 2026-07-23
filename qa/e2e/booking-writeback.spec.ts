import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This spec is loaded as ESM — derive a __dirname equivalent.
const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));

// better-sqlite3 is not hoisted to the repo-root node_modules (pnpm keeps it
// under packages/db) — resolve it through the workspace package that owns it.
const requireFromDb = createRequire(
  path.resolve(SPEC_DIR, '../../packages/db/package.json'),
);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Database = requireFromDb('better-sqlite3') as new (
  filename: string,
  options?: { readonly?: boolean },
) => {
  prepare(sql: string): { get(...params: unknown[]): unknown };
  close(): void;
};

/**
 * Booking callback API + outbox pipeline (API-level, no browser).
 *
 * POST /v1/public/forms/:accountCode/:slug/booking must:
 *   - 202 {ok:true} on a valid bookingCallbackSchema payload, persisting a
 *     booking_event row and enqueueing an outbox row (kind=booking_sync,
 *     subject_uid = booking_event.id),
 *   - 400 on an invalid payload (missing sessionId),
 *   - 404 on an unknown slug,
 *   - be drained by the outbox worker: with no CALENDLY_API_TOKEN /
 *     HUBSPOT_PRIVATE_APP_TOKEN in this env the row must end 'skipped'
 *     (graceful degradation), never stuck 'pending' or 'failed',
 *   - sit under the public rate-limit guard (429 once the per-IP bucket is
 *     drained).
 *
 * NOTE: the admin principal in this QA env is NOT the `acme` account — the
 * local auth stub resolves its own account (code e.g. `kea9if`), so the
 * public account code is read from GET /v1/me instead of being hardcoded.
 */

const API = 'http://localhost:4400';
// Resolve the QA SQLite DB relative to this spec (qa/e2e -> repo root/.data).
const DB_PATH = path.resolve(SPEC_DIR, '../../.data/qa.db');
const RUN = Date.now();

function qaDb() {
  return new Database(DB_PATH, { readonly: true });
}

/** One readonly query, closing the connection (worker writes stay visible). */
function queryOne<T>(sqlText: string, ...params: unknown[]): T | undefined {
  const db = qaDb();
  try {
    return db.prepare(sqlText).get(...params) as T | undefined;
  } finally {
    db.close();
  }
}

/** The public account code of the admin principal (NOT hardcoded `acme`). */
async function accountCode(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${API}/v1/me`);
  expect(res.status(), 'GET /v1/me should resolve the principal').toBe(200);
  const me = (await res.json()) as { accountShortCode?: string; accountCode?: string };
  const code = me.accountShortCode ?? me.accountCode;
  expect(code, '/v1/me must expose an account code').toBeTruthy();
  return code as string;
}

/**
 * Create + publish a fresh form with a booking outcome and a HubSpot
 * destination whose bookingSync properties are configured (so the worker gets
 * past the config checks and the skip happens on the missing env tokens).
 */
async function createBookingForm(
  request: APIRequestContext,
  name: string,
): Promise<{ id: string; slug: string }> {
  const config = {
    version: 1,
    cover: { enabled: true, headline: 'QA booking writeback', ctaText: 'Start' },
    steps: [{ key: 'email', type: 'email', question: 'Work email?', required: true }],
    outcomes: [
      {
        id: 'p1',
        label: 'P1',
        minScore: -100,
        booking: {
          provider: 'calendly',
          url: 'https://calendly.com/example/qa-booking',
          prefill: true,
        },
      },
    ],
    destinations: [
      {
        type: 'hubspot',
        enabled: true,
        fieldMappings: { email: 'email' },
        bookingSync: {
          stageProperty: 'stage',
          stageValue: 'SQL',
          hoursProperty: 'meeting_hours',
          dateProperty: 'meeting_date',
        },
      },
    ],
  };
  const created = await request.post(`${API}/v1/forms`, { data: { name, config } });
  expect(created.status(), 'POST /v1/forms should create the form').toBe(201);
  const form = (await created.json()) as { id: string; slug: string };

  // Draft/publish semantics in this build: a form is publicly served only
  // after an explicit publish (create alone leaves published_at null -> 404).
  const published = await request.post(`${API}/v1/forms/${form.id}/publish`);
  expect(published.status(), 'POST /v1/forms/:id/publish should succeed').toBe(201);
  return form;
}

function validCallback(sessionId: string) {
  return {
    sessionId,
    provider: 'calendly',
    eventUri: `https://api.calendly.com/scheduled_events/QA-${RUN}`,
    inviteeUri: `https://api.calendly.com/scheduled_events/QA-${RUN}/invitees/INV1`,
    startTime: '2026-08-01T15:00:00Z',
  };
}

test.describe('booking callback API + outbox pipeline', () => {
  test('valid callback -> 202, booking_event persisted, booking_sync enqueued', async ({
    request,
  }) => {
    const code = await accountCode(request);
    const form = await createBookingForm(request, `qa-booking-writeback-valid-${RUN}`);
    const sessionId = randomUUID();
    const payload = validCallback(sessionId);

    const res = await request.post(`${API}/v1/public/forms/${code}/${form.slug}/booking`, {
      data: payload,
    });
    expect(res.status()).toBe(202);
    expect(await res.json()).toEqual({ ok: true });

    // Durable fact: the booking_event row, with provider + event URI.
    const event = queryOne<{
      id: string;
      provider: string;
      event_uri: string;
      invitee_uri: string;
      session_id: string;
    }>(`SELECT id, provider, event_uri, invitee_uri, session_id
        FROM booking_event WHERE session_id = ?`, sessionId);
    expect(event, 'booking_event row must be persisted').toBeTruthy();
    expect(event!.provider).toBe('calendly');
    expect(event!.event_uri).toBe(payload.eventUri);
    expect(event!.invitee_uri).toBe(payload.inviteeUri);

    // The CRM sync rides the outbox: kind=booking_sync keyed by the event id.
    const outbox = queryOne<{ kind: string; action: string; status: string; payload: string }>(
      `SELECT kind, action, status, payload FROM outbox
       WHERE kind = 'booking_sync' AND subject_uid = ?`,
      event!.id,
    );
    expect(outbox, 'booking_sync outbox row must be enqueued').toBeTruthy();
    expect(outbox!.action).toBe('crm_update');
    expect(['pending', 'skipped', 'sent']).toContain(outbox!.status);
    expect(outbox!.payload).toContain(sessionId);
  });

  test('invalid callback (missing sessionId) -> 400', async ({ request }) => {
    const code = await accountCode(request);
    const form = await createBookingForm(request, `qa-booking-writeback-invalid-${RUN}`);
    const { sessionId: _dropped, ...missingSessionId } = validCallback(randomUUID());

    const res = await request.post(`${API}/v1/public/forms/${code}/${form.slug}/booking`, {
      data: missingSessionId,
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('BAD_REQUEST');
  });

  test('unknown slug -> 404', async ({ request }) => {
    const code = await accountCode(request);
    const res = await request.post(
      `${API}/v1/public/forms/${code}/no-such-form-${RUN}/booking`,
      { data: validCallback(randomUUID()) },
    );
    expect(res.status()).toBe(404);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('NOT_FOUND');
  });

  test('worker drains the booking_sync row to skipped (no CRM tokens in env)', async ({
    request,
  }) => {
    const code = await accountCode(request);
    const form = await createBookingForm(request, `qa-booking-writeback-worker-${RUN}`);
    const sessionId = randomUUID();

    // A completed submission with an email lets the worker resolve the
    // respondent and reach the final HubSpot write, which must degrade to a
    // log-only skip because HUBSPOT_PRIVATE_APP_TOKEN is unset in QA.
    const submitted = await request.post(
      `${API}/v1/public/forms/${code}/${form.slug}/submissions`,
      { data: { sessionId, data: { email: `qa-booking-${RUN}@example.com` } } },
    );
    expect(submitted.status()).toBe(201);

    const res = await request.post(`${API}/v1/public/forms/${code}/${form.slug}/booking`, {
      data: validCallback(sessionId),
    });
    expect(res.status()).toBe(202);

    const event = queryOne<{ id: string }>(
      `SELECT id FROM booking_event WHERE session_id = ?`,
      sessionId,
    );
    expect(event).toBeTruthy();

    // The outbox worker polls every 5s; the row must leave 'pending' and land
    // on 'skipped' (graceful no-token degradation), never 'failed'.
    await expect
      .poll(
        () =>
          queryOne<{ status: string }>(
            `SELECT status FROM outbox WHERE kind = 'booking_sync' AND subject_uid = ?`,
            event!.id,
          )?.status,
        { timeout: 15_000, intervals: [1_000] },
      )
      .not.toBe('pending');

    const row = queryOne<{ status: string; last_error: string | null }>(
      `SELECT status, last_error FROM outbox WHERE kind = 'booking_sync' AND subject_uid = ?`,
      event!.id,
    );
    expect(row!.status).toBe('skipped');
    expect(row!.last_error, 'skip reason should be recorded').toBeTruthy();
  });

  test('public booking endpoint is rate-limited (429 after the burst)', async ({ request }) => {
    // Isolate this burst in its own limiter bucket: PUBLIC_APP_URL is set in
    // QA, so trustProxyHops=1 and the LAST X-Forwarded-For entry is the key.
    // A unique fake client IP per run keeps other tests (and reruns) unthrottled.
    const fakeIp = `203.0.113.${1 + (RUN % 250)}`;
    // Invalid body ({}) on an unknown slug: the guard runs BEFORE validation,
    // so allowed requests answer 400 and nothing is ever written to the DB.
    const url = `${API}/v1/public/forms/qa-rl/${RUN}-nope/booking`;

    const statuses: number[] = [];
    let retryAfter: string | null = null;
    for (let i = 0; i < 80; i += 1) {
      const res = await request.post(url, {
        data: {},
        headers: { 'X-Forwarded-For': fakeIp },
      });
      statuses.push(res.status());
      if (res.status() === 429) {
        retryAfter = res.headers()['retry-after'] ?? null;
        break;
      }
    }
    expect(statuses, 'the rate limiter should throttle the burst').toContain(429);
    expect(retryAfter, '429 should carry a Retry-After hint').toBeTruthy();
    // Until throttled, requests reached validation (400) — never a 5xx.
    expect(statuses.filter((s) => s !== 400 && s !== 429)).toEqual([]);
  });
});
