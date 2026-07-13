import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, migrate, seed, sql, type Db } from '@slate/db';
import { isShortCode } from '@slate/engine';
import { DisabledCalendarProvider } from '@slate/calendar';
import { BookingNotifier, NoopEmailProvider } from '@slate/notifications';
import { CalendarEffects } from './calendar-effects';
import { EmailEffects } from './email-effects';
import { AdminService } from './admin.service';
import { LocalAuthProvider } from './auth.provider';
import type { EntitlementsProvider } from './entitlements.provider';

class StubEntitlements implements EntitlementsProvider {
  readonly enabled = true;
  calls = 0;
  constructor(private readonly paid: boolean) {}
  isPaidCustomer(): Promise<boolean> {
    this.calls++;
    return Promise.resolve(this.paid);
  }
}

const admin = (
  db: Db,
  opts: { mode?: 'open' | 'locked'; entitlements?: EntitlementsProvider } = {},
) =>
  new AdminService(
    db,
    new CalendarEffects(new DisabledCalendarProvider(), db),
    new EmailEffects(new BookingNotifier(new NoopEmailProvider()), db),
    opts.entitlements,
    opts.mode ?? 'open',
  );

describe('short links — API surface', () => {
  let db: Db;
  let principal: { accountId: string; memberId: string; role: 'owner' };

  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    await seed(db);
    const accountId = (await db.get<{ id: string }>(sql`SELECT id FROM account WHERE code='acme'`))!.id;
    const memberId = (await db.get<{ id: string }>(sql`SELECT id FROM member WHERE handle='alex-rivera'`))!.id;
    principal = { accountId, memberId, role: 'owner' };
  });

  it('local JIT login mints a 6-char short code and an auto handle (no more dev-… URLs)', async () => {
    const provider = new LocalAuthProvider(db, { NODE_ENV: 'test' } as never);
    const host = await provider.resolveHost({
      headers: { 'x-slate-email': 'nora.quinn@example.com' },
    } as never);
    const acc = await db.get<{ code: string }>(
      sql`SELECT code FROM account WHERE id = ${host.accountId}`,
    );
    expect(isShortCode(acc!.code)).toBe(true);
    const member = await db.get<{ handle: string | null }>(
      sql`SELECT handle FROM member WHERE id = ${host.memberId}`,
    );
    expect(member!.handle).toBe('noraquinn');
    // Idempotent: same email lands in the same account.
    const again = await provider.resolveHost({
      headers: { 'x-slate-email': 'nora.quinn@example.com' },
    } as never);
    expect(again.accountId).toBe(host.accountId);
  });

  it('vanity: open mode (OSS default) claims without any upstream', async () => {
    const svc = admin(db);
    expect((await svc.vanityStatus(principal)).canClaim).toBe(true);
    const out = await svc.setVanity(principal, 'acme-inc');
    expect(out).toEqual({ ok: true, vanitySlug: 'acme-inc' });
    expect((await svc.me(principal))!.accountCode).toBe('acme-inc');
  });

  it('vanity: locked mode gates on the Dapta AI entitlement and caches the verdict', async () => {
    const paid = new StubEntitlements(true);
    const svc = admin(db, { mode: 'locked', entitlements: paid });
    expect((await svc.vanityStatus(principal)).canClaim).toBe(true);
    expect(paid.calls).toBe(1);
    // Second check inside the TTL uses the cached verdict — no upstream call.
    await svc.vanityStatus(principal);
    expect(paid.calls).toBe(1);
    expect(await svc.setVanity(principal, 'acme-inc')).toEqual({ ok: true, vanitySlug: 'acme-inc' });

    // A free customer is refused with the entitlement reason.
    await db.run(
      sql`UPDATE account SET dapta_entitlement = ${'free'}, entitlement_checked_at = ${Date.now()}
          WHERE id = ${principal.accountId}`,
    );
    const freeSvc = admin(db, { mode: 'locked', entitlements: new StubEntitlements(false) });
    expect(await freeSvc.setVanity(principal, 'other-slug')).toEqual({ ok: false, reason: 'NOT_ENTITLED' });
  });

  it('vanity: locked mode with NO upstream wired fails closed', async () => {
    const svc = admin(db, { mode: 'locked' });
    expect((await svc.vanityStatus(principal)).canClaim).toBe(false);
    expect(await svc.setVanity(principal, 'acme-inc')).toEqual({ ok: false, reason: 'NOT_ENTITLED' });
  });

  it('vanity: reserved words and duplicates are refused with distinct reasons', async () => {
    const svc = admin(db);
    expect(await svc.setVanity(principal, 'signup')).toEqual({ ok: false, reason: 'reserved' });
    expect(await svc.setVanity(principal, 'x')).toEqual({ ok: false, reason: 'invalid' });
    await db.run(
      sql`INSERT INTO account (id, code, name, created_at) VALUES ('other', 'qq2233', 'Q', ${Date.now()})`,
    );
    expect(await svc.setVanity(principal, 'qq2233')).toEqual({ ok: false, reason: 'taken' });
  });

  it('/me carries canonical + short code + vanity for the settings UI', async () => {
    const svc = admin(db);
    await svc.setVanity(principal, 'acme-inc');
    const me = await svc.me(principal);
    expect(me).toMatchObject({ accountCode: 'acme-inc', accountShortCode: 'acme', vanitySlug: 'acme-inc' });
    const status = await svc.vanityStatus(principal);
    expect(status).toEqual({ vanitySlug: 'acme-inc', shortCode: 'acme', canClaim: true });
  });
});
