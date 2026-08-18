/**
 * The Dapta-estate onboarding sync, end to end on in-memory SQLite: the
 * wizard's first answer and its completion are ENQUEUED as durable
 * `dapta_sync` outbox rows (never inline HTTP), and the worker-side delivery
 * pushes mappable answers to the IAM BEFORE calling the contact-sync flow —
 * the order the flow depends on, because it reads the answers back from the
 * IAM rather than from the webhook body.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  claimOnboardingComplete,
  createDb,
  listOutbox,
  migrate,
  saveOnboardingProgress,
  sql,
  type Db,
} from '@quill/db';
import { SubmissionNotifier, LogOnlyEmailProvider } from '@quill/notifications';
import type { AccountOnboarding } from '@quill/types';
import { DaptaSyncEffects } from './dapta-sync-effects';
import { DaptaSyncDelivery, buildFlowPayload, buildIamResponses } from './dapta-sync';
import { AdminService } from './admin.service';
import { EmailEffects } from './email-effects';
import { DestinationEffects } from './destination-effects';
import { OutboxWorker } from './outbox.worker';

const FLOW_URL = 'https://flows.example.com/api/ws1/sync_contact';
const IAM_URL = 'https://iam.example.com/iam';

/** The three mappable questions, in the live bank's verified shape. */
const BANK = [
  {
    id: 'q-industry',
    question_key: 'industry',
    options: [
      { id: 'o-software', option_value: 'computer_software' },
      { id: 'o-retail', option_value: 'retail' },
    ],
  },
  {
    id: 'q-crm',
    question_key: 'crm_usage',
    options: [
      { id: 'o-hubspot', option_value: 'hubspot' },
      { id: 'o-none', option_value: 'none' },
    ],
  },
  {
    id: 'q-volume',
    question_key: 'contacts_per_month',
    options: [{ id: 'o-mid', option_value: '201_500' }],
  },
];

let db: Db;

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Env with the pipeline ON. Cast: the suite only touches these fields. */
function envWith(overrides: Record<string, string | undefined> = {}) {
  return {
    DAPTA_SYNC_FLOW_URL: FLOW_URL,
    DAPTA_SYNC_FLOW_KEY: 'flow-key',
    IAM_BASE_URL: IAM_URL,
    IAM_API_KEY: 'iam-key',
    ...overrides,
  } as never;
}

/**
 * A delivery whose fetch routes by URL: the question bank, the status probe,
 * the responses POST and the flow webhook each answer in the live shape.
 */
function newDelivery(
  env: unknown,
  calls: RecordedCall[],
  opts: { hasCompleted?: boolean; flowStatus?: number } = {},
): DaptaSyncDelivery {
  const delivery = new DaptaSyncDelivery(db, env as never);
  delivery.fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (url.includes('/onboarding/questions')) {
      return new Response(JSON.stringify(BANK), { status: 200 });
    }
    if (url.includes('/onboarding/status/')) {
      return new Response(
        JSON.stringify({ has_completed_onboarding: opts.hasCompleted ?? false }),
        { status: 200 },
      );
    }
    if (url.includes('/onboarding/responses')) {
      return new Response(JSON.stringify({ message: 'ok', total_score: 4 }), { status: 201 });
    }
    return new Response('{}', { status: opts.flowStatus ?? 200 });
  }) as unknown as typeof fetch;
  return delivery;
}

function newWorker(daptaSync?: DaptaSyncDelivery) {
  const env = { OUTBOX_WORKER_ENABLED: false, OUTBOX_POLL_MS: 5000, NODE_ENV: 'test' } as never;
  const email = new EmailEffects(new SubmissionNotifier(new LogOnlyEmailProvider()), db);
  return new OutboxWorker(
    db,
    env,
    email,
    new DestinationEffects(db),
    undefined,
    undefined,
    daptaSync,
  );
}

async function seedAccount(input: {
  memberExternalId?: string | null;
  email?: string | null;
  attribution?: Record<string, string> | null;
}): Promise<{ accountId: string; memberId: string }> {
  const now = Date.now();
  await db.run(
    sql`INSERT INTO account (id, code, name, external_id, attribution, created_at)
        VALUES (${'acc_1'}, ${'t1'}, ${'Test Co'}, ${'org-ext-1'},
                ${input.attribution ? JSON.stringify(input.attribution) : null}, ${now})`,
  );
  await db.run(
    sql`INSERT INTO member (id, account_id, external_id, email, display_name, role, status, created_at)
        VALUES (${'mem_1'}, ${'acc_1'},
                ${input.memberExternalId === undefined ? 'user-ext-1' : input.memberExternalId},
                ${input.email === undefined ? 'a@b.com' : input.email}, ${'Ada Test'},
                ${'owner'}, ${'active'}, ${now})`,
  );
  return { accountId: 'acc_1', memberId: 'mem_1' };
}

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
});

afterEach(() => {
  db.close?.();
});

describe('buildIamResponses — pure mapping', () => {
  it('maps the three mappable answers by question_key + option_value', () => {
    const blob = {
      version: 1,
      industry: 'computer_software',
      crm: 'hubspot',
      leadVolume: '201_500',
    } as AccountOnboarding;

    const { responses, unmapped } = buildIamResponses(blob, BANK);

    expect(unmapped).toEqual([]);
    expect(responses).toEqual([
      { question_id: 'q-industry', selected_option_ids: ['o-software'] },
      { question_id: 'q-crm', selected_option_ids: ['o-hubspot'] },
      { question_id: 'q-volume', selected_option_ids: ['o-mid'] },
    ]);
  });

  it('reports an answer whose option left the bank instead of dropping it silently', () => {
    const blob = { version: 1, industry: 'computer_software', crm: 'hubspot' } as AccountOnboarding;
    const bankWithoutHubspot = BANK.map((q) =>
      q.question_key === 'crm_usage' ? { ...q, options: [] } : q,
    );

    const { responses, unmapped } = buildIamResponses(blob, bankWithoutHubspot);

    expect(responses).toEqual([{ question_id: 'q-industry', selected_option_ids: ['o-software'] }]);
    expect(unmapped).toEqual(['crm']);
  });

  it('returns nothing for a dapta-cohort blob — its answers have no IAM home', () => {
    const blob = { version: 1, leadSource: 'outbound', useCase: 'leads' } as AccountOnboarding;

    const { responses, unmapped } = buildIamResponses(blob, BANK);

    // Not "unmapped" either: leadSource/useCase are not in the mapping table at
    // all, so nothing is attempted and nothing is worth warning about.
    expect(responses).toEqual([]);
    expect(unmapped).toEqual([]);
  });
});

describe('buildFlowPayload — pure mapping', () => {
  it('carries the three utm_* keys the flow reads, snake_cased, dropping the rest', () => {
    const body = buildFlowPayload({
      email: 'a@b.com',
      userId: 'user-ext-1',
      accountExternalId: 'org-ext-1',
      displayName: 'Ada Test',
      blob: { version: 1, phone: '3001234567' } as AccountOnboarding,
      attribution: {
        utmSource: 'landing',
        utmMedium: 'banner',
        utmCampaign: 'launch',
        // Verified against the flow's code: it reads ONLY the three utm_* keys.
        gclid: 'g-123',
        referrer: 'https://example.com',
      },
    });

    expect(body).toEqual({
      email: 'a@b.com',
      user_id: 'user-ext-1',
      account_id: 'org-ext-1',
      name: 'Ada Test',
      phone: '3001234567',
      params: { utm_source: 'landing', utm_medium: 'banner', utm_campaign: 'launch' },
    });
  });

  it('omits params entirely when there is no attribution, and junk-length phones', () => {
    const body = buildFlowPayload({
      email: 'a@b.com',
      userId: 'user-ext-1',
      accountExternalId: null,
      displayName: null,
      // Below the flow's own isValidPhone floor — sending it would plant junk
      // in the contact's primary phone field.
      blob: { version: 1, phone: '123' } as AccountOnboarding,
      attribution: null,
    });

    expect(body).toEqual({ email: 'a@b.com', user_id: 'user-ext-1' });
  });

  it('carries lead_source and use_case at the TOP level, never inside params', () => {
    // The flow overwrites `params` with the IAM's stored UTMs for anyone who
    // has them (the whole Dapta cohort), so anything nested there would be
    // lost for exactly the people whose only answers these two are.
    const body = buildFlowPayload({
      email: 'a@b.com',
      userId: 'user-ext-1',
      accountExternalId: null,
      displayName: null,
      blob: {
        version: 1,
        cohort: 'dapta',
        leadSource: 'google_ads',
        useCase: 'leads',
      } as AccountOnboarding,
      attribution: { utmSource: 'landing' },
    });

    expect(body).toEqual({
      email: 'a@b.com',
      user_id: 'user-ext-1',
      lead_source: 'google_ads',
      use_case: 'leads',
      params: { utm_source: 'landing' },
    });
    expect(body.params).not.toHaveProperty('lead_source');
  });

  it('omits lead_source and use_case while unanswered (the early call is phone-only)', () => {
    // The flow keeps a contact's existing values when the keys are absent;
    // sending empty strings would clear what the Typeform quiz already wrote.
    const body = buildFlowPayload({
      email: 'a@b.com',
      userId: 'user-ext-1',
      accountExternalId: null,
      displayName: null,
      blob: { version: 1, phone: '3001234567', lastStep: 'phone' } as AccountOnboarding,
      attribution: null,
    });

    expect(body).toEqual({ email: 'a@b.com', user_id: 'user-ext-1', phone: '3001234567' });
    expect(body).not.toHaveProperty('lead_source');
    expect(body).not.toHaveProperty('use_case');
  });
});

describe('DaptaSyncEffects — enqueue', () => {
  it('enqueues NOTHING when the flow env is unset (a bare fork stays silent)', async () => {
    const effects = new DaptaSyncEffects(db, undefined);
    expect(effects.enabled).toBe(false);

    await effects.enqueueEarly('acc_1', 'mem_1');

    expect(await listOutbox(db, { kind: 'dapta_sync' })).toHaveLength(0);
  });

  it('enqueues a durable row carrying only the principal ids', async () => {
    const effects = new DaptaSyncEffects(db, envWith());

    await effects.enqueueComplete('acc_1', 'mem_1');

    const rows = await listOutbox(db, { kind: 'dapta_sync' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('complete');
    expect(rows[0]!.accountId).toBe('acc_1');
    // Ids only: answers are read FRESH at delivery time, never snapshotted.
    expect(JSON.parse(String(rows[0]!.payload))).toEqual({
      accountId: 'acc_1',
      memberId: 'mem_1',
    });
  });
});

describe('DaptaSyncDelivery — worker-side', () => {
  it('early: calls the flow once with email+phone+params and touches no IAM endpoint', async () => {
    const { accountId, memberId } = await seedAccount({
      attribution: { utmSource: 'landing' },
    });
    // The wizard's first answer — the moment the early sync fires.
    await saveOnboardingProgress(db, accountId, { phone: '3001234567', lastStep: 'industry' });
    await new DaptaSyncEffects(db, envWith()).enqueueEarly(accountId, memberId);

    const calls: RecordedCall[] = [];
    await newWorker(newDelivery(envWith(), calls)).drainOnce();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(FLOW_URL);
    expect(calls[0]!.headers['x-api-key']).toBe('flow-key');
    expect(calls[0]!.body).toMatchObject({
      email: 'a@b.com',
      user_id: 'user-ext-1',
      account_id: 'org-ext-1',
      phone: '3001234567',
      params: { utm_source: 'landing' },
    });
    expect((await listOutbox(db, { kind: 'dapta_sync' }))[0]!.status).toBe('done');
  });

  it('complete: writes the IAM responses BEFORE calling the flow', async () => {
    const { accountId, memberId } = await seedAccount({ attribution: null });
    await claimOnboardingComplete(
      db,
      accountId,
      'blank',
      { industry: 'computer_software', crm: 'hubspot', leadVolume: '201_500' },
      'cold',
    );
    await new DaptaSyncEffects(db, envWith()).enqueueComplete(accountId, memberId);

    const calls: RecordedCall[] = [];
    await newWorker(newDelivery(envWith(), calls)).drainOnce();

    // The order IS the contract: the flow reads the answers back from the IAM,
    // so the responses POST must land before the webhook fires.
    expect(calls.map((c) => c.url)).toEqual([
      `${IAM_URL}/onboarding/questions?stage=pre_signup`,
      `${IAM_URL}/onboarding/status/user-ext-1`,
      `${IAM_URL}/onboarding/responses`,
      FLOW_URL,
    ]);
    expect(calls[2]!.headers['x-api-key']).toBe('iam-key');
    expect(calls[2]!.body).toEqual({
      user_id: 'user-ext-1',
      responses: [
        { question_id: 'q-industry', selected_option_ids: ['o-software'] },
        { question_id: 'q-crm', selected_option_ids: ['o-hubspot'] },
        { question_id: 'q-volume', selected_option_ids: ['o-mid'] },
      ],
    });
    expect((await listOutbox(db, { kind: 'dapta_sync' }))[0]!.status).toBe('done');
  });

  it('complete: an already-completed IAM status skips the POST but still syncs the contact', async () => {
    const { accountId, memberId } = await seedAccount({});
    await claimOnboardingComplete(db, accountId, 'blank', { industry: 'retail' }, 'cold');
    await new DaptaSyncEffects(db, envWith()).enqueueComplete(accountId, memberId);

    const calls: RecordedCall[] = [];
    // A retried row after a first success, or a user who completed on Dapta's
    // side meanwhile: double-posting semantics are unspecified upstream, so
    // the status guard is what makes the retry safe.
    await newWorker(newDelivery(envWith(), calls, { hasCompleted: true })).drainOnce();

    const urls = calls.map((c) => c.url);
    expect(urls).not.toContain(`${IAM_URL}/onboarding/responses`);
    expect(urls[urls.length - 1]).toBe(FLOW_URL);
    expect((await listOutbox(db, { kind: 'dapta_sync' }))[0]!.status).toBe('done');
  });

  it('complete: a dapta-cohort blob makes no IAM call at all', async () => {
    const { accountId, memberId } = await seedAccount({});
    // Their industry/CRM/volume live in Dapta already; Forms only asked the
    // two questions the bank does not have.
    await claimOnboardingComplete(
      db,
      accountId,
      'blank',
      { leadSource: 'outbound', useCase: 'leads' },
      'dapta',
    );
    await new DaptaSyncEffects(db, envWith()).enqueueComplete(accountId, memberId);

    const calls: RecordedCall[] = [];
    await newWorker(newDelivery(envWith(), calls)).drainOnce();

    expect(calls.map((c) => c.url)).toEqual([FLOW_URL]);
    // ...and those two answers are the ONLY thing this cohort contributes to
    // HubSpot, so they must ride the webhook body itself.
    expect(calls[0]!.body).toMatchObject({
      email: 'a@b.com',
      user_id: 'user-ext-1',
      lead_source: 'outbound',
      use_case: 'leads',
    });
  });

  it('skips a member with no external identity — the flow dies silently on unknown ids', async () => {
    const { accountId, memberId } = await seedAccount({ memberExternalId: null });
    await new DaptaSyncEffects(db, envWith()).enqueueEarly(accountId, memberId);

    const calls: RecordedCall[] = [];
    await newWorker(newDelivery(envWith(), calls)).drainOnce();

    expect(calls).toHaveLength(0);
    const row = (await listOutbox(db, { kind: 'dapta_sync' }))[0]!;
    expect(row.status).toBe('skipped');
    expect(row.lastError).toMatch(/external identity/);
  });

  it('retries on a flow 5xx with backoff instead of losing the sync', async () => {
    const { accountId, memberId } = await seedAccount({});
    await saveOnboardingProgress(db, accountId, { phone: '3001234567', lastStep: 'industry' });
    await new DaptaSyncEffects(db, envWith()).enqueueEarly(accountId, memberId);

    await newWorker(newDelivery(envWith(), [], { flowStatus: 503 })).drainOnce();

    const row = (await listOutbox(db, { kind: 'dapta_sync' }))[0]!;
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.lastError).toMatch(/HTTP 503/);
  });

  it('skips rows drained after the env was removed', async () => {
    const { accountId, memberId } = await seedAccount({});
    await new DaptaSyncEffects(db, envWith()).enqueueEarly(accountId, memberId);

    const calls: RecordedCall[] = [];
    await newWorker(newDelivery(undefined, calls)).drainOnce();

    expect(calls).toHaveLength(0);
    expect((await listOutbox(db, { kind: 'dapta_sync' }))[0]!.status).toBe('skipped');
  });
});

describe('AdminService — enqueue triggers', () => {
  function newAdmin(effects: DaptaSyncEffects) {
    return new AdminService(db, undefined, undefined, true, effects);
  }

  it('fires the early sync on the FIRST answer and never again', async () => {
    const { accountId, memberId } = await seedAccount({});
    const effects = new DaptaSyncEffects(db, envWith());
    const admin = newAdmin(effects);
    const p = { accountId, memberId, role: 'owner' as const };

    // Arrival patch: a step was SEEN, nothing was answered.
    await admin.saveOnboarding(p, { lastStep: 'phone' });
    expect(await listOutbox(db, { kind: 'dapta_sync' })).toHaveLength(0);

    // First answer → the person should exist in the CRM from here on.
    await admin.saveOnboarding(p, { phone: '3001234567', lastStep: 'industry' });
    expect(await listOutbox(db, { kind: 'dapta_sync' })).toHaveLength(1);

    // Second answer → the early moment already happened.
    await admin.saveOnboarding(p, { industry: 'retail', lastStep: 'crm' });
    expect(await listOutbox(db, { kind: 'dapta_sync' })).toHaveLength(1);
  });

  it('fires the complete sync for the claim WINNER only', async () => {
    const { accountId, memberId } = await seedAccount({});
    const effects = new DaptaSyncEffects(db, envWith());
    const admin = newAdmin(effects);
    const p = { accountId, memberId, role: 'owner' as const };

    const first = await admin.completeOnboarding(p, { template: 'blank', cohort: 'cold' });
    expect(first.completed).toBe(true);
    const afterWin = await listOutbox(db, { kind: 'dapta_sync' });
    expect(afterWin.filter((r) => r.action === 'complete')).toHaveLength(1);

    // The double-submit loser must not sync twice.
    const second = await admin.completeOnboarding(p, { template: 'blank', cohort: 'cold' });
    expect(second.completed).toBe(false);
    const afterLoss = await listOutbox(db, { kind: 'dapta_sync' });
    expect(afterLoss.filter((r) => r.action === 'complete')).toHaveLength(1);
  });
});
