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
import type { SQL } from 'drizzle-orm';
import type { CrudResult } from './crud';
import { deriveUniqueHandle } from './short-links';
import { getAccountByCode, parseJsonColumn } from './forms';

/** Account-level roles, most-privileged first. */
export const ACCOUNT_ROLES = ['owner', 'admin', 'member'] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

/** Member lifecycle within a workspace. */
export const MEMBER_STATUSES = ['active', 'invited', 'disabled'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

/** Why a member row exists when the identity service holds no membership: staff of the deployment. */
export type AccessGrant = 'staff';

export interface MemberView {
  id: string;
  email: string | null;
  displayName: string | null;
  handle: string | null;
  avatarUrl: string | null;
  role: AccountRole;
  status: MemberStatus;
  createdAt: number;
  /** `null` for a real membership; `'staff'` for a domain-based access grant (0016). */
  accessGrant: AccessGrant | null;
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
  access_grant: string | null;
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
    accessGrant: r.access_grant === 'staff' ? 'staff' : null,
  };
}

const MEMBER_COLS = sql`id, email, display_name, handle, avatar_url, role, status, created_at, access_grant`;

/**
 * The ROSTER of an account, oldest first (owner typically leads). Access-grant
 * rows are not on it: a customer's team list never shows the deployment's
 * staff, and a staff row is not something the team can manage.
 */
export async function listMembers(db: Db, accountId: string): Promise<MemberView[]> {
  const rows = await db.all<MemberDbRow>(
    sql`SELECT ${MEMBER_COLS} FROM member WHERE account_id = ${accountId} AND access_grant IS NULL
        ORDER BY created_at ASC, id ASC`,
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

/**
 * Whether removing/disabling/demoting `memberId` would leave the workspace with
 * no active owner. Exported so callers that write UPSTREAM FIRST can refuse
 * before the upstream write, not after.
 */
export async function wouldOrphanWorkspace(db: Db, accountId: string, memberId: string): Promise<boolean> {
  const current = await getAccountMember(db, accountId, memberId);
  if (!current || current.role !== 'owner' || current.status !== 'active') return false;
  return (await otherActiveOwners(db, accountId, memberId)) === 0;
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
  /**
   * The identity service's workspace id (`account.external_id`), null when the
   * account was never projected from one. It is the id the rest of the Dapta
   * estate knows this workspace by, so URLs that people copy between the two
   * apps carry it; the API itself always speaks `accountId`.
   */
  workspaceId: string | null;
  accountCode: string;
  accountName: string;
  memberId: string;
  role: AccountRole;
  /** `invited` until they first enter it — the switcher marks these as pending. */
  status: MemberStatus;
  /** How many ACTIVE members the workspace has (the account-settings cards show it). */
  memberCount: number;
  /** `'staff'` when the person is in this workspace by access grant, not by membership. */
  accessGrant: AccessGrant | null;
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
  //
  // The branches are assembled here, not as `(${x} IS NOT NULL AND …)` in SQL:
  // Postgres cannot infer a type for a bare parameter compared to NULL
  // ("could not determine data type of parameter $1"), and that query ran
  // only on SQLite until the switcher became always-on.
  const conds: SQL[] = [];
  if (externalId) conds.push(sql`m.external_id = ${externalId}`);
  if (email) conds.push(sql`lower(m.email) = ${email}`);
  const rows = await db.all<{
    account_id: string;
    external_id: string | null;
    code: string;
    name: string;
    member_id: string;
    role: string;
    status: string;
    member_count: number | string;
    access_grant: string | null;
  }>(
    sql`SELECT a.id AS account_id, a.external_id, a.code, a.name, m.id AS member_id, m.role, m.status, m.access_grant,
               (SELECT COUNT(*) FROM member mm
                 WHERE mm.account_id = a.id AND mm.status = 'active' AND mm.access_grant IS NULL) AS member_count
        FROM member m JOIN account a ON a.id = m.account_id
        WHERE m.status IN ('active', 'invited')
          AND (${sql.join(conds, sql` OR `)})
        ORDER BY (m.access_grant IS NOT NULL) ASC, a.name ASC, a.created_at ASC`,
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
      workspaceId: r.external_id ?? null,
      accountCode: r.code,
      accountName: r.name,
      memberId: r.member_id,
      role: (ACCOUNT_ROLES as readonly string[]).includes(r.role)
        ? (r.role as AccountRole)
        : 'member',
      status: (MEMBER_STATUSES as readonly string[]).includes(r.status)
        ? (r.status as MemberStatus)
        : 'active',
      // Postgres returns COUNT(*) as a bigint string; SQLite as a number.
      memberCount: Number(r.member_count ?? 0),
      accessGrant: r.access_grant === 'staff' ? 'staff' : null,
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
  /**
   * Slugs this form used to answer to (see 0017), so a profile that named one
   * before the author renamed the link still matches. The listing filter runs
   * on `formSlugs`, which stores whatever slug was current when the author
   * picked the form; without these a rename would drop the form off every page
   * that listed it.
   */
  retiredSlugs: string[];
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
    sql`SELECT id, slug, name, config FROM form WHERE account_id = ${account.id} ORDER BY created_at ASC`,
  );
  // One query for the whole account rather than one per form: an account has a
  // handful of forms and rather fewer retired slugs, and this runs on a public
  // page render.
  const aliasRows = await db.all<{ alias: string; form_id: string }>(
    sql`SELECT alias, form_id FROM form_alias WHERE account_id = ${account.id}`,
  );
  const retiredByForm = new Map<string, string[]>();
  for (const row of aliasRows) {
    const key = String(row.form_id);
    retiredByForm.set(key, [...(retiredByForm.get(key) ?? []), String(row.alias)]);
  }
  return rows.map((r) => {
    const config = parseJsonColumn<{ title?: unknown }>(r.config, {});
    const title = typeof config.title === 'string' && config.title.trim() ? config.title.trim() : null;
    return {
      slug: String(r.slug),
      name: String(r.name),
      title,
      retiredSlugs: retiredByForm.get(String(r.id)) ?? [],
    };
  });
}

/** Replace a member's public page (account-scoped). NULL removes it entirely. */
export async function setMemberProfile(
  db: Db,
  accountId: string,
  memberId: string,
  profile: unknown | null,
): Promise<void> {
  await db.run(
    sql`UPDATE member SET profile = ${profile == null ? null : JSON.stringify(profile)}
        WHERE id = ${memberId} AND account_id = ${accountId}`,
  );
}

/**
 * Store the language this person reads the admin in.
 *
 * The column is not new and it is not only a UI preference: `email-effects`
 * already reads the account owner's `locale` to choose the EN/ES copy of the
 * submission notice. Nothing ever wrote it, so that read has always found NULL
 * and every one of those emails went out in English. Persisting the choice here
 * is therefore what makes the setting mean what it says, rather than a second
 * place to keep the same cookie.
 *
 * Scoped to the member row AND the account, like every other write in this file:
 * one person's language is not the workspace's to set.
 *
 * `null` is a real value and means "never chose" — the caller then falls back to
 * the browser's Accept-Language, which is what a brand-new person gets. Storing
 * 'en' for someone who never picked would freeze that fallback shut.
 */
export async function setMemberLocale(
  db: Db,
  accountId: string,
  memberId: string,
  locale: 'en' | 'es' | null,
): Promise<void> {
  await db.run(
    sql`UPDATE member SET locale = ${locale}
        WHERE id = ${memberId} AND account_id = ${accountId}`,
  );
}

/** The stored language for one member, or null when they never chose one. */
export async function getMemberLocale(
  db: Db,
  accountId: string,
  memberId: string,
): Promise<'en' | 'es' | null> {
  const r = await db.get<{ locale: string | null }>(
    sql`SELECT locale FROM member WHERE id = ${memberId} AND account_id = ${accountId} LIMIT 1`,
  );
  // Anything else in the column reads as "no choice". The column predates this
  // feature and is plain text, so a value from a future locale must degrade to
  // the fallback rather than reach a catalog lookup that has no such key.
  return r?.locale === 'en' || r?.locale === 'es' ? r.locale : null;
}

/** The stored public-page blob for one member (account-scoped), or null. */
export async function getMemberProfileRaw(
  db: Db,
  accountId: string,
  memberId: string,
): Promise<unknown> {
  const r = await db.get<Record<string, unknown>>(
    sql`SELECT profile FROM member WHERE id = ${memberId} AND account_id = ${accountId} LIMIT 1`,
  );
  if (!r || r.profile == null) return null;
  return parseJsonColumn<unknown>(r.profile, null);
}
