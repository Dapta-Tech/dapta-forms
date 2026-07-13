/**
 * The core public loop, end to end on in-memory SQLite: fetch the seeded form,
 * submit answers (score recomputed server-side), verify the row + the enqueued
 * outbox email, and record a funnel event.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDb, migrate, seed, listOutbox, listSubmissions, sql, type Db } from '@quill/db';
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

    const form = await db.get<{ id: string }>(sql`SELECT id FROM form WHERE slug = 'lead-qualifier' LIMIT 1`);
    const rows = await listSubmissions(db, form!.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.score).toBe(18);
    expect(rows[0]!.completedAt).not.toBeNull();

    // Durable email: one submission_received outbox row was enqueued.
    const outbox = await listOutbox(db, { kind: 'email' });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.action).toBe('submission_received');
  });

  it('a partial save does not enqueue the received email', async () => {
    await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-2',
      data: { role: 'individual' },
      partial: true,
    });
    expect(await listOutbox(db, { kind: 'email' })).toHaveLength(0);
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
