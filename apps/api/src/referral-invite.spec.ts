/**
 * Teammate invites count as referrals (source `invite`), end to end on
 * in-memory SQLite:
 *
 *   1. Inviting a teammate by email records who invited that address: the
 *      identity service's invitation has no inviter, so this record is the only
 *      source. The first inviter of an address keeps it.
 *   2. When the invited address first shows up as a NEW person, the inviter is
 *      credited: on the identity-service projection, on the fallback sign-in
 *      path and on local development's invite acceptance.
 *   3. New means "no bound member row before this sign-in", never the age of
 *      the adopted invite row (it keeps the invite's `created_at`).
 *   4. The rules of `creditReferral` hold: an existing dForms user does not
 *      count, a person already credited by a link is not counted twice, a
 *      self-invite does not count.
 *   5. A failure inside the credit never fails the sign-in.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServerEnv } from '@quill/config/env';
import { createDb, migrate, seed, sql, type Db } from '@quill/db';
import { AuthService } from './auth.service';
import { LocalAuthProvider, type NewPersonObserver, type ReqLike } from './auth.provider';
import { WorkOsAuthProvider } from './auth.provider.workos';
import { WorkspaceProjection } from './workspace-projection';
import { IamWorkspacesClient, type IamWorkspace } from './iam-workspaces';
import { WorkspaceService } from './workspace.service';
import { AdminCrudController } from './admin-crud.controller';
import { AdminService } from './admin.service';
import { AnalyticsEffects } from './analytics-effects';
import { ReferralController } from './referral.controller';
import { ReferralService, type ReferralOptions } from './referral.service';
import { signJwtHs256 } from './jwt';

const LANDING = 'https://landing.example.test';
const ON: ReferralOptions = { enabled: true, baseUrl: LANDING };
const OFF: ReferralOptions = { enabled: false, baseUrl: null };
const DAY = 24 * 60 * 60_000;
const SECRET = 'test-secret';

let db: Db;
let now: number;

/** A request as one member of one workspace (the local stub's impersonation headers). */
const as = (accountId: string, memberId: string): ReqLike => ({
  headers: { 'x-quill-account': accountId, 'x-quill-member': memberId },
});

function service(options: ReferralOptions = ON, analytics?: AnalyticsEffects): ReferralService {
  return new ReferralService(db, { ...options, now: () => now }, analytics);
}

function crud(auth: AuthService, referrals: ReferralService, workspaces?: WorkspaceService): AdminCrudController {
  return new AdminCrudController(
    db,
    auth,
    new AdminService(db),
    {} as never,
    {} as never,
    undefined,
    undefined,
    workspaces,
    undefined,
    undefined,
    undefined,
    undefined,
    referrals,
  );
}

async function countOf(controller: AdminCrudController, req: ReqLike): Promise<number | undefined> {
  const me = (await controller.me(req)) as { referral: { count?: number } };
  return me.referral.count;
}

const referralRows = () =>
  db.all<{ referee_person_id: string; referrer_person_id: string; source: string }>(
    sql`SELECT referee_person_id, referrer_person_id, source FROM referral ORDER BY created_at`,
  );

const analyticsOn = () => new AnalyticsEffects(db, { PRODUCT_ANALYTICS_KEY: 'phc_test' } as ServerEnv);
const signupEvents = async () =>
  (await db.all<{ payload: string }>(sql`SELECT payload FROM outbox WHERE kind = 'analytics'`))
    .map((r) => JSON.parse(r.payload) as { event: string; distinctId: string; properties?: Record<string, unknown> })
    .filter((e) => e.event === 'forms_referral_signup');

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  now = Date.now();
});

afterEach(async () => {
  await db.close();
});

// --- Local development: invite by email, the invitee signs in by email -------

describe('local development', () => {
  let acme: string;
  let alex: string;

  /** A request as a person signing in by email (the local stub's dev login). */
  const signIn = (email: string): ReqLike => ({ headers: { 'x-quill-email': email } });

  const localAuth = (onNewPerson?: NewPersonObserver) =>
    new AuthService(
      db,
      new LocalAuthProvider(
        db,
        { NODE_ENV: 'test', DEV_LOGIN_EMAIL: undefined, AUTH_LOCAL_STRICT: undefined, SEED_DEMO_FORM: false, ONBOARDING_WIZARD: false },
        undefined,
        onNewPerson,
      ),
    );

  /** The app as wired: the auth provider credits invites through the referral service. */
  const app = (referrals: ReferralService = service()) => {
    const auth = localAuth((p) => referrals.creditInvite(p));
    return { auth, controller: crud(auth, referrals), referrals };
  };

  async function addWorkspace(code: string, ownerEmail: string): Promise<{ account: string; owner: string }> {
    const account = randomUUID();
    const owner = randomUUID();
    await db.run(sql`INSERT INTO account (id, code, name, created_at) VALUES (${account}, ${code}, ${code}, ${now})`);
    await db.run(
      sql`INSERT INTO member (id, account_id, email, role, status, created_at)
          VALUES (${owner}, ${account}, ${ownerEmail}, 'owner', 'active', ${now})`,
    );
    return { account, owner };
  }

  beforeEach(async () => {
    await seed(db); // account "acme" + owner alex@example.com
    acme = (await db.get<{ id: string }>(sql`SELECT id FROM account WHERE code = 'acme' LIMIT 1`))!.id;
    alex = (await db.get<{ id: string }>(sql`SELECT id FROM member WHERE email = 'alex@example.com' LIMIT 1`))!.id;
  });

  it('credits the inviter when the invitee signs in for the first time, days after the invite', async () => {
    const { auth, controller } = app();
    await controller.inviteMember(as(acme, alex), { email: 'Bea@Example.com' });
    now += 3 * DAY; // the invite row is old; the person is still new
    await auth.resolveHost(signIn('bea@example.com'));
    expect(await countOf(controller, as(acme, alex))).toBe(1);
    expect(await referralRows()).toEqual([
      { referee_person_id: 'email:bea@example.com', referrer_person_id: 'email:alex@example.com', source: 'invite' },
    ]);
  });

  it('counts the invitee once, however often they sign in', async () => {
    const { auth, controller } = app();
    await controller.inviteMember(as(acme, alex), { email: 'bea@example.com' });
    await auth.resolveHost(signIn('bea@example.com'));
    await auth.resolveHost(signIn('bea@example.com'));
    expect(await countOf(controller, as(acme, alex))).toBe(1);
  });

  it('an existing dForms user who accepts an invite does not count', async () => {
    const { auth, controller } = app();
    await auth.resolveHost(signIn('dan@example.com')); // Dan already uses dForms
    await controller.inviteMember(as(acme, alex), { email: 'dan@example.com' });
    await auth.resolveHost(signIn('dan@example.com'));
    expect(await countOf(controller, as(acme, alex))).toBe(0);
  });

  it('two inviters of the same address: the first one gets the credit', async () => {
    const { auth, controller } = app();
    const globex = await addWorkspace('globex', 'hal@example.com');
    await controller.inviteMember(as(acme, alex), { email: 'bea@example.com' });
    now += 1000;
    await controller.inviteMember(as(globex.account, globex.owner), { email: 'bea@example.com' });
    await auth.resolveHost(signIn('bea@example.com'));
    expect(await countOf(controller, as(acme, alex))).toBe(1);
    expect(await countOf(controller, as(globex.account, globex.owner))).toBe(0);
  });

  it('with the program off, an invite records nothing and credits nobody', async () => {
    const { auth, controller } = app(service(OFF));
    await controller.inviteMember(as(acme, alex), { email: 'bea@example.com' });
    await auth.resolveHost(signIn('bea@example.com'));
    expect((await db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM referral_invite`))!.n).toBe(0);
    expect(await referralRows()).toEqual([]);
  });

  it('a failure inside the credit never fails the sign-in', async () => {
    const { auth, controller } = app();
    await controller.inviteMember(as(acme, alex), { email: 'bea@example.com' });
    await db.run(sql`DROP TABLE referral`);
    const home = await auth.resolveHost(signIn('bea@example.com'));
    expect(home.accountId).toBe(acme);
  });

  it('an observer that throws never fails the sign-in either', async () => {
    const controller = crud(localAuth(), service());
    await controller.inviteMember(as(acme, alex), { email: 'bea@example.com' });
    const auth = localAuth(async () => {
      throw new Error('boom');
    });
    expect((await auth.resolveHost(signIn('bea@example.com'))).accountId).toBe(acme);
  });

  it('sends referral_signup for the invitee with source invite and the inviter code', async () => {
    const referrals = service(ON, analyticsOn());
    const { auth, controller } = app(referrals);
    await controller.inviteMember(as(acme, alex), { email: 'bea@example.com' });
    await auth.resolveHost(signIn('bea@example.com'));
    const link = ((await controller.me(as(acme, alex))) as { referral: { link: string } }).referral.link;
    const code = new URL(link).searchParams.get('ref');
    const sent = await signupEvents();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      distinctId: 'bea@example.com',
      properties: { referral_code: code, referral_source: 'invite' },
    });
  });
});

// --- The identity service: invitations upstream, the projection on sign-in ---

const IAM_ANA = 'acct-ana';
const IAM_BEA = 'acct-bea';
const IAM_HAL = 'acct-hal';
const SUB_ANA = 'sub-ana';
const SUB_BEA = 'sub-bea';
const SUB_HAL = 'sub-hal';
const WS_ANA = 'ws-ana';
const WS_HAL = 'ws-hal';

function json(v: unknown, status = 200): Response {
  return new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
}

function token(sub: string, account: string, email: string): string {
  return signJwtHs256({ sub, account_id: account, email, name: sub, exp: 4102444800 }, SECRET);
}
const bearer = (t: string): ReqLike => ({ headers: { authorization: `Bearer ${t}` } });

describe('the identity service projection', () => {
  let workspaces: IamWorkspace[];
  let invitations: Array<{ id: string; workspace_id: string; invited_email: string; status: string }>;
  let referrals: ReferralService;
  let auth: AuthService;
  let controller: AdminCrudController;

  const ana = bearer(token(SUB_ANA, IAM_ANA, 'ana@example.com'));
  const hal = bearer(token(SUB_HAL, IAM_HAL, 'hal@example.com'));
  const bea = (sub = SUB_BEA, email = 'bea@example.com') => bearer(token(sub, IAM_BEA, email));

  const owner = (id: string, sub: string) => ({ id, user_id: sub, type: 'OWNER' as const, is_active: true, roles: [] });
  /** The invitee accepted upstream: the workspace now names them. */
  const accept = (wsId: string, sub: string) =>
    workspaces.find((w) => w.id === wsId)!.users!.push({ id: `wu-${sub}-${wsId}`, user_id: sub, type: 'MEMBER', is_active: true, roles: [] });

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (method === 'GET' && url.pathname.startsWith('/iam/account/')) return json({ id: url.pathname.split('/').pop(), feature_flags: {} });
    if (method === 'GET' && url.pathname === '/iam/workspace/search') {
      // The fake answers with every workspace; membership is decided by users[].
      return json({ data: workspaces, total: workspaces.length, totalPages: 1 });
    }
    if (method === 'GET' && url.pathname.startsWith('/iam/role/roles-workspace/'))
      return json([{ id: 'role-admin', name: 'workspace_admin', is_system: true }]);
    if (method === 'GET' && url.pathname === '/iam/role')
      return json([
        { id: 'role-admin', name: 'workspace_admin', is_system: true },
        { id: 'role-editor', name: 'workspace_editor', is_system: true },
      ]);
    if (method === 'POST' && url.pathname === '/iam/workspace-invitations') {
      invitations.push({ id: `inv-${invitations.length + 1}`, workspace_id: body.workspace_id, invited_email: body.invited_email, status: 'pending' });
      return json(invitations[invitations.length - 1], 201);
    }
    return new Response('nope', { status: 404 });
  };

  function wire(onNewPerson?: NewPersonObserver) {
    referrals = service(ON, analyticsOn());
    const projection = new WorkspaceProjection(db, new IamWorkspacesClient({ baseUrl: 'https://iam.test/iam', fetchImpl }), {
      // TTL 0: every request refreshes, like a person's first request after the cache cooled.
      ttlMs: 0,
      now: () => now,
      onNewPerson: onNewPerson ?? ((p) => referrals.creditInvite(p)),
    });
    const provider = new WorkOsAuthProvider(
      db,
      { JWT_SECRET: SECRET, JWT_ISSUER: undefined, JWT_AUDIENCE: undefined, SEED_DEMO_FORM: false, ONBOARDING_WIZARD: false },
      undefined,
      projection,
    );
    auth = new AuthService(db, provider);
    controller = crud(auth, referrals, new WorkspaceService(db, provider, auth, projection));
  }

  /** The workspace and member a request lands on. */
  const home = (req: ReqLike) => auth.resolveHost(req);
  const countFor = (req: ReqLike) => countOf(controller, req);
  const invite = (req: ReqLike, email: string) => controller.inviteMember(req, { email });

  beforeEach(async () => {
    invitations = [];
    workspaces = [
      { id: WS_ANA, name: 'Ana', account_id: IAM_ANA, is_active: true, users: [owner('wu-ana', SUB_ANA)] },
      { id: WS_HAL, name: 'Hal', account_id: IAM_HAL, is_active: true, users: [owner('wu-hal', SUB_HAL)] },
    ];
    wire();
  });

  it('credits the inviter when the invitee first signs in, days after the invite', async () => {
    await invite(ana, 'Bea@Example.com');
    expect(invitations.map((i) => i.invited_email)).toEqual(['bea@example.com']);
    now += 5 * DAY;
    accept(WS_ANA, SUB_BEA);
    await home(bea());
    expect(await countFor(ana)).toBe(1);
    expect(await referralRows()).toEqual([{ referee_person_id: SUB_BEA, referrer_person_id: SUB_ANA, source: 'invite' }]);
    const sent = await signupEvents();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ distinctId: 'bea@example.com', properties: { referral_source: 'invite' } });
  });

  it('counts a person once even when they join two workspaces in the same refresh', async () => {
    await invite(ana, 'bea@example.com');
    await invite(hal, 'bea@example.com');
    accept(WS_ANA, SUB_BEA);
    accept(WS_HAL, SUB_BEA);
    await home(bea());
    expect(await referralRows()).toHaveLength(1);
    expect(await countFor(ana)).toBe(1);
    expect(await countFor(hal)).toBe(0);
  });

  it('an existing dForms user who accepts an invite does not count', async () => {
    // Bea used dForms in Hal's workspace before Ana invited her.
    accept(WS_HAL, SUB_BEA);
    await home(bea());
    await invite(ana, 'bea@example.com');
    accept(WS_ANA, SUB_BEA);
    await home(bea());
    expect(await countFor(ana)).toBe(0);
  });

  it('a self-invite does not count: a new identity on the inviter address', async () => {
    await invite(ana, 'ana@example.com');
    accept(WS_ANA, 'sub-ana-twin');
    await home(bea('sub-ana-twin', 'ana@example.com'));
    expect(await countFor(ana)).toBe(0);
  });

  it('two inviters of the same address: the first one gets the credit', async () => {
    await invite(hal, 'bea@example.com');
    now += 1000;
    await invite(ana, 'bea@example.com');
    accept(WS_ANA, SUB_BEA);
    await home(bea());
    expect(await countFor(hal)).toBe(1);
    expect(await countFor(ana)).toBe(0);
  });

  it('an invitee arriving through another person link counts once, for the inviter (the sign-in comes first)', async () => {
    const halLink = ((await controller.me(hal)) as { referral: { link: string } }).referral.link;
    await invite(ana, 'bea@example.com');
    accept(WS_ANA, SUB_BEA);
    await home(bea()); // the projection runs on the callback before the claim
    const claimed = await new ReferralController(auth, referrals).claim(bea(), {
      code: new URL(halLink).searchParams.get('ref'),
    });
    expect(claimed).toEqual({ credited: false });
    expect(await countFor(ana)).toBe(1);
    expect(await countFor(hal)).toBe(0);
  });

  it('a person already credited by a link is not counted again by an invite', async () => {
    const halLink = ((await controller.me(hal)) as { referral: { link: string } }).referral.link;
    await invite(ana, 'bea@example.com');
    // Bea's first sign-in lands in a workspace of her own (no invite there to adopt) and claims Hal's link.
    workspaces.push({ id: 'ws-bea', name: 'Bea', account_id: IAM_BEA, is_active: true, users: [owner('wu-bea', SUB_BEA)] });
    wire(async () => {}); // nothing observes new people on this sign-in
    const p = await home(bea());
    expect(
      await new ReferralController(auth, referrals).claim(bea(), {
        code: new URL(halLink).searchParams.get('ref'),
      }),
    ).toEqual({ credited: true });
    // The invite credit then arrives for the same new person.
    await referrals.creditInvite({ accountId: p.accountId, memberId: p.memberId, email: 'bea@example.com' });
    expect(await referralRows()).toEqual([{ referee_person_id: SUB_BEA, referrer_person_id: SUB_HAL, source: 'link' }]);
  });

  it('a staff access grant is not a prior account: staff joining for real still count', async () => {
    await db.run(sql`INSERT INTO account (id, code, name, external_id, created_at) VALUES ('acc-x', 'x', 'X', 'ws-x', ${now})`);
    await db.run(
      sql`INSERT INTO member (id, account_id, external_id, email, role, status, access_grant, created_at)
          VALUES ('m-grant', 'acc-x', ${SUB_BEA}, 'bea@example.com', 'admin', 'active', 'staff', ${now - 30 * DAY})`,
    );
    await invite(ana, 'bea@example.com');
    accept(WS_ANA, SUB_BEA);
    await home(bea());
    expect(await countFor(ana)).toBe(1);
  });

  it('a failure inside the credit never fails the sign-in or the projection', async () => {
    await invite(ana, 'bea@example.com');
    wire(async () => {
      throw new Error('boom');
    });
    accept(WS_ANA, SUB_BEA);
    const p = await home(bea());
    const row = await db.get<{ external_id: string }>(sql`SELECT external_id FROM account WHERE id = ${p.accountId}`);
    expect(row!.external_id).toBe(WS_ANA);
  });

  it('a broken referral table never fails the sign-in either', async () => {
    await invite(ana, 'bea@example.com');
    await db.run(sql`DROP TABLE referral`);
    accept(WS_ANA, SUB_BEA);
    await expect(home(bea())).resolves.toMatchObject({ memberId: expect.any(String) });
  });
});

// --- The fallback sign-in path (no identity service workspaces) --------------

describe('the fallback sign-in path', () => {
  const ACCOUNT = 'acct-team';
  let referrals: ReferralService;
  let auth: AuthService;
  let controller: AdminCrudController;

  function wire(onNewPerson?: NewPersonObserver) {
    referrals = service();
    const provider = new WorkOsAuthProvider(
      db,
      { JWT_SECRET: SECRET, JWT_ISSUER: undefined, JWT_AUDIENCE: undefined, SEED_DEMO_FORM: false, ONBOARDING_WIZARD: false },
      undefined,
      undefined,
      onNewPerson ?? ((p) => referrals.creditInvite(p)),
    );
    auth = new AuthService(db, provider);
    controller = crud(auth, referrals);
  }

  const ana = bearer(token(SUB_ANA, ACCOUNT, 'ana@example.com'));
  const bea = bearer(token(SUB_BEA, ACCOUNT, 'bea@example.com'));
  const countFor = (req: ReqLike) => countOf(controller, req);

  beforeEach(() => wire());

  it('credits the inviter when the invitee adopts the invite on first sign-in', async () => {
    await controller.inviteMember(ana, { email: 'bea@example.com' }); // Ana's first request makes her the owner
    now += 2 * DAY;
    await auth.resolveHost(bea);
    expect(await countFor(ana)).toBe(1);
    expect(await referralRows()).toEqual([{ referee_person_id: SUB_BEA, referrer_person_id: SUB_ANA, source: 'invite' }]);
  });

  it('an existing dForms user who adopts an invite does not count', async () => {
    await auth.resolveHost(bearer(token(SUB_BEA, 'acct-elsewhere', 'bea@example.com'))); // Bea has her own
    await controller.inviteMember(ana, { email: 'bea@example.com' });
    await auth.resolveHost(bea);
    expect(await countFor(ana)).toBe(0);
  });

  it('a failure inside the credit never fails the sign-in', async () => {
    await controller.inviteMember(ana, { email: 'bea@example.com' });
    wire(async () => {
      throw new Error('boom');
    });
    await expect(auth.resolveHost(bea)).resolves.toMatchObject({ memberId: expect.any(String) });
  });
});
