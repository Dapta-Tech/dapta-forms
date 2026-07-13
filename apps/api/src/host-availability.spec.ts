import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, migrate, seed, sql, type Db } from '@slate/db';
import { DisabledCalendarProvider } from '@slate/calendar';
import { BookingNotifier } from '@slate/notifications';
import type { EmailMessage, EmailProvider, EmailResult } from '@slate/notifications';
import { CalendarEffects } from './calendar-effects';
import { EmailEffects } from './email-effects';
import { AdminService } from './admin.service';

class NullEmailProvider implements EmailProvider {
  send(_message: EmailMessage): Promise<EmailResult> {
    return Promise.resolve({ delivered: true, driver: 'smtp' });
  }
}

// /admin/bookings/new for a member WITHOUT a public handle: the public
// availability endpoint 400s (handle required), which silently emptied the
// form's slot list. The host surface resolves the member by id instead.
describe('host availability + manual booking without a public handle', () => {
  let db: Db;
  let admin: AdminService;
  let principal: { accountId: string; memberId: string; role: 'owner' };

  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    await seed(db);
    const accountId = (await db.get<{ id: string }>(sql`SELECT id FROM account WHERE code='acme'`))!.id;
    const memberId = (await db.get<{ id: string }>(sql`SELECT id FROM member WHERE handle='alex-rivera'`))!.id;
    // The regression under test: the member has NOT set a public handle yet.
    await db.run(sql`UPDATE member SET handle=NULL WHERE id=${memberId}`);
    principal = { accountId, memberId, role: 'owner' };

    const calendar = new CalendarEffects(new DisabledCalendarProvider(), db);
    admin = new AdminService(db, calendar, new EmailEffects(new BookingNotifier(new NullEmailProvider()), db));
  });

  it('myAvailability returns real slots for the handle-less member', async () => {
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const r = await admin.myAvailability(principal, { slug: 'intro-call', from, to });
    expect(r).not.toBeNull();
    expect(r!.slots.length).toBeGreaterThan(0);
  });

  it('myAvailability is null for an unknown slug or an invalid range', async () => {
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 10 * 86_400_000).toISOString();
    expect(await admin.myAvailability(principal, { slug: 'nope', from, to })).toBeNull();
    expect(await admin.myAvailability(principal, { slug: 'intro-call', from: 'garbage', to })).toBeNull();
  });

  it('hostCreate books a manual slot with no handle on the payload', async () => {
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const avail = await admin.myAvailability(principal, { slug: 'intro-call', from, to });
    const out = await admin.hostCreate(
      principal,
      {
        slug: 'intro-call',
        startUtc: avail!.slots[0]!.startUtc,
        attendee: { name: 'Sam Guest', email: 'sam@example.com', timeZone: 'America/New_York' },
        answers: { company: 'Acme' },
      },
      'acme',
    );
    expect(out.ok).toBe(true);
  });
});
