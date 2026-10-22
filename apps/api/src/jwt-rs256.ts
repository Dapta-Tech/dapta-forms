/**
 * RS256 access-token verification against an issuer's published keys (JWKS),
 * for the MCP OAuth adapters. Hand-rolled on `node:crypto`, like the HS256
 * verifier in `jwt.ts` (clone-and-run stays dependency-light), and written for
 * an auth path:
 *   - the algorithm is HARD-PINNED to RS256: `none`, HS* and every other
 *     `alg` are refused before a key is looked up (no alg confusion);
 *   - the key is chosen by the header's `kid` among the issuer's RSA signing
 *     keys only; a token without a `kid` is refused;
 *   - `iss` and `aud` must match exactly (`aud` may be a list containing it);
 *   - `sub` and `exp` are REQUIRED: a token without an expiry would be good
 *     forever, so it is refused rather than trusted;
 *   - a `crit` header is refused: this verifier understands no extension, and
 *     RFC 7515 says a token naming one it does not understand is invalid;
 *   - any failure is `null`, never a throw, so a bad token can only ever
 *     become a 401. The one exception is `IssuerUnavailable`: the issuer's
 *     keys could not be read and none are cached, which says nothing about
 *     the token, so the caller answers it as an outage (a 503), not a 401.
 */
import { createPublicKey, verify as verifySignature, type KeyObject } from 'node:crypto';

/**
 * The issuer's key set cannot be read right now and nothing is cached, so no
 * token can be checked. Not the token's fault: a 503, never a 401 that would
 * send the client into a login that could not succeed either.
 */
export class IssuerUnavailable extends Error {
  constructor() {
    super("The identity provider's signing keys cannot be read right now.");
    this.name = 'IssuerUnavailable';
  }
}

/** The claims of a verified token that callers read. */
export interface VerifiedClaims {
  sub: string;
  exp: number;
  [claim: string]: unknown;
}

export interface Rs256Options {
  issuer: string;
  audience: string;
  /** The public key for a key id, or null when the issuer publishes none by that id. */
  keyFor(kid: string): Promise<KeyObject | null>;
  /** Epoch seconds; injectable for tests. */
  now?: () => number;
  /** Clock skew tolerated on `exp` and `nbf`, in seconds. */
  leewaySec?: number;
}

/** No real access token is this long; refusing earlier keeps parsing bounded. */
const MAX_TOKEN_LENGTH = 16_384;

function decodeJson(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The token's claims when every rule above holds, else null. */
export async function verifyRs256(token: string, options: Rs256Options): Promise<VerifiedClaims | null> {
  try {
    if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return null;
    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
    const header = decodeJson(headerPart);
    if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid === '') return null;
    if (header.crit !== undefined) return null;

    const key = await options.keyFor(header.kid);
    if (!key) return null;
    const signed = verifySignature(
      'RSA-SHA256',
      Buffer.from(`${headerPart}.${payloadPart}`),
      key,
      Buffer.from(signaturePart, 'base64url'),
    );
    if (!signed) return null;

    const claims = decodeJson(payloadPart);
    if (!claims) return null;
    const now = options.now?.() ?? Math.floor(Date.now() / 1000);
    const leeway = options.leewaySec ?? 30;
    if (claims.iss !== options.issuer) return null;
    const aud = claims.aud;
    if (!(aud === options.audience || (Array.isArray(aud) && aud.includes(options.audience)))) return null;
    if (typeof claims.sub !== 'string' || claims.sub === '') return null;
    if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp + leeway <= now) return null;
    if (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf - leeway > now)) return null;
    return claims as VerifiedClaims;
  } catch (error) {
    if (error instanceof IssuerUnavailable) throw error;
    return null;
  }
}

export interface RemoteJwksOptions {
  /** How long a fetched key set is trusted before it is fetched again. */
  maxAgeMs?: number;
  /** An unknown `kid` refetches the set at most once per this long, so junk tokens cannot hammer the issuer. */
  refetchCooldownMs?: number;
  /** A fetch that takes longer is abandoned (the token is refused). */
  timeoutMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
}

/**
 * An issuer's key set, fetched over HTTP and cached.
 *
 * - Single flight: a request that arrives while a fetch is running waits for
 *   it, so a cold start fetches once however many requests arrive together.
 * - A `kid` missing from the set refetches it (the issuer rotated a key in),
 *   but never in a lookup that has just fetched or waited for a fetch (no
 *   double fetch on a cold start), and only once the last such refetch, or
 *   the set itself, is a cooldown old.
 *   So a flood of junk key ids fetches at most once a cooldown, and cannot
 *   hold back a rotated key for longer than that: any refetch it causes loads
 *   the current set, rotated key included.
 * - With nothing cached and the issuer unreachable, `keyFor` throws
 *   `IssuerUnavailable`. Once a set is cached, an outage keeps serving it.
 */
export class RemoteJwks {
  private keys = new Map<string, KeyObject>();
  private fetchedAt = -Infinity;
  /** When a fetch last started, so an issuer that is down is retried at most once a short while, not per request. */
  private attemptedAt = -Infinity;
  private lastMissRefetch = -Infinity;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly url: string,
    private readonly options: RemoteJwksOptions = {},
  ) {}

  async keyFor(kid: string): Promise<KeyObject | null> {
    const cooldown = this.options.refetchCooldownMs ?? 30_000;
    const minRetry = Math.min(cooldown, 5_000);
    const now = this.now();
    let fetched = false;
    if (this.inFlight) {
      await this.inFlight;
      fetched = true;
    } else if (now - this.fetchedAt > (this.options.maxAgeMs ?? 10 * 60_000) && now - this.attemptedAt >= minRetry) {
      await this.refresh();
      fetched = true;
    }
    const cached = this.keys.get(kid);
    if (cached) return cached;
    // While the issuer is down `fetchedAt` stays old, so without this every
    // request with an unknown kid would fetch and wait for the timeout.
    const failingRecently = this.attemptedAt > this.fetchedAt && now - this.attemptedAt < minRetry;
    if (!fetched && !failingRecently && (now - this.lastMissRefetch >= cooldown || now - this.fetchedAt >= cooldown)) {
      this.lastMissRefetch = now;
      await this.refresh();
    }
    const key = this.keys.get(kid);
    if (key) return key;
    if (this.fetchedAt === -Infinity) throw new IssuerUnavailable();
    return null;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private refresh(): Promise<void> {
    this.inFlight ??= this.load().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async load(): Promise<void> {
    this.attemptedAt = this.now();
    try {
      const res = await (this.options.fetch ?? fetch)(this.url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 5_000),
      });
      if (!res.ok) return;
      const body = (await res.json()) as { keys?: unknown };
      if (!Array.isArray(body.keys)) return;
      const keys = new Map<string, KeyObject>();
      for (const jwk of body.keys as Array<Record<string, unknown>>) {
        if (!jwk || jwk.kty !== 'RSA' || typeof jwk.kid !== 'string') continue;
        if (jwk.use !== undefined && jwk.use !== 'sig') continue;
        if (jwk.alg !== undefined && jwk.alg !== 'RS256') continue;
        try {
          keys.set(jwk.kid, createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e } as never, format: 'jwk' }));
        } catch {
          /* a malformed key is skipped, never fatal */
        }
      }
      this.keys = keys;
      this.fetchedAt = this.now();
    } catch {
      /* unreachable or not JSON: keep what was cached; unknown keys stay unknown */
    }
  }
}
