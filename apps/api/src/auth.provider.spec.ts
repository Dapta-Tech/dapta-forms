import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, migrate, seed, sql, type Db } from '@slate/db';
import { loadServerEnv } from '@slate/config/env';
import { LocalAuthProvider, createAuthProvider, type ReqLike } from './auth.provider';

function reqWith(headers: Record<string, string>): ReqLike {
  return { headers };
}

describe('C1 — host auth is a real, safe-by-default port', () => {
  let db: Db;
  let seededAccountId: string;

  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    await seed(db);
    seededAccountId = (await db.get<{ id: string }>(sql`SELECT id FROM account WHERE code='acme'`))!.id;
  });

  it('LocalAuthProvider IGNORES x-slate-* impersonation headers in production', async () => {
    const provider = new LocalAuthProvider(db, { NODE_ENV: 'production' });
    const p = await provider.resolveHost(
      reqWith({ 'x-slate-account': 'FAKE-ACCT', 'x-slate-member': 'FAKE-MEMBER' }),
    );
    // Spoofed headers are dropped; only the seeded principal is resolved.
    expect(p.accountId).toBe(seededAccountId);
    expect(p.accountId).not.toBe('FAKE-ACCT');
    expect(p.memberId).not.toBe('FAKE-MEMBER');
  });

  it('LocalAuthProvider honors impersonation headers ONLY in development/test', async () => {
    const dev = new LocalAuthProvider(db, { NODE_ENV: 'development' });
    const p = await dev.resolveHost(
      reqWith({ 'x-slate-account': 'DEV-ACCT', 'x-slate-member': 'DEV-MEMBER' }),
    );
    expect(p).toEqual({ accountId: 'DEV-ACCT', memberId: 'DEV-MEMBER' });
  });

  it('createAuthProvider wires the local stub and refuses workos without the overlay', () => {
    const local = createAuthProvider(loadServerEnv({ AUTH_PROVIDER: 'local' }), db);
    expect(local.name).toBe('local');
    expect(() => createAuthProvider(loadServerEnv({ AUTH_PROVIDER: 'workos' }), db)).toThrow(/workos/i);
  });

  it('loadServerEnv fails loud on NODE_ENV=production + AUTH_PROVIDER=local', () => {
    expect(() => loadServerEnv({ NODE_ENV: 'production', AUTH_PROVIDER: 'local' })).toThrow(
      /production/i,
    );
    // A real provider in production is fine (schema-wise).
    expect(() => loadServerEnv({ NODE_ENV: 'production', AUTH_PROVIDER: 'workos' })).not.toThrow();
  });
});

describe('LocalAuthProvider — email-aware dev login', () => {
  let db: Db;
  let seededAccountId: string;

  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    await seed(db);
    seededAccountId = (await db.get<{ id: string }>(sql`SELECT id FROM account WHERE code='acme'`))!.id;
  });

  async function memberEmail(memberId: string): Promise<string | null> {
    const row = await db.get<{ email: string | null }>(sql`SELECT email FROM member WHERE id = ${memberId}`);
    return row?.email ?? null;
  }

  it('a KNOWN email resolves its OWN seeded account+member (not the first one)', async () => {
    const dev = new LocalAuthProvider(db, { NODE_ENV: 'development' });
    // jordan is the SECOND seeded member — proving it does not just pick the first.
    const p = await dev.resolveHost(reqWith({ 'x-slate-email': 'jordan@example.com' }));
    expect(p.accountId).toBe(seededAccountId);
    expect(await memberEmail(p.memberId)).toBe('jordan@example.com');
  });

  it('an UNKNOWN email JIT-provisions a fresh account+member', async () => {
    const dev = new LocalAuthProvider(db, { NODE_ENV: 'development' });
    const p = await dev.resolveHost(reqWith({ 'x-slate-email': 'taylor@example.com' }));
    expect(p.accountId).not.toBe(seededAccountId);
    expect(await memberEmail(p.memberId)).toBe('taylor@example.com');
    // Idempotent: a second login lands on the SAME account+member.
    const again = await dev.resolveHost(reqWith({ 'x-slate-email': 'taylor@example.com' }));
    expect(again).toEqual(p);
  });

  it('two DIFFERENT emails get ISOLATED accounts', async () => {
    const dev = new LocalAuthProvider(db, { NODE_ENV: 'development' });
    const a = await dev.resolveHost(reqWith({ 'x-slate-email': 'alice@a.example' }));
    const b = await dev.resolveHost(reqWith({ 'x-slate-email': 'bob@b.example' }));
    expect(a.accountId).not.toBe(b.accountId);
    expect(a.memberId).not.toBe(b.memberId);
  });

  it('falls back to DEV_LOGIN_EMAIL env when no header is sent', async () => {
    const dev = new LocalAuthProvider(db, { NODE_ENV: 'development', DEV_LOGIN_EMAIL: 'env@example.com' });
    const p = await dev.resolveHost(reqWith({}));
    expect(await memberEmail(p.memberId)).toBe('env@example.com');
  });

  it('impersonation headers still take precedence over email', async () => {
    const dev = new LocalAuthProvider(db, { NODE_ENV: 'development', DEV_LOGIN_EMAIL: 'env@example.com' });
    const p = await dev.resolveHost(
      reqWith({ 'x-slate-account': 'IMP-ACCT', 'x-slate-member': 'IMP-MEMBER', 'x-slate-email': 'x@y.z' }),
    );
    expect(p).toEqual({ accountId: 'IMP-ACCT', memberId: 'IMP-MEMBER' });
  });

  it('IGNORES email hints in production (resolves the seeded principal only)', async () => {
    const prod = new LocalAuthProvider(db, { NODE_ENV: 'production', DEV_LOGIN_EMAIL: 'taylor@example.com' });
    const p = await prod.resolveHost(reqWith({ 'x-slate-email': 'taylor@example.com' }));
    expect(p.accountId).toBe(seededAccountId);
    // No JIT account was created for the email.
    const jit = await db.get(sql`SELECT id FROM member WHERE email = 'taylor@example.com'`);
    expect(jit).toBeUndefined();
  });
});

describe('LocalAuthProvider — strict mode (AUTH_LOCAL_STRICT) enables a logged-out state', () => {
  let db: Db;
  let seededAccountId: string;

  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    await seed(db);
    seededAccountId = (await db.get<{ id: string }>(sql`SELECT id FROM account WHERE code='acme'`))!.id;
  });

  it('DEFAULT (non-strict): no identity → falls back to the seeded principal (zero-friction)', async () => {
    const dev = new LocalAuthProvider(db, { NODE_ENV: 'development' });
    const p = await dev.resolveHost(reqWith({}));
    expect(p.accountId).toBe(seededAccountId);
  });

  it('STRICT: no identity → 401 UNAUTHENTICATED (no seeded fallback)', async () => {
    const dev = new LocalAuthProvider(db, { NODE_ENV: 'development', AUTH_LOCAL_STRICT: true });
    await expect(dev.resolveHost(reqWith({}))).rejects.toMatchObject({ status: 401 });
  });

  it('STRICT: an email still logs in (resolves/JIT-provisions)', async () => {
    const dev = new LocalAuthProvider(db, { NODE_ENV: 'development', AUTH_LOCAL_STRICT: true });
    const p = await dev.resolveHost(reqWith({ 'x-slate-email': 'jordan@example.com' }));
    expect(p.accountId).toBe(seededAccountId);
  });

  it('STRICT: DEV_LOGIN_EMAIL still logs in (a set default is an identity)', async () => {
    const dev = new LocalAuthProvider(db, {
      NODE_ENV: 'development',
      AUTH_LOCAL_STRICT: true,
      DEV_LOGIN_EMAIL: 'env@example.com',
    });
    const p = await dev.resolveHost(reqWith({}));
    expect(p.accountId).toBeDefined();
  });

  it('STRICT: impersonation headers still resolve', async () => {
    const dev = new LocalAuthProvider(db, { NODE_ENV: 'development', AUTH_LOCAL_STRICT: true });
    const p = await dev.resolveHost(reqWith({ 'x-slate-account': 'A', 'x-slate-member': 'M' }));
    expect(p).toEqual({ accountId: 'A', memberId: 'M' });
  });
});
