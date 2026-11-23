/**
 * The referral emails to the referrer, end to end on in-memory SQLite: what
 * each credited referral queues in the outbox, and what that row says once
 * the worker delivers it.
 *
 *   1. A referral that leaves the referrer at 1 to 4 queues the countdown
 *      (`referral_joined`): "{invitee} joined. {left} to go", with its own
 *      subject at 4 of 5, the referral link as the button and the share links.
 *   2. The referral that unlocks them queues "you did it"
 *      (`referral_unlocked`) instead, exactly once; a 6th queues nothing.
 *   3. A teammate invite credit emails like a link credit.
 *   4. The language and the address are the referrer's most recently seen
 *      member row's; with no address nothing is queued.
 *   5. An email failure never breaks the credit.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, migrate, seed, sql, type Db } from '@quill/db';
import { SubmissionNotifier, type EmailMessage, type EmailProvider, type EmailResult } from '@quill/notifications';
import { AuthService } from './auth.service';
import { LocalAuthProvider, type ReqLike } from './auth.provider';
import { AdminCrudController } from './admin-crud.controller';
import { AdminService } from './admin.service';
import { EmailEffects } from './email-effects';
import { ReferralController } from './referral.controller';
import { ReferralService, type ReferralOptions } from './referral.service';

let db: Db;
let acme: string;
let auth: AuthService;

const ON: ReferralOptions = { enabled: true, baseUrl: 'https://landing.example.test' };
const DAY = 24 * 3_600_000;

const as = (accountId: string, memberId: string): ReqLike => ({
  headers: { 'x-quill-account': accountId, 'x-quill-member': memberId },
});

class Capture implements EmailProvider {
  readonly name = 'capture';
  sent: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<EmailResult> {
    this.sent.push(message);
    return { delivered: true, driver: 'http' };
  }
}

async function addAccount(name: string): Promise<string> {
  const id = randomUUID();
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at) VALUES (${id}, ${`${name}-${id.slice(0, 6)}`}, ${name}, ${Date.now()})`,
  );
  return id;
}

async function addMember(
  accountId: string,
  email: string | null,
  opts: {
    externalId?: string;
    role?: 'owner' | 'admin' | 'member';
    createdAt?: number;
    displayName?: string | null;
    locale?: string | null;
    lastSeenAt?: number | null;
  } = {},
): Promise<string> {
  const id = randomUUID();
  await db.run(
    sql`INSERT INTO member (id, account_id, email, role, status, external_id, display_name, locale, last_seen_at, created_at)
        VALUES (${id}, ${accountId}, ${email}, ${opts.role ?? 'member'}, 'active', ${opts.externalId ?? null},
          ${opts.displayName ?? null}, ${opts.locale ?? null}, ${opts.lastSeenAt ?? null}, ${opts.createdAt ?? Date.now()})`,
  );
  return id;
}

function wire(options: ReferralOptions = ON) {
  const capture = new Capture();
  const emails = new EmailEffects(new SubmissionNotifier(capture), db);
  const referrals = new ReferralService(db, options, undefined, emails);
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
  return { capture, emails, referrals, crud, claim: new ReferralController(auth, referrals) };
}

type App = ReturnType<typeof wire>;

const OLD = () => Date.now() - 90 * DAY;

/** Ana owns acme and has a link. */
async function ana(app: App, opts: { email?: string | null; locale?: string | null } = {}) {
  const member = await addMember(acme, opts.email === undefined ? 'ana@example.com' : opts.email, {
    externalId: 'user_ana',
    role: 'owner',
    createdAt: OLD(),
    displayName: 'Ana Gómez',
    locale: opts.locale ?? null,
  });
  const me = (await app.crud.me(as(acme, member))) as { referral: { link: string } };
  const code = new URL(me.referral.link).searchParams.get('ref')!;
  return { member, code, link: me.referral.link };
}

/** One new person signing up through a code, in a workspace of their own. */
async function signUp(app: App, code: string, name: string, displayName: string | null = name): Promise<boolean> {
  const account = await addAccount(`ws-${name}`);
  // An address unlike the name: a name equal to the email's local part is never shown.
  const member = await addMember(account, `invitee-${name.toLowerCase()}@example.com`, {
    externalId: `user_${name}`,
    role: 'owner',
    displayName,
  });
  return (await app.claim.claim(as(account, member), { code })).credited;
}

async function referTimes(app: App, code: string, names: string[]): Promise<void> {
  for (const name of names) expect(await signUp(app, code, name)).toBe(true);
}

interface QueuedEmail {
  action: string;
  accountId: string | null;
  payload: string;
}

const queued = async (): Promise<QueuedEmail[]> =>
  (
    await db.all<{ action: string; account_id: string | null; payload: string }>(
      // The 7-day nudge rides the same queue, scheduled for later: `referral-nudge.spec.ts`.
      sql`SELECT action, account_id, payload FROM outbox
          WHERE kind = 'email' AND action <> 'referral_nudge' ORDER BY created_at, rowid`,
    )
  ).map((r) => ({ action: r.action, accountId: r.account_id, payload: r.payload }));

/** Deliver every queued email the way the worker does, and return what went out. */
async function delivered(app: App): Promise<EmailMessage[]> {
  app.capture.sent = [];
  for (const row of await queued()) await app.emails.deliver(row.action, row.payload, row.accountId);
  return app.capture.sent;
}

beforeEach(async () => {
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

describe('the countdown email, 1 to 4', () => {
  it('each of the first three referrals tells the referrer how many are left', async () => {
    const app = wire();
    const a = await ana(app);
    await referTimes(app, a.code, ['Bea', 'Carl', 'Dan']);
    expect((await queued()).map((r) => r.action)).toEqual(['referral_joined', 'referral_joined', 'referral_joined']);
    const sent = await delivered(app);
    expect(sent.map((m) => m.subject)).toEqual([
      'Bea joined. 4 to go to remove the badge',
      'Carl joined. 3 to go to remove the badge',
      'Dan joined. 2 to go to remove the badge',
    ]);
    expect(sent.every((m) => JSON.stringify(m.to) === JSON.stringify(['ana@example.com']))).toBe(true);
  });

  it('the 4th has its own subject', async () => {
    const app = wire();
    const a = await ana(app);
    await referTimes(app, a.code, ['Bea', 'Carl', 'Dan', 'Eli']);
    const sent = await delivered(app);
    expect(sent.at(-1)!.subject).toBe('Just 1 to go! Eli joined');
  });

  it('says the count out of 5, names the badge, and carries the link and the share links', async () => {
    const app = wire();
    const a = await ana(app);
    await referTimes(app, a.code, ['Bea', 'Carl']);
    const second = (await delivered(app))[1]!;
    expect(second.text).toContain("Carl signed up for dForms with your link. You're at 2 of 5.");
    expect(second.text).toContain('3 more and “Made with dForms” is gone from all your forms, for good.');
    expect(second.text).toContain(`Share my link: ${a.link}`);
    expect(second.html).toContain(`href="${a.link.replace(/&/g, '&amp;')}"`);
    expect(second.html).toContain('>Share my link<');
    expect(second.html).toContain('https://wa.me/?text=');
    expect(second.html).toContain('mailto:?subject=');
    expect(second.html).toContain('https://x.com/intent/post?text=');
    expect(second.html).toContain(encodeURIComponent(a.link));
  });

  it('an invitee with no safe first name is "Someone", never an email', async () => {
    const app = wire();
    const a = await ana(app);
    expect(await signUp(app, a.code, 'Zed', null)).toBe(true);
    expect(await signUp(app, a.code, 'Yan', 'yan@example.com')).toBe(true);
    const sent = await delivered(app);
    expect(sent.map((m) => m.subject)).toEqual([
      'Someone joined. 4 to go to remove the badge',
      'Someone joined. 3 to go to remove the badge',
    ]);
    expect(sent.some((m) => `${m.subject}${m.text}${m.html}`.includes('yan@example.com'))).toBe(false);
  });

  it('escapes the invitee name in the HTML body', async () => {
    const app = wire();
    const a = await ana(app);
    expect(await signUp(app, a.code, 'Eve', '<b>Eve</b> Smith')).toBe(true);
    const [mail] = await delivered(app);
    expect(mail!.html).toContain('&lt;b&gt;Eve&lt;/b&gt; signed up');
    expect(mail!.html).not.toContain('<b>Eve</b>');
  });

  it('a teammate invite credit emails too', async () => {
    const app = wire();
    const a = await ana(app);
    await app.referrals.recordInvite({ accountId: acme, memberId: a.member }, 'tea@example.com');
    const account = await addAccount('ws-tea');
    const member = await addMember(account, 'tea@example.com', {
      externalId: 'user_tea',
      role: 'owner',
      displayName: 'Teo Ruiz',
    });
    await app.referrals.creditInvite({ accountId: account, memberId: member, email: 'tea@example.com' });
    const sent = await delivered(app);
    expect(sent.map((m) => m.subject)).toEqual(['Teo joined. 4 to go to remove the badge']);
  });
});

describe('the unlock email, at 5', () => {
  it('the 5th referral sends "you did it" and no countdown', async () => {
    const app = wire();
    const a = await ana(app);
    await referTimes(app, a.code, ['Bea', 'Carl', 'Dan', 'Eli', 'Fay']);
    expect((await queued()).map((r) => r.action)).toEqual([
      'referral_joined',
      'referral_joined',
      'referral_joined',
      'referral_joined',
      'referral_unlocked',
    ]);
    const last = (await delivered(app)).at(-1)!;
    expect(last.subject).toBe('You did it: your forms no longer show “Made with dForms”');
    expect(last.text).toContain('Five people joined with your link.');
    expect(last.to).toEqual(['ana@example.com']);
  });

  it('a 6th referral sends nothing', async () => {
    const app = wire();
    const a = await ana(app);
    await referTimes(app, a.code, ['Bea', 'Carl', 'Dan', 'Eli', 'Fay']);
    const before = (await queued()).length;
    expect(await signUp(app, a.code, 'Gus')).toBe(true);
    expect((await queued()).length).toBe(before);
  });
});

describe('language and address', () => {
  it('writes in Spanish when the most recently seen member row says so', async () => {
    const app = wire();
    const a = await ana(app, { locale: 'en' });
    // A second workspace, seen more recently, in Spanish.
    const other = await addAccount('ana-dos');
    await addMember(other, 'ana@example.com', {
      externalId: 'user_ana',
      role: 'owner',
      createdAt: OLD(),
      locale: 'es-CO',
      lastSeenAt: Date.now() + DAY,
    });
    await referTimes(app, a.code, ['Bea', 'Carl', 'Dan', 'Eli', 'Fay']);
    const sent = await delivered(app);
    expect(sent.map((m) => m.subject)).toEqual([
      'Bea se unió. Te faltan 4 para quitar el sello',
      'Carl se unió. Te faltan 3 para quitar el sello',
      'Dan se unió. Te faltan 2 para quitar el sello',
      '¡Te falta 1! Eli se unió',
      'Lo lograste: tus formularios ya no llevan «Hecho con dForms»',
    ]);
    expect(sent[1]!.text).toContain('Carl se registró en dForms con tu link. Vas 2 de 5.');
    expect(sent[1]!.text).toContain('Con 3 más, «Hecho con dForms» se va de todos tus formularios, para siempre.');
    expect(sent[1]!.text).toContain(`Compartir mi link: ${a.link}`);
    expect(sent[1]!.html).toContain('lang="es"');
    expect(sent[1]!.html).toContain(encodeURIComponent('Estoy usando dForms'));
  });

  it('an invitee with no name is "Alguien" in Spanish', async () => {
    const app = wire();
    const a = await ana(app, { locale: 'es' });
    expect(await signUp(app, a.code, 'Zed', null)).toBe(true);
    const [mail] = await delivered(app);
    expect(mail!.subject).toBe('Alguien se unió. Te faltan 4 para quitar el sello');
  });

  it('a referrer with no email address is sent nothing, and still credited', async () => {
    const app = wire();
    const a = await ana(app, { email: null });
    await referTimes(app, a.code, ['Bea', 'Carl', 'Dan', 'Eli', 'Fay']);
    expect(await queued()).toEqual([]);
    const me = (await app.crud.me(as(acme, a.member))) as { referral: { count: number; unlocked: boolean } };
    expect(me.referral).toMatchObject({ count: 5, unlocked: true });
  });
});

describe('an email failure never breaks a credit', () => {
  it('with the outbox gone, every referral still counts and the 5th still unlocks', async () => {
    const app = wire();
    const a = await ana(app);
    await db.run(sql`DROP TABLE outbox`);
    await referTimes(app, a.code, ['Bea', 'Carl', 'Dan', 'Eli', 'Fay']);
    const me = (await app.crud.me(as(acme, a.member))) as { referral: { count: number; unlocked: boolean } };
    expect(me.referral).toMatchObject({ count: 5, unlocked: true });
  });

  it('an email service that throws does not undo the credit or the unlock', async () => {
    const throwing = {
      enqueueReferralJoined: async () => {
        throw new Error('boom');
      },
      enqueueReferralUnlocked: async () => {
        throw new Error('boom');
      },
    } as unknown as EmailEffects;
    const app = wire();
    const referrals = new ReferralService(db, ON, undefined, throwing);
    const claim = new ReferralController(auth, referrals);
    const a = await ana(app);
    for (const name of ['Bea', 'Carl', 'Dan', 'Eli', 'Fay']) {
      const account = await addAccount(`ws-${name}`);
      const member = await addMember(account, `${name}@example.com`, { externalId: `user_${name}`, role: 'owner' });
      expect((await claim.claim(as(account, member), { code: a.code })).credited).toBe(true);
    }
    const me = (await app.crud.me(as(acme, a.member))) as { referral: { count: number; unlocked: boolean } };
    expect(me.referral).toMatchObject({ count: 5, unlocked: true });
  });
});
