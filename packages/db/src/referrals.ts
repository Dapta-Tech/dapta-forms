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
