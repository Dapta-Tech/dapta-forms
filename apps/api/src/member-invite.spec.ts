/**
 * Inviting a teammate, end to end on in-memory SQLite.
 *
 * The gap this closes: `inviteMember` inserted a row with status `invited` and
 * stopped. There was no invitation email anywhere in `@quill/notifications`, so
 * the invited person was never told, and nothing ever flipped them to `active`
 * once they showed up — an accepted invite read as pending forever.
 *
 * Locked here:
 *   1. inviting ENQUEUES the notice (through the outbox, never sent inline);
 *   2. the queued payload addresses the invited person and names the workspace;
 *   3. a failing mail path never fails the invite itself;
 *   4. resolving flips `invited` → `active`, and ONLY that transition —
 *      a disabled member must not be revived by logging in;
 *   5. the role guards actually guard.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import {
  createDb,
  migrate,
  seed,
  getAccountByCode,
  inviteMember,
  setMemberStatus,
  getAccountMember,
  activateInvitedMember,
  sql,
  type Db,
} from '@quill/db';
import { SubmissionNotifier, LogOnlyEmailProvider } from '@quill/notifications';
import { EmailEffects } from './email-effects';
import { assertAdmin, assertCanManageTarget } from './permissions';

describe('member invitations', () => {
  let db: Db;
  let accountId: string;
  let effects: EmailEffects;

  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    await seed(db);
    accountId = (await getAccountByCode(db, 'acme'))!.id;
    const provider = new LogOnlyEmailProvider();
    effects = new EmailEffects(new SubmissionNotifier(provider), db, provider, {
      PUBLIC_APP_URL: 'https://forms.example.com',
    } as never);
  });

  afterEach(async () => {
    await db.close();
  });

  const outboxRows = () =>
    db.all<{ action: string; payload: string; subject_uid: string | null; status: string }>(
      sql`SELECT action, payload, subject_uid, status FROM outbox WHERE action = 'member_invited'`,
    );

  it('enqueues the invitation instead of sending it inline', async () => {
    const invited = await inviteMember(db, accountId, { email: 'nuevo@acme.test' });
    expect(invited.ok).toBe(true);
    const member = invited.ok ? invited.value : null;

    await effects.enqueueMemberInvited({
      accountId,
      memberId: member!.id,
      to: 'nuevo@acme.test',
      invitedBy: 'Alex Rivera',
    });

    const rows = await outboxRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('pending');
    // Anchored on the member so a retry cannot read as a second invitation.
    expect(rows[0]!.subject_uid).toBe(member!.id);

    const payload = JSON.parse(rows[0]!.payload) as {
      to: string;
      accountName: string;
      invitedBy: string;
      signInLink: string;
    };
    expect(payload.to).toBe('nuevo@acme.test');
    expect(payload.accountName).toBeTruthy();
    expect(payload.invitedBy).toBe('Alex Rivera');
    expect(payload.signInLink).toBe('https://forms.example.com/login');
  });

  it('drops the sign-in link rather than printing a broken one with no PUBLIC_APP_URL', async () => {
    const provider = new LogOnlyEmailProvider();
    const bare = new EmailEffects(new SubmissionNotifier(provider), db, provider, {} as never);
    const invited = await inviteMember(db, accountId, { email: 'bare@acme.test' });
    await bare.enqueueMemberInvited({
      accountId,
      memberId: invited.ok ? invited.value.id : '',
      to: 'bare@acme.test',
    });
    const rows = await outboxRows();
    const payload = JSON.parse(rows[0]!.payload) as { signInLink: string | null };
    expect(payload.signInLink).toBeNull();
  });

  it('never fails the invite when the notice cannot be queued', async () => {
    const invited = await inviteMember(db, accountId, { email: 'safe@acme.test' });
    expect(invited.ok).toBe(true);
    // A member id that does not exist still must not throw out of the effect.
    await expect(
      effects.enqueueMemberInvited({ accountId: 'no-such-account', memberId: 'x', to: 'a@b.test' }),
    ).resolves.toBeUndefined();
  });

  describe('arriving clears the invited flag', () => {
    it('flips invited → active', async () => {
      const invited = await inviteMember(db, accountId, { email: 'arrives@acme.test' });
      const id = invited.ok ? invited.value.id : '';
      expect((await getAccountMember(db, accountId, id))!.status).toBe('invited');

      await activateInvitedMember(db, accountId, id);

      expect((await getAccountMember(db, accountId, id))!.status).toBe('active');
    });

    it('does NOT revive a disabled member — that would defeat disabling them', async () => {
      const invited = await inviteMember(db, accountId, { email: 'disabled@acme.test' });
      const id = invited.ok ? invited.value.id : '';
      await setMemberStatus(db, accountId, id, 'disabled');

      await activateInvitedMember(db, accountId, id);

      expect((await getAccountMember(db, accountId, id))!.status).toBe('disabled');
    });

    it('is scoped to the account — another account cannot activate this member', async () => {
      const invited = await inviteMember(db, accountId, { email: 'scoped@acme.test' });
      const id = invited.ok ? invited.value.id : '';
      await activateInvitedMember(db, 'some-other-account', id);
      expect((await getAccountMember(db, accountId, id))!.status).toBe('invited');
    });
  });

  describe('role guards', () => {
    const principal = (role: 'owner' | 'admin' | 'member') => ({
      accountId,
      memberId: 'me',
      role,
    });

    it('refuses a plain member on admin-only routes', () => {
      expect(() => assertAdmin(principal('member'))).toThrow(ForbiddenException);
      expect(() => assertAdmin(principal('admin'))).not.toThrow();
      expect(() => assertAdmin(principal('owner'))).not.toThrow();
    });

    it('refuses an admin managing an owner', () => {
      const owner = { id: 'other', role: 'owner' as const, status: 'active' as const };
      expect(() => assertCanManageTarget(principal('admin'), owner)).toThrow(ForbiddenException);
      expect(() => assertCanManageTarget(principal('owner'), owner)).not.toThrow();
    });

    it('refuses an admin promoting someone to owner', () => {
      const target = { id: 'other', role: 'member' as const, status: 'active' as const };
      expect(() =>
        assertCanManageTarget(principal('admin'), target, { toRole: 'owner' }),
      ).toThrow(ForbiddenException);
    });
  });
});
