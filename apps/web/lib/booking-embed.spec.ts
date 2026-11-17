/**
 * Unit tests for the booking postMessage parsing/listener wiring and the
 * booking-callback POST helper. Synthetic `{origin, data}` message events
 * mirror exactly what the QA e2e will simulate via `window.postMessage`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachBookingMessageListener,
  dcalMessageOrigin,
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

  it('forwards the visitor chain when given one, and omits the header when not', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    await postBookingCallback(
      'acme',
      'lead-qualifier',
      { sessionId: 's', provider: 'calendly' },
      '203.0.113.7, 10.0.0.2',
    );
    let [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ 'x-forwarded-for': '203.0.113.7, 10.0.0.2' });

    await postBookingCallback('acme', 'lead-qualifier', { sessionId: 's', provider: 'calendly' });
    [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty('x-forwarded-for');
  });
});

// --- dCal ------------------------------------------------------------------
// Its booked signal is shaped like Calendly's on purpose (`event` keyed with a
// dot, a `payload` beside it), but the origin it comes from is per-deployment,
// so the allowlist is the booking page that was actually embedded rather than
// a constant. These pin that: the right origin is believed, every other one is
// not, and a screen with no configured origin believes nothing at all.

const DCAL_ORIGIN = 'https://cal.example.test';
const DCAL_URL = `${DCAL_ORIGIN}/acme/ana/intro-call?embed=1`;
const START = '2026-12-01T15:00:00.000Z';

function dcalScheduled(payload: Record<string, unknown>) {
  return { event: 'dapta-calendars.booking_scheduled', payload };
}

describe('dcalMessageOrigin', () => {
  it('is the origin of the booking URL that was embedded', () => {
    expect(dcalMessageOrigin(DCAL_URL)).toBe(DCAL_ORIGIN);
    expect(dcalMessageOrigin('http://localhost:3100/acme/ana/intro')).toBe('http://localhost:3100');
  });

  it('is null for a URL that is unusable or not http(s)', () => {
    expect(dcalMessageOrigin(undefined)).toBeNull();
    expect(dcalMessageOrigin('')).toBeNull();
    expect(dcalMessageOrigin('not a url')).toBeNull();
    expect(dcalMessageOrigin('javascript:alert(1)')).toBeNull();
  });
});

describe('parseBookingMessage: dcal', () => {
  it('reads the uid and the start from the embedded page’s own origin', () => {
    expect(
      parseBookingMessage(
        'dcal',
        { origin: DCAL_ORIGIN, data: dcalScheduled({ uid: 'bk_123', startUtc: START, eventTypeSlug: 'intro-call' }) },
        DCAL_ORIGIN,
      ),
    ).toEqual({ provider: 'dcal', bookingUid: 'bk_123', startTime: START });
  });

  it('ignores the same message from any other origin', () => {
    expect(
      parseBookingMessage(
        'dcal',
        { origin: 'https://evil.example', data: dcalScheduled({ uid: 'bk_123', startUtc: START }) },
        DCAL_ORIGIN,
      ),
    ).toBeNull();
  });

  it('believes nothing when no origin was configured', () => {
    // dCal posts with `targetOrigin: "*"`, so with nothing to check against,
    // any framed page could claim a booking for the session.
    expect(
      parseBookingMessage('dcal', { origin: DCAL_ORIGIN, data: dcalScheduled({ uid: 'bk_123' }) }, null),
    ).toBeNull();
    expect(
      parseBookingMessage('dcal', { origin: DCAL_ORIGIN, data: dcalScheduled({ uid: 'bk_123' }) }),
    ).toBeNull();
  });

  it('ignores dCal’s other messages, its resize chatter included', () => {
    for (const data of [
      { type: 'dapta-calendars:resize', height: 900 },
      { event: 'dapta-calendars.time_selected', payload: { startUtc: START } },
      { event: 'calendly.event_scheduled', payload: { event: { start_time: START } } },
      null,
      'booked',
    ]) {
      expect(parseBookingMessage('dcal', { origin: DCAL_ORIGIN, data }, DCAL_ORIGIN)).toBeNull();
    }
  });

  it('reports a booking whose payload carries no uid or start, as booked', () => {
    // The step is answered by the fact of a booking; the details are best-effort.
    expect(
      parseBookingMessage('dcal', { origin: DCAL_ORIGIN, data: dcalScheduled({}) }, DCAL_ORIGIN),
    ).toEqual({ provider: 'dcal' });
  });

  it('drops a start that is not a date, and caps a runaway uid', () => {
    const parsed = parseBookingMessage(
      'dcal',
      { origin: DCAL_ORIGIN, data: dcalScheduled({ uid: 'u'.repeat(500), startUtc: 'whenever' }) },
      DCAL_ORIGIN,
    );
    expect(parsed?.startTime).toBeUndefined();
    expect(parsed?.bookingUid).toHaveLength(200);
  });

  it('attaches a listener that fires once, and only for the right origin', () => {
    // Same window stand-in as the suite above: this module is imported from
    // the server too, so it is tested without a DOM.
    const listeners = new Set<(event: MessageEvent) => void>();
    const dispatch = (origin: string, data: unknown) => {
      for (const fn of [...listeners]) fn({ origin, data } as MessageEvent);
    };
    vi.stubGlobal('window', {
      addEventListener: (_t: string, fn: (event: MessageEvent) => void) => listeners.add(fn),
      removeEventListener: (_t: string, fn: (event: MessageEvent) => void) => listeners.delete(fn),
    });

    const seen: BookingScheduledDetails[] = [];
    const detach = attachBookingMessageListener('dcal', (d) => seen.push(d), DCAL_ORIGIN);
    dispatch('https://evil.example', dcalScheduled({ uid: 'no' }));
    dispatch(DCAL_ORIGIN, dcalScheduled({ uid: 'bk_1', startUtc: START }));
    dispatch(DCAL_ORIGIN, dcalScheduled({ uid: 'bk_2', startUtc: START }));
    detach();
    expect(seen).toEqual([{ provider: 'dcal', bookingUid: 'bk_1', startTime: START }]);
    expect(listeners.size).toBe(0);
  });
});
