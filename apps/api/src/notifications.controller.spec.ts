/**
 * Settings → Notifications: the account-scoped, admin-gated API that lets an
 * owner edit the two submission emails (owner "new submission" notice +
 * respondent "we got your responses" confirmation) — enable toggle + custom
 * subject/body. Exercised end to end through the real controller → AuthService →
 * provider → db on in-memory SQLite. These pin:
 *
 *   1. GET returns both emails, defaulting to enabled with no override, plus the
 *      shipped defaults (EN/ES) and the {{token}} catalog the UI renders;
 *   2. PUT persists a toggle + a custom subject/body (stored verbatim with its
 *      {{token}} markers — interpolation happens at send time, tested in
 *      @quill/notifications);
 *   3. reset (POST … /reset, and PUT null) clears the override back to default
 *      while leaving the enabled toggle untouched;
 *   4. a plain member is refused (403) — this is admin/owner only;
 *   5. an unknown emailKey is a 400;
 *   6. settings are account-scoped — one account's override never leaks to another.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { createDb, migrate, seed, getNotificationSettings, type Db } from '@quill/db';
import { AdminCrudController } from './admin-crud.controller';
import { AdminService } from './admin.service';
import { AuthService } from './auth.service';
import { LocalAuthProvider } from './auth.provider';
import type { ReqLike } from './auth.provider';

let db: Db;
let controller: AdminCrudController;

/** A request the local dev provider resolves to `email` (JIT-provisions an owner). */
const asEmail = (email: string): ReqLike => ({ headers: { 'x-quill-email': email } });
/** No identity → the first seeded account+member (acme's owner alex@example.com). */
const asOwner = (): ReqLike => ({ headers: {} });

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db); // account "acme" + owner alex@example.com
  const provider = new LocalAuthProvider(db, {
    NODE_ENV: 'test',
    DEV_LOGIN_EMAIL: undefined,
    AUTH_LOCAL_STRICT: undefined,
    SEED_DEMO_FORM: false,
  });
  const auth = new AuthService(db, provider);
  const admin = new AdminService(db);
  // Submission/Analytics services are unused by the notification routes.
  controller = new AdminCrudController(db, auth, admin, {} as never, {} as never);
});

afterEach(async () => {
  await db.close();
});

describe('GET /v1/notifications', () => {
  it('returns both emails, defaulting to enabled with no override, plus defaults + tokens', async () => {
    const { settings } = await controller.notifications(asOwner());
    expect(settings.map((s) => s.emailKey)).toEqual(['submission_received', 'submission_confirmed']);

    const received = settings.find((s) => s.emailKey === 'submission_received')!;
    expect(received.enabled).toBe(true);
    expect(received.subject).toBeNull();
    expect(received.body).toBeNull();
    // The shipped default copy (token-bearing) for both locales, for the UI.
    expect(received.defaults.en.subject).toBe('New submission — {{formName}}');
    expect(received.defaults.es.subject).toBe('Nueva respuesta — {{formName}}');
    // The interpolation catalog.
    expect(received.tokens).toEqual([
      'formName',
      'respondentEmail',
      'score',
      'outcomeLabel',
      'formLink',
    ]);
  });
});

describe('PUT /v1/notifications/:emailKey', () => {
  it('persists an enable toggle + a custom subject/body (stored verbatim)', async () => {
    const updated = await controller.updateNotification(asOwner(), 'submission_received', {
      enabled: false,
      subject: 'Lead: {{formName}}',
      body: 'From {{respondentEmail}} — {{score}}',
    });
    expect(updated.enabled).toBe(false);
    expect(updated.subject).toBe('Lead: {{formName}}');
    expect(updated.body).toBe('From {{respondentEmail}} — {{score}}');

    // Re-read is consistent, and the OTHER email is unaffected.
    const { settings } = await controller.notifications(asOwner());
    const received = settings.find((s) => s.emailKey === 'submission_received')!;
    expect(received.subject).toBe('Lead: {{formName}}');
    const confirmed = settings.find((s) => s.emailKey === 'submission_confirmed')!;
    expect(confirmed.subject).toBeNull();
    expect(confirmed.enabled).toBe(true);
  });

  it('a null subject/body resets that field while keeping the toggle', async () => {
    await controller.updateNotification(asOwner(), 'submission_confirmed', {
      enabled: false,
      subject: 'Custom',
      body: 'Custom body',
    });
    const reset = await controller.updateNotification(asOwner(), 'submission_confirmed', {
      subject: null,
      body: null,
    });
    expect(reset.subject).toBeNull();
    expect(reset.body).toBeNull();
    expect(reset.enabled).toBe(false); // toggle preserved
  });

  it('rejects an unknown email key with 400', async () => {
    await expect(
      controller.updateNotification(asOwner(), 'reminder', { enabled: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('POST /v1/notifications/:emailKey/reset', () => {
  it('clears the custom subject+body but keeps the enabled toggle', async () => {
    await controller.updateNotification(asOwner(), 'submission_received', {
      enabled: false,
      subject: 'Custom {{formName}}',
      body: 'Custom body',
    });
    const reset = await controller.resetNotification(asOwner(), 'submission_received');
    expect(reset.subject).toBeNull();
    expect(reset.body).toBeNull();
    expect(reset.enabled).toBe(false);

    // The stored row now reads as the default template again.
    const me = await controller.me(asOwner());
    const stored = await getNotificationSettings(db, me!.accountId);
    expect(stored.get('submission_received')?.subject ?? null).toBeNull();
  });

  it('rejects an unknown email key with 400', async () => {
    await expect(controller.resetNotification(asOwner(), 'nope')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('admin gating', () => {
  it('refuses a plain member (admin/owner only) on read + write + reset with 403', async () => {
    await controller.inviteMember(asOwner(), { email: 'plain@acme.test', role: 'member' });
    await expect(controller.notifications(asEmail('plain@acme.test'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      controller.updateNotification(asEmail('plain@acme.test'), 'submission_received', {
        enabled: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.resetNotification(asEmail('plain@acme.test'), 'submission_received'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('account scoping', () => {
  it('one account owner never sees or clobbers another account owner settings', async () => {
    // acme's owner customizes; a different owner (a fresh JIT account) stays default.
    await controller.updateNotification(asOwner(), 'submission_received', {
      subject: 'ACME only {{formName}}',
    });

    const other = await controller.notifications(asEmail('owner@other.test'));
    const otherReceived = other.settings.find((s) => s.emailKey === 'submission_received')!;
    expect(otherReceived.subject).toBeNull(); // isolated — no leak

    // acme still has its override.
    const acme = await controller.notifications(asOwner());
    expect(acme.settings.find((s) => s.emailKey === 'submission_received')!.subject).toBe(
      'ACME only {{formName}}',
    );

    // And a write as the other owner doesn't touch acme's row.
    await controller.updateNotification(asEmail('owner@other.test'), 'submission_received', {
      subject: 'OTHER {{formName}}',
    });
    const acmeAfter = await controller.notifications(asOwner());
    expect(acmeAfter.settings.find((s) => s.emailKey === 'submission_received')!.subject).toBe(
      'ACME only {{formName}}',
    );
  });
});
