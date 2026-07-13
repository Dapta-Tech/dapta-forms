import { describe, it, expect } from 'vitest';
import { DisabledCalendarProvider, InMemoryCalendarProvider } from './index';

describe('DisabledCalendarProvider', () => {
  it('is disabled and returns no busy / no-ops writes', async () => {
    const p = new DisabledCalendarProvider();
    expect(p.enabled).toBe(false);
    expect(await p.listBusy({ connectionRefs: ['x'], fromUtc: 'a', toUtc: 'b' })).toEqual([]);
    const evt = await p.createEvent({
      connectionRef: 'x',
      title: 't',
      startUtc: '2026-08-01T14:00:00.000Z',
      endUtc: '2026-08-01T14:30:00.000Z',
      attendeeEmails: [],
    });
    expect(evt.externalEventId).toContain('disabled');
    // New port surface stays a strict no-op on the OSS default.
    const moved = await p.updateEvent({
      connectionRef: 'x',
      externalEventId: 'evt-existing',
      title: 't',
      startUtc: '2026-08-01T15:00:00.000Z',
      endUtc: '2026-08-01T15:30:00.000Z',
      attendeeEmails: [],
    });
    expect(moved.externalEventId).toBe('evt-existing');
    expect(await p.listCalendars('x')).toEqual([]);
    expect((await p.checkConnection('x')).ok).toBe(false);
  });
});

describe('InMemoryCalendarProvider', () => {
  it('returns seeded busy overlapping the window and records writes', async () => {
    const p = new InMemoryCalendarProvider();
    p.seedBusy('cal-1', [{ startUtc: '2026-08-01T14:00:00.000Z', endUtc: '2026-08-01T15:00:00.000Z' }]);
    const busy = await p.listBusy({
      connectionRefs: ['cal-1'],
      fromUtc: '2026-08-01T00:00:00.000Z',
      toUtc: '2026-08-02T00:00:00.000Z',
    });
    expect(busy).toHaveLength(1);
    await p.createEvent({
      connectionRef: 'cal-1',
      title: 't',
      startUtc: '2026-08-01T14:00:00.000Z',
      endUtc: '2026-08-01T14:30:00.000Z',
      attendeeEmails: ['a@example.com'],
    });
    expect(p.created).toHaveLength(1);
  });

  it('records a move (updateEvent) keeping the same external id, and lists seeded calendars', async () => {
    const p = new InMemoryCalendarProvider();
    p.seedCalendars('conn-1', [
      { id: 'cal-primary', name: 'Work', primaryEmail: 'me@example.com', isPrimary: true },
      { id: 'cal-other', name: 'Personal' },
    ]);
    expect(await p.listCalendars('conn-1')).toHaveLength(2);
    expect((await p.checkConnection('conn-1')).ok).toBe(true);

    const moved = await p.updateEvent({
      connectionRef: 'cal-1',
      externalEventId: 'evt-7',
      title: 't',
      startUtc: '2026-08-01T16:00:00.000Z',
      endUtc: '2026-08-01T16:30:00.000Z',
      attendeeEmails: ['a@example.com'],
    });
    expect(moved.externalEventId).toBe('evt-7');
    expect(p.updated).toHaveLength(1);
  });
});
