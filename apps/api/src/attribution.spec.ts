/**
 * The "Made with dForms" attribution switch, end to end on in-memory SQLite:
 *
 *   1. `GET / PUT /v1/account/attribution-badge`: every member reads it, only
 *      owners and admins write it, a non-boolean body is a 400, and in locked
 *      mode turning it OFF without a fresh paid verdict is a 403 with a stable
 *      code that stores nothing. Turning it back ON never needs a verdict, and
 *      a lapse keeps the choice.
 *   2. Every surface reads the same answer: the public form payload, the
 *      public link page payload, `/v1/me`, and the two submission emails
 *      (decided at send time).
 *   3. The mode: unset is locked with the identity service, open without.
 *   4. `attribution_hidden_toggled` fires on a real change only.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { cacheDaptaPaid, createDb, getAttributionSwitch, migrate, seed, sql, type Db } from '@quill/db';
import { attributionPremiumMode, vanityPremiumMode, type ServerEnv } from '@quill/config/env';
import { ATTRIBUTION_VERDICT_MAX_AGE_MS, type PremiumMode } from '@quill/shared';
import {
  LogOnlyEmailProvider,
  SubmissionNotifier,
  type EmailMessage,
  type EmailProvider,
  type EmailResult,
} from '@quill/notifications';
import { AuthService } from './auth.service';
import { LocalAuthProvider, type ReqLike } from './auth.provider';
import { AnalyticsEffects } from './analytics-effects';
import { AttributionController } from './attribution.controller';
import { AttributionService, DAPTA_SUBSCRIPTION_REQUIRED } from './attribution.service';
import { AdminCrudController } from './admin-crud.controller';
import { AdminService } from './admin.service';
import { EmailEffects } from './email-effects';
import { LinkPageService } from './link-page.service';
import { SubmissionService } from './submission.service';

let db: Db;
let accountId: string;
let auth: AuthService;

const asOwner = (): ReqLike => ({ headers: {} });
const asEmail = (email: string): ReqLike => ({ headers: { 'x-quill-email': email } });
const ANALYTICS_ON = { PRODUCT_ANALYTICS_KEY: 'phc_test' } as ServerEnv;

async function addMember(email: string, role: 'admin' | 'member'): Promise<void> {
  await db.run(
    sql`INSERT INTO member (id, account_id, email, role, status, created_at)
        VALUES (${randomUUID()}, ${accountId}, ${email}, ${role}, ${'active'}, ${Date.now()})`,
  );
}

function wire(mode: PremiumMode) {
  const analytics = new AnalyticsEffects(db, ANALYTICS_ON);
  const service = new AttributionService(db, mode, analytics);
  return { service, controller: new AttributionController(auth, service) };
}

async function failure(p: Promise<unknown>): Promise<{ status: number; body: unknown }> {
  try {
    await p;
  } catch (err) {
    if (err instanceof HttpException) return { status: err.getStatus(), body: err.getResponse() };
    throw err;
  }
  throw new Error('expected the call to fail');
}

const toggles = async () =>
  (await db.all<{ payload: string }>(sql`SELECT payload FROM outbox WHERE kind = 'analytics'`))
    .map((r) => JSON.parse(r.payload) as { event: string; properties?: Record<string, unknown> })
    .filter((e) => e.event === 'forms_attribution_hidden_toggled');

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db); // account "acme" + owner alex@example.com + form "lead-qualifier"
  accountId = (await db.get<{ id: string }>(sql`SELECT id FROM account WHERE code = 'acme' LIMIT 1`))!.id;
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

describe('GET / PUT /v1/account/attribution-badge', () => {
  it('reads the default: showing, not hidden', async () => {
    const { controller } = wire('locked');
    expect(await controller.status(asOwner())).toEqual({ hideAttribution: false, canHide: false, showing: true });
    expect(await wire('open').controller.status(asOwner())).toEqual({ hideAttribution: false, canHide: true, showing: true });
  });

  it('locked, not paid: turning it off is a 403 with a stable code, and nothing is stored', async () => {
    const { controller } = wire('locked');
    const out = await failure(controller.set(asOwner(), { hideAttribution: true }));
    expect(out.status).toBe(403);
    expect(out.body).toMatchObject({ error: DAPTA_SUBSCRIPTION_REQUIRED });
    expect((await getAttributionSwitch(db, accountId))!.hideAttribution).toBe(false);
    // A verdict that reads not paid is the same refusal.
    await cacheDaptaPaid(db, accountId, false);
    expect((await failure(controller.set(asOwner(), { hideAttribution: true }))).status).toBe(403);
  });

  it('locked, paid: an owner turns it off and the surfaces stop showing it', async () => {
    const { controller } = wire('locked');
    await cacheDaptaPaid(db, accountId, true);
    expect(await controller.set(asOwner(), { hideAttribution: true })).toEqual({
      hideAttribution: true,
      canHide: true,
      showing: false,
    });
  });

  it('locked, a paid verdict older than the max age counts as not paid', async () => {
    const { controller, service } = wire('locked');
    await cacheDaptaPaid(db, accountId, true, Date.now() - ATTRIBUTION_VERDICT_MAX_AGE_MS - 1000);
    expect((await failure(controller.set(asOwner(), { hideAttribution: true }))).status).toBe(403);
    // And one that went stale after it was turned off shows it again.
    await cacheDaptaPaid(db, accountId, true);
    await controller.set(asOwner(), { hideAttribution: true });
    service.now = () => Date.now() + ATTRIBUTION_VERDICT_MAX_AGE_MS + 1000;
    expect(await controller.status(asOwner())).toEqual({ hideAttribution: true, canHide: false, showing: true });
  });

  it('a lapse keeps the choice, shows the attribution again, and turning it back on needs nothing', async () => {
    const { controller } = wire('locked');
    await cacheDaptaPaid(db, accountId, true);
    await controller.set(asOwner(), { hideAttribution: true });
    await cacheDaptaPaid(db, accountId, false);
    expect(await controller.status(asOwner())).toEqual({ hideAttribution: true, canHide: false, showing: true });
    expect(await controller.set(asOwner(), { hideAttribution: false })).toEqual({
      hideAttribution: false,
      canHide: false,
      showing: true,
    });
  });

  it('open mode: any workspace hides it, with no verdict at all', async () => {
    const { controller } = wire('open');
    expect(await controller.set(asOwner(), { hideAttribution: true })).toEqual({
      hideAttribution: true,
      canHide: true,
      showing: false,
    });
  });

  it('a body without a boolean is a 400', async () => {
    const { controller } = wire('open');
    for (const body of [{}, { hideAttribution: 'true' }, { hideAttribution: 1 }, { hideAttribution: null }, null]) {
      const out = await failure(controller.set(asOwner(), body as never));
      expect(out.status).toBe(400);
    }
    expect((await getAttributionSwitch(db, accountId))!.hideAttribution).toBe(false);
  });

  it('a member reads it and cannot change it; an admin can', async () => {
    await addMember('member@acme.test', 'member');
    await addMember('admin@acme.test', 'admin');
    const { controller } = wire('open');
    expect(await controller.status(asEmail('member@acme.test'))).toMatchObject({ hideAttribution: false });
    const out = await failure(controller.set(asEmail('member@acme.test'), { hideAttribution: true }));
    expect(out.status).toBe(403);
    expect(out.body).toMatchObject({ error: 'FORBIDDEN' });
    expect(await controller.set(asEmail('admin@acme.test'), { hideAttribution: true })).toMatchObject({
      hideAttribution: true,
    });
  });

  it('records attribution_hidden_toggled on a real change only', async () => {
    const { controller } = wire('open');
    await controller.set(asOwner(), { hideAttribution: false }); // no change
    expect(await toggles()).toHaveLength(0);
    await controller.set(asOwner(), { hideAttribution: true });
    await controller.set(asOwner(), { hideAttribution: true }); // no change
    await controller.set(asOwner(), { hideAttribution: false });
    expect((await toggles()).map((e) => e.properties?.hidden)).toEqual([true, false]);
  });

  it('a refused save records nothing', async () => {
    const { controller } = wire('locked');
    await failure(controller.set(asOwner(), { hideAttribution: true }));
    expect(await toggles()).toHaveLength(0);
  });
});

describe('every surface reads the same answer', () => {
  async function hide(mode: PremiumMode = 'open'): Promise<AttributionService> {
    const { service } = wire(mode);
    await service.set({ accountId, memberId: 'x' }, true);
    return service;
  }

  const submissions = (attribution?: AttributionService) =>
    new SubmissionService(
      db,
      new EmailEffects(new SubmissionNotifier(new LogOnlyEmailProvider()), db),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      attribution,
    );

  it('the public form payload carries the flag', async () => {
    const { service } = wire('open');
    expect((await submissions(service).publicForm('acme', 'lead-qualifier'))!.showAttribution).toBe(true);
    await hide();
    expect((await submissions(service).publicForm('acme', 'lead-qualifier'))!.showAttribution).toBe(false);
    // Without the service (an older wiring) it reads as before: shown.
    expect((await submissions().publicForm('acme', 'lead-qualifier'))!.showAttribution).toBe(true);
  });

  it('a lapsed workspace in locked mode carries it again', async () => {
    const { service } = wire('locked');
    await cacheDaptaPaid(db, accountId, true);
    await service.set({ accountId, memberId: 'x' }, true);
    expect((await submissions(service).publicForm('acme', 'lead-qualifier'))!.showAttribution).toBe(false);
    await cacheDaptaPaid(db, accountId, false);
    expect((await submissions(service).publicForm('acme', 'lead-qualifier'))!.showAttribution).toBe(true);
  });

  it('the public link page payload carries the flag', async () => {
    await db.run(
      sql`INSERT INTO link_page (id, account_id, slug, is_default, config, created_at, updated_at)
          VALUES (${randomUUID()}, ${accountId}, ${'main'}, ${1}, ${'{"version":1,"enabled":true}'}, ${Date.now()}, ${Date.now()})`,
    );
    const { service } = wire('open');
    const pages = new LinkPageService(db, undefined, service);
    expect((await pages.publicPage('acme'))!.showAttribution).toBe(true);
    await hide();
    expect((await pages.publicPage('acme'))!.showAttribution).toBe(false);
    expect((await pages.publicPage('acme', 'main'))!.showAttribution).toBe(false);
  });

  it('/v1/me reports it for the builder', async () => {
    const { service } = wire('open');
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
      service,
    );
    const me = (await crud.me(asOwner())) as { attributionBadge: unknown; attribution: unknown };
    expect(me.attributionBadge).toEqual({ showing: true });
    // The signup's UTM record keeps its own key.
    expect(me).toHaveProperty('attribution');
    expect(me.attribution).not.toEqual({ showing: true });
    await hide();
    expect(((await crud.me(asOwner())) as { attributionBadge: unknown }).attributionBadge).toEqual({ showing: false });
  });

  describe('the submission emails, decided at send time', () => {
    class Capture implements EmailProvider {
      readonly name = 'capture';
      sent: EmailMessage[] = [];
      async send(m: EmailMessage): Promise<EmailResult> {
        this.sent.push(m);
        return { delivered: true, driver: 'http' };
      }
    }
    const cta = () => ({ question: 'Want your own form?', action: 'Create your form, free', href: 'https://example.com/signup' });

    async function deliverBoth(attribution?: AttributionService) {
      const provider = new Capture();
      const effects = new EmailEffects(new SubmissionNotifier(provider, { cta }), db, undefined, undefined, attribution);
      const payload = JSON.stringify({
        accountId,
        submissionId: 's1',
        formName: 'Lead',
        to: ['owner@acme.test'],
        respondentEmail: 'lead@acme.test',
      });
      await effects.deliver('submission_confirmed', payload);
      await effects.deliver('submission_received', payload);
      return provider.sent;
    }

    it('carry the growth button while the attribution shows', async () => {
      const { service } = wire('open');
      for (const m of await deliverBoth(service)) {
        expect(m.html).toContain('Create your form, free');
        expect(m.text).toContain('https://example.com/signup');
      }
    });

    it('omit it, button and text line, once the workspace hides it', async () => {
      const service = await hide();
      const sent = await deliverBoth(service);
      expect(sent).toHaveLength(2);
      for (const m of sent) {
        expect(m.html).not.toContain('Create your form, free');
        expect(m.text).not.toContain('https://example.com/signup');
      }
    });

    it('a row queued while hidden but delivered after a lapse carries it again', async () => {
      const { service } = wire('locked');
      await cacheDaptaPaid(db, accountId, true);
      await service.set({ accountId, memberId: 'x' }, true);
      expect((await deliverBoth(service))[0]!.html).not.toContain('Create your form, free');
      await cacheDaptaPaid(db, accountId, false);
      expect((await deliverBoth(service))[0]!.html).toContain('Create your form, free');
    });
  });
});

describe('the premium mode', () => {
  it('attribution: explicit wins; unset is locked with the identity service, open without', () => {
    expect(attributionPremiumMode({ PREMIUM_FEATURES: undefined, IAM_BASE_URL: undefined })).toBe('open');
    expect(attributionPremiumMode({ PREMIUM_FEATURES: undefined, IAM_BASE_URL: 'https://iam.example.test' })).toBe('locked');
    expect(attributionPremiumMode({ PREMIUM_FEATURES: 'open', IAM_BASE_URL: 'https://iam.example.test' })).toBe('open');
    expect(attributionPremiumMode({ PREMIUM_FEATURES: 'locked', IAM_BASE_URL: undefined })).toBe('locked');
  });

  it('vanity: unset stays open, as it always was', () => {
    expect(vanityPremiumMode({ PREMIUM_FEATURES: undefined })).toBe('open');
    expect(vanityPremiumMode({ PREMIUM_FEATURES: 'locked' })).toBe('locked');
  });
});
