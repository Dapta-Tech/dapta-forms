/**
 * The same-browser rule (0034), end to end on in-memory SQLite: a referral
 * does not count when the new person signs up in a browser the referrer was
 * seen in. One person opening five accounts in their own browser reached the
 * referral unlock that way.
 *
 *   1. A dashboard load (`/v1/me`) records the browser id the web forwards
 *      (`x-quill-browser`, hashed by the API's middleware) against the person.
 *   2. A link claim from a browser the referrer was seen in is refused,
 *      silently (`{ credited: false }`), and `referral_refused` is sent with
 *      `{ reason: 'same_browser', referral_code, referral_source }`.
 *   3. Another browser counts; a referrer seen in several browsers is refused
 *      in any of them; a request without a browser id (no cookie yet, an old
 *      browser) counts, as before.
 *   4. A teammate invite accepted in the inviter's own browser does not count
 *      either: the sign-in runs inside the request that carried the id.
 *   5. A database failure in any of it never fails a page or a sign-in.
 *   6. A network address is never a signal: nothing here reads one.
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServerEnv } from '@quill/config/env';
import { createDb, migrate, seed, sql, type Db } from '@quill/db';
import { AuthService } from './auth.service';
import { LocalAuthProvider, type ReqLike } from './auth.provider';
import { AdminCrudController } from './admin-crud.controller';
import { AdminService } from './admin.service';
import { AnalyticsEffects } from './analytics-effects';
import { BROWSER_ID_HEADER, browserHash, browserIdMiddleware, currentBrowserHash, parseBrowserId } from './browser-id';
import { ReferralController } from './referral.controller';
import { ReferralService, type ReferralOptions } from './referral.service';

const ON: ReferralOptions = { enabled: true, baseUrl: 'https://landing.example.test' };
const MIN = 60_000;

/** Browser ids as the web mints them: 32 random bytes, base64url. */
const CHROME = 'Q2hyb21lQ2hyb21lQ2hyb21lQ2hyb21lQ2hyb21lQ2g';
const FIREFOX = 'RmlyZWZveEZpcmVmb3hGaXJlZm94RmlyZWZveEZpcmU';
const SAFARI = 'U2FmYXJpU2FmYXJpU2FmYXJpU2FmYXJpU2FmYXJpU2E';

let db: Db;
let acme: string;
let auth: AuthService;

/**
 * Run `fn` the way the API runs a request: through the real middleware, with
 * the web's browser header (or none).
 */
function inBrowser<T>(browser: string | null, fn: () => Promise<T>): Promise<T> {
  const req = { headers: browser ? { [BROWSER_ID_HEADER]: browser } : {} } as IncomingMessage;
  return new Promise<T>((resolve, reject) => {
    browserIdMiddleware()(req, {} as ServerResponse, () => {
      fn().then(resolve, reject);
    });
  });
}

const as = (accountId: string, memberId: string): ReqLike => ({
  headers: { 'x-quill-account': accountId, 'x-quill-member': memberId },
});

async function addAccount(code: string): Promise<string> {
  const id = randomUUID();
  await db.run(sql`INSERT INTO account (id, code, name, created_at) VALUES (${id}, ${code}, ${code}, ${Date.now()})`);
  return id;
}

async function addMember(accountId: string, email: string, externalId: string, createdAt = Date.now()): Promise<string> {
  const id = randomUUID();
  await db.run(
    sql`INSERT INTO member (id, account_id, email, role, status, external_id, created_at)
        VALUES (${id}, ${accountId}, ${email}, 'owner', 'active', ${externalId}, ${createdAt})`,
  );
  return id;
}

const analyticsOn = () => new AnalyticsEffects(db, { PRODUCT_ANALYTICS_KEY: 'phc_test' } as ServerEnv);

function wire(options: ReferralOptions = ON) {
  const referrals = new ReferralService(db, options, analyticsOn());
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
  return { referrals, crud, claims: new ReferralController(auth, referrals) };
}

type Wired = ReturnType<typeof wire>;

/** Ana, an existing person, opens her dashboard in `browsers` (each a `/v1/me`), and her code. */
async function referrerAna(app: Wired, browsers: (string | null)[]) {
  const member = await addMember(acme, 'ana@example.com', 'user_ana', Date.now() - 30 * 24 * 60 * MIN);
  let link = '';
  for (const b of browsers) {
    const me = (await inBrowser(b, () => app.crud.me(as(acme, member)))) as { referral: { link: string } };
    link = me.referral.link;
  }
  const count = async () =>
    ((await app.crud.me(as(acme, member))) as { referral: { count: number } }).referral.count;
  return { member, code: new URL(link).searchParams.get('ref')!, count };
}

/** A person who signed up just now, in a workspace of their own. */
async function newPerson(name: string) {
  const account = await addAccount(`ws-${randomUUID().slice(0, 8)}`);
  return { account, member: await addMember(account, `${name}@example.com`, `user_${name}`) };
}

const events = async (name: string) =>
  (await db.all<{ payload: string }>(sql`SELECT payload FROM outbox WHERE kind = 'analytics'`))
    .map((r) => JSON.parse(r.payload) as { event: string; distinctId: string; accountId: string | null; properties?: Record<string, unknown> })
    .filter((e) => e.event === name);

const browserRows = (person: string) =>
  db.all<{ browser_hash: string }>(sql`SELECT browser_hash FROM referrer_browser WHERE person_id = ${person}`);

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db);
  acme = (await db.get<{ id: string }>(sql`SELECT id FROM account WHERE code = 'acme' LIMIT 1`))!.id;
  auth = new AuthService(
    db,
    new LocalAuthProvider(db, {
      NODE_ENV: 'test',
      DEV_LOGIN_EMAIL: undefined,
      AUTH_LOCAL_STRICT: undefined,
      SEED_DEMO_FORM: false,
      ONBOARDING_WIZARD: false,
    }),
  );
});

afterEach(async () => {
  await db.close();
});

describe('the browser id header', () => {
  it('is hashed on the way in, and a malformed one is no browser at all', async () => {
    expect(await inBrowser(CHROME, async () => currentBrowserHash())).toBe(browserHash(CHROME));
    expect(browserHash(CHROME)).toMatch(/^[0-9a-f]{64}$/);
    expect(await inBrowser(null, async () => currentBrowserHash())).toBeNull();
    expect(await inBrowser('short', async () => currentBrowserHash())).toBeNull();
    expect(await inBrowser('has spaces and ; semicolons, long enough to pass', async () => currentBrowserHash())).toBeNull();
    expect(parseBrowserId([CHROME, FIREFOX])).toBe(CHROME);
    expect(currentBrowserHash()).toBeNull();
  });
});

describe('/v1/me records the browser', () => {
  it('stores the hash, never the raw id, once per person and browser', async () => {
    const app = wire();
    await referrerAna(app, [CHROME, CHROME, FIREFOX]);
    const rows = (await browserRows('user_ana')).map((r) => r.browser_hash).sort();
    expect(rows).toEqual([browserHash(CHROME), browserHash(FIREFOX)].sort());
    expect(JSON.stringify(rows)).not.toContain(CHROME);
  });

  it('with the program off, or no browser id, writes nothing', async () => {
    const off = wire({ enabled: false, baseUrl: null });
    const member = await addMember(acme, 'ana@example.com', 'user_ana');
    await inBrowser(CHROME, () => off.crud.me(as(acme, member)));
    await inBrowser(null, () => wire().crud.me(as(acme, member)));
    expect(await browserRows('user_ana')).toEqual([]);
  });

  it('a failing table never fails the dashboard', async () => {
    const app = wire();
    const member = await addMember(acme, 'ana@example.com', 'user_ana');
    await db.run(sql`DROP TABLE referrer_browser`);
    const me = (await inBrowser(CHROME, () => app.crud.me(as(acme, member)))) as { referral: { enabled: boolean } };
    expect(me.referral.enabled).toBe(true);
  });
});

describe('POST /v1/me/referral/claim, the same-browser rule', () => {
  it('refuses a sign-up in the browser the referrer uses, silently, and sends referral_refused', async () => {
    const app = wire();
    const ana = await referrerAna(app, [CHROME]);
    const ben = await newPerson('ben');
    const answer = await inBrowser(CHROME, () => app.claims.claim(as(ben.account, ben.member), { code: ana.code }));
    expect(answer).toEqual({ credited: false });
    expect(await ana.count()).toBe(0);
    expect(await events('forms_referral_signup')).toHaveLength(0);
    const refused = await events('forms_referral_refused');
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({
      distinctId: 'ben@example.com',
      accountId: ben.account,
      properties: { reason: 'same_browser', referral_code: ana.code, referral_source: 'link' },
    });
    // The countdown email is not queued for a refused referral.
    expect(await db.all(sql`SELECT id FROM outbox WHERE kind = 'email'`)).toEqual([]);
  });

  it('counts a sign-up in another browser', async () => {
    const app = wire();
    const ana = await referrerAna(app, [CHROME]);
    const ben = await newPerson('ben');
    expect(await inBrowser(FIREFOX, () => app.claims.claim(as(ben.account, ben.member), { code: ana.code }))).toEqual({
      credited: true,
    });
    expect(await ana.count()).toBe(1);
    expect(await events('forms_referral_refused')).toHaveLength(0);
  });

  it('a referrer seen in several browsers is refused in any of them', async () => {
    const app = wire();
    const ana = await referrerAna(app, [CHROME, FIREFOX]);
    const ben = await newPerson('ben');
    const cy = await newPerson('cy');
    expect(await inBrowser(FIREFOX, () => app.claims.claim(as(ben.account, ben.member), { code: ana.code }))).toEqual({
      credited: false,
    });
    expect(await inBrowser(CHROME, () => app.claims.claim(as(cy.account, cy.member), { code: ana.code }))).toEqual({
      credited: false,
    });
    expect(await ana.count()).toBe(0);
    expect(await events('forms_referral_refused')).toHaveLength(2);
    // A third browser still counts.
    const dee = await newPerson('dee');
    expect(await inBrowser(SAFARI, () => app.claims.claim(as(dee.account, dee.member), { code: ana.code }))).toEqual({
      credited: true,
    });
  });

  it('a claim without a browser id counts, as before (no cookie yet, an old browser)', async () => {
    const app = wire();
    const ana = await referrerAna(app, [CHROME]);
    const ben = await newPerson('ben');
    expect(await inBrowser(null, () => app.claims.claim(as(ben.account, ben.member), { code: ana.code }))).toEqual({
      credited: true,
    });
    expect(await ana.count()).toBe(1);
  });

  it('records the referee in the browser they claimed from, so their own referrals there are refused later', async () => {
    const app = wire();
    const ana = await referrerAna(app, [CHROME]);
    const ben = await newPerson('ben');
    await inBrowser(FIREFOX, () => app.claims.claim(as(ben.account, ben.member), { code: ana.code }));
    expect((await browserRows('user_ben')).map((r) => r.browser_hash)).toEqual([browserHash(FIREFOX)]);
  });

  it('the other rules keep their answers and send no referral_refused (self-referral, not new)', async () => {
    const app = wire();
    const ana = await referrerAna(app, [CHROME]);
    const self = await newPerson('ana');
    await db.run(sql`UPDATE member SET external_id = 'user_ana' WHERE id = ${self.member}`);
    expect(await inBrowser(CHROME, () => app.claims.claim(as(self.account, self.member), { code: ana.code }))).toEqual({
      credited: false,
    });
    const old = await newPerson('old');
    await db.run(sql`UPDATE member SET created_at = ${Date.now() - 60 * MIN} WHERE id = ${old.member}`);
    expect(await inBrowser(CHROME, () => app.claims.claim(as(old.account, old.member), { code: ana.code }))).toEqual({
      credited: false,
    });
    expect(await events('forms_referral_refused')).toHaveLength(0);
  });

  it('a failing browser table answers credited: false, never an error', async () => {
    const app = wire();
    const ana = await referrerAna(app, [CHROME]);
    const ben = await newPerson('ben');
    await db.run(sql`DROP TABLE referrer_browser`);
    expect(await inBrowser(CHROME, () => app.claims.claim(as(ben.account, ben.member), { code: ana.code }))).toEqual({
      credited: false,
    });
  });
});

describe('teammate invites, the same-browser rule', () => {
  /** The app as wired for local development: sign-in by email credits invites. */
  function wireInvites() {
    const box: { referrals?: ReferralService } = {};
    const localAuth = new AuthService(
      db,
      new LocalAuthProvider(
        db,
        { NODE_ENV: 'test', DEV_LOGIN_EMAIL: undefined, AUTH_LOCAL_STRICT: undefined, SEED_DEMO_FORM: false, ONBOARDING_WIZARD: false },
        undefined,
        (p) => box.referrals!.creditInvite(p),
      ),
    );
    const referrals = (box.referrals = new ReferralService(db, ON, analyticsOn()));
    const crud = new AdminCrudController(
      db,
      localAuth,
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
    return { crud, referrals };
  }

  const signIn = (email: string): ReqLike => ({ headers: { 'x-quill-email': email } });

  /** Ana owns a workspace, opens her dashboard in `browser`, and invites bea@example.com. */
  async function anaInvitesBea(app: ReturnType<typeof wireInvites>, browser: string) {
    const account = await addAccount('team');
    const owner = randomUUID();
    await db.run(
      sql`INSERT INTO member (id, account_id, email, role, status, created_at)
          VALUES (${owner}, ${account}, 'ana@example.com', 'owner', 'active', ${Date.now() - 30 * 24 * 60 * MIN})`,
    );
    await inBrowser(browser, () => app.crud.me(signIn('ana@example.com')));
    await db.run(
      sql`INSERT INTO member (id, account_id, email, role, status, created_at)
          VALUES (${randomUUID()}, ${account}, 'bea@example.com', 'member', 'invited', ${Date.now()})`,
    );
    await app.referrals.recordInvite({ accountId: account, memberId: owner }, 'bea@example.com');
    const count = async () =>
      ((await app.crud.me(signIn('ana@example.com'))) as { referral: { count: number } }).referral.count;
    return { count };
  }

  it('an invite accepted in the inviter own browser does not count, and sends referral_refused', async () => {
    const app = wireInvites();
    const ana = await anaInvitesBea(app, CHROME);
    await inBrowser(CHROME, () => app.crud.me(signIn('bea@example.com')));
    expect(await ana.count()).toBe(0);
    const refused = await events('forms_referral_refused');
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({
      distinctId: 'bea@example.com',
      properties: { reason: 'same_browser', referral_source: 'invite' },
    });
  });

  it('an invite accepted in another browser counts', async () => {
    const app = wireInvites();
    const ana = await anaInvitesBea(app, CHROME);
    await inBrowser(FIREFOX, () => app.crud.me(signIn('bea@example.com')));
    expect(await ana.count()).toBe(1);
    expect(await events('forms_referral_refused')).toHaveLength(0);
  });

  it('an invite accepted with no browser id counts, as before', async () => {
    const app = wireInvites();
    const ana = await anaInvitesBea(app, CHROME);
    await inBrowser(null, () => app.crud.me(signIn('bea@example.com')));
    expect(await ana.count()).toBe(1);
  });

  it('a failing browser table never fails the sign-in', async () => {
    const app = wireInvites();
    await anaInvitesBea(app, CHROME);
    await db.run(sql`DROP TABLE referrer_browser`);
    const me = (await inBrowser(CHROME, () => app.crud.me(signIn('bea@example.com')))) as { email: string };
    expect(me.email).toBe('bea@example.com');
  });
});
