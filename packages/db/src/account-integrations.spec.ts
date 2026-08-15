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
  upsertIntegrationWithRevision,
  credentialUpsertStatement,
  getIntegration,
  listIntegrationStatuses,
  deleteIntegration,
  resolveProviderToken,
  describeIntegration,
  integrationProviders,
  providerCredentialRevisionEquals,
} from './account-integrations';
import { jsonParam } from './forms';

const KEY = randomBytes(32).toString('base64');

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function returnedGeneration(raw: unknown): { id: string; generation: number } {
  const row = (raw as Array<{ id?: unknown; credential_generation?: unknown }>)[0];
  const generation = Number(row?.credential_generation);
  if (!row || typeof row.id !== 'string' || !Number.isSafeInteger(generation) || generation <= 0) {
    throw new Error('invalid UPSERT RETURNING row');
  }
  return { id: row.id, generation };
}

async function waitForPostgresLock(db: Db, pid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = await db.get<{ wait_event_type: string | null }>(
      sql`SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${pid}`,
    );
    if (state?.wait_event_type === 'Lock') return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`PostgreSQL session ${pid} did not reach the row-lock barrier`);
}

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
    expect(row!.credentialGeneration).toBe(1);
    // describe never leaks the token
    expect(JSON.stringify(describeIntegration(row!))).not.toContain('fake-testtoken');
  });

  it('re-connect updates the same (account, provider) row', async () => {
    await upsertIntegration(db, accountId, 'hubspot', 'token-one-1111', KEY);
    const first = await resolveProviderToken(db, accountId, 'hubspot', KEY, undefined);
    await upsertIntegration(db, accountId, 'hubspot', 'token-two-2222', KEY);
    const second = await resolveProviderToken(db, accountId, 'hubspot', KEY, undefined);
    const rows = await listIntegrationStatuses(db, accountId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.last4).toBe('2222');
    expect(decryptToken((await getIntegration(db, accountId, 'hubspot'))!.encryptedToken, KEY)).toBe(
      'token-two-2222',
    );
    if (!first || first.revision.kind !== 'stored') throw new Error('expected first stored revision');
    if (!second || second.revision.kind !== 'stored') throw new Error('expected second stored revision');
    expect(second).toMatchObject({ token: 'token-two-2222', revision: { kind: 'stored' } });
    expect(second.revision).not.toEqual(first.revision);
    expect(second.revision.generation).toBe(2);
    expect(second.revision.id).toBe(first.revision.id);
  });

  it('returns one row from db.get for credential UPSERT RETURNING on this dialect', async () => {
    const id = randomUUID();
    const now = Date.now();
    const returned = await db.get<{ id: unknown; credential_generation: unknown }>(
      sql`INSERT INTO account_integration (
            id, account_id, provider, encrypted_token, meta, connected_at, updated_at, credential_generation
          ) VALUES (
            ${id}, ${accountId}, ${'hubspot'}, ${encryptToken('returning-token', KEY)},
            ${jsonParam({ last4: 'oken' })}, ${now}, ${now}, 1
          )
          ON CONFLICT (account_id, provider) DO UPDATE SET
            encrypted_token = EXCLUDED.encrypted_token,
            meta = EXCLUDED.meta,
            updated_at = EXCLUDED.updated_at,
            credential_generation = account_integration.credential_generation + 1
          RETURNING id, credential_generation`,
    );

    expect(returned).toBeDefined();
    expect(returned!.id).toBe(id);
    expect(Number(returned!.credential_generation)).toBe(1);
  });

  it('defaults credential generation to 1 for a legacy writer that omits the column', async () => {
    const id = randomUUID();
    const now = Date.now();
    await db.run(
      sql`INSERT INTO account_integration (
            id, account_id, provider, encrypted_token, meta, connected_at, updated_at
          ) VALUES (
            ${id}, ${accountId}, ${'calendly'}, ${encryptToken('legacy-token', KEY)},
            ${jsonParam({ last4: 'oken' })}, ${now}, ${now}
          )`,
    );

    expect((await getIntegration(db, accountId, 'calendly'))!.credentialGeneration).toBe(1);
  });

  it('rejects non-positive, non-integer, and unsafe generations returned by UPSERT', async () => {
    for (const generation of ['0', '1.5', '9007199254740992']) {
      const invalidReturningDb = {
        dialect: 'sqlite',
        get: async () => ({ id: 'returned-id', credential_generation: generation }),
      } as unknown as Db;
      await expect(
        upsertIntegrationWithRevision(invalidReturningDb, accountId, 'hubspot', 'invalid-generation', KEY),
      ).rejects.toThrow('invalid credential generation returned by database');
    }
  });

  it('allocates distinct database generations for concurrent writes and increments sequential writes', async () => {
    for (const provider of integrationProviders) {
      const before = await upsertIntegrationWithRevision(db, accountId, provider, `${provider}-r0`, KEY);
      const [writeA, writeB] = await Promise.all([
        upsertIntegrationWithRevision(db, accountId, provider, `${provider}-a`, KEY),
        upsertIntegrationWithRevision(db, accountId, provider, `${provider}-b`, KEY),
      ]);
      const current = await resolveProviderToken(db, accountId, provider, KEY, undefined);

      // This is the counterfactual oracle: a read-then-write allocator can
      // reuse generation 2 here, while the conflict update must return 2 and 3.
      expect(new Set([writeA.revision.generation, writeB.revision.generation])).toEqual(new Set([2, 3]));
      expect(writeA.revision.generation).not.toBe(before.revision.generation);
      expect(writeB.revision.generation).not.toBe(before.revision.generation);
      expect(writeA.revision.id).toBe(before.revision.id);
      expect(writeB.revision.id).toBe(before.revision.id);
      expect(current).toMatchObject({ token: expect.stringMatching(new RegExp(`${provider}-[ab]`)) });
      expect(current!.revision).toMatchObject({ generation: 3 });
    }

    const writes = 4;
    await deleteIntegration(db, accountId, 'hubspot');
    let latest = await upsertIntegrationWithRevision(db, accountId, 'hubspot', 'sequential-r0', KEY);
    for (let i = 1; i <= writes; i++) {
      latest = await upsertIntegrationWithRevision(db, accountId, 'hubspot', `sequential-${i}`, KEY);
    }
    expect(latest.revision.generation).toBe(writes + 1);
  });

  it('uses two live PostgreSQL sessions that contend at a row-lock barrier', async () => {
    if (db.dialect !== 'postgres') return;
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required for live PostgreSQL concurrency proof');
    const sessionA = await createDb(url);
    const sessionB = await createDb(url);
    try {
      for (const provider of integrationProviders) {
        const baseline = await upsertIntegrationWithRevision(db, accountId, provider, `${provider}-r0`, KEY);
        const aLocked = deferred<void>();
        const releaseA = deferred<void>();
        const bReady = deferred<number>();
        const startB = deferred<void>();
        const bWrote = deferred<void>();
        const releaseB = deferred<void>();
        const now = Date.now();
        const statementA = credentialUpsertStatement({
          id: randomUUID(),
          accountId,
          provider,
          encryptedToken: encryptToken(`${provider}-a`, KEY),
          meta: { last4: 'r-a' },
          now,
        });
        const statementB = credentialUpsertStatement({
          id: randomUUID(),
          accountId,
          provider,
          encryptedToken: encryptToken(`${provider}-b`, KEY),
          meta: { last4: 'r-b' },
          now,
        });
        const aTask = sessionA.pg!.drizzle.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT id FROM account_integration
                WHERE account_id = ${accountId} AND provider = ${provider}
                FOR UPDATE`,
          );
          aLocked.resolve();
          await releaseA.promise;
          return returnedGeneration(await tx.execute(statementA));
        });
        await aLocked.promise;
        const bTask = sessionB.pg!.drizzle.transaction(async (tx) => {
          const pidRow = (await tx.execute(sql`SELECT pg_backend_pid() AS pid`)) as unknown as Array<{
            pid: unknown;
          }>;
          const pid = Number(pidRow[0]?.pid);
          if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('invalid PostgreSQL backend pid');
          bReady.resolve(pid);
          await startB.promise;
          const result = returnedGeneration(await tx.execute(statementB));
          bWrote.resolve();
          await releaseB.promise;
          return result;
        });
        const bPid = await bReady.promise;
        startB.resolve();
        await waitForPostgresLock(db, bPid);
        releaseA.resolve();
        const writeA = await aTask;
        await bWrote.promise;
        const stale = await resolveProviderToken(db, accountId, provider, KEY, undefined);
        if (!stale || stale.revision.kind !== 'stored') throw new Error('expected stale stored revision');
        releaseB.resolve();
        const writeB = await bTask;
        const current = await resolveProviderToken(db, accountId, provider, KEY, undefined);
        if (!current || current.revision.kind !== 'stored') throw new Error('expected current stored revision');

        // This fails if a read-before-write allocator reuses N+1.
        expect(new Set([writeA.generation, writeB.generation])).toEqual(
          new Set([baseline.revision.generation + 1, baseline.revision.generation + 2]),
        );
        expect(writeA.id).toBe(baseline.revision.id);
        expect(writeB.id).toBe(baseline.revision.id);
        expect(stale.revision.generation).toBe(writeA.generation);
        expect(current.revision.generation).toBe(writeB.generation);
        expect(providerCredentialRevisionEquals(stale.revision, current.revision)).toBe(false);
        expect(current.token).toBe(`${provider}-b`);
      }
    } finally {
      await sessionA.close();
      await sessionB.close();
    }
  });

  it('resolveProviderToken prefers the account token, falls back to env', async () => {
    // No connection yet → env fallback.
    expect(await resolveProviderToken(db, accountId, 'hubspot', KEY, 'env-token')).toMatchObject({
      token: 'env-token',
      revision: { kind: 'env-fallback' },
    });
    expect(await resolveProviderToken(db, accountId, 'hubspot', KEY, undefined)).toBeNull();
    // After connecting → the account token wins.
    await upsertIntegration(db, accountId, 'hubspot', 'account-token', KEY);
    expect(await resolveProviderToken(db, accountId, 'hubspot', KEY, 'env-token')).toMatchObject({
      token: 'account-token',
      revision: { kind: 'stored', id: expect.any(String), generation: 1 },
    });
    // Without an encryption key configured → only env fallback is consulted.
    expect(await resolveProviderToken(db, accountId, 'hubspot', undefined, 'env-token')).toMatchObject({
      token: 'env-token',
      revision: { kind: 'env-fallback' },
    });
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

  it('changes the stored revision after a disconnect and reconnect', async () => {
    await upsertIntegration(db, accountId, 'hubspot', 'first-token-1111', KEY);
    const first = await resolveProviderToken(db, accountId, 'hubspot', KEY, undefined);
    await deleteIntegration(db, accountId, 'hubspot');
    await upsertIntegration(db, accountId, 'hubspot', 'second-token-2222', KEY);
    const second = await resolveProviderToken(db, accountId, 'hubspot', KEY, undefined);

    expect(first).toMatchObject({ revision: { kind: 'stored' } });
    expect(second).toMatchObject({ revision: { kind: 'stored' } });
    expect(second!.revision).not.toEqual(first!.revision);
  });
});
