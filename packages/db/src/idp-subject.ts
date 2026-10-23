/**
 * The link between a member and the person's user id at the external OAuth
 * authorization server MCP clients sign in with (`member.idp_subject`, the `sub`
 * of that server's tokens), and when the identity service last vouched for
 * the member at a verified web login (`member.login_seen_at`, its token's
 * issue time). The same model as the sibling calendars product.
 *
 * The host login provider records the subject at web login; every verified
 * web login stamps `login_seen_at` (at most once a day). The MCP door reads
 * both to find the members a sign-in token may act as, and honors only members
 * seen recently, so a person removed upstream (where this app is never told)
 * loses MCP access once the web would have stopped letting them in. Within one
 * account a subject belongs to one member (a unique index): the latest web
 * login takes it, and the member who held it before loses it in the same
 * transaction.
 */
import { sql, type Db } from './client';

export interface IdpSubjectWrite {
  /** False when the member already carried this subject (or no longer exists). */
  written: boolean;
  /** Members of the same account the subject was taken from. */
  clearedMemberIds: string[];
}

/**
 * Record `subject` on the member, taking it from any other member of the same
 * account, as one transaction with the member row held (SQLite IMMEDIATE,
 * Postgres `FOR UPDATE`), so two parallel requests of one login write once.
 * Two members claiming one subject at the same instant: the unique index fails
 * one of them, which the caller treats like any other failed write.
 */
export async function recordMemberIdpSubject(
  db: Db,
  accountId: string,
  memberId: string,
  subject: string,
  seenAt: number | null = Date.now(),
): Promise<IdpSubjectWrite> {
  const current = sql`SELECT idp_subject FROM member WHERE id = ${memberId} AND account_id = ${accountId} LIMIT 1`;
  const clear = sql`UPDATE member SET idp_subject = NULL
      WHERE account_id = ${accountId} AND idp_subject = ${subject} AND id <> ${memberId}
      RETURNING id`;
  // The login that records the link was just verified: it also counts as seen,
  // as of when the identity service vouched for it (`seenAt`), never moving an
  // existing stamp backwards. Null (a token that does not say): no stamp.
  const set =
    seenAt === null
      ? sql`UPDATE member SET idp_subject = ${subject} WHERE id = ${memberId} AND account_id = ${accountId}`
      : sql`UPDATE member SET idp_subject = ${subject},
              login_seen_at = CASE WHEN login_seen_at IS NULL OR login_seen_at < ${seenAt} THEN ${seenAt} ELSE login_seen_at END
            WHERE id = ${memberId} AND account_id = ${accountId}`;
  const unchanged: IdpSubjectWrite = { written: false, clearedMemberIds: [] };

  if (db.dialect === 'sqlite') {
    const native = db.sqlite!;
    return native.txn(
      () => {
        const row = native.drizzle.get<{ idp_subject: string | null }>(current);
        if (!row || row.idp_subject === subject) return unchanged;
        const cleared = native.drizzle.all<{ id: string }>(clear);
        native.drizzle.run(set);
        return { written: true, clearedMemberIds: cleared.map((r) => r.id) };
      },
      { immediate: true },
    );
  }
  return db.pg!.drizzle.transaction(async (tx) => {
    const rows = (await tx.execute(sql`${current} FOR UPDATE`)) as unknown as { idp_subject: string | null }[];
    if (!rows[0] || rows[0].idp_subject === subject) return unchanged;
    const cleared = (await tx.execute(clear)) as unknown as { id: string }[];
    await tx.execute(set);
    return { written: true, clearedMemberIds: cleared.map((r) => r.id) };
  });
}

/**
 * The person a member names (`external_id`, null on a row no login ever
 * bound), the subject it carries and when the identity service last vouched
 * for it, or null for a member not in the account. Read on a verified web
 * request to decide whether anything needs writing.
 */
export async function memberIdpLink(
  db: Db,
  accountId: string,
  memberId: string,
): Promise<{ externalId: string | null; idpSubject: string | null; loginSeenAt: number | null } | null> {
  const r = await db.get<{ external_id: string | null; idp_subject: string | null; login_seen_at: number | string | null }>(
    sql`SELECT external_id, idp_subject, login_seen_at FROM member WHERE account_id = ${accountId} AND id = ${memberId} LIMIT 1`,
  );
  if (!r) return null;
  return {
    externalId: r.external_id,
    idpSubject: r.idp_subject,
    loginSeenAt: r.login_seen_at == null ? null : Number(r.login_seen_at),
  };
}

/**
 * Stamp `login_seen_at` with `seenAt` (when the identity service vouched for a
 * verified web login: its token's issue time), only when the stored value is
 * missing or more than `refreshAfterMs` older, so a busy dashboard writes about
 * once a day per member and the stamp never moves backwards. The condition
 * sits in the statement, so parallel requests write at most once. Answers
 * whether it wrote.
 */
export async function noteMemberLogin(db: Db, accountId: string, memberId: string, seenAt: number, refreshAfterMs: number): Promise<boolean> {
  const row = await db.get<{ id: string }>(
    sql`UPDATE member SET login_seen_at = ${seenAt}
        WHERE id = ${memberId} AND account_id = ${accountId}
          AND (login_seen_at IS NULL OR login_seen_at < ${seenAt - refreshAfterMs})
        RETURNING id`,
  );
  return !!row;
}

export interface SubjectMembership {
  memberId: string;
  accountId: string;
  accountName: string;
  /** The person's upstream user id (`member.external_id`). */
  externalId: string;
  email: string | null;
  role: string;
  status: string;
}

/**
 * The members a sign-in with `subject` reaches, oldest account first: the
 * person behind the subject, in every account where they are a member.
 *
 * The link is per person. The members carrying the subject name the person's
 * upstream user id (`external_id`, the same in every account they belong to),
 * and that person's members in other accounts count too, each while its own
 * stamp is fresh: the subject and the stamp land on the member a web request
 * acts as, so a workspace counts once the person opens it on the web within
 * the window. Should two upstream users carry the
 * same subject, both are returned (each with its `externalId`), and the caller
 * decides; dForms' MCP door refuses that sign-in rather than guess.
 *
 * Only members seen since `seenSince` count, the linking member and every
 * member reached through it alike: this app is not told when someone is
 * removed upstream, so a member whose web login has not been verified within
 * the window is treated as gone. Rows held through a staff access grant
 * (`access_grant`) never count here: they are not memberships, and the caller
 * reads them apart (`staffGrantsBySubject`) under a much shorter window. Nor does a row
 * no login ever bound to a person (`external_id` NULL): it names nobody. Role and status
 * are returned, not filtered, so the caller applies its own rule for who may
 * act. Read on every MCP request: removing a member, disabling them or taking
 * their admin role away cuts access at once.
 */
export async function membershipsBySubject(db: Db, subject: string, seenSince: number): Promise<SubjectMembership[]> {
  // Two indexed lookups joined by UNION, not one OR: an OR across idp_subject
  // and external_id cannot use either index and scans every member, on every
  // MCP request. The first branch uses member_idp_subject_account_idx; the
  // second finds the person's other members through member_external_id_idx
  // (an equality join, so a NULL external_id never matches).
  const rows = await db.all<{
    member_id: string;
    account_id: string;
    account_name: string;
    external_id: string;
    email: string | null;
    role: string;
    status: string;
  }>(
    sql`SELECT m.id AS member_id, m.account_id, a.name AS account_name, m.external_id, m.email, m.role, m.status
        FROM member m JOIN account a ON a.id = m.account_id
        WHERE m.login_seen_at >= ${seenSince}
          AND m.access_grant IS NULL
          AND m.external_id IS NOT NULL
          AND m.id IN (
            SELECT id FROM member WHERE idp_subject = ${subject}
            UNION
            SELECT r.id FROM member r JOIN member l ON l.external_id = r.external_id
            WHERE l.idp_subject = ${subject} AND l.login_seen_at >= ${seenSince})
        ORDER BY a.created_at ASC, a.id ASC
        LIMIT 200`,
  );
  return rows.map((r) => ({
    memberId: r.member_id,
    accountId: r.account_id,
    accountName: r.account_name,
    externalId: r.external_id,
    email: r.email,
    role: r.role,
    status: r.status,
  }));
}

/**
 * Stamp `login_seen_at` with `seenAt` on the person's (`external_id`) active
 * real memberships in `accountIds`, as `noteMemberLogin` does for one: only
 * where the stamp is missing or more than `refreshAfterMs` older, never
 * backwards, in one statement. Never a row held through a staff access grant.
 * The caller passes only accounts whose membership the identity service has
 * just confirmed. Answers how many rows it stamped.
 */
export async function notePersonLogins(
  db: Db,
  externalId: string,
  accountIds: readonly string[],
  seenAt: number,
  refreshAfterMs: number,
): Promise<number> {
  if (accountIds.length === 0) return 0;
  const stamped = await db.all<{ id: string }>(
    sql`UPDATE member SET login_seen_at = ${seenAt}
        WHERE external_id = ${externalId} AND status = 'active' AND access_grant IS NULL
          AND account_id IN (${sql.join(accountIds.map((id) => sql`${id}`), sql`, `)})
          AND (login_seen_at IS NULL OR login_seen_at < ${seenAt - refreshAfterMs})
        RETURNING id`,
  );
  return stamped.length;
}

/**
 * The rows a sign-in with `subject` reaches through a staff access grant: the
 * active `access_grant = 'staff'` rows of the person behind the subject (found
 * through one of their active real members carrying it, itself seen since
 * `linkSince`), each stamped since `grantSince` by a request that proved the
 * person is staff and acted in that grant's workspace. Kept apart from `membershipsBySubject` because a grant is
 * not a membership: the caller holds it to a much shorter window, so access
 * through a grant ends soon after the person stops being staff.
 */
export async function staffGrantsBySubject(
  db: Db,
  subject: string,
  linkSince: number,
  grantSince: number,
): Promise<SubjectMembership[]> {
  const rows = await db.all<{
    member_id: string;
    account_id: string;
    account_name: string;
    external_id: string;
    email: string | null;
    role: string;
    status: string;
  }>(
    sql`SELECT m.id AS member_id, m.account_id, a.name AS account_name, m.external_id, m.email, m.role, m.status
        FROM member m JOIN account a ON a.id = m.account_id
        WHERE m.access_grant = 'staff' AND m.status = 'active' AND m.login_seen_at >= ${grantSince}
          AND m.external_id IN (
            SELECT l.external_id FROM member l
            WHERE l.idp_subject = ${subject} AND l.login_seen_at >= ${linkSince}
              AND l.status = 'active' AND l.access_grant IS NULL AND l.external_id IS NOT NULL)
        ORDER BY a.created_at ASC, a.id ASC
        LIMIT 200`,
  );
  return rows.map((r) => ({
    memberId: r.member_id,
    accountId: r.account_id,
    accountName: r.account_name,
    externalId: r.external_id,
    email: r.email,
    role: r.role,
    status: r.status,
  }));
}
