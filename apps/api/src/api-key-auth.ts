/**
 * Resolving a request that carries an API key into a principal. Called only
 * from `AuthService.resolveHost`, which stays the single door: a key yields the
 * same principal a session does (account, member, the member's CURRENT role)
 * plus `via: 'api_key'` and `apiKeyId`.
 *
 * In order:
 *   1. unknown or revoked key, or a member who is no longer active in the
 *      key's workspace: 401 `INVALID_API_KEY`. A key the deployment's staff
 *      created through a staff access grant resolves like any other, as that
 *      grant row (an `admin` there): a key is a credential of its workspace,
 *      not of the person, so it keeps working after they stop being staff,
 *      until someone revokes it (the way Dapta's own MCP keys work);
 *   2. the key fixes the workspace: an `x-quill-workspace` naming another one
 *      is a 403 `WORKSPACE_FORBIDDEN`, never a quiet switch;
 *   3. 120 calls a minute per key (the public limiter, keyed by key id): 429
 *      `RATE_LIMITED` with `retryAfterSec` and a `Retry-After` header;
 *   4. `last_used_at_ms` stamped at most once a minute.
 *
 * A key that resolves (step 1 passed) is noted on the request for the
 * deprecated-hosts log (`noteApiKeyCall`), whatever steps 2 and 3 answer: a
 * 403 or a 429 is still a call that key made on that host.
 *
 * Which routes a key may call at all is decided before any handler runs, by
 * `ApiKeyRouteGuard` (api-key-routes.ts).
 */
import { ForbiddenException, HttpException, HttpStatus, Logger, UnauthorizedException } from '@nestjs/common';
import { findApiKeyPrincipal, touchApiKeyLastUsed, type Db } from '@quill/db';
import type { ServerEnv } from '@quill/config/env';
import { hashApiKey } from './api-keys';
import { header, type HostPrincipal, type ReqLike } from './auth.provider';
import { noteApiKeyCall } from './deprecated-hosts';
import { NoopRateLimiter, TokenBucketRateLimiter, type RateLimiter } from './rate-limit';

/** Calls a key may make per minute (burst and sustained). */
export const API_KEY_CALLS_PER_MINUTE = 120;

/** How often `last_used_at_ms` may move for one key. */
export const API_KEY_LAST_USED_THROTTLE_MS = 60_000;

/**
 * The per-key limiter: the same token bucket the public surface uses, sized to
 * 120 calls with a refill of 120 a minute. In memory, per pod. Off with the
 * rest of the rate limiting when `RATE_LIMIT_ENABLED` is false.
 */
export function createApiKeyRateLimiter(
  env?: Pick<ServerEnv, 'RATE_LIMIT_ENABLED'>,
  now?: () => number,
): RateLimiter {
  if (env && !env.RATE_LIMIT_ENABLED) return new NoopRateLimiter();
  return new TokenBucketRateLimiter(API_KEY_CALLS_PER_MINUTE, API_KEY_CALLS_PER_MINUTE / 60, now);
}

const WORKSPACE_HEADER = 'x-quill-workspace';

function invalidKey(): never {
  throw new UnauthorizedException({
    error: 'INVALID_API_KEY',
    message: 'This API key is not valid. It may have been revoked, or its owner left the workspace.',
  });
}

/** Express hangs the response off the request; set a header on it when there is one. */
function setResponseHeader(req: ReqLike, name: string, value: string): void {
  const res = (req as { res?: { setHeader?: (k: string, v: string) => void } }).res;
  res?.setHeader?.(name, value);
}

export class ApiKeyAuthenticator {
  private readonly log = new Logger('ApiKeyAuthenticator');
  /** Per-pod memory of the last stamp, so a busy key skips even the no-op UPDATE. */
  private readonly lastTouched = new Map<string, number>();

  constructor(
    private readonly db: Db,
    private readonly limiter: RateLimiter,
    private readonly now: () => number = Date.now,
  ) {}

  async resolve(req: ReqLike, key: string): Promise<HostPrincipal> {
    return this.resolveHash(req, hashApiKey(key));
  }

  /**
   * The same steps for a key known by its hash: the MCP's in-process
   * principal carries the hash, never the key. `expected` is the member and
   * workspace that principal names; a key that resolves to any other is a 401.
   */
  async resolveHash(
    req: ReqLike,
    keyHash: string,
    expected?: { accountId: string; memberId: string },
  ): Promise<HostPrincipal> {
    const row = await findApiKeyPrincipal(this.db, keyHash);
    if (!row || row.memberStatus !== 'active') invalidKey();
    if (expected && (expected.accountId !== row.accountId || expected.memberId !== row.memberId)) invalidKey();
    noteApiKeyCall(req, row.keyId, row.accountId);

    const requested = header(req, WORKSPACE_HEADER)?.trim();
    if (requested && requested !== row.accountId) {
      throw new ForbiddenException({
        error: 'WORKSPACE_FORBIDDEN',
        message: 'This API key belongs to another workspace.',
      });
    }

    const { allowed, retryAfterMs } = this.limiter.take(`api_key:${row.keyId}`);
    if (!allowed) {
      const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
      setResponseHeader(req, 'Retry-After', String(retryAfterSec));
      throw new HttpException(
        {
          error: 'RATE_LIMITED',
          message: `Too many requests for this API key. Retry in ${retryAfterSec} s.`,
          retryAfterSec,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.touch(row.keyId);
    return {
      accountId: row.accountId,
      memberId: row.memberId,
      role: row.role,
      via: 'api_key',
      apiKeyId: row.keyId,
    };
  }

  /** Best effort: a failed stamp must never fail the call it describes. */
  private async touch(keyId: string): Promise<void> {
    const t = this.now();
    const last = this.lastTouched.get(keyId);
    if (last !== undefined && t - last < API_KEY_LAST_USED_THROTTLE_MS) return;
    this.lastTouched.set(keyId, t);
    if (this.lastTouched.size > 50_000) this.lastTouched.clear();
    try {
      await touchApiKeyLastUsed(this.db, keyId, t, API_KEY_LAST_USED_THROTTLE_MS);
    } catch (err) {
      this.log.warn(`could not stamp last use of API key ${keyId}: ${String(err)}`);
    }
  }
}
