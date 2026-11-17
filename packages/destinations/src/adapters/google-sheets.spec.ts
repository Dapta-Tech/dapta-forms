/**
 * Appending a submission to a Google Sheet.
 *
 * The specs are weighted towards two things that are cheap to get wrong and
 * expensive to discover in production:
 *
 *   1. WHICH FAILURES RETRY. The port says resolve for a permanent no-op and
 *      throw for a transient one. A deleted spreadsheet thrown would retry
 *      until the outbox gave up; a quota error resolved would lose the row.
 *   2. WHAT LANDS IN A CELL. The row is written RAW, so an answer starting
 *      with `=` must stay text, and a row must keep its length when an optional
 *      question goes unanswered, or every column below it shifts.
 */
import { createDestination } from '../factory';
import { describe, expect, it, vi } from 'vitest';
import type { SheetColumn } from '@quill/types';
import type { DestinationContext } from '../destination.port';
import {
  appendRange,
  buildRow,
  cellText,
  GoogleSheetsDestination,
  GoogleSheetsHttpError,
  type GoogleSheetsDestinationOptions,
} from './google-sheets';

const COLUMNS: SheetColumn[] = [
  { header: 'Submitted', source: 'submitted_at' },
  { header: 'Email', source: 'answer', key: 'email' },
  { header: 'Company', source: 'answer', key: 'company' },
  { header: 'Score', source: 'score' },
  { header: 'Source', source: 'utm', key: 'utm_source' },
];

const ctx = (over: Partial<DestinationContext> = {}): DestinationContext => ({
  idempotencyKey: 'submission:s1:complete:google-sheets:0',
  submissionId: 's1',
  formId: 'f1',
  formName: 'Lead qualifier',
  accountId: 'a1',
  sessionId: 'sess1',
  score: 42,
  outcomeLabel: 'Qualified',
  phase: 'complete',
  submittedAt: Date.UTC(2026, 10, 16, 9, 30),
  data: { email: 'sam@example.com', company: 'Example Co' },
  utm: { utm_source: 'google' },
  ...over,
});

const options = (over: Partial<GoogleSheetsDestinationOptions> = {}): GoogleSheetsDestinationOptions => ({
  accessToken: 'ya29.token',
  spreadsheetId: 'sheet-1',
  sheetTitle: 'Responses',
  columns: COLUMNS,
  ...over,
});

/** A Sheets answer, as the API shapes it. */
function answers(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

const OK = { updates: { updatedRange: "'Responses'!A7:E7", updatedRows: 1 } };

const callOf = (f: typeof fetch) =>
  (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;

describe('cellText', () => {
  it('writes an absent value as an empty cell, never as "null"', () => {
    expect(cellText(null)).toBe('');
    expect(cellText(undefined)).toBe('');
  });

  it('joins a multi-select into one readable cell', () => {
    expect(cellText(['Email', 'Phone'])).toBe('Email, Phone');
  });

  it('keeps numbers and booleans readable', () => {
    expect(cellText(7)).toBe('7');
    expect(cellText(0)).toBe('0');
    expect(cellText(true)).toBe('TRUE');
    expect(cellText(Number.NaN)).toBe('');
  });

  it('falls back to JSON for an object rather than [object Object]', () => {
    expect(cellText({ name: 'cv.pdf' })).toBe('{"name":"cv.pdf"}');
  });
});

describe('buildRow', () => {
  it('fills every source in the author’s order', () => {
    expect(buildRow(COLUMNS, ctx())).toEqual([
      '2026-11-16T09:30:00.000Z',
      'sam@example.com',
      'Example Co',
      '42',
      'google',
    ]);
  });

  it('keeps the row’s length when an optional answer is missing', () => {
    // The whole point: a short row would shift every column to its left.
    const row = buildRow(COLUMNS, ctx({ data: { email: 'sam@example.com' } }));
    expect(row).toHaveLength(COLUMNS.length);
    expect(row[2]).toBe('');
  });

  it('writes an empty cell for a source a newer version added', () => {
    const row = buildRow(
      [{ header: 'Later', source: 'something_new' as SheetColumn['source'] }],
      ctx(),
    );
    expect(row).toEqual(['']);
  });

  it('prefers the public title for the form name, and falls back to the internal one', () => {
    const col: SheetColumn[] = [{ header: 'Form', source: 'form_name' }];
    expect(buildRow(col, ctx({ formTitle: 'Get a quote' }))).toEqual(['Get a quote']);
    expect(buildRow(col, ctx())).toEqual(['Lead qualifier']);
  });
});

describe('appendRange', () => {
  it('quotes the tab name', () => {
    expect(appendRange('Responses')).toBe("'Responses'!A1");
  });

  it('doubles a quote inside the name, so a real tab name cannot break the range', () => {
    expect(appendRange("Ana's leads")).toBe("'Ana''s leads'!A1");
  });

  it('writes to the first tab when none is named', () => {
    expect(appendRange()).toBe('A1');
    expect(appendRange('   ')).toBe('A1');
  });
});

describe('a delivery', () => {
  it('appends one row and reports where it landed', async () => {
    const fetchImpl = answers(200, OK);
    const res = await new GoogleSheetsDestination(options(), fetchImpl).deliver(ctx());
    expect(res.delivered).toBe(true);
    expect(res.driver).toBe('google-sheets');
    expect(res.detail).toContain("'Responses'!A7:E7");
  });

  it('makes exactly one API call, because quota is the scarce thing', async () => {
    const fetchImpl = answers(200, OK);
    await new GoogleSheetsDestination(options(), fetchImpl).deliver(ctx());
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });

  it('writes RAW and inserts rows, so an answer cannot become a formula', async () => {
    const fetchImpl = answers(200, OK);
    await new GoogleSheetsDestination(options(), fetchImpl).deliver(
      ctx({ data: { email: '=IMPORTRANGE("evil")' } }),
    );
    const [url, init] = callOf(fetchImpl);
    const parsed = new URL(url);
    expect(parsed.searchParams.get('valueInputOption')).toBe('RAW');
    expect(parsed.searchParams.get('insertDataOption')).toBe('INSERT_ROWS');
    // The text travels verbatim; RAW is what stops Sheets evaluating it.
    expect(String(init.body)).toContain('=IMPORTRANGE(\\"evil\\")');
  });

  it('carries the access token as a bearer, and never in the URL', async () => {
    const fetchImpl = answers(200, OK);
    await new GoogleSheetsDestination(options(), fetchImpl).deliver(ctx());
    const [url, init] = callOf(fetchImpl);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer ya29.token');
    expect(url).not.toContain('ya29.token');
  });
});

describe('which columns a delivered row holds', () => {
  // The one rule (`isWritableSheetColumn`): a column with a heading is in the
  // sheet, one without is not. A complete, B heading with no answer yet,
  // C complete, D no heading, E complete: row 1 is A, B, C, E, and so is
  // every delivered row, with an empty cell under B.
  it('writes A, B (empty), C, E and skips D, in the same letters as row 1', async () => {
    const fetchImpl = answers(200, OK);
    await new GoogleSheetsDestination(
      options({
        columns: [
          { header: 'A', source: 'answer', key: 'email' },
          { header: 'B', source: 'answer' },
          { header: 'C', source: 'score' },
          { header: '', source: 'answer', key: 'company' },
          { header: 'E', source: 'utm', key: 'utm_source' },
        ],
      }),
      fetchImpl,
    ).deliver(ctx());
    const body = JSON.parse(String(callOf(fetchImpl)[1].body)) as { values: string[][] };
    expect(body.values).toEqual([['sam@example.com', '', '42', 'google']]);
  });

  // The author is renaming column B and has cleared its heading: dForms
  // wrote "B" to row 1 before, so the position is held with an empty cell and
  // C stays under C. It used to be dropped, and C landed under B.
  it('keeps an empty cell where a column with a cleared heading still holds its place', async () => {
    const fetchImpl = answers(200, OK);
    await new GoogleSheetsDestination(
      options({
        columns: [
          { header: 'A', source: 'answer', key: 'email' },
          { header: '', source: 'answer', key: 'company' },
          { header: 'C', source: 'score' },
        ],
        writtenHeaders: ['A', 'B', 'C'],
      }),
      fetchImpl,
    ).deliver(ctx());
    const body = JSON.parse(String(callOf(fetchImpl)[1].body)) as { values: string[][] };
    expect(body.values).toEqual([['sam@example.com', '', '42']]);
  });

  it('still leaves out a column that never had a heading, with a row 1 recorded', async () => {
    const fetchImpl = answers(200, OK);
    await new GoogleSheetsDestination(
      options({
        columns: [
          { header: 'A', source: 'answer', key: 'email' },
          { header: 'C', source: 'score' },
          { header: '', source: 'answer', key: 'company' },
        ],
        writtenHeaders: ['A', 'C'],
      }),
      fetchImpl,
    ).deliver(ctx());
    const body = JSON.parse(String(callOf(fetchImpl)[1].body)) as { values: string[][] };
    expect(body.values).toEqual([['sam@example.com', '42']]);
  });

  it('is not built at all when no column has a heading', () => {
    const d = createDestination(
      { type: 'google-sheets', googleSheets: options({ columns: [{ header: '', source: 'score' }] }) },
      answers(200, OK),
    );
    expect(d.type).not.toBe('google-sheets');
  });
});

describe('a failure the author has to fix', () => {
  // Each of these is permanent: the delivery is marked done with a reason,
  // never retried. Retrying any of them is how an integration spends a week
  // asking Google the same refused question.
  for (const [status, what] of [
    [400, 'a malformed range'],
    [401, 'a grant Google will not honour'],
    [403, 'access revoked or never granted'],
    [404, 'a spreadsheet that is gone'],
  ] as const) {
    it(`reports ${what} (HTTP ${status}) as a no-op, not an error`, async () => {
      const fetchImpl = answers(status, { error: { message: 'Requested entity was not found.' } });
      const res = await new GoogleSheetsDestination(options(), fetchImpl).deliver(ctx());
      expect(res.delivered).toBe(false);
      expect(res.responseStatus).toBe(status);
      expect(res.detail).toContain(String(status));
      expect(res.detail).toContain('Requested entity was not found.');
    });
  }

  it('keeps the request body on a no-op, so the history can show what was sent', async () => {
    const fetchImpl = answers(404, { error: { message: 'gone' } });
    const res = await new GoogleSheetsDestination(options(), fetchImpl).deliver(ctx());
    expect(res.requestBody).toContain('sam@example.com');
  });
});

describe('a failure worth another try', () => {
  it('throws on a quota error, which is the one that must retry', async () => {
    const fetchImpl = answers(429, { error: { message: 'Quota exceeded' } });
    await expect(
      new GoogleSheetsDestination(options(), fetchImpl).deliver(ctx()),
    ).rejects.toBeInstanceOf(GoogleSheetsHttpError);
  });

  it('throws on a 5xx', async () => {
    const fetchImpl = answers(503, { error: { message: 'backend error' } });
    await expect(new GoogleSheetsDestination(options(), fetchImpl).deliver(ctx())).rejects.toThrow(
      /HTTP 503/,
    );
  });

  it('throws when nothing answered, and carries the body it tried to send', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    const err = await new GoogleSheetsDestination(options(), fetchImpl)
      .deliver(ctx())
      .catch((e: unknown) => e as GoogleSheetsHttpError);
    expect(err).toBeInstanceOf(GoogleSheetsHttpError);
    expect(err.status).toBe(0);
    expect(err.requestBody).toContain('sam@example.com');
  });
});
