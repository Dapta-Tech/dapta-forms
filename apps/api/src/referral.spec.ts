/**
 * The personal referral link in `/v1/me`, end to end on in-memory SQLite:
 *
 *   1. With the program switched on, `/v1/me.referral` carries the person's
 *      link, the count (0 for now) and the goal (5). The link is the landing
 *      when the deployment has one, else the app, with `?ref=<code>`.
 *   2. The code belongs to the PERSON (ADR 0005): the same one in every
 *      workspace they are a member of, the same one on every request, and a
 *      different one for anybody else, even when a generated code collides.
 *   3. Switched off (the default), the block is `{ enabled: false }` and no
 *      referrer row is ever written.
 *   4. `campaignActive` is true while now is before `REFERRAL_CAMPAIGN_ENDS_AT`,
 *      or when none is set; after it the link, count and goal stay. A value
 *      that is not an ISO date-time with a zone fails to resolve and to boot.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadServerEnv } from '@quill/config/env';
import { createDb, migrate, seed, sql, type Db } from '@quill/db';
import { AuthService } from './auth.service';
import { LocalAuthProvider, type ReqLike } from './auth.provider';
import { AdminCrudController } from './admin-crud.controller';
import { AdminService } from './admin.service';
import { ReferralService, referralOptions, type ReferralOptions } from './referral.service';

let db: Db;
let acme: string;
let auth: AuthService;

const LANDING = 'https://landing.example.test';
const APP = 'https://app.example.test';

/** A request as one member of one workspace (the local stub's impersonation headers). */
const as = (accountId: string, memberId: string): ReqLike => ({
  headers: { 'x-quill-account': accountId, 'x-quill-member': memberId },
});

async function addAccount(code: string): Promise<string> {
  const id = randomUUID();
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at) VALUES (${id}, ${code}, ${code}, ${Date.now()})`,
  );
  return id;
}

async function addMember(
  accountId: string,
  email: string,
  opts: { externalId?: string; role?: 'owner' | 'admin' | 'member' } = {},
): Promise<string> {
  const id = randomUUID();
  await db.run(
    sql`INSERT INTO member (id, account_id, email, role, status, external_id, created_at)
        VALUES (${id}, ${accountId}, ${email}, ${opts.role ?? 'member'}, ${'active'}, ${opts.externalId ?? null}, ${Date.now()})`,
  );
  return id;
}

function crud(options: ReferralOptions): AdminCrudController {
  return new AdminCrudController(
    db,
    auth,
    new AdminService(db),
    {} as never,
    {} as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    new ReferralService(db, options),
  );
}

const ON: ReferralOptions = { enabled: true, baseUrl: LANDING };

async function referralOf(controller: AdminCrudController, req: ReqLike) {
  const me = (await controller.me(req)) as { referral: unknown };
  return me.referral as { enabled: boolean; link?: string; count?: number; goal?: number };
}

const codeOf = (link: string | undefined) => new URL(link!).searchParams.get('ref');
const referrerRows = async () => (await db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM referrer`))!.n;

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db); // account "acme" + owner alex@example.com
  acme = (await db.get<{ id: string }>(sql`SELECT id FROM account WHERE code = 'acme' LIMIT 1`))!.id;
  const provider = new LocalAuthProvider(db, {
    NODE_ENV: 'test',
    DEV_LOGIN_EMAIL: undefined,
    AUTH_LOCAL_STRICT: undefined,
    SEED_DEMO_FORM: false,
    ONBOARDING_WIZARD: false,
  });
  auth = new AuthService(db, provider);
});

afterEach(async () => {
  await db.close();
});

describe('/v1/me.referral, program on', () => {
  it('carries the link, a count of 0 and the goal of 5', async () => {
    const member = await addMember(acme, 'ana@example.com', { externalId: 'user_ana' });
    const referral = await referralOf(crud(ON), as(acme, member));
    expect(referral).toEqual({ enabled: true, link: expect.any(String), count: 0, goal: 5, campaignActive: true });
    expect(referral.link).toMatch(/^https:\/\/landing\.example\.test\/\?ref=[a-z0-9]{8}$/);
  });

  it('the link is the same person in every workspace and on every request', async () => {
    const other = await addAccount('globex');
    const inAcme = await addMember(acme, 'ana@example.com', { externalId: 'user_ana' });
    const inGlobex = await addMember(other, 'ana@work.example.com', { externalId: 'user_ana', role: 'owner' });
    const controller = crud(ON);
    const first = await referralOf(controller, as(acme, inAcme));
    expect((await referralOf(controller, as(other, inGlobex))).link).toBe(first.link);
    expect((await referralOf(controller, as(acme, inAcme))).link).toBe(first.link);
    expect(await referrerRows()).toBe(1);
  });

  it('without an identity service subject, the person is their email (local development)', async () => {
    const other = await addAccount('globex');
    const inAcme = await addMember(acme, 'dev@example.com');
    const inGlobex = await addMember(other, 'Dev@Example.com');
    const controller = crud(ON);
    const a = await referralOf(controller, as(acme, inAcme));
    expect((await referralOf(controller, as(other, inGlobex))).link).toBe(a.link);
  });

  it('gives each person their own code, even when a generated code collides', async () => {
    const ana = await addMember(acme, 'ana@example.com', { externalId: 'user_ana' });
    const ben = await addMember(acme, 'ben@example.com', { externalId: 'user_ben' });
    const codes = ['aaaaaaaa', 'aaaaaaaa', 'bbbbbbbb'];
    const controller = crud({ ...ON, code: () => codes.shift()! });
    const forAna = codeOf((await referralOf(controller, as(acme, ana))).link);
    const forBen = codeOf((await referralOf(controller, as(acme, ben))).link);
    expect(forAna).toBe('aaaaaaaa');
    expect(forBen).toBe('bbbbbbbb');
  });

  it('generated codes are short, readable and distinct', async () => {
    const controller = crud(ON);
    const seen = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const m = await addMember(acme, `p${i}@example.com`, { externalId: `user_${i}` });
      seen.add(codeOf((await referralOf(controller, as(acme, m))).link)!);
    }
    expect(seen.size).toBe(25);
    for (const c of seen) expect(c).toMatch(/^[a-z0-9]{8}$/);
  });
});

describe('/v1/me.referral, program off', () => {
  it('is { enabled: false } and writes nothing', async () => {
    const member = await addMember(acme, 'ana@example.com', { externalId: 'user_ana' });
    expect(await referralOf(crud({ enabled: false, baseUrl: LANDING }), as(acme, member))).toEqual({ enabled: false });
    expect(await referrerRows()).toBe(0);
  });

  it('an API without the service wired reports it off', async () => {
    const plain = new AdminCrudController(db, auth, new AdminService(db), {} as never, {} as never);
    expect(((await plain.me({ headers: {} })) as { referral: unknown }).referral).toEqual({ enabled: false });
    expect(await referrerRows()).toBe(0);
  });
});

describe('referralOptions: the switch, resolved once from the environment', () => {
  it('is off by default', () => {
    expect(referralOptions({ REFERRAL_PROGRAM: false, PUBLIC_APP_URL: APP }).enabled).toBe(false);
  });

  it('links to the landing when the deployment has one, else to the app', () => {
    expect(
      referralOptions({ REFERRAL_PROGRAM: true, PUBLIC_APP_URL: APP, NEXT_PUBLIC_LANDING_URL: LANDING }),
    ).toEqual({ enabled: true, baseUrl: LANDING });
    expect(referralOptions({ REFERRAL_PROGRAM: true, PUBLIC_APP_URL: APP, NEXT_PUBLIC_LANDING_URL: '' })).toEqual({
      enabled: true,
      baseUrl: APP,
    });
  });

  it('stays off when there is nowhere to link to', () => {
    expect(referralOptions({ REFERRAL_PROGRAM: true, PUBLIC_APP_URL: '' }).enabled).toBe(false);
  });

  it('a link on the app base points at its root', async () => {
    const member = await addMember(acme, 'ana@example.com', { externalId: 'user_ana' });
    const referral = await referralOf(crud({ enabled: true, baseUrl: `${APP}/` }), as(acme, member));
    expect(referral.link).toMatch(/^https:\/\/app\.example\.test\/\?ref=[a-z0-9]{8}$/);
  });
});

describe('/v1/me.referral, the campaign window', () => {
  const ENDS = Date.parse('2026-12-31T23:59:59Z');
  const campaignOf = async (options: ReferralOptions) => {
    const member = await addMember(acme, 'ana@example.com', { externalId: 'user_ana' });
    return (await referralOf(crud(options), as(acme, member))) as { campaignActive?: boolean };
  };

  it('is active when no end is set', async () => {
    expect((await campaignOf(ON)).campaignActive).toBe(true);
  });

  it('is active before the end', async () => {
    expect((await campaignOf({ ...ON, campaignEndsAt: ENDS, now: () => ENDS - 1 })).campaignActive).toBe(true);
  });

  it('is over from the end on, while the link, count and goal stay', async () => {
    for (const now of [ENDS, ENDS + 86_400_000]) {
      await db.run(sql`DELETE FROM member WHERE email = 'ana@example.com'`);
      const referral = await campaignOf({ ...ON, campaignEndsAt: ENDS, now: () => now });
      expect(referral).toEqual({ enabled: true, link: expect.any(String), count: 0, goal: 5, campaignActive: false });
    }
  });

  it('switched off is still { enabled: false }, whatever the campaign', async () => {
    const off = { enabled: false, baseUrl: LANDING, campaignEndsAt: ENDS };
    expect(await campaignOf({ ...off, now: () => ENDS - 1 })).toEqual({ enabled: false });
    await db.run(sql`DELETE FROM member WHERE email = 'ana@example.com'`);
    expect(await campaignOf({ ...off, now: () => ENDS + 1 })).toEqual({ enabled: false });
    expect(await referrerRows()).toBe(0);
  });
});

describe('referralOptions: the campaign end, resolved once from the environment', () => {
  const env = { REFERRAL_PROGRAM: true, PUBLIC_APP_URL: APP };

  it('reads REFERRAL_CAMPAIGN_ENDS_AT as an ISO date-time', () => {
    expect(referralOptions({ ...env, REFERRAL_CAMPAIGN_ENDS_AT: '2026-12-31T23:59:59Z' }).campaignEndsAt).toBe(
      Date.parse('2026-12-31T23:59:59Z'),
    );
    expect(referralOptions({ ...env, REFERRAL_CAMPAIGN_ENDS_AT: '2027-01-01T00:00:00-05:00' }).campaignEndsAt).toBe(
      Date.parse('2027-01-01T05:00:00Z'),
    );
  });

  it('unset means no end', () => {
    expect(referralOptions(env).campaignEndsAt ?? null).toBeNull();
    expect(referralOptions({ ...env, REFERRAL_CAMPAIGN_ENDS_AT: undefined }).campaignEndsAt ?? null).toBeNull();
  });

  it('an invalid value fails to resolve, even with the program off', () => {
    for (const bad of ['tomorrow', '2026-13-01T00:00:00Z', '2026-12-31', '2026-12-31T23:59:59']) {
      expect(() => referralOptions({ ...env, REFERRAL_CAMPAIGN_ENDS_AT: bad })).toThrow(/REFERRAL_CAMPAIGN_ENDS_AT/);
      expect(() =>
        referralOptions({ ...env, REFERRAL_PROGRAM: false, REFERRAL_CAMPAIGN_ENDS_AT: bad }),
      ).toThrow(/REFERRAL_CAMPAIGN_ENDS_AT/);
    }
  });

  it('an invalid value fails the boot', () => {
    expect(() =>
      loadServerEnv({ NODE_ENV: 'test', REFERRAL_CAMPAIGN_ENDS_AT: 'next friday' } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/REFERRAL_CAMPAIGN_ENDS_AT/);
    expect(
      loadServerEnv({ NODE_ENV: 'test', REFERRAL_CAMPAIGN_ENDS_AT: '' } as unknown as NodeJS.ProcessEnv)
        .REFERRAL_CAMPAIGN_ENDS_AT,
    ).toBeUndefined();
  });
});
