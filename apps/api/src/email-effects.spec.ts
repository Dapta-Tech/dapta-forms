/**
 * EmailEffects — the per-field form → account → stock merge that decides what
 * gets SNAPSHOTTED onto the durable outbox payload (and whether a row is
 * enqueued at all):
 *
 *   subject/body — form override ?? account override ?? null (null = the worker
 *                  renders the stock template);
 *   enabled      — a form row EXISTS → its toggle wins outright; else the
 *                  account row; else default-on.
 *
 * Runs on in-memory SQLite through the real repo helpers (no mocks), mirroring
 * submission.service.spec.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createDb,
  migrate,
  seed,
  listOutbox,
  upsertNotificationSetting,
  sql,
  type Db,
} from '@quill/db';
import { SubmissionNotifier, LogOnlyEmailProvider } from '@quill/notifications';
import { EmailEffects } from './email-effects';

let db: Db;
let effects: EmailEffects;
let accountId: string;
let formId: string;

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db); // account "acme" + form "lead-qualifier" + owner alex@example.com
  effects = new EmailEffects(new SubmissionNotifier(new LogOnlyEmailProvider()), db);
  const account = await db.get<{ id: string }>(sql`SELECT id FROM account WHERE code = 'acme' LIMIT 1`);
  accountId = account!.id;
  const form = await db.get<{ id: string }>(sql`SELECT id FROM form WHERE slug = 'lead-qualifier' LIMIT 1`);
  formId = form!.id;
});

afterEach(async () => {
  await db.close();
});

let seq = 0;
async function enqueueConfirmed(withFormId: string | null = formId): Promise<void> {
  await effects.enqueueSubmissionConfirmed(
    accountId,
    { submissionId: `sub-${++seq}`, formName: 'Lead Qualifier', respondentEmail: 'lead@acme.io' },
    withFormId,
  );
}

/** The single enqueued email payload (or null when nothing was enqueued). */
async function onlyPayload(): Promise<{
  subjectTemplate: string | null;
  bodyTemplate: string | null;
} | null> {
  const rows = await listOutbox(db, { kind: 'email' });
  if (rows.length === 0) return null;
  expect(rows).toHaveLength(1);
  return JSON.parse(rows[0]!.payload!) as { subjectTemplate: string | null; bodyTemplate: string | null };
}

describe('subject/body precedence (submission_confirmed)', () => {
  it('no rows anywhere → stock template (null snapshot), enabled by default', async () => {
    await enqueueConfirmed();
    const p = await onlyPayload();
    expect(p).not.toBeNull();
    expect(p!.subjectTemplate).toBeNull();
    expect(p!.bodyTemplate).toBeNull();
  });

  it('account override applies when the form has no row', async () => {
    await upsertNotificationSetting(db, accountId, 'submission_confirmed', {
      subject: 'ACCT {{formName}}',
      body: 'ACCT body',
    });
    await enqueueConfirmed();
    const p = await onlyPayload();
    expect(p!.subjectTemplate).toBe('ACCT {{formName}}');
    expect(p!.bodyTemplate).toBe('ACCT body');
  });

  it('a form override wins over the account override', async () => {
    await upsertNotificationSetting(db, accountId, 'submission_confirmed', { subject: 'ACCT' });
    await upsertNotificationSetting(
      db,
      accountId,
      'submission_confirmed',
      { subject: 'FORM {{formName}}' },
      Date.now(),
      formId,
    );
    await enqueueConfirmed();
    expect((await onlyPayload())!.subjectTemplate).toBe('FORM {{formName}}');
  });

  it('resolves PER FIELD: form subject + account body compose', async () => {
    await upsertNotificationSetting(db, accountId, 'submission_confirmed', { body: 'ACCT body' });
    await upsertNotificationSetting(
      db,
      accountId,
      'submission_confirmed',
      { subject: 'FORM subject' }, // body stays null on the form row → inherit
      Date.now(),
      formId,
    );
    await enqueueConfirmed();
    const p = await onlyPayload();
    expect(p!.subjectTemplate).toBe('FORM subject');
    expect(p!.bodyTemplate).toBe('ACCT body');
  });

  it("another form's override never leaks (form isolation)", async () => {
    await upsertNotificationSetting(
      db,
      accountId,
      'submission_confirmed',
      { subject: 'OTHER FORM' },
      Date.now(),
      'some-other-form-id',
    );
    await enqueueConfirmed();
    expect((await onlyPayload())!.subjectTemplate).toBeNull();
  });
});

describe('enabled precedence', () => {
  it('no form row + account disabled → not enqueued', async () => {
    await upsertNotificationSetting(db, accountId, 'submission_confirmed', { enabled: false });
    await enqueueConfirmed();
    expect(await onlyPayload()).toBeNull();
  });

  it('form row disabled → not enqueued even though the account is enabled', async () => {
    await upsertNotificationSetting(
      db,
      accountId,
      'submission_confirmed',
      { enabled: false },
      Date.now(),
      formId,
    );
    await enqueueConfirmed();
    expect(await onlyPayload()).toBeNull();
  });

  it('form row enabled → enqueued even though the ACCOUNT is disabled (the row wins)', async () => {
    await upsertNotificationSetting(db, accountId, 'submission_confirmed', { enabled: false });
    await upsertNotificationSetting(
      db,
      accountId,
      'submission_confirmed',
      { enabled: true, subject: 'FORM ON' },
      Date.now(),
      formId,
    );
    await enqueueConfirmed();
    expect((await onlyPayload())!.subjectTemplate).toBe('FORM ON');
  });

  it('no formId (account-only caller) keeps the pre-feature behavior', async () => {
    await upsertNotificationSetting(db, accountId, 'submission_confirmed', { subject: 'ACCT' });
    await upsertNotificationSetting(
      db,
      accountId,
      'submission_confirmed',
      { subject: 'FORM', enabled: false },
      Date.now(),
      formId,
    );
    await enqueueConfirmed(null); // caller without form context
    expect((await onlyPayload())!.subjectTemplate).toBe('ACCT');
  });
});

describe('submission_received uses the same merge', () => {
  it('form override + form toggle apply to the owner notice too', async () => {
    await upsertNotificationSetting(db, accountId, 'submission_received', { subject: 'ACCT' });
    await upsertNotificationSetting(
      db,
      accountId,
      'submission_received',
      { subject: 'FORM RECEIVED {{formName}}' },
      Date.now(),
      formId,
    );
    await effects.enqueueSubmissionReceived(
      accountId,
      { submissionId: 'sub-r1', formName: 'Lead Qualifier', respondentEmail: null },
      formId,
    );
    const rows = await listOutbox(db, { kind: 'email' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('submission_received');
    const p = JSON.parse(rows[0]!.payload!) as { subjectTemplate: string | null };
    expect(p.subjectTemplate).toBe('FORM RECEIVED {{formName}}');

    // Disable at form level → suppressed.
    await upsertNotificationSetting(
      db,
      accountId,
      'submission_received',
      { enabled: false },
      Date.now(),
      formId,
    );
    await effects.enqueueSubmissionReceived(
      accountId,
      { submissionId: 'sub-r2', formName: 'Lead Qualifier', respondentEmail: null },
      formId,
    );
    expect(await listOutbox(db, { kind: 'email' })).toHaveLength(1); // unchanged
  });
});
