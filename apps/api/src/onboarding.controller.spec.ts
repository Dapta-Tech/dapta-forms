/**
 * The onboarding endpoints at their real call sites: the progress PATCH, the
 * completion POST, the gate `/v1/me` reports, and the mutual exclusion with the
 * demo-form seed.
 *
 * The things worth pinning here are the ones a unit test of the repository
 * cannot see — that the feature is inert with the flag off, that the account id
 * comes from the principal and never the body, that a double-submit produces one
 * form rather than two, and that a member cannot rewrite the owner's answers.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import {
  createDb,
  migrate,
  getAccountOnboarding,
  listOutbox,
  sql,
  type Db,
  type OutboxRow,
} from '@quill/db';
import { AdminCrudController } from './admin-crud.controller';
import { AdminService } from './admin.service';
import { AuthService } from './auth.service';
import { LocalAuthProvider, maybeSeedDemoForm, type ReqLike } from './auth.provider';
import { AnalyticsEffects } from './analytics-effects';
import { Logger } from '@nestjs/common';

let db: Db;
let accountId: string;
let ownerId: string;
let memberId: string;

const asOwner = (): ReqLike => ({ headers: { 'x-quill-account': accountId, 'x-quill-member': ownerId } });
const asMember = (): ReqLike => ({ headers: { 'x-quill-account': accountId, 'x-quill-member': memberId } });

const LOCAL_ENV = {
  NODE_ENV: 'test',
  DEV_LOGIN_EMAIL: undefined,
  AUTH_LOCAL_STRICT: undefined,
  SEED_DEMO_FORM: false,
  ONBOARDING_WIZARD: false,
} as never;

const ANALYTICS_ON = { PRODUCT_ANALYTICS_KEY: 'phc_test', PRODUCT_ANALYTICS_HOST: 'https://x.test' };

/**
 * A controller wired with the wizard on or off. `onboardingEnabled` is the
 * fourth AdminService argument, which is exactly the switch under test.
 */
function controllerWith(enabled: boolean, productAnalytics?: AnalyticsEffects) {
  const auth = new AuthService(db, new LocalAuthProvider(db, LOCAL_ENV));
  return new AdminCrudController(
    db,
    auth,
    new AdminService(db, undefined, undefined, enabled),
    {} as never,
    {} as never,
    undefined,
    productAnalytics,
  );
}

async function formCount(): Promise<number> {
  const row = await db.get<{ n: number }>(
    sql`SELECT COUNT(*) AS n FROM form WHERE account_id = ${accountId}`,
  );
  return Number(row?.n ?? 0);
}

async function capturedEvents(): Promise<string[]> {
  const rows: OutboxRow[] = await listOutbox(db, { kind: 'analytics' });
  return rows.map((r) => (JSON.parse(String(r.payload)) as { event: string }).event);
}

/** The same rows, with their properties — for assertions about what was sent. */
async function capturedPayloads(): Promise<
  { event: string; properties?: Record<string, unknown> }[]
> {
  const rows: OutboxRow[] = await listOutbox(db, { kind: 'analytics' });
  return rows.map(
    (r) => JSON.parse(String(r.payload)) as { event: string; properties?: Record<string, unknown> },
  );
}

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  accountId = 'acc_onb';
  ownerId = 'mem_owner';
  memberId = 'mem_plain';
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at) VALUES (${accountId}, ${'onb'}, ${'Onb'}, 1000)`,
  );
  await db.run(
    sql`INSERT INTO member (id, account_id, email, role, status, created_at)
        VALUES (${ownerId}, ${accountId}, ${'owner@test.local'}, ${'owner'}, ${'active'}, 1000)`,
  );
  await db.run(
    sql`INSERT INTO member (id, account_id, email, role, status, created_at)
        VALUES (${memberId}, ${accountId}, ${'member@test.local'}, ${'member'}, ${'active'}, 1000)`,
  );
});

afterEach(async () => {
  await db.close();
});

describe('/v1/me — the dashboard gate', () => {
  it('never requires onboarding while the flag is OFF', async () => {
    // The whole feature has to be inert by default: a deployment that has not
    // opted in must not start bouncing people into a wizard.
    const me = await controllerWith(false).me(asOwner());
    expect(me?.onboardingRequired).toBe(false);
  });

  it('requires it for a brand-new account when the flag is ON', async () => {
    const me = await controllerWith(true).me(asOwner());
    expect(me?.onboardingRequired).toBe(true);
    expect(me?.onboardingCompletedAt).toBeNull();
  });

  it('stops requiring it once the wizard is finished', async () => {
    const c = controllerWith(true);
    await c.completeOnboarding(asOwner(), { template: 'blank' });
    const me = await c.me(asOwner());
    expect(me?.onboardingRequired).toBe(false);
    expect(me?.onboardingCompletedAt).toBeGreaterThan(0);
  });

  it('does not require it for an account that PREDATES the wizard', async () => {
    // Migration 0011 backfills these, which is what keeps existing users out of
    // a wizard they never asked for. Modelled by the stamped column.
    await db.run(sql`UPDATE account SET onboarding_completed_at = 500 WHERE id = ${accountId}`);
    const me = await controllerWith(true).me(asOwner());
    expect(me?.onboardingRequired).toBe(false);
  });

  /**
   * The lockout. The gate is account-scoped, the endpoints are admin-scoped, and
   * nothing used to reconcile the two.
   *
   * A colleague joining an org whose owner abandoned the wizard was sent to
   * `/onboarding` by the dashboard layout, had every PATCH silently 403'd, had
   * the completion 403'd outright, and was bounced back to `/onboarding` by the
   * same gate when the action fell through to `/admin`. The wizard renders no
   * sidebar and no sign-out, so that loop had no exit at all.
   */
  it('does NOT require it of a plain member — they cannot complete it', async () => {
    const me = await controllerWith(true).me(asMember());
    expect(me?.onboardingRequired).toBe(false);
    // Still genuinely un-onboarded — the account state is unchanged, only who is
    // asked to fix it.
    expect(me?.onboardingCompletedAt).toBeNull();
  });

  it('still requires it of the owner of that same un-onboarded account', async () => {
    const c = controllerWith(true);
    expect((await c.me(asMember()))?.onboardingRequired).toBe(false);
    expect((await c.me(asOwner()))?.onboardingRequired).toBe(true);
  });
});

describe('PATCH /v1/account/onboarding', () => {
  it('stores the answer and reports it back', async () => {
    const res = await controllerWith(true).saveOnboarding(asOwner(), {
      role: 'founder',
      lastStep: 'role',
    });
    expect(res.saved).toBe(true);
    expect(res.onboarding).toMatchObject({ version: 1, role: 'founder', lastStep: 'role' });
  });

  it('writes nothing while the flag is OFF', async () => {
    const res = await controllerWith(false).saveOnboarding(asOwner(), {
      role: 'founder',
      lastStep: 'role',
    });
    expect(res.saved).toBe(false);
    expect((await getAccountOnboarding(db, accountId))?.onboarding).toBeNull();
  });

  it('scopes the write to the PRINCIPAL, ignoring an account id in the body', async () => {
    // Anyone can craft a body; letting it name an account would let a stranger
    // overwrite someone else's onboarding.
    const other = 'acc_other';
    await db.run(
      sql`INSERT INTO account (id, code, name, created_at) VALUES (${other}, ${'oth'}, ${'Oth'}, 1000)`,
    );
    await controllerWith(true).saveOnboarding(asOwner(), {
      accountId: other,
      role: 'sales',
      lastStep: 'role',
    } as never);
    expect((await getAccountOnboarding(db, other))?.onboarding).toBeNull();
    expect((await getAccountOnboarding(db, accountId))?.onboarding).toMatchObject({ role: 'sales' });
  });

  it('rejects a plain member — onboarding describes the WORKSPACE', async () => {
    await expect(
      controllerWith(true).saveOnboarding(asMember(), { role: 'sales', lastStep: 'role' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not throw on a junk body — a 400 behind an unskippable wizard is a dead end', async () => {
    const res = await controllerWith(true).saveOnboarding(asOwner(), { role: 'astronaut' });
    expect(res.saved).toBe(false);
  });

  it('strips an enum value the product does not offer', async () => {
    // The body is client-supplied, so the schema is the only thing keeping a
    // made-up role out of the column the funnel groups by.
    const res = await controllerWith(true).saveOnboarding(asOwner(), {
      role: 'sales',
      industry: 'not-a-real-industry',
      lastStep: 'industry',
    });
    expect(res.saved).toBe(false);
    expect((await getAccountOnboarding(db, accountId))?.onboarding).toBeNull();
  });
});

describe('POST /v1/account/onboarding/complete', () => {
  it('creates the first form from the chosen template', async () => {
    const res = await controllerWith(true).completeOnboarding(asOwner(), {
      template: 'lead-qualifier',
    });
    expect(res.completed).toBe(true);
    expect(res.formId).toBeTruthy();

    const form = await db.get<{ name: string; config: unknown }>(
      sql`SELECT name, config FROM form WHERE id = ${res.formId!}`,
    );
    expect(form?.name).toBe('Lead qualifier');
    // The config comes from the server-side registry, never the request body.
    expect(JSON.stringify(form?.config)).toContain('team_size');
  });

  it('records the AUTHOR from the principal', async () => {
    const res = await controllerWith(true).completeOnboarding(asOwner(), { template: 'blank' });
    const row = await db.get<{ created_by: string | null }>(
      sql`SELECT created_by FROM form WHERE id = ${res.formId!}`,
    );
    expect(row?.created_by).toBe(ownerId);
  });

  it('leaves `blank` as an empty form, matching the dashboard default', async () => {
    const res = await controllerWith(true).completeOnboarding(asOwner(), { template: 'blank' });
    const form = await db.get<{ config: unknown }>(
      sql`SELECT config FROM form WHERE id = ${res.formId!}`,
    );
    expect(JSON.parse(String(form?.config)).steps).toEqual([]);
  });

  it('a SECOND call creates no second form and points at the first', async () => {
    // A double-click must not leave the account with two "first" forms.
    const c = controllerWith(true);
    const first = await c.completeOnboarding(asOwner(), { template: 'lead-qualifier' });
    const second = await c.completeOnboarding(asOwner(), { template: 'application' });

    expect(second.completed).toBe(false);
    expect(second.formId).toBe(first.formId);
    expect(await formCount()).toBe(1);
  });

  it('a second call does not overwrite the recorded template', async () => {
    const c = controllerWith(true);
    await c.completeOnboarding(asOwner(), { template: 'lead-qualifier' });
    await c.completeOnboarding(asOwner(), { template: 'application' });
    expect((await getAccountOnboarding(db, accountId))?.onboarding?.template).toBe('lead-qualifier');
  });

  it('rejects an unknown template rather than quietly building a different form', async () => {
    await expect(
      controllerWith(true).completeOnboarding(asOwner(), { template: 'nope' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await formCount()).toBe(0);
  });

  it('rejects a prototype-chain key smuggled in as a template', async () => {
    await expect(
      controllerWith(true).completeOnboarding(asOwner(), { template: 'constructor' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a plain member', async () => {
    await expect(
      controllerWith(true).completeOnboarding(asMember(), { template: 'blank' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('creates nothing while the flag is OFF', async () => {
    const res = await controllerWith(false).completeOnboarding(asOwner(), { template: 'blank' });
    expect(res).toEqual({ completed: false, formId: null });
    expect(await formCount()).toBe(0);
  });

  it('emits forms_onboarding_completed exactly once', async () => {
    const analytics = new AnalyticsEffects(db, ANALYTICS_ON as never);
    const c = controllerWith(true, analytics);
    await c.completeOnboarding(asOwner(), { template: 'customer-feedback' });
    await c.completeOnboarding(asOwner(), { template: 'blank' });

    const events = (await capturedEvents()).filter((e) => e === 'forms_onboarding_completed');
    expect(events).toHaveLength(1);
  });

  // The activation funnel's second stage. The wizard creates a form without
  // going through `createForm`/`duplicateForm`, the only two other emitters, so
  // without this the whole wizard cohort reads as "never made a form" — and
  // because the funnel is ordered, every stage after it becomes unreachable too.
  it('emits forms_form_created so the wizard cohort enters the activation funnel', async () => {
    const analytics = new AnalyticsEffects(db, ANALYTICS_ON as never);
    const c = controllerWith(true, analytics);
    const res = await c.completeOnboarding(asOwner(), { template: 'lead-qualifier' });

    const created = (await capturedPayloads()).filter((e) => e.event === 'forms_form_created');
    expect(created).toHaveLength(1);
    // The id must be the form the wizard actually built, not just any truthy
    // value: a funnel stage pointing at a form that does not exist is worse
    // than a missing one.
    expect(created[0]?.properties).toMatchObject({
      form_id: res.formId,
      from_onboarding: true,
      template: 'lead-qualifier',
    });
  });

  it('does not re-announce the form when a second claim loses', async () => {
    const analytics = new AnalyticsEffects(db, ANALYTICS_ON as never);
    const c = controllerWith(true, analytics);
    await c.completeOnboarding(asOwner(), { template: 'blank' });
    await c.completeOnboarding(asOwner(), { template: 'blank' });

    const created = (await capturedEvents()).filter((e) => e === 'forms_form_created');
    expect(created).toHaveLength(1);
  });

  it('preserves the answers gathered on the way', async () => {
    const c = controllerWith(true);
    await c.saveOnboarding(asOwner(), { role: 'marketing', lastStep: 'role' });
    await c.saveOnboarding(asOwner(), { industry: 'agency', lastStep: 'industry' });
    await c.saveOnboarding(asOwner(), { useCase: 'feedback', lastStep: 'use_case' });
    await c.completeOnboarding(asOwner(), { template: 'customer-feedback' });

    expect((await getAccountOnboarding(db, accountId))?.onboarding).toMatchObject({
      role: 'marketing',
      industry: 'agency',
      useCase: 'feedback',
      template: 'customer-feedback',
      lastStep: 'template',
    });
  });

  /**
   * The template screen arms its CTA the moment question three is answered, so
   * the completion can be sent before that answer's PATCH has landed. Carrying
   * the answers ON the completion is what makes the record independent of which
   * request wins.
   */
  it('stores answers that arrive WITH the completion, never having been PATCHed', async () => {
    const c = controllerWith(true);
    await c.completeOnboarding(asOwner(), {
      template: 'lead-qualifier',
      role: 'founder',
      industry: 'software',
      useCase: 'leads',
    });

    expect((await getAccountOnboarding(db, accountId))?.onboarding).toMatchObject({
      role: 'founder',
      industry: 'software',
      useCase: 'leads',
      template: 'lead-qualifier',
    });
  });

  it('names the form in the locale the wizard rendered its cards in', async () => {
    // The card said "Calificador de leads"; a form called "Lead qualifier" is a
    // different answer to the same click.
    const res = await controllerWith(true).completeOnboarding(asOwner(), {
      template: 'lead-qualifier',
      locale: 'es',
    });
    const form = await db.get<{ name: string }>(sql`SELECT name FROM form WHERE id = ${res.formId!}`);
    expect(form?.name).toBe('Calificador de leads');
  });

  it('falls back to the registry name when no locale is named', async () => {
    const res = await controllerWith(true).completeOnboarding(asOwner(), { template: 'blank' });
    const form = await db.get<{ name: string }>(sql`SELECT name FROM form WHERE id = ${res.formId!}`);
    expect(form?.name).toBe('Untitled form');
  });

  /**
   * The losing claim used to be handed `ORDER BY created_at ASC LIMIT 1` — the
   * account's OLDEST form. On an account that already had one, that is an
   * unrelated form, and the loser lands in it with the first-run tour armed.
   */
  it('sends a losing claim to the form the WINNER made, not the oldest one', async () => {
    // A form that predates the wizard entirely — a re-gated workspace, or a fork
    // that toggled the flag off and on.
    await db.run(
      sql`INSERT INTO form (id, account_id, name, slug, config, created_at, updated_at)
          VALUES (${'form_old'}, ${accountId}, ${'Older form'}, ${'older'},
            ${'{"version":1,"steps":[]}'}, 100, 100)`,
    );

    const c = controllerWith(true);
    const winner = await c.completeOnboarding(asOwner(), { template: 'lead-qualifier' });
    const loser = await c.completeOnboarding(asOwner(), { template: 'lead-qualifier' });

    expect(loser.completed).toBe(false);
    expect(loser.formId).toBe(winner.formId);
    expect(loser.formId).not.toBe('form_old');
  });

  it('records the created form id on the account, so the loser has something to read', async () => {
    const res = await controllerWith(true).completeOnboarding(asOwner(), { template: 'blank' });
    expect((await getAccountOnboarding(db, accountId))?.onboarding?.formId).toBe(res.formId);
  });
});

describe('the wizard and the demo seed are mutually exclusive', () => {
  const log = new Logger('test');

  it('seeds the demo form when only SEED_DEMO_FORM is on', async () => {
    await maybeSeedDemoForm(db, accountId, { SEED_DEMO_FORM: true, ONBOARDING_WIZARD: false }, log);
    expect(await formCount()).toBe(1);
  });

  it('seeds NOTHING when the wizard is on', async () => {
    // Structural, not stylistic: `seedDemoFormForAccount` only writes into an
    // account with zero forms, so a demo seeded at first login would make the
    // account non-empty and the form the person picked a template for would
    // silently never be created.
    await maybeSeedDemoForm(db, accountId, { SEED_DEMO_FORM: true, ONBOARDING_WIZARD: true }, log);
    expect(await formCount()).toBe(0);
  });

  it('lets the wizard create the first form on an account the seed skipped', async () => {
    await maybeSeedDemoForm(db, accountId, { SEED_DEMO_FORM: true, ONBOARDING_WIZARD: true }, log);
    const res = await controllerWith(true).completeOnboarding(asOwner(), { template: 'application' });
    expect(res.completed).toBe(true);
    expect(await formCount()).toBe(1);
  });
});
