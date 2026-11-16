/**
 * The two Google Sheets calls the ADMIN makes, as opposed to the one a delivery
 * makes.
 *
 * They live here, away from the adapter, because they are a different kind of
 * work with a different budget. A delivery runs per respondent and spends the
 * account's write quota, so it is one call and never reads. These run when an
 * author is sitting in front of the Connect tab choosing a spreadsheet: they
 * can read, they can take a second, and they happen once.
 *
 * Both take an access token rather than minting one, so they are testable
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
 * 404 and 403 are deliberately kept apart: "no such spreadsheet" and "that one
 * exists but this Google account cannot open it" send an author to two
 * completely different places, and collapsing them into "it did not work" is
 * how a support thread starts.
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
