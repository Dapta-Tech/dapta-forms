/**
 * The limiter port the door and the server take tokens from. Structurally the
 * same interface forms-api already uses for its public surface, so the host
 * passes its own token buckets (or a distributed limiter) without an adapter.
 */
export interface RateLimiter {
  /** Consume one token for `key`. `allowed: false` means throttle, with a retry hint. */
  take(key: string): { allowed: boolean; retryAfterMs: number };
}

/** Never throttles. */
export const unlimited: RateLimiter = { take: () => ({ allowed: true, retryAfterMs: 0 }) };
