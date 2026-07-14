import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { ServerEnv } from '@quill/config/env';
import { ENV, RATE_LIMITER } from './tokens';

/**
 * Rate limiting for the unauthenticated public surface (P1-5). The old service
 * had none — the public surface was unthrottled, so submission spam and
 * config scraping were free. This is a pluggable port: the OSS
 * default is an in-process per-IP token bucket; a deployment can disable it or
 * swap a distributed limiter (Redis) behind the same interface in the overlay.
 */
export interface RateLimiter {
  /** Consume one token for `key`. `allowed:false` ⇒ throttle (with retry hint). */
  take(key: string): { allowed: boolean; retryAfterMs: number };
}

/** Never throttles — used when RATE_LIMIT_ENABLED=false. */
export class NoopRateLimiter implements RateLimiter {
  take(_key: string): { allowed: boolean; retryAfterMs: number } {
    return { allowed: true, retryAfterMs: 0 };
  }
}

interface Bucket {
  tokens: number;
  last: number;
}

/**
 * In-memory token bucket: each key refills at `refillPerSec` up to `capacity`
 * (the burst). Cheap and dependency-free; single-process only (fine for the OSS
 * default — a multi-instance deploy plugs a shared limiter). Idle buckets are
 * pruned when the map grows past a soft cap so memory can't grow unbounded.
 */
export class TokenBucketRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private static readonly MAX_KEYS = 50_000;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(key: string): { allowed: boolean; retryAfterMs: number } {
    const t = this.now();
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= TokenBucketRateLimiter.MAX_KEYS) this.prune();
      b = { tokens: this.capacity, last: t };
      this.buckets.set(key, b);
    }
    // Refill proportional to elapsed time, capped at capacity.
    const elapsedSec = Math.max(0, (t - b.last) / 1000);
    b.tokens = Math.min(this.capacity, b.tokens + elapsedSec * this.refillPerSec);
    b.last = t;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return { allowed: true, retryAfterMs: 0 };
    }
    const deficit = 1 - b.tokens;
    return { allowed: false, retryAfterMs: Math.ceil((deficit / this.refillPerSec) * 1000) };
  }

  /** Drop fully-refilled (idle) buckets — they carry no state worth keeping. */
  private prune(): void {
    for (const [k, v] of this.buckets) {
      if (v.tokens >= this.capacity) this.buckets.delete(k);
    }
  }
}

export function createRateLimiter(env: ServerEnv): RateLimiter {
  if (!env.RATE_LIMIT_ENABLED) return new NoopRateLimiter();
  return new TokenBucketRateLimiter(env.RATE_LIMIT_CAPACITY, env.RATE_LIMIT_REFILL_PER_SEC);
}

/**
 * How many trusted proxy hops sit in front of the app: the number of trailing
 * X-Forwarded-For entries the infrastructure appends. Explicit env wins;
 * otherwise assume ONE fronting proxy when PUBLIC_APP_URL is set (the deployed
 * shape behind an ALB), else ZERO (a direct-exposed self-host — trust only the
 * socket peer, never XFF).
 */
export function resolveTrustProxyHops(env: Pick<ServerEnv, 'TRUST_PROXY_HOPS' | 'PUBLIC_APP_URL'>): number {
  if (typeof env.TRUST_PROXY_HOPS === 'number') return env.TRUST_PROXY_HOPS;
  return env.PUBLIC_APP_URL ? 1 : 0;
}

/**
 * The client IP used as the rate-limit bucket key.
 *
 * SECURITY (B2): X-Forwarded-For is client-APPENDED — the ALB adds the observed
 * peer to the RIGHT and never strips a spoofed value on the left. Keying on the
 * LEFTMOST entry lets an attacker mint a fresh bucket per request (spoofed XFF →
 * limiter is a no-op). With `trustProxyHops = N` trusted proxies, the real
 * client is the Nth entry FROM THE RIGHT. With `N = 0` we ignore XFF entirely
 * and trust only the socket peer address.
 */
export function clientKey(
  req: {
    headers?: Record<string, unknown>;
    ip?: string;
    socket?: { remoteAddress?: string };
  },
  trustProxyHops: number,
): string {
  const peer = req.ip || req.socket?.remoteAddress || 'unknown';
  if (trustProxyHops <= 0) return peer.toString();
  const raw = req.headers?.['x-forwarded-for'];
  const header = Array.isArray(raw) ? raw.join(',') : typeof raw === 'string' ? raw : '';
  const parts = header.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return peer.toString();
  // The Nth entry from the right; clamp to the leftmost if the chain is shorter
  // than the configured hop count (defends against a short/spoofed chain).
  const idx = Math.max(0, parts.length - trustProxyHops);
  return parts[idx] ?? peer.toString();
}

/**
 * Applied to the public controller. On throttle it returns 429 with a
 * `Retry-After` header so well-behaved clients back off.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly trustProxyHops: number;

  constructor(
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(ENV) env: ServerEnv,
  ) {
    this.trustProxyHops = resolveTrustProxyHops(env);
  }

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const req = http.getRequest();
    const { allowed, retryAfterMs } = this.limiter.take(clientKey(req, this.trustProxyHops));
    if (!allowed) {
      const res = http.getResponse<{ header?: (k: string, v: string) => void; setHeader?: (k: string, v: string) => void }>();
      const seconds = Math.ceil(retryAfterMs / 1000).toString();
      res.header?.('Retry-After', seconds);
      res.setHeader?.('Retry-After', seconds);
      throw new HttpException(
        { error: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
