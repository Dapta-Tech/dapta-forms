/**
 * Booking → CRM sync, end to end on in-memory SQLite: a scheduling callback
 * enqueues a durable `booking_sync` outbox row (never inline HTTP), and the
 * worker-side handler enriches via the Calendly API and updates the HubSpot
 * contact with the configured booking properties — asserting the UTC-midnight
 * date math, the epoch-ms hours value, log-only degradation when tokens are
 * absent, and retryable vs permanent failure semantics.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createDb,
  migrate,
  seed,
  listOutbox,
  updateForm,
  getAccountByCode,
  listForms,
  sql,
  type Db,
} from '@quill/db';
import { SubmissionNotifier, LogOnlyEmailProvider } from '@quill/notifications';
import { SubmissionService } from './submission.service';
import { EmailEffects } from './email-effects';
import { DestinationEffects } from './destination-effects';
import { BookingEffects } from './booking-effects';
import { BookingSyncEffects } from './booking-sync';
import { OutboxWorker } from './outbox.worker';

const EVENT_URI = 'https://api.calendly.com/scheduled_events/abc';
const INVITEE_URI = 'https://api.calendly.com/scheduled_events/abc/invitees/def';
const HUBSPOT_UPSERT_URL = 'https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert';

interface RecordedCall {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

let db: Db;
let svc: SubmissionService;
let bookingSync: BookingSyncEffects;

function newEmailEffects() {
  return new EmailEffects(new SubmissionNotifier(new LogOnlyEmailProvider()), db);
}

function newWorker() {
  const env = { OUTBOX_WORKER_ENABLED: false, OUTBOX_POLL_MS: 5000, NODE_ENV: 'test' } as never;
  return new OutboxWorker(db, env, newEmailEffects(), new DestinationEffects(db), bookingSync);
}

/** Record every call; answer per-URL from `responses` (default 200 `{}`). */
function recordingFetch(
  calls: RecordedCall[],
  responses: Record<string, () => Response> = {},
): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    });
    const make = responses[url];
    return make ? make() : jsonResponse({});
  }) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Point the seeded form at ONE enabled HubSpot destination with bookingSync. */
async function setHubspotDestination(bookingSyncConfig?: Record<string, string>) {
  const account = await getAccountByCode(db, 'acme');
  const forms = await listForms(db, account!.id);
  const form = forms.find((f) => f.slug === 'lead-qualifier')!;
  const full = await db.get<{ config: string }>(sql`SELECT config FROM form WHERE id = ${form.id}`);
  const config = JSON.parse(full!.config);
  config.destinations = [
    { type: 'hubspot', enabled: true, settings: {}, bookingSync: bookingSyncConfig },
  ];
  await updateForm(db, account!.id, form.id, { config });
  return { accountId: account!.id, formId: form.id };
}

const BOOKING_SYNC_CONFIG = {
  stageProperty: 'sales_stage',
  stageValue: 'demo_booked',
  dateProperty: 'sales_date_booked',
  hoursProperty: 'hours_booking',
};

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db);
  bookingSync = new BookingSyncEffects(
    db,
    { CALENDLY_API_TOKEN: 'cal-token', HUBSPOT_PRIVATE_APP_TOKEN: 'hs-token' } as never,
  );
  svc = new SubmissionService(db, newEmailEffects(), undefined, new BookingEffects(db));
});

afterEach(async () => {
  await db.close();
});

describe('booking callback enqueue', () => {
  it('enqueues a pending booking_sync outbox row anchored to the booking_event', async () => {
    await setHubspotDestination(BOOKING_SYNC_CONFIG);
    const out = await svc.booking('acme', 'lead-qualifier', {
      sessionId: 'sess-b1',
      provider: 'calendly',
      eventUri: EVENT_URI,
      inviteeUri: INVITEE_URI,
    });
    expect('error' in out).toBe(false);

    const rows = await listOutbox(db, { kind: 'booking_sync' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('pending');
    expect(rows[0]!.action).toBe('crm_update');

    const event = await db.get<{ id: string; form_id: string }>(
      sql`SELECT id, form_id FROM booking_event WHERE session_id = 'sess-b1' LIMIT 1`,
    );
    expect(rows[0]!.subjectUid).toBe(String(event!.id));

    const payload = JSON.parse(rows[0]!.payload!) as Record<string, unknown>;
    expect(payload.bookingEventId).toBe(String(event!.id));
    expect(payload.formId).toBe(String(event!.form_id));
    expect(payload.sessionId).toBe('sess-b1');
    expect(payload.provider).toBe('calendly');
    expect(payload.eventUri).toBe(EVENT_URI);
    expect(payload.inviteeUri).toBe(INVITEE_URI);
    expect(typeof payload.accountId).toBe('string');
  });
});

describe('booking_sync delivery', () => {
  it('Calendly happy path: fetches event + invitee, writes stage + UTC-midnight date + epoch-ms hours', async () => {
    await setHubspotDestination(BOOKING_SYNC_CONFIG);
    await svc.booking('acme', 'lead-qualifier', {
      sessionId: 'sess-cal',
      provider: 'calendly',
      eventUri: EVENT_URI,
      inviteeUri: INVITEE_URI,
      // No startTime in the callback — the Calendly event fetch supplies it.
    });

    // 00:30 UTC: a local-timezone floor would land on the WRONG calendar day
    // anywhere west of UTC — asserts the date math is UTC-midnight, not local.
    const startIso = '2026-08-02T00:30:00Z';
    const calls: RecordedCall[] = [];
    bookingSync.fetchImpl = recordingFetch(calls, {
      [EVENT_URI]: () => jsonResponse({ resource: { start_time: startIso } }),
      [INVITEE_URI]: () => jsonResponse({ resource: { email: 'Lead@Acme.IO', name: 'Lead P' } }),
      [HUBSPOT_UPSERT_URL]: () => jsonResponse({ results: [{ id: '123' }] }),
    });

    await newWorker().drainOnce();

    const rows = await listOutbox(db, { kind: 'booking_sync' });
    expect(rows[0]!.status).toBe('done');

    // Both Calendly resources fetched with the server token.
    const calendlyCalls = calls.filter((c) => c.url.startsWith('https://api.calendly.com/'));
    expect(calendlyCalls.map((c) => c.url).sort()).toEqual([EVENT_URI, INVITEE_URI]);
    for (const c of calendlyCalls) {
      expect(c.headers.Authorization).toBe('Bearer cal-token');
    }

    // One HubSpot upsert keyed by the (lowercased) invitee email.
    const hubspot = calls.filter((c) => c.url === HUBSPOT_UPSERT_URL);
    expect(hubspot).toHaveLength(1);
    expect(hubspot[0]!.headers.Authorization).toBe('Bearer hs-token');
    const input = (hubspot[0]!.body as { inputs: Array<Record<string, unknown>> }).inputs[0]!;
    expect(input.idProperty).toBe('email');
    expect(input.id).toBe('lead@acme.io');
    expect(input.properties).toEqual({
      sales_stage: 'demo_booked',
      hours_booking: String(Date.parse(startIso)), // exact meeting start, epoch-ms
      sales_date_booked: String(Date.UTC(2026, 7, 2)), // UTC midnight of Aug 2
    });
  });

  it('startTime provided directly (hubspot_meetings): no Calendly fetch, date/hours still written', async () => {
    await setHubspotDestination(BOOKING_SYNC_CONFIG);
    // The respondent email comes from the session's submission answers.
    await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-hs',
      data: { role: 'founder', team_size: 20, email: 'Booked@Acme.IO' },
    });
    const startIso = '2026-09-10T14:00:00-05:00'; // 19:00 UTC → UTC day Sep 10
    await svc.booking('acme', 'lead-qualifier', {
      sessionId: 'sess-hs',
      provider: 'hubspot_meetings',
      startTime: startIso,
    });

    const calls: RecordedCall[] = [];
    bookingSync.fetchImpl = recordingFetch(calls, {
      [HUBSPOT_UPSERT_URL]: () => jsonResponse({ results: [{ id: '9' }] }),
    });
    await newWorker().drainOnce();

    const rows = await listOutbox(db, { kind: 'booking_sync' });
    expect(rows[0]!.status).toBe('done');

    // No Calendly call was made — only the HubSpot upsert.
    expect(calls.map((c) => c.url)).toEqual([HUBSPOT_UPSERT_URL]);
    const input = (calls[0]!.body as { inputs: Array<Record<string, unknown>> }).inputs[0]!;
    expect(input.id).toBe('booked@acme.io'); // resolved from the submission answers
    expect(input.properties).toEqual({
      sales_stage: 'demo_booked',
      hours_booking: String(Date.parse(startIso)),
      sales_date_booked: String(Date.UTC(2026, 8, 10)),
    });
  });

  it('HubSpot token absent → log-only skip, no HTTP at all', async () => {
    bookingSync = new BookingSyncEffects(db, {} as never); // no tokens configured
    await setHubspotDestination(BOOKING_SYNC_CONFIG);
    await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-skip',
      data: { role: 'founder', team_size: 20, email: 'lead@acme.io' },
    });
    await svc.booking('acme', 'lead-qualifier', {
      sessionId: 'sess-skip',
      provider: 'hubspot_meetings',
      startTime: '2026-08-01T15:00:00Z',
    });

    const calls: RecordedCall[] = [];
    bookingSync.fetchImpl = recordingFetch(calls);
    await newWorker().drainOnce();

    const rows = await listOutbox(db, { kind: 'booking_sync' });
    expect(rows[0]!.status).toBe('skipped'); // a decision, recorded once — not retried
    expect(rows[0]!.lastError).toContain('HUBSPOT_PRIVATE_APP_TOKEN');
    expect(calls).toHaveLength(0);
  });

  it('HubSpot HTTP 500 throws → the row stays pending with a retry scheduled', async () => {
    await setHubspotDestination(BOOKING_SYNC_CONFIG);
    await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-500',
      data: { role: 'founder', team_size: 20, email: 'lead@acme.io' },
    });
    await svc.booking('acme', 'lead-qualifier', {
      sessionId: 'sess-500',
      provider: 'hubspot_meetings',
      startTime: '2026-08-01T15:00:00Z',
    });

    const calls: RecordedCall[] = [];
    bookingSync.fetchImpl = recordingFetch(calls, {
      [HUBSPOT_UPSERT_URL]: () => jsonResponse({ error: 'boom' }, 500),
    });
    await newWorker().drainOnce();

    const rows = await listOutbox(db, { kind: 'booking_sync' });
    expect(rows[0]!.status).toBe('pending'); // retryable — backoff, not terminal
    expect(rows[0]!.attempts).toBe(1);
    expect(rows[0]!.lastError).toContain('HTTP 500');
    expect(rows[0]!.nextAttemptAt).toBeGreaterThan(rows[0]!.createdAt);
  });

  it('no bookingSync config on the destination → skipped (permanent config gap)', async () => {
    await setHubspotDestination(undefined);
    await svc.booking('acme', 'lead-qualifier', {
      sessionId: 'sess-nocfg',
      provider: 'hubspot_meetings',
      startTime: '2026-08-01T15:00:00Z',
    });

    const calls: RecordedCall[] = [];
    bookingSync.fetchImpl = recordingFetch(calls);
    await newWorker().drainOnce();

    const rows = await listOutbox(db, { kind: 'booking_sync' });
    expect(rows[0]!.status).toBe('skipped');
    expect(calls).toHaveLength(0);
  });
});
