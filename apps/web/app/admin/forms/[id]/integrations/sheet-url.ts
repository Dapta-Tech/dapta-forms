/**
 * Reading a spreadsheet out of whatever the author pasted.
 *
 * Nobody has a spreadsheet id to hand. What people have is the thing in their
 * address bar, which carries a path, a `#gid=`, sometimes a `?usp=sharing` that
 * a share dialog added, and occasionally a `/edit` the author trimmed off. So
 * this takes the URL and finds the id, rather than asking for an id and leaving
 * the author to work out which part of their URL that is.
 *
 * A bare id is accepted too: it is what the API stores and what somebody
 * copying a config from elsewhere will have.
 */

/**
 * The id in a Google Sheets URL.
 *
 * Google's own ids are long base64url-ish strings, but the shape is not
 * documented as a contract, so this matches the PATH POSITION (`/d/<id>/`)
 * rather than a character pattern. A rule written against today's id format
 * fails the day Google lengthens it, and fails silently, by telling the author
 * their perfectly good link is not a spreadsheet.
 */
const URL_ID = /\/spreadsheets(?:\/u\/\d+)?\/d\/([^/?#]+)/;

/** A plausible bare id: no slashes, no spaces, long enough not to be a typo. */
const BARE_ID = /^[A-Za-z0-9_-]{20,200}$/;

export interface ParsedSheetUrl {
  spreadsheetId: string;
  /**
   * The tab the link points at (`#gid=`), when it names one. The picker uses it
   * to preselect that tab: an author who copied the URL while looking at the
   * tab they mean should not then have to find it in a list of twenty.
   */
  gid: number | null;
}

/**
 * The spreadsheet a pasted value names, or null when it names none.
 *
 * Null rather than a guess: a half-pasted URL and a link to a Google Doc both
 * land here, and storing an id read out of either would produce a destination
 * that looks configured and fails on its first delivery.
 */
export function parseSheetUrl(value: string): ParsedSheetUrl | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const fromPath = URL_ID.exec(trimmed);
  if (fromPath?.[1]) {
    return { spreadsheetId: fromPath[1], gid: gidOf(trimmed) };
  }
  // Not a spreadsheet URL. Anything else carrying a slash or a scheme is some
  // other link (a Doc, a Drive folder, a shortened URL) and must not be mined
  // for an id-shaped fragment.
  if (/[/\\:]/.test(trimmed)) return null;
  return BARE_ID.test(trimmed) ? { spreadsheetId: trimmed, gid: null } : null;
}

/** The `gid` in the fragment or the query, as a number, or null. */
function gidOf(url: string): number | null {
  const match = /[#?&]gid=(\d+)/.exec(url);
  if (!match?.[1]) return null;
  const gid = Number(match[1]);
  return Number.isSafeInteger(gid) ? gid : null;
}

/** The address of a spreadsheet, for a link back to it from the editor. */
export function sheetUrlFor(spreadsheetId: string, gid?: number | null): string {
  const base = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`;
  return gid == null ? base : `${base}#gid=${gid}`;
}
