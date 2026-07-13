/**
 * Short public links — the data side. Pure rules (alphabet, validation,
 * handle derivation, the premium gate) live in @slate/engine; this module owns
 * everything that needs the DB:
 *   - unique short-code generation (collision retry across code/vanity/alias)
 *   - the account_alias ledger (retired codes resolve forever — no broken links)
 *   - vanity-slug claiming (validation + global uniqueness; old codes alias)
 *   - auto-handle assignment + the one-time backfills run by migrate()
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  deriveHandleBase,
  generateShortCode,
  handleCandidate,
  isReservedPublicSlug,
  validateVanitySlug,
} from '@slate/engine';
import type { Db } from './client';

/** The code public URLs should use: the vanity slug when claimed, else the short code. */
export function canonicalPublicCode(account: { code: string; vanity_slug?: string | null }): string {
  return account.vanity_slug ?? account.code;
}

/** Is `value` already taken as a public code anywhere (code, vanity, alias)? */
export async function publicCodeInUse(
  db: Db,
  value: string,
  excludeAccountId?: string,
): Promise<boolean> {
  const owner = await db.get<{ id: string }>(
    sql`SELECT id FROM account WHERE code = ${value} OR vanity_slug = ${value} LIMIT 1`,
  );
  if (owner) return owner.id !== excludeAccountId;
  const alias = await db.get<{ account_id: string }>(
    sql`SELECT account_id FROM account_alias WHERE alias = ${value} LIMIT 1`,
  );
  if (alias) return alias.account_id !== excludeAccountId;
  return false;
}

/**
 * A globally-unique short code: random candidates from the unambiguous
 * alphabet, retried on collision (against codes, vanity slugs, aliases AND the
 * reserved-word list — 6-char route words like `signup` are valid code shapes).
 * 32^6 ≈ 1e9 codes means collisions are vanishingly rare; the loop is a
 * correctness guarantee, not a hot path. `gen` is injectable for tests.
 */
export async function generateUniqueShortCode(
  db: Db,
  gen: () => string = generateShortCode,
): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = gen();
    if (isReservedPublicSlug(candidate)) continue;
    if (!(await publicCodeInUse(db, candidate))) return candidate;
  }
  throw new Error('short-code generation exhausted retries (50) — check the alias/code tables');
}

/**
 * JIT-create an account with a fresh short code, race-safely. Idempotency is
 * anchored on `external_id` (ON CONFLICT DO NOTHING), but that clause does not
 * cover the 1-in-a-billion CODE collision two concurrent creations can hit —
 * so a code-conflict INSERT failure regenerates and retries instead of
 * bubbling a 500 into the login path. Callers re-select by external_id after.
 */
export async function insertAccountWithShortCode(
  db: Db,
  args: { name: string; externalId: string },
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = await generateUniqueShortCode(db);
    try {
      await db.run(
        sql`INSERT INTO account (id, code, name, external_id, created_at)
            VALUES (${randomUUID()}, ${code}, ${args.name}, ${args.externalId}, ${Date.now()})
            ON CONFLICT (external_id) DO NOTHING`,
      );
      return;
    } catch {
      // A concurrent creation either won on external_id (we're done — the
      // caller's re-select finds it) or stole this code (regenerate + retry).
      const winner = await db.get<{ id: string }>(
        sql`SELECT id FROM account WHERE external_id = ${args.externalId} LIMIT 1`,
      );
      if (winner) return;
    }
  }
  throw new Error('account creation exhausted short-code retries');
}

/** Record a retired public code so it resolves (and 308s) forever. Idempotent. */
export async function addAccountAlias(db: Db, accountId: string, alias: string): Promise<void> {
  try {
    await db.run(
      sql`INSERT INTO account_alias (alias, account_id, created_at)
          VALUES (${alias}, ${accountId}, ${Date.now()})`,
    );
  } catch {
    // Alias already recorded (PK) — idempotent no-op.
  }
}

export type VanityOutcome =
  | { ok: true; vanitySlug: string | null }
  | { ok: false; reason: 'invalid' | 'reserved' | 'taken' };

/**
 * Claim (or clear, with `null`) the account's vanity slug. The ENTITLEMENT
 * gate is the caller's job (API policy layer) — this enforces shape, reserved
 * words, and global uniqueness, and keeps every previously-published code
 * resolving by aliasing the replaced vanity.
 */
export async function setVanitySlug(
  db: Db,
  accountId: string,
  slug: string | null,
): Promise<VanityOutcome> {
  const current = await db.get<{ vanity_slug: string | null }>(
    sql`SELECT vanity_slug FROM account WHERE id = ${accountId} LIMIT 1`,
  );
  if (!current) return { ok: false, reason: 'taken' };

  if (slug === null) {
    if (current.vanity_slug) {
      await addAccountAlias(db, accountId, current.vanity_slug);
      await db.run(sql`UPDATE account SET vanity_slug = NULL WHERE id = ${accountId}`);
    }
    return { ok: true, vanitySlug: null };
  }

  const s = slug.toLowerCase();
  const issue = validateVanitySlug(s);
  if (issue) return { ok: false, reason: issue };
  if (await publicCodeInUse(db, s, accountId)) return { ok: false, reason: 'taken' };

  if (current.vanity_slug && current.vanity_slug !== s) {
    await addAccountAlias(db, accountId, current.vanity_slug);
  }
  // If this account itself held `s` as an alias (re-claiming an old vanity),
  // drop the alias row — it's canonical again.
  await db.run(sql`DELETE FROM account_alias WHERE alias = ${s} AND account_id = ${accountId}`);
  try {
    await db.run(sql`UPDATE account SET vanity_slug = ${s} WHERE id = ${accountId}`);
  } catch {
    // Concurrent claim of the same slug lost the race to the UNIQUE index
    // (account_vanity_slug_uq): the check-then-act above can't see it, the
    // index does. Same taken outcome as the pre-check, never a 500.
    return { ok: false, reason: 'taken' };
  }
  return { ok: true, vanitySlug: s };
}

/** Persist the IAM entitlement verdict cache (IAM stays the source of truth). */
export async function cacheEntitlement(
  db: Db,
  accountId: string,
  verdict: 'paid' | 'free',
): Promise<void> {
  await db.run(
    sql`UPDATE account SET dapta_entitlement = ${verdict}, entitlement_checked_at = ${Date.now()}
        WHERE id = ${accountId}`,
  );
}

/**
 * A free handle for a new/handle-less member: `fgomez`, then `fgomez2`… —
 * checked against the account's members and the reserved route words. The
 * "no handle" state is dead: every member gets one at creation/backfill.
 */
export async function deriveUniqueHandle(
  db: Db,
  accountId: string,
  displayName: string | null | undefined,
  email: string | null | undefined,
): Promise<string> {
  const base = deriveHandleBase(displayName, email);
  for (let n = 1; n < 1000; n++) {
    const candidate = handleCandidate(base, n).slice(0, 40);
    if (isReservedPublicSlug(candidate)) continue;
    const taken = await db.get<{ id: string }>(
      sql`SELECT id FROM member WHERE account_id = ${accountId} AND handle = ${candidate} LIMIT 1`,
    );
    if (!taken) return candidate;
  }
  // Unreachable in practice (1000 collisions on one base in one account).
  return `host-${randomUUID().slice(0, 8)}`;
}

// --- One-time data fixups (run by migrate() after the SQL migrations) -------

/** Machine-garbage code shapes that get re-coded (all real WorkOS/dev accounts). */
const LEGACY_CODE = /^(acct|dev)-/;

/**
 * Re-code legacy accounts: `acct-…`/`dev-…` codes become 6-char short codes;
 * the old code turns into a permanent alias (no broken links). Idempotent —
 * re-coded accounts no longer match the legacy pattern. Pretty hand-picked
 * codes (e.g. the seeded `acme`) are already short and stay canonical.
 */
export async function backfillAccountShortCodes(db: Db): Promise<number> {
  const rows = await db.all<{ id: string; code: string }>(
    sql`SELECT id, code FROM account WHERE code LIKE 'acct-%' OR code LIKE 'dev-%'`,
  );
  for (const row of rows) {
    if (!LEGACY_CODE.test(row.code)) continue;
    const shortCode = await generateUniqueShortCode(db);
    await addAccountAlias(db, row.id, row.code);
    await db.run(sql`UPDATE account SET code = ${shortCode} WHERE id = ${row.id}`);
  }
  return rows.length;
}

/** Every member gets a handle: derive + suffix for the ones created before auto-assign. */
export async function backfillMemberHandles(db: Db): Promise<number> {
  const rows = await db.all<{
    id: string;
    account_id: string;
    display_name: string | null;
    email: string | null;
  }>(
    sql`SELECT id, account_id, display_name, email FROM member
        WHERE handle IS NULL OR handle = '' ORDER BY created_at ASC, id ASC`,
  );
  for (const row of rows) {
    const handle = await deriveUniqueHandle(db, row.account_id, row.display_name, row.email);
    await db.run(sql`UPDATE member SET handle = ${handle} WHERE id = ${row.id}`);
  }
  return rows.length;
}

/** All short-link data fixups; idempotent and cheap when there is nothing to fix. */
export async function applyShortLinkFixups(db: Db): Promise<void> {
  await backfillAccountShortCodes(db);
  await backfillMemberHandles(db);
}
