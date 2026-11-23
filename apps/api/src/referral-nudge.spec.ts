/**
 * The 7-day nudge to a referrer, end to end on in-memory SQLite with the
 * injected clock: what each credited referral schedules in the outbox, and
 * what the worker sends (or quietly does not) once the row is due.
 *
 *   1. A credit that leaves the referrer at 1 to 4, while the campaign runs,
 *      schedules one `referral_nudge` 7 days out; a newer credit replaces it,
 *      and reaching 5 cancels it.
 *   2. At delivery it is sent only while it still applies: no newer referral,
 *      not unlocked, still 1 to 4, campaign running, no nudge sent before.
 *   3. One nudge per person per campaign, even across retries and replicas.
 *   4. ES and EN; no address, no nudge; an email failure never breaks a credit.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, creditReferral, markReferralUnlocked, migrate, seed, sql, type Db } from '@quill/db';
import { SubmissionNotifier, type EmailMessage, type EmailProvider, type EmailResult } from '@quill/notifications';
import { AuthService } from './auth.service';
import { LocalAuthProvider, type ReqLike } from './auth.provider';
import { AdminCrudController } from './admin-crud.controller';
import { AdminService } from './admin.service';
import { DestinationEffects } from './destination-effects';
import { EmailEffects } from './email-effects';
import { OutboxWorker } from './outbox.worker';
import { ReferralController } from './referral.controller';
import { ReferralService, type ReferralOptions } from './referral.service';

const DAY = 24 * 3_600_000;
const WEEK = 7 * DAY;
const T0 = Date.UTC(2026, 10, 23, 12, 0, 0);

let db: Db;
let acme: string;
let auth: AuthService;
let clock: number;

const options = (extra: Partial<ReferralOptions> = {}): ReferralOptions => ({
  enabled: true,
  baseUrl: 'https://landing.example.test',
  now: () => clock,
  ...extra,
});

const as = (accountId: string, memberId: string): ReqLike => ({
  headers: { 'x-quill-account': accountId, 'x-quill-member': memberId },
});

class Capture implements EmailProvider {
  readonly name = 'capture';
  sent: EmailMessage[] = [];
  /** Nudge sends to fail before the provider starts accepting them. */
  failures = 0;
  async send(message: EmailMessage): Promise<EmailResult> {
    if (this.failures > 0 && isNudge(message)) {
      this.failures -= 1;
      throw new Error('smtp down');
    }
    this.sent.push(message);
    return { delivered: true, driver: 'http' };
  }
}

const isNudge = (m: EmailMessage) => m.idempotencyKey?.endsWith(':nudge') ?? false;

async function addAccount(name: string): Promise<string> {
  const id = randomUUID();
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at) VALUES (${id}, ${`${name}-${id.slice(0, 6)}`}, ${name}, ${clock})`,
  );
  return id;
}

async function addMember(
  accountId: string,
  email: string | null,
  opts: { externalId: string; role?: 'owner' | 'member'; createdAt?: number; displayName?: string; locale?: string | null },
): Promise<string> {
  const id = randomUUID();
  await db.run(
    sql`INSERT INTO member (id, account_id, email, role, status, external_id, display_name, locale, created_at)
        VALUES (${id}, ${accountId}, ${email}, ${opts.role ?? 'owner'}, 'active', ${opts.externalId},
          ${opts.displayName ?? null}, ${opts.locale ?? null}, ${opts.createdAt ?? clock})`,
  );
  return id;
}

function wire(opts: ReferralOptions = options()) {
  const capture = new Capture();
  const emails = new EmailEffects(new SubmissionNotifier(capture), db, undefined, undefined, undefined, opts);
  const referrals = new ReferralService(db, opts, undefined, emails);
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
  const env = { OUTBOX_WORKER_ENABLED: false, OUTBOX_POLL_MS: 5000, NODE_ENV: 'test' } as never;
  const worker = new OutboxWorker(db, env, emails, new DestinationEffects(db));
  return { capture, emails, referrals, crud, worker, claim: new ReferralController(auth, referrals) };
}

type App = ReturnType<typeof wire>;

/** Ana owns acme and has a link. */
async function ana(app: App, opts: { email?: string | null; locale?: string | null } = {}) {
  const member = await addMember(acme, opts.email === undefined ? 'ana@example.com' : opts.email, {
    externalId: 'user_ana',
    createdAt: T0 - 90 * DAY,
    displayName: 'Ana Gómez',
    locale: opts.locale ?? null,
  });
  const me = (await app.crud.me(as(acme, member))) as { referral: { link: string } };
  const code = new URL(me.referral.link).searchParams.get('ref')!;
  return { member, code, link: me.referral.link };
}

/** One new person signing up through a code at the current clock. */
async function signUp(app: App, code: string, name: string): Promise<void> {
  const account = await addAccount(`ws-${name}`);
  const member = await addMember(account, `invitee-${name.toLowerCase()}@example.com`, {
    externalId: `user_${name}`,
    displayName: name,
  });
  expect((await app.claim.claim(as(account, member), { code })).credited).toBe(true);
}

interface NudgeRow {
  status: string;
  dueAt: number;
  payload: { count: number; goal: number; to: string };
}

const nudges = async (status = 'pending'): Promise<NudgeRow[]> =>
  (
    await db.all<{ status: string; next_attempt_at: number | string; payload: string }>(
      sql`SELECT status, next_attempt_at, payload FROM outbox
          WHERE kind = 'email' AND action = 'referral_nudge' AND status = ${status}
          ORDER BY created_at, rowid`,
    )
  ).map((r) => ({ status: r.status, dueAt: Number(r.next_attempt_at), payload: JSON.parse(r.payload) }));

/** Run the worker at `at` and return the nudges it sent. */
async function drainAt(app: App, at: number): Promise<EmailMessage[]> {
  clock = at;
  app.capture.sent = [];
  await app.worker.drainOnce(at);
  return app.capture.sent.filter(isNudge);
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

describe('scheduling', () => {
  it('a credit at 1 to 4 schedules one nudge, 7 days out', async () => {
    const app = wire();
    const a = await ana(app);
    await signUp(app, a.code, 'Bea');
    const rows = await nudges();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.dueAt).toBe(T0 + WEEK);
    expect(rows[0]!.payload).toMatchObject({ count: 1, goal: 5, to: 'ana@example.com' });
  });

  it('a newer credit replaces the pending nudge', async () => {
    const app = wire();
    const a = await ana(app);
    await signUp(app, a.code, 'Bea');
    clock = T0 + 3 * DAY;
    await signUp(app, a.code, 'Carl');
    const rows = await nudges();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.dueAt).toBe(T0 + 3 * DAY + WEEK);
    expect(rows[0]!.payload.count).toBe(2);
  });

  it('reaching 5 cancels it', async () => {
    const app = wire();
    const a = await ana(app);
    for (const name of ['Bea', 'Carl', 'Dan', 'Eli', 'Fay']) await signUp(app, a.code, name);
    expect(await nudges()).toEqual([]);
    expect(await drainAt(app, T0 + 2 * WEEK)).toEqual([]);
  });

  it('nothing is scheduled once the campaign has ended', async () => {
    const app = wire(options({ campaignEndsAt: T0 - DAY }));
    const a = await ana(app);
    await signUp(app, a.code, 'Bea');
    expect(await nudges()).toEqual([]);
  });

  it('a referrer with no email address gets no nudge, and is still credited', async () => {
    const app = wire();
    const a = await ana(app, { email: null });
    await signUp(app, a.code, 'Bea');
    expect(await nudges()).toEqual([]);
    expect(await drainAt(app, T0 + 2 * WEEK)).toEqual([]);
    const me = (await app.crud.me(as(acme, a.member))) as { referral: { count: number } };
    expect(me.referral.count).toBe(1);
  });
});

describe('delivery', () => {
  it('sends once, after 7 days, in English', async () => {
    const app = wire();
    const a = await ana(app);
    await signUp(app, a.code, 'Bea');
    expect(await drainAt(app, T0 + WEEK - 1)).toEqual([]);
    const [mail, ...more] = await drainAt(app, T0 + WEEK);
    expect(more).toEqual([]);
    expect(mail!.to).toEqual(['ana@example.com']);
    expect(mail!.subject).toBe('4 to go. Your badge is still there');
    expect(mail!.text).toContain(
      "You're at 1 of 5. Send your link to someone who uses Typeform or Google Forms today and remove the “Made with dForms” badge for life.",
    );
    expect(mail!.text).toContain(`Share my link: ${a.link}`);
    expect(mail!.html).toContain('>Share my link<');
    expect(mail!.html).toContain('https://wa.me/?text=');
    expect(mail!.html).toContain('mailto:?subject=');
    expect(mail!.html).toContain('https://x.com/intent/post?text=');
    expect(`${mail!.subject}${mail!.text}${mail!.html}`).not.toMatch(/[—―]/);
    expect(await drainAt(app, T0 + 3 * WEEK)).toEqual([]);
  });

  it('writes in Spanish for a Spanish referrer', async () => {
    const app = wire();
    const a = await ana(app, { locale: 'es-CO' });
    await signUp(app, a.code, 'Bea');
    clock = T0 + DAY;
    await signUp(app, a.code, 'Carl');
    const [mail] = await drainAt(app, T0 + DAY + WEEK);
    expect(mail!.subject).toBe('Te faltan 3. Tu sello sigue ahí');
    expect(mail!.text).toContain(
      'Vas 2 de 5. Manda tu link a alguien que hoy usa Typeform o Google Forms y quita el sello «Hecho con dForms» de por vida.',
    );
    expect(mail!.text).toContain(`Compartir mi link: ${a.link}`);
    expect(mail!.html).toContain('lang="es"');
  });

  it('a newer referral that did not replace it makes it stale: nothing is sent', async () => {
    const app = wire();
    const a = await ana(app);
    await signUp(app, a.code, 'Bea');
    // Credited around the service (no reschedule), as a racing replica might.
    await creditReferral(db, { referee: 'user_racer', referrer: 'user_ana', source: 'link', now: T0, newPerson: true });
    expect(await drainAt(app, T0 + WEEK)).toEqual([]);
    expect(await nudges()).toEqual([]);
  });

  it('a person unlocked since it was scheduled is not nudged', async () => {
    const app = wire();
    const a = await ana(app);
    await signUp(app, a.code, 'Bea');
    await markReferralUnlocked(db, 'user_ana', T0 + DAY);
    expect(await drainAt(app, T0 + WEEK)).toEqual([]);
  });

  it('the campaign ending before delivery means no send', async () => {
    const app = wire(options({ campaignEndsAt: T0 + 5 * DAY }));
    const a = await ana(app);
    await signUp(app, a.code, 'Bea');
    expect(await nudges()).toHaveLength(1);
    expect(await drainAt(app, T0 + WEEK)).toEqual([]);
    expect(await nudges()).toEqual([]);
  });

  it('the program switched off before delivery means no send', async () => {
    const app = wire();
    const a = await ana(app);
    await signUp(app, a.code, 'Bea');
    const off = wire(options({ enabled: false, baseUrl: null }));
    expect(await drainAt(off, T0 + WEEK)).toEqual([]);
  });
});

describe('one nudge per person per campaign', () => {
  it('a second delivery attempt of the same row does not resend', async () => {
    const app = wire();
    const a = await ana(app);
    await signUp(app, a.code, 'Bea');
    const [row] = await db.all<{ payload: string; account_id: string }>(
      sql`SELECT payload, account_id FROM outbox WHERE action = 'referral_nudge'`,
    );
    clock = T0 + WEEK;
    app.capture.sent = [];
    await app.emails.deliver('referral_nudge', row!.payload, row!.account_id);
    await app.emails.deliver('referral_nudge', row!.payload, row!.account_id);
    expect(app.capture.sent.filter(isNudge)).toHaveLength(1);
  });

  it('two replicas delivering at once send it once', async () => {
    const app = wire();
    const a = await ana(app);
    await signUp(app, a.code, 'Bea');
    const replica = wire();
    const [row] = await db.all<{ payload: string; account_id: string }>(
      sql`SELECT payload, account_id FROM outbox WHERE action = 'referral_nudge'`,
    );
    clock = T0 + WEEK;
    app.capture.sent = [];
    await Promise.all([
      app.emails.deliver('referral_nudge', row!.payload, row!.account_id),
      replica.emails.deliver('referral_nudge', row!.payload, row!.account_id),
    ]);
    expect([...app.capture.sent, ...replica.capture.sent].filter(isNudge)).toHaveLength(1);
  });

  it('a send that failed is retried, and sent once', async () => {
    const app = wire();
    const a = await ana(app);
    await signUp(app, a.code, 'Bea');
    app.capture.failures = 1;
    expect(await drainAt(app, T0 + WEEK)).toEqual([]);
    expect(await drainAt(app, T0 + WEEK + 60_000)).toHaveLength(1);
    expect(await drainAt(app, T0 + WEEK + 120_000)).toEqual([]);
  });

  it('after a nudge went out, a later referral schedules no other', async () => {
    const app = wire();
    const a = await ana(app);
    await signUp(app, a.code, 'Bea');
    expect(await drainAt(app, T0 + WEEK)).toHaveLength(1);
    await signUp(app, a.code, 'Carl');
    expect(await nudges()).toEqual([]);
    expect(await drainAt(app, T0 + 3 * WEEK)).toEqual([]);
  });
});

describe('an email failure never breaks a credit', () => {
  it('a nudge that cannot be scheduled leaves the credit and the countdown in place', async () => {
    const app = wire();
    const a = await ana(app);
    const emails = app.emails as unknown as { enqueueReferralNudge: () => Promise<void> };
    emails.enqueueReferralNudge = async () => {
      throw new Error('boom');
    };
    await signUp(app, a.code, 'Bea');
    const me = (await app.crud.me(as(acme, a.member))) as { referral: { count: number } };
    expect(me.referral.count).toBe(1);
    const joined = await db.all(sql`SELECT id FROM outbox WHERE action = 'referral_joined'`);
    expect(joined).toHaveLength(1);
  });
});
