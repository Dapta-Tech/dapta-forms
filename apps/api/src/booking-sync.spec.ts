/**
 * Booking → CRM sync, end to end on in-memory SQLite: a scheduling callback
 * enqueues a durable `booking_sync` outbox row (never inline HTTP), and the
 * worker-side handler enriches via the Calendly API and updates the HubSpot
 * contact with the configured booking properties — asserting the midnight
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
import { BookingEffects, BOOKING_SYNC_DELAY_MS } from './booking-effects';
import { BookingSyncEffects, dayMidnightMs, utcMidnightMs } from './booking-sync';
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

/**
 * Drain with the clock advanced past `BOOKING_SYNC_DELAY_MS`, which is when a
 * `booking_sync` row first becomes due. Every delivery test goes through this:
 * calling `drainOnce()` at the real clock claims nothing, which is exactly the
 * dormancy the delay exists to create.
 */
function drainDue() {
  return newWorker().drainOnce(Date.now() + BOOKING_SYNC_DELAY_MS + 1_000);
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
async function setHubspotDestination(
  bookingSyncConfig?: Record<string, string>,
  extra: Record<string, unknown> = {},
) {
  const account = await getAccountByCode(db, 'acme');
  const forms = await listForms(db, account!.id);
  const form = forms.find((f) => f.slug === 'lead-qualifier')!;
  const full = await db.get<{ config: string }>(sql`SELECT config FROM form WHERE id = ${form.id}`);
  const config = JSON.parse(full!.config);
  config.destinations = [
    { type: 'hubspot', enabled: true, settings: {}, bookingSync: bookingSyncConfig, ...extra },
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

/**
 * What `dateProperty` should hold for a booking made at `bookedAt`: the day the
 * BOOKING happened, not the day of the meeting. The tests run on the real clock
 * (no fake timers anywhere in this repo), so they capture the moment around the
 * callback and floor it the same way the delivery does — while separately
 * asserting the value is NOT the meeting's day, which is the actual regression.
 */
function bookedDay(bookedAt: number, timezone?: string): string {
  return String(dayMidnightMs(bookedAt, timezone));
}

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

  // A booking on a mid-form `scheduler` step is recorded BEFORE the submission
  // is finalized. Draining inside that gap delivers as `partial`, which drops
  // the outcome property, the static properties and the Note — permanently,
  // since the row closes on success. The row therefore starts DORMANT.
  it('holds the row dormant so the submission can finish first', async () => {
    await setHubspotDestination(BOOKING_SYNC_CONFIG);
    const before = Date.now();
    await svc.booking('acme', 'lead-qualifier', {
      sessionId: 'sess-delay',
      provider: 'calendly',
      eventUri: EVENT_URI,
      inviteeUri: INVITEE_URI,
    });

    const [row] = await listOutbox(db, { kind: 'booking_sync' });
    expect(row!.nextAttemptAt).toBeGreaterThanOrEqual(before + BOOKING_SYNC_DELAY_MS);

    // Draining at the real clock claims nothing — the row is not due yet.
    bookingSync.fetchImpl = recordingFetch([]);
    expect(await newWorker().drainOnce()).toBe(0);
    expect((await listOutbox(db, { kind: 'booking_sync' }))[0]!.status).toBe('pending');

    // Past the delay it is claimed exactly once.
    expect(await drainDue()).toBe(1);
  });
});

describe('booking_sync delivery', () => {
  it('Calendly happy path: fetches event + invitee, writes stage + UTC-midnight date + epoch-ms hours', async () => {
    await setHubspotDestination(BOOKING_SYNC_CONFIG);
    const bookedAt = Date.now();
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

    await drainDue();

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
      sales_date_booked: bookedDay(bookedAt), // the day of the BOOKING, not the meeting
    });
    // The regression this replaced: the meeting's day used to be written here.
    expect(input.properties).not.toHaveProperty(
      'sales_date_booked',
      String(Date.UTC(2026, 7, 2)),
    );
  });

  it('startTime provided directly (hubspot_meetings): no Calendly fetch, date/hours still written', async () => {
    await setHubspotDestination(BOOKING_SYNC_CONFIG);
    // The respondent email comes from the session's submission answers.
    await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-hs',
      data: { role: 'founder', team_size: 20, email: 'Booked@Acme.IO' },
    });
    const startIso = '2026-09-10T14:00:00-05:00'; // 19:00 UTC → UTC day Sep 10
    const bookedAt = Date.now();
    await svc.booking('acme', 'lead-qualifier', {
      sessionId: 'sess-hs',
      provider: 'hubspot_meetings',
      startTime: startIso,
    });

    const calls: RecordedCall[] = [];
    bookingSync.fetchImpl = recordingFetch(calls, {
      [HUBSPOT_UPSERT_URL]: () => jsonResponse({ results: [{ id: '9' }] }),
    });
    await drainDue();

    const rows = await listOutbox(db, { kind: 'booking_sync' });
    expect(rows[0]!.status).toBe('done');

    // No Calendly call was made — only the HubSpot upsert.
    expect(calls.map((c) => c.url)).toEqual([HUBSPOT_UPSERT_URL]);
    const input = (calls[0]!.body as { inputs: Array<Record<string, unknown>> }).inputs[0]!;
    expect(input.id).toBe('booked@acme.io'); // resolved from the submission answers
    expect(input.properties).toEqual({
      sales_stage: 'demo_booked',
      hours_booking: String(Date.parse(startIso)),
      sales_date_booked: bookedDay(bookedAt),
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
    await drainDue();

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
    await drainDue();

    const rows = await listOutbox(db, { kind: 'booking_sync' });
    expect(rows[0]!.status).toBe('pending'); // retryable — backoff, not terminal
    expect(rows[0]!.attempts).toBe(1);
    expect(rows[0]!.lastError).toContain('HTTP 500');
    expect(rows[0]!.nextAttemptAt).toBeGreaterThan(rows[0]!.createdAt);
  });

  it('no bookingSync config and nothing else to write → skipped (permanent config gap)', async () => {
    await setHubspotDestination(undefined);
    // The submission HAS an email, so the submit path already synced the
    // answers — at booking time there is genuinely nothing left to write.
    await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-nocfg',
      data: { role: 'founder', team_size: 20, email: 'lead@acme.io' },
    });
    await svc.booking('acme', 'lead-qualifier', {
      sessionId: 'sess-nocfg',
      provider: 'hubspot_meetings',
      startTime: '2026-08-01T15:00:00Z',
    });

    const calls: RecordedCall[] = [];
    bookingSync.fetchImpl = recordingFetch(calls);
    await drainDue();

    const rows = await listOutbox(db, { kind: 'booking_sync' });
    expect(rows[0]!.status).toBe('skipped');
    expect(rows[0]!.lastError).toContain('nothing to write');
    expect(calls).toHaveLength(0);
  });

  it('scheduler-collected email: the quiz answers sync at booking, keyed on the invitee', async () => {
    // The form asks for NO email — the scheduler collects it. The submit-time
    // destination was a no-op, so booking is where the answers reach the CRM.
    await setHubspotDestination(BOOKING_SYNC_CONFIG, {
      fieldMappings: { role: 'contact_role' },
      valueMaps: { role: { founder: 'Founder / CEO' } },
      staticProperties: { bz_optin: 'Form submitted Producto' },
      outcomeProperty: 'lead_tier',
      settings: { note: false },
    });
    await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-sched',
      data: { role: 'founder', team_size: 20 }, // no email anywhere
    });
    const bookedAt = Date.now();
    await svc.booking('acme', 'lead-qualifier', {
      sessionId: 'sess-sched',
      provider: 'calendly',
      eventUri: EVENT_URI,
      inviteeUri: INVITEE_URI,
    });

    const startIso = '2026-08-02T10:00:00Z';
    const calls: RecordedCall[] = [];
    bookingSync.fetchImpl = recordingFetch(calls, {
      [EVENT_URI]: () => jsonResponse({ resource: { start_time: startIso } }),
      [INVITEE_URI]: () => jsonResponse({ resource: { email: 'Invitee@Corp.IO' } }),
      [HUBSPOT_UPSERT_URL]: () => jsonResponse({ results: [{ id: '77' }] }),
    });
    await drainDue();

    const rows = await listOutbox(db, { kind: 'booking_sync' });
    expect(rows[0]!.status).toBe('done');

    // TWO upserts, both keyed on the invitee — BOOKING PROPERTIES FIRST. The
    // order is the retry-safety: the answers sync ends in a Note (no idempotent
    // create), so it must be the LAST write of the whole delivery.
    const hubspot = calls.filter((c) => c.url === HUBSPOT_UPSERT_URL);
    expect(hubspot).toHaveLength(2);
    const inputs = hubspot.map(
      (c) => (c.body as { inputs: Array<Record<string, unknown>> }).inputs[0]!,
    );
    for (const input of inputs) expect(input.id).toBe('invitee@corp.io');

    expect(inputs[0]!.properties).toEqual({
      sales_stage: 'demo_booked',
      hours_booking: String(Date.parse(startIso)),
      sales_date_booked: bookedDay(bookedAt),
    });
    const answerProps = inputs[1]!.properties as Record<string, string>;
    expect(answerProps.email).toBe('invitee@corp.io');
    expect(answerProps.contact_role).toBe('Founder / CEO'); // value map applied
    expect(answerProps.bz_optin).toBe('Form submitted Producto');
  });

  // The booking page collects a name (and sometimes a phone) that the form never
  // asks for. Only the address was ever used, so a form whose booking is its
  // only contact step produced contacts with an address and no name.
  it('maps what the booking page collected about the invitee', async () => {
    await setHubspotDestination(undefined, {
      fieldMappings: {
        '@invitee_first_name': 'firstname',
        '@invitee_last_name': 'lastname',
        '@invitee_phone': 'mobilephone',
        '@invitee_name': 'full_name',
      },
    });
    await svc.submit('acme', 'lead-qualifier', { sessionId: 'sess-inv', data: { role: 'founder' } });
    await svc.booking('acme', 'lead-qualifier', {
      sessionId: 'sess-inv',
      provider: 'calendly',
      eventUri: EVENT_URI,
      inviteeUri: INVITEE_URI,
    });

    const calls: RecordedCall[] = [];
    bookingSync.fetchImpl = recordingFetch(calls, {
      [EVENT_URI]: () => jsonResponse({ resource: { start_time: '2026-08-02T10:00:00Z' } }),
      [INVITEE_URI]: () =>
        jsonResponse({
          resource: {
            email: 'Invitee@Corp.IO',
            name: 'Ada Lovelace',
            first_name: 'Ada',
            last_name: 'Lovelace',
            text_reminder_number: '+57 300 111 2233',
          },
        }),
      [HUBSPOT_UPSERT_URL]: () => jsonResponse({ results: [{ id: '88' }] }),
    });
    await drainDue();

    const props = (
      calls.filter((c) => c.url === HUBSPOT_UPSERT_URL).at(-1)!.body as {
        inputs: Array<{ properties: Record<string, string> }>;
      }
    ).inputs[0]!.properties;
    expect(props.firstname).toBe('Ada');
    expect(props.lastname).toBe('Lovelace');
    expect(props.mobilephone).toBe('+57 300 111 2233');
    expect(props.full_name).toBe('Ada Lovelace');
  });

  // Calendly always returns `name` and only sometimes the split pair.
  it('derives first/last from the full name when the provider omits the split pair', async () => {
    await setHubspotDestination(undefined, {
      fieldMappings: { '@invitee_first_name': 'firstname', '@invitee_last_name': 'lastname' },
    });
    await svc.submit('acme', 'lead-qualifier', { sessionId: 'sess-split', data: { role: 'founder' } });
    await svc.booking('acme', 'lead-qualifier', {
      sessionId: 'sess-split',
      provider: 'calendly',
      eventUri: EVENT_URI,
      inviteeUri: INVITEE_URI,
    });

    const calls: RecordedCall[] = [];
    bookingSync.fetchImpl = recordingFetch(calls, {
      [EVENT_URI]: () => jsonResponse({ resource: { start_time: '2026-08-02T10:00:00Z' } }),
      [INVITEE_URI]: () =>
        jsonResponse({ resource: { email: 'g@corp.io', name: 'Grace Brewster Hopper' } }),
      [HUBSPOT_UPSERT_URL]: () => jsonResponse({ results: [{ id: '89' }] }),
    });
    await drainDue();

    const props = (
      calls.filter((c) => c.url === HUBSPOT_UPSERT_URL).at(-1)!.body as {
        inputs: Array<{ properties: Record<string, string> }>;
      }
    ).inputs[0]!.properties;
    expect(props.firstname).toBe('Grace');
    expect(props.lastname).toBe('Brewster Hopper');
  });

  // A question the form actually asks outranks whatever the booking page had.
  it('a real answer wins over the invitee field mapped to the same key', async () => {
    await setHubspotDestination(undefined, {
      fieldMappings: { full_name: 'full_name', '@invitee_name': 'booked_as' },
    });
    await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-win',
      data: { full_name: 'What they typed' },
    });
    await svc.booking('acme', 'lead-qualifier', {
      sessionId: 'sess-win',
      provider: 'calendly',
      eventUri: EVENT_URI,
      inviteeUri: INVITEE_URI,
    });

    const calls: RecordedCall[] = [];
    bookingSync.fetchImpl = recordingFetch(calls, {
      [EVENT_URI]: () => jsonResponse({ resource: { start_time: '2026-08-02T10:00:00Z' } }),
      [INVITEE_URI]: () => jsonResponse({ resource: { email: 'w@corp.io', name: 'Booked Name' } }),
      [HUBSPOT_UPSERT_URL]: () => jsonResponse({ results: [{ id: '90' }] }),
    });
    await drainDue();

    const props = (
      calls.filter((c) => c.url === HUBSPOT_UPSERT_URL).at(-1)!.body as {
        inputs: Array<{ properties: Record<string, string> }>;
      }
    ).inputs[0]!.properties;
    expect(props.full_name).toBe('What they typed');
    expect(props.booked_as).toBe('Booked Name');
  });

  it('a free-text answer that merely LOOKS like an email does not suppress the answers sync', async () => {
    // The gate follows the ADAPTER's email semantics (mapping to `email` /
    // an `email` answer) — not the loose booking-key heuristic. A company
    // field like "ceo@acme.io's startup" must not strand the answers.
    await setHubspotDestination(BOOKING_SYNC_CONFIG, {
      fieldMappings: { role: 'contact_role' },
      settings: { note: false },
    });
    await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-lookalike',
      data: { role: 'founder', team_size: 20, company: 'ceo@acme.io' },
    });
    await svc.booking('acme', 'lead-qualifier', {
      sessionId: 'sess-lookalike',
      provider: 'calendly',
      eventUri: EVENT_URI,
      inviteeUri: INVITEE_URI,
    });

    const calls: RecordedCall[] = [];
    bookingSync.fetchImpl = recordingFetch(calls, {
      [EVENT_URI]: () => jsonResponse({ resource: { start_time: '2026-08-02T10:00:00Z' } }),
      [INVITEE_URI]: () => jsonResponse({ resource: { email: 'real@corp.io' } }),
      [HUBSPOT_UPSERT_URL]: () => jsonResponse({ results: [{ id: '3' }] }),
    });
    await drainDue();

    const rows = await listOutbox(db, { kind: 'booking_sync' });
    expect(rows[0]!.status).toBe('done');
    const hubspot = calls.filter((c) => c.url === HUBSPOT_UPSERT_URL);
    expect(hubspot).toHaveLength(2); // booking props + the answers sync
    const answers = (hubspot[1]!.body as { inputs: Array<{ id: string; properties: Record<string, string> }> })
      .inputs[0]!;
    expect(answers.id).toBe('real@corp.io'); // keyed on the INVITEE, not the lookalike
    expect(answers.properties.contact_role).toBe('founder');
  });

  it('a submission that already carries an email never re-syncs the answers', async () => {
    await setHubspotDestination(BOOKING_SYNC_CONFIG, {
      fieldMappings: { role: 'contact_role' },
      settings: { note: false },
    });
    await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-hasmail',
      data: { role: 'founder', team_size: 20, email: 'own@corp.io' },
    });
    await svc.booking('acme', 'lead-qualifier', {
      sessionId: 'sess-hasmail',
      provider: 'calendly',
      eventUri: EVENT_URI,
      inviteeUri: INVITEE_URI,
    });

    const calls: RecordedCall[] = [];
    bookingSync.fetchImpl = recordingFetch(calls, {
      [EVENT_URI]: () => jsonResponse({ resource: { start_time: '2026-08-02T10:00:00Z' } }),
      [INVITEE_URI]: () => jsonResponse({ resource: { email: 'invitee@corp.io' } }),
      [HUBSPOT_UPSERT_URL]: () => jsonResponse({ results: [{ id: '5' }] }),
    });
    await drainDue();

    const rows = await listOutbox(db, { kind: 'booking_sync' });
    expect(rows[0]!.status).toBe('done');

    // ONE upsert only — the booking properties. The submit path owns the
    // answers for a form that asks its own email question.
    const hubspot = calls.filter((c) => c.url === HUBSPOT_UPSERT_URL);
    expect(hubspot).toHaveLength(1);
    const props = (hubspot[0]!.body as { inputs: Array<{ properties: Record<string, string> }> })
      .inputs[0]!.properties;
    expect(props.contact_role).toBeUndefined();
  });

  it('answers sync alone completes the row when no bookingSync properties exist', async () => {
    await setHubspotDestination(undefined, {
      fieldMappings: { role: 'contact_role' },
      settings: { note: false },
    });
    await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-onlyanswers',
      data: { role: 'founder', team_size: 20 },
    });
    await svc.booking('acme', 'lead-qualifier', {
      sessionId: 'sess-onlyanswers',
      provider: 'calendly',
      eventUri: EVENT_URI,
      inviteeUri: INVITEE_URI,
    });

    const calls: RecordedCall[] = [];
    bookingSync.fetchImpl = recordingFetch(calls, {
      [EVENT_URI]: () => jsonResponse({ resource: { start_time: '2026-08-02T10:00:00Z' } }),
      [INVITEE_URI]: () => jsonResponse({ resource: { email: 'solo@corp.io' } }),
      [HUBSPOT_UPSERT_URL]: () => jsonResponse({ results: [{ id: '8' }] }),
    });
    await drainDue();

    const rows = await listOutbox(db, { kind: 'booking_sync' });
    expect(rows[0]!.status).toBe('done'); // not skipped — the answers went out
    const hubspot = calls.filter((c) => c.url === HUBSPOT_UPSERT_URL);
    expect(hubspot).toHaveLength(1);
    const props = (hubspot[0]!.body as { inputs: Array<{ properties: Record<string, string> }> })
      .inputs[0]!.properties;
    expect(props.contact_role).toBe('founder'); // no value map on this destination
  });
});

/**
 * The booking DAY.
 *
 * `dateProperty` is what monthly "meetings booked" reporting counts by, so it
 * has to be the day the lead BOOKED. It used to be the day of the MEETING,
 * which moved every booking made near a month boundary into the wrong month —
 * a demo booked Aug 31 for Sep 3 was attributed to September.
 *
 * The day is floored in a per-form IANA zone (`dateTimezone`), because a portal
 * reporting in Bogota calls 20:00 local "today" while UTC already calls it
 * tomorrow. The zone MATH is unit-tested here against fixed instants; the
 * integration cases below prove the config reaches it and that the value is the
 * booking's day rather than the meeting's.
 */
describe('dayMidnightMs', () => {
  it('floors to the calendar day in the given zone, not the UTC day', () => {
    // 2026-08-11 00:30 UTC — still Aug 10, 19:30 in Bogota.
    const at = Date.parse('2026-08-11T00:30:00Z');
    expect(dayMidnightMs(at, 'America/Bogota')).toBe(Date.UTC(2026, 7, 10));
    expect(dayMidnightMs(at)).toBe(Date.UTC(2026, 7, 11)); // UTC disagrees, correctly
  });

  it('handles a zone AHEAD of UTC too (the day can be tomorrow)', () => {
    // 2026-08-10 23:00 UTC — already Aug 11, 08:00 in Tokyo.
    const at = Date.parse('2026-08-10T23:00:00Z');
    expect(dayMidnightMs(at, 'Asia/Tokyo')).toBe(Date.UTC(2026, 7, 11));
  });

  it('absent or blank zone = UTC (the platform default)', () => {
    const at = Date.parse('2026-08-11T00:30:00Z');
    expect(dayMidnightMs(at)).toBe(utcMidnightMs(at));
    expect(dayMidnightMs(at, '')).toBe(utcMidnightMs(at));
    expect(dayMidnightMs(at, '   ')).toBe(utcMidnightMs(at));
  });

  // A typo in a config field must never turn a delivery into a retry loop.
  it('an unusable zone falls back to UTC instead of throwing', () => {
    const at = Date.parse('2026-08-11T00:30:00Z');
    expect(() => dayMidnightMs(at, 'Bogota')).not.toThrow();
    expect(dayMidnightMs(at, 'Bogota')).toBe(utcMidnightMs(at));
    expect(dayMidnightMs(at, 'Not/AZone')).toBe(utcMidnightMs(at));
  });

  it('always lands on midnight UTC, which is what a HubSpot date property takes', () => {
    const at = Date.parse('2026-08-11T00:30:00Z');
    for (const zone of [undefined, 'America/Bogota', 'Asia/Tokyo', 'Australia/Eucla']) {
      expect(dayMidnightMs(at, zone) % 86_400_000).toBe(0);
    }
  });
});

describe('booking date semantics', () => {
  /** Overwrite the enqueued payload — the only way to forge a pre-fix row. */
  async function patchPayload(mutate: (p: Record<string, unknown>) => void) {
    const [row] = await listOutbox(db, { kind: 'booking_sync' });
    const payload = JSON.parse(row!.payload!) as Record<string, unknown>;
    mutate(payload);
    await db.run(
      sql`UPDATE outbox SET payload = ${JSON.stringify(payload)} WHERE id = ${row!.id}`,
    );
  }

  async function bookingProps(): Promise<Record<string, string>> {
    const calls: RecordedCall[] = [];
    bookingSync.fetchImpl = recordingFetch(calls, {
      [HUBSPOT_UPSERT_URL]: () => jsonResponse({ results: [{ id: '1' }] }),
    });
    await drainDue();
    expect((await listOutbox(db, { kind: 'booking_sync' }))[0]!.status).toBe('done');
    return (
      calls.find((c) => c.url === HUBSPOT_UPSERT_URL)!.body as {
        inputs: Array<{ properties: Record<string, string> }>;
      }
    ).inputs[0]!.properties;
  }

  it('the enqueue carries bookedAt, stamped from the persisted booking_event', async () => {
    await setHubspotDestination(BOOKING_SYNC_CONFIG);
    await svc.booking('acme', 'lead-qualifier', {
      sessionId: 'sess-bookedat',
      provider: 'hubspot_meetings',
      startTime: '2026-12-24T15:00:00Z',
    });

    const [row] = await listOutbox(db, { kind: 'booking_sync' });
    const payload = JSON.parse(row!.payload!) as { bookedAt?: number };
    const event = await db.get<{ created_at: number }>(
      sql`SELECT created_at FROM booking_event WHERE session_id = 'sess-bookedat' LIMIT 1`,
    );
    // The ROW's stamp, not a second clock read taken on the way to the queue.
    expect(payload.bookedAt).toBe(Number(event!.created_at));
  });

  // The bug, stated as a test: booking today for a meeting months out.
  it('records the day of the booking, never the day of the meeting', async () => {
    await setHubspotDestination(BOOKING_SYNC_CONFIG);
    await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-day',
      data: { role: 'founder', team_size: 20, email: 'lead@acme.io' },
    });
    const bookedAt = Date.now();
    const startIso = '2027-03-15T18:00:00Z'; // a meeting far in the future
    await svc.booking('acme', 'lead-qualifier', {
      sessionId: 'sess-day',
      provider: 'hubspot_meetings',
      startTime: startIso,
    });

    const props = await bookingProps();
    expect(props.sales_date_booked).toBe(bookedDay(bookedAt));
    // Derived from the meeting instant, not a literal: a hardcoded 2027-03-15
    // would start failing on 2027-03-15, when the booking day IS the meeting day.
    expect(props.sales_date_booked).not.toBe(bookedDay(Date.parse(startIso)));
    expect(props.hours_booking).toBe(String(Date.parse(startIso))); // meeting, unchanged
  });

  it('computes the day in the destination\'s dateTimezone', async () => {
    await setHubspotDestination({ ...BOOKING_SYNC_CONFIG, dateTimezone: 'Pacific/Kiritimati' });
    await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-tz',
      data: { role: 'founder', team_size: 20, email: 'lead@acme.io' },
    });
    const bookedAt = Date.now();
    await svc.booking('acme', 'lead-qualifier', {
      sessionId: 'sess-tz',
      provider: 'hubspot_meetings',
      startTime: '2026-08-11T17:30:00Z',
    });

    const props = await bookingProps();
    // UTC+14 — the configured zone is honoured, not the process default.
    expect(props.sales_date_booked).toBe(bookedDay(bookedAt, 'Pacific/Kiritimati'));
  });

  it('an unusable dateTimezone degrades to UTC rather than failing the row', async () => {
    await setHubspotDestination({ ...BOOKING_SYNC_CONFIG, dateTimezone: 'Bogota' });
    await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-badtz',
      data: { role: 'founder', team_size: 20, email: 'lead@acme.io' },
    });
    const bookedAt = Date.now();
    await svc.booking('acme', 'lead-qualifier', {
      sessionId: 'sess-badtz',
      provider: 'hubspot_meetings',
      startTime: '2026-08-11T17:30:00Z',
    });

    const props = await bookingProps(); // asserts the row reached `done`
    expect(props.sales_date_booked).toBe(String(utcMidnightMs(bookedAt)));
  });

  // Legacy parity: the pilot logged "startTime unavailable — hours_booking
  // skipped; sales___date_booked_demo still set". A provider that reports no
  // start time still tells us a booking happened.
  it('writes the date with no start time at all, and skips only the hours', async () => {
    await setHubspotDestination(BOOKING_SYNC_CONFIG);
    await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-nostart',
      data: { role: 'founder', team_size: 20, email: 'lead@acme.io' },
    });
    const bookedAt = Date.now();
    await svc.booking('acme', 'lead-qualifier', {
      sessionId: 'sess-nostart',
      provider: 'hubspot_meetings', // no startTime, no Calendly URIs to enrich from
    });

    const props = await bookingProps();
    expect(props.sales_date_booked).toBe(bookedDay(bookedAt));
    expect(props.sales_stage).toBe('demo_booked');
    expect(props).not.toHaveProperty('hours_booking');
  });

  // Rows enqueued before `bookedAt` existed are still in the queue at deploy.
  // The booking_event row this sync is anchored to carries the same moment, so
  // a pre-fix row is exact rather than approximated.
  it('a pre-fix row with no bookedAt reads the booking_event it is anchored to', async () => {
    await setHubspotDestination(BOOKING_SYNC_CONFIG);
    await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-legacy',
      data: { role: 'founder', team_size: 20, email: 'lead@acme.io' },
    });
    await svc.booking('acme', 'lead-qualifier', {
      sessionId: 'sess-legacy',
      provider: 'hubspot_meetings',
      startTime: '2026-08-11T17:30:00Z',
    });
    // Backdate the event, and the submission to a DIFFERENT day, so the two
    // candidate fallbacks are distinguishable from each other and from "now".
    const bookedAt = Date.parse('2026-06-05T09:00:00Z');
    await db.run(
      sql`UPDATE booking_event SET created_at = ${bookedAt} WHERE session_id = 'sess-legacy'`,
    );
    await db.run(
      sql`UPDATE submission SET completed_at = ${Date.parse('2026-04-01T09:00:00Z')}
          WHERE session_id = 'sess-legacy'`,
    );
    await patchPayload((p) => delete p.bookedAt);

    const props = await bookingProps();
    expect(props.sales_date_booked).toBe(String(Date.UTC(2026, 5, 5)));
  });

  // Both records gone: there is no honest answer, and the delivery clock is the
  // one answer that must never be given — it looks right and differs between
  // retries. The date is skipped; everything else still goes out.
  it('writes no date at all when neither the event nor a submission survives', async () => {
    await setHubspotDestination(BOOKING_SYNC_CONFIG);
    await svc.booking('acme', 'lead-qualifier', {
      sessionId: 'sess-orphan',
      provider: 'calendly',
      eventUri: EVENT_URI,
      inviteeUri: INVITEE_URI,
      startTime: '2026-08-11T17:30:00Z',
    });
    await patchPayload((p) => delete p.bookedAt);
    await db.run(sql`DELETE FROM booking_event WHERE session_id = 'sess-orphan'`);

    const calls: RecordedCall[] = [];
    bookingSync.fetchImpl = recordingFetch(calls, {
      [EVENT_URI]: () => jsonResponse({ resource: { start_time: '2026-08-11T17:30:00Z' } }),
      [INVITEE_URI]: () => jsonResponse({ resource: { email: 'orphan@corp.io' } }),
      [HUBSPOT_UPSERT_URL]: () => jsonResponse({ results: [{ id: '1' }] }),
    });
    await drainDue();

    const props = (
      calls.find((c) => c.url === HUBSPOT_UPSERT_URL)!.body as {
        inputs: Array<{ properties: Record<string, string> }>;
      }
    ).inputs[0]!.properties;
    expect(props).not.toHaveProperty('sales_date_booked'); // absent, not fabricated
    expect(props.sales_stage).toBe('demo_booked');
    expect(props.hours_booking).toBe(String(Date.parse('2026-08-11T17:30:00Z')));
  });

  // Belt and braces: if the event row is gone, the submission still dates it.
  it('falls back to the submission when even the booking_event is missing', async () => {
    await setHubspotDestination(BOOKING_SYNC_CONFIG);
    await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-noevent',
      data: { role: 'founder', team_size: 20, email: 'lead@acme.io' },
    });
    await svc.booking('acme', 'lead-qualifier', {
      sessionId: 'sess-noevent',
      provider: 'hubspot_meetings',
      startTime: '2026-08-11T17:30:00Z',
    });
    await db.run(
      sql`UPDATE submission SET completed_at = ${Date.parse('2026-04-01T09:00:00Z')}
          WHERE session_id = 'sess-noevent'`,
    );
    await patchPayload((p) => delete p.bookedAt);
    await db.run(sql`DELETE FROM booking_event WHERE session_id = 'sess-noevent'`);

    const props = await bookingProps();
    expect(props.sales_date_booked).toBe(String(Date.UTC(2026, 3, 1)));
  });

  // The fallback must not re-read the clock: two attempts of the SAME row have
  // to agree, or a retry straddling midnight rewrites the booking's day.
  it('is stable across retries — the same row delivers the same day twice', async () => {
    await setHubspotDestination(BOOKING_SYNC_CONFIG);
    await svc.booking('acme', 'lead-qualifier', {
      sessionId: 'sess-retry',
      provider: 'calendly',
      eventUri: EVENT_URI,
      inviteeUri: INVITEE_URI,
    });
    // No submission at all for this session, and no bookedAt — the case that
    // used to reach `Date.now()` on every single attempt.
    await patchPayload((p) => delete p.bookedAt);
    const bookedAt = Date.parse('2026-07-04T22:00:00Z');
    await db.run(
      sql`UPDATE booking_event SET created_at = ${bookedAt} WHERE session_id = 'sess-retry'`,
    );

    const days: string[] = [];
    // Each attempt is drained at a LATER clock: a failed attempt schedules its
    // retry off the clock the worker was GIVEN, so a fixed offset would never
    // find the row due a second time. The 60s stride is 60x `backoffMs(1)` (1s,
    // `packages/db/src/outbox.ts`) — if this ever fails with "expected 1,
    // received 0", the backoff base grew and the stride has to follow.
    for (const [i, status] of [500, 200].entries()) {
      const calls: RecordedCall[] = [];
      bookingSync.fetchImpl = recordingFetch(calls, {
        [EVENT_URI]: () => jsonResponse({ resource: { start_time: '2026-08-02T10:00:00Z' } }),
        [INVITEE_URI]: () => jsonResponse({ resource: { email: 'retry@corp.io' } }),
        // The first attempt fails AFTER the properties are built, so the row
        // retries and has to recompute the day from scratch.
        [HUBSPOT_UPSERT_URL]: () =>
          status === 500 ? jsonResponse({}, 500) : jsonResponse({ results: [{ id: '1' }] }),
      });
      const at = Date.now() + BOOKING_SYNC_DELAY_MS + (i + 1) * 60_000;
      expect(await newWorker().drainOnce(at)).toBe(1);
      const upsert = calls.find((c) => c.url === HUBSPOT_UPSERT_URL)!;
      days.push(
        (upsert.body as { inputs: Array<{ properties: Record<string, string> }> }).inputs[0]!
          .properties.sales_date_booked!,
      );
    }
    expect(days[0]).toBe(String(Date.UTC(2026, 6, 4)));
    expect(days[1]).toBe(days[0]);
  });
});
