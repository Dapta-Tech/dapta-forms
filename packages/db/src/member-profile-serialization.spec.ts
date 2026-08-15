/**
 * What a serialization failure is allowed to mean.
 *
 * Postgres can abort a statement with `40001` under contention. That rollback
 * proves the write did not commit — and nothing else. Reading it as "somebody
 * else won" would be a lie the UI acts on: it would adopt state, drop the
 * blocked flag, and tell the member their save was resolved while the very same
 * expectation is still live and retryable.
 *
 * The rule pinned here: after `40001`, the outcome is decided by re-reading the
 * account-scoped row. Conflict only when the stored revision has actually moved
 * past the expectation; absent member is not-found; a revision still sitting at
 * the expectation is `unresolved`, which keeps the caller blocked.
 *
 * The failure is injected through a stub `Db`, so both dialects and both call
 * sites are covered deterministically without racing a real database.
 */
import { describe, it, expect } from 'vitest';
import { casSetMemberProfile, fenceMemberProfile } from './members';
import type { Db } from './client';

const serializationFailure = Object.assign(new Error('could not serialize access'), {
  code: '40001',
});

/** Convenience: build the stub and expose the read counter. */
function stub(row: Record<string, unknown> | undefined) {
  let reads = 0;
  const db = {
    dialect: 'postgres' as const,
    all: async () => {
      throw serializationFailure;
    },
    get: async () => {
      reads += 1;
      return row;
    },
    run: async () => undefined,
    execRaw: async () => undefined,
    close: async () => undefined,
  } as unknown as Db;
  return { db, reads: () => reads };
}

const storedRow = (revision: number, profile: unknown = null) => ({
  profile: profile == null ? null : JSON.stringify(profile),
  profile_revision: revision,
});

describe('a 40001 that rolled back with the revision untouched', () => {
  it('leaves a CAS unresolved — never a conflict', async () => {
    // The row is still exactly where the caller expected it, so nothing consumed
    // the expectation. Reporting a conflict here would let the UI adopt state
    // and stop blocking while this write can still be retried.
    const { db } = stub(storedRow(5));

    expect(await casSetMemberProfile(db, 'acct', 'member', { version: 1 }, 5)).toEqual({
      status: 'unresolved',
    });
  });

  it('leaves a fence unresolved — never a conflict', async () => {
    const { db } = stub(storedRow(5));

    expect(await fenceMemberProfile(db, 'acct', 'member', 5)).toEqual({ status: 'unresolved' });
  });

  it('releases no revision: the expectation is still the one to retry with', async () => {
    const { db } = stub(storedRow(0));

    expect(await fenceMemberProfile(db, 'acct', 'member', 0)).toEqual({ status: 'unresolved' });
    expect(await casSetMemberProfile(db, 'acct', 'member', null, 0)).toEqual({
      status: 'unresolved',
    });
  });

  it('decides by asking the database, not by assuming', async () => {
    const s = stub(storedRow(5));

    await casSetMemberProfile(s.db, 'acct', 'member', { version: 1 }, 5);

    expect(s.reads()).toBe(1);
  });
});

describe('a 40001 where the row really did move on', () => {
  it('is a conflict, carrying the state that beat it', async () => {
    const { db } = stub(storedRow(6, { version: 1, enabled: true }));

    expect(await casSetMemberProfile(db, 'acct', 'member', { version: 1 }, 5)).toEqual({
      status: 'conflict',
      revision: 6,
      profile: { version: 1, enabled: true },
    });
  });

  it('is a conflict for a fence too', async () => {
    const { db } = stub(storedRow(9));

    expect(await fenceMemberProfile(db, 'acct', 'member', 5)).toMatchObject({
      status: 'conflict',
      revision: 9,
    });
  });
});

describe('a 40001 for a member who is not there', () => {
  it('is not-found, for both writers', async () => {
    const { db } = stub(undefined);

    expect(await casSetMemberProfile(db, 'acct', 'member', null, 5)).toEqual({
      status: 'not_found',
    });
    expect(await fenceMemberProfile(db, 'acct', 'member', 5)).toEqual({ status: 'not_found' });
  });
});

describe('other database errors', () => {
  it('propagate instead of being dressed up as a conflict', async () => {
    const db = {
      dialect: 'postgres',
      all: async () => {
        throw Object.assign(new Error('syntax error'), { code: '42601' });
      },
      get: async () => storedRow(5),
      run: async () => undefined,
      execRaw: async () => undefined,
      close: async () => undefined,
    } as unknown as Db;

    await expect(casSetMemberProfile(db, 'acct', 'member', null, 5)).rejects.toThrow('syntax error');
    await expect(fenceMemberProfile(db, 'acct', 'member', 5)).rejects.toThrow('syntax error');
  });
});
