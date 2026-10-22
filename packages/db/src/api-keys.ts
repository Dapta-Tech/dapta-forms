/**
 * API keys (public API v1, migration 0024). A key belongs to one member in one
 * workspace and acts as that person: their role is read on every request and
 * the key stops working the moment they are no longer an active member there.
 *
 * Only the SHA-256 of a key is stored (`key_hash`), with its first characters
 * (`prefix`, unique) and its last four (`last4`, what the Developers page
 * shows). The key in clear is the caller's to keep: this layer never sees it.
 * Hashing and the key format live with the API, which is the only writer.
 *
 * Revoking is a soft delete (`revoked_at_ms`): a revoked key never lists and
 * never authenticates, but the row stays for the record.
 *
 * A key follows its member: whatever takes a member out of a workspace
 * (disabled, removed, dropped by the identity service) revokes their keys in
 * the same transaction (`revokeKeysOfInactiveMembersSql`), so reactivating the
 * member later never brings an old key back.
 *
 * A key the deployment's staff create through a staff access grant belongs to
 * the grant row (an `admin` of that workspace) and acts as it. It is a
 * credential of the workspace, not of the person: it keeps working after they
 * stop being staff, until someone revokes it. Grant rows are never disabled,
 * so revoking is the only way such a key ends.
 */
import { randomUUID } from "node:crypto";
import type { SQL } from "drizzle-orm";
import { sql, type Db } from "./client";
import type { AccountRole } from "./members";

/** How many ACTIVE keys one member may hold in one workspace. */
export const API_KEY_LIMIT_PER_MEMBER = 10;

/** Who created a key, as the list names them. `name`/`email` are null when the member row has none. */
export interface ApiKeyCreator {
  memberId: string;
  name: string | null;
  email: string | null;
  /**
   * True when the key belongs to a staff access grant row: the deployment's
   * staff created it while acting in this workspace. The Developers page marks
   * it so the workspace's owners and admins can tell it apart and revoke it.
   */
  staff: boolean;
}

/** An active key as the Developers page lists it. Never carries the hash. */
export interface ApiKeyView {
  id: string;
  name: string;
  last4: string;
  createdAt: number;
  lastUsedAt: number | null;
  createdBy: ApiKeyCreator;
}

/** One active key, scoped to its workspace, for the revoke path's ownership check. */
export interface ApiKeyRecord {
  id: string;
  accountId: string;
  memberId: string | null;
  name: string;
  last4: string;
  createdAt: number;
  lastUsedAt: number | null;
}

/**
 * What an incoming key resolves to: the key, and the member it acts as with
 * their CURRENT role and status. The status is returned rather than filtered so
 * the caller decides (and says) why a key no longer works.
 */
export interface ApiKeyPrincipalRow {
  keyId: string;
  accountId: string;
  /** The key's workspace name, so an agent can be told where it acts. */
  accountName: string;
  memberId: string;
  role: AccountRole;
  memberStatus: string;
  /**
   * `'staff'` when the key's member is a staff access grant row, that is, a
   * key the deployment's staff created in this workspace. Informational: such
   * a key authenticates like any other. A key is a credential of the
   * workspace, so it keeps working after its creator stops being staff, until
   * someone revokes it.
   */
  accessGrant: "staff" | null;
  lastUsedAt: number | null;
}

export type InsertApiKeyResult =
  | { ok: true; value: ApiKeyRecord }
  | { ok: false; reason: "KEY_LIMIT" };

const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

function toRecord(r: Record<string, unknown>): ApiKeyRecord {
  return {
    id: String(r.id),
    accountId: String(r.account_id),
    memberId: r.member_id == null ? null : String(r.member_id),
    name: String(r.name),
    last4: String(r.last4),
    createdAt: num(r.created_at),
    lastUsedAt: numOrNull(r.last_used_at_ms),
  };
}

/**
 * Store a new key for `memberId` in `accountId`, unless that member already
 * holds `API_KEY_LIMIT_PER_MEMBER` active keys there.
 *
 * The count and the insert are ONE statement (`INSERT ... SELECT ... WHERE
 * count < limit`). On SQLite that alone serializes two creates racing at nine.
 * On Postgres it does not: under READ COMMITTED both statements can count nine
 * and both insert. So there the statement runs in a transaction that first
 * takes an advisory lock on this member in this workspace; the second create
 * waits, then counts again with a fresh snapshot and sees the tenth.
 * Whether the row exists afterwards is the answer.
 */
export async function insertApiKey(
  db: Db,
  input: {
    accountId: string;
    memberId: string;
    name: string;
    keyHash: string;
    prefix: string;
    last4: string;
  },
  now: number = Date.now(),
  limit: number = API_KEY_LIMIT_PER_MEMBER,
): Promise<InsertApiKeyResult> {
  const id = randomUUID();
  const insert = sql`INSERT INTO api_key (id, account_id, member_id, name, prefix, last4, key_hash, created_at)
        SELECT ${id}, ${input.accountId}, ${input.memberId}, ${input.name}, ${input.prefix},
               ${input.last4}, ${input.keyHash}, ${now}
        WHERE (SELECT COUNT(*) FROM api_key
               WHERE account_id = ${input.accountId} AND member_id = ${input.memberId}
                 AND revoked_at_ms IS NULL) < ${limit}`;
  if (db.dialect === "postgres" && db.pg) {
    const lockKey = `api_key:${input.accountId}:${input.memberId}`;
    await db.pg.drizzle.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
      await tx.execute(insert);
    });
  } else {
    await db.run(insert);
  }
  const row = await getApiKeyById(db, input.accountId, id);
  return row ? { ok: true, value: row } : { ok: false, reason: "KEY_LIMIT" };
}

/** One ACTIVE key of this workspace; null when unknown, revoked or another workspace's. */
export async function getApiKeyById(
  db: Db,
  accountId: string,
  id: string,
): Promise<ApiKeyRecord | null> {
  const r = await db.get<Record<string, unknown>>(
    sql`SELECT id, account_id, member_id, name, last4, created_at, last_used_at_ms
        FROM api_key
        WHERE account_id = ${accountId} AND id = ${id} AND revoked_at_ms IS NULL
        LIMIT 1`,
  );
  return r ? toRecord(r) : null;
}

/**
 * The ACTIVE keys of a workspace, newest first, with who created each.
 * `memberId` narrows to that member's own keys (what a plain member sees);
 * omitted, every active key of the workspace (owner and admin).
 *
 * Only keys of members who are active there: those are the only ones that
 * authenticate. Taking a member out revokes their keys anyway; this also
 * hides a key whose member was disabled some other way (by hand, or before
 * keys followed their member). Keys the deployment's staff created through a
 * staff access grant are listed too, marked `createdBy.staff`, so the
 * workspace can see and revoke them.
 */
export async function listApiKeys(
  db: Db,
  accountId: string,
  memberId?: string,
): Promise<ApiKeyView[]> {
  const mine = memberId === undefined ? sql`` : sql` AND k.member_id = ${memberId}`;
  const rows = await db.all<Record<string, unknown>>(
    sql`SELECT k.id, k.name, k.last4, k.created_at, k.last_used_at_ms, k.member_id,
               m.display_name, m.email, m.access_grant
        FROM api_key k
        JOIN member m ON m.id = k.member_id AND m.account_id = k.account_id AND m.status = 'active'
        WHERE k.account_id = ${accountId} AND k.revoked_at_ms IS NULL${mine}
        ORDER BY k.created_at DESC, k.id ASC`,
  );
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    last4: String(r.last4),
    createdAt: num(r.created_at),
    lastUsedAt: numOrNull(r.last_used_at_ms),
    createdBy: {
      memberId: r.member_id == null ? "" : String(r.member_id),
      name: r.display_name == null ? null : String(r.display_name),
      email: r.email == null ? null : String(r.email),
      staff: r.access_grant === "staff",
    },
  }));
}

/** Revoke one active key of this workspace. False when there was nothing to revoke. */
export async function revokeApiKey(
  db: Db,
  accountId: string,
  id: string,
  now: number = Date.now(),
): Promise<boolean> {
  const existing = await getApiKeyById(db, accountId, id);
  if (!existing) return false;
  await db.run(
    sql`UPDATE api_key SET revoked_at_ms = ${now}
        WHERE account_id = ${accountId} AND id = ${id} AND revoked_at_ms IS NULL`,
  );
  return true;
}

/**
 * Revoke every active key of `accountId` whose member is no longer an ACTIVE
 * member there (disabled, back to invited, or gone). Run it in the same
 * transaction as the write that takes a member out (`runAtomically`). Keys
 * that predate `member_id` are left as they are: they never authenticate.
 */
export function revokeKeysOfInactiveMembersSql(accountId: string, now: number = Date.now()): SQL {
  return sql`UPDATE api_key SET revoked_at_ms = ${now}
      WHERE account_id = ${accountId} AND revoked_at_ms IS NULL AND member_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM member m
          WHERE m.id = api_key.member_id AND m.account_id = api_key.account_id AND m.status = 'active'
        )`;
}

/**
 * Resolve an incoming key by its hash: the active key and the member it acts
 * as, in the key's own workspace. Null when the hash is unknown, the key is
 * revoked, it predates `member_id`, or its member is no longer in that
 * workspace at all.
 */
export async function findApiKeyPrincipal(
  db: Db,
  keyHash: string,
): Promise<ApiKeyPrincipalRow | null> {
  const r = await db.get<Record<string, unknown>>(
    sql`SELECT k.id, k.account_id, k.member_id, k.last_used_at_ms, m.role, m.status, m.access_grant, a.name AS account_name
        FROM api_key k
        JOIN member m ON m.id = k.member_id AND m.account_id = k.account_id
        JOIN account a ON a.id = k.account_id
        WHERE k.key_hash = ${keyHash} AND k.revoked_at_ms IS NULL
        LIMIT 1`,
  );
  if (!r) return null;
  return {
    keyId: String(r.id),
    accountId: String(r.account_id),
    accountName: String(r.account_name ?? ""),
    memberId: String(r.member_id),
    role: ((r.role as AccountRole | null) ?? "member") as AccountRole,
    memberStatus: String(r.status ?? "active"),
    accessGrant: r.access_grant == null ? null : "staff",
    lastUsedAt: numOrNull(r.last_used_at_ms),
  };
}

/**
 * Stamp a key's last use, at most once per `throttleMs` (a minute by default).
 * The throttle lives in the WHERE, so it holds across pods: a busy key writes
 * about once a minute, not once per call.
 */
export async function touchApiKeyLastUsed(
  db: Db,
  keyId: string,
  now: number = Date.now(),
  throttleMs: number = 60_000,
): Promise<void> {
  await db.run(
    sql`UPDATE api_key SET last_used_at_ms = ${now}
        WHERE id = ${keyId}
          AND (last_used_at_ms IS NULL OR last_used_at_ms <= ${now - throttleMs})`,
  );
}
