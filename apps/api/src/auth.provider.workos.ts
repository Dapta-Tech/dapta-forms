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
  notifySignup,
  type AuthProvider,
  type ResolvedHost,
  type ReqLike,
  type SignupObserver,
  type UpstreamIdentity,
} from './auth.provider';
import { verifyJwtHs256, JwtError, type JwtClaims } from './jwt';
import type { WorkspaceProjection } from './workspace-projection';

type WorkOsEnv = Pick<
  ServerEnv,
  'JWT_SECRET' | 'JWT_ISSUER' | 'JWT_AUDIENCE' | 'SEED_DEMO_FORM' | 'ONBOARDING_WIZARD'
>;

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
    /** Optional; omitted means nothing observes signups (the fork default). */
    private readonly onSignup?: SignupObserver,
    /**
     * Optional; present when the identity service's workspaces are the
     * workspaces (`IAM_BASE_URL` set). Then HOME is whatever the identity
     * service says the person opened last, and the local rows are a projection
     * of their upstream memberships. Absent = the token's `account_id` IS the
     * one local account (pre-0015 shape; still what tests and forks get).
     */
    private readonly projection?: WorkspaceProjection,
  ) {
    if (!env.JWT_SECRET) {
      // Defensive: the factory already guards this, but never run without a key.
      throw new Error('WorkOsAuthProvider requires JWT_SECRET.');
    }
    this.secret = env.JWT_SECRET;
  }

  /** Verify the bearer and read the claims this provider relies on. */
  private verify(req: ReqLike): { token: string; claims: JwtClaims; sub: string; accountExtId: string } {
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
    return { token, claims, sub, accountExtId };
  }

  async resolveUpstream(req: ReqLike): Promise<UpstreamIdentity | null> {
    if (!this.projection) return null;
    const { token, claims, sub, accountExtId } = this.verify(req);
    return {
      sub,
      iamAccountId: accountExtId,
      email: typeof claims.email === 'string' ? claims.email : null,
      displayName: typeof claims.name === 'string' ? claims.name : null,
      bearer: token,
    };
  }

  async resolveHost(req: ReqLike): Promise<ResolvedHost> {
    const { token, claims, sub, accountExtId } = this.verify(req);

    if (this.projection) {
      const upstream: UpstreamIdentity = {
        sub,
        iamAccountId: accountExtId,
        email: typeof claims.email === 'string' ? claims.email : null,
        displayName: typeof claims.name === 'string' ? claims.name : null,
        bearer: token,
      };
      const state = await this.projection.ensure(upstream);
      const home = await this.projection.home(upstream, state);
      if (home) return home;
      // Nothing upstream and nothing local for this person. The identity
      // service creates a workspace at signup, so this is not expected — fall
      // through to the token-account path rather than refuse a valid token,
      // and the next projection pass rebinds that row once a workspace exists.
      this.log.warn(`no upstream workspace for ${sub}; falling back to token account ${accountExtId}`);
    }

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
        // An adopted invite IS a signup — this is the person's first login, and
        // the only difference is that a teammate created the row ahead of them.
        // The role is whatever the invite granted, so it is read back rather
        // than assumed. Never the account's first member: an invite implies one.
        //
        // Gated on there being an observer at all: with none wired (the fork
        // default) this login must cost exactly what it did before. Scoped by
        // account_id like every other member read here — `invited.id` was
        // already resolved within the account, but a member query without that
        // predicate is the pattern that eventually leaks one.
        if (this.onSignup) {
          const invitedRole = await this.db.get<{ role: AccountRole }>(
            sql`SELECT role FROM member
                WHERE id = ${invited.id} AND account_id = ${accountId} LIMIT 1`,
          );
          notifySignup(this.onSignup, this.log, {
            accountId,
            memberId: invited.id,
            email,
            role: invitedRole?.role ?? 'member',
            isFirstMember: false,
            fromInvite: true,
          });
        }
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
      await maybeSeedDemoForm(this.db, accountId, this.env, this.log);
    }
    // Fires only here, after the INSERT won: every earlier return in this method
    // is an existing member signing in again, which is not a signup. `row.id`
    // rather than `id` because a concurrent first login may have won the
    // ON CONFLICT race — the observer must name the member that actually exists.
    notifySignup(this.onSignup, this.log, {
      accountId,
      memberId: row.id,
      email,
      role,
      isFirstMember: role === 'owner',
      fromInvite: false,
    });
    return row.id;
  }
}
