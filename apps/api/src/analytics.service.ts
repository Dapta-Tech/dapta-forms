import { Inject, Injectable } from '@nestjs/common';
import type { Db } from '@quill/db';
import {
  uniqueViewCount,
  startCount,
  stepViewCounts,
  completedCount,
  partialCount,
  completionDurations,
  querySubmissions,
  allSubmissionsForExport,
  deleteSubmissionForAccount,
  getFormById,
  type DateRange,
  type DeleteSubmissionResult,
  type SubmissionQuery,
} from '@quill/db';
import type {
  AnalyticsResponse,
  DropoffRow,
  FormConfig,
  SubmissionAnswers,
  SubmissionsPage,
} from '@quill/types';
import { DB } from './tokens';

/** Round to one decimal place (e.g. a completion/drop-off percentage). */
function pct1(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
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

/**
 * The admin analytics + submissions read surface. Aggregates are computed from
 * `form_event` (funnel counts) + `submission` (completed/partial + timing) via
 * the portable DB queries, then the funnel + per-step drop-off table is
 * assembled here against the form's configured steps. All operations are
 * account-scoped by the caller (the controller resolves the host first).
 */
@Injectable()
export class AnalyticsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Funnel summary + question-by-question drop-off for a form over a range. */
  async funnel(accountId: string, formId: string, range: DateRange): Promise<AnalyticsResponse | null> {
    const form = await getFormById(this.db, accountId, formId);
    if (!form) return null;
    const config = form.config as FormConfig;
    const steps = config.steps ?? [];

    const [views, starts, stepViews, submissions, partialSubmits, durations] = await Promise.all([
      uniqueViewCount(this.db, formId, range),
      startCount(this.db, formId, range),
      stepViewCounts(this.db, formId, range),
      completedCount(this.db, formId, range),
      partialCount(this.db, formId, range),
      completionDurations(this.db, formId, range),
    ]);

    const completionRate = pct1(submissions, starts);
    // Median open→complete, in whole seconds (durations are ms).
    const timeToComplete = Math.round(median(durations) / 1000);

    // rowViews[0] = form views (the cover/landing); rowViews[i+1] = views of step i.
    const rowViews: number[] = [views];
    for (let i = 0; i < steps.length; i++) rowViews.push(stepViews.get(i) ?? 0);

    const dropoff: DropoffRow[] = [];

    // Cover/landing row: drop between the landing and the first step.
    const coverViews = rowViews[0] ?? 0;
    const coverDrop = Math.max(0, coverViews - (rowViews[1] ?? 0));
    dropoff.push({
      stepIndex: -1,
      key: null,
      question: config.cover?.headline?.trim() || config.cover?.eyebrow?.trim() || 'Cover',
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
      dropoff,
      range: { from: range.from ?? null, to: range.to ?? null },
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
