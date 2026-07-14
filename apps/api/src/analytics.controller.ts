import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Db } from '@quill/db';
import { getFormById } from '@quill/db';
import type { FormConfig } from '@quill/types';
import { AuthService, type ReqLike } from './auth.service';
import { AnalyticsService } from './analytics.service';
import { DB } from './tokens';
import { csvRow } from './csv';
import { parseBound, parseStatus } from './query-params';

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
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AnalyticsService) private readonly analytics: AnalyticsService,
  ) {}

  /** Funnel metrics + per-step drop-off for a form over an optional date range. */
  @Get('forms/:id/analytics')
  async formAnalytics(
    @Req() req: ReqLike,
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const p = await this.auth.resolveHost(req);
    const result = await this.analytics.funnel(p.accountId, id, {
      from: parseBound(from, false),
      to: parseBound(to, true),
    });
    if (!result) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    return result;
  }

  /**
   * Stream the form's submissions as CSV. Answers flatten to one column per
   * configured step key (form config order), after the fixed metadata columns.
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

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');

    res.write(csvRow(['id', 'session_id', 'status', 'score', 'started_at', 'completed_at', ...stepKeys]));

    const rows = await this.analytics.exportSubmissions(id, {
      status: parseStatus(status),
      from: parseBound(from, false),
      to: parseBound(to, true),
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
