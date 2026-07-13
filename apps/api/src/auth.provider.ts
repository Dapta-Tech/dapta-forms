/**
 * The host AuthProvider seam. Host/dashboard identity is resolved through a
 * pluggable `AuthProvider` port selected by `AUTH_PROVIDER` (config/env), so the
 * enum is genuinely load-bearing:
 *
 *   - `local`  — the OSS dev stub (this file). Resolves the seeded account+member
 *                and NEVER trusts client identity in production.
 *   - `workos` — a validated-JWT adapter that ships in the private overlay, wired
 *                by `createAuthProvider`. Selecting it in the pure OSS build fails
 *                loud rather than silently serving the stub.
 *
 * Machine identity is a separate, production-grade path (a hashed API key) and
 * lives on `AuthService`.
 */
import { UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Db, AccountRole } from '@quill/db';
import { deriveUniqueHandle, getAccountByCode, insertAccountWithShortCode, sql } from '@quill/db';
import type { ServerEnv } from '@quill/config/env';
// The concrete `workos` adapter. The cycle (adapter imports the port/`header`
// from here) is safe: each side references the other only inside function
// bodies, never during module evaluation.
import { WorkOsAuthProvider } from './auth.provider.workos';

export interface ReqLike {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * What an AuthProvider resolves: the tenant + user projection. The account role
 * is NOT the provider's concern — `AuthService` enriches this into a full
 * `HostPrincipal` (adds `role`) by reading `member.role`, so every provider
 * stays role-agnostic.
 */
export interface ResolvedHost {
  accountId: string;
  memberId: string;
}

/** The authenticated host, enriched with the account role for authorization. */
export interface HostPrincipal extends ResolvedHost {
  role: AccountRole;
}

export function header(req: ReqLike, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/** The port every host-auth backend implements. */
export interface AuthProvider {
  readonly name: string;
  /** Resolve the authenticated host (dashboard). Throws 401 if unresolved. */
  resolveHost(req: ReqLike): Promise<ResolvedHost>;
}

/**
 * DEV-only stable identity anchor for a JIT account (unique per email). Used as
 * account.external_id so concurrent/reseeded logins stay idempotent while the
 * public `code` is a proper short code (legacy `dev-…` CODES were re-coded by
 * the short-links backfill and live on as aliases).
 */
function devExternalIdFromEmail(email: string): string {
  return `dev:${email.toLowerCase()}`;
}

/** The legacy dev code shape — still resolvable via account_alias after re-coding. */
function legacyDevCodeFromEmail(email: string): string {
  const slug = email.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `dev-${slug || 'user'}`;
}

/**
 * OSS dev stub. It does NOT trust arbitrary client identity: all identity hints
 * here are development-only conveniences, IGNORED unless `NODE_ENV` is
 * development/test (and `loadServerEnv` additionally refuses to boot this
 * provider in production, so it is doubly impossible to spoof in prod).
 *
 * Resolution order (dev/test only):
 *   1. `x-quill-account` + `x-quill-member` — explicit impersonation (unchanged).
 *   2. an email — from the `x-quill-email` header, else `DEV_LOGIN_EMAIL` env:
 *      resolve the member with that email, JIT-provisioning a fresh
 *      account+member if none exists (so a developer lands in THEIR workspace,
 *      not the first seeded demo account). Mirrors the workos adapter's JIT.
 *   3. strict mode — if `AUTH_LOCAL_STRICT` is set and no identity arrived,
 *      resolve to 401 (a real "logged out" state for local dev) instead of (4).
 *   4. fallback — the FIRST seeded account+member (single-tenant stub).
 */
export class LocalAuthProvider implements AuthProvider {
  readonly name = 'local';

  constructor(
    private readonly db: Db,
    private readonly env: Pick<ServerEnv, 'NODE_ENV' | 'DEV_LOGIN_EMAIL' | 'AUTH_LOCAL_STRICT'>,
  ) {}

  async resolveHost(req: ReqLike): Promise<ResolvedHost> {
    if (this.env.NODE_ENV !== 'production') {
      // 1. Explicit impersonation (highest precedence, unchanged).
      const accountId = header(req, 'x-quill-account');
      const memberId = header(req, 'x-quill-member');
      if (accountId && memberId) return { accountId, memberId };

      // 2. Email-aware dev login (header wins over the env default).
      const email = header(req, 'x-quill-email') ?? this.env.DEV_LOGIN_EMAIL;
      if (email) return this.resolveByEmail(email);
    }

    // 3. Strict mode: no identity provided → no session (enables logout in dev).
    if (this.env.AUTH_LOCAL_STRICT) {
      throw new UnauthorizedException({ error: 'UNAUTHENTICATED', message: 'No session.' });
    }

    // 4. Dev fallback: the first account + its first member (single-tenant stub).
    const row = await this.db.get<{ account_id: string; member_id: string }>(
      sql`SELECT a.id AS account_id, m.id AS member_id
          FROM account a JOIN member m ON m.account_id = a.id
          ORDER BY a.created_at ASC, m.created_at ASC LIMIT 1`,
    );
    if (!row) throw new UnauthorizedException({ error: 'UNAUTHENTICATED', message: 'No session.' });
    return { accountId: row.account_id, memberId: row.member_id };
  }

  /** Resolve (or JIT-create) the member with this email. Dev/test only. */
  private async resolveByEmail(email: string): Promise<ResolvedHost> {
    const existing = await this.db.get<{ account_id: string; member_id: string }>(
      sql`SELECT account_id, id AS member_id FROM member
          WHERE email = ${email} ORDER BY created_at ASC LIMIT 1`,
    );
    if (existing) return { accountId: existing.account_id, memberId: existing.member_id };

    // JIT: a fresh isolated account+member for this email, idempotent across
    // reseeds/races via external_id (`dev:<email>`). Pre-short-links accounts
    // are found by their legacy `dev-…` code (now an account_alias).
    const extId = devExternalIdFromEmail(email);
    const legacyCode = legacyDevCodeFromEmail(email);
    let account = await this.db.get<{ id: string }>(
      sql`SELECT id FROM account WHERE external_id = ${extId} LIMIT 1`,
    );
    if (!account) account = await getAccountByCode(this.db, legacyCode);
    if (!account) {
      // Race-safe JIT: idempotent on external_id; a code collision regenerates.
      await insertAccountWithShortCode(this.db, { name: email, externalId: extId });
      account = await this.db.get<{ id: string }>(
        sql`SELECT id FROM account WHERE external_id = ${extId} LIMIT 1`,
      );
    }
    if (!account) throw new UnauthorizedException({ error: 'UNAUTHENTICATED', message: 'No session.' });

    // The first member of an account is its owner (matches the seed + migration
    // backfill); subsequent JIT members default to `member`.
    const role: AccountRole = (await this.db.get<{ id: string }>(
      sql`SELECT id FROM member WHERE account_id = ${account.id} LIMIT 1`,
    ))
      ? 'member'
      : 'owner';
    const memberId = randomUUID();
    // Auto-handle at creation (short-links §3) — the "no handle" state is dead.
    const handle = await deriveUniqueHandle(this.db, account.id, null, email);
    await this.db.run(
      sql`INSERT INTO member (id, account_id, email, display_name, handle, role, created_at)
          VALUES (${memberId}, ${account.id}, ${email}, ${email}, ${handle}, ${role}, ${Date.now()})`,
    );
    return { accountId: account.id, memberId };
  }
}

/**
 * Select the host AuthProvider for the configured `AUTH_PROVIDER`. This is the
 * DI seam `app.module` uses.
 *
 * `workos` resolves to the concrete `WorkOsAuthProvider` (a downstream validator
 * of the upstream identity service's HS256 platform JWT) — but ONLY when a
 * `JWT_SECRET` is configured. A pure OSS build with no secret still fails loud
 * here rather than silently falling back to the insecure local stub. (In the
 * internal-first phase the adapter lives in-repo; it later moves to the private
 * overlay behind this same seam.)
 */
export function createAuthProvider(env: ServerEnv, db: Db): AuthProvider {
  switch (env.AUTH_PROVIDER) {
    case 'local':
      return new LocalAuthProvider(db, env);
    case 'workos':
      if (!env.JWT_SECRET) {
        throw new Error(
          'AUTH_PROVIDER=workos requires JWT_SECRET (the shared secret the upstream identity service signs ' +
            'the host session token with). Set it via the deploy secret / a local .env, or use ' +
            'AUTH_PROVIDER=local for development only.',
        );
      }
      return new WorkOsAuthProvider(db, env);
    default:
      throw new Error(`Unknown AUTH_PROVIDER: ${String((env as ServerEnv).AUTH_PROVIDER)}`);
  }
}
