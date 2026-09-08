/**
 * Workspaces as a PROJECTION of the identity service (see migration 0015).
 *
 * The identity service (the Dapta IAM) owns the truth about workspaces and who
 * belongs to them. Locally, an `account` row IS one of its workspaces
 * (`account.external_id` = upstream workspace id) and a `member` row IS one of
 * its `workspace_users` rows. Nothing here talks to the network: the API layer
 * reads upstream and calls these to make the local rows agree, so every query in
 * the product keeps scoping by `account_id` exactly as before, and the public
 * URLs (`account.code`) never move.
 *
 * Everything is idempotent — a projection that runs twice must be a no-op the
 * second time — because it runs on the login path and on demand.
 */
import { randomUUID } from 'node:crypto';
import { sql, type Db } from './client';
import { deriveUniqueHandle, insertAccountWithShortCode } from './short-links';
import { ACCOUNT_ROLES, type AccessGrant, type AccountRole } from './members';

/** One upstream membership, as the API layer hands it to the projection. */
export interface ProjectedMembership {
  /** Upstream workspace id → `account.external_id`. */
  workspaceId: string;
  workspaceName: string;
  /** Upstream account (billing) id the workspace hangs from → `account.iam_account_id`. */
  iamAccountId: string | null;
  /** Upstream `workspace_users.id` → `member.iam_workspace_user_id`. */
  workspaceUserId: string | null;
  role: AccountRole;
  /** Upstream `is_active` on the membership row. */
  active: boolean;
  /**
   * `'staff'` when this is not a membership upstream at all but an access grant
   * (the person's email domain is one the deployment lists as staff). Grant
   * rows never stamp onboarding on the accounts they create, are excluded from
   * rosters and counts, and are not pruned by a later membership projection.
   */
  accessGrant?: AccessGrant | null;
}

/** The identity being projected — always the authenticated principal, never the request. */
export interface ProjectedIdentity {
  /** The token `sub` → `member.external_id`. */
  externalId: string;
  email: string | null;
  displayName: string | null;
}

export interface ProjectionResult {
  /** Local account ids for every ACTIVE upstream membership, in input order. */
  accountIds: string[];
  /** Local `(accountId, memberId)` pairs whose member row was CREATED by this run. */
  created: Array<{
    accountId: string;
    memberId: string;
    role: AccountRole;
    isFirstMember: boolean;
    accessGrant: AccessGrant | null;
  }>;
  /** Local account ids that were CREATED by this run (a workspace never seen before). */
  createdAccounts: string[];
}

/** Local account by the upstream workspace id, or null. */
export async function getAccountByExternalId(
  db: Db,
  externalId: string,
): Promise<{ id: string; name: string; iamAccountId: string | null } | null> {
  const r = await db.get<{ id: string; name: string; iam_account_id: string | null }>(
    sql`SELECT id, name, iam_account_id FROM account WHERE external_id = ${externalId} LIMIT 1`,
  );
  return r ? { id: r.id, name: r.name, iamAccountId: r.iam_account_id ?? null } : null;
}

/** One projected account the staff search matched locally. */
export interface ProjectedAccountHit {
  /** Local account id. */
  id: string;
  /** The upstream workspace id (`account.external_id`). */
  workspaceId: string;
  name: string;
  /** Active real members (grants excluded). */
  memberCount: number;
  /** When the NAME did not match: the member email or form name that did. */
  hint: { kind: 'email' | 'form'; value: string } | null;
}

/** `%`/`_` are LIKE wildcards; a search for them must mean them. */
function likePattern(q: string): string {
  return `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Staff search over the accounts this database already projected from the
 * identity service: by workspace name, by a member's email, or by one of its
 * FORMS' names. The identity service knows workspaces by name only, and a
 * workspace is rarely what the deployment's staff remember: they hold a
 * submission email, a form link, the customer's address. Local-only accounts
 * (no `external_id`) are not workspaces anyone can be granted into, so they
 * are left out.
 */
export async function searchProjectedAccounts(
  db: Db,
  query: string,
  opts: { limit?: number } = {},
): Promise<ProjectedAccountHit[]> {
  const q = query.trim();
  if (!q) return [];
  const pat = likePattern(q);
  const limit = Math.max(1, Math.min(50, opts.limit ?? 20));
  const rows = await db.all<{
    id: string;
    external_id: string;
    name: string;
    member_count: number | string;
    name_hit: number | boolean;
    email_hit: string | null;
    form_hit: string | null;
  }>(
    sql`SELECT a.id, a.external_id, a.name,
               (SELECT COUNT(*) FROM member mm
                 WHERE mm.account_id = a.id AND mm.status = 'active' AND mm.access_grant IS NULL) AS member_count,
               (lower(a.name) LIKE ${pat} ESCAPE '\\') AS name_hit,
               (SELECT m.email FROM member m
                 WHERE m.account_id = a.id AND m.access_grant IS NULL AND m.email IS NOT NULL
                   AND lower(m.email) LIKE ${pat} ESCAPE '\\'
                 ORDER BY (m.role = 'owner') DESC, m.created_at ASC LIMIT 1) AS email_hit,
               (SELECT f.name FROM form f
                 WHERE f.account_id = a.id AND lower(f.name) LIKE ${pat} ESCAPE '\\'
                 ORDER BY f.created_at DESC LIMIT 1) AS form_hit
        FROM account a
        WHERE a.external_id IS NOT NULL
          AND (lower(a.name) LIKE ${pat} ESCAPE '\\'
            OR EXISTS (SELECT 1 FROM member m2
                        WHERE m2.account_id = a.id AND m2.access_grant IS NULL AND m2.email IS NOT NULL
                          AND lower(m2.email) LIKE ${pat} ESCAPE '\\')
            OR EXISTS (SELECT 1 FROM form f2
                        WHERE f2.account_id = a.id AND lower(f2.name) LIKE ${pat} ESCAPE '\\'))
        ORDER BY (lower(a.name) LIKE ${pat} ESCAPE '\\') DESC, a.name ASC
        LIMIT ${limit}`,
  );
  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.external_id,
    name: r.name,
    memberCount: Number(r.member_count ?? 0),
    hint:
      r.name_hit === true || r.name_hit === 1
        ? null
        : r.email_hit
          ? { kind: 'email', value: r.email_hit }
          : r.form_hit
            ? { kind: 'form', value: r.form_hit }
            : null,
  }));
}

/**
 * Rebind a pre-0015 account (whose `external_id` still holds the upstream
 * ACCOUNT id) onto the upstream WORKSPACE it should have meant all along.
 *
 * Returns the local account id that now carries `external_id = workspaceId`:
 * the legacy row itself when it could be rebound; the already-projected row
 * when one existed. Two rows can only both exist when someone else in that
 * workspace logged in after the deploy and before this person did — and if
 * that projected row is still empty (no forms) it is absorbed so the person's
 * existing forms keep their account, their code, and their URLs. A projected
 * row that already has forms is kept, and the legacy row is parked under a
 * `legacy:` prefix so it can never be mistaken for a live workspace; that case
 * is loud in the logs and is not expected in practice.
 */
export async function rebindLegacyAccount(
  db: Db,
  args: { iamAccountId: string; workspaceId: string; workspaceName: string },
): Promise<{ accountId: string; parkedLegacyId: string | null } | null> {
  const legacy = await db.get<{ id: string }>(
    sql`SELECT id FROM account WHERE external_id = ${args.iamAccountId} LIMIT 1`,
  );
  if (!legacy) return null;

  const projected = await db.get<{ id: string }>(
    sql`SELECT id FROM account WHERE external_id = ${args.workspaceId} LIMIT 1`,
  );
  // A personal workspace can arrive with ws.id === ws.account_id, so both
  // lookups match the SAME row: it is already bound to the right workspace and
  // must never be treated as its own stale twin — parking itself (and locking
  // the person out on the next login, when the parked external_id collides),
  // or, with no forms, deleting itself in the absorb branch below.
  if (projected && projected.id === legacy.id) {
    return { accountId: legacy.id, parkedLegacyId: null };
  }
  if (!projected) {
    await db.run(
      sql`UPDATE account SET external_id = ${args.workspaceId}, iam_account_id = ${args.iamAccountId}
          WHERE id = ${legacy.id}`,
    );
    return { accountId: legacy.id, parkedLegacyId: null };
  }

  const projectedForms = await db.get<{ n: number }>(
    sql`SELECT COUNT(*) AS n FROM form WHERE account_id = ${projected.id}`,
  );
  if (Number(projectedForms?.n ?? 0) === 0) {
    // Absorb the empty projection: its member rows are re-created by the next
    // projection pass against the legacy row, so nothing of value is lost.
    await db.run(sql`DELETE FROM member WHERE account_id = ${projected.id}`);
    await db.run(sql`DELETE FROM account_alias WHERE account_id = ${projected.id}`);
    await db.run(sql`DELETE FROM account WHERE id = ${projected.id}`);
    await db.run(
      sql`UPDATE account SET external_id = ${args.workspaceId}, iam_account_id = ${args.iamAccountId}
          WHERE id = ${legacy.id}`,
    );
    return { accountId: legacy.id, parkedLegacyId: null };
  }

  await db.run(
    sql`UPDATE account SET external_id = ${'legacy:' + args.iamAccountId}, iam_account_id = ${args.iamAccountId},
          name = name || ' (legacy)'
        WHERE id = ${legacy.id}`,
  );
  // Parked means unreachable: its rows must not keep it alive in the switcher.
  await db.run(sql`UPDATE member SET status = 'disabled' WHERE account_id = ${legacy.id}`);
  return { accountId: projected.id, parkedLegacyId: legacy.id };
}

/**
 * Whether this human has finished the first-run wizard ANYWHERE. Onboarding
 * describes the person's first contact with the product, not each workspace
 * they are later projected into — a workspace that came from the identity
 * service was set up over there.
 */
export async function humanHasCompletedOnboarding(db: Db, externalId: string): Promise<boolean> {
  const r = await db.get<{ id: string }>(
    sql`SELECT a.id FROM account a JOIN member m ON m.account_id = a.id
        WHERE m.external_id = ${externalId} AND a.onboarding_completed_at IS NOT NULL LIMIT 1`,
  );
  return !!r;
}

/**
 * Make the local rows agree with the upstream memberships of one identity.
 *
 * For each ACTIVE membership: the account is found by `external_id` (created
 * when unseen), its name and `iam_account_id` refreshed, and the member row for
 * this identity upserted with the upstream role. Memberships upstream marks
 * inactive, and local rows this identity holds in accounts the upstream list no
 * longer names, are set `disabled` — never deleted, so `created_by` on forms
 * keeps resolving. Rows the identity service cannot know about (an invite by
 * email with no `external_id` yet, dev/seed rows) are left alone.
 *
 * `inheritOnboarding` stamps `onboarding_completed_at` on accounts CREATED by
 * this run, so a person who already finished the wizard is not sent through it
 * again for every workspace they belong to upstream.
 */
/**
 * How long a freshly written member row is safe from the prune pass, so a
 * lagging upstream list cannot disable a membership projected directly
 * moments ago (see the prune comment inside `projectMemberships`).
 */
const PRUNE_GRACE_MS = 5 * 60_000;

export async function projectMemberships(
  db: Db,
  identity: ProjectedIdentity,
  memberships: ProjectedMembership[],
  opts: {
    inheritOnboarding?: boolean;
    now?: number;
    /**
     * Whether rows this identity holds in projected accounts that `memberships`
     * does not name are set `disabled` (default). A single-workspace grant
     * (`grantStaffAccess`) passes false: it adds one row, it is not the list.
     */
    pruneMissing?: boolean;
  } = {},
): Promise<ProjectionResult> {
  const now = opts.now ?? Date.now();
  const result: ProjectionResult = { accountIds: [], created: [], createdAccounts: [] };
  const seenAccountIds = new Set<string>();

  for (const m of memberships) {
    if (!m.active) {
      // An AFFIRMATIVE "not a member any more" (the workspace was read and
      // does not name them) — unlike mere absence from the list, this is
      // evidence, so it disables regardless of the prune grace window below.
      const gone = await getAccountByExternalId(db, m.workspaceId);
      if (gone) {
        await db.run(
          sql`UPDATE member SET status = 'disabled'
              WHERE account_id = ${gone.id} AND external_id = ${identity.externalId}
                AND status = 'active' AND access_grant IS NULL`,
        );
      }
      continue;
    }
    const role: AccountRole = (ACCOUNT_ROLES as readonly string[]).includes(m.role) ? m.role : 'member';
    const grant: AccessGrant | null = m.accessGrant === 'staff' ? 'staff' : null;

    let account = await getAccountByExternalId(db, m.workspaceId);
    let accountCreated = false;
    if (!account) {
      await insertAccountWithShortCode(db, {
        name: m.workspaceName || 'Workspace',
        externalId: m.workspaceId,
      });
      account = await getAccountByExternalId(db, m.workspaceId);
      if (!account) throw new Error(`projection: could not create account for workspace ${m.workspaceId}`);
      accountCreated = true;
      result.createdAccounts.push(account.id);
      // A grant never stamps onboarding: the account belongs to whoever owns
      // the workspace upstream, and THEIR first login must still get the wizard.
      if (opts.inheritOnboarding && !grant) {
        await db.run(
          sql`UPDATE account SET onboarding_completed_at = ${now}
              WHERE id = ${account.id} AND onboarding_completed_at IS NULL`,
        );
      }
    }
    await db.run(
      sql`UPDATE account SET name = ${m.workspaceName || account.name},
            iam_account_id = COALESCE(${m.iamAccountId}, iam_account_id),
            synced_at = ${now}
          WHERE id = ${account.id}`,
    );

    const existing = await db.get<{ id: string; status: string }>(
      sql`SELECT id, status FROM member WHERE account_id = ${account.id} AND external_id = ${identity.externalId} LIMIT 1`,
    );
    if (existing) {
      // Upstream is the authority on role and on being active. `disabled`
      // locally is revived here on purpose: the identity service says this
      // membership is active NOW, and it is the only place a membership can be
      // revoked or restored from. A real membership also clears an earlier
      // grant (the person was staff-granted, then actually invited).
      await db.run(
        sql`UPDATE member SET role = ${role}, status = 'active',
              iam_workspace_user_id = COALESCE(${m.workspaceUserId}, iam_workspace_user_id),
              access_grant = ${grant},
              email = COALESCE(email, ${identity.email}),
              display_name = COALESCE(display_name, ${identity.displayName})
            WHERE id = ${existing.id} AND account_id = ${account.id}`,
      );
    } else {
      // Adopt an invite-by-email row before creating a second identity for the
      // same person (mirrors the auth provider's invite adoption).
      const email = identity.email?.trim().toLowerCase() || null;
      const invited = email
        ? await db.get<{ id: string }>(
            sql`SELECT id FROM member
                WHERE account_id = ${account.id} AND external_id IS NULL AND lower(email) = ${email}
                ORDER BY created_at ASC LIMIT 1`,
          )
        : null;
      if (invited) {
        await db.run(
          sql`UPDATE member SET external_id = ${identity.externalId}, status = 'active', role = ${role},
                iam_workspace_user_id = COALESCE(${m.workspaceUserId}, iam_workspace_user_id),
                access_grant = ${grant},
                display_name = COALESCE(display_name, ${identity.displayName})
              WHERE id = ${invited.id} AND account_id = ${account.id}`,
        );
      } else {
        // "First member" counts real memberships only: a staff grant that got
        // here first must not steal the owner's welcome (demo form, signup).
        const others = await db.get<{ id: string }>(
          sql`SELECT id FROM member WHERE account_id = ${account.id} AND access_grant IS NULL LIMIT 1`,
        );
        const id = randomUUID();
        const handle = await deriveUniqueHandle(db, account.id, identity.displayName, identity.email);
        await db.run(
          sql`INSERT INTO member (id, account_id, external_id, email, display_name, handle, role, status,
                iam_workspace_user_id, access_grant, created_at)
              VALUES (${id}, ${account.id}, ${identity.externalId}, ${identity.email}, ${identity.displayName},
                ${handle}, ${role}, 'active', ${m.workspaceUserId}, ${grant}, ${now})
              ON CONFLICT (account_id, external_id) DO NOTHING`,
        );
        const row = await db.get<{ id: string }>(
          sql`SELECT id FROM member WHERE account_id = ${account.id} AND external_id = ${identity.externalId} LIMIT 1`,
        );
        if (row && row.id === id) {
          result.created.push({ accountId: account.id, memberId: id, role, isFirstMember: !others, accessGrant: grant });
        }
      }
    }
    seenAccountIds.add(account.id);
    result.accountIds.push(account.id);
  }

  // Memberships upstream no longer names (or names as inactive): disable the
  // local rows this identity holds in PROJECTED accounts only. A purely local
  // account (never synced) is outside the identity service's authority, and so
  // is a grant row: upstream never named it, so its absence says nothing.
  //
  // Rows younger than the grace window are also left alone: the upstream
  // LIST lags its own writes, and a row projected directly moments ago (a
  // workspace just created, a membership just granted) is routinely absent
  // from the next list read. Absence proves nothing about a row newer than
  // the list; disabling it bounced people out of a workspace they had just
  // created. A genuinely revoked brand-new membership survives at most the
  // window, which the next refresh past it closes.
  if (opts.pruneMissing !== false) {
    const bornAfter = now - PRUNE_GRACE_MS;
    const held = await db.all<{ id: string; account_id: string }>(
      sql`SELECT m.id, m.account_id FROM member m JOIN account a ON a.id = m.account_id
          WHERE m.external_id = ${identity.externalId} AND m.status = 'active' AND a.synced_at IS NOT NULL
            AND m.access_grant IS NULL AND m.created_at < ${bornAfter}`,
    );
    for (const h of held) {
      if (seenAccountIds.has(h.account_id)) continue;
      await db.run(sql`UPDATE member SET status = 'disabled' WHERE id = ${h.id} AND account_id = ${h.account_id}`);
    }
  }

  return result;
}

/**
 * Let a STAFF identity into one workspace it holds no upstream membership in:
 * the account is projected (created if unseen, without an onboarding stamp)
 * and the person gets an `admin` row marked `access_grant = 'staff'`. Nothing
 * else this identity holds is touched. Idempotent. Returns the local ids.
 */
export async function grantStaffAccess(
  db: Db,
  identity: ProjectedIdentity,
  workspace: { workspaceId: string; workspaceName: string; iamAccountId: string | null },
  opts: { now?: number } = {},
): Promise<{ accountId: string; memberId: string }> {
  await projectMemberships(
    db,
    identity,
    [
      {
        workspaceId: workspace.workspaceId,
        workspaceName: workspace.workspaceName,
        iamAccountId: workspace.iamAccountId,
        workspaceUserId: null,
        role: 'admin',
        active: true,
        accessGrant: 'staff',
      },
    ],
    { inheritOnboarding: false, pruneMissing: false, now: opts.now },
  );
  const row = await db.get<{ account_id: string; id: string }>(
    sql`SELECT m.account_id, m.id FROM member m JOIN account a ON a.id = m.account_id
        WHERE a.external_id = ${workspace.workspaceId} AND m.external_id = ${identity.externalId} LIMIT 1`,
  );
  if (!row) throw new Error(`grant: no member row for ${identity.externalId} in ${workspace.workspaceId}`);
  return { accountId: row.account_id, memberId: row.id };
}

/**
 * The account this identity should land in when nothing else says otherwise:
 * the one it was seen in most recently, else its oldest membership. Only
 * accounts where the membership is ACTIVE count.
 */
export async function pickHomeAccount(
  db: Db,
  externalId: string,
  preferExternalId: string | null,
): Promise<{ accountId: string; memberId: string } | null> {
  if (preferExternalId) {
    const preferred = await db.get<{ account_id: string; member_id: string }>(
      sql`SELECT m.account_id, m.id AS member_id FROM member m JOIN account a ON a.id = m.account_id
          WHERE m.external_id = ${externalId} AND m.status = 'active' AND a.external_id = ${preferExternalId}
          LIMIT 1`,
    );
    if (preferred) return { accountId: preferred.account_id, memberId: preferred.member_id };
  }
  // A real membership beats a grant as the fallback home: staff who never
  // opened anything land in their own workspace, not in a customer's.
  const row = await db.get<{ account_id: string; member_id: string }>(
    sql`SELECT m.account_id, m.id AS member_id FROM member m JOIN account a ON a.id = m.account_id
        WHERE m.external_id = ${externalId} AND m.status = 'active'
        ORDER BY (m.access_grant IS NOT NULL) ASC, (m.last_seen_at IS NULL) ASC, m.last_seen_at DESC, m.created_at ASC
        LIMIT 1`,
  );
  return row ? { accountId: row.account_id, memberId: row.member_id } : null;
}

/**
 * Create a purely LOCAL workspace (no identity service): a fresh account plus
 * this identity as its owner. This is the path the dev stub and forks take;
 * with the identity service configured the API creates upstream first and
 * projects instead. Returns the new local account id.
 */
export async function createLocalWorkspace(
  db: Db,
  identity: Omit<ProjectedIdentity, 'externalId'> & { externalId: string | null },
  input: { name: string; inheritOnboarding?: boolean; now?: number },
): Promise<{ accountId: string; memberId: string }> {
  const now = input.now ?? Date.now();
  const externalId = `local:${randomUUID()}`;
  await insertAccountWithShortCode(db, { name: input.name, externalId });
  const account = await getAccountByExternalId(db, externalId);
  if (!account) throw new Error('createLocalWorkspace: account insert did not land');
  if (input.inheritOnboarding) {
    await db.run(sql`UPDATE account SET onboarding_completed_at = ${now} WHERE id = ${account.id}`);
  }
  const memberId = randomUUID();
  const handle = await deriveUniqueHandle(db, account.id, identity.displayName, identity.email);
  await db.run(
    sql`INSERT INTO member (id, account_id, external_id, email, display_name, handle, role, status, created_at)
        VALUES (${memberId}, ${account.id}, ${identity.externalId}, ${identity.email}, ${identity.displayName},
          ${handle}, 'owner', 'active', ${now})`,
  );
  return { accountId: account.id, memberId };
}

/** Rename a workspace locally (the API renames upstream first when it can). */
export async function renameAccount(db: Db, accountId: string, name: string): Promise<void> {
  await db.run(sql`UPDATE account SET name = ${name} WHERE id = ${accountId}`);
}

/** One upstream roster row, as the API layer hands it to `projectRoster`. */
export interface ProjectedRosterRow {
  externalId: string;
  email: string | null;
  displayName: string | null;
  role: AccountRole;
  active: boolean;
  workspaceUserId: string | null;
}

/**
 * Make one workspace's local roster agree with the upstream `users[]`.
 *
 * Every upstream member gets a local row (created if unseen, adopting an
 * invite-by-email row when the address matches); role, status and the
 * upstream membership id are refreshed. Local rows carrying an `external_id`
 * that upstream no longer lists are disabled. Rows with NO `external_id`
 * (invited by email locally, never signed in) are left alone — upstream cannot
 * know them.
 */
export async function projectRoster(
  db: Db,
  accountId: string,
  rows: ProjectedRosterRow[],
  opts: { now?: number } = {},
): Promise<void> {
  const now = opts.now ?? Date.now();
  const seen = new Set<string>();
  for (const r of rows) {
    seen.add(r.externalId);
    const role: AccountRole = (ACCOUNT_ROLES as readonly string[]).includes(r.role) ? r.role : 'member';
    const status = r.active ? 'active' : 'disabled';
    const existing = await db.get<{ id: string }>(
      sql`SELECT id FROM member WHERE account_id = ${accountId} AND external_id = ${r.externalId} LIMIT 1`,
    );
    if (existing) {
      await db.run(
        sql`UPDATE member SET role = ${role}, status = ${status},
              iam_workspace_user_id = COALESCE(${r.workspaceUserId}, iam_workspace_user_id),
              email = COALESCE(email, ${r.email}),
              display_name = COALESCE(display_name, ${r.displayName})
            WHERE id = ${existing.id} AND account_id = ${accountId}`,
      );
      continue;
    }
    const email = r.email?.trim().toLowerCase() || null;
    const invited = email
      ? await db.get<{ id: string }>(
          sql`SELECT id FROM member WHERE account_id = ${accountId} AND external_id IS NULL AND lower(email) = ${email}
              ORDER BY created_at ASC LIMIT 1`,
        )
      : null;
    if (invited) {
      await db.run(
        sql`UPDATE member SET external_id = ${r.externalId}, role = ${role}, status = ${status},
              iam_workspace_user_id = COALESCE(${r.workspaceUserId}, iam_workspace_user_id),
              display_name = COALESCE(display_name, ${r.displayName})
            WHERE id = ${invited.id} AND account_id = ${accountId}`,
      );
      continue;
    }
    const handle = await deriveUniqueHandle(db, accountId, r.displayName, r.email);
    await db.run(
      sql`INSERT INTO member (id, account_id, external_id, email, display_name, handle, role, status,
            iam_workspace_user_id, created_at)
          VALUES (${randomUUID()}, ${accountId}, ${r.externalId}, ${r.email}, ${r.displayName}, ${handle},
            ${role}, ${status}, ${r.workspaceUserId}, ${now})
          ON CONFLICT (account_id, external_id) DO NOTHING`,
    );
  }
  // Only rows the identity service KNOWS (they carry an upstream membership id)
  // can be disabled by its silence. A row without one — the workspace owner
  // when upstream omits them from `users[]`, an invite by email, a dev/seed
  // row — is outside its authority and must survive a roster read.
  const held = await db.all<{ id: string; external_id: string }>(
    sql`SELECT id, external_id FROM member
        WHERE account_id = ${accountId} AND external_id IS NOT NULL
          AND iam_workspace_user_id IS NOT NULL AND status = 'active'`,
  );
  for (const h of held) {
    if (seen.has(h.external_id)) continue;
    await db.run(sql`UPDATE member SET status = 'disabled' WHERE id = ${h.id} AND account_id = ${accountId}`);
  }
  await db.run(sql`UPDATE account SET synced_at = ${now} WHERE id = ${accountId}`);
}

/** The upstream ids the members service needs to act on one local member. */
export async function getMemberUpstreamRef(
  db: Db,
  accountId: string,
  memberId: string,
): Promise<{ externalId: string | null; workspaceUserId: string | null; email: string | null } | null> {
  const r = await db.get<{ external_id: string | null; iam_workspace_user_id: string | null; email: string | null }>(
    sql`SELECT external_id, iam_workspace_user_id, email FROM member WHERE id = ${memberId} AND account_id = ${accountId} LIMIT 1`,
  );
  if (!r) return null;
  return { externalId: r.external_id ?? null, workspaceUserId: r.iam_workspace_user_id ?? null, email: r.email ?? null };
}

// --- Workspace timezone (0020) ---------------------------------------------

/** The workspace's IANA zone, or null (= UTC) when nobody has set one. */
export async function getAccountTimezone(db: Db, accountId: string): Promise<string | null> {
  const row = await db.get<{ timezone: string | null }>(
    sql`SELECT timezone FROM account WHERE id = ${accountId} LIMIT 1`,
  );
  return row?.timezone ?? null;
}

/** Set (or clear, with null) the workspace's zone. Validation is the API's job. */
export async function setAccountTimezone(db: Db, accountId: string, timezone: string | null): Promise<void> {
  await db.run(sql`UPDATE account SET timezone = ${timezone} WHERE id = ${accountId}`);
}

/**
 * Write-once seed: the first admin to load the dashboard offers their
 * browser's zone, and it sticks only while the column is still NULL, so two
 * teammates in different zones cannot flip it back and forth. Same
 * UPDATE ... WHERE IS NULL discipline as the milestone claims.
 */
export async function claimAccountTimezone(db: Db, accountId: string, timezone: string): Promise<boolean> {
  const claimed = await db.get<{ id: string }>(
    sql`UPDATE account SET timezone = ${timezone}
        WHERE id = ${accountId} AND timezone IS NULL
        RETURNING id`,
  );
  return Boolean(claimed);
}
