/**
 * Permanent, login-free links to one uploaded file, for the webhook payload.
 *
 * A webhook receiver gets a file answer as `{ key, name, size, mime }`, and the
 * key points into a private bucket it can never read. The admin route that can
 * read it needs a dashboard session and hands out a URL that dies in minutes,
 * which is useless to a CRM or a spreadsheet that stores the payload and opens
 * the file a week later. So every file answer in the payload also carries a
 * `url` on the public web host that resolves, at click time, to a fresh
 * short-lived signed GET.
 *
 * The link is a bearer token and nothing else: there is no table behind it and
 * no expiry in it. It works until the submission is deleted (the lookup finds
 * nothing) or the signing key changes (every link ever minted stops verifying
 * at once). That is the revocation story, and it is deliberate.
 *
 * Token format, version 1:
 *
 *     v1.<payload>.<signature>
 *
 *   payload   base64url of the UTF-8 string `${submissionId}\n${stepKey}`
 *   signature base64url of HMAC-SHA256(key, "v1.<payload>")
 *
 * The version label is inside the signed bytes, so a later format can never be
 * fed a v1 signature, and a newline cannot appear in either field (a step key
 * is a short identifier, a submission id a UUID), so the split is unambiguous.
 *
 * The key is never configured as such. It is derived with HKDF from
 * `FILE_LINK_SECRET` when a deployment sets one, else from the
 * `FORMS_ENCRYPTION_KEY` every hosted deployment already has, under a label of
 * its own so the derived key is useless for anything else. With neither, the
 * feature is off: no `url` in the payload, and the resolve route answers 404.
 */
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import type { ServerEnv } from '@quill/config/env';
import { parseFileAnswer } from '@quill/engine';

/** The format label, first segment of every token. */
export const FILE_LINK_VERSION = 'v1';

/** HKDF `info`: binds the derived key to this one use. */
export const FILE_LINK_KEY_LABEL = 'dforms-file-link-v1';

/**
 * Longest token either side will touch. A real one is under 200 characters (a
 * 36-character id and a step key of at most 64); anything past this is refused
 * before a byte of it is decoded or hashed.
 */
export const FILE_LINK_MAX_TOKEN_LENGTH = 512;

/** The path segment on the web host. Reserved as an account code for this reason. */
export const FILE_LINK_PATH_SEGMENT = 'file';

const B64URL_RE = /^[A-Za-z0-9_-]+$/;

type FileLinkEnv = Partial<Pick<ServerEnv, 'FILE_LINK_SECRET' | 'FORMS_ENCRYPTION_KEY' | 'PUBLIC_APP_URL'>>;

/** What a verified token authorizes: one file answer, on one submission. */
export interface FileLinkClaims {
  submissionId: string;
  stepKey: string;
}

/**
 * The HMAC key for file links, or null when this deployment has no secret to
 * derive one from. An explicit `FILE_LINK_SECRET` wins; otherwise the 32-byte
 * `FORMS_ENCRYPTION_KEY`. Both go through HKDF, so the stored-token encryption
 * key is never used directly as a MAC key.
 */
export function fileLinkKey(env: FileLinkEnv | undefined): Buffer | null {
  const override = env?.FILE_LINK_SECRET?.trim();
  let material: Buffer | null = null;
  if (override) {
    material = Buffer.from(override, 'utf8');
  } else if (env?.FORMS_ENCRYPTION_KEY) {
    const raw = Buffer.from(env.FORMS_ENCRYPTION_KEY, 'base64');
    if (raw.length === 32) material = raw;
  }
  if (!material) return null;
  return Buffer.from(hkdfSync('sha256', material, Buffer.alloc(0), FILE_LINK_KEY_LABEL, 32));
}

function mac(key: Buffer, signed: string): Buffer {
  return createHmac('sha256', key).update(signed, 'utf8').digest();
}

/**
 * Decode base64url strictly: the string must be the canonical encoding of the
 * bytes it decodes to. Node's decoder is lenient (it skips junk and ignores
 * trailing bits), which would let several different strings verify as one
 * token.
 */
function strictB64url(value: string): Buffer | null {
  if (!B64URL_RE.test(value)) return null;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.toString('base64url') === value ? bytes : null;
}

/** Mint a token for one file answer. Null when the inputs cannot be encoded. */
export function signFileToken(key: Buffer, submissionId: string, stepKey: string): string | null {
  if (!submissionId || !stepKey || submissionId.includes('\n') || stepKey.includes('\n')) return null;
  const payload = Buffer.from(`${submissionId}\n${stepKey}`, 'utf8').toString('base64url');
  const signed = `${FILE_LINK_VERSION}.${payload}`;
  const token = `${signed}.${mac(key, signed).toString('base64url')}`;
  return token.length <= FILE_LINK_MAX_TOKEN_LENGTH ? token : null;
}

/**
 * The claims of a genuine token, or null for anything else: wrong version,
 * malformed, oversize, tampered, or signed with another key. One answer for
 * every failure, so a caller cannot tell a bad signature from bad framing.
 */
export function verifyFileToken(key: Buffer, token: unknown): FileLinkClaims | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > FILE_LINK_MAX_TOKEN_LENGTH) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [version, payload, signature] = parts as [string, string, string];
  if (version !== FILE_LINK_VERSION) return null;

  const given = strictB64url(signature);
  if (!given) return null;
  const expected = mac(key, `${version}.${payload}`);
  // Length first: timingSafeEqual throws on a mismatch, and the expected
  // length is public (it is the hash size), so checking it leaks nothing.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const bytes = strictB64url(payload);
  if (!bytes) return null;
  const text = bytes.toString('utf8');
  const cut = text.indexOf('\n');
  if (cut <= 0 || cut === text.length - 1) return null;
  const submissionId = text.slice(0, cut);
  const stepKey = text.slice(cut + 1);
  if (stepKey.includes('\n')) return null;
  return { submissionId, stepKey };
}

/** The public link for a token, on the web host. */
export function fileLinkUrl(publicAppUrl: string, token: string): string {
  return `${publicAppUrl.replace(/\/+$/, '')}/${FILE_LINK_PATH_SEGMENT}/${token}`;
}

/**
 * A short, log-safe stand-in for a token. The token is a bearer secret, so a
 * log line may carry its first characters to correlate requests, never all of it.
 */
export function tokenPrefix(token: string): string {
  return `${token.slice(0, 10)}...`;
}

/**
 * One permanent link per file answer in `data`, keyed by step key, or
 * undefined when there is nothing to link or no way to link it: no public web
 * host configured (a link to nowhere is worse than none) or no key to sign
 * with. Never throws; the submission path does not care whether links exist.
 */
export function fileLinksFor(
  env: FileLinkEnv | undefined,
  submissionId: string,
  data: Record<string, unknown>,
): Record<string, string> | undefined {
  const base = env?.PUBLIC_APP_URL?.trim();
  if (!base) return undefined;
  const key = fileLinkKey(env);
  if (!key) return undefined;

  const out: Record<string, string> = {};
  for (const [stepKey, value] of Object.entries(data)) {
    if (!parseFileAnswer(value as never)) continue;
    const token = signFileToken(key, submissionId, stepKey);
    if (token) out[stepKey] = fileLinkUrl(base, token);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
