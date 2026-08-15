/**
 * The public page write contract at the HTTP boundary.
 *
 * v2 is mandatory and versioned in the PATH: an API that predates it answers
 * 404, so a new web build cannot have an unguarded write quietly accepted by an
 * old pod. Every mutation names the revision it expects; a missing or malformed
 * one is refused rather than defaulted.
 *
 * The `/v1` writer stays exactly long enough for a rolling deploy, behind a
 * flag, and even then it increments the revision atomically with its write —
 * otherwise a fence could not decide anything while an old tab is saving.
 *
 * Runs against DATABASE_URL when set (Postgres parity), in-memory SQLite
 * otherwise.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDb, migrate, sql, getMemberProfileState, type Db } from '@quill/db';
import { ProfileV2Controller } from './profile-v2.controller';
import { AdminCrudController } from './admin-crud.controller';
import type { AuthService, ReqLike } from './auth.service';

const page = (enabled: boolean, headline = 'Growth partner') => ({
  version: 1 as const,
  enabled,
  headline,
});

/** Status carried by a Nest HttpException. */
const statusOf = async (run: () => Promise<unknown>): Promise<number> => {
  try {
    await run();
  } catch (e) {
    return (e as { getStatus?: () => number }).getStatus?.() ?? 0;
  }
  return 200;
};

const bodyOf = async (run: () => Promise<unknown>): Promise<Record<string, unknown>> => {
  try {
    await run();
  } catch (e) {
    return (e as { getResponse?: () => Record<string, unknown> }).getResponse?.() ?? {};
  }
  return {};
};

describe('public page write contract', () => {
  let db: Db;
  let accountId: string;
  let memberId: string;
  let v2: ProfileV2Controller;
  let auth: AuthService;
  const req = {} as ReqLike;

  beforeEach(async () => {
    db = await createDb(process.env.DATABASE_URL ?? 'file::memory:');
    await migrate(db);
    accountId = randomUUID();
    memberId = randomUUID();
    await db.run(
      sql`INSERT INTO account (id, code, name, created_at)
          VALUES (${accountId}, ${'t' + accountId.slice(0, 8)}, ${'Test'}, ${Date.now()})`,
    );
    await db.run(
      sql`INSERT INTO member (id, account_id, email, display_name, handle, role, status, created_at)
          VALUES (${memberId}, ${accountId}, ${memberId + '@e.com'}, ${'Alex'},
                  ${'h' + memberId.slice(0, 8)}, ${'owner'}, ${'active'}, ${Date.now()})`,
    );
    auth = {
      resolveHost: async () => ({ accountId, memberId, role: 'owner' }),
    } as unknown as AuthService;
    // Writes ON for the contract tests below; the gate has its own describe.
    v2 = new ProfileV2Controller(db, auth, { PROFILE_V2_WRITES_ENABLED: true });
  });

  afterEach(async () => {
    await db.run(sql`DELETE FROM member WHERE account_id = ${accountId}`);
    await db.run(sql`DELETE FROM account WHERE id = ${accountId}`);
    await db.close();
  });

  describe('GET — the capability signal', () => {
    it('carries the revision to write against', async () => {
      const read = (await v2.read(req)) as { revision: number; profile: unknown };

      expect(typeof read.revision).toBe('number');
      expect(read).toMatchObject({ revision: 0, profile: null });
    });
  });

  describe('PUT /v2/me/profile', () => {
    it('writes when the expectation matches, and returns the new revision', async () => {
      const res = (await v2.save(req, { profile: page(true), expectedRevision: 0 })) as {
        ok: boolean;
        revision: number;
      };

      expect(res).toMatchObject({ ok: true, revision: 1 });
      expect((await getMemberProfileState(db, accountId, memberId))!.profile).toMatchObject({
        enabled: true,
      });
    });

    it('fails closed when the revision is missing', async () => {
      expect(await statusOf(() => v2.save(req, { profile: page(true) }))).toBe(400);
      // Nothing was written by the refusal.
      expect((await getMemberProfileState(db, accountId, memberId))!.revision).toBe(0);
    });

    it('fails closed on a revision that is not a plain non-negative integer', async () => {
      for (const bad of [null, '0', 1.5, -1, Number.MAX_SAFE_INTEGER + 1]) {
        expect(
          await statusOf(() => v2.save(req, { profile: page(true), expectedRevision: bad })),
          String(bad),
        ).toBe(400);
      }
    });

    it('answers a stale expectation with 409 and the authoritative state', async () => {
      await v2.save(req, { profile: page(true, 'first'), expectedRevision: 0 });

      const status = await statusOf(() =>
        v2.save(req, { profile: page(false, 'second'), expectedRevision: 0 }),
      );
      const body = await bodyOf(() =>
        v2.save(req, { profile: page(false, 'second'), expectedRevision: 0 }),
      );

      expect(status).toBe(409);
      expect(body).toMatchObject({ error: 'REVISION_CONFLICT', revision: 1 });
      expect((body.profile as { headline: string }).headline).toBe('first');
      // Two refusals, and the revision is still 1: a conflict burns nothing.
      expect((await getMemberProfileState(db, accountId, memberId))!.revision).toBe(1);
    });

    it('removes the page when the profile is null', async () => {
      await v2.save(req, { profile: page(true), expectedRevision: 0 });
      const res = (await v2.save(req, { profile: null, expectedRevision: 1 })) as {
        profile: unknown;
      };

      expect(res.profile).toBeNull();
    });
  });

  describe('POST /v2/me/profile/fence', () => {
    it('advances the revision without touching the page', async () => {
      await v2.save(req, { profile: page(true, 'kept'), expectedRevision: 0 });

      const res = (await v2.fence(req, { expectedRevision: 1 })) as {
        revision: number;
        profile: { headline: string };
      };

      expect(res).toMatchObject({ ok: true, revision: 2 });
      expect(res.profile.headline).toBe('kept');
    });

    it('requires a revision too — a fence with no expectation orders nothing', async () => {
      expect(await statusOf(() => v2.fence(req, {}))).toBe(400);
      expect(await statusOf(() => v2.fence(req, { expectedRevision: '1' }))).toBe(400);
    });

    it('conflicts, without burning a revision, when repeated with the same expectation', async () => {
      await v2.fence(req, { expectedRevision: 0 });

      expect(await statusOf(() => v2.fence(req, { expectedRevision: 0 }))).toBe(409);
      expect(await statusOf(() => v2.fence(req, { expectedRevision: 0 }))).toBe(409);
      expect((await getMemberProfileState(db, accountId, memberId))!.revision).toBe(1);
    });

    it('blocks the write it fenced', async () => {
      await v2.fence(req, { expectedRevision: 0 });

      expect(await statusOf(() => v2.save(req, { profile: page(true), expectedRevision: 0 }))).toBe(
        409,
      );
      expect((await getMemberProfileState(db, accountId, memberId))!.profile).toBeNull();
    });
  });

  describe('the deprecated /v1 write shim', () => {
    const shim = (db: Db, auth: AuthService, on: boolean) =>
      new AdminCrudController(db, auth, {} as never, {} as never, {} as never, undefined, undefined, {
        PROFILE_V1_WRITE_SHIM: on,
        PROFILE_V2_WRITES_ENABLED: true,
      });

    it('still increments the revision atomically, so fences stay decidable', async () => {
      const res = (await shim(db, auth, true).saveMyProfile(req, { profile: page(true) })) as {
        revision: number;
      };

      expect(res).toMatchObject({ ok: true, revision: 1 });
      expect((await getMemberProfileState(db, accountId, memberId))!.revision).toBe(1);
      // A fence that expected the pre-write revision now conflicts, which is
      // what tells a v2 client that something else wrote.
      expect(await statusOf(() => v2.fence(req, { expectedRevision: 0 }))).toBe(409);
    });

    it('is 410 once the gate is closed, so no unguarded writer survives the rollout', async () => {
      expect(
        await statusOf(() => shim(db, auth, false).saveMyProfile(req, { profile: page(true) })),
      ).toBe(410);
      expect((await getMemberProfileState(db, accountId, memberId))!.revision).toBe(0);
    });

    it('is closed by default when nothing configured it', async () => {
      const noEnv = new AdminCrudController(
        db,
        auth,
        {} as never,
        {} as never,
        {} as never,
        undefined,
        undefined,
        undefined,
      );

      expect(await statusOf(() => noEnv.saveMyProfile(req, { profile: page(true) }))).toBe(410);
    });

    it('reports the revision on the v1 read, which is how a client detects v2', async () => {
      const read = (await shim(db, auth, true).myProfile(req)) as { revision: number };

      expect(typeof read.revision).toBe('number');
    });
  });
});

describe('the v2 write gate', () => {
  let db: Db;
  let accountId: string;
  let memberId: string;
  let auth: AuthService;
  const req = {} as ReqLike;

  beforeEach(async () => {
    db = await createDb(process.env.DATABASE_URL ?? 'file::memory:');
    await migrate(db);
    accountId = randomUUID();
    memberId = randomUUID();
    await db.run(
      sql`INSERT INTO account (id, code, name, created_at)
          VALUES (${accountId}, ${'t' + accountId.slice(0, 8)}, ${'Test'}, ${Date.now()})`,
    );
    await db.run(
      sql`INSERT INTO member (id, account_id, email, display_name, handle, role, status, created_at)
          VALUES (${memberId}, ${accountId}, ${memberId + '@e.com'}, ${'Alex'},
                  ${'h' + memberId.slice(0, 8)}, ${'owner'}, ${'active'}, ${Date.now()})`,
    );
    auth = {
      resolveHost: async () => ({ accountId, memberId, role: 'owner' }),
    } as unknown as AuthService;
  });

  afterEach(async () => {
    await db.run(sql`DELETE FROM member WHERE account_id = ${accountId}`);
    await db.run(sql`DELETE FROM account WHERE id = ${accountId}`);
    await db.close();
  });

  const off = () => new ProfileV2Controller(db, auth, { PROFILE_V2_WRITES_ENABLED: false });

  it('is closed when nothing configured it, so a fresh deploy cannot write', async () => {
    const unconfigured = new ProfileV2Controller(db, auth);

    expect(await statusOf(() => unconfigured.save(req, { profile: page(true), expectedRevision: 0 }))).toBe(
      501,
    );
  });

  it('refuses a CAS before it can touch the row', async () => {
    const status = await statusOf(() => off().save(req, { profile: page(true), expectedRevision: 0 }));

    expect(status).toBe(501);
    // Nothing written, and nothing spent: the revision is exactly where it was.
    expect((await getMemberProfileState(db, accountId, memberId))!.revision).toBe(0);
    expect((await getMemberProfileState(db, accountId, memberId))!.profile).toBeNull();
  });

  it('refuses a fence too, so no revision is burned while disabled', async () => {
    expect(await statusOf(() => off().fence(req, { expectedRevision: 0 }))).toBe(501);
    expect((await getMemberProfileState(db, accountId, memberId))!.revision).toBe(0);
  });

  it('still answers reads, and reports the capability as unavailable', async () => {
    const read = (await off().read(req)) as { revision: number; writesEnabled: boolean };

    expect(read).toMatchObject({ revision: 0, writesEnabled: false });
  });

  it('reports the capability as available once switched on, and then writes', async () => {
    const on = new ProfileV2Controller(db, auth, { PROFILE_V2_WRITES_ENABLED: true });

    expect(await on.read(req)).toMatchObject({ writesEnabled: true });
    expect(await on.save(req, { profile: page(true), expectedRevision: 0 })).toMatchObject({
      ok: true,
      revision: 1,
    });
  });

  it('is reported through the v1 read as well, so an old route cannot mislead a new client', async () => {
    const shim = new AdminCrudController(
      db,
      auth,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
      { PROFILE_V1_WRITE_SHIM: true, PROFILE_V2_WRITES_ENABLED: false },
    );

    expect(await shim.myProfile(req)).toMatchObject({ writesEnabled: false });
    // The deprecated writer is still available for an OLD web build in the
    // bounded window, and still increments.
    expect(await shim.saveMyProfile(req, { profile: page(true) })).toMatchObject({
      ok: true,
      revision: 1,
    });
  });
});

describe('an unresolved write', () => {
  it('is 503 with its own code — never a 409 a client would adopt', async () => {
    const stubDb = {
      dialect: 'postgres',
      all: async () => {
        throw Object.assign(new Error('could not serialize access'), { code: '40001' });
      },
      get: async () => ({ profile: null, profile_revision: 4 }),
      run: async () => undefined,
      execRaw: async () => undefined,
      close: async () => undefined,
    } as unknown as Db;
    const auth = {
      resolveHost: async () => ({ accountId: 'a', memberId: 'm', role: 'owner' }),
    } as unknown as AuthService;
    const controller = new ProfileV2Controller(stubDb, auth, { PROFILE_V2_WRITES_ENABLED: true });
    const req = {} as ReqLike;

    expect(await statusOf(() => controller.save(req, { profile: page(true), expectedRevision: 4 }))).toBe(
      503,
    );
    expect(await bodyOf(() => controller.fence(req, { expectedRevision: 4 }))).toMatchObject({
      error: 'WRITE_UNRESOLVED',
    });
  });
});
