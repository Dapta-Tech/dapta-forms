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
import { AnalyticsController } from './analytics.controller';
import type { AuthService } from './auth.service';
import { csvField } from './csv';
import { parseIntParam } from './query-params';

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
    expect(a.timeToComplete).toBe(60); // median(30,60,90) s
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

describe('P0 metric-definition fixes', () => {
  /** Emit a single form_event for a specific session. */
  const ev = (sessionId: string, type: string, stepIndex: number | null, at: number) =>
    recordFormEvent(db, { formId, sessionId, type, stepIndex, now: at });

  it('Starts come from step_view idx 0, so a cover-less session (no `start` event) counts', async () => {
    // A cover-less form never emits the cover-CTA `start` event; the old code
    // counted `start` and reported 0 starts. These 3 sessions reach Q1 with NO
    // `start` event and MUST count.
    for (const s of ['nocover-1', 'nocover-2', 'nocover-3']) await ev(s, 'step_view', 0, NOW);

    const a = (await svc.funnel(accountId, formId, {}))!;
    expect(a.starts).toBe(11); // 8 baseline + 3 cover-less (would stay 8 under old `start`-event count)
    expect(a.completionRate).toBe(27.3); // 3 completed / 11 starts — non-zero, the P0 fix
    // Prove the added sessions truly have no `start` event backing them.
    const startEvents = await db.get<{ n: number | string }>(
      sql`SELECT COUNT(*) AS n FROM form_event WHERE type = 'start' AND session_id = 'nocover-1'`,
    );
    expect(Number(startEvents!.n)).toBe(0);
  });

  it('Views are unique per session — a refresh in the same tab does not inflate', async () => {
    // Same session mounts 3× (refresh): 3 `view` rows, 1 unique session.
    for (let i = 0; i < 3; i++) await ev('refresher', 'view', null, NOW);
    const a = (await svc.funnel(accountId, formId, {}))!;
    expect(a.views).toBe(11); // 10 baseline uniques + 1 (NOT +3)
  });

  it('Time to complete is measured from form OPEN (first view), not the first persisted write', async () => {
    // The "0s" bug shape: the only persisted write is the complete submit, so
    // started_at == completed_at. But the session opened the form 40s earlier.
    const T = NOW + 500_000;
    await ev('tc1', 'view', null, T - 40_000);
    await insertSubmission({ session: 'tc1', data: {}, score: 0, startedAt: T, completedAt: T });

    const a = (await svc.funnel(accountId, formId, { from: T - 1, to: T + 1 }))!; // isolate tc1
    expect(a.submissions).toBe(1);
    expect(a.timeToComplete).toBe(40); // 40s from the view — NOT 0
  });

  it('Time to complete falls back to started_at when the open `view` event was lost', async () => {
    const T = NOW + 700_000;
    // No `view` event for this session → open falls back to started_at.
    await insertSubmission({ session: 'tc2', data: {}, score: 0, startedAt: T - 25_000, completedAt: T });
    const a = (await svc.funnel(accountId, formId, { from: T - 1, to: T + 1 }))!;
    expect(a.timeToComplete).toBe(25);
  });

  it('Time to complete is the MEDIAN, not the mean (outlier-robust)', async () => {
    // Durations 10s / 20s / 300s → median 20s, mean 110s. No view → open=started_at.
    const U = NOW + 1_000_000;
    await insertSubmission({ session: 'md-1', data: {}, score: 0, startedAt: U, completedAt: U + 10_000 });
    await insertSubmission({ session: 'md-2', data: {}, score: 0, startedAt: U, completedAt: U + 20_000 });
    await insertSubmission({ session: 'md-3', data: {}, score: 0, startedAt: U, completedAt: U + 300_000 });
    const a = (await svc.funnel(accountId, formId, { from: U - 1, to: U + 400_000 }))!;
    expect(a.submissions).toBe(3);
    expect(a.timeToComplete).toBe(20); // median — NOT 110 (mean)
  });

  it('builds a per-day Trends series carrying every metric for the bucket', async () => {
    const DAY = 86_400_000;
    const seedDay = Math.floor(NOW / DAY); // everything in beforeEach lands here
    const a = (await svc.funnel(accountId, formId, {}))!;

    expect(a.trends).toHaveLength(1); // no range → bounded by observed activity
    expect(a.trends[0]).toEqual({
      t: seedDay * DAY, // start of the UTC day bucket
      views: 10,
      starts: 8,
      submissions: 3,
      completionRate: 37.5,
      timeToComplete: 60, // median(30,60,90)
    });
  });

  it('gap-fills the Trends window so a dead day is a real zero, not a missing point', async () => {
    const DAY = 86_400_000;
    const seedDay = Math.floor(NOW / DAY);
    // A 3-day window ending on the seeded day: the two earlier days had no
    // activity at all and must still appear, zeroed.
    const a = (await svc.funnel(accountId, formId, {
      from: (seedDay - 2) * DAY,
      to: NOW + 90_000,
    }))!;

    expect(a.trends).toHaveLength(3);
    expect(a.trends.map((p) => p.t)).toEqual([
      (seedDay - 2) * DAY,
      (seedDay - 1) * DAY,
      seedDay * DAY,
    ]);
    expect(a.trends[0]).toMatchObject({ views: 0, starts: 0, submissions: 0, completionRate: 0 });
    expect(a.trends[1]).toMatchObject({ views: 0, starts: 0, submissions: 0 });
    expect(a.trends[2]).toMatchObject({ views: 10, starts: 8, submissions: 3 });
  });

  it('splits Trends across day boundaries by completion day', async () => {
    const DAY = 86_400_000;
    const seedDay = Math.floor(NOW / DAY);
    // A completion two days after the seeded activity → its own bucket.
    const later = (seedDay + 2) * DAY + 3_600_000; // mid-day, 2 days on
    await ev('nextday', 'view', null, later - 20_000);
    await insertSubmission({ session: 'nextday', data: {}, score: 0, startedAt: later, completedAt: later });

    const a = (await svc.funnel(accountId, formId, {}))!;
    expect(a.trends).toHaveLength(3); // seedDay, +1 (gap-filled), +2
    const last = a.trends[2]!;
    expect(last.t).toBe((seedDay + 2) * DAY);
    expect(last.submissions).toBe(1);
    expect(last.timeToComplete).toBe(20); // 20s from its own view event
    expect(a.trends[1]).toMatchObject({ submissions: 0, views: 0 }); // the dead middle day
  });

  it('windows each metric by its OWN timestamp (submissions by completed_at)', async () => {
    // A session that STARTED before the window but COMPLETED inside it must count
    // as a submission (windowed by completed_at, not started_at).
    const W = NOW + 2_000_000;
    await insertSubmission({ session: 'w1', data: {}, score: 0, startedAt: W - 100_000, completedAt: W });
    const inWindow = (await svc.funnel(accountId, formId, { from: W - 1, to: W + 1 }))!;
    expect(inWindow.submissions).toBe(1); // counted by completed_at, though it started earlier
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
  it('classifies deleted / absent / forbidden and never touches a cross-account row', async () => {
    const one = (await querySubmissions(db, formId, { status: 'completed', limit: 1 })).items[0]!;
    // Owned → deleted.
    expect(await deleteSubmissionForAccount(db, accountId, one.id)).toBe('deleted');
    // Same-account repeat on an already-gone row → absent (idempotent 204).
    expect(await deleteSubmissionForAccount(db, accountId, one.id)).toBe('absent');
    // A cross-account id → forbidden (HTTP 404), and the row is left intact.
    const other = (await querySubmissions(db, formId, { status: 'completed', limit: 1 })).items[0]!;
    expect(await deleteSubmissionForAccount(db, 'wrong-account', other.id)).toBe('forbidden');
    expect((await querySubmissions(db, formId, { status: 'completed' })).total).toBe(2);
    // A never-existed id → absent (not a leak-y 404).
    expect(await deleteSubmissionForAccount(db, accountId, 'no-such-id')).toBe('absent');
  });
});

describe('delete submission (controller HTTP semantics)', () => {
  function ctrlFor(actAccount: string) {
    const auth = {
      resolveHost: async () => ({ accountId: actAccount, memberId: 'm', role: 'owner' as const }),
    } as unknown as AuthService;
    return new AnalyticsController(db, auth, svc);
  }

  it('204s an owned delete + idempotent repeat, but 404s a cross-account id', async () => {
    const one = (await querySubmissions(db, formId, { status: 'completed', limit: 1 })).items[0]!;
    // Owner: deletes (no throw) and repeat is a no-op (no throw).
    await expect(ctrlFor(accountId).deleteSubmission({} as never, one.id)).resolves.toBeUndefined();
    await expect(ctrlFor(accountId).deleteSubmission({} as never, one.id)).resolves.toBeUndefined();
    // Attacker: a real (other-account) submission → 404, row untouched.
    const other = (await querySubmissions(db, formId, { status: 'completed', limit: 1 })).items[0]!;
    await expect(ctrlFor('attacker-account').deleteSubmission({} as never, other.id)).rejects.toMatchObject({
      status: 404,
    });
    expect((await querySubmissions(db, formId, { status: 'completed' })).total).toBe(2);
  });
});

describe('CSV export (large sets, un-paginated)', () => {
  /** Drive the real controller with a stub auth + capture-only response. */
  async function runExport(): Promise<string[]> {
    const auth = {
      resolveHost: async () => ({ accountId, memberId: 'test-member', role: 'owner' as const }),
    } as unknown as AuthService;
    const ctrl = new AnalyticsController(db, auth, svc);
    const chunks: string[] = [];
    const res = {
      setHeader: () => {},
      write: (c: string) => {
        chunks.push(c);
      },
      end: () => {},
    };
    await ctrl.exportCsv({ headers: {} }, res, formId, undefined, undefined, undefined);
    return chunks.join('').trimEnd().split('\r\n');
  }

  it('exports EVERY row past the 200-row table cap (250 seeded → 250 CSV rows)', async () => {
    // beforeEach seeded 5 submissions; add 245 more → exactly 250 total. The
    // paginated table query caps limit at 200, so this proves the export path
    // does NOT truncate or skip rows (OptiBot blocker).
    for (let i = 0; i < 245; i++) {
      await insertSubmission({
        session: `bulk-${i}`,
        data: { role: 'individual', email: `bulk${i}@x.io` },
        score: 2,
        startedAt: NOW + i,
        completedAt: NOW + i + 1000,
      });
    }
    expect((await querySubmissions(db, formId, {})).total).toBe(250);

    const lines = await runExport();
    expect(lines[0]).toMatch(/^id,session_id,status,score,started_at,completed_at/);
    expect(lines.length - 1).toBe(250); // header + one row per submission
  });

  it('neutralizes a formula payload end-to-end in the exported CSV', async () => {
    await insertSubmission({
      session: 'inject-1',
      data: { role: '=HYPERLINK("http://evil.example","click")', email: '@import' },
      score: 0,
      startedAt: NOW,
      completedAt: NOW + 1,
    });
    const csv = (await runExport()).join('\n');
    expect(csv).toContain(`'=HYPERLINK`);
    expect(csv).toContain(`'@import`);
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m); // no bare leading formula
  });
});

describe('csvField formula-injection neutralization', () => {
  it('prefixes a quote on formula-trigger strings', () => {
    expect(csvField('=1+2')).toBe("'=1+2");
    expect(csvField('+SUM(A1)')).toBe("'+SUM(A1)");
    expect(csvField('-cmd')).toBe("'-cmd");
    expect(csvField('@import')).toBe("'@import");
    expect(csvField('\tpayload')).toBe("'\tpayload");
  });

  it('still RFC-4180-quotes when the neutralized value needs it', () => {
    // Leading `=` AND a comma: neutralize first, then quote.
    expect(csvField('=HYPERLINK("http://e.x","y")')).toBe('"\'=HYPERLINK(""http://e.x"",""y"")"');
  });

  it('leaves genuine numbers/booleans and plain strings untouched', () => {
    expect(csvField(-5)).toBe('-5'); // negative score stays numeric
    expect(csvField(true)).toBe('true');
    expect(csvField('hello')).toBe('hello');
    expect(csvField(null)).toBe('');
  });

  it('neutralizes an array whose flattened head is a trigger', () => {
    expect(csvField(['=evil', 'b'])).toBe("'=evil; b");
  });
});

describe('parseIntParam (NaN guard for limit/offset)', () => {
  it('parses numeric strings and rejects everything else', () => {
    expect(parseIntParam('50')).toBe(50);
    expect(parseIntParam('0')).toBe(0);
    expect(parseIntParam('12.9')).toBe(12); // truncated to an int
    expect(parseIntParam('abc')).toBeUndefined(); // NaN must never reach SQL
    expect(parseIntParam('1e309')).toBeUndefined(); // Infinity guarded too
    expect(parseIntParam('')).toBeUndefined();
    expect(parseIntParam(undefined)).toBeUndefined();
  });

  it('undefined falls back to the query default (no LIMIT NaN)', async () => {
    const page = await querySubmissions(db, formId, { limit: parseIntParam('abc') });
    expect(page.limit).toBe(25); // default, not NaN
    expect(page.items.length).toBeGreaterThan(0);
  });
});
