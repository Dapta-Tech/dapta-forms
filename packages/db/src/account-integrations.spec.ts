/**
 * Account integration credentials + token crypto. Honors DATABASE_URL like the
 * submission-integrity spec so the Postgres parity job exercises the same flow;
 * locally it runs on in-memory SQLite.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from './client';
import { migrate } from './migrate';
import { encryptToken, decryptToken, hasEncryptionKey, tokenLast4 } from './crypto';
import {
  upsertIntegration,
  getIntegration,
  listIntegrationStatuses,
  deleteIntegration,
  resolveProviderToken,
  describeIntegration,
} from './account-integrations';

const KEY = randomBytes(32).toString('base64');

describe('token crypto', () => {
  it('round-trips a token', () => {
    const t = 'fake-testtoken-secret-value-123';
    const enc = encryptToken(t, KEY);
    expect(enc).toMatch(/^v1\./);
    expect(enc).not.toContain(t);
    expect(decryptToken(enc, KEY)).toBe(t);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    expect(encryptToken('x', KEY)).not.toBe(encryptToken('x', KEY));
  });

  it('fails to decrypt with a wrong key (auth tag)', () => {
    const enc = encryptToken('secret', KEY);
    expect(() => decryptToken(enc, randomBytes(32).toString('base64'))).toThrow();
  });

  it('rejects a non-32-byte key', () => {
    expect(hasEncryptionKey(Buffer.from('short').toString('base64'))).toBe(false);
    expect(hasEncryptionKey(KEY)).toBe(true);
    expect(hasEncryptionKey(undefined)).toBe(false);
  });

  it('tokenLast4', () => {
    expect(tokenLast4('abcdef1234')).toBe('1234');
  });
});

describe('account_integration repo', () => {
  let db: Db;
  let accountId: string;

  beforeEach(async () => {
    db = await createDb(process.env.DATABASE_URL ?? 'file::memory:');
    await migrate(db);
    accountId = randomUUID();
    await db.run(
      sql`INSERT INTO account (id, code, name, created_at)
          VALUES (${accountId}, ${'t' + accountId.slice(0, 5)}, ${'Test'}, ${Date.now()})`,
    );
  });
  afterEach(async () => {
    await db.close();
  });

  it('connect stores an encrypted token (never plaintext) and a token-free status', async () => {
    const status = await upsertIntegration(db, accountId, 'hubspot', 'fake-testtoken-abc-9999', KEY, 'Acme Hub');
    expect(status).toEqual({
      provider: 'hubspot',
      connected: true,
      last4: '9999',
      label: 'Acme Hub',
      connectedAt: expect.any(Number),
    });
    const row = await getIntegration(db, accountId, 'hubspot');
    expect(row!.encryptedToken).not.toContain('fake-testtoken-abc-9999');
    expect(decryptToken(row!.encryptedToken, KEY)).toBe('fake-testtoken-abc-9999');
    // describe never leaks the token
    expect(JSON.stringify(describeIntegration(row!))).not.toContain('fake-testtoken');
  });

  it('re-connect updates the same (account, provider) row', async () => {
    await upsertIntegration(db, accountId, 'hubspot', 'token-one-1111', KEY);
    await upsertIntegration(db, accountId, 'hubspot', 'token-two-2222', KEY);
    const rows = await listIntegrationStatuses(db, accountId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.last4).toBe('2222');
    expect(decryptToken((await getIntegration(db, accountId, 'hubspot'))!.encryptedToken, KEY)).toBe(
      'token-two-2222',
    );
  });

  it('resolveProviderToken prefers the account token, falls back to env', async () => {
    // No connection yet → env fallback.
    expect(await resolveProviderToken(db, accountId, 'hubspot', KEY, 'env-token')).toBe('env-token');
    expect(await resolveProviderToken(db, accountId, 'hubspot', KEY, undefined)).toBeNull();
    // After connecting → the account token wins.
    await upsertIntegration(db, accountId, 'hubspot', 'account-token', KEY);
    expect(await resolveProviderToken(db, accountId, 'hubspot', KEY, 'env-token')).toBe('account-token');
    // Without an encryption key configured → only env fallback is consulted.
    expect(await resolveProviderToken(db, accountId, 'hubspot', undefined, 'env-token')).toBe('env-token');
  });

  it('disconnect removes the row (idempotent) and is account-scoped', async () => {
    await upsertIntegration(db, accountId, 'calendly', 'cal-token-4444', KEY);
    const stranger = randomUUID();
    await db.run(
      sql`INSERT INTO account (id, code, name, created_at)
          VALUES (${stranger}, ${'s' + stranger.slice(0, 5)}, ${'S'}, ${Date.now()})`,
    );
    // A foreign account can't see or delete it.
    await deleteIntegration(db, stranger, 'calendly');
    expect(await getIntegration(db, accountId, 'calendly')).not.toBeNull();
    await deleteIntegration(db, accountId, 'calendly');
    expect(await getIntegration(db, accountId, 'calendly')).toBeNull();
    await deleteIntegration(db, accountId, 'calendly'); // idempotent
  });
});
