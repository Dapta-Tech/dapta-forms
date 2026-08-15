/**
 * Analytics read-path parity — the metrics SQL runs on BOTH dialects.
 *
 * The funnel aggregates in analytics.ts are written in a portable subset (COUNT
 * DISTINCT, correlated subqueries, HAVING MIN, integer division on a literal day
 * width) precisely so the identical code runs on clone-and-run SQLite and on
 * production Postgres. This suite exercises the constructs that actually differ
 * in behaviour between engines — cohort-anchor windowing (HAVING MIN), unique
 * counting (COUNT DISTINCT), the open-time correlated subquery, and integer day
 * bucketing (`anchor / 86400000`) — so the Postgres parity job (which re-runs
 * every `@quill/db` spec against a real Postgres via DATABASE_URL) proves the
 * metrics on the source of truth, not only on SQLite.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from './client';
import { migrate } from './migrate';
import {
  uniqueViewCount,
  startCount,
  stepViewCounts,
  stepCompleteCounts,
  partialCount,
  bookingCount,
  completedSubmissions,
  dailyViewSessions,
  dailyStartSessions,
  DAY_MS,
  querySubmissions,
  allSubmissionsForExport,
} from './analytics';

let db: Db;
let accountId: string;
let formId: string;

// Whole-day epoch anchors, so `ts / DAY_MS` lands on a clean integer day number
// and any intra-day offset (+100ms, +1s…) stays in the same bucket. DAY 20000 is
// the primary window; DAY 19999 is the day before, used for the out-of-window and
// straddle cases.
const DAY = DAY_MS;
const D0 = 19_999 * DAY; // start of the day BEFORE the window
const D1 = 20_000 * DAY; // start of the window day
const D2 = 20_001 * DAY; // start of the day AFTER the window
/** A range covering exactly the window day (D1). */
const WINDOW = { from: D1, to: D2 - 1 };

/** Insert one funnel event. `stepIndex`/`stepKey` default to NULL. */
async function ev(
  sessionId: string,
  type: string,
  createdAt: number,
  opts: { stepIndex?: number | null; stepKey?: string | null } = {},
): Promise<void> {
  await db.run(
    sql`INSERT INTO form_event (id, form_id, session_id, type, step_index, step_key, created_at)
        VALUES (${randomUUID()}, ${formId}, ${sessionId}, ${type},
                ${opts.stepIndex ?? null}, ${opts.stepKey ?? null}, ${createdAt})`,
  );
}

/** Insert one booking-event row (provider callback) for a session. */
async function booking(sessionId: string, createdAt: number): Promise<void> {
  await db.run(
    sql`INSERT INTO booking_event (id, form_id, session_id, provider, created_at)
        VALUES (${randomUUID()}, ${formId}, ${sessionId}, ${'calendly'}, ${createdAt})`,
  );
}

/** Insert one submission (partial or complete) for a session. */
async function sub(
  sessionId: string,
  opts: { id?: string; startedAt: number; completedAt?: number | null; partialAt?: number | null },
): Promise<void> {
  await db.run(
    sql`INSERT INTO submission (id, form_id, session_id, data, score, started_at, completed_at, partial_at)
        VALUES (${opts.id ?? randomUUID()}, ${formId}, ${sessionId}, ${'{}'}, ${0},
                ${opts.startedAt}, ${opts.completedAt ?? null}, ${opts.partialAt ?? null})`,
  );
}

beforeEach(async () => {
  // Honors DATABASE_URL so CI re-runs this suite against real Postgres (the
  // parity job); locally it defaults to in-memory SQLite.
  db = await createDb(process.env.DATABASE_URL ?? 'file::memory:');
  await migrate(db);
  accountId = randomUUID();
  formId = randomUUID();
  const now = Date.now();
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at)
        VALUES (${accountId}, ${'t' + accountId.slice(0, 5)}, ${'Test'}, ${now})`,
  );
  await db.run(
    sql`INSERT INTO form (id, account_id, name, slug, config, created_at, updated_at)
        VALUES (${formId}, ${accountId}, ${'F'}, ${'f'}, ${'{"version":1,"steps":[]}'}, ${now}, ${now})`,
  );
});

afterEach(async () => {
  // Leave a shared Postgres database clean (memory SQLite just evaporates).
  await db.run(sql`DELETE FROM form_event WHERE form_id = ${formId}`);
  await db.run(sql`DELETE FROM booking_event WHERE form_id = ${formId}`);
  await db.run(sql`DELETE FROM submission WHERE form_id = ${formId}`);
  await db.run(sql`DELETE FROM form WHERE id = ${formId}`);
  await db.run(sql`DELETE FROM account WHERE id = ${accountId}`);
});

describe('unique counting (COUNT DISTINCT session_id)', () => {
  it('collapses same-session reloads to one view, and counts distinct sessions', async () => {
    // s1 mounts three times (each mount fires a fresh `view`) — one unique view.
    await ev('s1', 'view', D1 + 100);
    await ev('s1', 'view', D1 + 200);
    await ev('s1', 'view', D1 + 300);
    // s2 is a second distinct session.
    await ev('s2', 'view', D1 + 400);
    expect(await uniqueViewCount(db, formId)).toBe(2);
  });

  it('counts a Start only for sessions that started answering (start OR step_complete)', async () => {
    // s1: cover form — clicked the Start CTA (start event), no answer yet.
    await ev('s1', 'view', D1 + 10);
    await ev('s1', 'start', D1 + 20);
    await ev('s1', 'start', D1 + 30); // double-fire → still one session
    // s2: cover-less form — answered the first question (no start event).
    await ev('s2', 'view', D1 + 40);
    await ev('s2', 'step_view', D1 + 50, { stepIndex: 0 });
    await ev('s2', 'step_complete', D1 + 60, { stepIndex: 0, stepKey: 'q1' });
    // s3: only SAW the first question (cover-less mount) and left. Under the
    // old step_view-idx-0 definition this counted as a Start, making
    // Starts ≈ Views on cover-less forms. It must NOT count.
    await ev('s3', 'view', D1 + 70);
    await ev('s3', 'step_view', D1 + 80, { stepIndex: 0 });
    expect(await startCount(db, formId)).toBe(2);
  });
});

describe('booking count (distinct sessions, cohort-anchor windowed)', () => {
  it('de-dupes provider double-callbacks and windows by the session anchor', async () => {
    // s1: full funnel inside the window; Calendly fires the callback twice.
    await ev('s1', 'view', D1 + 100);
    await booking('s1', D1 + 500);
    await booking('s1', D1 + 501); // duplicate callback → still one session
    // s2: anchored the day BEFORE the window; its booking lands inside it.
    // Cohort anchoring must attribute the booking to the anchor day (excluded).
    await ev('s2', 'view', D0 + 100);
    await booking('s2', D1 + 600);
    // s3: no funnel events at all (beacons lost) — falls back to the booking's
    // own created_at, inside the window.
    await booking('s3', D1 + 700);

    expect(await bookingCount(db, formId, WINDOW)).toBe(2); // s1 + s3
    expect(await bookingCount(db, formId)).toBe(3); // unbounded sees all
  });
});

describe('cohort-anchor windowing (HAVING MIN(created_at))', () => {
  it('windows by the session first-seen time, excluding a session that straddles the boundary', async () => {
    // s_in first appears inside the window.
    await ev('s_in', 'view', D1 + 100);
    // s_straddle first appears the day BEFORE (anchor = D0+500, outside the
    // window) but also has a view INSIDE the window. Windowing by the event's
    // own time would count it; anchoring by first-seen must exclude it.
    await ev('s_straddle', 'view', D0 + 500);
    await ev('s_straddle', 'view', D1 + 200);

    expect(await uniqueViewCount(db, formId, WINDOW)).toBe(1); // only s_in
    expect(await uniqueViewCount(db, formId)).toBe(2); // unbounded sees both
  });
});

describe('integer day bucketing (anchor / 86400000)', () => {
  it('buckets each session into exactly one day by its cohort anchor', async () => {
    await ev('a', 'view', D1 + 100); // day 20000
    await ev('b', 'view', D1 + 5000); // day 20000
    await ev('c', 'view', D2 + 100); // day 20001
    const byDay = new Map(
      (await dailyViewSessions(db, formId)).map((r) => [r.day, r.n]),
    );
    expect(byDay.get(20_000)).toBe(2);
    expect(byDay.get(20_001)).toBe(1);
  });

  it('daily Starts follow the same anchor day even when the start event lands next day', async () => {
    // First-seen at the end of day 20000; the actual answer crosses into
    // 20001. The start must bucket into 20000 (the anchor day), not 20001.
    await ev('s', 'view', D2 - 1000);
    await ev('s', 'step_complete', D2 + 1000, { stepIndex: 0, stepKey: 'q1' });
    const byDay = new Map(
      (await dailyStartSessions(db, formId)).map((r) => [r.day, r.n]),
    );
    expect(byDay.get(20_000)).toBe(1);
    expect(byDay.has(20_001)).toBe(false);
  });
});

describe('completed submissions — open→complete duration + anchor day (correlated subqueries)', () => {
  it('derives duration from the first view, buckets by anchor, and returns null when the open signal is unknowable', async () => {
    // Has a `view` → duration = complete - firstView; anchor day 20000.
    await ev('s_dur', 'view', D1 + 1000);
    await sub('s_dur', { startedAt: D1 + 1000, completedAt: D1 + 61_000 });

    // No form_event and started_at == completed_at → open time is genuinely
    // unknown, so duration is null (must NOT report 0).
    await sub('s_equal', { startedAt: D1 + 2000, completedAt: D1 + 2000 });

    // No view, but started_at strictly < completed_at → started_at is a usable
    // fallback open time.
    await sub('s_started', { startedAt: D1 + 3000, completedAt: D1 + 33_000 });

    // First-seen the previous day, completed inside the window → the row must
    // bucket into the ANCHOR day (19999), not the completion day (20000).
    await ev('s_cross', 'view', D1 - 1000);
    await sub('s_cross', { startedAt: D1 - 1000, completedAt: D1 + 1000 });

    const rows = await completedSubmissions(db, formId);
    expect(rows).toHaveLength(4);

    const durations = rows.map((r) => r.durationMs).sort((a, b) => {
      if (a == null) return 1;
      if (b == null) return -1;
      return a - b;
    });
    expect(durations).toEqual([2000, 30_000, 60_000, null]);

    const cross = rows.find((r) => r.durationMs === 2000)!;
    expect(cross.day).toBe(19_999); // anchor day, not completion day
    expect(rows.filter((r) => r.day === 20_000)).toHaveLength(3);
  });
});

describe('partial submissions windowed by cohort anchor', () => {
  it('counts a partial in its anchor window and ignores completed rows', async () => {
    await ev('p', 'view', D1 + 100);
    await sub('p', { startedAt: D1 + 100, partialAt: D1 + 200 }); // partial (no completed_at)
    await ev('done', 'view', D1 + 300);
    await sub('done', { startedAt: D1 + 300, completedAt: D1 + 400 }); // completed → not a partial

    expect(await partialCount(db, formId, WINDOW)).toBe(1);
    expect(await partialCount(db, formId, { from: D0, to: D1 - 1 })).toBe(0);
    expect(await partialCount(db, formId)).toBe(1);
  });
});

describe('submission-table ordering', () => {
  it('keeps tied timestamps stable across adjacent pages and exports', async () => {
    const tiedAt = D1 + 1_000;
    await sub('newest', { id: 'submission-newest', startedAt: tiedAt + 1 });
    await sub('tie-a', { id: 'submission-tie-a', startedAt: tiedAt });
    await sub('tie-b', { id: 'submission-tie-b', startedAt: tiedAt });
    await sub('tie-c', { id: 'submission-tie-c', startedAt: tiedAt });
    await sub('tie-d', { id: 'submission-tie-d', startedAt: tiedAt });
    await sub('oldest', { id: 'submission-oldest', startedAt: tiedAt - 1 });

    const expected = [
      'submission-newest',
      'submission-tie-d',
      'submission-tie-c',
      'submission-tie-b',
      'submission-tie-a',
      'submission-oldest',
    ];
    const first = await querySubmissions(db, formId, { limit: 2, offset: 0 });
    const second = await querySubmissions(db, formId, { limit: 2, offset: 2 });
    const third = await querySubmissions(db, formId, { limit: 2, offset: 4 });
    const pageIds = [...first.items, ...second.items, ...third.items].map((row) => row.id);

    expect(first.total).toBe(expected.length);
    expect(pageIds).toEqual(expected);
    expect(new Set(pageIds)).toHaveLength(expected.length);
    expect((await allSubmissionsForExport(db, formId)).map((row) => row.id)).toEqual(expected);
  });
});

describe('step-view attribution — by authored key vs legacy index', () => {
  it('groups step_key-tagged rows by key and null-key rows by index, de-duping sessions', async () => {
    // Tagged step: two mounts of the same session collapse to one.
    await ev('s_key', 'step_view', D1 + 100, { stepIndex: 1, stepKey: 'q_email' });
    await ev('s_key', 'step_view', D1 + 150, { stepIndex: 1, stepKey: 'q_email' });
    // Legacy row (recorded before step_key existed): grouped by index only.
    await ev('s_legacy', 'step_view', D1 + 200, { stepIndex: 2, stepKey: null });

    const counts = await stepViewCounts(db, formId);
    expect(counts.byKey.get('q_email')).toBe(1);
    expect(counts.byIndex.get(2)).toBe(1);
    expect(counts.byKey.has('__none__')).toBe(false);
  });

  it('counts step COMPLETIONS separately (the vertical funnel body)', async () => {
    // Both sessions SAW q1; only one answered it. The answered funnel must say
    // 1 while the viewed funnel says 2 — this split is the whole point of the
    // vertical drop-off mode.
    await ev('s_a', 'step_view', D1 + 100, { stepIndex: 0, stepKey: 'q1' });
    await ev('s_a', 'step_complete', D1 + 150, { stepIndex: 0, stepKey: 'q1' });
    await ev('s_b', 'step_view', D1 + 200, { stepIndex: 0, stepKey: 'q1' });

    expect((await stepCompleteCounts(db, formId)).byKey.get('q1')).toBe(1);
    expect((await stepViewCounts(db, formId)).byKey.get('q1')).toBe(2);
  });
});
