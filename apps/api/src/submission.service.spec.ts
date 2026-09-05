/**
 * The core public loop, end to end on in-memory SQLite: fetch the seeded form,
 * submit answers (score recomputed server-side), verify the row + the enqueued
 * outbox email, and record a funnel event.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createDb,
  migrate,
  seed,
  listOutbox,
  listSubmissions,
  upsertNotificationSetting,
  getAccountByCode,
  createForm,
  sql,
  type Db,
} from '@quill/db';
import { SubmissionNotifier, LogOnlyEmailProvider } from '@quill/notifications';
import { SubmissionService } from './submission.service';
import { EmailEffects } from './email-effects';

let db: Db;
let svc: SubmissionService;

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db);
  const email = new EmailEffects(new SubmissionNotifier(new LogOnlyEmailProvider()), db);
  svc = new SubmissionService(db, email);
});

afterEach(async () => {
  await db.close();
});

/**
 * The submit path fire-and-forgets its email enqueues (`void this.email…`);
 * yield one macrotask so those promise chains settle before asserting outbox
 * contents (the SQLite driver is synchronous — one turn drains everything).
 */
const flushEffects = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('public form', () => {
  it('serves the seeded form config', async () => {
    const f = await svc.publicForm('acme', 'lead-qualifier');
    expect(f?.name).toBe('Lead Qualifier');
    expect(f?.config.version).toBe(1);
    expect(f?.config.steps.length).toBeGreaterThan(0);
  });

  it('404s an unknown slug', async () => {
    expect(await svc.publicForm('acme', 'nope')).toBeNull();
  });
});

describe('submit', () => {
  it('persists the submission with a SERVER-computed score and enqueues the email', async () => {
    const out = await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-1',
      // founder(10) + team 20→(8) = 18 ≥ 12 → qualified. Client-sent score is impossible by design.
      data: { role: 'founder', team_size: 20, company: 'Acme', email: 'lead@acme.io' },
    });
    expect('error' in out).toBe(false);
    if ('error' in out) return;
    expect(out.score).toBe(18);
    expect(out.outcome).toBe('qualified');
    await flushEffects();

    const form = await db.get<{ id: string }>(sql`SELECT id FROM form WHERE slug = 'lead-qualifier' LIMIT 1`);
    const rows = await listSubmissions(db, form!.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.score).toBe(18);
    expect(rows[0]!.completedAt).not.toBeNull();

    // Durable emails: the owner notice AND the respondent confirmation (the
    // answers carried an email) were both enqueued as outbox rows.
    const outbox = await listOutbox(db, { kind: 'email' });
    expect(outbox.map((r) => r.action).sort()).toEqual([
      'submission_confirmed',
      'submission_received',
    ]);
    const confirmed = outbox.find((r) => r.action === 'submission_confirmed')!;
    const payload = JSON.parse(confirmed.payload!) as { to: string[]; respondentEmail: string };
    expect(payload.to).toEqual(['lead@acme.io']); // addressed to the respondent
    expect(payload.respondentEmail).toBe('lead@acme.io');
  });

  it('both emails carry the answers as resolved {label, value} rows in step order', async () => {
    await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-answers',
      data: { role: 'founder', team_size: 20, company: 'Acme', email: 'lead@acme.io' },
    });
    await flushEffects();
    const outbox = await listOutbox(db, { kind: 'email' });
    expect(outbox).toHaveLength(2);
    for (const row of outbox) {
      const payload = JSON.parse(row.payload!) as { answers: Array<{ label: string; value: string }> };
      expect(payload.answers.map((a) => a.label)).toEqual([
        'What best describes you?',
        'How big is your team?',
        'What company do you work at?',
        'Where should we send the results?',
      ]);
      // Option VALUE → option LABEL, numbers stringified.
      expect(payload.answers[0]!.value).not.toBe('founder');
      expect(payload.answers[1]!.value).toBe('20');
      expect(payload.answers[2]!.value).toBe('Acme');
      expect(payload.answers[3]!.value).toBe('lead@acme.io');
    }
  });

  it('a re-landed complete enqueues NO second round of effects', async () => {
    // `callActionWithRetry` cannot abort an in-flight request, so a complete
    // that landed slowly IS retried and this method runs twice for one real
    // submission. The row dedupes itself; the effects must too — without the
    // gate, owner and respondent each got a duplicate email and a drained CRM
    // delivery duplicated its activity.
    const payload = {
      sessionId: 'sess-retry',
      data: { role: 'founder', team_size: 20, company: 'Acme', email: 'lead@acme.io' },
    };
    const first = await svc.submit('acme', 'lead-qualifier', payload);
    const retried = await svc.submit('acme', 'lead-qualifier', payload);
    await flushEffects();

    // Same verdict both times — the retry is invisible to the visitor.
    expect('error' in first || 'error' in retried).toBe(false);
    if ('error' in first || 'error' in retried) return;
    expect(retried.id).toBe(first.id);
    expect(retried.score).toBe(first.score);

    // Exactly ONE owner notice and ONE respondent receipt, not two of each.
    const outbox = await listOutbox(db, { kind: 'email' });
    expect(outbox.map((r) => r.action).sort()).toEqual(['submission_confirmed', 'submission_received']);
  });

  it('a partial→complete transition still fires the complete effects once', async () => {
    // The gate must key on "was ALREADY completed", not "row existed" — the
    // normal partial-then-final flow reuses the row and must still notify.
    await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-partial-then-final',
      partial: true,
      data: { role: 'founder' },
    });
    await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-partial-then-final',
      data: { role: 'founder', team_size: 20, email: 'lead@acme.io' },
    });
    await flushEffects();
    const outbox = await listOutbox(db, { kind: 'email' });
    expect(outbox.map((r) => r.action).sort()).toEqual(['submission_confirmed', 'submission_received']);
  });

  it('a completed submission WITHOUT an email enqueues only the owner notice', async () => {
    await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-noemail',
      data: { role: 'founder', team_size: 20, company: 'Acme' },
    });
    await flushEffects();
    const outbox = await listOutbox(db, { kind: 'email' });
    expect(outbox.map((r) => r.action)).toEqual(['submission_received']);
  });

  it('the submission_confirmed notification toggle suppresses the receipt (owner notice unaffected)', async () => {
    const account = await db.get<{ id: string }>(sql`SELECT id FROM account WHERE code = 'acme' LIMIT 1`);
    await upsertNotificationSetting(db, account!.id, 'submission_confirmed', { enabled: false });
    await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-muted',
      data: { role: 'founder', team_size: 20, email: 'lead@acme.io' },
    });
    await flushEffects();
    const outbox = await listOutbox(db, { kind: 'email' });
    expect(outbox.map((r) => r.action)).toEqual(['submission_received']);
  });

  it('threads the form id into the effects: a PER-FORM template override is snapshotted', async () => {
    const account = await db.get<{ id: string }>(sql`SELECT id FROM account WHERE code = 'acme' LIMIT 1`);
    const form = await db.get<{ id: string }>(sql`SELECT id FROM form WHERE slug = 'lead-qualifier' LIMIT 1`);
    // Account-level copy + a form-level pin — the form's copy must win.
    await upsertNotificationSetting(db, account!.id, 'submission_confirmed', { subject: 'ACCT {{formName}}' });
    await upsertNotificationSetting(
      db,
      account!.id,
      'submission_confirmed',
      { subject: 'FORM {{formName}}' },
      Date.now(),
      form!.id,
    );

    await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-form-override',
      data: { role: 'founder', team_size: 20, email: 'lead@acme.io' },
    });
    await flushEffects();

    const outbox = await listOutbox(db, { kind: 'email' });
    const confirmed = outbox.find((r) => r.action === 'submission_confirmed')!;
    const payload = JSON.parse(confirmed.payload!) as { subjectTemplate: string | null };
    expect(payload.subjectTemplate).toBe('FORM {{formName}}');
  });

  it('a partial save does not enqueue any email', async () => {
    await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-2',
      data: { role: 'individual', email: 'partial@acme.io' },
      partial: true,
    });
    await flushEffects();
    expect(await listOutbox(db, { kind: 'email' })).toHaveLength(0);
  });

  it('resolves the outcome WITH answers so answer-forced overrides match the client', async () => {
    const account = await getAccountByCode(db, 'acme');
    const created = await createForm(db, account!.id, {
      name: 'Override form',
      config: {
        version: 1,
        steps: [
          {
            key: 'leads',
            type: 'slider',
            question: 'Leads?',
            min: 0,
            max: 100,
            flowGroup: 'qualification',
            sliderScoring: [{ min: 0, max: 100, points: 10 }],
          },
        ],
        scoring: { enabled: true },
        outcomes: [
          { id: 'p1', label: 'P1', minScore: 5 },
          { id: 'p0', label: 'P0', minScore: -100, overrides: [{ field: 'leads', maxValue: 0 }] },
        ],
      },
    });
    if (!created.ok) throw new Error('createForm failed');

    // leads=0 scores +10 (≥ p1's minScore) — only the override can pick p0.
    const out = await svc.submit('acme', created.value.slug, {
      sessionId: 'sess-override',
      data: { leads: 0 },
    });
    expect('error' in out).toBe(false);
    if ('error' in out) return;
    expect(out.score).toBe(10);
    expect(out.outcome).toBe('p0');
  });
});

describe('events', () => {
  it('records a funnel event for a valid form', async () => {
    const out = await svc.event('acme', 'lead-qualifier', { sessionId: 'sess-3', type: 'view' });
    expect('error' in out).toBe(false);
    const row = await db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM form_event`);
    expect(Number(row?.n)).toBe(1);
  });
});

describe('booking callbacks', () => {
  it('persists a booking_event tied to the session (no enqueue without BookingEffects wired)', async () => {
    const out = await svc.booking('acme', 'lead-qualifier', {
      sessionId: 'sess-4',
      provider: 'calendly',
      eventUri: 'https://api.calendly.com/scheduled_events/abc',
      startTime: '2026-08-01T15:00:00Z',
    });
    expect('error' in out).toBe(false);

    const row = await db.get<Record<string, unknown>>(
      sql`SELECT * FROM booking_event WHERE session_id = 'sess-4' LIMIT 1`,
    );
    expect(row).toBeTruthy();
    expect(row!.provider).toBe('calendly');
    expect(Number(row!.start_time)).toBe(Date.parse('2026-08-01T15:00:00Z'));
    // BookingEffects is optional and not wired here, so nothing is enqueued —
    // the persisted booking_event stays the durable fact regardless. The
    // enqueue + booking_sync delivery path is covered in booking-sync.spec.ts.
    expect(await listOutbox(db, {})).toHaveLength(0);
  });

  it('404s an unknown form', async () => {
    const out = await svc.booking('acme', 'nope', { sessionId: 's', provider: 'calendly' });
    expect('error' in out && out.error === 'NOT_FOUND').toBe(true);
  });

  it('rejects an invalid payload (zod)', async () => {
    await expect(
      svc.booking('acme', 'lead-qualifier', { sessionId: '', provider: 'zoom' }),
    ).rejects.toThrow();
  });
});
