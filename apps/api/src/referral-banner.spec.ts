/**
 * The referral program's top banner, end to end on in-memory SQLite:
 *
 *   1. `/v1/me.referral.bannerVisible` is true only while every rule holds:
 *      the program on, the campaign running, the person below the goal and
 *      not unlocked, the workspace not paying for Dapta AI (a fresh paid
 *      verdict) and the banner not dismissed.
 *   2. `POST /v1/me/referral/banner/dismiss` hides it for 7 days, for the
 *      PERSON (ADR 0005): in every workspace they belong to, and for nobody
 *      else. After the 7 days it shows again.
 *   3. Switched off, the dismissal writes nothing and answers with no date.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, migrate, seed, sql, type Db } from '@quill/db';
import { AuthService } from './auth.service';
import { LocalAuthProvider, type ReqLike } from './auth.provider';
import { AdminCrudController } from './admin-crud.controller';
import { AdminService } from './admin.service';
import { ReferralBannerController } from './referral-banner.controller';
import { ReferralService, type ReferralOptions } from './referral.service';

let db: Db;
let acme: string;
let auth: AuthService;

const LANDING = 'https://landing.example.test';
const DAY = 86_400_000;
const T0 = Date.parse('2026-11-23T12:00:00Z');

/** A clock the test moves. */
let clock = T0;
const ON: ReferralOptions = { enabled: true, baseUrl: LANDING, now: () => clock };

const as = (accountId: string, memberId: string): ReqLike => ({
  headers: { 'x-quill-account': accountId, 'x-quill-member': memberId },
});

async function addAccount(code: string): Promise<string> {
  const id = randomUUID();
  await db.run(sql`INSERT INTO account (id, code, name, created_at) VALUES (${id}, ${code}, ${code}, ${T0})`);
  return id;
}

async function addMember(accountId: string, email: string, externalId: string): Promise<string> {
  const id = randomUUID();
  await db.run(
    sql`INSERT INTO member (id, account_id, email, role, status, external_id, created_at)
        VALUES (${id}, ${accountId}, ${email}, ${'owner'}, ${'active'}, ${externalId}, ${T0})`,
  );
  return id;
}

function wire(options: ReferralOptions) {
  const referrals = new ReferralService(db, options);
  const crud = new AdminCrudController(
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
    referrals,
  );
  return { crud, banner: new ReferralBannerController(auth, referrals) };
}

async function bannerVisible(crud: AdminCrudController, req: ReqLike): Promise<boolean | undefined> {
  const me = (await crud.me(req)) as { referral: { bannerVisible?: boolean } };
  return me.referral.bannerVisible;
}

beforeEach(async () => {
  clock = T0;
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db);
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

describe('/v1/me.referral.bannerVisible', () => {
  it('is true for a person below the goal, in a free workspace, during the campaign', async () => {
    const ana = await addMember(acme, 'ana@example.com', 'user_ana');
    expect(await bannerVisible(wire(ON).crud, as(acme, ana))).toBe(true);
  });

  it('is false once the campaign is over', async () => {
    const ana = await addMember(acme, 'ana@example.com', 'user_ana');
    const { crud } = wire({ ...ON, campaignEndsAt: T0 + DAY });
    expect(await bannerVisible(crud, as(acme, ana))).toBe(true);
    clock = T0 + DAY;
    expect(await bannerVisible(crud, as(acme, ana))).toBe(false);
  });

  it('is false for a person who holds the referral unlock', async () => {
    const ana = await addMember(acme, 'ana@example.com', 'user_ana');
    const { crud } = wire(ON);
    expect(await bannerVisible(crud, as(acme, ana))).toBe(true);
    await db.run(sql`UPDATE referrer SET unlocked_at = ${T0} WHERE person_id = 'user_ana'`);
    expect(await bannerVisible(crud, as(acme, ana))).toBe(false);
  });

  it('is false in a workspace that pays for Dapta AI, and back once the verdict is stale', async () => {
    const ana = await addMember(acme, 'ana@example.com', 'user_ana');
    const { crud } = wire(ON);
    await db.run(sql`UPDATE account SET dapta_paid = 1, dapta_paid_checked_at = ${T0} WHERE id = ${acme}`);
    expect(await bannerVisible(crud, as(acme, ana))).toBe(false);
    // The paid verdict counts for 30 days (ATTRIBUTION_VERDICT_MAX_AGE).
    clock = T0 + 31 * DAY;
    expect(await bannerVisible(crud, as(acme, ana))).toBe(true);
  });

  it('a workspace whose verdict is "not paid" still shows it', async () => {
    const ana = await addMember(acme, 'ana@example.com', 'user_ana');
    await db.run(sql`UPDATE account SET dapta_paid = 0, dapta_paid_checked_at = ${T0} WHERE id = ${acme}`);
    expect(await bannerVisible(wire(ON).crud, as(acme, ana))).toBe(true);
  });

  it('is read per workspace for the paid rule: the same person sees it in their free one', async () => {
    const globex = await addAccount('globex');
    const inAcme = await addMember(acme, 'ana@example.com', 'user_ana');
    const inGlobex = await addMember(globex, 'ana@example.com', 'user_ana');
    await db.run(sql`UPDATE account SET dapta_paid = 1, dapta_paid_checked_at = ${T0} WHERE id = ${acme}`);
    const { crud } = wire(ON);
    expect(await bannerVisible(crud, as(acme, inAcme))).toBe(false);
    expect(await bannerVisible(crud, as(globex, inGlobex))).toBe(true);
  });

  it('is absent with the program off', async () => {
    const ana = await addMember(acme, 'ana@example.com', 'user_ana');
    const me = (await wire({ ...ON, enabled: false }).crud.me(as(acme, ana))) as { referral: unknown };
    expect(me.referral).toEqual({ enabled: false });
  });
});

describe('POST /v1/me/referral/banner/dismiss', () => {
  it('hides the banner for 7 days, then it shows again', async () => {
    const ana = await addMember(acme, 'ana@example.com', 'user_ana');
    const { crud, banner } = wire(ON);
    expect(await banner.dismiss(as(acme, ana))).toEqual({ dismissedUntil: T0 + 7 * DAY });
    expect(await bannerVisible(crud, as(acme, ana))).toBe(false);
    clock = T0 + 7 * DAY - 1;
    expect(await bannerVisible(crud, as(acme, ana))).toBe(false);
    clock = T0 + 7 * DAY;
    expect(await bannerVisible(crud, as(acme, ana))).toBe(true);
  });

  it('works before the person ever read their link (no referrer row yet)', async () => {
    const ana = await addMember(acme, 'ana@example.com', 'user_ana');
    const { crud, banner } = wire(ON);
    await banner.dismiss(as(acme, ana));
    expect(await bannerVisible(crud, as(acme, ana))).toBe(false);
  });

  it('is per person: hidden in each of their workspaces, still shown to anybody else', async () => {
    const globex = await addAccount('globex');
    const inAcme = await addMember(acme, 'ana@example.com', 'user_ana');
    const inGlobex = await addMember(globex, 'ana@example.com', 'user_ana');
    const ben = await addMember(acme, 'ben@example.com', 'user_ben');
    const { crud, banner } = wire(ON);
    await banner.dismiss(as(acme, inAcme));
    expect(await bannerVisible(crud, as(globex, inGlobex))).toBe(false);
    expect(await bannerVisible(crud, as(acme, ben))).toBe(true);
  });

  it('a second dismissal starts a fresh 7 days', async () => {
    const ana = await addMember(acme, 'ana@example.com', 'user_ana');
    const { banner } = wire(ON);
    await banner.dismiss(as(acme, ana));
    clock = T0 + 3 * DAY;
    expect(await banner.dismiss(as(acme, ana))).toEqual({ dismissedUntil: T0 + 10 * DAY });
  });

  it('with the program off, writes nothing and answers with no date', async () => {
    const ana = await addMember(acme, 'ana@example.com', 'user_ana');
    const { banner } = wire({ ...ON, enabled: false });
    expect(await banner.dismiss(as(acme, ana))).toEqual({ dismissedUntil: null });
    expect((await db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM referrer`))!.n).toBe(0);
  });
});
