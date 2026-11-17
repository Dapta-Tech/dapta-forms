/**
 * The Google Sheets calls the ADMIN makes, as opposed to the one a delivery
 * makes.
 *
 * They live here, away from the adapter, because they are a different kind of
 * work with a different budget. A delivery runs per respondent and spends the
 * account's write quota, so it is one call and never reads. These run when an
 * author is sitting in front of the Connect tab choosing a spreadsheet: they
 * can read, they can take a second, and they happen once.
 *
 * All take an access token rather than minting one, so they are testable
 * without a database and cannot accidentally become a second token cache.
 */
import { SHEETS_API_BASE } from '@quill/destinations';

/** Give up on an admin-side Sheets call rather than hanging the Connect tab. */
export const SHEETS_ADMIN_TIMEOUT_MS = 10_000;

/** One tab of a spreadsheet, as the tab picker needs it. */
export interface SheetTabDto {
  title: string;
  /**
   * The tab's own id, the `#gid=` in a spreadsheet URL. Carried so that pasting
   * a link to a particular tab can preselect that tab instead of making the
   * author find it again in a list that may hold dozens.
   */
  gid: number;
}

/** What the picker gets back: the document's name and its tabs, or why not. */
export type SheetTabsResult =
  | { ok: true; spreadsheetTitle: string; tabs: SheetTabDto[] }
  | { ok: false; reason: 'not_found' | 'forbidden' | 'unavailable' };

interface SpreadsheetMeta {
  properties?: { title?: unknown };
  sheets?: Array<{ properties?: { title?: unknown; sheetId?: unknown } }>;
}

/**
 * Map Google's status onto something the author can act on.
 *
 * 404 and 403 are deliberately kept apart, because they send an author to two
 * different places. Under the `drive.file` scope a 404 is what Google answers
 * for any spreadsheet this app was never handed, whether or not it exists: the
 * fix is to choose it again in the Picker. A 403 means the grant itself is
 * gone, and the fix is to reconnect Google.
 */
function reasonFor(status: number): 'not_found' | 'forbidden' | 'unavailable' {
  if (status === 404) return 'not_found';
  if (status === 403 || status === 401) return 'forbidden';
  return 'unavailable';
}

/**
 * The spreadsheet's tabs.
 *
 * `fields` is not an optimisation here, it is the point: without it Google
 * returns the entire document, cell data included, which for a sheet with a
 * year of submissions in it is megabytes travelling so a dropdown can show
 * three names.
 */
export async function listSheetTabs(
  accessToken: string,
  spreadsheetId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SheetTabsResult> {
  const url = new URL(`${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}`);
  url.searchParams.set('fields', 'properties.title,sheets.properties(title,sheetId)');
  let res: Response;
  try {
    res = await fetchImpl(url.toString(), {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(SHEETS_ADMIN_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  if (!res.ok) return { ok: false, reason: reasonFor(res.status) };

  const body = (await res.json().catch(() => null)) as SpreadsheetMeta | null;
  const tabs: SheetTabDto[] = [];
  for (const sheet of body?.sheets ?? []) {
    const title = sheet?.properties?.title;
    const gid = sheet?.properties?.sheetId;
    if (typeof title === 'string' && title && typeof gid === 'number') tabs.push({ title, gid });
  }
  const spreadsheetTitle =
    typeof body?.properties?.title === 'string' ? body.properties.title : '';
  return { ok: true, spreadsheetTitle, tabs };
}

/** A spreadsheet this app just created, or why it could not. */
export type CreateSpreadsheetResult =
  | { ok: true; spreadsheetId: string; spreadsheetTitle: string; sheetTitle: string; gid: number }
  | { ok: false; reason: 'forbidden' | 'unavailable' };

/**
 * Create a spreadsheet in the connected Google account, with its header row
 * already in place.
 *
 * This is the path that needs nothing beyond the consent already given: a file
 * this app creates is, by definition, a file its `drive.file` scope reaches.
 *
 * ONE call. The tab is named and row 1 is written in the create request itself
 * rather than in a follow-up write, so a failure between two calls cannot leave
 * an untitled, headerless spreadsheet behind in somebody's Drive.
 *
 * The tab gets an explicit name because Google's default follows the account's
 * language ("Sheet1", "Hoja 1"), and the delivery addresses the tab by name.
 * Headers go in as `stringValue`, the create-time twin of `RAW`: a heading that
 * begins with `=` is a heading, not a formula.
 */
export async function createSpreadsheet(
  accessToken: string,
  input: { title: string; sheetTitle: string; headers: string[] },
  fetchImpl: typeof fetch = fetch,
): Promise<CreateSpreadsheetResult> {
  const sheet: Record<string, unknown> = { properties: { title: input.sheetTitle } };
  if (input.headers.length > 0) {
    sheet.data = [
      {
        startRow: 0,
        startColumn: 0,
        rowData: [
          { values: input.headers.map((h) => ({ userEnteredValue: { stringValue: h } })) },
        ],
      },
    ];
  }
  const url = new URL(SHEETS_API_BASE);
  url.searchParams.set('fields', 'spreadsheetId,properties.title,sheets.properties(title,sheetId)');
  let res: Response;
  try {
    res = await fetchImpl(url.toString(), {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ properties: { title: input.title }, sheets: [sheet] }),
      signal: AbortSignal.timeout(SHEETS_ADMIN_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  if (!res.ok) {
    return { ok: false, reason: res.status === 401 || res.status === 403 ? 'forbidden' : 'unavailable' };
  }
  const body = (await res.json().catch(() => null)) as
    | (SpreadsheetMeta & { spreadsheetId?: unknown })
    | null;
  const spreadsheetId = body?.spreadsheetId;
  if (typeof spreadsheetId !== 'string' || !spreadsheetId) return { ok: false, reason: 'unavailable' };
  const first = body?.sheets?.[0]?.properties;
  return {
    ok: true,
    spreadsheetId,
    spreadsheetTitle:
      typeof body?.properties?.title === 'string' ? body.properties.title : input.title,
    sheetTitle: typeof first?.title === 'string' && first.title ? first.title : input.sheetTitle,
    gid: typeof first?.sheetId === 'number' ? first.sheetId : 0,
  };
}

/** What writing the header row did, or why it did nothing. */
export type HeaderRowResult =
  | { ok: true; written: true }
  /** Row 1 already holds something. Never overwritten: it is somebody's data. */
  | { ok: true; written: false; reason: 'not_empty' }
  | { ok: false; reason: 'not_found' | 'forbidden' | 'unavailable' };

/** The A1 range for row 1 of a tab, quoted the way `appendRange` quotes names. */
function headerRange(sheetTitle: string | undefined, lastColumn: string): string {
  const title = sheetTitle?.trim();
  const span = `A1:${lastColumn}1`;
  if (!title) return span;
  return `'${title.replace(/'/g, "''")}'!${span}`;
}

/**
 * The A1 letter of the nth column (1 -> A, 26 -> Z, 27 -> AA).
 *
 * Spelled out rather than assuming fewer than 26 columns: a form with 30
 * questions is ordinary, and a range of `A1:AD1` written as `A1:}1` is the kind
 * of bug that only shows up on somebody else's long form.
 */
export function columnLetter(n: number): string {
  let out = '';
  let remaining = Math.max(1, Math.floor(n));
  while (remaining > 0) {
    const rem = (remaining - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return out;
}

/**
 * Write the header row, ONCE, and only into an empty row 1.
 *
 * Two calls, which is why this is not in the delivery path: read row 1, and
 * write it only if there is nothing there. The read is the whole safety
 * property. An author pointing dForms at a spreadsheet that already holds a
 * year of data would otherwise have its first row of real submissions replaced
 * by column titles, and nothing in a spreadsheet says "this used to be data".
 */
export async function writeHeaderRow(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string | undefined,
  headers: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<HeaderRowResult> {
  if (headers.length === 0) return { ok: true, written: false, reason: 'not_empty' };
  const range = headerRange(sheetTitle, columnLetter(headers.length));
  const base = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;

  let read: Response;
  try {
    read = await fetchImpl(base, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(SHEETS_ADMIN_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  if (!read.ok) return { ok: false, reason: reasonFor(read.status) };

  const current = (await read.json().catch(() => null)) as { values?: unknown } | null;
  const row = Array.isArray(current?.values) ? (current.values[0] as unknown[] | undefined) : undefined;
  // A row of empty strings counts as empty: Sheets reports a row that was typed
  // into and cleared that way, and refusing there would tell an author their
  // visibly blank sheet is not blank.
  const occupied = (row ?? []).some((cell) => String(cell ?? '').trim() !== '');
  if (occupied) return { ok: true, written: false, reason: 'not_empty' };

  const write = new URL(base);
  // RAW for the same reason the delivery uses it: a header an author typed
  // starting with `=` is a column title, not a formula.
  write.searchParams.set('valueInputOption', 'RAW');
  let res: Response;
  try {
    res = await fetchImpl(write.toString(), {
      method: 'PUT',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ values: [headers] }),
      signal: AbortSignal.timeout(SHEETS_ADMIN_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  if (!res.ok) return { ok: false, reason: reasonFor(res.status) };
  return { ok: true, written: true };
}

/** What keeping the header row in line with the columns did, or why not. */
export type HeaderSyncResult =
  /** Row 1 now reads exactly `headers` (it was written, or already did). */
  | { ok: true; outcome: 'written' | 'unchanged' }
  /**
   * Row 1 holds something dForms did not write. Left exactly as it was: it may
   * be a customer's own heading or their first row of data, and a spreadsheet
   * does not remember what used to be in a cell.
   */
  | { ok: true; outcome: 'foreign' }
  | { ok: false; reason: 'not_found' | 'forbidden' | 'unavailable' };

const cellText = (cell: unknown): string => String(cell ?? '').trim();

/**
 * Whether row 1 is dForms' own: every non-empty cell equals the header a
 * dForms header list puts at that same position.
 *
 * Position by position, never "the same set of names": a sheet whose author
 * moved a column by hand, or typed a heading of their own after ours, holds a
 * cell that no list of ours has at that place, and that cell is theirs. Empty
 * cells say nothing either way, so a row that is a prefix of the list (a sheet
 * created with fewer columns) is still ours, and an empty row is everyone's.
 */
export function ownsHeaderRow(row: unknown[], candidate: string[]): boolean {
  return row.every((cell, i) => {
    const text = cellText(cell);
    return text === '' || text === (candidate[i] ?? '').trim();
  });
}

/** The A1 range for the whole of row 1, quoted the way `headerRange` quotes. */
function wholeRowRange(sheetTitle: string | undefined): string {
  const title = sheetTitle?.trim();
  return title ? `'${title.replace(/'/g, "''")}'!1:1` : '1:1';
}

/**
 * Make row 1 read `headers`, if and only if row 1 is dForms' to change.
 *
 * Row 1 may be rewritten when it is empty, or when every non-empty cell of it
 * matches one of the `owned` lists (the headers dForms last wrote there, or
 * what the destination's columns said before this edit). `headers` itself
 * always counts as owned, which is safe by construction: matching it means
 * every occupied cell already holds the value it is about to be given, so the
 * write only ever fills empty cells.
 *
 * Anything else in row 1 is somebody's, and this returns `foreign` without
 * writing. That is the safety property the old empty-only writer had, kept:
 * the overwrite is extended only to content dForms can prove it put there.
 *
 * The WHOLE of row 1 is read, not just as many cells as there are headers,
 * because a heading the author typed one column past ours is exactly what a
 * narrower read would miss and a wider write would destroy. The write spans
 * whichever is longer, the new headers or the old row, padding with blanks,
 * so removing a column clears its old heading instead of leaving it behind.
 */
export async function syncHeaderRow(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string | undefined,
  headers: string[],
  owned: string[][],
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = SHEETS_ADMIN_TIMEOUT_MS,
): Promise<HeaderSyncResult> {
  const wanted = headers.map((h) => h.trim());
  if (wanted.length === 0) return { ok: true, outcome: 'unchanged' };
  const valuesBase = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/`;

  let read: Response;
  try {
    read = await fetchImpl(valuesBase + encodeURIComponent(wholeRowRange(sheetTitle)), {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  if (!read.ok) return { ok: false, reason: reasonFor(read.status) };

  const current = (await read.json().catch(() => null)) as { values?: unknown } | null;
  const first = Array.isArray(current?.values) ? current.values[0] : undefined;
  const row: unknown[] = Array.isArray(first) ? first : [];
  // Trailing blanks are not content: Sheets trims them on its own, and a row
  // typed into and cleared can still come back with a few.
  let used = row.length;
  while (used > 0 && cellText(row[used - 1]) === '') used -= 1;

  const matches = used === wanted.length && wanted.every((h, i) => cellText(row[i]) === h);
  if (matches) return { ok: true, outcome: 'unchanged' };

  const ours = [wanted, ...owned].some((candidate) => ownsHeaderRow(row.slice(0, used), candidate));
  if (!ours) return { ok: true, outcome: 'foreign' };

  const width = Math.max(wanted.length, used);
  const values = Array.from({ length: width }, (_, i) => wanted[i] ?? '');
  const write = new URL(valuesBase + encodeURIComponent(headerRange(sheetTitle, columnLetter(width))));
  // RAW, like every other write here: a heading that begins with `=` is text.
  write.searchParams.set('valueInputOption', 'RAW');
  let res: Response;
  try {
    res = await fetchImpl(write.toString(), {
      method: 'PUT',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ values: [values] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  if (!res.ok) return { ok: false, reason: reasonFor(res.status) };
  return { ok: true, outcome: 'written' };
}
