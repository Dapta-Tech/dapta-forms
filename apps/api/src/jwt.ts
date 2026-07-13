/**
 * A tiny, dependency-free HS256 JWT verifier — enough to validate the host
 * session token the upstream identity service mints (the same contract the
 * predecessor service validated: HS256, a shared symmetric secret, `iss`/`aud`).
 * A symmetric secret is why the SAME check runs identically in local dev and in
 * production — there is no per-environment key material to fetch.
 *
 * Deliberately hand-rolled (this repo hand-rolls its migrator and api-key hashing
 * too — clone-and-run stays dependency-light), but written defensively for an
 * auth path:
 *   - the algorithm is HARD-PINNED to HS256; `none` and any asymmetric `alg` are
 *     rejected before a signature is even computed (no alg-confusion),
 *   - the signature is compared in constant time,
 *   - `exp` is REQUIRED (a token with no expiry is rejected),
 *   - `iss` / `aud` are enforced only when the caller configures them.
 *
 * It intentionally does NOT support key rotation, JWKS, or RS/ES — this is the
 * shared-secret platform token, nothing else.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface JwtClaims {
  sub?: string;
  account_id?: string;
  email?: string;
  name?: string;
  session_id?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  [key: string]: unknown;
}

export interface VerifyOptions {
  secret: string;
  /** Enforced only when set. */
  issuer?: string;
  /** Enforced only when set; matches a string `aud` or membership of an array. */
  audience?: string;
  /** Epoch ms; injectable for tests. Defaults to Date.now(). */
  now?: number;
  /** Allowed clock skew in seconds (applied to exp/nbf). Default 0. */
  clockToleranceSec?: number;
}

/** Thrown on any verification failure. The caller maps it to a 401. */
export class JwtError extends Error {}

function b64urlToBuffer(part: string): Buffer {
  // base64url → base64, then let Buffer validate/decode.
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  return Buffer.from(b64 + pad, 'base64');
}

function decodeJson(part: string, what: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(b64urlToBuffer(part).toString('utf8'));
  } catch {
    throw new JwtError(`Malformed JWT ${what}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new JwtError(`Malformed JWT ${what}`);
  }
  return parsed as Record<string, unknown>;
}

function audienceMatches(aud: unknown, expected: string): boolean {
  if (typeof aud === 'string') return aud === expected;
  if (Array.isArray(aud)) return aud.includes(expected);
  return false;
}

/**
 * Verify an HS256 JWT and return its claims, or throw {@link JwtError}. Performs
 * no I/O and never touches the token-issuing service — pure verification.
 */
export function verifyJwtHs256(token: string, opts: VerifyOptions): JwtClaims {
  if (!opts.secret) throw new JwtError('No verification secret configured');
  if (typeof token !== 'string') throw new JwtError('Missing token');

  const parts = token.split('.');
  if (parts.length !== 3) throw new JwtError('Malformed JWT: expected 3 segments');
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (encodedHeader === undefined || encodedPayload === undefined || encodedSignature === undefined) {
    throw new JwtError('Malformed JWT: empty segment');
  }

  const header = decodeJson(encodedHeader, 'header');
  if (header.alg !== 'HS256') throw new JwtError(`Unsupported JWT alg: ${String(header.alg)}`);
  if (header.typ !== undefined && header.typ !== 'JWT') {
    throw new JwtError(`Unsupported JWT typ: ${String(header.typ)}`);
  }

  const expected = createHmac('sha256', opts.secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();
  const actual = b64urlToBuffer(encodedSignature);
  // Constant-time compare — length-check first (timingSafeEqual throws on unequal
  // lengths, and that length is not itself secret).
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new JwtError('Invalid JWT signature');
  }

  const payload = decodeJson(encodedPayload, 'payload') as JwtClaims;

  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
  const skew = opts.clockToleranceSec ?? 0;

  if (typeof payload.exp !== 'number') throw new JwtError('JWT missing exp');
  if (nowSec >= payload.exp + skew) throw new JwtError('JWT expired');
  if (typeof payload.nbf === 'number' && nowSec < payload.nbf - skew) {
    throw new JwtError('JWT not yet valid');
  }
  if (opts.issuer && payload.iss !== opts.issuer) throw new JwtError('JWT issuer mismatch');
  if (opts.audience && !audienceMatches(payload.aud, opts.audience)) {
    throw new JwtError('JWT audience mismatch');
  }

  return payload;
}

/** base64url-encode a Buffer/string (no padding) — used by the dev token minter. */
export function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Mint an HS256 JWT. Used ONLY by the local dev token minter (`auth:mint`) so a
 * contributor can exercise the `workos` provider offline with no identity server.
 * Not used on any request path.
 */
export function signJwtHs256(claims: Record<string, unknown>, secret: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claims));
  const signature = b64url(createHmac('sha256', secret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${signature}`;
}
