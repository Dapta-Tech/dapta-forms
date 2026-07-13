import { describe, it, expect } from 'vitest';
import { GenericRestWire, StaticTokenSource } from './calendar.backend.generic';
import { asConnector, CalendarHttpError, ExternalCalendarProvider } from './calendar.http-provider';
import { DisabledCalendarProvider } from '@slate/calendar';

interface Call {
  url: string;
  method: string;
  auth: string | null;
  body: unknown;
}

/** A fetch stub that records calls and replays a queued response per call. */
function stubFetch(responses: Array<{ status?: number; json?: unknown; text?: string }>) {
  const calls: Call[] = [];
  let i = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({
      url,
      method: String(init.method),
      auth: headers['authorization'] ?? null,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const r = responses[i++] ?? { status: 200, json: {} };
    const status = r.status ?? 200;
    const text = r.text ?? (r.json !== undefined ? JSON.stringify(r.json) : '');
    return {
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(text),
    } as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function makeProvider(
  responses: Parameters<typeof stubFetch>[0],
  extra: Partial<ConstructorParameters<typeof ExternalCalendarProvider>[0]> = {},
) {
  const { fetchImpl, calls } = stubFetch(responses);
  const provider = new ExternalCalendarProvider({
    baseUrl: 'https://cal.example.test/',
    tokenSource: new StaticTokenSource('tok-123'),
    wire: new GenericRestWire(),
    fetchImpl,
    ...extra,
  });
  return { provider, calls };
}

describe('ExternalCalendarProvider (generic HTTP adapter)', () => {
  it('is enabled and sends an authorized free-busy POST, parsing busy intervals', async () => {
    const { provider, calls } = makeProvider([
      { json: { busy: [{ startUtc: '2026-08-01T14:00:00.000Z', endUtc: '2026-08-01T15:00:00.000Z' }] } },
    ]);
    expect(provider.enabled).toBe(true);
    const busy = await provider.listBusy({
      connectionRefs: ['conn-A'],
      fromUtc: '2026-08-01T00:00:00.000Z',
      toUtc: '2026-08-02T00:00:00.000Z',
    });
    expect(busy).toEqual([{ startUtc: '2026-08-01T14:00:00.000Z', endUtc: '2026-08-01T15:00:00.000Z' }]);
    expect(calls[0]!.url).toBe('https://cal.example.test/v1/free-busy');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.auth).toBe('Bearer tok-123');
    expect(calls[0]!.body).toMatchObject({ connectionRefs: ['conn-A'] });
  });

  it('short-circuits listBusy with no connection refs (no HTTP call)', async () => {
    const { provider, calls } = makeProvider([]);
    expect(await provider.listBusy({ connectionRefs: [], fromUtc: 'a', toUtc: 'b' })).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('reads busy per connection ref and merges (one call per ref)', async () => {
    const { provider, calls } = makeProvider([
      { json: { busy: [{ startUtc: '2026-08-01T14:00:00.000Z', endUtc: '2026-08-01T15:00:00.000Z' }] } },
      { json: { busy: [{ startUtc: '2026-08-01T16:00:00.000Z', endUtc: '2026-08-01T17:00:00.000Z' }] } },
    ]);
    const busy = await provider.listBusy({
      connectionRefs: ['conn-A', 'conn-B'],
      fromUtc: '2026-08-01T00:00:00.000Z',
      toUtc: '2026-08-02T00:00:00.000Z',
    });
    expect(busy).toHaveLength(2);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.body).toMatchObject({ connectionRefs: ['conn-A'] });
    expect(calls[1]!.body).toMatchObject({ connectionRefs: ['conn-B'] });
  });

  it('creates an event and returns the parsed CreatedEvent', async () => {
    const { provider, calls } = makeProvider([
      { json: { externalEventId: 'ext-9', externalCalendarId: 'conn-A', meetingUrl: 'https://meet/x' } },
    ]);
    const created = await provider.createEvent({
      connectionRef: 'conn-A',
      title: 'Intro',
      startUtc: '2026-08-01T14:00:00.000Z',
      endUtc: '2026-08-01T14:30:00.000Z',
      attendeeEmails: ['sam@example.com'],
    });
    expect(created).toEqual({ externalEventId: 'ext-9', externalCalendarId: 'conn-A', meetingUrl: 'https://meet/x' });
    expect(calls[0]!.url).toBe('https://cal.example.test/v1/events');
  });

  it('moves an event in place via PATCH keeping the same external id', async () => {
    const { provider, calls } = makeProvider([{ json: { externalEventId: 'ext-9' } }]);
    const moved = await provider.updateEvent({
      connectionRef: 'conn-A',
      externalEventId: 'ext-9',
      title: 'Intro',
      startUtc: '2026-08-01T16:00:00.000Z',
      endUtc: '2026-08-01T16:30:00.000Z',
      attendeeEmails: ['sam@example.com'],
    });
    expect(moved.externalEventId).toBe('ext-9');
    expect(calls[0]!.method).toBe('PATCH');
    expect(calls[0]!.url).toBe('https://cal.example.test/v1/events/ext-9');
  });

  it('deletes an event with a URL-encoded ref + id', async () => {
    const { provider, calls } = makeProvider([{ status: 204, text: '' }]);
    await provider.deleteEvent({ connectionRef: 'conn/A', externalEventId: 'ext 9' });
    expect(calls[0]!.method).toBe('DELETE');
    expect(calls[0]!.url).toBe('https://cal.example.test/v1/connections/conn%2FA/events/ext%209');
  });

  it('lists calendars', async () => {
    const { provider } = makeProvider([
      { json: { calendars: [{ id: 'c1', name: 'Work', isPrimary: true }, { id: 'c2', name: 'Home' }] } },
    ]);
    const cals = await provider.listCalendars('conn-A');
    expect(cals).toHaveLength(2);
    expect(cals[0]).toMatchObject({ id: 'c1', name: 'Work', isPrimary: true });
  });

  it('checkConnection reports health and NEVER throws on backend error', async () => {
    const ok = makeProvider([{ json: { ok: true, detail: 'Connected' } }]);
    expect(await ok.provider.checkConnection('conn-A')).toEqual({ ok: true, detail: 'Connected' });

    const bad = makeProvider([{ status: 401, text: 'expired' }]);
    const health = await bad.provider.checkConnection('conn-A');
    expect(health.ok).toBe(false);
    expect(health.detail).toMatch(/401/);
  });

  it('throws CalendarHttpError on a non-2xx write so the outbox retries', async () => {
    const { provider } = makeProvider([{ status: 503, text: 'upstream down' }]);
    await expect(
      provider.createEvent({
        connectionRef: 'conn-A',
        title: 't',
        startUtc: '2026-08-01T14:00:00.000Z',
        endUtc: '2026-08-01T14:30:00.000Z',
        attendeeEmails: [],
      }),
    ).rejects.toBeInstanceOf(CalendarHttpError);
  });

  it('startConnect uses the backend override when provided (headless OAuth handshake)', async () => {
    const { provider } = makeProvider([], {
      startConnect: async (provider_, tenantKey) => ({
        token: `tok-${tenantKey}`,
        connectUrl: `https://consent.example.test/oauth?p=${provider_}`,
      }),
    });
    const start = await provider.startConnect('google', 'tenant-1');
    expect(start).toEqual({ token: 'tok-tenant-1', connectUrl: 'https://consent.example.test/oauth?p=google' });
  });

  it('startConnect mints an admin token and returns the connect URL', async () => {
    const { provider, calls } = makeProvider([{ json: { connectUrl: 'https://cal.example.test/oauth?x=1' } }]);
    const start = await provider.startConnect('google', 'tenant-1');
    expect(start).toEqual({ token: 'tok-123', connectUrl: 'https://cal.example.test/oauth?x=1' });
    expect(calls[0]!.url).toBe('https://cal.example.test/v1/connect');
    expect(calls[0]!.body).toMatchObject({ provider: 'google', tenantKey: 'tenant-1' });
  });

  it('discoverConnections lists the tenant connections after a popup', async () => {
    const { provider, calls } = makeProvider([
      { json: { connections: [{ connectionRef: 'conn-A', provider: 'google', primaryEmail: 'me@x.com' }] } },
    ]);
    const found = await provider.discoverConnections('tenant-1', 'google');
    expect(found).toEqual([
      { connectionRef: 'conn-A', provider: 'google', primaryEmail: 'me@x.com', name: null },
    ]);
    expect(calls[0]!.url).toBe('https://cal.example.test/v1/connect/connections?tenantKey=tenant-1&provider=google');
  });

  it('discoverConnections skips not-yet-authorized connection shells (connected:false)', async () => {
    // Opening a hosted connect screen can create a connection shell before the
    // user authorizes; it must not surface as a connected account.
    const { provider } = makeProvider([
      {
        json: {
          connections: [
            { connectionRef: 'conn-shell', provider: 'google', connected: false },
            { connectionRef: 'conn-live', provider: 'google', connected: true },
            { connectionRef: 'conn-legacy', provider: 'google' }, // no flag = assumed live
          ],
        },
      },
    ]);
    const found = await provider.discoverConnections('tenant-1', 'google');
    expect(found.map((c) => c.connectionRef)).toEqual(['conn-live', 'conn-legacy']);
  });

  it('asConnector narrows the external provider but rejects the disabled default', () => {
    const { provider } = makeProvider([]);
    expect(asConnector(provider)).not.toBeNull();
    expect(asConnector(new DisabledCalendarProvider())).toBeNull();
  });
});
