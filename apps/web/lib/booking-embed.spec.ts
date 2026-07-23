/**
 * Unit tests for the booking postMessage parsing/listener wiring and the
 * booking-callback POST helper. Synthetic `{origin, data}` message events
 * mirror exactly what the QA e2e will simulate via `window.postMessage`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachBookingMessageListener,
  parseBookingMessage,
  postBookingCallback,
  type BookingScheduledDetails,
} from './booking-embed';

const CALENDLY_ORIGIN = 'https://calendly.com';
const EVENT_URI = 'https://api.calendly.com/scheduled_events/EV123';
const INVITEE_URI = 'https://api.calendly.com/scheduled_events/EV123/invitees/INV456';

function calendlyScheduled(payload: Record<string, unknown>) {
  return { event: 'calendly.event_scheduled', payload };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseBookingMessage — calendly', () => {
  it('parses a full event_scheduled payload (event/invitee URIs + start time)', () => {
    const details = parseBookingMessage('calendly', {
      origin: CALENDLY_ORIGIN,
      data: calendlyScheduled({
        event: { uri: EVENT_URI, start_time: '2026-08-01T15:00:00Z' },
        invitee: { uri: INVITEE_URI },
      }),
    });
    expect(details).toEqual({
      provider: 'calendly',
      eventUri: EVENT_URI,
      inviteeUri: INVITEE_URI,
      startTime: '2026-08-01T15:00:00.000Z',
    });
  });

  it('derives the event URI from the invitee URI when absent', () => {
    const details = parseBookingMessage('calendly', {
      origin: CALENDLY_ORIGIN,
      data: calendlyScheduled({ invitee: { uri: INVITEE_URI } }),
    });
    expect(details?.eventUri).toBe(EVENT_URI);
    expect(details?.inviteeUri).toBe(INVITEE_URI);
  });

  it('still reports booked on a URI-less scheduled event', () => {
    const details = parseBookingMessage('calendly', {
      origin: CALENDLY_ORIGIN,
      data: calendlyScheduled({}),
    });
    expect(details).toEqual({ provider: 'calendly' });
  });

  it('rejects non-allowlisted origins', () => {
    expect(
      parseBookingMessage('calendly', {
        origin: 'https://evil.example.com',
        data: calendlyScheduled({ invitee: { uri: INVITEE_URI } }),
      }),
    ).toBeNull();
  });

  it('ignores other calendly widget events and malformed data', () => {
    expect(
      parseBookingMessage('calendly', {
        origin: CALENDLY_ORIGIN,
        data: { event: 'calendly.profile_page_viewed' },
      }),
    ).toBeNull();
    expect(parseBookingMessage('calendly', { origin: CALENDLY_ORIGIN, data: 'nope' })).toBeNull();
    expect(parseBookingMessage('calendly', { origin: CALENDLY_ORIGIN, data: null })).toBeNull();
  });

  it('drops non-http(s) URIs and unparseable start times', () => {
    const details = parseBookingMessage('calendly', {
      origin: CALENDLY_ORIGIN,
      data: calendlyScheduled({
        event: { uri: 'javascript' + ':alert(1)', start_time: 'not-a-date' },
        invitee: { uri: INVITEE_URI },
      }),
    });
    // eventUri falls back to the one derived from the (valid) invitee URI.
    expect(details).toEqual({ provider: 'calendly', eventUri: EVENT_URI, inviteeUri: INVITEE_URI });
  });
});

describe('parseBookingMessage — hubspot_meetings', () => {
  const HS_ORIGIN = 'https://meetings.hubspot.com';

  it.each([
    ['meetingBookSucceeded flag', { meetingBookSucceeded: true }],
    ['hsMeetingBookSuccess type', { type: 'hsMeetingBookSuccess' }],
    ['meetingBooked eventName', { eventName: 'meetingBooked' }],
  ])('recognizes the %s shape', (_label, data) => {
    expect(parseBookingMessage('hubspot_meetings', { origin: HS_ORIGIN, data })).toEqual({
      provider: 'hubspot_meetings',
    });
  });

  it('accepts app.hubspot.com as an origin and extracts an epoch startTime', () => {
    const details = parseBookingMessage('hubspot_meetings', {
      origin: 'https://app.hubspot.com',
      data: { meetingBookSucceeded: true, meetingPayload: { startTime: 1785942000000 } },
    });
    expect(details).toEqual({
      provider: 'hubspot_meetings',
      startTime: new Date(1785942000000).toISOString(),
    });
  });

  it('rejects non-allowlisted origins and non-booked payloads', () => {
    expect(
      parseBookingMessage('hubspot_meetings', {
        origin: 'https://evil.example.com',
        data: { meetingBookSucceeded: true },
      }),
    ).toBeNull();
    expect(
      parseBookingMessage('hubspot_meetings', {
        origin: HS_ORIGIN,
        data: { type: 'hsMeetingViewed' },
      }),
    ).toBeNull();
    expect(parseBookingMessage('hubspot_meetings', { origin: HS_ORIGIN, data: null })).toBeNull();
  });

  it('does not treat a calendly payload as a hubspot booking (provider gating)', () => {
    expect(
      parseBookingMessage('hubspot_meetings', {
        origin: CALENDLY_ORIGIN,
        data: calendlyScheduled({ invitee: { uri: INVITEE_URI } }),
      }),
    ).toBeNull();
  });
});

describe('attachBookingMessageListener', () => {
  /** Minimal window stand-in that captures 'message' listeners. */
  function fakeWindow() {
    const listeners = new Set<(event: MessageEvent) => void>();
    return {
      listeners,
      addEventListener: (_type: string, fn: (event: MessageEvent) => void) => listeners.add(fn),
      removeEventListener: (_type: string, fn: (event: MessageEvent) => void) =>
        listeners.delete(fn),
      dispatch(origin: string, data: unknown) {
        for (const fn of [...listeners]) fn({ origin, data } as MessageEvent);
      },
    };
  }

  it('fires the handler once with the parsed details, ignoring noise and echoes', () => {
    const win = fakeWindow();
    vi.stubGlobal('window', win);
    const seen: BookingScheduledDetails[] = [];
    attachBookingMessageListener('calendly', (d) => seen.push(d));

    win.dispatch(CALENDLY_ORIGIN, { event: 'calendly.date_and_time_selected' }); // noise
    win.dispatch('https://evil.example.com', calendlyScheduled({ invitee: { uri: INVITEE_URI } }));
    win.dispatch(CALENDLY_ORIGIN, calendlyScheduled({ invitee: { uri: INVITEE_URI } }));
    win.dispatch(CALENDLY_ORIGIN, calendlyScheduled({ invitee: { uri: INVITEE_URI } })); // echo

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ provider: 'calendly', eventUri: EVENT_URI, inviteeUri: INVITEE_URI });
  });

  it('detaches the listener when the returned function is called', () => {
    const win = fakeWindow();
    vi.stubGlobal('window', win);
    const handler = vi.fn();
    const detach = attachBookingMessageListener('hubspot_meetings', handler);
    expect(win.listeners.size).toBe(1);

    detach();
    expect(win.listeners.size).toBe(0);
    win.dispatch('https://meetings.hubspot.com', { meetingBookSucceeded: true });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('postBookingCallback', () => {
  it('POSTs the callback payload to the public booking endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    await postBookingCallback('acme', 'lead-qualifier', {
      sessionId: 'sess-1',
      provider: 'calendly',
      eventUri: EVENT_URI,
      inviteeUri: INVITEE_URI,
      startTime: '2026-08-01T15:00:00.000Z',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/v1/public/forms/acme/lead-qualifier/booking');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      sessionId: 'sess-1',
      provider: 'calendly',
      eventUri: EVENT_URI,
      inviteeUri: INVITEE_URI,
      startTime: '2026-08-01T15:00:00.000Z',
    });
  });

  it('is best-effort: a network failure never throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(
      postBookingCallback('acme', 'lead-qualifier', { sessionId: 's', provider: 'calendly' }),
    ).resolves.toBeUndefined();
  });
});
