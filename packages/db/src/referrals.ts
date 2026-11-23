/**
 * REFERRAL PROGRAM: the per-person referrer row (0030, ADR 0005).
 *
 * Referral state is keyed by the PERSON, not by a workspace: one human has one
 * referral link, one code and one count across every workspace they belong
 * to. There is no person table, so the key is read off the caller's member row.
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from './client';

/** The person's referrer row. Mirrors the `referrer` table (0030). */
export interface ReferrerRow {
  personId: string;
  code: string;
  unlockedAt: number | null;
  bannerDismissedUntil: number | null;
  nudgeSentAt: number | null;
  createdAt: number;
}

interface ReferrerDbRow {
  person_id: string;
  code: string;
  unlocked_at: number | string | null;
  banner_dismissed_until: number | string | null;
  nudge_sent_at: number | string | null;
  created_at: number | string;
}

/** Postgres returns BIGINT as a string; SQLite as a number. */
const num = (v: number | string | null): number | null => (v == null ? null : Number(v));

/**
 * Lowercase letters and digits without the look-alikes (0/o, 1/l/i), so a code
 * read aloud or copied by hand survives. 31 symbols.
 */
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const CODE_LENGTH = 8;
/** How many fresh codes to try before giving up on a run of collisions. */
const CODE_ATTEMPTS = 8;

/**
 * A short random code: 8 symbols of 31, about 40 bits. Rejection sampling
 * keeps every symbol equally likely (a plain modulo would favour the first few).
 */
export function generateReferralCode(): string {
  let out = '';
  // 248 = 31 * 8: the largest multiple of the alphabet that fits a byte.
  const limit = 256 - (256 % CODE_ALPHABET.length);
  while (out.length < CODE_LENGTH) {
    for (const byte of randomBytes(CODE_LENGTH * 2)) {
      if (byte >= limit) continue;
      out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      if (out.length === CODE_LENGTH) break;
    }
  }
  return out;
}

/**
 * The person a member row belongs to: the identity service's user id when the
 * row carries one, so a person in several workspaces is one person. Without
 * one (the local development stub) the person is their email, lowercased, the
 * way local development tells people apart. Null for a member that is gone or
 * has neither.
 */
export async function referralPersonKey(db: Db, accountId: string, memberId: string): Promise<string | null> {
  const r = await db.get<{ external_id: string | null; email: string | null }>(
    sql`SELECT external_id, email FROM member WHERE id = ${memberId} AND account_id = ${accountId} LIMIT 1`,
  );
  const external = r?.external_id?.trim();
  if (external) return external;
  const email = r?.email?.trim().toLowerCase();
  return email ? `email:${email}` : null;
}

function toRow(r: ReferrerDbRow): ReferrerRow {
  return {
    personId: r.person_id,
    code: r.code,
    unlockedAt: num(r.unlocked_at),
    bannerDismissedUntil: num(r.banner_dismissed_until),
    nudgeSentAt: num(r.nudge_sent_at),
    createdAt: Number(r.created_at),
  };
}

/** The person's referrer row, or null when they never asked for their link. */
export async function getReferrer(db: Db, personId: string): Promise<ReferrerRow | null> {
  const r = await db.get<ReferrerDbRow>(
    sql`SELECT person_id, code, unlocked_at, banner_dismissed_until, nudge_sent_at, created_at
        FROM referrer WHERE person_id = ${personId} LIMIT 1`,
  );
  return r ? toRow(r) : null;
}

/**
 * The person's referrer row, created on the first call.
 *
 * One `INSERT ... ON CONFLICT DO NOTHING`, then a read: two tabs asking at
 * once both read the row the first one wrote, never two codes. A conflict on
 * the code (another person already holds it) also inserts nothing, and is
 * told apart by the read finding no row, so a fresh code is tried.
 */
export async function ensureReferrer(
  db: Db,
  personId: string,
  opts: { now?: number; code?: () => string } = {},
): Promise<ReferrerRow> {
  const existing = await getReferrer(db, personId);
  if (existing) return existing;
  const makeCode = opts.code ?? generateReferralCode;
  const now = opts.now ?? Date.now();
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    await db.run(
      sql`INSERT INTO referrer (person_id, code, created_at)
          VALUES (${personId}, ${makeCode()}, ${now})
          ON CONFLICT DO NOTHING`,
    );
    const row = await getReferrer(db, personId);
    if (row) return row;
  }
  throw new Error('Could not issue a unique referral code.');
}

/** The referrer row holding a code, or null for a code nobody holds. Codes are lowercase. */
export async function getReferrerByCode(db: Db, code: string): Promise<ReferrerRow | null> {
  const r = await db.get<ReferrerDbRow>(
    sql`SELECT person_id, code, unlocked_at, banner_dismissed_until, nudge_sent_at, created_at
        FROM referrer WHERE code = ${code.toLowerCase()} LIMIT 1`,
  );
  return r ? toRow(r) : null;
}

/** How a referee came to dForms: the referrer's link, or a teammate invite. */
export type ReferralSource = 'link' | 'invite';

/** Referrals credited to a person so far. Rows are never deleted, so it never goes down. */
export async function countReferrals(db: Db, referrerPersonId: string): Promise<number> {
  const r = await db.get<{ n: number | string }>(
    sql`SELECT COUNT(*) AS n FROM referral WHERE referrer_person_id = ${referrerPersonId}`,
  );
  return Number(r?.n ?? 0);
}

const EMAIL_KEY = 'email:';

/** Every address a person is known by, lowercased: the emails on their member rows. */
async function personEmails(db: Db, person: string): Promise<Set<string>> {
  if (person.startsWith(EMAIL_KEY)) return new Set([person.slice(EMAIL_KEY.length)]);
  const rows = await db.all<{ email: string | null }>(
    sql`SELECT email FROM member WHERE external_id = ${person} AND email IS NOT NULL`,
  );
  return new Set(rows.map((r) => r.email!.trim().toLowerCase()).filter(Boolean));
}

/** Same person, or another subject on one of the referrer's addresses. */
async function isSelfReferral(db: Db, referee: string, referrer: string): Promise<boolean> {
  if (referee === referrer) return true;
  const [mine, theirs] = await Promise.all([personEmails(db, referee), personEmails(db, referrer)]);
  for (const email of mine) if (theirs.has(email)) return true;
  return false;
}

/**
 * How long after a person first appears a referral can still be credited to
 * them: the same 10 minutes the signup attribution gives a new account
 * (`claimAccountAttribution`).
 */
export const REFERRAL_CLAIM_WINDOW_MS = 10 * 60_000;

/**
 * When the person first appeared in dForms: the oldest of their member rows,
 * or null when they have none. A staff access grant is not a membership (the
 * person never signed up for that workspace), so it does not count.
 */
export async function personFirstSeenAt(db: Db, person: string): Promise<number | null> {
  const r = person.startsWith(EMAIL_KEY)
    ? await db.get<{ first: number | string | null }>(
        sql`SELECT MIN(created_at) AS first FROM member
            WHERE (external_id IS NULL OR external_id = '')
              AND lower(trim(email)) = ${person.slice(EMAIL_KEY.length)}
              AND (access_grant IS NULL OR access_grant <> 'staff')`,
      )
    : await db.get<{ first: number | string | null }>(
        sql`SELECT MIN(created_at) AS first FROM member
            WHERE external_id = ${person}
              AND (access_grant IS NULL OR access_grant <> 'staff')`,
      );
  return num(r?.first ?? null);
}

/**
 * A new person: their first member row (staff grants aside) was written less
 * than `REFERRAL_CLAIM_WINDOW_MS` ago. Derived from the member table, never
 * stored (ADR 0005). A person with no row at all is not new: there is nobody.
 */
export async function isNewPerson(db: Db, person: string, now: number = Date.now()): Promise<boolean> {
  const first = await personFirstSeenAt(db, person);
  return first != null && first > now - REFERRAL_CLAIM_WINDOW_MS;
}

/**
 * Credit one referee to one referrer; true when this call wrote the referral.
 *
 * The rules, every refusal a plain `false`:
 *   - not a self-referral: the same person, or another subject on one of the
 *     referrer's addresses;
 *   - the referee is a new person (`isNewPerson`);
 *   - first credit wins: `referee_person_id` is the primary key, so a referee
 *     already credited (to anyone, by any source) inserts nothing. Two
 *     concurrent claims race on that key and exactly one of them writes.
 *
 * Both sources go through here: the referral link (`link`) and a teammate
 * invite (`invite`), so both obey the same rules.
 */
export async function creditReferral(
  db: Db,
  input: { referee: string; referrer: string; source: ReferralSource; now?: number },
): Promise<boolean> {
  const now = input.now ?? Date.now();
  if (await isSelfReferral(db, input.referee, input.referrer)) return false;
  if (!(await isNewPerson(db, input.referee, now))) return false;
  const row = await db.get<{ referee_person_id: string }>(
    sql`INSERT INTO referral (referee_person_id, referrer_person_id, source, created_at)
        VALUES (${input.referee}, ${input.referrer}, ${input.source}, ${now})
        ON CONFLICT DO NOTHING
        RETURNING referee_person_id`,
  );
  return Boolean(row);
}

/** The name and email on one of a person's member rows. */
export interface PersonNameRow {
  displayName: string | null;
  email: string | null;
}

/**
 * The names a person carries across their member rows (the inverse of
 * `referralPersonKey`): every row with their identity service id, or, for an
 * `email:` key from local development, every row with that email and no id.
 * The row seen most recently comes first, so a name the person changed wins
 * over an old one.
 */
export async function personNames(db: Db, personId: string): Promise<PersonNameRow[]> {
  const email = personId.startsWith('email:') ? personId.slice('email:'.length) : null;
  const rows = email
    ? await db.all<{ display_name: string | null; email: string | null }>(
        sql`SELECT display_name, email FROM member
            WHERE external_id IS NULL AND lower(email) = ${email}
            ORDER BY COALESCE(last_seen_at, created_at) DESC`,
      )
    : await db.all<{ display_name: string | null; email: string | null }>(
        sql`SELECT display_name, email FROM member
            WHERE external_id = ${personId}
            ORDER BY COALESCE(last_seen_at, created_at) DESC`,
      );
  return rows.map((r) => ({
    displayName: r.display_name == null ? null : String(r.display_name),
    email: r.email == null ? null : String(r.email),
  }));
}
