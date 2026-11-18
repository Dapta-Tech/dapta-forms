/**
 * The HighLevel (GoHighLevel, GHL) connection on the API side: what is stored,
 * how a pasted token and Location ID are proved before they are, and how a
 * delivery reads them back.
 *
 * WHY A PRIVATE INTEGRATION TOKEN. A sub-account's Private Integration is a
 * static `pit-` token with the scopes the admin ticked: nothing to mint, no
 * Marketplace app on Dapta's side. It is stored with the Location ID it was
 * proved against, as one encrypted JSON string under the `gohighlevel`
 * provider, because a token alone does not say which sub-account to write to.
 *
 * WHAT CONNECTING PROVES. One call per scope the destination needs, each
 * answered by GHL the way the sandbox showed (see the spec's findings):
 *
 *   locations.readonly                 GET  /locations/{id}           (and the name for the card)
 *   locations/customFields.readonly    GET  /locations/{id}/customFields?model=contact
 *   contacts.write                     POST /contacts/upsert {locationId}
 *
 * The upsert carries no email and no phone, so GHL answers 400 "Pass at least
 * one of number, email" and creates nothing; it checks the scope before the
 * body, so that 400 is the proof the token may write. A missing scope is a 401
 * whose text names the scope, which is how it is told apart from a bad token.
 *
 * WHY THE USER-AGENT. Cloudflare in front of GHL answers 403 (`error_code`
 * 1010) to the default agents of common HTTP clients. That 403 says nothing
 * about the token, so it is `unreachable` here and never marks a token
 * rejected.
 */
import { createHash } from 'node:crypto';
import { decryptToken, getIntegration, type Db } from '@quill/db';
// The adapter's own base, version and agent: the probe must be sent exactly
// as a delivery is, or Cloudflare could pass one and block the other.
import { GOHIGHLEVEL_API_BASE, goHighLevelHeaders } from '@quill/destinations';
import {
  GOHIGHLEVEL_TOKEN_PREFIX,
  type GoHighLevelConnectRejection,
  type GoHighLevelCredentials,
} from '@quill/types';

/**
 * Give up on one probe call. Connecting runs the location read, then the
 * other two scope checks side by side, so the whole proof stays inside the
 * fifteen seconds a browser gives a server action. GHL answers in under a
 * second (sandbox: 300 to 700 ms).
 */
const PROBE_TIMEOUT_MS = 5_000;

/** A Location ID as GHL issues them: letters and digits (20 in practice). */
const LOCATION_ID = /^[A-Za-z0-9]{8,64}$/;

/**
 * The Location ID from what the admin pasted: the ID itself, or any URL of the
 * sub-account (`https://app.gohighlevel.com/v2/location/{id}/dashboard`, or a
 * white-label host), from which the segment after `/location/` is taken. Null
 * when neither yields an ID.
 */
export function extractGoHighLevelLocationId(raw: string): string | null {
  const text = raw.trim();
  if (LOCATION_ID.test(text)) return text;
  const match = /(?:^|\/)location\/([^/?#\s]+)/i.exec(text);
  const id = match?.[1];
  return id && LOCATION_ID.test(id) ? id : null;
}

/**
 * Whether a pasted token has the shape of a Private Integration token: the
 * prefix, then visible ASCII only. Anything else (a space, a line break, a
 * smart quote from a document) could not even be sent as a header.
 */
export function isGoHighLevelToken(token: string): boolean {
  return token.startsWith(GOHIGHLEVEL_TOKEN_PREFIX) && /^pit-[\x21-\x7e]+$/.test(token);
}

/** The tail shown on the card: the token's. */
export function goHighLevelLast4(token: string): string {
  return token.slice(-4);
}

/** The stored JSON, or null for a row that does not hold one. */
export function parseGoHighLevelCredentials(stored: string | null): GoHighLevelCredentials | null {
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as Partial<GoHighLevelCredentials>;
    const token = typeof parsed.token === 'string' ? parsed.token.trim() : '';
    const locationId = typeof parsed.locationId === 'string' ? parsed.locationId.trim() : '';
    if (!isGoHighLevelToken(token) || !LOCATION_ID.test(locationId)) return null;
    return { token, locationId };
  } catch {
    return null;
  }
}

export interface GoHighLevelConnection {
  credentials: GoHighLevelCredentials;
  /** The stored ciphertext the credentials came from: what a rejection mark is guarded by. */
  encryptedToken: string;
}

/**
 * The account's stored connection, decrypted and parsed, or null (not
 * connected, no key, a row the key cannot open). No env fallback: HighLevel
 * is connected per workspace or not at all.
 */
export async function readGoHighLevelConnection(
  db: Db,
  accountId: string,
  encryptionKey: string | undefined,
): Promise<GoHighLevelConnection | null> {
  if (!encryptionKey) return null;
  const row = await getIntegration(db, accountId, 'gohighlevel');
  if (!row) return null;
  let stored: string;
  try {
    stored = decryptToken(row.encryptedToken, encryptionKey);
  } catch {
    return null;
  }
  const credentials = parseGoHighLevelCredentials(stored);
  return credentials ? { credentials, encryptedToken: row.encryptedToken } : null;
}

/** Which stored connection something was read with, without keeping the token beside it. */
export function goHighLevelFingerprint(creds: GoHighLevelCredentials): string {
  return createHash('sha256').update(`${creds.token}\n${creds.locationId}`).digest('hex');
}

// --- Classifying GHL's answers -----------------------------------------------

interface GhlErrorBody {
  message?: unknown;
  error?: unknown;
  cloudflare_error?: unknown;
  error_code?: unknown;
}

/** How one GHL answer reads, for the connect probe and the fields list alike. */
export type GoHighLevelAnswer =
  | { kind: 'ok' }
  | { kind: 'refused'; reason: Exclude<GoHighLevelConnectRejection, 'token_format' | 'unreachable'> }
  | { kind: 'unreachable'; cause: string };

function messageText(body: GhlErrorBody | null): string {
  const m = body?.message;
  if (typeof m === 'string') return m;
  if (Array.isArray(m)) return m.filter((x) => typeof x === 'string').join('; ');
  return '';
}

/**
 * Read a non-2xx answer the way the sandbox showed GHL means it. A 403 is
 * GHL's "no access to this location" only when GHL itself wrote it: JSON
 * without Cloudflare's markers. Cloudflare's 1010 (or any 403 that is not
 * JSON) is a block in front of GHL and says nothing about the token.
 */
export function classifyGoHighLevelError(status: number, body: GhlErrorBody | null): GoHighLevelAnswer {
  if (status === 401) {
    return {
      kind: 'refused',
      reason: /not authorized for this scope/i.test(messageText(body)) ? 'missing_scope' : 'invalid_token',
    };
  }
  if (status === 403) {
    if (!body || body.cloudflare_error === true || body.error_code !== undefined) {
      return { kind: 'unreachable', cause: body?.error_code !== undefined ? `CLOUDFLARE_${String(body.error_code).replace(/\D/g, '')}` : 'HTTP_403' };
    }
    return { kind: 'refused', reason: 'wrong_location' };
  }
  if (status === 429 || status >= 500) return { kind: 'unreachable', cause: `HTTP_${status}` };
  // A 400, 404 or 422 on a location route: the ID names no location this
  // token can read. The token itself was accepted (a bad one is a 401).
  return { kind: 'refused', reason: 'wrong_location' };
}

async function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

/**
 * The network code a call died with (`ENOTFOUND`, `ECONNRESET`, `TimeoutError`).
 * Never a message, which can carry the URL.
 */
export function goHighLevelNetworkCause(err: unknown): string {
  const e = err as { cause?: { code?: unknown; name?: unknown }; code?: unknown; name?: unknown } | null;
  for (const c of [e?.cause?.code, e?.code, e?.cause?.name, e?.name]) {
    if (typeof c === 'string' && /^(?:[A-Z][A-Z0-9_]{1,39}|TimeoutError|AbortError)$/.test(c)) {
      return c === 'TimeoutError' || c === 'AbortError' ? 'timeout' : c;
    }
  }
  return 'network';
}

async function call(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ res: Response; body: unknown } | { failed: string }> {
  try {
    const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    return { res, body: await readJson(res) };
  } catch (err) {
    return { failed: goHighLevelNetworkCause(err) };
  }
}

export type GoHighLevelProbeResult =
  | { ok: true; locationName: string | null }
  | { ok: false; reason: Exclude<GoHighLevelConnectRejection, 'token_format'>; cause?: string };

/**
 * Prove the token against the location, one call per scope (see the header).
 * Resolves for every outcome; never throws, never returns GHL's own text.
 */
export async function probeGoHighLevel(
  creds: GoHighLevelCredentials,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<GoHighLevelProbeResult> {
  const headers = goHighLevelHeaders(creds.token);
  const loc = encodeURIComponent(creds.locationId);
  const settle = (r: { res: Response; body: unknown } | { failed: string }, okStatus?: (s: number) => boolean) => {
    if ('failed' in r) return { ok: false as const, reason: 'unreachable' as const, cause: r.failed };
    if (r.res.ok || okStatus?.(r.res.status)) return null;
    const answer = classifyGoHighLevelError(r.res.status, r.body as GhlErrorBody | null);
    if (answer.kind === 'unreachable') return { ok: false as const, reason: 'unreachable' as const, cause: answer.cause };
    if (answer.kind === 'refused') return { ok: false as const, reason: answer.reason };
    return null;
  };

  const location = await call(fetchImpl, `${GOHIGHLEVEL_API_BASE}/locations/${loc}`, { headers }, timeoutMs);
  const locationRefusal = settle(location);
  if (locationRefusal) return locationRefusal;

  const [fields, upsert] = await Promise.all([
    call(fetchImpl, `${GOHIGHLEVEL_API_BASE}/locations/${loc}/customFields?model=contact`, { headers }, timeoutMs),
    call(
      fetchImpl,
      `${GOHIGHLEVEL_API_BASE}/contacts/upsert`,
      { method: 'POST', headers, body: JSON.stringify({ locationId: creds.locationId }) },
      timeoutMs,
    ),
  ]);
  const fieldsRefusal = settle(fields);
  if (fieldsRefusal) return fieldsRefusal;
  // 400 and 422 are the body check, which GHL runs only once the scope passed.
  const upsertRefusal = settle(upsert, (s) => s === 400 || s === 422);
  if (upsertRefusal) {
    // On the upsert a 400-class answer is the proof; a 404 there is not a
    // location problem but a GHL that moved the route, which no admin can fix.
    return upsertRefusal.reason === 'wrong_location' && 'res' in upsert && upsert.res.status !== 403
      ? { ok: false, reason: 'unreachable', cause: `HTTP_${upsert.res.status}` }
      : upsertRefusal;
  }

  const body = 'res' in location ? (location.body as { location?: { name?: unknown } } | null) : null;
  const name = body?.location?.name;
  return { ok: true, locationName: typeof name === 'string' && name.trim() ? name.trim().slice(0, 120) : null };
}
