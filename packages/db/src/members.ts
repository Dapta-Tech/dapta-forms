/**
 * Account-level member management — the workspace roster the dashboard's
 * Members/Staff page drives: list members with their role + status, invite by
 * email, change role, enable/disable, remove.
 *
 * This is the ACCOUNT role (`member.role`: owner | admin | member), distinct from
 * the per-team role (`team_membership.role`) even though the two share value
 * names. Every account keeps at least one owner (last-owner guard, mirroring the
 * team owner-protection in crud.ts). All ops are account-scoped by the caller.
 */
import { randomUUID } from 'node:crypto';
import { sql, type Db } from './client';
import type { CrudResult } from './crud';
import { deriveUniqueHandle } from './short-links';
import { getAccountByCode, parseJsonColumn } from './forms';

/** Account-level roles, most-privileged first. */
export const ACCOUNT_ROLES = ['owner', 'admin', 'member'] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

/** Member lifecycle within a workspace. */
export const MEMBER_STATUSES = ['active', 'invited', 'disabled'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export interface MemberView {
  id: string;
  email: string | null;
  displayName: string | null;
  handle: string | null;
  avatarUrl: string | null;
  role: AccountRole;
  status: MemberStatus;
  createdAt: number;
}

interface MemberDbRow {
  id: string;
  email: string | null;
  display_name: string | null;
  handle: string | null;
  avatar_url: string | null;
  role: string;
  status: string;
  created_at: number;
}

function toMemberView(r: MemberDbRow): MemberView {
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    handle: r.handle,
    avatarUrl: r.avatar_url,
    role: (r.role as AccountRole) ?? 'member',
    status: (r.status as MemberStatus) ?? 'active',
    createdAt: r.created_at,
  };
}

const MEMBER_COLS = sql`id, email, display_name, handle, avatar_url, role, status, created_at`;

/** All members of an account, oldest first (owner typically leads). */
export async function listMembers(db: Db, accountId: string): Promise<MemberView[]> {
  const rows = await db.all<MemberDbRow>(
    sql`SELECT ${MEMBER_COLS} FROM member WHERE account_id = ${accountId} ORDER BY created_at ASC, id ASC`,
  );
  return rows.map(toMemberView);
}

/** A single account member (scoped) — used by the permission layer + PATCH/DELETE. */
export async function getAccountMember(
  db: Db,
  accountId: string,
  memberId: string,
): Promise<MemberView | null> {
  const r = await db.get<MemberDbRow>(
    sql`SELECT ${MEMBER_COLS} FROM member WHERE account_id = ${accountId} AND id = ${memberId} LIMIT 1`,
  );
  return r ? toMemberView(r) : null;
}

/**
 * The caller's account role, or null if the member is unknown/foreign. The
 * permission layer resolves this from the AuthProvider principal's memberId.
 */
export async function getMemberRole(
  db: Db,
  accountId: string,
  memberId: string,
): Promise<AccountRole | null> {
  const r = await db.get<{ role: string }>(
    sql`SELECT role FROM member WHERE account_id = ${accountId} AND id = ${memberId} LIMIT 1`,
  );
  return r ? ((r.role as AccountRole) ?? 'member') : null;
}

/** Count active owners other than `excludeMemberId` (for the last-owner guard). */
async function otherActiveOwners(
  db: Db,
  accountId: string,
  excludeMemberId: string,
): Promise<number> {
  const row = await db.get<{ n: number }>(
    sql`SELECT COUNT(*) AS n FROM member
        WHERE account_id = ${accountId} AND role = 'owner' AND status = 'active'
          AND id <> ${excludeMemberId}`,
  );
  return Number(row?.n ?? 0);
}

const EMAIL_LOCAL = (email: string) => email.split('@')[0] ?? email;

/**
 * Invite a member by email → creates an `invited` member row with the given role
 * so they can be granted access before they ever sign in. An owner cannot be
 * invited (ownership is transferred, never handed out). A repeat email in the
 * same account is refused (EMAIL_TAKEN) rather than creating a duplicate.
 */
export async function inviteMember(
  db: Db,
  accountId: string,
  input: { email: string; role?: 'admin' | 'member'; displayName?: string | null },
): Promise<CrudResult<MemberView>> {
  const email = input.email.trim().toLowerCase();
  if (!email) return { ok: false, reason: 'CONFLICT', message: 'An email is required.' };
  const role: AccountRole = input.role === 'admin' ? 'admin' : 'member';

  const clash = await db.get<{ id: string }>(
    sql`SELECT id FROM member WHERE account_id = ${accountId} AND lower(email) = ${email} LIMIT 1`,
  );
  if (clash)
    return { ok: false, reason: 'EMAIL_TAKEN', message: 'A member with that email already exists.' };

  const id = randomUUID();
  // Auto-handle at creation (short-links §3): invited members are bookable the
  // moment they accept — no "set a handle" step, freely renameable later.
  const handle = await deriveUniqueHandle(db, accountId, input.displayName, email);
  await db.run(
    sql`INSERT INTO member (id, account_id, email, display_name, handle, role, status, created_at)
        VALUES (${id}, ${accountId}, ${email}, ${input.displayName ?? EMAIL_LOCAL(email)},
          ${handle}, ${role}, ${'invited'}, ${Date.now()})`,
  );
  return { ok: true, value: (await getAccountMember(db, accountId, id))! };
}

/**
 * Change a member's account role. Guards the last owner: demoting the sole active
 * owner would leave the workspace ownerless (LAST_OWNER). Promoting to owner is
 * allowed (co-owners), mirroring the team owner model.
 */
export async function changeMemberRole(
  db: Db,
  accountId: string,
  memberId: string,
  role: AccountRole,
): Promise<CrudResult<MemberView>> {
  if (!ACCOUNT_ROLES.includes(role))
    return { ok: false, reason: 'CONFLICT', message: 'Unknown role.' };
  const current = await getAccountMember(db, accountId, memberId);
  if (!current) return { ok: false, reason: 'NOT_FOUND' };
  if (current.role === role) return { ok: true, value: current };

  if (current.role === 'owner' && role !== 'owner') {
    if ((await otherActiveOwners(db, accountId, memberId)) === 0)
      return { ok: false, reason: 'LAST_OWNER', message: 'A workspace must keep at least one owner.' };
  }
  await db.run(sql`UPDATE member SET role = ${role} WHERE account_id = ${accountId} AND id = ${memberId}`);
  return { ok: true, value: (await getAccountMember(db, accountId, memberId))! };
}

/**
 * Enable/disable a member (soft access revocation). Disabling an owner is guarded
 * the same as demotion — the account must retain an active owner.
 */
export async function setMemberStatus(
  db: Db,
  accountId: string,
  memberId: string,
  status: MemberStatus,
): Promise<CrudResult<MemberView>> {
  if (!MEMBER_STATUSES.includes(status))
    return { ok: false, reason: 'CONFLICT', message: 'Unknown status.' };
  const current = await getAccountMember(db, accountId, memberId);
  if (!current) return { ok: false, reason: 'NOT_FOUND' };
  if (current.role === 'owner' && status !== 'active') {
    if ((await otherActiveOwners(db, accountId, memberId)) === 0)
      return { ok: false, reason: 'LAST_OWNER', message: 'A workspace must keep at least one owner.' };
  }
  await db.run(
    sql`UPDATE member SET status = ${status} WHERE account_id = ${accountId} AND id = ${memberId}`,
  );
  return { ok: true, value: (await getAccountMember(db, accountId, memberId))! };
}

/**
 * Remove a member from the workspace. Guards the last owner. Forms are
 * account-owned (not member-owned), so removing a member leaves the account's
 * forms and their submissions intact — only the roster row is deleted.
 */
export async function removeMember(
  db: Db,
  accountId: string,
  memberId: string,
): Promise<CrudResult<{ id: string }>> {
  const current = await getAccountMember(db, accountId, memberId);
  if (!current) return { ok: true, value: { id: memberId } }; // already gone — idempotent
  if (current.role === 'owner') {
    if ((await otherActiveOwners(db, accountId, memberId)) === 0)
      return { ok: false, reason: 'LAST_OWNER', message: 'A workspace must keep at least one owner.' };
  }
  await db.run(sql`DELETE FROM member WHERE account_id = ${accountId} AND id = ${memberId}`);
  return { ok: true, value: { id: memberId } };
}

/**
 * Flip a member from `invited` to `active` the first time they resolve.
 *
 * Deliberately narrow: ONLY the invited → active transition. A `disabled`
 * member logging in must stay disabled — reviving them would defeat the point
 * of disabling — and an already-active member must not be rewritten on every
 * request. The WHERE clause enforces both, so this is a no-op for everyone
 * except the person whose invite just landed.
 */
export async function activateInvitedMember(
  db: Db,
  accountId: string,
  memberId: string,
): Promise<void> {
  await db.run(
    sql`UPDATE member SET status = 'active'
        WHERE id = ${memberId} AND account_id = ${accountId} AND status = 'invited'`,
  );
}

// --- Workspaces (the accounts one person belongs to) --------------------------

/**
 * Who is asking, independent of which account they are currently in.
 *
 * `externalId` is the identity provider's stable subject (the JWT `sub`) and is
 * the right key when there is one. `email` is the fallback for the local dev
 * provider, whose JIT members carry no external id — and it is also how an
 * INVITE binds: an admin types an address, and whoever proves control of that
 * address is that member. Both come from an already-authenticated principal;
 * neither is ever read from the request.
 */
export interface MemberIdentity {
  externalId: string | null;
  email: string | null;
}

/** One account this person can act in. */
export interface WorkspaceRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  memberId: string;
  role: AccountRole;
  /** `invited` until they first enter it — the switcher marks these as pending. */
  status: MemberStatus;
}

/**
 * Read the identity of an already-resolved member, so the caller can look for
 * the same person elsewhere. Returns null for a member that does not exist.
 */
export async function getMemberIdentity(
  db: Db,
  accountId: string,
  memberId: string,
): Promise<MemberIdentity | null> {
  const r = await db.get<{ external_id: string | null; email: string | null }>(
    sql`SELECT external_id, email FROM member WHERE id = ${memberId} AND account_id = ${accountId} LIMIT 1`,
  );
  if (!r) return null;
  return { externalId: r.external_id ?? null, email: r.email ?? null };
}

/**
 * Every account this person can enter — the ones they are in, plus the ones
 * they have been invited to and not yet opened.
 *
 * The data model has always allowed this — uniqueness on `member` is per
 * account, and `inviteMember` writes a row into the INVITING account — but
 * nothing ever read it back. Login resolves one row and stops
 * (`ORDER BY created_at LIMIT 1`), so an invited teammate signed in and landed
 * in their own oldest account, and the invitation led nowhere at all. This is
 * the query that was missing.
 *
 * `invited` rows ARE listed: an invitation you cannot see is an invitation that
 * does not work, and entering one is what accepting it means. `disabled` rows
 * never appear — a revoked membership must not be reachable by picking it out
 * of a menu.
 */
export async function listWorkspacesForIdentity(
  db: Db,
  identity: MemberIdentity,
): Promise<WorkspaceRow[]> {
  const email = identity.email?.trim().toLowerCase() || null;
  const externalId = identity.externalId || null;
  if (!email && !externalId) return [];

  // Match on EITHER key. A person can hold rows created by two different paths
  // — an IAM-provisioned one carrying `external_id`, and an invite that only
  // ever knew their address — and both are the same human.
  const rows = await db.all<{
    account_id: string;
    code: string;
    name: string;
    member_id: string;
    role: string;
    status: string;
  }>(
    sql`SELECT a.id AS account_id, a.code, a.name, m.id AS member_id, m.role, m.status
        FROM member m JOIN account a ON a.id = m.account_id
        WHERE m.status IN ('active', 'invited')
          AND (
            (${externalId} IS NOT NULL AND m.external_id = ${externalId})
            OR (${email} IS NOT NULL AND lower(m.email) = ${email})
          )
        ORDER BY a.name ASC, a.created_at ASC`,
  );

  // The same account can match on both keys (one row, two predicates) — and in
  // principle a person could hold two member rows in one account. Collapse to
  // one entry per account so the switcher never lists a workspace twice.
  const seen = new Set<string>();
  const out: WorkspaceRow[] = [];
  for (const r of rows) {
    if (seen.has(r.account_id)) continue;
    seen.add(r.account_id);
    out.push({
      accountId: r.account_id,
      accountCode: r.code,
      accountName: r.name,
      memberId: r.member_id,
      role: (ACCOUNT_ROLES as readonly string[]).includes(r.role)
        ? (r.role as AccountRole)
        : 'member',
      status: (MEMBER_STATUSES as readonly string[]).includes(r.status)
        ? (r.status as MemberStatus)
        : 'active',
    });
  }
  return out;
}

/**
 * Resolve this person's membership in one specific account, or null.
 *
 * This is the authorization check behind the workspace switch — the only thing
 * standing between an account id someone asked for and another tenant's data.
 * It re-derives membership from the database on every request and never trusts
 * anything the request carried.
 */
export async function findMembership(
  db: Db,
  identity: MemberIdentity,
  accountId: string,
): Promise<WorkspaceRow | null> {
  const all = await listWorkspacesForIdentity(db, identity);
  return all.find((w) => w.accountId === accountId) ?? null;
}

// --- Public member page (the /[accountCode]/[handle] route) -------------------

/** One published form as the public profile lists it. */
export interface ProfileFormRow {
  slug: string;
  /** The private dashboard label — the fallback when no public title is set. */
  name: string;
  /** The author's public title, when the form has one. */
  title: string | null;
}

/** A member's stored public page + the identity fields it renders alongside. */
export interface MemberProfileRow {
  memberId: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  /** The raw JSON blob, or null when this member has no page. */
  profile: unknown;
}

/**
 * The member behind a public handle URL, resolved through the SAME account
 * lookup the public form route uses — so a retired account code keeps working
 * here too, rather than 404-ing only on profiles.
 *
 * Handles are compared case-insensitively: a URL is typed by hand far more often
 * than a slug is, and `/acme/Alex` failing while `/acme/alex` works would read
 * as the page being gone.
 */
export async function getMemberByHandle(
  db: Db,
  accountCode: string,
  handle: string,
): Promise<MemberProfileRow | null> {
  const account = await getAccountByCode(db, accountCode);
  if (!account) return null;
  const r = await db.get<Record<string, unknown>>(
    sql`SELECT id, handle, display_name, avatar_url, profile FROM member
        WHERE account_id = ${account.id} AND lower(handle) = ${handle.toLowerCase()}
          AND status = 'active'
        LIMIT 1`,
  );
  if (!r) return null;
  return {
    memberId: String(r.id),
    handle: r.handle == null ? null : String(r.handle),
    displayName: r.display_name == null ? null : String(r.display_name),
    avatarUrl: r.avatar_url == null ? null : String(r.avatar_url),
    profile: r.profile == null ? null : parseJsonColumn<unknown>(r.profile, null),
  };
}

/**
 * The PUBLISHED forms belonging to a member's account.
 *
 * Scoped to the account rather than the member because a form has no author
 * column — which also means this lists the account's forms, not personally
 * "theirs". The profile's `formSlugs` is what narrows it, and the caller applies
 * that; keeping the filter out of SQL means an empty list stays distinguishable
 * from an absent one.
 */
export async function listPublishedFormsForAccount(
  db: Db,
  accountCode: string,
): Promise<ProfileFormRow[]> {
  const account = await getAccountByCode(db, accountCode);
  if (!account) return [];
  // `config` rides along so the listing can show the PUBLIC title. The column is
  // jsonb on Postgres and TEXT on SQLite, so the extraction happens here in JS
  // rather than in dialect-specific SQL.
  const rows = await db.all<Record<string, unknown>>(
    sql`SELECT slug, name, config FROM form WHERE account_id = ${account.id} ORDER BY created_at ASC`,
  );
  return rows.map((r) => {
    const config = parseJsonColumn<{ title?: unknown }>(r.config, {});
    const title = typeof config.title === 'string' && config.title.trim() ? config.title.trim() : null;
    return { slug: String(r.slug), name: String(r.name), title };
  });
}

/**
 * The public page write path — compare-and-set over a per-member revision.
 *
 * A save whose answer never reaches the browser is ambiguous: the client-side
 * timeout does not abort the write. Content cannot settle it (the stored value
 * may equal what was sent, by coincidence or by an ABA sequence) and neither
 * can a plain reread (it can overtake the in-flight write and return the old
 * value). A counter can: every writer below increments it by exactly one, so a
 * caller that knows the revision it started from can ask about ITS write.
 *
 * These three functions are the ONLY writers of `member.profile`, and each one
 * increments the revision in the same statement that touches the blob — there
 * is no path that moves the profile without moving the counter.
 * `member-profile-revision.spec.ts` pins that closed set against the source.
 *
 * NULL revision is a pre-0016 row and means logical 0, so every predicate and
 * increment goes through coalesce(profile_revision, 0).
 */

/** Authoritative profile state: the stored blob and the revision behind it. */
export interface MemberProfileState {
  /** The raw JSON blob, or null when this member has no page. */
  profile: unknown;
  revision: number;
}

/**
 * Outcome of a revision-guarded write.
 * - `ok`: this caller's write landed; state is what it produced.
 * - `conflict`: the row moved on — the expected revision can never land now.
 *   Carries authoritative state and burns NO revision.
 * - `not_found`: no such member in this account.
 */
export type ProfileWriteResult =
  | { status: 'ok'; profile: unknown; revision: number }
  | { status: 'conflict'; profile: unknown; revision: number }
  | { status: 'not_found' };

/** Postgres serialization failure — retryable, and here it means "re-decide". */
const PG_SERIALIZATION_FAILURE = '40001';

const isSerializationFailure = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: unknown }).code === PG_SERIALIZATION_FAILURE;

/**
 * A revision read off a row, as a number we can compare and hand out.
 *
 * Postgres drivers may return an integer column as a string (bigint coercion
 * rules bite even on int4 once a driver is configured for it) and SQLite hands
 * back whatever the column holds, so every read normalizes here rather than at
 * a dozen call sites. A value that is not a safe non-negative integer is
 * corruption, not a state to reconcile from — it fails loudly instead of
 * silently reconciling against a wrong number.
 */
export function normalizeProfileRevision(raw: unknown): number {
  const n = Number(raw ?? 0);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(`member.profile_revision is not a safe non-negative integer: ${String(raw)}`);
  }
  return n;
}

/** Read the authoritative profile + revision for one member (account-scoped). */
export async function getMemberProfileState(
  db: Db,
  accountId: string,
  memberId: string,
): Promise<MemberProfileState | null> {
  const r = await db.get<Record<string, unknown>>(
    sql`SELECT profile, coalesce(profile_revision, 0) AS profile_revision
          FROM member WHERE id = ${memberId} AND account_id = ${accountId} LIMIT 1`,
  );
  if (!r) return null;
  return {
    profile: r.profile == null ? null : parseJsonColumn<unknown>(r.profile, null),
    revision: normalizeProfileRevision(r.profile_revision),
  };
}

/** Shape one RETURNING row into an `ok` result. */
function writtenState(r: Record<string, unknown>): ProfileWriteResult {
  return {
    status: 'ok',
    profile: r.profile == null ? null : parseJsonColumn<unknown>(r.profile, null),
    revision: normalizeProfileRevision(r.profile_revision),
  };
}

/**
 * Why zero rows changed: the member is gone (or belongs to another account), or
 * the revision moved. Re-read account-scoped so a wrong account can never be
 * answered with someone else's state.
 */
async function explainNoRows(
  db: Db,
  accountId: string,
  memberId: string,
): Promise<ProfileWriteResult> {
  const current = await getMemberProfileState(db, accountId, memberId);
  if (!current) return { status: 'not_found' };
  return { status: 'conflict', profile: current.profile, revision: current.revision };
}

/**
 * Replace a member's public page if — and only if — the row is still at
 * `expectedRevision`. One atomic statement: the guard, the write and the
 * increment cannot be separated by another writer.
 */
export async function casSetMemberProfile(
  db: Db,
  accountId: string,
  memberId: string,
  profile: unknown | null,
  expectedRevision: number,
): Promise<ProfileWriteResult> {
  const expected = normalizeProfileRevision(expectedRevision);
  try {
    const rows = await db.all<Record<string, unknown>>(
      sql`UPDATE member
             SET profile = ${profile == null ? null : JSON.stringify(profile)},
                 profile_revision = coalesce(profile_revision, 0) + 1
           WHERE id = ${memberId} AND account_id = ${accountId}
             AND coalesce(profile_revision, 0) = ${expected}
       RETURNING profile, profile_revision`,
    );
    const row = rows[0];
    if (row) return writtenState(row);
  } catch (e) {
    // A serialization failure means this write definitely did not commit, so
    // the caller's expected revision is simply no longer decidable here — that
    // is the conflict path, not a permanent unknown. Anything else propagates.
    if (!isSerializationFailure(e)) throw e;
  }
  return explainNoRows(db, accountId, memberId);
}

/**
 * Order one ambiguous write without touching content.
 *
 * Same predicate as the CAS, same single increment, but the profile is left
 * exactly as it is. Winning proves the ambiguous CAS never landed and can never
 * land (its expected revision is now spent). Losing proves something else got
 * there first, and the authoritative state comes back so the caller can adopt
 * it instead of guessing.
 *
 * A same-value profile write would not do: the blob passes through schema
 * normalization, so "write what is already there" can still change bytes.
 */
export async function fenceMemberProfile(
  db: Db,
  accountId: string,
  memberId: string,
  expectedRevision: number,
): Promise<ProfileWriteResult> {
  const expected = normalizeProfileRevision(expectedRevision);
  try {
    const rows = await db.all<Record<string, unknown>>(
      sql`UPDATE member
             SET profile_revision = coalesce(profile_revision, 0) + 1
           WHERE id = ${memberId} AND account_id = ${accountId}
             AND coalesce(profile_revision, 0) = ${expected}
       RETURNING profile, profile_revision`,
    );
    const row = rows[0];
    if (row) return writtenState(row);
  } catch (e) {
    if (!isSerializationFailure(e)) throw e;
  }
  return explainNoRows(db, accountId, memberId);
}

/**
 * DEPRECATED — the last-write-wins writer, for the `/v1` compatibility shim
 * only (see `PROFILE_V1_WRITE_SHIM`). Remove with the shim.
 *
 * It cannot check a revision, because the web build that calls it does not know
 * revisions exist. It still increments in the same statement as the write, so a
 * fence stays monotonic and decidable even while an old tab is saving.
 */
export async function overwriteMemberProfileLegacy(
  db: Db,
  accountId: string,
  memberId: string,
  profile: unknown | null,
): Promise<ProfileWriteResult> {
  const rows = await db.all<Record<string, unknown>>(
    sql`UPDATE member
           SET profile = ${profile == null ? null : JSON.stringify(profile)},
               profile_revision = coalesce(profile_revision, 0) + 1
         WHERE id = ${memberId} AND account_id = ${accountId}
     RETURNING profile, profile_revision`,
  );
  const row = rows[0];
  if (row) return writtenState(row);
  return { status: 'not_found' };
}
