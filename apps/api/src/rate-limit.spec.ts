import { describe, it, expect } from 'vitest';
import { NoopRateLimiter, TokenBucketRateLimiter } from './rate-limit';

describe('rate limiting (P1-5)', () => {
  it('allows a burst up to capacity, then throttles with a retry hint', () => {
    const now = 1_000_000;
    const rl = new TokenBucketRateLimiter(3, 1, () => now); // burst 3, 1/sec
    expect(rl.take('ip').allowed).toBe(true);
    expect(rl.take('ip').allowed).toBe(true);
    expect(rl.take('ip').allowed).toBe(true);
    const denied = rl.take('ip');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  it('refills over time', () => {
    let now = 0;
    const rl = new TokenBucketRateLimiter(1, 1, () => now); // 1 token, 1/sec
    expect(rl.take('ip').allowed).toBe(true);
    expect(rl.take('ip').allowed).toBe(false);
    now += 1000; // one second → one token back
    expect(rl.take('ip').allowed).toBe(true);
  });

  it('is per-key: one client cannot exhaust another', () => {
    const now = 0;
    const rl = new TokenBucketRateLimiter(1, 1, () => now);
    expect(rl.take('a').allowed).toBe(true);
    expect(rl.take('a').allowed).toBe(false);
    // A different IP still has its full bucket.
    expect(rl.take('b').allowed).toBe(true);
  });

  it('noop limiter never throttles (RATE_LIMIT_ENABLED=false)', () => {
    const rl = new NoopRateLimiter();
    for (let i = 0; i < 1000; i++) expect(rl.take('ip').allowed).toBe(true);
  });
});
