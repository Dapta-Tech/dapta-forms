/**
 * The five product-analytics events, asserted at their REAL call sites rather
 * than in isolation: creating a form, publishing one, a first visitor, a first
 * answer, and a signup. What matters here is not that an event can be sent —
 * `analytics-effects.spec.ts` covers that — but that each one fires exactly
 * where and as often as the funnel assumes it does.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createDb,
  migrate,
  seed,
  listOutbox,
  getFormById,
  sql,
  type Db,
  type OutboxRow,
} from '@quill/db';
import { SubmissionNotifier, LogOnlyEmailProvider } from '@quill/notifications';
import { AdminCrudController } from './admin-crud.controller';
import { AdminService } from './admin.service';
import { AuthService } from './auth.service';
import { SubmissionService } from './submission.service';
import { LocalAuthProvider, createAuthProvider, type ReqLike } from './auth.provider';
import { AnalyticsEffects } from './analytics-effects';
import { EmailEffects } from './email-effects';

let db: Db;
let controller: AdminCrudController;
let submissions: SubmissionService;
let productAnalytics: AnalyticsEffects;
let formId: string;

const asOwner = (): ReqLike => ({ headers: {} });

const ANALYTICS_ON = { PRODUCT_ANALYTICS_KEY: 'phc_test', PRODUCT_ANALYTICS_HOST: 'https://x.test' };
const LOCAL_ENV = {
  NODE_ENV: 'test',
  DEV_LOGIN_EMAIL: undefined,
  AUTH_LOCAL_STRICT: undefined,
  SEED_DEMO_FORM: false,
} as never;

/** Same env, cast once so the provider factory's ServerEnv shape is satisfied. */
const LOCAL_WITH_PROVIDER = { ...(LOCAL_ENV as object), AUTH_PROVIDER: 'local' } as never;

/** Every captured event, newest last, as {event, props}. */
async function captured(): Promise<{ event: string; props: Record<string, unknown> }[]> {
  const rows: OutboxRow[] = await listOutbox(db, { kind: 'analytics' });
  return rows.map((r) => {
    const p = JSON.parse(String(r.payload)) as {
      event: string;
      properties?: Record<string, unknown>;
    };
    return { event: p.event, props: p.properties ?? {} };
  });
}

const names = async () => (await captured()).map((c) => c.event);

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db); // account "acme" + demo form "lead-qualifier"
  productAnalytics = new AnalyticsEffects(db, ANALYTICS_ON as never);
  const auth = new AuthService(db, new LocalAuthProvider(db, LOCAL_ENV));
  controller = new AdminCrudController(
    db,
    auth,
    new AdminService(db),
    {} as never,
    {} as never,
    undefined,
    productAnalytics,
  );
  submissions = new SubmissionService(
    db,
    new EmailEffects(new SubmissionNotifier(new LogOnlyEmailProvider()), db),
    undefined,
    undefined,
    productAnalytics,
  );
  formId = (await db.get<{ id: string }>(
    sql`SELECT id FROM form WHERE slug = 'lead-qualifier' LIMIT 1`,
  ))!.id;
});

afterEach(async () => {
  await db.close();
});

describe('forms_form_created', () => {
  it('fires on create and records the author from the PRINCIPAL', async () => {
    const created = await controller.createForm(asOwner(), { name: 'New form' });

    expect(await names()).toContain('forms_form_created');

    // Authorship comes from the resolved session, never the request body — a
    // caller-supplied member id would let anyone forge who made a form.
    const row = await getFormById(db, created.accountId, created.id);
    const me = await controller.me(asOwner());
    expect(row!.createdBy).toBe(me!.memberId);
  });

  it('ignores a member id smuggled in through the body', async () => {
    const created = await controller.createForm(asOwner(), {
      name: 'Forged',
      createdBy: 'someone-else',
    } as never);
    const row = await getFormById(db, created.accountId, created.id);
    expect(row!.createdBy).not.toBe('someone-else');
  });
});

describe('forms_form_published', () => {
  it('marks the FIRST publish, and only the first', async () => {
    await controller.updateForm(asOwner(), formId, { config: { version: 1, steps: [] } });
    await controller.publishForm(asOwner(), formId);

    await controller.updateForm(asOwner(), formId, { config: { version: 1, steps: [] } });
    await controller.publishForm(asOwner(), formId);

    const publishes = (await captured()).filter((c) => c.event === 'forms_form_published');
    expect(publishes).toHaveLength(2);
    // Both publishes are real events, but only one is a CONVERSION. Republishing
    // must not read as a new account reaching the stage.
    expect(publishes.map((p) => p.props.is_first_publish)).toEqual([true, false]);
  });
});

describe('forms_activation — the north star', () => {
  async function answer(sessionId: string) {
    return submissions.submit('acme', 'lead-qualifier', {
      sessionId,
      data: { work_email: `${sessionId}@example.com` },
      partial: false,
    } as never);
  }

  it('fires exactly ONCE per account, no matter how many answers arrive', async () => {
    await answer('s1');
    await answer('s2');
    await answer('s3');

    const activations = (await names()).filter((n) => n === 'forms_activation');
    // The whole point of the DB-side dedup: an account that succeeds a thousand
    // times must not look like a thousand activations.
    expect(activations).toHaveLength(1);
  });

  it('does not fire on a partial — starting and leaving is not an answer', async () => {
    await submissions.submit('acme', 'lead-qualifier', {
      sessionId: 'partial-1',
      data: {},
      partial: true,
    } as never);
    expect(await names()).not.toContain('forms_activation');
  });

  it('is attributed to the account OWNER, never the respondent', async () => {
    await answer('s1');
    const rows = await listOutbox(db, { kind: 'analytics' });
    const activation = rows.find((r) => r.action === 'forms_activation')!;
    const payload = JSON.parse(String(activation.payload)) as { distinctId: string };

    const owner = await db.get<{ email: string }>(
      sql`SELECT email FROM member WHERE role = 'owner' LIMIT 1`,
    );
    // The respondent answered from their own browser and is NOT a user of this
    // product; capturing them would both pollute our funnels and quietly
    // harvest a form owner's audience.
    expect(payload.distinctId).toBe(owner!.email);
    expect(payload.distinctId).not.toContain('s1@example.com');
  });
});

describe('forms_form_first_view', () => {
  const view = (sessionId: string) =>
    submissions.event('acme', 'lead-qualifier', { sessionId, type: 'view' });

  it('fires once for the account, then never again', async () => {
    await view('v1');
    await view('v2');
    await view('v3');

    expect((await names()).filter((n) => n === 'forms_form_first_view')).toHaveLength(1);
  });

  it('does not fire for a non-view funnel event', async () => {
    await submissions.event('acme', 'lead-qualifier', { sessionId: 'v1', type: 'start' });
    expect(await names()).not.toContain('forms_form_first_view');
  });
});

describe('forms_signup_completed', () => {
  it('fires when a login JIT-creates a member, and not on later logins', async () => {
    const provider = createAuthProvider(
      LOCAL_WITH_PROVIDER,
      db,
      (signup) => {
        if (!signup.email) return;
        void productAnalytics.capture('signup_completed', {
          distinctId: signup.email,
          accountId: signup.accountId,
          properties: { role: signup.role, is_first_member: signup.isFirstMember },
        });
      },
    );
    const asNewUser = (): ReqLike => ({ headers: { 'x-quill-email': 'brand-new@example.com' } });

    await provider.resolveHost(asNewUser());
    await provider.resolveHost(asNewUser());
    await provider.resolveHost(asNewUser());

    const signups = (await captured()).filter((c) => c.event === 'forms_signup_completed');
    // There is no signup endpoint — accounts are materialized on first login —
    // so "did this person just join" is only true on the JIT path. Counting
    // every login would make signups equal sessions.
    expect(signups).toHaveLength(1);
    expect(signups[0]!.props.is_first_member).toBe(true);
    expect(signups[0]!.props.role).toBe('owner');
  });

  it('never fails a login when the observer throws', async () => {
    const provider = createAuthProvider(LOCAL_WITH_PROVIDER, db, () => {
      throw new Error('analytics is broken');
    });
    // A real person must not be locked out because telemetry failed.
    await expect(
      provider.resolveHost({ headers: { 'x-quill-email': 'resilient@example.com' } }),
    ).resolves.toMatchObject({ accountId: expect.any(String) });
  });
});

describe('analytics OFF (the bare-fork default)', () => {
  it('emits nothing from any call site', async () => {
    const off = new AnalyticsEffects(db, { PRODUCT_ANALYTICS_KEY: undefined } as never);
    const auth = new AuthService(db, new LocalAuthProvider(db, LOCAL_ENV));
    const c = new AdminCrudController(
      db,
      auth,
      new AdminService(db),
      {} as never,
      {} as never,
      undefined,
      off,
    );
    const s = new SubmissionService(
      db,
      new EmailEffects(new SubmissionNotifier(new LogOnlyEmailProvider()), db),
      undefined,
      undefined,
      off,
    );

    await c.createForm(asOwner(), { name: 'Quiet' });
    await s.event('acme', 'lead-qualifier', { sessionId: 'v1', type: 'view' });
    await s.submit('acme', 'lead-qualifier', {
      sessionId: 's1',
      data: { work_email: 'a@b.com' },
      partial: false,
    } as never);

    expect(await listOutbox(db, { kind: 'analytics' })).toHaveLength(0);
  });
});
