/**
 * The page a submission was answered on (#199): where the form was embedded,
 * or its own URL on a direct link, plus the landing's HubSpot tracking cookie.
 *
 * It is reported by the browser, and when the form is embedded most of it comes
 * from a page we do not control (`public/embed.js` reads it there). So the
 * contract is TOLERANT, field by field: a value that fails its rule is dropped
 * and the rest of the submission goes on. A visit can never be the reason a
 * submission is refused, and nothing that reaches HubSpot or a webhook here has
 * skipped these rules. The web app runs the same parse before it sends.
 *
 * String-built on purpose: this package is lib ES2022 only, with no `URL`
 * global. zod's own `.url()` check is what proves a page URL parses.
 */
import { z } from 'zod';
import { isSafeHttpUrl } from '@quill/engine';

/** Longest page URL kept. HubSpot's own ceiling for `pageUri` is well above. */
export const VISIT_PAGE_URI_MAX = 2048;
/** Longest page name kept, counted in characters. */
export const VISIT_PAGE_NAME_MAX = 255;

/** HubSpot's visitor cookie, `hubspotutk`: 32 hex characters. */
const HUTK = /^[0-9a-f]{32}$/i;
/** A HubSpot page or portal id. */
const DIGITS = /^\d{1,20}$/;
/** C0 and C1 controls. Postgres refuses `\u0000` in a JSON value outright. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
/**
 * A browser always serializes its URL (percent-encoding, punycode host), so it
 * is printable ASCII and nothing else. Whitespace, a control or a lone
 * surrogate means it was not one, and the last two are JSON Postgres refuses.
 */
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;
/** Scheme, authority, and the rest (path and query). */
const HTTP_PARTS = /^(https?:\/\/)([^/?]*)(.*)$/i;

/** The visit as stored and delivered. Absent keys were not reported, or failed their rule. */
export interface SubmissionVisit {
  /** Absolute http(s) URL of the page: the landing when embedded, the form itself on a direct link. */
  pageUri?: string;
  /** The page's own title: the landing's, or the form's public title on a direct link. */
  pageName?: string;
  /** The landing's HubSpot CMS page id, on a HubSpot page. */
  pageId?: string;
  /** The landing's HubSpot visitor cookie, lowercased. Never shown in the dashboard. */
  hutk?: string;
  /** The HubSpot portal the landing's tracking code belongs to. */
  hsPortalId?: string;
  /** True when the form was answered inside a frame. */
  embedded: boolean;
}

/** Replace lone surrogates, which are not valid JSON text for Postgres. */
function wellFormed(chars: string[]): string[] {
  return chars.map((ch) => {
    const code = ch.charCodeAt(0);
    return ch.length === 1 && code >= 0xd800 && code <= 0xdfff ? '\ufffd' : ch;
  });
}

/** Does this query pair name a `utm_*` parameter? Its key may arrive encoded. */
function isUtmPair(pair: string): boolean {
  const key = pair.split('=')[0] ?? '';
  try {
    return decodeURIComponent(key.replace(/\+/g, ' ')).toLowerCase().startsWith('utm_');
  } catch {
    return false;
  }
}

/**
 * A URL that already parsed (see the schema below), as http(s), with no
 * fragment and no credentials, or undefined. One too long for the limit is cut
 * to origin, path and `utm_*` (the part that attributes the visit) before it
 * is given up on.
 */
function cleanPageUri(raw: string): string | undefined {
  if (!isSafeHttpUrl(raw) || !PRINTABLE_ASCII.test(raw)) return undefined;
  const parts = HTTP_PARTS.exec(raw.split('#')[0] ?? '');
  if (!parts) return undefined;
  const scheme = parts[1] ?? '';
  const authority = (parts[2] ?? '').slice((parts[2] ?? '').lastIndexOf('@') + 1);
  const rest = parts[3] ?? '';
  if (!authority) return undefined;
  const href = `${scheme}${authority}${rest}`;
  if (href.length <= VISIT_PAGE_URI_MAX) return href;
  const q = rest.indexOf('?');
  const path = q >= 0 ? rest.slice(0, q) : rest;
  const utm = q >= 0 ? rest.slice(q + 1).split('&').filter(isUtmPair) : [];
  const short = `${scheme}${authority}${path}${utm.length > 0 ? `?${utm.join('&')}` : ''}`;
  return short.length <= VISIT_PAGE_URI_MAX ? short : undefined;
}

/** Whitespace collapsed, controls gone, at most `VISIT_PAGE_NAME_MAX` characters; undefined when empty. */
function cleanPageName(raw: string): string | undefined {
  const text = raw.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return wellFormed(Array.from(text).slice(0, VISIT_PAGE_NAME_MAX)).join('').trim() || undefined;
}

function cleanHutk(raw: string): string | undefined {
  const s = raw.trim();
  return HUTK.test(s) ? s.toLowerCase() : undefined;
}

function cleanDigits(raw: string | number): string | undefined {
  const s = String(raw).trim();
  return DIGITS.test(s) ? s : undefined;
}

const digitsField = z.union([z.string(), z.number()]).transform(cleanDigits).optional().catch(undefined);

/**
 * Parse whatever the browser sent as `visit`. Every field is checked on its
 * own and a failure drops only that field; a value that is not an object, or
 * an object with nothing usable left, is no visit at all.
 */
export const submissionVisitSchema = z
  .object({
    pageUri: z.string().trim().url().transform(cleanPageUri).optional().catch(undefined),
    pageName: z.string().transform(cleanPageName).optional().catch(undefined),
    pageId: digitsField,
    hutk: z.string().transform(cleanHutk).optional().catch(undefined),
    hsPortalId: digitsField,
    embedded: z.boolean().optional().catch(undefined),
  })
  .transform((v): SubmissionVisit | undefined => {
    const out: SubmissionVisit = { embedded: v.embedded === true };
    if (v.pageUri) out.pageUri = v.pageUri;
    if (v.pageName) out.pageName = v.pageName;
    if (v.pageId) out.pageId = v.pageId;
    if (v.hutk) out.hutk = v.hutk;
    if (v.hsPortalId) out.hsPortalId = v.hsPortalId;
    const reported = Object.keys(out).length > 1 || v.embedded !== undefined;
    return reported ? out : undefined;
  })
  .optional()
  .catch(undefined);

/** Tolerant parse of a stored or reported visit: undefined when there is none. */
export function parseSubmissionVisit(raw: unknown): SubmissionVisit | undefined {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  return submissionVisitSchema.parse(raw);
}

/**
 * The visit as the dashboard may see it: the page, whether it was embedded, and
 * whether a HubSpot visitor was linked. The cookie itself never leaves the API.
 */
export const submissionVisitViewSchema = z.object({
  pageUri: z.string().nullable(),
  pageName: z.string().nullable(),
  embedded: z.boolean(),
  hubspotLinked: z.boolean(),
});
export type SubmissionVisitView = z.infer<typeof submissionVisitViewSchema>;

export function toSubmissionVisitView(visit: SubmissionVisit | null | undefined): SubmissionVisitView | null {
  if (!visit) return null;
  return {
    pageUri: visit.pageUri ?? null,
    pageName: visit.pageName ?? null,
    embedded: visit.embedded,
    hubspotLinked: Boolean(visit.hutk),
  };
}
