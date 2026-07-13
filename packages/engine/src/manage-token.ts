import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Attendee "manage" tokens for public cancel/reschedule links (API-CONTRACT
 * §Engine rules 3): random 256-bit, HASHED at rest, single active per booking.
 *
 * The plaintext token is returned ONCE (in the booking-create response and the
 * confirmation email's manage URL) and never stored; only its SHA-256 hash is
 * persisted. Verification is constant-time. Rotating (reschedule) mints a fresh
 * token and overwrites the stored hash, so at most one token is ever valid.
 */

export interface ManageToken {
  /** URL-safe plaintext — shown to the attendee once, never persisted. */
  token: string;
  /** SHA-256 hex of the token — the only thing stored. */
  tokenHash: string;
}

/** Mint a new 256-bit manage token + its at-rest hash. */
export function generateManageToken(): ManageToken {
  const token = randomBytes(32).toString('base64url'); // 32 bytes = 256 bits
  return { token, tokenHash: hashManageToken(token) };
}

/** SHA-256 (hex) of a manage token — the at-rest form. */
export function hashManageToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time check of a presented token against the stored hash. */
export function verifyManageToken(token: string, expectedHash: string | null | undefined): boolean {
  if (!token || !expectedHash) return false;
  const actual = Buffer.from(hashManageToken(token), 'hex');
  let expected: Buffer;
  try {
    expected = Buffer.from(expectedHash, 'hex');
  } catch {
    return false;
  }
  if (actual.length !== expected.length || expected.length === 0) return false;
  return timingSafeEqual(actual, expected);
}
