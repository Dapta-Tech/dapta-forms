import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { ServerEnv } from '@quill/config/env';
import { RATE_LIMITER } from './tokens';

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

/** The client IP, honoring a single proxy hop (ALB/CDN sets x-forwarded-for). */
function clientKey(req: {
  headers?: Record<string, unknown>;
  ip?: string;
  socket?: { remoteAddress?: string };
}): string {
  const xff = req.headers?.['x-forwarded-for'];
  const fwd = Array.isArray(xff) ? xff[0] : typeof xff === 'string' ? xff.split(',')[0] : undefined;
  return (fwd?.trim() || req.ip || req.socket?.remoteAddress || 'unknown').toString();
}

/**
 * Applied to the public controller. On throttle it returns 429 with a
 * `Retry-After` header so well-behaved clients back off.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(@Inject(RATE_LIMITER) private readonly limiter: RateLimiter) {}

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const req = http.getRequest();
    const { allowed, retryAfterMs } = this.limiter.take(clientKey(req));
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
