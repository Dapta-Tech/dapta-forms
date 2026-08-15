/**
 * `GET /v1/forms/:id/deliveries` — one form's delivery log, end to end on
 * in-memory SQLite through the real controller → AuthService → db.
 *
 * What it locks:
 *   1. the no-params answer is the ORIGINAL one (failures, every kind), because
 *      the per-integration history added the params and must not have moved the
 *      floor under anything already calling this;
 *   2. `?kind=` narrows, and narrowing to a kind that does not exist answers with
 *      nothing rather than failing open into every kind — the difference between
 *      an empty webhook card and a webhook card full of somebody's emails;
 *   3. `?status=` is what turns the failure list into a history;
 *   4. the tenant boundary holds on every variant, including the ones that read
 *      landed rows.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createDb,
  migrate,
  seed,
  enqueueOutbox,
  claimDueOutbox,
  claimIdentityOf,
  markOutboxDone,
  markOutboxFailed,
  getAccountByCode,
  insertAccountWithShortCode,
  createForm,
  sql,
  type Db,
  type OutboxKind,
} from '@quill/db';
import { SubmissionNotifier, LogOnlyEmailProvider } from '@quill/notifications';
import { AdminCrudController } from './admin-crud.controller';
import { AdminService } from './admin.service';
import { AnalyticsService } from './analytics.service';
import { EmailEffects } from './email-effects';
import { SubmissionService } from './submission.service';
import { AuthService } from './auth.service';
import { LocalAuthProvider, type ReqLike } from './auth.provider';

/** No identity → the local provider resolves the first seeded account + owner. */
const asOwner = (): ReqLike => ({ headers: {} });

let db: Db;
let controller: AdminCrudController;

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db);
  const provider = new LocalAuthProvider(db, {
    NODE_ENV: 'test',
    DEV_LOGIN_EMAIL: undefined,
    AUTH_LOCAL_STRICT: undefined,
    SEED_DEMO_FORM: false,
    ONBOARDING_WIZARD: false,
  });
  const auth = new AuthService(db, provider);
  controller = new AdminCrudController(
    db,
    auth,
    new AdminService(db),
    // Nothing here submits or notifies — the log-only notifier is enough to
    // satisfy the constructor.
    new SubmissionService(db, new EmailEffects(new SubmissionNotifier(new LogOnlyEmailProvider()), db)),
    new AnalyticsService(db),
  );
});

afterEach(async () => {
  await db.close();
});

async function acmeId(): Promise<string> {
  const account = await getAccountByCode(db, 'acme');
  return account!.id;
}

async function seedForm(name: string, accountId: string): Promise<string> {
  const created = await createForm(db, accountId, { name, config: { version: 1, steps: [] } });
  if (!created.ok) throw new Error(`could not seed form ${name}`);
  return created.value.id;
}

/** One outbox row for `formId`, in whichever end state the case needs. */
async function seedDelivery(over: {
  accountId: string;
  formId: string;
  kind?: OutboxKind;
  action?: string;
  landed?: boolean;
  error?: string;
  at?: number;
}): Promise<string> {
  const kind = over.kind ?? 'webhook';
  const id = await enqueueOutbox(db, {
    kind,
    action: over.action ?? 'complete',
    accountId: over.accountId,
    payload: JSON.stringify({
      destination: { type: kind },
      ctx: { formId: over.formId, accountId: over.accountId },
    }),
    now: 1_000,
  });
  const [claimed] = await claimDueOutbox(db, over.at ?? 5_000, { workerId: 'test' });
  const claim = claimIdentityOf(claimed!);
  if (over.landed) await markOutboxDone(db, id, over.at ?? 5_000, undefined, claim);
  else
    await markOutboxFailed(
      db,
      id,
      { attempts: 5, error: over.error ?? 'HTTP 400', now: over.at ?? 5_000 },
      claim,
    );
  return id;
}

/** A second tenant, for the isolation assertions. */
async function otherAccount(): Promise<string> {
  await insertAccountWithShortCode(db, { name: 'Other', externalId: 'ext:other' });
  const row = await db.get<{ id: string }>(
    sql`SELECT id FROM account WHERE external_id = ${'ext:other'} LIMIT 1`,
  );
  return String(row!.id);
}

describe('GET /v1/forms/:id/deliveries', () => {
  it('answers with failures across every kind when nothing narrows it', async () => {
    const acc = await acmeId();
    const form = await seedForm('Lead form', acc);
    const hook = await seedDelivery({ accountId: acc, formId: form, kind: 'webhook' });
    const mail = await seedDelivery({
      accountId: acc,
      formId: form,
      kind: 'email',
      action: 'submission_received',
    });
    await seedDelivery({ accountId: acc, formId: form, kind: 'webhook', landed: true });

    const res = await controller.formDeliveries(asOwner(), form);
    expect(res.items.map((i) => i.id).sort()).toEqual([hook, mail].sort());
  });

  it('narrows to the asked-for kind', async () => {
    const acc = await acmeId();
    const form = await seedForm('Lead form', acc);
    const hook = await seedDelivery({ accountId: acc, formId: form, kind: 'webhook' });
    await seedDelivery({ accountId: acc, formId: form, kind: 'hubspot' });

    const res = await controller.formDeliveries(asOwner(), form, undefined, 'webhook');
    expect(res.items.map((i) => i.id)).toEqual([hook]);
  });

  it('accepts several kinds in one param', async () => {
    const acc = await acmeId();
    const form = await seedForm('Lead form', acc);
    const crm = await seedDelivery({ accountId: acc, formId: form, kind: 'hubspot', at: 5_000 });
    const booking = await seedDelivery({
      accountId: acc,
      formId: form,
      kind: 'booking_sync',
      action: 'crm_update',
      at: 6_000,
    });
    await seedDelivery({ accountId: acc, formId: form, kind: 'webhook' });

    const res = await controller.formDeliveries(asOwner(), form, undefined, 'hubspot,booking_sync');
    expect(res.items.map((i) => i.id)).toEqual([booking, crm]);
  });

  it('returns what landed once the caller asks for it', async () => {
    const acc = await acmeId();
    const form = await seedForm('Lead form', acc);
    const landed = await seedDelivery({ accountId: acc, formId: form, landed: true, at: 5_000 });
    const failed = await seedDelivery({ accountId: acc, formId: form, at: 6_000 });

    const res = await controller.formDeliveries(asOwner(), form, undefined, 'webhook', 'done,failed');
    expect(res.items.map((i) => i.id)).toEqual([failed, landed]);
    expect(res.items.map((i) => i.status)).toEqual(['failed', 'done']);
  });

  it('drops tokens it does not recognise instead of rejecting the request', async () => {
    const acc = await acmeId();
    const form = await seedForm('Lead form', acc);
    const hook = await seedDelivery({ accountId: acc, formId: form, kind: 'webhook' });

    // A newer client naming a kind this build has never heard of still gets the
    // part of its question this build CAN answer.
    const res = await controller.formDeliveries(asOwner(), form, undefined, 'webhook,carrier_pigeon');
    expect(res.items.map((i) => i.id)).toEqual([hook]);
  });

  it('answers with nothing when every asked-for token is unknown', async () => {
    const acc = await acmeId();
    const form = await seedForm('Lead form', acc);
    await seedDelivery({ accountId: acc, formId: form, kind: 'webhook' });

    // Never "no valid kinds, so all kinds" — that would fill an integration's
    // history with another integration's deliveries.
    const res = await controller.formDeliveries(asOwner(), form, undefined, 'carrier_pigeon');
    expect(res.items).toEqual([]);
  });

  it("refuses a form the caller's account does not own", async () => {
    const other = await otherAccount();
    const theirs = await seedForm('Not yours', other);
    await seedDelivery({ accountId: other, formId: theirs });

    await expect(controller.formDeliveries(asOwner(), theirs)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('never reads another account\'s rows, landed ones included', async () => {
    const acc = await acmeId();
    const other = await otherAccount();
    const form = await seedForm('Lead form', acc);
    // Same form id in the payload, different account column — the case the SQL
    // tenant filter exists for.
    await seedDelivery({ accountId: other, formId: form, landed: true });

    const res = await controller.formDeliveries(asOwner(), form, undefined, 'webhook', 'done,failed');
    expect(res.items).toEqual([]);
  });
});
