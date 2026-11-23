/**
 * The referral unlock, end to end on in-memory SQLite, in locked mode (the
 * badge needs an unlock source to go):
 *
 *   1. The referral that brings a person to the goal (5) unlocks them, once:
 *      `/v1/me.referral.unlocked` turns true, `referral_unlocked` is sent, and
 *      a 6th referral changes nothing more.
 *   2. Every workspace the person OWNS hides the badge, unless it already made
 *      an explicit choice; a workspace where they are only an admin or a
 *      member does not, and a member's own workspaces stay locked.
 *   3. A workspace the unlocked person creates later starts hidden.
 *   4. The rule's referral source is real: a workspace is unlocked when any of
 *      its owners holds an unlock, with no expiry, next to the paid one.
 *   5. Every surface obeys, and the switch API accepts "hide".
 */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { cacheDaptaPaid, createDb, migrate, seed, sql, type Db } from '@quill/db';
import type { ServerEnv } from '@quill/config/env';
import { ATTRIBUTION_VERDICT_MAX_AGE_MS } from '@quill/shared';
import {
  LogOnlyEmailProvider,
  SubmissionNotifier,
  type EmailMessage,
  type EmailProvider,
  type EmailResult,
} from '@quill/notifications';
import { AuthService } from './auth.service';
import { LocalAuthProvider, type ReqLike } from './auth.provider';
import { AdminCrudController } from './admin-crud.controller';
import { AdminService } from './admin.service';
import { AnalyticsEffects } from './analytics-effects';
import { AttributionController } from './attribution.controller';
import { AttributionService, DAPTA_SUBSCRIPTION_REQUIRED } from './attribution.service';
import { EmailEffects } from './email-effects';
import { LinkPageService } from './link-page.service';
import { ReferralController } from './referral.controller';
import { ReferralService, type ReferralOptions } from './referral.service';
import { PersonReferralUnlocks } from './referral-unlocks';
import { SubmissionService } from './submission.service';
import { WorkspaceService } from './workspace.service';

let db: Db;
let acme: string;
let auth: AuthService;
let provider: LocalAuthProvider;

const ON: ReferralOptions = { enabled: true, baseUrl: 'https://landing.example.test' };
const MONTH = 30 * 24 * 3_600_000;

const as = (accountId: string, memberId: string): ReqLike => ({
  headers: { 'x-quill-account': accountId, 'x-quill-member': memberId },
});

async function addAccount(name: string): Promise<string> {
  const id = randomUUID();
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at) VALUES (${id}, ${`${name}-${id.slice(0, 6)}`}, ${name}, ${Date.now()})`,
  );
  return id;
}

async function addMember(
  accountId: string,
  email: string,
  opts: { externalId?: string; role?: 'owner' | 'admin' | 'member'; createdAt?: number; status?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await db.run(
    sql`INSERT INTO member (id, account_id, email, role, status, external_id, created_at)
        VALUES (${id}, ${accountId}, ${email}, ${opts.role ?? 'member'}, ${opts.status ?? 'active'},
          ${opts.externalId ?? null}, ${opts.createdAt ?? Date.now()})`,
  );
  return id;
}

function analyticsOn(): AnalyticsEffects {
  return new AnalyticsEffects(db, { PRODUCT_ANALYTICS_KEY: 'phc_test' } as ServerEnv);
}

/** The app as the module wires it: locked mode, the real referral unlock source. */
function wire(options: ReferralOptions = ON) {
  const analytics = analyticsOn();
  const referrals = new ReferralService(db, options, analytics);
  const attribution = new AttributionService(db, 'locked', analytics, new PersonReferralUnlocks(db));
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
    attribution,
    referrals,
  );
  return {
    referrals,
    attribution,
    crud,
    badge: new AttributionController(auth, attribution),
    claim: new ReferralController(auth, referrals),
  };
}

type App = ReturnType<typeof wire>;

const OLD = () => Date.now() - 90 * 24 * 3_600_000;

/** Ana: an existing person who owns acme (the seed's workspace) and has a link. */
async function ana(app: App) {
  const member = await addMember(acme, 'ana@example.com', { externalId: 'user_ana', role: 'owner', createdAt: OLD() });
  const me = (await app.crud.me(as(acme, member))) as { referral: { link: string } };
  const code = new URL(me.referral.link).searchParams.get('ref')!;
  return { member, code };
}

/** One new person signing up through a code, in a workspace of their own. */
async function signUp(app: App, code: string, name: string): Promise<boolean> {
  const account = await addAccount(`ws-${name}`);
  const member = await addMember(account, `${name}@example.com`, { externalId: `user_${name}`, role: 'owner' });
  return (await app.claim.claim(as(account, member), { code })).credited;
}

async function referTimes(app: App, code: string, n: number, prefix = 'p'): Promise<void> {
  for (let i = 0; i < n; i++) expect(await signUp(app, code, `${prefix}${i}`)).toBe(true);
}

async function referralOf(app: App, accountId: string, memberId: string) {
  const me = (await app.crud.me(as(accountId, memberId))) as { referral: Record<string, unknown> };
  return me.referral;
}

const unlockEvents = async () =>
  (await db.all<{ payload: string }>(sql`SELECT payload FROM outbox WHERE kind = 'analytics'`))
    .map((r) => JSON.parse(r.payload) as { event: string; distinctId: string; properties?: Record<string, unknown>; personProperties?: Record<string, unknown> })
    .filter((e) => e.event === 'forms_referral_unlocked');

async function failure(p: Promise<unknown>): Promise<{ status: number; body: unknown }> {
  try {
    await p;
  } catch (err) {
    if (err instanceof HttpException) return { status: err.getStatus(), body: err.getResponse() };
    throw err;
  }
  throw new Error('expected the call to fail');
}

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db); // account "acme" + owner alex@example.com + form "lead-qualifier"
  acme = (await db.get<{ id: string }>(sql`SELECT id FROM account WHERE code = 'acme' LIMIT 1`))!.id;
  provider = new LocalAuthProvider(db, {
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

describe('the referral that reaches the goal unlocks the person', () => {
  it('4 referrals leave the person locked; the 5th unlocks them', async () => {
    const app = wire();
    const a = await ana(app);
    await referTimes(app, a.code, 4);
    expect(await referralOf(app, acme, a.member)).toMatchObject({ count: 4, goal: 5, unlocked: false });
    expect((await app.attribution.status(acme)).canHide).toBe(false);
    expect(await signUp(app, a.code, 'fifth')).toBe(true);
    expect(await referralOf(app, acme, a.member)).toMatchObject({ count: 5, unlocked: true });
    expect(await app.attribution.status(acme)).toMatchObject({ canHide: true, showing: false, referralUnlocked: true });
  });

  it('sends referral_unlocked once, for the referrer; a 6th referral does nothing more', async () => {
    const app = wire();
    const a = await ana(app);
    await referTimes(app, a.code, 6);
    const sent = await unlockEvents();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      distinctId: 'ana@example.com',
      properties: { referral_code: a.code, referral_count: 5 },
      personProperties: { referral_unlocked: true },
    });
    expect(await referralOf(app, acme, a.member)).toMatchObject({ count: 6, unlocked: true });
  });

  it('/v1/me.referral says unlocked: false with no referrals, and nothing else is added', async () => {
    const app = wire();
    const a = await ana(app);
    expect(Object.keys(await referralOf(app, acme, a.member)).sort()).toEqual(
      ['campaignActive', 'count', 'enabled', 'goal', 'link', 'unlocked'].sort(),
    );
  });

  it('afterCredit is safe to call before the goal, twice at it, and never throws', async () => {
    const app = wire();
    const a = await ana(app);
    expect(await app.referrals.afterCredit('user_ana', Date.now())).toBe(false);
    await referTimes(app, a.code, 5);
    expect(await app.referrals.afterCredit('user_ana', Date.now())).toBe(false);
    expect(await unlockEvents()).toHaveLength(1);
    await db.run(sql`DROP TABLE referral`);
    expect(await app.referrals.afterCredit('user_ana', Date.now())).toBe(false);
  });
});

describe('hiding the badge on the workspaces the person owns', () => {
  it('hides every owned workspace and none where they are an admin or a member', async () => {
    const app = wire();
    const a = await ana(app);
    const second = await addAccount('ana-two');
    await addMember(second, 'ana@example.com', { externalId: 'user_ana', role: 'owner', createdAt: OLD() });
    const asAdmin = await addAccount('client');
    await addMember(asAdmin, 'ana@example.com', { externalId: 'user_ana', role: 'admin', createdAt: OLD() });
    const asMember = await addAccount('team');
    await addMember(asMember, 'ana@example.com', { externalId: 'user_ana', role: 'member', createdAt: OLD() });
    const invited = await addAccount('pending');
    await addMember(invited, 'ana@example.com', { role: 'owner', status: 'invited' });
    await referTimes(app, a.code, 5);
    expect(await app.attribution.status(acme)).toMatchObject({ hideAttribution: true, showing: false });
    expect(await app.attribution.status(second)).toMatchObject({ hideAttribution: true, showing: false });
    for (const other of [asAdmin, asMember, invited]) {
      expect(await app.attribution.status(other)).toMatchObject({ hideAttribution: false, canHide: false, showing: true });
    }
  });

  it('respects a workspace that already chose to show the badge', async () => {
    const app = wire();
    const a = await ana(app);
    // Turning it ON never needs an unlock: an explicit choice, stored.
    await app.badge.set(as(acme, a.member), { hideAttribution: false });
    await referTimes(app, a.code, 5);
    expect(await app.attribution.status(acme)).toMatchObject({ hideAttribution: false, canHide: true, showing: true });
  });

  it('a workspace created after the unlock starts hidden', async () => {
    const app = wire();
    const a = await ana(app);
    await referTimes(app, a.code, 5);
    const workspaces = new WorkspaceService(db, provider, auth);
    const { accountId } = await workspaces.create(as(acme, a.member), { name: 'Later' });
    expect(await app.attribution.status(accountId)).toMatchObject({ hideAttribution: true, canHide: true, showing: false });
  });

  it('a workspace created by a person who is not unlocked starts as before', async () => {
    const app = wire();
    const a = await ana(app);
    await referTimes(app, a.code, 4);
    const { accountId } = await new WorkspaceService(db, provider, auth).create(as(acme, a.member), { name: 'Later' });
    expect(await app.attribution.status(accountId)).toMatchObject({ hideAttribution: false, canHide: false, showing: true });
  });

  it("a member of an unlocked workspace keeps their own workspaces locked", async () => {
    const app = wire();
    const a = await ana(app);
    const ben = await addMember(acme, 'ben@example.com', { externalId: 'user_ben', role: 'member', createdAt: OLD() });
    const bens = await addAccount('bens');
    const benOwner = await addMember(bens, 'ben@example.com', { externalId: 'user_ben', role: 'owner', createdAt: OLD() });
    await referTimes(app, a.code, 5);
    expect((await app.attribution.status(acme)).showing).toBe(false);
    expect(await referralOf(app, acme, ben)).toMatchObject({ unlocked: false });
    expect(await app.attribution.status(bens)).toMatchObject({ canHide: false, showing: true, referralUnlocked: false });
    const out = await failure(app.badge.set(as(bens, benOwner), { hideAttribution: true }));
    expect(out).toMatchObject({ status: 403, body: { error: DAPTA_SUBSCRIPTION_REQUIRED } });
  });

  it('any owner unlocked is enough: a co-owner who is not unlocked still sees it unlocked', async () => {
    const app = wire();
    const a = await ana(app);
    const coOwner = await addMember(acme, 'cy@example.com', { externalId: 'user_cy', role: 'owner', createdAt: OLD() });
    await referTimes(app, a.code, 5);
    expect(await app.badge.status(as(acme, coOwner))).toMatchObject({ canHide: true, referralUnlocked: true });
  });
});

describe('the referral source of the rule', () => {
  it('paid and referral together: still unlocked when the paid verdict lapses', async () => {
    const app = wire();
    const a = await ana(app);
    await cacheDaptaPaid(db, acme, true);
    expect(await app.attribution.status(acme)).toMatchObject({ canHide: true, referralUnlocked: false });
    await referTimes(app, a.code, 5);
    expect(await app.attribution.status(acme)).toMatchObject({ canHide: true, showing: false, referralUnlocked: true });
    await cacheDaptaPaid(db, acme, false);
    expect(await app.attribution.status(acme)).toMatchObject({ canHide: true, showing: false, referralUnlocked: true });
  });

  it('never expires: long past the 30-day paid window it still hides the badge', async () => {
    const app = wire();
    const a = await ana(app);
    await referTimes(app, a.code, 5);
    app.attribution.now = () => Date.now() + 12 * MONTH + ATTRIBUTION_VERDICT_MAX_AGE_MS;
    expect(await app.attribution.showFor(acme)).toBe(false);
    expect(await app.attribution.status(acme)).toMatchObject({ canHide: true, showing: false });
  });

  it('the switch API accepts "hide" from an unlocked workspace that had chosen to show it', async () => {
    const app = wire();
    const a = await ana(app);
    await app.badge.set(as(acme, a.member), { hideAttribution: false });
    await referTimes(app, a.code, 5);
    expect(await app.badge.set(as(acme, a.member), { hideAttribution: true })).toMatchObject({
      hideAttribution: true,
      canHide: true,
      showing: false,
      referralUnlocked: true,
    });
    // And back on, and off again: the owner keeps control.
    expect(await app.badge.set(as(acme, a.member), { hideAttribution: false })).toMatchObject({ showing: true });
    expect(await app.badge.set(as(acme, a.member), { hideAttribution: true })).toMatchObject({ showing: false });
  });

  it('the refusal keeps its stable code for a locked workspace', async () => {
    const app = wire();
    const a = await ana(app);
    const out = await failure(app.badge.set(as(acme, a.member), { hideAttribution: true }));
    expect(out).toMatchObject({ status: 403, body: { error: DAPTA_SUBSCRIPTION_REQUIRED } });
  });
});

describe('every surface hides the badge of an unlocked workspace', () => {
  class Capture implements EmailProvider {
    readonly name = 'capture';
    sent: EmailMessage[] = [];
    async send(m: EmailMessage): Promise<EmailResult> {
      this.sent.push(m);
      return { delivered: true, driver: 'http' };
    }
  }

  it('the public form, the link page, /v1/me and the submission emails', async () => {
    const app = wire();
    const a = await ana(app);
    await db.run(
      sql`INSERT INTO link_page (id, account_id, slug, is_default, config, created_at, updated_at)
          VALUES (${randomUUID()}, ${acme}, ${'main'}, ${1}, ${'{"version":1,"enabled":true}'}, ${Date.now()}, ${Date.now()})`,
    );
    const submissions = new SubmissionService(
      db,
      new EmailEffects(new SubmissionNotifier(new LogOnlyEmailProvider()), db),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      app.attribution,
    );
    const pages = new LinkPageService(db, undefined, app.attribution);
    const capture = new Capture();
    const cta = () => ({ question: 'Want your own form?', action: 'Create your form, free', href: 'https://example.com/signup' });
    const emails = new EmailEffects(new SubmissionNotifier(capture, { cta }), db, undefined, undefined, app.attribution);
    const payload = JSON.stringify({ accountId: acme, submissionId: 's1', formName: 'Lead', to: ['owner@acme.test'] });

    const surfaces = async () => {
      capture.sent = [];
      await emails.deliver('submission_received', payload);
      const me = (await app.crud.me(as(acme, a.member))) as { attributionBadge: { showing: boolean } };
      return {
        form: (await submissions.publicForm('acme', 'lead-qualifier'))!.showAttribution,
        page: (await pages.publicPage('acme'))!.showAttribution,
        me: me.attributionBadge.showing,
        email: (capture.sent[0]!.html ?? '').includes('Create your form, free'),
      };
    };

    expect(await surfaces()).toEqual({ form: true, page: true, me: true, email: true });
    await referTimes(app, a.code, 5);
    expect(await surfaces()).toEqual({ form: false, page: false, me: false, email: false });
  });
});
