/**
 * The concrete host AuthProvider for `AUTH_PROVIDER=workos`.
 *
 * It does NOT talk to WorkOS. Login (hosted AuthKit, social providers) lives in
 * the upstream identity service, which after login mints an HS256 platform JWT
 * (shared secret; claims `sub`, `account_id`, `email`, `name`). This provider is
 * the DOWNSTREAM validator only — it verifies that token and projects its claims
 * onto a local `{accountId, memberId}`. This is the exact split the predecessor
 * service used, and it is what makes local and remote behave identically: the
 * secret is symmetric, so there is nothing environment-specific to fetch.
 *
 * Because it only ever *validates* tokens (never issues them, never calls the
 * identity service or WorkOS), it cannot affect the upstream login in any way —
 * a bad/absent secret here fails logins to THIS service only.
 *
 * NOTE (OSS surface): kept in-repo for the internal-first phase. Before the
 * public flip it moves to the private overlay behind the same seam; the public
 * `createAuthProvider` still fails loud without it. No vendor host/secret name
 * appears here — issuer/audience/secret all arrive via env.
 */
import { Logger, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Db, AccountRole } from '@quill/db';
import { deriveUniqueHandle, insertAccountWithShortCode, sql } from '@quill/db';
import type { ServerEnv } from '@quill/config/env';
import {
  header,
  maybeSeedDemoForm,
  type AuthProvider,
  type ResolvedHost,
  type ReqLike,
} from './auth.provider';
import { verifyJwtHs256, JwtError, type JwtClaims } from './jwt';

type WorkOsEnv = Pick<ServerEnv, 'JWT_SECRET' | 'JWT_ISSUER' | 'JWT_AUDIENCE' | 'SEED_DEMO_FORM'>;

function unauthenticated(message: string): UnauthorizedException {
  return new UnauthorizedException({ error: 'UNAUTHENTICATED', message });
}

// Account codes are 6-char short codes from @quill/db (generateUniqueShortCode)
// — the old `acct-<hex>` derivation leaked machine garbage into every public
// URL. Idempotency across concurrent first-logins is anchored on external_id
// (ON CONFLICT), so the code no longer needs to be deterministic.

export class WorkOsAuthProvider implements AuthProvider {
  readonly name = 'workos';
  private readonly log = new Logger('WorkOsAuthProvider');
  private readonly secret: string;

  constructor(
    private readonly db: Db,
    private readonly env: WorkOsEnv,
  ) {
    if (!env.JWT_SECRET) {
      // Defensive: the factory already guards this, but never run without a key.
      throw new Error('WorkOsAuthProvider requires JWT_SECRET.');
    }
    this.secret = env.JWT_SECRET;
  }

  async resolveHost(req: ReqLike): Promise<ResolvedHost> {
    const authHeader = header(req, 'authorization');
    const token =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : undefined;
    if (!token) throw unauthenticated('Missing bearer token.');

    let claims: JwtClaims;
    try {
      claims = verifyJwtHs256(token, {
        secret: this.secret,
        issuer: this.env.JWT_ISSUER,
        audience: this.env.JWT_AUDIENCE,
      });
    } catch (err) {
      if (err instanceof JwtError) throw unauthenticated('Invalid session token.');
      throw err;
    }

    const accountExtId = typeof claims.account_id === 'string' ? claims.account_id : undefined;
    const sub = typeof claims.sub === 'string' ? claims.sub : undefined;
    if (!accountExtId) throw unauthenticated('Token missing account_id.');
    if (!sub) throw unauthenticated('Token missing sub.');

    const accountId = await this.resolveAccount(accountExtId, claims);
    const memberId = await this.resolveMember(accountId, sub, claims);
    return { accountId, memberId };
  }

  /** Find (or JIT-create) the local account projected from the token's account_id. */
  private async resolveAccount(externalId: string, claims: JwtClaims): Promise<string> {
    const existing = await this.db.get<{ id: string }>(
      sql`SELECT id FROM account WHERE external_id = ${externalId} LIMIT 1`,
    );
    if (existing) return existing.id;

    const name = typeof claims.name === 'string' && claims.name ? claims.name : 'Account';
    // Race-safe JIT: idempotent on external_id, and a (vanishingly rare) short
    // CODE collision with a concurrent creation regenerates + retries instead
    // of failing the login. The loser of the external_id race re-selects below.
    await insertAccountWithShortCode(this.db, { name, externalId });
    const row = await this.db.get<{ id: string }>(
      sql`SELECT id FROM account WHERE external_id = ${externalId} LIMIT 1`,
    );
    if (!row) throw unauthenticated('Could not resolve account.');
    return row.id;
  }

  /** Find (or JIT-create) the local member projected from the token's sub. */
  private async resolveMember(accountId: string, sub: string, claims: JwtClaims): Promise<string> {
    const existing = await this.db.get<{ id: string }>(
      sql`SELECT id FROM member WHERE account_id = ${accountId} AND external_id = ${sub} LIMIT 1`,
    );
    if (existing) return existing.id;

    const email = typeof claims.email === 'string' ? claims.email : null;
    const displayName = typeof claims.name === 'string' ? claims.name : null;

    // Adopt a pending invite: a member invited by email exists with no external_id
    // yet. Bind this login's `sub` to it (keeping its granted role) and activate,
    // so invite → first-login lands the user in the role they were granted.
    if (email) {
      const invited = await this.db.get<{ id: string }>(
        sql`SELECT id FROM member
            WHERE account_id = ${accountId} AND external_id IS NULL AND lower(email) = lower(${email})
            ORDER BY created_at ASC LIMIT 1`,
      );
      if (invited) {
        await this.db.run(
          sql`UPDATE member SET external_id = ${sub}, status = 'active',
                display_name = COALESCE(display_name, ${displayName})
              WHERE id = ${invited.id}`,
        );
        return invited.id;
      }
    }

    // The first member of an account is its owner; later JIT members are `member`.
    const role: AccountRole = (await this.db.get<{ id: string }>(
      sql`SELECT id FROM member WHERE account_id = ${accountId} LIMIT 1`,
    ))
      ? 'member'
      : 'owner';
    const id = randomUUID();
    // Auto-handle at creation (short-links §3): the "no handle" state is dead —
    // every member gets `fgomez` (collision → `fgomez2`…) and can rename later.
    const handle = await deriveUniqueHandle(this.db, accountId, displayName, email);
    await this.db.run(
      sql`INSERT INTO member (id, account_id, external_id, email, display_name, handle, role, created_at)
          VALUES (${id}, ${accountId}, ${sub}, ${email}, ${displayName}, ${handle}, ${role}, ${Date.now()})
          ON CONFLICT (account_id, external_id) DO NOTHING`,
    );
    const row = await this.db.get<{ id: string }>(
      sql`SELECT id FROM member WHERE account_id = ${accountId} AND external_id = ${sub} LIMIT 1`,
    );
    if (!row) throw unauthenticated('Could not resolve member.');
    // A fresh account (its first member is the owner) gets the polished demo form
    // so the dashboard is never empty. Idempotent + best-effort (never blocks login).
    if (role === 'owner') {
      await maybeSeedDemoForm(this.db, accountId, this.env.SEED_DEMO_FORM, this.log);
    }
    return row.id;
  }
}
