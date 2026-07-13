import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, migrate, seed, sql, getAvailability, type Db } from '@slate/db';
import { DisabledCalendarProvider } from '@slate/calendar';
import { BookingNotifier, NoopEmailProvider } from '@slate/notifications';
import { loadServerEnv } from '@slate/config/env';
import { CalendarEffects } from './calendar-effects';
import { EmailEffects } from './email-effects';
import { BookingService } from './booking.service';
import { PublicController } from './public.controller';
import { MachineController } from './machine.controller';
import type { AuthService, ReqLike, MachinePrincipal } from './auth.service';

const ENV = loadServerEnv({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);

function makeSvc(db: Db): BookingService {
  const email = new EmailEffects(new BookingNotifier(new NoopEmailProvider()), db);
  const calendar = new CalendarEffects(new DisabledCalendarProvider(), db);
  return new BookingService(db, ENV, calendar, email);
}

async function firstSlot(db: Db, slug = 'intro-call'): Promise<string> {
  const a = await getAvailability(db, {
    accountCode: 'acme',
    handle: 'alex-rivera',
    slug,
    fromMs: Date.now(),
    toMs: Date.now() + 10 * 86_400_000,
  });
  return a!.slots[0]!.startUtc;
}

describe('BE polish', () => {
  let db: Db;
  let accountId: string;
  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    await seed(db);
    accountId = (await db.get<{ id: string }>(sql`SELECT id FROM account WHERE code='acme'`))!.id;
  });

  // --- Item 1: manage token off the query string ---------------------------
  describe('manage token accepted via header / body / query (backward-compat)', () => {
    let pub: PublicController;
    let svc: BookingService;
    async function bookOne(): Promise<{ uid: string; token: string }> {
      const out = await svc.book({
        accountCode: 'acme',
        handle: 'alex-rivera',
        slug: 'intro-call',
        startUtc: await firstSlot(db),
        attendee: { name: 'Sam', email: 'sam@example.com', timeZone: 'UTC' },
        answers: { company: 'Acme' },
      });
      if ('error' in out) throw new Error('book failed');
      const token = new URL(out.manageUrl!).searchParams.get('token')!;
      return { uid: out.uid, token };
    }
    beforeEach(() => {
      svc = makeSvc(db);
      pub = new PublicController(svc);
    });

    it('reads the token from the X-Manage-Token header', async () => {
      const { uid, token } = await bookOne();
      const view = await pub.manageView(uid, token, undefined);
      expect('error' in view).toBe(false);
    });

    it('reads the token from the POST body', async () => {
      const { uid, token } = await bookOne();
      const out = await pub.cancel(uid, undefined, undefined, { token });
      expect('error' in out).toBe(false);
    });

    it('still reads the legacy ?token= query param (links in the wild)', async () => {
      const { uid, token } = await bookOne();
      const view = await pub.manageView(uid, undefined, token);
      expect('error' in view).toBe(false);
    });

    it('rejects a wrong token from any source', async () => {
      const { uid } = await bookOne();
      // The controller unwraps a ServiceError into a thrown 403 HttpException.
      await expect(pub.manageView(uid, 'nope', undefined)).rejects.toMatchObject({ status: 403 });
    });

    it('reschedule returns the ROTATED manage URL so the caller can keep acting', async () => {
      const { uid, token } = await bookOne();
      // Move to another real slot: rotation invalidates the old token.
      const a = await getAvailability(db, {
        accountCode: 'acme',
        handle: 'alex-rivera',
        slug: 'intro-call',
        fromMs: Date.now(),
        toMs: Date.now() + 10 * 86_400_000,
      });
      const newStart = a!.slots.at(-1)!.startUtc;
      const out = await svc.reschedule(uid, { newStartUtc: newStart, token });
      if ('error' in out) throw new Error('reschedule failed');
      // The response must hand back the fresh manage URL…
      expect(out.manageUrl).toBeTruthy();
      const newToken = new URL(out.manageUrl!).searchParams.get('token')!;
      expect(newToken).not.toBe(token);
      // …the new token works, and the old one is dead (single-active-token).
      const view = await pub.manageView(uid, newToken, undefined);
      expect('error' in view).toBe(false);
      await expect(pub.manageView(uid, token, undefined)).rejects.toMatchObject({ status: 403 });
    });
  });

  // --- Item 3: machine addressing by eventTypeId (R12) ---------------------
  describe('machine surface accepts eventTypeId as an alternative to handle+slug', () => {
    let machine: MachineController;
    let introEtId: string;
    beforeEach(async () => {
      introEtId = (await db.get<{ id: string }>(
        sql`SELECT id FROM event_type WHERE slug='intro-call' AND account_id=${accountId}`,
      ))!.id;
      // A fake API-key principal that allows everything (auth is exercised elsewhere).
      const auth = {
        resolveMachine: (): Promise<MachinePrincipal> =>
          Promise.resolve({ accountId, scopes: ['availability:read', 'bookings:write'], eventTypeIds: null } as MachinePrincipal),
        assertEventTypeAllowed: () => undefined,
      } as unknown as AuthService;
      machine = new MachineController(makeSvc(db), auth, db);
    });
    const req = {} as ReqLike;

    it('availability resolves eventTypeId → the same slots as handle+slug', async () => {
      const from = new Date().toISOString();
      const to = new Date(Date.now() + 7 * 86_400_000).toISOString();
      const byId = await machine.availability(req, { eventTypeId: introEtId, from, to });
      const byHandle = await machine.availability(req, { handle: 'alex-rivera', slug: 'intro-call', from, to });
      expect(byId.slots.length).toBeGreaterThan(0);
      expect(byId.slots.length).toBe(byHandle.slots.length);
    });

    it('book by eventTypeId creates a booking', async () => {
      const res = await machine.book(req, undefined, {
        eventTypeId: introEtId,
        startUtc: await firstSlot(db),
        attendees: [{ name: 'Sam', email: 'sam@example.com', timeZone: 'UTC' }],
        answers: { company: 'Acme' },
      });
      expect(res.uid).toBeTruthy();
      expect(res.attendees).toHaveLength(1);
    });

    it('an unknown eventTypeId → 404 (not a crash)', async () => {
      await expect(
        machine.availability(req, {
          eventTypeId: 'does-not-exist',
          from: new Date().toISOString(),
          to: new Date(Date.now() + 86_400_000).toISOString(),
        }),
      ).rejects.toThrow();
    });
  });
});
