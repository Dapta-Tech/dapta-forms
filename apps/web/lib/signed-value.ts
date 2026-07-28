import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * `base64url(value).hmac` — a tamper-evident cookie value.
 *
 * Pure and secret-as-argument on purpose: it holds no request state and reads
 * no environment, so it is directly testable, unlike everything in
 * `auth-session.ts` that lives behind `server-only`.
 *
 * With no secret (a bare OSS `local` fork) the payload rides alone. That is
 * sound only for values which authorize NOTHING on their own — the chosen
 * workspace is checked against the caller's memberships server-side on every
 * request — and must never be used for a credential.
 */
export function signValue(value: string, secret: string): string {
  const payload = Buffer.from(value).toString('base64url');
  if (!secret) return payload;
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

/** The value back, or null when the signature does not hold. */
export function unsignValue(raw: string | undefined, secret: string): string | null {
  if (!raw) return null;
  const [payload, sig] = raw.split('.');
  if (!payload) return null;
  if (secret) {
    const expected = createHmac('sha256', secret).update(payload).digest('base64url');
    // Length first: timingSafeEqual throws on a mismatch rather than returning
    // false, and a forged cookie must read as "absent", never as a crash.
    if (
      !sig ||
      sig.length !== expected.length ||
      !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      return null;
    }
  }
  return Buffer.from(payload, 'base64url').toString() || null;
}
