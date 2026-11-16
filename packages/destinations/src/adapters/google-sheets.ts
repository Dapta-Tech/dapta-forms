/**
 * Append each submission to a Google Sheet as a new row.
 *
 * ONE API call per delivery, deliberately. Google's write quota is 60 requests
 * a minute per user and 300 per project, and a submission burst is exactly when
 * a form is worth the most, so every extra round trip here is quota spent on
 * something the author did not ask for. That is why this adapter does not read
 * the sheet first, does not look up the tab, and does not write a header row:
 * all three are one-time, author-driven jobs the admin surface does when the
 * sheet is chosen, not per-respondent work.
 *
 * The credential is a short-lived ACCESS token injected by the API layer, which
 * holds the refresh token and redeems it. Nothing about OAuth lives in this
 * package: an adapter that could mint its own credentials would be an adapter
 * the factory could not degrade.
 *
 * FAILURE SEMANTICS, which is the part worth reading twice. The port says to
 * resolve `delivered:false` for a permanent no-op and to THROW only for
 * something a retry could fix. Google's statuses split cleanly along that line,
 * and getting it wrong is expensive in both directions: a permanent failure
 * thrown is a row that retries until the outbox gives up, and a transient one
 * resolved is a submission silently lost.
 *
 *   400 / 401 / 403 / 404  the config or the grant is wrong: a deleted
 *                          spreadsheet, a renamed tab, access revoked, a token
 *                          Google will not honour. Retrying cannot fix any of
 *                          them, so they resolve as a no-op that NAMES the
 *                          cause for the delivery history.
 *   429 / 5xx / network    quota, or Google having a bad minute. These throw,
 *                          and the outbox's backoff is the right answer.
 */
import type {
  DestinationContext,
  DestinationResult,
  SubmissionDestination,
} from '../destination.port';
import type { SheetColumn } from '@quill/types';

export const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

/** Give up on a Sheets call that never settles, so one delivery cannot wedge a lane. */
export const DEFAULT_SHEETS_TIMEOUT_MS = 15_000;

/** How much of Google's error body is kept for the delivery history. */
const MAX_DETAIL = 500;

export interface GoogleSheetsDestinationOptions {
  /**
   * A live OAuth access token, minted by the API layer from the account's
   * refresh token. Empty when the account is not connected or Google refused to
   * renew: the factory then degrades to log-only rather than calling with it.
   */
  accessToken: string;
  spreadsheetId: string;
  /** The tab's visible name. Absent writes to the sheet's first tab. */
  sheetTitle?: string;
  /** The row, left to right. Empty means not configured: the factory degrades. */
  columns: SheetColumn[];
  timeoutMs?: number;
}

/** A Sheets call that failed in a way a retry might fix. */
export class GoogleSheetsHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail: string | null,
    readonly requestBody?: string,
  ) {
    super(message);
    this.name = 'GoogleSheetsHttpError';
  }
}

/**
 * A cell's text.
 *
 * Everything becomes a string, including numbers, because the row is written
 * with `valueInputOption: RAW` and Sheets decides for itself what a string
 * looks like once it is in the grid. A value that is absent and one that is an
 * empty answer both write an empty cell: a sheet has no way to show the
 * difference, and writing "null" or "undefined" into somebody's spreadsheet is
 * the kind of thing nobody notices until they sort the column.
 */
export function cellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  // A multi-select answer, or a file answer's list. Joined with ", " because a
  // cell is one line and a JSON array in a spreadsheet is unreadable.
  if (Array.isArray(value)) return value.map((v) => cellText(v)).filter(Boolean).join(', ');
  // An object answer (a file, a structured value): JSON is a poor cell but a
  // better one than "[object Object]", which tells the author nothing at all.
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

/**
 * The row for one submission, in the author's column order.
 *
 * Always exactly as long as `columns`, including trailing empties, so a sheet's
 * columns stay aligned when the last question goes unanswered. Sheets trims a
 * trailing empty cell on its own; what matters is that this never shortens the
 * row for a reason of its own.
 */
export function buildRow(columns: SheetColumn[], ctx: DestinationContext): string[] {
  return columns.map((column) => {
    switch (column.source) {
      case 'answer':
        return column.key ? cellText(ctx.data?.[column.key]) : '';
      case 'utm':
        return column.key ? cellText(ctx.utm?.[column.key]) : '';
      case 'score':
        return cellText(ctx.score);
      case 'outcome':
        return cellText(ctx.outcomeLabel);
      case 'submitted_at':
        // ISO 8601, the one format a spreadsheet, a human and a later import all
        // read the same way. Not the account's zone: a sheet has no zone, so a
        // local time in it is a number nobody can place.
        return new Date(ctx.submittedAt).toISOString();
      case 'form_name':
        return ctx.formTitle || ctx.formName;
      case 'submission_id':
        return ctx.submissionId;
      default:
        // A source stored by a newer version than this one is running. An empty
        // cell keeps every other column in its place; refusing the row would
        // lose a submission over a column nobody can see yet.
        return '';
    }
  });
}

/**
 * The A1 range the row is appended to.
 *
 * A tab name is arbitrary text, so it is quoted and its own single quotes are
 * doubled, which is how A1 escapes them. Without that a sheet called
 * `Ana's leads` makes a range Sheets reads as malformed, and the delivery fails
 * on a name the author is perfectly entitled to use. With no tab named, the
 * range is just `A1` and Sheets uses the first tab.
 */
export function appendRange(sheetTitle?: string): string {
  const title = sheetTitle?.trim();
  if (!title) return 'A1';
  return `'${title.replace(/'/g, "''")}'!A1`;
}

/** Google's error envelope, as much of it as is worth keeping. */
function errorDetail(body: unknown): string | null {
  if (typeof body === 'string') return body.slice(0, MAX_DETAIL) || null;
  if (body && typeof body === 'object') {
    const message = (body as { error?: { message?: unknown } }).error?.message;
    if (typeof message === 'string' && message) return message.slice(0, MAX_DETAIL);
    try {
      return JSON.stringify(body).slice(0, MAX_DETAIL);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * A status Google will answer the same way however many times it is asked.
 *
 * 401 is in here on purpose, even though a stale access token is the textbook
 * retryable failure: this adapter never mints its own token, it is handed a
 * fresh one per delivery, so a 401 means the GRANT is bad rather than the token
 * stale. Retrying would hammer Google with a credential it has already refused.
 */
function isPermanent(status: number): boolean {
  return status === 400 || status === 401 || status === 403 || status === 404;
}

export class GoogleSheetsDestination implements SubmissionDestination {
  readonly type = 'google-sheets' as const;

  constructor(
    private readonly options: GoogleSheetsDestinationOptions,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async deliver(ctx: DestinationContext): Promise<DestinationResult> {
    const { accessToken, spreadsheetId, sheetTitle, columns } = this.options;
    const row = buildRow(columns, ctx);
    const body = JSON.stringify({ values: [row] });

    const url = new URL(
      `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(
        appendRange(sheetTitle),
      )}:append`,
    );
    // RAW: write the text as given. The alternative, USER_ENTERED, makes Sheets
    // parse every cell as if it had been typed, which turns an answer beginning
    // with `=` into a formula. A respondent choosing what formula runs in
    // someone else's spreadsheet is not a feature.
    url.searchParams.set('valueInputOption', 'RAW');
    // Append BELOW the last row rather than overwriting whatever sits in the
    // range. Without it a second delivery can land on the first one's row.
    url.searchParams.set('insertDataOption', 'INSERT_ROWS');

    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body,
        signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_SHEETS_TIMEOUT_MS),
      });
    } catch (err) {
      // Nothing answered: a dead socket, DNS, the timeout above. Always worth
      // another try, so it travels as an error the outbox will retry.
      const message = err instanceof Error ? err.message : String(err);
      throw new GoogleSheetsHttpError(`google sheets delivery failed: ${message}`, 0, null, body);
    }

    if (!res.ok) {
      const parsed = await res.json().catch(() => null);
      const detail = errorDetail(parsed);
      if (isPermanent(res.status)) {
        // Marked done, never retried, and the history says why. This is the
        // state an author has to be able to see: the sheet they picked is gone,
        // or they took our access away, and no amount of waiting changes it.
        return {
          delivered: false,
          driver: 'google-sheets',
          detail: `HTTP ${res.status}${detail ? `: ${detail}` : ''}`,
          requestBody: body,
          responseStatus: res.status,
          responseBody: detail,
        };
      }
      throw new GoogleSheetsHttpError(
        `google sheets delivery failed: HTTP ${res.status}`,
        res.status,
        detail,
        body,
      );
    }

    const ok = (await res.json().catch(() => null)) as {
      updates?: { updatedRange?: unknown; updatedRows?: unknown };
    } | null;
    const range = typeof ok?.updates?.updatedRange === 'string' ? ok.updates.updatedRange : null;
    return {
      delivered: true,
      driver: 'google-sheets',
      detail: range ? `appended to ${range}` : 'appended',
      requestBody: body,
      responseStatus: res.status,
      responseBody: range,
    };
  }
}
