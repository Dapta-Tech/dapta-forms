/**
 * The COMMITTED default calendar backend: a clean, vendor-neutral REST contract
 * plus a static-bearer token source. This is what a self-hoster implements on
 * their own calendar service, and what the adapter's unit tests exercise. It
 * names no vendor (R15). A private overlay replaces `wire`/`tokenSource` to talk
 * to a real integration platform; nothing here changes.
 *
 * The contract (all JSON, `Authorization: Bearer <token>`):
 *   POST   /v1/free-busy                                 → { busy: [{startUtc,endUtc}] }
 *   POST   /v1/events                                    → { externalEventId, externalCalendarId?, meetingUrl? }
 *   PATCH  /v1/events/:externalEventId                   → { externalEventId, ... }
 *   DELETE /v1/connections/:ref/events/:externalEventId  → 204
 *   GET    /v1/connections/:ref/calendars                → { calendars: [{id,name,primaryEmail?,isPrimary?}] }
 *   GET    /v1/connections/:ref                          → { ok, detail }
 *   POST   /v1/connect                                   → { connectUrl }
 *
 * `connectionRef` is opaque: the contract only ever echoes it back.
 */
import type {
  BusyInterval,
  CalendarSummary,
  ConnectionHealth,
  CreateEventInput,
  CreatedEvent,
  DeleteEventInput,
  ListBusyInput,
  UpdateEventInput,
} from '@slate/calendar';
import type {
  CalendarTokenSource,
  CalendarWire,
  ConnectStart,
  DiscoveredConnection,
  WireRequest,
} from './calendar.http-provider';

function enc(ref: string): string {
  return encodeURIComponent(ref);
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

export class GenericRestWire implements CalendarWire {
  listBusy(input: ListBusyInput): WireRequest {
    return {
      method: 'POST',
      path: '/v1/free-busy',
      scope: 'tenant',
      body: { connectionRefs: input.connectionRefs, fromUtc: input.fromUtc, toUtc: input.toUtc },
    };
  }
  parseBusy(raw: unknown): BusyInterval[] {
    const busy = asRecord(raw)['busy'];
    if (!Array.isArray(busy)) return [];
    return busy
      .map((b) => asRecord(b))
      .filter((b) => typeof b['startUtc'] === 'string' && typeof b['endUtc'] === 'string')
      .map((b) => ({ startUtc: String(b['startUtc']), endUtc: String(b['endUtc']) }));
  }

  createEvent(input: CreateEventInput): WireRequest {
    return { method: 'POST', path: '/v1/events', scope: 'tenant', subject: input.connectionRef, body: input };
  }
  updateEvent(input: UpdateEventInput): WireRequest {
    return {
      method: 'PATCH',
      path: `/v1/events/${enc(input.externalEventId)}`,
      scope: 'tenant',
      subject: input.connectionRef,
      body: input,
    };
  }
  parseEvent(raw: unknown): CreatedEvent {
    const r = asRecord(raw);
    const id = r['externalEventId'];
    if (typeof id !== 'string' || !id) {
      throw new Error('calendar backend returned no externalEventId');
    }
    return {
      externalEventId: id,
      externalCalendarId: typeof r['externalCalendarId'] === 'string' ? r['externalCalendarId'] : null,
      meetingUrl: typeof r['meetingUrl'] === 'string' ? r['meetingUrl'] : null,
    };
  }

  deleteEvent(input: DeleteEventInput): WireRequest {
    return {
      method: 'DELETE',
      path: `/v1/connections/${enc(input.connectionRef)}/events/${enc(input.externalEventId)}`,
      scope: 'tenant',
      subject: input.connectionRef,
    };
  }

  listCalendars(connectionRef: string): WireRequest {
    return {
      method: 'GET',
      path: `/v1/connections/${enc(connectionRef)}/calendars`,
      scope: 'tenant',
      subject: connectionRef,
    };
  }
  parseCalendars(raw: unknown, _connectionRef: string): CalendarSummary[] {
    const cals = asRecord(raw)['calendars'];
    if (!Array.isArray(cals)) return [];
    return cals
      .map((c) => asRecord(c))
      .filter((c) => typeof c['id'] === 'string')
      .map((c) => ({
        id: String(c['id']),
        name: typeof c['name'] === 'string' ? c['name'] : String(c['id']),
        primaryEmail: typeof c['primaryEmail'] === 'string' ? c['primaryEmail'] : null,
        isPrimary: c['isPrimary'] === true,
      }));
  }

  checkConnection(connectionRef: string): WireRequest {
    return {
      method: 'GET',
      path: `/v1/connections/${enc(connectionRef)}`,
      scope: 'tenant',
      subject: connectionRef,
    };
  }
  parseHealth(raw: unknown): ConnectionHealth {
    const r = asRecord(raw);
    const ok = r['ok'] === true;
    return { ok, detail: typeof r['detail'] === 'string' ? r['detail'] : ok ? 'Connected' : 'Not connected' };
  }

  startConnect(provider: string, tenantKey: string): WireRequest {
    return { method: 'POST', path: '/v1/connect', scope: 'admin', subject: tenantKey, body: { provider, tenantKey } };
  }
  parseConnectStart(raw: unknown, token: string): ConnectStart {
    const url = asRecord(raw)['connectUrl'];
    if (typeof url !== 'string' || !url) throw new Error('calendar backend returned no connectUrl');
    return { token, connectUrl: url };
  }

  discoverConnections(tenantKey: string, provider: string): WireRequest {
    const qs = `tenantKey=${enc(tenantKey)}&provider=${enc(provider)}`;
    return { method: 'GET', path: `/v1/connect/connections?${qs}`, scope: 'admin', subject: tenantKey };
  }
  parseDiscovered(raw: unknown, _tenantKey: string, _provider: string): DiscoveredConnection[] {
    const conns = asRecord(raw)['connections'];
    if (!Array.isArray(conns)) return [];
    return conns
      .map((c) => asRecord(c))
      .filter((c) => typeof c['connectionRef'] === 'string')
      // Hosted connect screens may create a connection shell BEFORE the user
      // authorizes. If the backend reports a connected flag, only accept
      // fully-authorized connections — otherwise list-and-diff would record a
      // never-authorized account as connected. Absent flag = assumed live.
      .filter((c) => c['connected'] !== false)
      .map((c) => ({
        connectionRef: String(c['connectionRef']),
        provider: typeof c['provider'] === 'string' ? c['provider'] : 'unknown',
        primaryEmail: typeof c['primaryEmail'] === 'string' ? c['primaryEmail'] : null,
        name: typeof c['name'] === 'string' ? c['name'] : null,
      }));
  }
}

/** A static bearer token from env — the OSS/self-host default (no minting). */
export class StaticTokenSource implements CalendarTokenSource {
  constructor(private readonly token: string) {}
  mint(): Promise<string> {
    return Promise.resolve(this.token);
  }
}
