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
import { loadServerEnv, serverEnvSchema } from '@quill/config/env';
import { createDb, migrate, seed, sql, type Db } from '@quill/db';
import { AuthService } from './auth.service';
import { LocalAuthProvider, type ReqLike } from './auth.provider';
import { AdminCrudController } from './admin-crud.controller';
import { AdminService } from './admin.service';
import { ReferralService, referralOptions, type ReferralOptions } from './referral.service';
import { ReferralController } from './referral.controller';
import { AnalyticsEffects } from './analytics-effects';
import type { ServerEnv } from '@quill/config/env';

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
  opts: {
    externalId?: string;
    role?: 'owner' | 'admin' | 'member';
    createdAt?: number;
    accessGrant?: 'staff';
  } = {},
): Promise<string> {
  const id = randomUUID();
  await db.run(
    sql`INSERT INTO member (id, account_id, email, role, status, external_id, access_grant, created_at)
        VALUES (${id}, ${accountId}, ${email}, ${opts.role ?? 'member'}, ${'active'}, ${opts.externalId ?? null},
          ${opts.accessGrant ?? null}, ${opts.createdAt ?? Date.now()})`,
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
    expect(referral).toEqual({
      enabled: true,
      link: expect.any(String),
      count: 0,
      goal: 5,
      campaignActive: true,
      unlocked: false,
      bannerVisible: true,
    });
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
  it('is off when switched off', () => {
    expect(referralOptions({ REFERRAL_PROGRAM: false, PUBLIC_APP_URL: APP }).enabled).toBe(false);
  });

  it('unset, it is on exactly where the identity service runs (a Dapta deployment)', () => {
    const iam = { AUTH_PROVIDER: 'workos', IAM_BASE_URL: 'https://iam.example.test' } as const;
    expect(referralOptions({ PUBLIC_APP_URL: APP, ...iam }).enabled).toBe(true);
    // A fork, or local development, never shows the campaign unless asked to.
    expect(referralOptions({ PUBLIC_APP_URL: APP, AUTH_PROVIDER: 'local' }).enabled).toBe(false);
    expect(referralOptions({ PUBLIC_APP_URL: APP, AUTH_PROVIDER: 'workos' }).enabled).toBe(false);
    // Explicit wins both ways.
    expect(referralOptions({ PUBLIC_APP_URL: APP, ...iam, REFERRAL_PROGRAM: false }).enabled).toBe(false);
    expect(referralOptions({ PUBLIC_APP_URL: APP, AUTH_PROVIDER: 'local', REFERRAL_PROGRAM: true }).enabled).toBe(true);
  });

  it('reads blank as unset in the environment schema', () => {
    const base = { DATABASE_URL: 'file:./x.db', AUTH_PROVIDER: 'local' };
    expect(serverEnvSchema.parse({ ...base }).REFERRAL_PROGRAM).toBeUndefined();
    expect(serverEnvSchema.parse({ ...base, REFERRAL_PROGRAM: '' }).REFERRAL_PROGRAM).toBeUndefined();
    expect(serverEnvSchema.parse({ ...base, REFERRAL_PROGRAM: 'false' }).REFERRAL_PROGRAM).toBe(false);
    expect(serverEnvSchema.parse({ ...base, REFERRAL_PROGRAM: 'true' }).REFERRAL_PROGRAM).toBe(true);
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

/**
 * Signing up through a referral link: the sign-in callback hands the parked
 * `ref` to `POST /v1/me/referral/claim`, and a new person is credited to the
 * link's owner, whose count in `/v1/me.referral` goes up.
 */
describe('POST /v1/me/referral/claim', () => {
  const MIN = 60_000;

  /** Ana, an existing person with a referral link, and her code. */
  async function referrerAna(options: ReferralOptions = ON) {
    const member = await addMember(acme, 'ana@example.com', { externalId: 'user_ana', createdAt: Date.now() - 30 * 24 * 60 * MIN });
    const code = codeOf((await referralOf(crud(options), as(acme, member))).link)!;
    return { member, code, count: async () => (await referralOf(crud(options), as(acme, member))).count };
  }

  /** A person who signed up just now, in a workspace of their own. */
  async function newPerson(email: string, externalId: string, role: 'owner' | 'admin' | 'member' = 'owner') {
    const account = await addAccount(`ws-${randomUUID().slice(0, 8)}`);
    return { account, member: await addMember(account, email, { externalId, role }) };
  }

  const claimer = (options: ReferralOptions = ON) => new ReferralController(auth, new ReferralService(db, options));
  const claim = (who: { account: string; member: string }, body: unknown, options: ReferralOptions = ON) =>
    claimer(options).claim(as(who.account, who.member), body);

  it('credits a new person to the link owner, whose count goes to 1', async () => {
    const ana = await referrerAna();
    const ben = await newPerson('ben@example.com', 'user_ben');
    expect(await claim(ben, { code: ana.code })).toEqual({ credited: true });
    expect(await ana.count()).toBe(1);
  });

  it('ignores a code nobody holds', async () => {
    const ana = await referrerAna();
    const ben = await newPerson('ben@example.com', 'user_ben');
    expect(await claim(ben, { code: 'zzzzzzzz' })).toEqual({ credited: false });
    expect(await ana.count()).toBe(0);
  });

  it('ignores a person signing up through their own link, in a new workspace', async () => {
    const ana = await referrerAna();
    // Ana again, as the identity service knows her, in a workspace she just made:
    // her own subject, so the same person. (Her older row also makes her not new;
    // the self rule is pinned on its own below with a fresh referrer.)
    const again = await newPerson('ana@example.com', 'user_ana');
    expect(await claim(again, { code: ana.code })).toEqual({ credited: false });
    expect(await ana.count()).toBe(0);
  });

  it('ignores a self-referral by the same person, even while both rows are new', async () => {
    const fresh = await newPerson('cy@example.com', 'user_cy');
    const code = codeOf((await referralOf(crud(ON), as(fresh.account, fresh.member))).link)!;
    const second = await newPerson('cy@example.com', 'user_cy');
    expect(await claim(second, { code })).toEqual({ credited: false });
    expect((await referralOf(crud(ON), as(fresh.account, fresh.member))).count).toBe(0);
  });

  it('ignores a self-referral by email: another subject with the referrer address', async () => {
    const ana = await referrerAna();
    const twin = await newPerson('Ana@Example.com', 'user_ana_second_login');
    expect(await claim(twin, { code: ana.code })).toEqual({ credited: false });
    expect(await ana.count()).toBe(0);
  });

  it('ignores a person who already had dForms: a member row older than 10 minutes', async () => {
    const ana = await referrerAna();
    const old = await addAccount('old-ws');
    await addMember(old, 'dan@example.com', { externalId: 'user_dan', createdAt: Date.now() - 11 * MIN });
    const dan = await newPerson('dan@example.com', 'user_dan');
    expect(await claim(dan, { code: ana.code })).toEqual({ credited: false });
    expect(await ana.count()).toBe(0);
  });

  it('closes the window 10 minutes after the person first appeared', async () => {
    const ana = await referrerAna();
    const late = await newPerson('eve@example.com', 'user_eve');
    const later = { ...ON, now: () => Date.now() + 10 * MIN + 1000 };
    expect(await claim(late, { code: ana.code }, later)).toEqual({ credited: false });
    const early = { ...ON, now: () => Date.now() + 9 * MIN };
    expect(await claim(late, { code: ana.code }, early)).toEqual({ credited: true });
  });

  it('a staff access grant is not a prior account: staff signing up for real still counts', async () => {
    const ana = await referrerAna();
    const estate = await addAccount('customer');
    await addMember(estate, 'fay@staff.example.com', {
      externalId: 'user_fay',
      role: 'admin',
      accessGrant: 'staff',
      createdAt: Date.now() - 90 * 24 * 60 * MIN,
    });
    const fay = await newPerson('fay@staff.example.com', 'user_fay');
    expect(await claim(fay, { code: ana.code })).toEqual({ credited: true });
    expect(await ana.count()).toBe(1);
  });

  it('first credit wins: a second link does not move or double the referral', async () => {
    const ana = await referrerAna();
    const other = await addAccount('globex');
    const hal = await addMember(other, 'hal@example.com', { externalId: 'user_hal', createdAt: Date.now() - 60 * MIN });
    const halCode = codeOf((await referralOf(crud(ON), as(other, hal))).link)!;
    const ben = await newPerson('ben@example.com', 'user_ben');
    expect(await claim(ben, { code: ana.code })).toEqual({ credited: true });
    expect(await claim(ben, { code: halCode })).toEqual({ credited: false });
    expect(await claim(ben, { code: ana.code })).toEqual({ credited: false });
    expect(await ana.count()).toBe(1);
    expect((await referralOf(crud(ON), as(other, hal))).count).toBe(0);
  });

  it('the credit is the person, not the workspace: a second workspace of theirs adds nothing', async () => {
    const ana = await referrerAna();
    const ben = await newPerson('ben@example.com', 'user_ben');
    const benAgain = await newPerson('ben@example.com', 'user_ben');
    expect(await claim(ben, { code: ana.code })).toEqual({ credited: true });
    expect(await claim(benAgain, { code: ana.code })).toEqual({ credited: false });
    expect(await ana.count()).toBe(1);
  });

  it('any role may claim: a plain member counts like an owner', async () => {
    const ana = await referrerAna();
    const ivy = await newPerson('ivy@example.com', 'user_ivy', 'member');
    expect(await claim(ivy, { code: ana.code })).toEqual({ credited: true });
    expect(await ana.count()).toBe(1);
  });

  it('counts each referee once per referrer, across the referrer workspaces', async () => {
    const ana = await referrerAna();
    for (const n of ['jo', 'kim', 'lea']) {
      const p = await newPerson(`${n}@example.com`, `user_${n}`);
      await claim(p, { code: ana.code });
    }
    expect(await ana.count()).toBe(3);
    const elsewhere = await addAccount('ana-two');
    const inOther = await addMember(elsewhere, 'ana@example.com', { externalId: 'user_ana', role: 'owner' });
    expect((await referralOf(crud(ON), as(elsewhere, inOther))).count).toBe(3);
  });

  describe('never breaks the sign-in that calls it', () => {
    it.each([
      ['no body', undefined],
      ['an empty body', {}],
      ['a number for a code', { code: 42 }],
      ['an empty code', { code: '   ' }],
      ['a huge code', { code: 'a'.repeat(10_000) }],
      ['junk', 'not json at all'],
    ])('%s is refused quietly', async (_label, body) => {
      const ana = await referrerAna();
      const ben = await newPerson('ben@example.com', 'user_ben');
      expect(await claim(ben, body)).toEqual({ credited: false });
      expect(await ana.count()).toBe(0);
    });

    it('with the program off it records nothing', async () => {
      const ana = await referrerAna();
      const ben = await newPerson('ben@example.com', 'user_ben');
      expect(await claim(ben, { code: ana.code }, { enabled: false, baseUrl: null })).toEqual({ credited: false });
      expect(await ana.count()).toBe(0);
    });

    it('a code with stray spaces or capitals still finds its owner', async () => {
      const ana = await referrerAna();
      const ben = await newPerson('ben@example.com', 'user_ben');
      expect(await claim(ben, { code: `  ${ana.code.toUpperCase()} ` })).toEqual({ credited: true });
    });

    it('a failing database answers credited: false instead of an error', async () => {
      const ana = await referrerAna();
      const ben = await newPerson('ben@example.com', 'user_ben');
      await db.run(sql`DROP TABLE referral`);
      expect(await claim(ben, { code: ana.code })).toEqual({ credited: false });
    });
  });

  describe('the referral_signup event', () => {
    const analyticsOn = () => new AnalyticsEffects(db, { PRODUCT_ANALYTICS_KEY: 'phc_test' } as ServerEnv);
    const events = async () =>
      (await db.all<{ payload: string }>(sql`SELECT payload FROM outbox WHERE kind = 'analytics'`))
        .map((r) => JSON.parse(r.payload) as {
          event: string;
          distinctId: string;
          accountId: string | null;
          properties?: Record<string, unknown>;
          personProperties?: Record<string, unknown>;
        })
        .filter((e) => e.event === 'forms_referral_signup');

    it('is sent once for the invitee, tagged with the referrer code as referred_by', async () => {
      const ana = await referrerAna();
      const ben = await newPerson('ben@example.com', 'user_ben');
      const controller = new ReferralController(auth, new ReferralService(db, ON, analyticsOn()));
      await controller.claim(as(ben.account, ben.member), { code: ana.code });
      await controller.claim(as(ben.account, ben.member), { code: ana.code });
      const sent = await events();
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        distinctId: 'ben@example.com',
        accountId: ben.account,
        properties: { referral_code: ana.code, referral_source: 'link' },
        personProperties: { referred_by: ana.code },
      });
    });

    it('is not sent for a refused claim', async () => {
      const ana = await referrerAna();
      const self = await newPerson('ana@example.com', 'user_ana');
      const controller = new ReferralController(auth, new ReferralService(db, ON, analyticsOn()));
      await controller.claim(as(self.account, self.member), { code: ana.code });
      expect(await events()).toHaveLength(0);
    });
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
      expect(referral).toEqual({
        enabled: true,
        link: expect.any(String),
        count: 0,
        goal: 5,
        campaignActive: false,
        unlocked: false,
        bannerVisible: false,
      });
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
