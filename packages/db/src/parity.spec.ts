import { describe, it, expect, beforeEach } from 'vitest';
import { hashManageToken } from '@slate/engine';
import { createDb, type Db } from './client';
import { migrate } from './migrate';
import { seed } from './seed';
import { createBooking, getAvailability } from './repository';
import {
  cancelBooking,
  checkHandleAvailable,
  confirmBooking,
  createApiKey,
  createConnection,
  deleteConnection,
  updateConnection,
  createTeamBooking,
  createWebhook,
  dispatchWebhooks,
  getTeamAvailability,
  getTeamProfile,
  listBookings,
  rescheduleBooking,
  reserveSlot,
  resolveBooking,
  updateBranding,
  verifyApiKey,
} from './parity';
import { createEventType, createTeam, setEventTypeHosts, updateEventType } from './crud';

async function firstSlotMs(db: Db, slug = 'intro-call'): Promise<number> {
  const a = await getAvailability(db, {
    accountCode: 'acme',
    handle: 'alex-rivera',
    slug,
    fromMs: Date.now(),
    toMs: Date.now() + 10 * 86_400_000,
  });
  return new Date(a!.slots[0]!.startUtc).getTime();
}

describe('parity (SQLite in-memory)', () => {
  let db: Db;
  let accountId: string;
  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    await seed(db);
    accountId = (await db.get<{ id: string }>((await import('drizzle-orm')).sql`SELECT id FROM account WHERE code='acme'`))!.id;
  });

  it('F5: an event type Location is snapshotted onto booking.location at book time', async () => {
    const { sql } = await import('drizzle-orm');
    const et = (await db.get<{ id: string }>(sql`SELECT id FROM event_type WHERE slug='intro-call' LIMIT 1`))!;
    await updateEventType(db, accountId, et.id, { location: 'Google Meet' });

    const startMs = await firstSlotMs(db);
    const out = await createBooking(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      startMs,
      attendee: { name: 'Sam', email: 'sam@example.com', timeZone: 'America/New_York' },
      answers: { company: 'Acme' },
    });
    expect(out.ok).toBe(true);
    const uid = (out as { booking: { uid: string } }).booking.uid;
    const row = await db.get<{ location: string | null }>(sql`SELECT location FROM booking WHERE uid = ${uid} LIMIT 1`);
    // The chain event editor → event_type.locations → booking.location is closed.
    expect(row?.location).toBe('Google Meet');
  });

  it('F5 (team): a team event type Location is snapshotted onto booking.location too', async () => {
    const { sql } = await import('drizzle-orm');
    // Seed has a round-robin team event type (team_id set).
    const et = await db.get<{ id: string; slug: string }>(sql`SELECT id, slug FROM event_type WHERE team_id IS NOT NULL LIMIT 1`);
    if (!et) return; // no team event in seed → nothing to assert
    await updateEventType(db, accountId, et.id, { location: 'Zoom' });
    const team = (await db.get<{ slug: string }>(sql`SELECT slug FROM team LIMIT 1`))!;
    const now = Date.now();
    const avail = await getTeamAvailability(db, {
      accountCode: 'acme',
      teamSlug: team.slug,
      slug: et.slug,
      fromMs: now,
      toMs: now + 21 * 86_400_000,
    });
    const startMs = new Date(avail!.slots[0]!).getTime();
    const out = await createTeamBooking(db, {
      accountCode: 'acme',
      teamSlug: team.slug,
      slug: et.slug,
      startMs,
      attendee: { name: 'Sam', email: 'sam@example.com', timeZone: 'UTC' },
    });
    expect(out.ok).toBe(true);
    const uid = (out as { uid: string }).uid;
    const row = await db.get<{ location: string | null }>(sql`SELECT location FROM booking WHERE uid = ${uid} LIMIT 1`);
    expect(row?.location).toBe('Zoom');
  });

  it('rejects a booking missing a required intake field', async () => {
    const startMs = await firstSlotMs(db);
    const out = await createBooking(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      startMs,
      attendee: { name: 'Sam', email: 'sam@example.com', timeZone: 'America/New_York' },
      // no company → INVALID
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('INVALID');
  });

  it('reserving a slot blocks it from availability, and booking consumes the hold', async () => {
    const startMs = await firstSlotMs(db);
    const held = await reserveSlot(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      startMs,
    });
    expect(held.ok).toBe(true);
    if (!held.ok) throw new Error('setup');
    // The held instant is no longer offered.
    const a = await getAvailability(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      fromMs: Date.now(),
      toMs: Date.now() + 10 * 86_400_000,
    });
    expect(a!.slots.map((s) => new Date(s.startUtc).getTime())).not.toContain(startMs);
    // Booking with the reservation succeeds and releases the hold.
    const out = await createBooking(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      startMs,
      attendee: { name: 'Sam', email: 'sam@example.com', timeZone: 'America/New_York' },
      answers: { company: 'Acme' },
      reservationUid: held.uid,
    });
    expect(out.ok).toBe(true);
  });

  it('booking with an EXPIRED hold is rejected (410 path)', async () => {
    const { sql } = await import('drizzle-orm');
    const startMs = await firstSlotMs(db);
    const held = await reserveSlot(db, { accountCode: 'acme', handle: 'alex-rivera', slug: 'intro-call', startMs });
    // Force the hold to be expired.
    await db.run(sql`UPDATE slot_reservation SET release_at_ms = ${Date.now() - 1000} WHERE uid = ${held!.uid}`);
    const out = await createBooking(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      startMs,
      attendee: { name: 'Sam', email: 'sam@example.com', timeZone: 'America/New_York' },
      answers: { company: 'Acme' },
      reservationUid: held!.uid,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('RESERVATION_EXPIRED');
  });

  it('M5 — reserveSlot rejects an instant that is not a real bookable slot', async () => {
    // 03:17 on the first offered day is never an offered slot (outside 9–17 and
    // off the 30-min grid) → INVALID_SLOT, so holds can't blank out availability.
    const startMs = await firstSlotMs(db);
    const bogus = startMs + 137 * 60_000 + 999; // off-grid, unaligned
    const out = await reserveSlot(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      startMs: bogus,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('INVALID_SLOT');
  });

  it('M5 — reserveSlot caps concurrent holds per page (rate limit)', async () => {
    const avail = await getAvailability(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      fromMs: Date.now(),
      toMs: Date.now() + 10 * 86_400_000,
    });
    const slots = avail!.slots.map((s) => new Date(s.startUtc).getTime());
    let ok = 0;
    let limited = 0;
    // Try to hold more distinct real slots than the cap allows.
    for (const s of slots.slice(0, 15)) {
      const r = await reserveSlot(db, { accountCode: 'acme', handle: 'alex-rivera', slug: 'intro-call', startMs: s });
      if (r.ok) ok++;
      else if (r.reason === 'RATE_LIMITED') limited++;
    }
    expect(ok).toBeLessThanOrEqual(10); // MAX_ACTIVE_HOLDS_PER_MEMBER
    expect(limited).toBeGreaterThan(0);
  });

  it('R23 group event: seats fill up to capacity, then the slot is full', async () => {
    // A 3-seat group event on the host's default schedule.
    const memberId = (await db.get<{ id: string }>(
      (await import('drizzle-orm')).sql`SELECT id FROM member WHERE handle='alex-rivera'`,
    ))!.id;
    const et = await createEventType(db, accountId, memberId, {
      slug: 'group-webinar',
      title: 'Group Webinar',
      lengthMinutes: 30,
      seatsPerTimeSlot: 3,
    });
    expect(et.ok).toBe(true);
    const startMs = await firstSlotMs(db, 'group-webinar');

    const book = (n: number) =>
      createBooking(db, {
        accountCode: 'acme',
        handle: 'alex-rivera',
        slug: 'group-webinar',
        startMs,
        attendee: { name: `Guest ${n}`, email: `g${n}@example.com`, timeZone: 'UTC' },
      });

    expect((await book(1)).ok).toBe(true);
    // The slot is still offered with fewer seats after one booking.
    const midAvail = await getAvailability(db, {
      accountCode: 'acme', handle: 'alex-rivera', slug: 'group-webinar',
      fromMs: Date.now(), toMs: Date.now() + 10 * 86_400_000,
    });
    const midSlot = midAvail!.slots.find((s) => new Date(s.startUtc).getTime() === startMs);
    expect(midSlot?.spotsLeft).toBe(2);
    expect(midSlot?.capacity).toBe(3);

    expect((await book(2)).ok).toBe(true);
    expect((await book(3)).ok).toBe(true);

    // Capacity reached → the slot is no longer offered, and a 4th booking is rejected.
    const fullAvail = await getAvailability(db, {
      accountCode: 'acme', handle: 'alex-rivera', slug: 'group-webinar',
      fromMs: Date.now(), toMs: Date.now() + 10 * 86_400_000,
    });
    expect(fullAvail!.slots.some((s) => new Date(s.startUtc).getTime() === startMs)).toBe(false);
    const overflow = await book(4);
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) expect(overflow.reason).toBe('SLOT_TAKEN');
  });

  it('deleteConnection guards the LAST destination (must keep one)', async () => {
    const memberId = (await db.get<{ id: string }>(
      (await import('drizzle-orm')).sql`SELECT id FROM member WHERE handle='alex-rivera'`,
    ))!.id;
    const only = await createConnection(db, {
      accountId,
      memberId,
      provider: 'google',
      externalId: 'cal-1@example.com',
      isDestination: true,
      checkConflicts: true,
    });
    // The sole destination cannot be deleted.
    const blocked = await deleteConnection(db, memberId, only.id);
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe('LAST_DESTINATION_REQUIRED');
    // Unset it as a destination → now deletable.
    await updateConnection(db, memberId, only.id, { isDestination: false });
    const ok = await deleteConnection(db, memberId, only.id);
    expect(ok.ok).toBe(true);
  });

  it('reschedule verifies the manage token, moves the booking, and rotates the token', async () => {
    const startMs = await firstSlotMs(db);
    const created = await createBooking(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      startMs,
      attendee: { name: 'Sam', email: 'sam@example.com', timeZone: 'America/New_York' },
      answers: { company: 'Acme' },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const token = created.manageToken;

    // Wrong token is rejected.
    const bad = await rescheduleBooking(db, { uid: created.booking.uid, newStartMs: startMs + 3 * 86_400_000, manageToken: 'nope' });
    expect(bad.ok).toBe(false);

    // Pick the move target from REAL availability on a later day — arithmetic
    // (+3d+1h) is time-of-day dependent: run after ~16:00 host time, the first
    // slot is late enough that +1h lands outside working hours and the
    // reschedule legitimately fails. Deterministic: first slot >= next day.
    const later = await getAvailability(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      fromMs: startMs + 86_400_000,
      toMs: startMs + 7 * 86_400_000,
    });
    const newStart = new Date(later!.slots[0]!.startUtc).getTime();
    const moved = await rescheduleBooking(db, { uid: created.booking.uid, newStartMs: newStart, manageToken: token });
    expect(moved.ok).toBe(true);
    if (moved.ok) {
      // Old token no longer valid (rotated); new one is.
      const b = await resolveBooking(db, created.booking.uid);
      const meta = JSON.parse(String(b!.metadata)) as { _manage: { tokenHash: string } };
      expect(meta._manage.tokenHash).toBe(hashManageToken(moved.manageToken!));
      expect(meta._manage.tokenHash).not.toBe(hashManageToken(token));
    }
  });

  it('cancel verifies token and transitions status (never deletes)', async () => {
    const startMs = await firstSlotMs(db);
    const created = await createBooking(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      startMs,
      attendee: { name: 'Sam', email: 'sam@example.com', timeZone: 'America/New_York' },
      answers: { company: 'Acme' },
    });
    if (!created.ok) throw new Error('setup');
    const out = await cancelBooking(db, { uid: created.booking.uid, manageToken: created.manageToken, reason: 'test' });
    expect(out.ok).toBe(true);
    const b = await resolveBooking(db, created.booking.uid);
    expect(b?.status).toBe('cancelled');
  });

  it('team round-robin: availability unions hosts, booking assigns a free host', async () => {
    const profile = await getTeamProfile(db, 'acme', 'sales');
    expect(profile?.eventTypes.map((e) => e.slug)).toContain('team-demo');
    const avail = await getTeamAvailability(db, {
      accountCode: 'acme',
      teamSlug: 'sales',
      slug: 'team-demo',
      fromMs: Date.now(),
      toMs: Date.now() + 10 * 86_400_000,
    });
    expect(avail!.slots.length).toBeGreaterThan(0);
    const out = await createTeamBooking(db, {
      accountCode: 'acme',
      teamSlug: 'sales',
      slug: 'team-demo',
      startMs: new Date(avail!.slots[0]!).getTime(),
      attendee: { name: 'Sam', email: 'sam@example.com', timeZone: 'America/New_York' },
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.hostMemberId).toBeTruthy();
  });

  it('handle-available: taken vs free vs reserved', async () => {
    expect((await checkHandleAvailable(db, accountId, 'alex-rivera')).available).toBe(false);
    expect((await checkHandleAvailable(db, accountId, 'brand-new-handle')).available).toBe(true);
    expect((await checkHandleAvailable(db, accountId, 'api')).reason).toBe('reserved');
  });

  it('requiresConfirmation → booking is pending, host confirm → accepted', async () => {
    const { createEventType } = await import('./crud');
    const account = await db.get<{ id: string }>((await import('drizzle-orm')).sql`SELECT id FROM account WHERE code='acme'`);
    const member = await db.get<{ id: string }>((await import('drizzle-orm')).sql`SELECT id FROM member WHERE handle='alex-rivera'`);
    const created = await createEventType(db, account!.id, member!.id, {
      slug: 'confirm-me',
      title: 'Needs Confirmation',
      lengthMinutes: 30,
      requiresConfirmation: true,
      scheduleId: null,
    });
    expect(created.ok).toBe(true);
    const av = await getAvailability(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'confirm-me',
      fromMs: Date.now(),
      toMs: Date.now() + 10 * 86_400_000,
    });
    const out = await createBooking(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'confirm-me',
      startMs: new Date(av!.slots[0]!.startUtc).getTime(),
      attendee: { name: 'Sam', email: 'sam@example.com', timeZone: 'America/New_York' },
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.booking.status).toBe('pending');
      const { confirmBooking } = await import('./parity');
      const conf = await confirmBooking(db, out.booking.uid);
      expect(conf.ok).toBe(true);
      const b = await resolveBooking(db, out.booking.uid);
      expect(b?.status).toBe('accepted');
    }
  });

  it('dispatchWebhooks signs the body with HMAC and posts to subscribers', async () => {
    const { createWebhook, dispatchWebhooks } = await import('./parity');
    await createWebhook(db, {
      accountId,
      // Public IP literal → the SSRF guard passes without a real DNS lookup,
      // keeping this HMAC assertion deterministic and offline-safe.
      subscriberUrl: 'https://198.51.100.10/hook',
      eventTriggers: ['booking.created'],
      secret: 's3cret',
    });
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const fakeFetch = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
      calls.push({ url, headers: init.headers, body: init.body });
      return { ok: true } as Response;
    }) as unknown as typeof fetch;
    const sent = await dispatchWebhooks(db, accountId, 'booking.created', { uid: 'x' }, fakeFetch);
    expect(sent).toBe(1);
    expect(calls[0]!.headers['X-Slate-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    // A non-matching event fires nothing.
    const none = await dispatchWebhooks(db, accountId, 'booking.cancelled', {}, fakeFetch);
    expect(none).toBe(0);
  });

  it('branding persists and api keys verify', async () => {
    const memberId = (await db.get<{ id: string }>((await import('drizzle-orm')).sql`SELECT id FROM member WHERE handle='alex-rivera'`))!.id;
    await updateBranding(db, memberId, { brandColor: '#123456', style: { density: 'compact' } });
    const m = await db.get<{ brand_color: string }>((await import('drizzle-orm')).sql`SELECT brand_color FROM member WHERE id=${memberId}`);
    expect(m?.brand_color).toBe('#123456');

    const key = await createApiKey(db, { accountId, name: 'test', scopes: ['availability:read'] });
    const principal = await verifyApiKey(db, key.plaintext);
    expect(principal?.accountId).toBe(accountId);
    expect(principal?.scopes).toContain('availability:read');
    expect(await verifyApiKey(db, 'wrong')).toBeNull();
  });

  it('M4 — listBookings honors an event-type allowlist (machine scope-leak fix)', async () => {
    const memberId = (await db.get<{ id: string }>((await import('drizzle-orm')).sql`SELECT id FROM member WHERE handle='alex-rivera'`))!.id;

    // Book the seeded intro-call at a free slot.
    const s1 = await firstSlotMs(db, 'intro-call');
    const b1 = await createBooking(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'intro-call',
      startMs: s1,
      attendee: { name: 'Sam', email: 'sam@example.com', timeZone: 'America/New_York' },
      answers: { company: 'Acme' },
    });
    expect(b1.ok).toBe(true);

    // A second event type + a booking under it.
    await createEventType(db, accountId, memberId, {
      slug: 'second-evt',
      title: 'Second',
      lengthMinutes: 30,
      scheduleId: null,
    });
    const av2 = await getAvailability(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'second-evt',
      fromMs: Date.now(),
      toMs: Date.now() + 10 * 86_400_000,
    });
    const b2 = await createBooking(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'second-evt',
      startMs: new Date(av2!.slots[0]!.startUtc).getTime(),
      attendee: { name: 'Pat', email: 'pat@example.com', timeZone: 'America/New_York' },
    });
    expect(b2.ok).toBe(true);

    const introEtId = (await db.get<{ id: string }>((await import('drizzle-orm')).sql`SELECT id FROM event_type WHERE slug='intro-call' AND account_id=${accountId}`))!.id;

    const all = await listBookings(db, { accountId });
    const scoped = await listBookings(db, { accountId, eventTypeIds: [introEtId] });
    const none = await listBookings(db, { accountId, eventTypeIds: [] });

    expect(none.items.length).toBe(0); // empty allowlist → nothing
    expect(scoped.items.length).toBeGreaterThan(0);
    expect(scoped.items.length).toBeLessThan(all.items.length); // second-evt excluded
  });

  it('M4 — createWebhook auto-mints a signing secret; dispatch signs with it', async () => {
    const wh = await createWebhook(db, {
      accountId,
      subscriberUrl: 'https://198.51.100.11/hook',
      eventTriggers: ['booking.created'],
    });
    expect(wh.secret).toMatch(/^whsec_/);

    const calls: Array<{ headers: Record<string, string> }> = [];
    const fakeFetch = (async (_url: string, init: { headers: Record<string, string> }) => {
      calls.push({ headers: init.headers });
      return { ok: true } as Response;
    }) as unknown as typeof fetch;
    const sent = await dispatchWebhooks(db, accountId, 'booking.created', { uid: 'x' }, fakeFetch);
    expect(sent).toBe(1);
    expect(calls[0]!.headers['X-Slate-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it('H1 — a pending booking HOLDS the slot: a second booking at the same slot is rejected', async () => {
    const memberId = (await db.get<{ id: string }>((await import('drizzle-orm')).sql`SELECT id FROM member WHERE handle='alex-rivera'`))!.id;
    await createEventType(db, accountId, memberId, {
      slug: 'confirm-hold',
      title: 'Confirm Hold',
      lengthMinutes: 30,
      requiresConfirmation: true,
      scheduleId: null,
    });
    const av = await getAvailability(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'confirm-hold',
      fromMs: Date.now(),
      toMs: Date.now() + 10 * 86_400_000,
    });
    const startMs = new Date(av!.slots[0]!.startUtc).getTime();
    const first = await createBooking(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'confirm-hold',
      startMs,
      attendee: { name: 'Sam', email: 'sam@example.com', timeZone: 'America/New_York' },
    });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.booking.status).toBe('pending');
    // A second booking at the same instant must NOT be created — the pending
    // booking holds the slot (this is what the PG EXCLUDE now enforces too).
    const second = await createBooking(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'confirm-hold',
      startMs,
      attendee: { name: 'Pat', email: 'pat@example.com', timeZone: 'America/New_York' },
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('SLOT_TAKEN');
  });

  it('H2 — a team booking cannot overlap a host’s pending personal booking', async () => {
    const memberId = (await db.get<{ id: string }>((await import('drizzle-orm')).sql`SELECT id FROM member WHERE handle='alex-rivera'`))!.id;

    // A team whose ONLY host is alex-rivera.
    const team = await createTeam(db, accountId, { name: 'Solo', slug: 'solo' });
    expect(team.ok).toBe(true);
    if (!team.ok) return;
    const ev = await createEventType(db, accountId, null, {
      slug: 'solo-demo',
      title: 'Solo Demo',
      lengthMinutes: 30,
      schedulingType: 'round_robin',
      scheduleId: null,
      teamId: team.value.id,
    });
    expect(ev.ok).toBe(true);
    if (!ev.ok) return;
    await setEventTypeHosts(db, accountId, ev.value.id, [memberId]);

    const avail = await getTeamAvailability(db, {
      accountCode: 'acme',
      teamSlug: 'solo',
      slug: 'solo-demo',
      fromMs: Date.now(),
      toMs: Date.now() + 10 * 86_400_000,
    });
    const slotX = new Date(avail!.slots[0]!).getTime();

    // Give alex a PENDING personal booking at slotX.
    await createEventType(db, accountId, memberId, {
      slug: 'pers-confirm',
      title: 'Personal Confirm',
      lengthMinutes: 30,
      requiresConfirmation: true,
      scheduleId: null,
    });
    const pending = await createBooking(db, {
      accountCode: 'acme',
      handle: 'alex-rivera',
      slug: 'pers-confirm',
      startMs: slotX,
      attendee: { name: 'Sam', email: 'sam@example.com', timeZone: 'America/New_York' },
    });
    expect(pending.ok).toBe(true);
    if (pending.ok) expect(pending.booking.status).toBe('pending');

    // The team booking at slotX must fail — the only host is held by a pending.
    const teamBooked = await createTeamBooking(db, {
      accountCode: 'acme',
      teamSlug: 'solo',
      slug: 'solo-demo',
      startMs: slotX,
      attendee: { name: 'Pat', email: 'pat@example.com', timeZone: 'America/New_York' },
    });
    expect(teamBooked.ok).toBe(false);
    if (!teamBooked.ok) expect(teamBooked.reason).toBe('SLOT_TAKEN');

    // Sanity: confirming the pending keeps the invariant (no crash / still one).
    if (pending.ok) {
      const conf = await confirmBooking(db, pending.booking.uid, accountId);
      expect(conf.ok).toBe(true);
    }
  });
});
