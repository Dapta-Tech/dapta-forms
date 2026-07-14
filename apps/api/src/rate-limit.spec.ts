/**
 * Rate-limit client-key derivation (B2). The public abuse control must key on
 * the REAL client IP; a spoofed leftmost X-Forwarded-For must not mint a fresh
 * bucket per request. Behind N trusted proxies the client is the Nth entry from
 * the right; with 0 trusted hops XFF is ignored entirely.
 */
import { describe, it, expect } from 'vitest';
import { clientKey, resolveTrustProxyHops, TokenBucketRateLimiter } from './rate-limit';

function req(xff: string | undefined, peer = '203.0.113.9') {
  return { headers: xff === undefined ? {} : { 'x-forwarded-for': xff }, socket: { remoteAddress: peer } };
}

describe('resolveTrustProxyHops', () => {
  it('honors an explicit value', () => {
    expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: 2, PUBLIC_APP_URL: '' })).toBe(2);
    expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: 0, PUBLIC_APP_URL: 'https://x' })).toBe(0);
  });
  it('defaults to 1 when PUBLIC_APP_URL is set, else 0', () => {
    expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: undefined, PUBLIC_APP_URL: 'https://forms.example.com' })).toBe(1);
    expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: undefined, PUBLIC_APP_URL: '' })).toBe(0);
  });
});

describe('clientKey', () => {
  it('with 0 trusted hops uses the socket peer and IGNORES a spoofed XFF', () => {
    expect(clientKey(req('1.2.3.4, 5.6.7.8'), 0)).toBe('203.0.113.9');
    // Spoofing XFF cannot change the key.
    expect(clientKey(req('9.9.9.9'), 0)).toBe('203.0.113.9');
  });

  it('with 1 trusted hop takes the RIGHTMOST (ALB-observed) entry, not the leftmost spoof', () => {
    // Attacker prepends "1.1.1.1"; the ALB appends the real client "198.51.100.7".
    expect(clientKey(req('1.1.1.1, 198.51.100.7'), 1)).toBe('198.51.100.7');
  });

  it('with 2 trusted hops takes the 2nd-from-right entry', () => {
    expect(clientKey(req('1.1.1.1, 198.51.100.7, 10.0.0.1'), 2)).toBe('198.51.100.7');
  });

  it('clamps to the leftmost when the chain is shorter than the hop count', () => {
    expect(clientKey(req('198.51.100.7'), 3)).toBe('198.51.100.7');
  });

  it('falls back to the socket peer when XFF is absent', () => {
    expect(clientKey(req(undefined), 1)).toBe('203.0.113.9');
  });

  it('SPOOF DEFENSE: a per-request random leftmost XFF still hits ONE bucket', () => {
    const limiter = new TokenBucketRateLimiter(2, 0); // capacity 2, no refill
    const hops = 1;
    const attempt = (spoof: string) =>
      limiter.take(clientKey(req(`${spoof}, 198.51.100.7`), hops)).allowed;
    // The attacker rotates the leftmost value every request; the real client is
    // still 198.51.100.7 → the bucket drains and throttles on the 3rd request.
    expect(attempt('10.0.0.1')).toBe(true);
    expect(attempt('10.0.0.2')).toBe(true);
    expect(attempt('10.0.0.3')).toBe(false); // throttled — spoofing did not help
  });
});
