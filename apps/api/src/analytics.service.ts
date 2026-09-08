import { Inject, Injectable, Logger } from '@nestjs/common';
import { localDayIndex, resolveTimeZone, utcOffsetSegments } from '@quill/shared';
import { resolveFormLayout } from '@quill/engine';
import type { Db } from '@quill/db';
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
  deleteSubmissionForAccount,
  getFormById,
  type CompletedSubmission,
  type DateRange,
  type DeleteSubmissionResult,
  type SubmissionQuery,
  firstEventAt,
  type DayBucketing,
} from '@quill/db';
import type {
  AnalyticsResponse,
  DropoffRow,
  FormConfig,
  SubmissionAnswers,
  SubmissionsPage,
  TrendPoint,
} from '@quill/types';
import { DB } from './tokens';

/** Round to one decimal place (e.g. a completion/drop-off percentage). */
function pct1(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/**
 * Completion rate, clamped to 100%.
 *
 * Numerator and denominator are windowed by DIFFERENT timestamps (submissions by
 * `completed_at`, starts by the first-question view) so that each metric counts
 * events when they actually happened. The side effect is that a session which
 * starts just before a window and completes inside it contributes a completion
 * without its start — and with enough of those the raw ratio exceeds 1. QA
 * rendered 200% and 300% that way, including on the stock "Today" preset, since
 * any session crossing UTC midnight splits across two windows.
 *
 * A completion rate above 100% is never a fact about a form, so it is capped
 * here rather than printed. (Making the two sides describe one session cohort is
 * the real answer and a product decision — tracked in SPEC-METRICS.md.)
 */
function completionPct(submissions: number, starts: number): number | null {
  // No starts in the window = no denominator. Printing 0% beside a non-zero
  // Submissions count states a completion rate nobody can compute; null renders
  // as an em dash instead.
  if (starts <= 0) return null;
  return Math.min(100, pct1(submissions, starts));
}

/** Median seconds from a list of ms durations, or null when none is derivable. */
function medianSeconds(durationsMs: number[]): number | null {
  if (durationsMs.length === 0) return null;
  return Math.round(median(durationsMs) / 1000);
}

/**
 * Median of a numeric list (0 for empty). Even length → mean of the two middle
 * values. Used for "time to complete": Typeform reports a median because a few
 * long-abandon sessions would drag a mean far from the typical experience, and
 * cross-dialect SQL cannot compute a percentile portably (see completionDurations).
 */
function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Most daily points a trend series may carry (a year), so an all-time range
 *  across years cannot balloon the payload. When capped, the most RECENT window
 *  is kept — that is the part a dashboard actually plots. */
const MAX_TREND_DAYS = 366;

/**
 * Assemble the per-day Trends series. Every metric is emitted for every day in
 * the window so the chart can switch metric without a round trip, and the window
 * is GAP-FILLED (a day with no activity is a real zero point) — otherwise the
 * chart would draw a straight line across dead days and read as flat traffic
 * rather than none. Day buckets are whole UTC days, matching the SQL bucketing.
 */
function buildTrends(input: {
  range: DateRange;
  /** The zone the day buckets were named in (`'UTC'` = the historical behavior). */
  zone: string;
  dailyViews: { day: number; n: number }[];
  dailyStarts: { day: number; n: number }[];
  completed: CompletedSubmission[];
}): TrendPoint[] {
  const viewsByDay = new Map(input.dailyViews.map((d) => [d.day, d.n]));
  const startsByDay = new Map(input.dailyStarts.map((d) => [d.day, d.n]));
  const subsByDay = new Map<number, number>();
  const dursByDay = new Map<number, number[]>();
  for (const c of input.completed) {
    subsByDay.set(c.day, (subsByDay.get(c.day) ?? 0) + 1);
    if (c.durationMs != null) {
      const list = dursByDay.get(c.day) ?? [];
      list.push(c.durationMs);
      dursByDay.set(c.day, list);
    }
  }

  const observed = [...viewsByDay.keys(), ...startsByDay.keys(), ...subsByDay.keys()];
  // With an explicit window we can still plot it as all-zero days — "nothing
  // happened in this range" is a real answer and should draw a flat line, not
  // vanish. Only an unbounded range with no activity has nothing to say.
  const bounded = input.range.from != null && input.range.to != null;
  if (observed.length === 0 && !bounded) return [];

  // Bound by the explicit range when one was given (so "last 30 days" plots 30
  // points even where nothing happened), else by the observed activity span.
  // The same day naming as the SQL buckets: `localDayIndex` is the JS twin of
  // the `(col + offset) / 86400000` expression, so the window's edges and the
  // buckets agree in every zone.
  const fromDay = input.range.from != null ? localDayIndex(input.range.from, input.zone) : Math.min(...observed);
  const toDay = input.range.to != null ? localDayIndex(input.range.to, input.zone) : Math.max(...observed);
  if (toDay < fromDay) return [];

  const span = Math.min(toDay - fromDay, MAX_TREND_DAYS - 1);
  const out: TrendPoint[] = [];
  for (let i = 0; i <= span; i++) {
    const day = toDay - span + i; // keep the most recent window when capped
    const starts = startsByDay.get(day) ?? 0;
    const submissions = subsByDay.get(day) ?? 0;
    out.push({
      t: day * DAY_MS,
      views: viewsByDay.get(day) ?? 0,
      starts,
      submissions,
      completionRate: completionPct(submissions, starts),
      timeToComplete: medianSeconds(dursByDay.get(day) ?? []),
    });
  }
  return out;
}

/**
 * The admin analytics + submissions read surface. Aggregates are computed from
 * `form_event` (funnel counts) + `submission` (completed/partial + timing) via
 * the portable DB queries, then the funnel + per-step drop-off table is
 * assembled here against the form's configured steps. All operations are
 * account-scoped by the caller (the controller resolves the host first).
 */
@Injectable()
export class AnalyticsService {
  private readonly log = new Logger('AnalyticsService');

  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * The offset segments that let SQL name calendar days in `zone` across the
   * queried window (one day of slack on each side, so an edge event whose
   * local day differs from its UTC day is still covered). UTC needs none: the
   * absent bucketing is the exact SQL this always ran.
   */
  private async bucketingFor(formId: string, range: DateRange, zone: string): Promise<DayBucketing | undefined> {
    if (zone === 'UTC') return undefined;
    const from = range.from ?? (await firstEventAt(this.db, formId)) ?? Date.now();
    const to = range.to ?? Date.now();
    return { segments: utcOffsetSegments(from - DAY_MS, to + DAY_MS, zone) };
  }

  /**
   * Funnel summary + question-by-question drop-off for a form over a range.
   * `timeZone` names the calendar days of the trend buckets (and is echoed
   * back as `range.timeZone`); absent or unknown = UTC, the historical rule.
   */
  async funnel(
    accountId: string,
    formId: string,
    range: DateRange,
    timeZone?: string | null,
  ): Promise<AnalyticsResponse | null> {
    const form = await getFormById(this.db, accountId, formId);
    if (!form) return null;
    const zone = resolveTimeZone(timeZone, (m) => this.log.warn(m));
    const bucketing = await this.bucketingFor(formId, range, zone);
    const config = form.config as FormConfig;
    const steps = config.steps ?? [];
    // Vertical shows every question on one page, so "viewed step X" fires for
    // most of the form on load and the per-step funnel flattens into Views.
    // There the honest per-question signal is "answered" (step_complete);
    // slides keeps "reached the step" (step_view).
    const dropoffMode = resolveFormLayout(config) === 'vertical' ? 'answered' : 'viewed';

    const [views, starts, stepViews, partialSubmits, bookings, completed, dailyViews, dailyStarts] =
      await Promise.all([
        uniqueViewCount(this.db, formId, range),
        startCount(this.db, formId, range),
        dropoffMode === 'answered'
          ? stepCompleteCounts(this.db, formId, range)
          : stepViewCounts(this.db, formId, range),
        partialCount(this.db, formId, range),
        bookingCount(this.db, formId, range),
        completedSubmissions(this.db, formId, range, bucketing),
        dailyViewSessions(this.db, formId, range, bucketing),
        dailyStartSessions(this.db, formId, range, bucketing),
      ]);

    // One completed-submission read feeds the total, the median and the trend.
    const submissions = completed.length;
    const durations = completed
      .map((c) => c.durationMs)
      .filter((d): d is number => d != null);
    const completionRate = completionPct(submissions, starts);
    // Median open→complete in whole seconds, or null when no session in range
    // had a derivable open time (never 0 — that would be a fabricated fact).
    const timeToComplete = medianSeconds(durations);
    const trends = buildTrends({ range, zone, dailyViews, dailyStarts, completed });

    // rowViews[0] = form views (the cover/landing); rowViews[i+1] = views of
    // step i. Looked up by the step's KEY first (V5-D3) — stable regardless of
    // where show/hide/goto logic placed it in a given session's visible order —
    // falling back to the old positional index only for events recorded before
    // step_key existed.
    const rowViews: number[] = [views];
    for (let i = 0; i < steps.length; i++) {
      rowViews.push(stepViews.byKey.get(steps[i]!.key) ?? stepViews.byIndex.get(i) ?? 0);
    }

    const dropoff: DropoffRow[] = [];

    // Cover/landing row: drop between the landing and the first step.
    const coverViews = rowViews[0] ?? 0;
    const coverDrop = Math.max(0, coverViews - (rowViews[1] ?? 0));
    dropoff.push({
      stepIndex: -1,
      key: null,
      // Empty when the form has NO cover: the row is then plain form views, and
      // labelling it "Cover" described a screen that does not exist. The client
      // picks the wording from whether this is set (mirrors the renderer's own
      // "cover is active" rule).
      question:
        config.cover && config.cover.enabled !== false
          ? config.cover.headline?.trim() || config.cover.eyebrow?.trim() || 'Cover'
          : '',
      isCover: true,
      views: coverViews,
      dropoff: coverDrop,
      dropoffPercent: pct1(coverDrop, coverViews),
    });

    // One row per configured step. The "next" for the last step is completed
    // submissions (the true bottom of the funnel), matching the pilot semantics.
    for (let i = 0; i < steps.length; i++) {
      const viewsAtStep = rowViews[i + 1] ?? 0;
      const viewsAtNext = i < steps.length - 1 ? (rowViews[i + 2] ?? 0) : submissions;
      const drop = Math.max(0, viewsAtStep - viewsAtNext);
      dropoff.push({
        stepIndex: i,
        key: steps[i]!.key,
        question: steps[i]!.question?.trim() || steps[i]!.key,
        isCover: false,
        views: viewsAtStep,
        dropoff: drop,
        dropoffPercent: pct1(drop, viewsAtStep),
      });
    }

    return {
      views,
      starts,
      submissions,
      completionRate,
      timeToComplete,
      partialSubmits,
      bookings,
      dropoffMode,
      dropoff,
      trends,
      range: { from: range.from ?? null, to: range.to ?? null, timeZone: zone },
    };
  }

  /** A page of a form's submissions (newest first) matching the filter. */
  async submissionsPage(formId: string, q: SubmissionQuery): Promise<SubmissionsPage> {
    const page = await querySubmissions(this.db, formId, q);
    return {
      items: page.items.map((r) => ({ ...r, data: (r.data ?? {}) as SubmissionAnswers })),
      total: page.total,
      limit: page.limit,
      offset: page.offset,
    };
  }

  /** Every submission matching the filter (CSV export — no pagination). */
  exportSubmissions(formId: string, q: Omit<SubmissionQuery, 'limit' | 'offset'>) {
    return allSubmissionsForExport(this.db, formId, q);
  }

  /**
   * Delete a submission if it belongs to the account. Returns a discriminated
   * result so the controller can 204 an idempotent same-account delete but 404 a
   * cross-account id (which is never mutated).
   */
  deleteSubmission(accountId: string, submissionId: string): Promise<DeleteSubmissionResult> {
    return deleteSubmissionForAccount(this.db, accountId, submissionId);
  }
}
