/**
 * Analytics aggregation math, end to end on in-memory SQLite. Seeds a known set
 * of funnel events + submissions and asserts the funnel summary + per-step
 * drop-off table exactly (ground truth computed by hand in the comments). Also
 * covers the date-range filter, submissions pagination/filter, and the
 * account-scoped idempotent delete — the whole read surface's math.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createDb,
  migrate,
  seed,
  recordFormEvent,
  jsonParam,
  querySubmissions,
  deleteSubmissionForAccount,
  sql,
  type Db,
} from '@quill/db';
import { AnalyticsService } from './analytics.service';

let db: Db;
let svc: AnalyticsService;
let accountId: string;
let formId: string;

/** Insert a submission row with explicit timestamps (bypasses upsert semantics). */
async function insertSubmission(input: {
  session: string;
  data: Record<string, unknown>;
  score: number;
  startedAt: number;
  completedAt?: number | null;
  partialAt?: number | null;
}) {
  await db.run(
    sql`INSERT INTO submission (id, form_id, session_id, data, score, started_at, completed_at, partial_at)
        VALUES (${crypto.randomUUID()}, ${formId}, ${input.session}, ${jsonParam(input.data)},
          ${input.score}, ${input.startedAt}, ${input.completedAt ?? null}, ${input.partialAt ?? null})`,
  );
}

async function emit(type: string, count: number, stepIndex?: number, at?: number) {
  for (let i = 0; i < count; i++) {
    await recordFormEvent(db, {
      formId,
      sessionId: `${type}-${stepIndex ?? 'x'}-${i}`,
      type,
      stepIndex: stepIndex ?? null,
      now: at,
    });
  }
}

const NOW = 1_800_000_000_000; // fixed instant so range math is deterministic

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db);
  svc = new AnalyticsService(db);
  const acc = await db.get<{ id: string }>(sql`SELECT id FROM account WHERE code = 'acme' LIMIT 1`);
  accountId = acc!.id;
  const form = await db.get<{ id: string }>(sql`SELECT id FROM form WHERE slug = 'lead-qualifier' LIMIT 1`);
  formId = form!.id;

  // Funnel events (all at NOW): 10 views, 8 starts, step_views 8/6/4/3.
  await emit('view', 10, undefined, NOW);
  await emit('start', 8, undefined, NOW);
  await emit('step_view', 8, 0, NOW);
  await emit('step_view', 6, 1, NOW);
  await emit('step_view', 4, 2, NOW);
  await emit('step_view', 3, 3, NOW);

  // 3 completed submissions with durations 30s / 60s / 90s → avg 60s.
  await insertSubmission({ session: 'c1', data: { role: 'founder', email: 'a@x.io' }, score: 10, startedAt: NOW, completedAt: NOW + 30_000 });
  await insertSubmission({ session: 'c2', data: { role: 'lead', email: 'b@x.io' }, score: 6, startedAt: NOW, completedAt: NOW + 60_000 });
  await insertSubmission({ session: 'c3', data: { role: 'founder', email: 'c@x.io' }, score: 10, startedAt: NOW, completedAt: NOW + 90_000 });
  // 2 partial-only submissions.
  await insertSubmission({ session: 'p1', data: { role: 'individual' }, score: 2, startedAt: NOW, partialAt: NOW + 5_000 });
  await insertSubmission({ session: 'p2', data: { role: 'lead' }, score: 6, startedAt: NOW, partialAt: NOW + 5_000 });
});

afterEach(async () => {
  await db.close();
});

describe('funnel aggregation', () => {
  it('computes the funnel summary exactly', async () => {
    const a = (await svc.funnel(accountId, formId, {}))!;
    expect(a.views).toBe(10);
    expect(a.starts).toBe(8);
    expect(a.submissions).toBe(3); // completed
    expect(a.partialSubmits).toBe(2);
    expect(a.completionRate).toBe(37.5); // 3/8 = 37.5%
    expect(a.avgTimeToComplete).toBe(60); // (30+60+90)/3 s
  });

  it('computes the per-step drop-off table (cover + one row per step)', async () => {
    const a = (await svc.funnel(accountId, formId, {}))!;
    // 4 configured steps + 1 cover row.
    expect(a.dropoff).toHaveLength(5);

    const [cover, s0, s1, s2, s3] = a.dropoff;
    // Cover: views 10 → step0 8 ⇒ drop 2 (20%).
    expect(cover).toMatchObject({ isCover: true, views: 10, dropoff: 2, dropoffPercent: 20 });
    // role: 8 → 6 ⇒ drop 2 (25%).
    expect(s0).toMatchObject({ key: 'role', views: 8, dropoff: 2, dropoffPercent: 25 });
    // team_size: 6 → 4 ⇒ drop 2 (33.3%).
    expect(s1).toMatchObject({ key: 'team_size', views: 6, dropoff: 2, dropoffPercent: 33.3 });
    // company: 4 → 3 ⇒ drop 1 (25%).
    expect(s2).toMatchObject({ key: 'company', views: 4, dropoff: 1, dropoffPercent: 25 });
    // email: 3 → submissions 3 ⇒ drop 0 (0%).
    expect(s3).toMatchObject({ key: 'email', views: 3, dropoff: 0, dropoffPercent: 0 });
  });

  it('applies the date-range filter (out-of-range rows excluded)', async () => {
    // Everything was seeded at NOW; a window strictly before NOW sees nothing.
    const empty = (await svc.funnel(accountId, formId, { from: NOW - 100_000, to: NOW - 1 }))!;
    expect(empty.views).toBe(0);
    expect(empty.starts).toBe(0);
    expect(empty.submissions).toBe(0);
    expect(empty.partialSubmits).toBe(0);

    // A window covering NOW sees the full set again.
    const full = (await svc.funnel(accountId, formId, { from: NOW - 1, to: NOW + 200_000 }))!;
    expect(full.views).toBe(10);
    expect(full.submissions).toBe(3);
  });

  it('returns null for a form the account does not own', async () => {
    expect(await svc.funnel('someone-else', formId, {})).toBeNull();
  });
});

describe('submissions query', () => {
  it('paginates newest-first with a total', async () => {
    const page = await querySubmissions(db, formId, { limit: 2, offset: 0 });
    expect(page.total).toBe(5); // 3 completed + 2 partial
    expect(page.items).toHaveLength(2);
    expect(page.limit).toBe(2);
  });

  it('filters by status', async () => {
    const completed = await querySubmissions(db, formId, { status: 'completed' });
    expect(completed.total).toBe(3);
    expect(completed.items.every((s) => s.completedAt != null)).toBe(true);

    const partial = await querySubmissions(db, formId, { status: 'partial' });
    expect(partial.total).toBe(2);
    expect(partial.items.every((s) => s.completedAt == null && s.partialAt != null)).toBe(true);
  });
});

describe('delete submission (account-scoped, idempotent)', () => {
  it('deletes an owned submission and is a no-op on repeat / wrong account', async () => {
    const one = (await querySubmissions(db, formId, { status: 'completed', limit: 1 })).items[0]!;
    expect(await deleteSubmissionForAccount(db, accountId, one.id)).toBe(true);
    // Idempotent second call.
    expect(await deleteSubmissionForAccount(db, accountId, one.id)).toBe(false);
    // Wrong account never touches the row.
    const other = (await querySubmissions(db, formId, { status: 'completed', limit: 1 })).items[0]!;
    expect(await deleteSubmissionForAccount(db, 'wrong-account', other.id)).toBe(false);
    expect((await querySubmissions(db, formId, { status: 'completed' })).total).toBe(2);
  });
});
