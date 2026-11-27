/**
 * A signup from the resource hub, end to end on in-memory SQLite: the short
 * wizard's completion, what it sends into the Dapta estate (no empty property,
 * no partial answers to the IAM) and the playbook email it queues, once per
 * person and playbook, only for whoever founded the workspace.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createDb,
  getAccountOnboarding,
  listOutbox,
  migrate,
  sql,
  type Db,
  type OutboxRow,
} from '@quill/db';
import { SubmissionNotifier, type EmailMessage, type EmailProvider } from '@quill/notifications';
import { findPlaybook, localizedPlaybook } from '@quill/shared/playbooks';
import type { ServerEnv } from '@quill/config/env';
import { AdminCrudController } from './admin-crud.controller';
import { AdminService } from './admin.service';
import { AnalyticsEffects } from './analytics-effects';
import { LocalAuthProvider, type ReqLike } from './auth.provider';
import { AuthService } from './auth.service';
import { DaptaSyncDelivery } from './dapta-sync';
import { DaptaSyncEffects } from './dapta-sync-effects';
import { DestinationEffects } from './destination-effects';
import { EmailEffects } from './email-effects';
import { OutboxWorker } from './outbox.worker';

/** Makes the founding-member read fail, as a database blip would. */
const failing = vi.hoisted(() => ({ founding: false }));
vi.mock('@quill/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@quill/db')>();
  return {
    ...real,
    isFoundingMember: async (...args: Parameters<typeof real.isFoundingMember>) => {
      if (failing.founding) throw new Error('database is away');
      return real.isFoundingMember(...args);
    },
  };
});

const SLUG = 'formularios-que-venden-con-ia';
const OTHER_SLUG = 'hook-de-dolor';
const APP = 'https://app.example.com';

let db: Db;
let sent: EmailMessage[];

const provider: EmailProvider = {
  send: async (m) => {
    sent.push(m);
    return { delivered: true, driver: 'smtp' };
  },
};

const LOCAL_ENV = {
  NODE_ENV: 'test',
  DEV_LOGIN_EMAIL: undefined,
  AUTH_LOCAL_STRICT: undefined,
  SEED_DEMO_FORM: false,
  ONBOARDING_WIZARD: true,
} as never;

const env = (extra: Record<string, unknown> = {}) =>
  ({
    PUBLIC_APP_URL: `${APP}/`,
    DAPTA_SYNC_FLOW_URL: 'https://flows.example.com/sync',
    DAPTA_SYNC_FLOW_KEY: 'flow-key',
    IAM_BASE_URL: 'https://iam.example.com/iam',
    IAM_API_KEY: 'iam-key',
    ...extra,
  }) as unknown as ServerEnv;

function wire(serverEnv: ServerEnv = env()) {
  const email = new EmailEffects(new SubmissionNotifier(provider), db, provider, serverEnv);
  const analytics = new AnalyticsEffects(db, {
    PRODUCT_ANALYTICS_KEY: 'phc_test',
    PRODUCT_ANALYTICS_HOST: 'https://x.test',
  } as never);
  const admin = new AdminService(
    db,
    undefined,
    undefined,
    true,
    new DaptaSyncEffects(db, serverEnv),
    email,
  );
  const controller = new AdminCrudController(
    db,
    new AuthService(db, new LocalAuthProvider(db, LOCAL_ENV)),
    admin,
    {} as never,
    {} as never,
    undefined,
    analytics,
  );
  return { controller, admin, email, serverEnv };
}

async function account(id: string): Promise<void> {
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at) VALUES (${id}, ${id}, ${id}, 1000)`,
  );
}

async function member(
  id: string,
  accountId: string,
  input: { role?: string; createdAt?: number; sub?: string | null; accessGrant?: string } = {},
): Promise<void> {
  await db.run(
    sql`INSERT INTO member (id, account_id, external_id, email, role, status, created_at, access_grant)
        VALUES (${id}, ${accountId}, ${input.sub ?? null}, ${`${id}@test.local`},
                ${input.role ?? 'owner'}, ${'active'}, ${input.createdAt ?? 1000},
                ${input.accessGrant ?? null})`,
  );
}

const as = (accountId: string, memberId: string): ReqLike => ({
  headers: { 'x-quill-account': accountId, 'x-quill-member': memberId },
});

const hubBody = (extra: Record<string, unknown> = {}) => ({
  template: 'lead-qualifier',
  cohort: 'cold',
  locale: 'es',
  flow: 'hub',
  playbook: SLUG,
  leadSource: 'google_ads',
  useCase: 'leads',
  ...extra,
});

async function playbookRows(): Promise<OutboxRow[]> {
  return (await listOutbox(db, { kind: 'email' })).filter((r) => r.action === 'playbook_pdf');
}

async function events(name: string): Promise<Record<string, unknown>[]> {
  return (await listOutbox(db, { kind: 'analytics' }))
    .map((r) => JSON.parse(String(r.payload)) as { event: string; properties: Record<string, unknown> })
    .filter((e) => e.event === name)
    .map((e) => e.properties);
}

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  sent = [];
  failing.founding = false;
  await account('acc');
  await member('founder', 'acc', { sub: 'sub-1' });
});

afterEach(async () => {
  await db.close();
});

describe('the playbook email', () => {
  it.each([
    ['es', 'Tu playbook en PDF', 'Descargar el PDF'],
    ['en', 'Your playbook PDF', 'Get the PDF'],
  ] as const)('is sent in %s with a button to the playbook', async (lang, subject, button) => {
    const { controller, email } = wire();
    await controller.completeOnboarding(as('acc', 'founder'), hubBody({ locale: lang }));

    const rows = await playbookRows();
    expect(rows).toHaveLength(1);
    await email.deliver(rows[0]!.action, rows[0]!.payload!, rows[0]!.accountId);

    const title = localizedPlaybook(findPlaybook(SLUG)!, lang).playbook.title;
    const link = `${APP}/admin/playbooks/${SLUG}?lang=${lang}&pdf=1`;
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual(['founder@test.local']);
    expect(sent[0]!.subject).toBe(`${subject}: ${title}`);
    expect(sent[0]!.locale).toBe(lang);
    expect(sent[0]!.text).toContain(`${button}: ${link}`);
    expect(sent[0]!.html).toContain(`href="${link.replace('&', '&amp;')}"`);
    expect(sent[0]!.attachments).toBeUndefined();
    expect(sent[0]!.idempotencyKey).toBe(`playbook:sub-1:${SLUG}:pdf`);
  });

  it('prefers the language the hub link asked for over the wizard language', async () => {
    const { controller } = wire();
    await controller.completeOnboarding(
      as('acc', 'founder'),
      hubBody({ locale: 'es', playbookLocale: 'en' }),
    );
    const payload = JSON.parse((await playbookRows())[0]!.payload!) as { locale: string; link: string };
    expect(payload.locale).toBe('en');
    expect(payload.link).toContain('?lang=en&pdf=1');
  });

  it('goes out through the outbox worker', async () => {
    const { controller, email, serverEnv } = wire();
    await controller.completeOnboarding(as('acc', 'founder'), hubBody());
    const worker = new OutboxWorker(
      db,
      { ...serverEnv, OUTBOX_WORKER_ENABLED: false, OUTBOX_POLL_MS: 5000, NODE_ENV: 'test' } as never,
      email,
      new DestinationEffects(db),
    );
    await worker.drainOnce();
    expect(sent).toHaveLength(1);
    expect((await playbookRows())[0]!.status).toBe('done');
  });

  it('is queued once for a double submit', async () => {
    const { controller } = wire();
    await Promise.all([
      controller.completeOnboarding(as('acc', 'founder'), hubBody()),
      controller.completeOnboarding(as('acc', 'founder'), hubBody()),
    ]);
    expect(await playbookRows()).toHaveLength(1);
  });

  it('is queued once per person and playbook, across workspaces and after it was sent', async () => {
    const { email } = wire();
    await account('second');
    await member('founder2', 'second', { sub: 'sub-1' });
    await email.enqueuePlaybookPdf({ accountId: 'acc', memberId: 'founder', slug: SLUG, locale: 'es' });
    await db.run(sql`UPDATE outbox SET status = 'done' WHERE action = 'playbook_pdf'`);
    await email.enqueuePlaybookPdf({ accountId: 'second', memberId: 'founder2', slug: SLUG, locale: 'en' });
    expect(await playbookRows()).toHaveLength(1);

    // Another playbook is another email.
    await email.enqueuePlaybookPdf({ accountId: 'second', memberId: 'founder2', slug: OTHER_SLUG });
    expect(await playbookRows()).toHaveLength(2);
  });

  it('is not queued for a signup that did not come from the hub', async () => {
    const { controller } = wire();
    await controller.completeOnboarding(as('acc', 'founder'), { template: 'blank', locale: 'es' });
    expect(await playbookRows()).toHaveLength(0);
  });

  it('is not queued for an invited teammate who finishes the wizard', async () => {
    // Joined a workspace someone else founded, as admin: allowed to answer, not a founder.
    await member('invited', 'acc', { role: 'admin', createdAt: 2000 });
    const { controller } = wire();
    const res = await controller.completeOnboarding(as('acc', 'invited'), hubBody());
    expect(res.completed).toBe(true);
    expect(await playbookRows()).toHaveLength(0);
  });

  it('is not queued for a later owner, or for the admin of a workspace they did not found', async () => {
    await member('second-owner', 'acc', { role: 'owner', createdAt: 2000 });
    const { controller } = wire();
    await controller.completeOnboarding(as('acc', 'second-owner'), hubBody());
    expect(await playbookRows()).toHaveLength(0);

    await account('theirs');
    await member('first-admin', 'theirs', { role: 'admin' });
    await controller.completeOnboarding(as('theirs', 'first-admin'), hubBody());
    expect(await playbookRows()).toHaveLength(0);
  });

  it.each([
    ['a slug that names no playbook', { playbook: 'no-such-playbook' }],
    ['no playbook', { playbook: undefined }],
    ['a junk playbook value', { playbook: 42 }],
  ])('finishes the wizard and queues nothing with %s', async (_name, extra) => {
    const { controller } = wire();
    const res = await controller.completeOnboarding(as('acc', 'founder'), hubBody(extra));
    expect(res.completed).toBe(true);
    expect(await playbookRows()).toHaveLength(0);
  });

  it('failing to queue never costs the person their first form', async () => {
    const { controller, email } = wire();
    vi.spyOn(email, 'enqueuePlaybookPdf').mockRejectedValue(new Error('outbox is away'));
    const res = await controller.completeOnboarding(as('acc', 'founder'), hubBody());
    expect(res.completed).toBe(true);
    expect(res.formId).toBeTruthy();
  });

  it('a failed founder read finishes the wizard too, with nothing queued', async () => {
    failing.founding = true;
    const { controller } = wire();
    expect((await controller.me(as('acc', 'founder')))?.onboardingRequired).toBe(true);
    const res = await controller.completeOnboarding(as('acc', 'founder'), hubBody());
    expect(res.formId).toBeTruthy();
    expect(await playbookRows()).toHaveLength(0);
  });

  it('is not queued without a PUBLIC_APP_URL (a bare fork)', async () => {
    const { controller } = wire(env({ PUBLIC_APP_URL: undefined }));
    await controller.completeOnboarding(as('acc', 'founder'), hubBody());
    expect(await playbookRows()).toHaveLength(0);
  });
});

describe('who gets the short flow', () => {
  it('tells the dashboard who founded the workspace, only while the wizard is owed', async () => {
    await member('invited', 'acc', { role: 'admin', createdAt: 2000 });
    const { controller } = wire();
    expect(await controller.me(as('acc', 'founder'))).toMatchObject({ foundingMember: true });
    expect(await controller.me(as('acc', 'invited'))).toMatchObject({ foundingMember: false });

    await controller.completeOnboarding(as('acc', 'founder'), hubBody());
    expect(await controller.me(as('acc', 'founder'))).not.toHaveProperty('foundingMember');
  });

  it('ignores it from an invited admin: no flow stored, announced or kept from the IAM', async () => {
    await member('invited', 'acc', { role: 'admin', createdAt: 2000 });
    const { controller } = wire();
    await controller.saveOnboarding(as('acc', 'invited'), { lastStep: 'lead_source', flow: 'hub' });
    expect((await getAccountOnboarding(db, 'acc'))!.onboarding).not.toHaveProperty('flow');

    await controller.completeOnboarding(as('acc', 'invited'), hubBody());
    const blob = (await getAccountOnboarding(db, 'acc'))!.onboarding!;
    expect(blob.flow).toBeUndefined();
    // An ordinary cold completion: the unanswered questions read as such.
    expect(blob.sources?.phone).toBe('skipped');
    expect((await events('forms_onboarding_completed'))[0]).not.toHaveProperty('flow');
  });
});

describe('what a hub signup leaves behind', () => {
  it('records the flow, with no reason invented for the questions it left out', async () => {
    const { controller } = wire();
    await controller.saveOnboarding(as('acc', 'founder'), { lastStep: 'lead_source', flow: 'hub' });
    await controller.completeOnboarding(as('acc', 'founder'), hubBody());
    const blob = (await getAccountOnboarding(db, 'acc'))!.onboarding!;
    expect(blob.flow).toBe('hub');
    expect(blob.cohort).toBe('cold');
    expect(blob.sources).toEqual({ lead_source: 'asked', use_case: 'asked' });
  });

  it('marks forms_onboarding_completed with the flow, and only then', async () => {
    const { controller } = wire();
    await controller.completeOnboarding(as('acc', 'founder'), hubBody());
    await account('plain');
    await member('plain-owner', 'plain');
    await controller.completeOnboarding(as('plain', 'plain-owner'), { template: 'blank' });

    const [hub, plain] = await events('forms_onboarding_completed');
    expect(hub).toMatchObject({ flow: 'hub' });
    expect(plain).not.toHaveProperty('flow');
  });

  it('posts nothing to the IAM even with answers a longer, abandoned wizard stored', async () => {
    const { controller, serverEnv } = wire();
    await controller.saveOnboarding(as('acc', 'founder'), {
      lastStep: 'lead_volume',
      phone: '+573000000000',
      industry: 'computer_software',
      crm: 'hubspot',
    });
    await controller.completeOnboarding(as('acc', 'founder'), hubBody());

    const urls: string[] = [];
    const delivery = new DaptaSyncDelivery(db, serverEnv);
    delivery.fetchImpl = (async (url: string) => {
      urls.push(url);
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await delivery.deliver(
      'complete',
      (await listOutbox(db, { kind: 'dapta_sync' })).find((r) => r.action === 'complete')!.payload!,
    );
    expect(urls).toEqual(['https://flows.example.com/sync']);
  });

  it('syncs only what was answered: no empty property, and nothing to the IAM', async () => {
    const { controller, serverEnv } = wire();
    await controller.saveOnboarding(as('acc', 'founder'), {
      lastStep: 'use_case',
      flow: 'hub',
      leadSource: 'google_ads',
    });
    await controller.completeOnboarding(as('acc', 'founder'), hubBody());

    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const delivery = new DaptaSyncDelivery(db, serverEnv);
    delivery.fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body ?? 'null')) as Record<string, unknown> });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const rows = await listOutbox(db, { kind: 'dapta_sync' });
    expect(rows.map((r) => r.action).sort()).toEqual(['complete', 'early']);
    for (const row of rows) await delivery.deliver(row.action, row.payload!);

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.url).toBe('https://flows.example.com/sync');
      expect(Object.keys(call.body).sort()).toEqual(['email', 'lead_source', 'use_case', 'user_id']);
      for (const value of Object.values(call.body)) expect(value).toBeTruthy();
    }
  });
});
