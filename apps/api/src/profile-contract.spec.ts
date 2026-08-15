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
import { UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createDb, migrate, sql, getMemberProfileState, type Db } from '@quill/db';
import { serverEnvSchema } from '@quill/config/env';
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

/** Status + body of a refusal, together, so two refusals can be compared whole. */
const outcomeOf = async (
  run: () => Promise<unknown>,
): Promise<{ status: number; body: unknown }> => {
  try {
    await run();
  } catch (e) {
    const err = e as { getStatus?: () => number; getResponse?: () => unknown };
    return { status: err.getStatus?.() ?? 0, body: err.getResponse?.() ?? null };
  }
  return { status: 200, body: null };
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
      expect((await getMemberProfileState(db, accountId, memberId))!.revision).toBe(0);
    });

    it('is closed when the flag is simply unset, not just when it is false', async () => {
      // The default must not leave a non-CAS writer alive for anyone who never
      // heard of the flag: it takes an explicit true to open it.
      const unset = new AdminCrudController(
        db,
        auth,
        {} as never,
        {} as never,
        {} as never,
        undefined,
        undefined,
        { PROFILE_V2_WRITES_ENABLED: true } as never,
      );

      expect(await statusOf(() => unset.saveMyProfile(req, { profile: page(true) }))).toBe(410);
      expect((await getMemberProfileState(db, accountId, memberId))!.revision).toBe(0);
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

  it('still fences, because recovery is not a new write', async () => {
    // A browser holding an expectation from a save that WAS admitted must be
    // able to settle it. Gating this would strand exactly the sessions that are
    // already in trouble, and closing the gate is the first step of a rollback.
    const won = await off().fence(req, { expectedRevision: 0 });

    expect(won).toMatchObject({ ok: true, revision: 1 });
    // And the losing direction works too, with no extra burn.
    expect(await statusOf(() => off().fence(req, { expectedRevision: 0 }))).toBe(409);
    expect((await getMemberProfileState(db, accountId, memberId))!.revision).toBe(1);
  });

  it('fences a conflict against a write that landed before the gate closed', async () => {
    await new ProfileV2Controller(db, auth, { PROFILE_V2_WRITES_ENABLED: true }).save(req, {
      profile: page(true),
      expectedRevision: 0,
    });

    const body = await bodyOf(() => off().fence(req, { expectedRevision: 0 }));

    expect(body).toMatchObject({ error: 'REVISION_CONFLICT', revision: 1 });
    expect((body.profile as { enabled: boolean }).enabled).toBe(true);
  });

  it('still answers reads: no new saves, but recovery is available', async () => {
    const read = (await off().read(req)) as {
      revision: number;
      writesEnabled: boolean;
      fenceSupported: boolean;
    };

    // Two separate answers. Fence support must never be inferred from write
    // admission — that is what made closing the gate strand a session.
    expect(read).toMatchObject({ revision: 0, writesEnabled: false, fenceSupported: true });
  });

  it('reports the capability as available once switched on, and then writes', async () => {
    const on = new ProfileV2Controller(db, auth, { PROFILE_V2_WRITES_ENABLED: true });

    expect(await on.read(req)).toMatchObject({ writesEnabled: true });
    expect(await on.save(req, { profile: page(true), expectedRevision: 0 })).toMatchObject({
      ok: true,
      revision: 1,
    });
  });

  it('reports fence support through the v1 read too', async () => {
    const shim = new AdminCrudController(
      db,
      auth,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
      { PROFILE_V1_WRITE_SHIM: false, PROFILE_V2_WRITES_ENABLED: false },
    );

    expect(await shim.myProfile(req)).toMatchObject({ writesEnabled: false, fenceSupported: true });
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

describe('configuration defaults', () => {
  /** Parse a minimal environment, as a fresh deployment would have. */
  const parsed = () =>
    serverEnvSchema.parse({ DATABASE_URL: 'file:./.data/dev.db', PUBLIC_APP_URL: 'http://localhost:3000' });

  it('admits no guarded writes until someone turns them on', () => {
    expect(parsed().PROFILE_V2_WRITES_ENABLED).toBe(false);
  });

  it('leaves the deprecated v1 writer OFF when nothing sets it', () => {
    // The unguarded writer must be something a deployment switches on for a
    // bounded window, never something left alive by omission.
    expect(parsed().PROFILE_V1_WRITE_SHIM).toBe(false);
  });

  it('takes an explicit true to open either one', () => {
    const env = serverEnvSchema.parse({
      DATABASE_URL: 'file:./.data/dev.db',
      PUBLIC_APP_URL: 'http://localhost:3000',
      PROFILE_V1_WRITE_SHIM: 'true',
      PROFILE_V2_WRITES_ENABLED: 'true',
    });

    expect(env.PROFILE_V1_WRITE_SHIM).toBe(true);
    expect(env.PROFILE_V2_WRITES_ENABLED).toBe(true);
  });

  it('treats anything that is not a truthy string as off', () => {
    for (const raw of ['false', '0', 'no', 'maybe', '']) {
      const env = serverEnvSchema.parse({
        DATABASE_URL: 'file:./.data/dev.db',
        PUBLIC_APP_URL: 'http://localhost:3000',
        PROFILE_V1_WRITE_SHIM: raw,
        PROFILE_V2_WRITES_ENABLED: raw,
      });
      expect(env.PROFILE_V1_WRITE_SHIM, raw).toBe(false);
      expect(env.PROFILE_V2_WRITES_ENABLED, raw).toBe(false);
    }
  });
});

/**
 * Write-gate posture is private.
 *
 * `PROFILE_V2_WRITES_ENABLED` and `PROFILE_V1_WRITE_SHIM` describe how far along
 * an operator's rollout is. Answering them before knowing who is asking hands
 * that to anyone who can reach the port: `V2_WRITES_DISABLED` says a
 * revision-aware API is deployed but not switched on, and `V1_WRITE_RETIRED`
 * says the compatibility window has closed. Both are useful to somebody timing
 * a rollout, and neither is any of an anonymous caller's business.
 *
 * So each gate now sits behind `resolveHost`, and an unauthenticated caller gets
 * the same refusal it would get from any other authenticated route — the same
 * status and the same body, byte for byte, whichever way the flags are set.
 *
 * The gates stay in front of everything else. An authenticated caller whose
 * write is not admitted learns only that, never whether its revision or its
 * profile would have been acceptable, and nothing is persisted.
 */
describe('write-gate posture is only visible after authentication', () => {
  let db: Db;
  let accountId: string;
  let memberId: string;
  let auth: AuthService;
  const req = {} as ReqLike;

  /** Refuses exactly as the auth provider does when there is no session. */
  const rejecting = {
    resolveHost: async () => {
      throw new UnauthorizedException({ error: 'UNAUTHENTICATED', message: 'No session.' });
    },
  } as unknown as AuthService;

  const v2With = (writes: boolean, service: AuthService = auth) =>
    new ProfileV2Controller(db, service, { PROFILE_V2_WRITES_ENABLED: writes });

  const v1With = (shim: boolean, service: AuthService = auth) =>
    new AdminCrudController(db, service, {} as never, {} as never, {} as never, undefined, undefined, {
      PROFILE_V1_WRITE_SHIM: shim,
      PROFILE_V2_WRITES_ENABLED: false,
    });

  const revision = async (): Promise<number> =>
    (await getMemberProfileState(db, accountId, memberId))!.revision;

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

  // Case 1
  it('answers an unauthenticated v2 write identically whether writes are on or off', async () => {
    // The baseline: what an unauthenticated caller gets from a route with no
    // gate at all.
    const baseline = await outcomeOf(() => v2With(true, rejecting).read(req));

    const gateOn = await outcomeOf(() =>
      v2With(true, rejecting).save(req, { profile: page(true), expectedRevision: 0 }),
    );
    const gateOff = await outcomeOf(() =>
      v2With(false, rejecting).save(req, { profile: page(true), expectedRevision: 0 }),
    );

    expect(gateOn.status).toBe(401);
    expect(gateOff.status).toBe(401);
    // Byte for byte: the two refusals are indistinguishable from each other and
    // from the ungated route's refusal.
    expect(JSON.stringify(gateOff.body)).toBe(JSON.stringify(gateOn.body));
    expect(JSON.stringify(gateOff.body)).toBe(JSON.stringify(baseline.body));
  });

  it('never leaks V2_WRITES_DISABLED to a caller it has not identified', async () => {
    for (const writes of [true, false]) {
      const out = await outcomeOf(() =>
        v2With(writes, rejecting).save(req, { profile: page(true), expectedRevision: 0 }),
      );
      expect(JSON.stringify(out), `writes=${writes}`).not.toContain('V2_WRITES_DISABLED');
    }
  });

  // Case 2
  it('answers an unauthenticated v1 write identically whether the shim is on or off', async () => {
    const baseline = await outcomeOf(() => v1With(true, rejecting).myProfile(req));

    const shimOn = await outcomeOf(() =>
      v1With(true, rejecting).saveMyProfile(req, { profile: page(true) }),
    );
    const shimOff = await outcomeOf(() =>
      v1With(false, rejecting).saveMyProfile(req, { profile: page(true) }),
    );

    expect(shimOn.status).toBe(401);
    expect(shimOff.status).toBe(401);
    expect(JSON.stringify(shimOff.body)).toBe(JSON.stringify(shimOn.body));
    expect(JSON.stringify(shimOff.body)).toBe(JSON.stringify(baseline.body));
  });

  it('never leaks V1_WRITE_RETIRED to a caller it has not identified', async () => {
    for (const shim of [true, false]) {
      const out = await outcomeOf(() =>
        v1With(shim, rejecting).saveMyProfile(req, { profile: page(true) }),
      );
      expect(JSON.stringify(out), `shim=${shim}`).not.toContain('V1_WRITE_RETIRED');
    }
  });

  // Case 3
  it('tells an authenticated caller only that writes are closed, whatever the body says', async () => {
    const before = await revision();

    // A missing revision, a malformed one, and a profile the schema would
    // reject: all of them stop at the gate, so none of them reveals whether the
    // payload would have been accepted.
    const bodies: unknown[] = [
      { profile: page(true) },
      { profile: page(true), expectedRevision: '0' },
      { profile: page(true), expectedRevision: -1 },
      { profile: { version: 1, enabled: 'yes' }, expectedRevision: 0 },
      { profile: { version: 2 }, expectedRevision: 0 },
      {},
    ];

    for (const body of bodies) {
      const out = await outcomeOf(() => v2With(false).save(req, body));
      expect(out.status, JSON.stringify(body)).toBe(501);
      expect(out.body).toMatchObject({ error: 'V2_WRITES_DISABLED' });
      expect(JSON.stringify(out.body)).not.toContain('REVISION_REQUIRED');
      expect(JSON.stringify(out.body)).not.toContain('BAD_REQUEST');
    }
    expect(await revision()).toBe(before);
  });

  // Case 4
  it('retires the v1 write after authentication, and persists nothing', async () => {
    const before = await revision();

    const out = await outcomeOf(() => v1With(false).saveMyProfile(req, { profile: page(true) }));

    expect(out.status).toBe(410);
    expect(out.body).toMatchObject({ error: 'V1_WRITE_RETIRED' });
    // Only the profile and its revision are asserted: resolving a principal may
    // legitimately touch the member row (activation, last seen).
    expect(await revision()).toBe(before);
    expect((await getMemberProfileState(db, accountId, memberId))!.profile).toBeNull();
  });

  // Case 5
  it('keeps the fence working with writes closed, for this principal only', async () => {
    const won = await v2With(false).fence(req, { expectedRevision: 0 });
    expect(won).toMatchObject({ ok: true, revision: 1 });

    // Same expectation again: a conflict, and no second burn.
    expect(await statusOf(() => v2With(false).fence(req, { expectedRevision: 0 }))).toBe(409);
    expect(await revision()).toBe(1);

    // Another account asking about this member gets nothing, gate or no gate.
    const stranger = {
      resolveHost: async () => ({ accountId: randomUUID(), memberId, role: 'owner' }),
    } as unknown as AuthService;
    expect(await statusOf(() => v2With(false, stranger).fence(req, { expectedRevision: 1 }))).toBe(
      404,
    );
    expect(await revision()).toBe(1);
  });

  // Case 6
  it('writes normally when the gate is open, and never answers disabled', async () => {
    const out = await outcomeOf(() =>
      v2With(true).save(req, { profile: page(true), expectedRevision: 0 }),
    );

    expect(out.status).toBe(200);
    expect(await revision()).toBe(1);
    expect((await getMemberProfileState(db, accountId, memberId))!.profile).toMatchObject({
      enabled: true,
    });

    // And a refusal after that still leaves the revision exactly where it is.
    const refused = await outcomeOf(() =>
      v2With(false).save(req, { profile: page(false), expectedRevision: 1 }),
    );
    expect(refused.status).toBe(501);
    expect(await revision()).toBe(1);
  });
});
