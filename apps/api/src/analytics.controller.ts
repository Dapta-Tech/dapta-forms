import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Db } from '@quill/db';
import {
  getAccountTimezone,
  getFormById,
  getMemberLocale,
  getSubmissionAnswersForAccount,
  MAX_BULK_SUBMISSIONS,
} from '@quill/db';
import { isTextSummaryStep } from '@quill/engine';
import { formatIsoWithOffset, getMessages, resolveTimeZone } from '@quill/shared';
import type { FormConfig, SubmissionAnswers } from '@quill/types';
import { AuthService, type ReqLike } from './auth.service';
import { AnalyticsService } from './analytics.service';
import { DB } from './tokens';
import { csvRow, exportColumns, UTF8_BOM } from './csv';
import { parseBound, parseIdList, parseIntParam, parseTimeZone } from './query-params';
import { parseSort, parseSubmissionFilter, workspaceZone, type FilterQuery } from './submission-filter';

/** A minimal response shape (structurally satisfied by the express Response). */
interface StreamRes {
  setHeader(name: string, value: string): void;
  write(chunk: string): void;
  end(): void;
}

/**
 * Host-authed analytics + submissions read/export/delete surface. Kept separate
 * from AdminCrudController so the analytics feature is self-contained (registered
 * append-only in app.module). Every route resolves the host first, then scopes
 * by the caller's account.
 */
@Controller('v1')
export class AnalyticsController {
  private readonly log = new Logger('AnalyticsController');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AnalyticsService) private readonly analytics: AnalyticsService,
  ) {}

  /**
   * Funnel metrics + per-step drop-off for a form over an optional date range.
   * Days are named in `?tz=`, else the workspace's zone, else UTC; a bare
   * `YYYY-MM-DD` bound is a whole day in that zone.
   */
  @Get('forms/:id/analytics')
  async formAnalytics(
    @Req() req: ReqLike,
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('tz') tz?: string,
  ) {
    const p = await this.auth.resolveHost(req);
    const zone = resolveTimeZone(parseTimeZone(tz) ?? (await getAccountTimezone(this.db, p.accountId)), (m) =>
      this.log.warn(m),
    );
    const result = await this.analytics.funnel(
      p.accountId,
      id,
      { from: parseBound(from, false, zone), to: parseBound(to, true, zone) },
      zone,
    );
    if (!result) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    return result;
  }

  /**
   * Stream the form's submissions as a CSV a person can open in a spreadsheet:
   * one column per answering step headed by its question (message and reveal
   * steps have none), option labels rather than stored values, a file as its
   * name, a booking and `Submitted at` read in the workspace's zone, the name
   * split into first and last name up front, and the technical columns at the
   * end. `Submitted at` is the completion instant, else the partial, else the
   * start, so no row goes without a date. Every header that is not a question,
   * and the status, follow the downloading member's language, then the form's,
   * then English. Starts with a UTF-8 BOM so Excel keeps the accents.
   * Uses the un-paginated export query (`allSubmissionsForExport`): the table
   * query caps `limit` at 200, so paging through it would silently truncate and
   * skip rows on large exports. Rows are still written incrementally.
   *
   * `?ids=a,b,c` narrows the file to those submissions ("Export selected" on a
   * table selection), same columns and format, at most `MAX_BULK_SUBMISSIONS`.
   * Ids outside this form match nothing.
   */
  @Get('forms/:id/submissions.csv')
  async exportCsv(
    @Req() req: ReqLike,
    @Res() res: StreamRes,
    @Param('id') id: string,
    @Query() query: FilterQuery,
    @Query('ids') idsParam?: string,
  ): Promise<void> {
    const ids = parseIdList(idsParam);
    // Checked before any header is written: once the stream starts, the
    // status is 200 whatever happens next.
    if (ids && (ids.length === 0 || ids.length > MAX_BULK_SUBMISSIONS || !ids.every(isSubmissionId))) {
      throw new BadRequestException({
        error: 'BAD_REQUEST',
        message: `ids must name 1 to ${MAX_BULK_SUBMISSIONS} submissions.`,
      });
    }
    const p = await this.auth.resolveHost(req);
    const form = await getFormById(this.db, p.accountId, id);
    if (!form) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });

    const config = form.config as FormConfig;
    const filename = `${form.slug || 'submissions'}-submissions.csv`;
    // An unknown stored zone exports as UTC (+00:00) rather than failing the download.
    const zone = await workspaceZone(this.db, p.accountId, (m) => this.log.warn(m));
    // Parsed before any header is written, so a malformed filter is still a 400.
    const filter = { ...parseSubmissionFilter(query, config, zone), sort: parseSort(query.sort, config) };
    const local = (ms: number | null) => (ms == null ? '' : formatIsoWithOffset(ms, zone));
    const locale = (await getMemberLocale(this.db, p.accountId, p.memberId)) ?? config.language ?? 'en';
    const m = getMessages(locale).admin.submissions;
    const columns = exportColumns(config.steps ?? [], {
      scoring: config.scoring?.enabled !== false,
      timeZone: zone,
      labels: {
        firstName: m.colFirstName,
        lastName: m.colLastName,
        submittedAt: m.colSubmittedAt,
        status: m.colStatus,
        score: m.colScore,
        submissionId: m.colSubmissionId,
      },
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');

    res.write(UTF8_BOM + csvRow(columns.map((c) => c.header)));

    const rows = await this.analytics.exportSubmissions(id, { ...filter, ids });
    for (const s of rows) {
      const row = {
        id: s.id,
        data: (s.data ?? {}) as Record<string, unknown>,
        score: s.score,
        // Same reading as the submissions table: completed, else partial.
        status: s.completedAt != null ? m.badgeCompleted : m.badgePartial,
        // Latest instant known, as the table shows it: a partial row still has a date.
        submittedAt: local(s.completedAt ?? s.partialAt ?? s.startedAt),
      };
      res.write(csvRow(columns.map((c) => c.value(row))));
    }
    res.end();
  }

  /**
   * The Summary tab: one card per answering step (option counts, a scale's
   * average and spread, the latest text answers, how many files and bookings).
   * Takes the table's filter (`status`, `from`/`to` bound by startedAt), so a
   * filtered summary describes exactly the filtered rows.
   */
  @Get('forms/:id/summary')
  async formSummary(@Req() req: ReqLike, @Param('id') id: string, @Query() query: FilterQuery) {
    const p = await this.auth.resolveHost(req);
    const form = await getFormById(this.db, p.accountId, id);
    if (!form) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    const config = form.config as FormConfig;
    const zone = await workspaceZone(this.db, p.accountId, (m) => this.log.warn(m));
    return this.analytics.summary(id, config.steps ?? [], parseSubmissionFilter(query, config, zone));
  }

  /**
   * What the table's header filters offer, counted over every response of the
   * form (the distribution before filtering): the total, completed and partial,
   * and each choice question's options with how many picked them.
   */
  @Get('forms/:id/submissions-facets')
  async submissionFacets(@Req() req: ReqLike, @Param('id') id: string) {
    const p = await this.auth.resolveHost(req);
    const form = await getFormById(this.db, p.accountId, id);
    if (!form) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    return this.analytics.facets(id, (form.config as FormConfig).steps ?? []);
  }

  /**
   * One text question's answers, searched: `q` matched anywhere in the answer,
   * ignoring case but not accents; blank lists them all. Newest first,
   * paginated (`limit` up to 50, `offset`), under the same filter as the table.
   * 404 for a step that is not a text question of this form.
   */
  @Get('forms/:id/summary/:stepKey/answers')
  async summaryAnswers(
    @Req() req: ReqLike,
    @Param('id') id: string,
    @Param('stepKey') stepKey: string,
    @Query() query: FilterQuery,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const p = await this.auth.resolveHost(req);
    const form = await getFormById(this.db, p.accountId, id);
    if (!form) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    const config = form.config as FormConfig;
    const steps = config.steps ?? [];
    const step = steps.find((s) => s.key === stepKey);
    if (!step || !isTextSummaryStep(step))
      throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    const zone = await workspaceZone(this.db, p.accountId, (m) => this.log.warn(m));
    return this.analytics.searchAnswers(id, steps, step, {
      ...parseSubmissionFilter(query, config, zone),
      query: typeof q === 'string' ? q.slice(0, 200) : undefined,
      limit: parseIntParam(limit),
      offset: parseIntParam(offset),
    });
  }

  /**
   * One submission in full, for the response panel opened from the Summary.
   * Read through the account join, so another workspace's id is a 404 exactly
   * like an id that never existed; and it must belong to the form in the path.
   */
  @Get('forms/:id/submissions/:submissionId')
  async submission(
    @Req() req: ReqLike,
    @Param('id') id: string,
    @Param('submissionId') submissionId: string,
  ) {
    const p = await this.auth.resolveHost(req);
    const row = await getSubmissionAnswersForAccount(this.db, p.accountId, submissionId);
    if (!row || row.formId !== id)
      throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    return { ...row, data: (row.data ?? {}) as SubmissionAnswers };
  }

  /**
   * Delete a submission (account-scoped). Same-account delete — including a
   * repeat on an already-deleted row — is idempotent → 204. A cross-account id
   * is never touched and returns 404 (mirrors GET; no data leak, no misleading
   * 204 "success").
   */
  @Delete('submissions/:id')
  @HttpCode(204)
  async deleteSubmission(@Req() req: ReqLike, @Param('id') id: string): Promise<void> {
    const p = await this.auth.resolveHost(req);
    const result = await this.analytics.deleteSubmission(p.accountId, id);
    if (result === 'forbidden')
      throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    // 'deleted' | 'absent' → idempotent 204.
  }

  /**
   * Delete several of a form's submissions at once (the table's selection),
   * body `{ ids: string[] }`, 1 to `MAX_BULK_SUBMISSIONS` ids. Account-scoped
   * like the single delete: a form outside the account is a 404, and an id
   * from another account or form is never touched. Answers `{ deleted }`, the
   * rows actually removed, so a repeat after a partial race is harmless.
   */
  @Post('forms/:id/submissions/bulk-delete')
  @HttpCode(200)
  async deleteSubmissions(
    @Req() req: ReqLike,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ deleted: number }> {
    const raw = (body as { ids?: unknown } | null)?.ids;
    // Deduplicated before the cap is checked: a selection that names one row
    // twice is still one row, and 100 distinct ids plus a repeat is not 101.
    const ids = Array.isArray(raw) ? [...new Set(raw)] : [];
    if (
      ids.length === 0 ||
      ids.length > MAX_BULK_SUBMISSIONS ||
      !ids.every(isSubmissionId)
    ) {
      throw new BadRequestException({
        error: 'BAD_REQUEST',
        message: `ids must be 1 to ${MAX_BULK_SUBMISSIONS} submission ids.`,
      });
    }
    const p = await this.auth.resolveHost(req);
    const form = await getFormById(this.db, p.accountId, id);
    if (!form) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    return this.analytics.deleteSubmissions(p.accountId, id, ids);
  }
}

/** Longest id a caller may name. Submission ids are UUIDs (36); this is headroom, not a format check. */
const MAX_ID_LENGTH = 64;

/** A plausible submission id: a non-empty string of bounded length. Ownership is the query's job. */
function isSubmissionId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LENGTH;
}
