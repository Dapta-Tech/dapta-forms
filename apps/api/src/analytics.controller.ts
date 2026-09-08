import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Db } from '@quill/db';
import { getAccountTimezone, getFormById } from '@quill/db';
import { formatIsoWithOffset, resolveTimeZone } from '@quill/shared';
import type { FormConfig } from '@quill/types';
import { AuthService, type ReqLike } from './auth.service';
import { AnalyticsService } from './analytics.service';
import { DB } from './tokens';
import { csvRow } from './csv';
import { parseBound, parseStatus, parseTimeZone } from './query-params';

/** A minimal response shape (structurally satisfied by the express Response). */
interface StreamRes {
  setHeader(name: string, value: string): void;
  write(chunk: string): void;
  end(): void;
}

function iso(ms: number | null): string {
  return ms == null ? '' : new Date(ms).toISOString();
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
   * Stream the form's submissions as CSV. Answers flatten to one column per
   * configured step key (form config order), after the fixed metadata columns.
   * `started_at` / `completed_at` stay UTC ISO (`Z`), and `*_local` twins carry
   * the same instants read in the workspace's zone with their offset, so a
   * spreadsheet shows the team's clock without losing the machine one.
   * Uses the un-paginated export query (`allSubmissionsForExport`) — the table
   * query caps `limit` at 200, so paging through it would silently truncate and
   * skip rows on large exports. Rows are still written incrementally.
   */
  @Get('forms/:id/submissions.csv')
  async exportCsv(
    @Req() req: ReqLike,
    @Res() res: StreamRes,
    @Param('id') id: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<void> {
    const p = await this.auth.resolveHost(req);
    const form = await getFormById(this.db, p.accountId, id);
    if (!form) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });

    const config = form.config as FormConfig;
    const stepKeys = (config.steps ?? []).map((s) => s.key);
    const filename = `${form.slug || 'submissions'}-submissions.csv`;
    // An unknown stored zone exports as UTC (+00:00) rather than failing the download.
    const zone = resolveTimeZone(await getAccountTimezone(this.db, p.accountId), (m) => this.log.warn(m));
    const local = (ms: number | null) => (ms == null ? '' : formatIsoWithOffset(ms, zone));

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');

    res.write(
      csvRow([
        'id',
        'session_id',
        'status',
        'score',
        'started_at',
        'completed_at',
        'started_at_local',
        'completed_at_local',
        ...stepKeys,
      ]),
    );

    const rows = await this.analytics.exportSubmissions(id, {
      status: parseStatus(status),
      from: parseBound(from, false, zone),
      to: parseBound(to, true, zone),
    });
    for (const s of rows) {
      const data = (s.data ?? {}) as Record<string, unknown>;
      const st = s.completedAt != null ? 'completed' : s.partialAt != null ? 'partial' : 'in_progress';
      res.write(
        csvRow([
          s.id,
          s.sessionId,
          st,
          s.score,
          iso(s.startedAt),
          iso(s.completedAt),
          local(s.startedAt),
          local(s.completedAt),
          ...stepKeys.map((k) => data[k]),
        ]),
      );
    }
    res.end();
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
}
