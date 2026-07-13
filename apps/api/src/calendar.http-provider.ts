/**
 * The concrete `external` CalendarProvider: a GENERIC HTTP adapter. It performs
 * only vendor-neutral orchestration — mint a bearer, send JSON, map non-2xx to a
 * thrown error (so the outbox retries), enforce a timeout — and delegates ALL
 * request/response SHAPING to a pluggable `CalendarWire`, and all auth to a
 * pluggable `CalendarTokenSource`.
 *
 * R15: nothing here names a vendor, a host, or a key structure. `connectionRef`
 * is treated as an OPAQUE string end-to-end; only a wire knows how to interpret
 * it. The committed default (`GenericRestWire` + `StaticTokenSource`) speaks a
 * clean REST contract any self-hoster can implement. A PRIVATE overlay module
 * (loaded by env, see `calendar.provider.ts`) swaps in the real vendor wire +
 * JWT authority without touching this file or the public build.
 */
import type {
  BusyInterval,
  CalendarProvider,
  CalendarSummary,
  ConnectionHealth,
  CreateEventInput,
  CreatedEvent,
  DeleteEventInput,
  ListBusyInput,
  UpdateEventInput,
} from '@slate/calendar';

/** Token authority for the calendar backend. Mints a short-lived bearer. */
export interface CalendarTokenSource {
  /**
   * @param scope   'tenant' for per-account calendar ops, 'admin' for
   *                workspace-level ops (e.g. starting a connect flow).
   * @param subject opaque tenant/connection subject the token is scoped to
   *                (a connectionRef for tenant ops, or a host tenant key for
   *                connect). Ignored by simple static sources.
   */
  mint(scope: 'tenant' | 'admin', subject?: string): Promise<string>;
}

/** The result of starting a connect flow (returned to the browser). */
export interface ConnectStart {
  token: string;
  connectUrl: string;
}

/**
 * A connection the backend reports for a tenant after an OAuth popup completes.
 * `connectionRef` is opaque — it is stored verbatim and later round-tripped to
 * `listCalendars`/`checkConnection`.
 */
export interface DiscoveredConnection {
  connectionRef: string;
  provider: string;
  primaryEmail?: string | null;
  name?: string | null;
}

/** A single HTTP call the adapter should make on the wire's behalf. */
export interface WireRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Path appended to the backend base URL (may be absolute). */
  path: string;
  body?: unknown;
  scope: 'tenant' | 'admin';
  /** Opaque subject for token minting (connectionRef, or tenant key on connect). */
  subject?: string;
}

/**
 * The shaping seam: builds the request for each calendar operation and parses
 * the backend's response. Everything vendor-specific (paths, action keys, body
 * casing, response envelopes, integrationKey mapping) lives behind this — so the
 * adapter above stays generic and the private overlay is a single drop-in.
 */
export interface CalendarWire {
  listBusy(input: ListBusyInput): WireRequest;
  parseBusy(raw: unknown): BusyInterval[];
  createEvent(input: CreateEventInput): WireRequest;
  updateEvent(input: UpdateEventInput): WireRequest;
  parseEvent(raw: unknown): CreatedEvent;
  deleteEvent(input: DeleteEventInput): WireRequest;
  listCalendars(connectionRef: string): WireRequest;
  /** `connectionRef` is passed back so a wire can re-encode opaque calendar refs. */
  parseCalendars(raw: unknown, connectionRef: string): CalendarSummary[];
  checkConnection(connectionRef: string): WireRequest;
  parseHealth(raw: unknown): ConnectionHealth;
  startConnect(provider: string, tenantKey: string): WireRequest;
  parseConnectStart(raw: unknown, token: string): ConnectStart;
  discoverConnections(tenantKey: string, provider: string): WireRequest;
  /** tenantKey/provider are passed back so a wire can build stable opaque refs. */
  parseDiscovered(raw: unknown, tenantKey: string, provider: string): DiscoveredConnection[];
}

/**
 * The connect-flow capability (used by the connections API, not the booking
 * engine). A provider that supports OAuth connect implements this in addition to
 * `CalendarProvider`; the disabled OSS default does not.
 */
export interface CalendarConnector {
  startConnect(provider: string, tenantKey: string): Promise<ConnectStart>;
  discoverConnections(tenantKey: string, provider: string): Promise<DiscoveredConnection[]>;
}

/** Narrow a provider to a connect-capable one, or null when connect is unsupported. */
export function asConnector(p: CalendarProvider): CalendarConnector | null {
  const c = p as unknown as Partial<CalendarConnector>;
  return typeof c.startConnect === 'function' && typeof c.discoverConnections === 'function'
    ? (c as unknown as CalendarConnector)
    : null;
}

/** Thrown on any non-2xx backend response so the outbox worker retries. */
export class CalendarHttpError extends Error {
  constructor(
    readonly status: number,
    readonly op: string,
    detail: string,
  ) {
    super(`calendar backend ${op} failed (${status}): ${detail}`);
    this.name = 'CalendarHttpError';
  }
}

export interface ExternalCalendarOptions {
  baseUrl: string;
  tokenSource: CalendarTokenSource;
  wire: CalendarWire;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /**
   * Optional custom connect handshake. Some backends need a multi-step dance
   * (create a request, resolve the end-provider's OAuth URL, …) that the
   * single-request wire contract can't express; when present this replaces
   * `wire.startConnect` so the user lands STRAIGHT on the end provider's
   * consent screen instead of an intermediate hosted page.
   */
  startConnect?: (provider: string, tenantKey: string) => Promise<ConnectStart>;
}

export class ExternalCalendarProvider implements CalendarProvider {
  readonly enabled = true;
  private readonly baseUrl: string;
  private readonly tokens: CalendarTokenSource;
  private readonly wire: CalendarWire;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly startConnectOverride?: ExternalCalendarOptions['startConnect'];

  constructor(opts: ExternalCalendarOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.tokens = opts.tokenSource;
    this.wire = opts.wire;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.startConnectOverride = opts.startConnect;
  }

  async listBusy(input: ListBusyInput): Promise<BusyInterval[]> {
    if (input.connectionRefs.length === 0) return [];
    // Per-connection reads, merged: a backend need not offer a batch free-busy
    // (many calendar APIs expose only per-calendar event listing). The engine
    // sorts/merges the union itself, so an unsorted concat is fine.
    const out: BusyInterval[] = [];
    for (const ref of input.connectionRefs) {
      const req = this.wire.listBusy({ connectionRefs: [ref], fromUtc: input.fromUtc, toUtc: input.toUtc });
      out.push(...this.wire.parseBusy(await this.send('listBusy', req)));
    }
    return out;
  }

  async createEvent(input: CreateEventInput): Promise<CreatedEvent> {
    return this.wire.parseEvent(await this.send('createEvent', this.wire.createEvent(input)));
  }

  async updateEvent(input: UpdateEventInput): Promise<CreatedEvent> {
    return this.wire.parseEvent(await this.send('updateEvent', this.wire.updateEvent(input)));
  }

  async deleteEvent(input: DeleteEventInput): Promise<void> {
    await this.send('deleteEvent', this.wire.deleteEvent(input));
  }

  async listCalendars(connectionRef: string): Promise<CalendarSummary[]> {
    return this.wire.parseCalendars(
      await this.send('listCalendars', this.wire.listCalendars(connectionRef)),
      connectionRef,
    );
  }

  async checkConnection(connectionRef: string): Promise<ConnectionHealth> {
    // Health is diagnostic: never throw — a dead connection is a valid answer.
    try {
      return this.wire.parseHealth(
        await this.send('checkConnection', this.wire.checkConnection(connectionRef)),
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { ok: false, detail };
    }
  }

  /** Start a connect flow (used by the connections API, not the booking engine). */
  async startConnect(provider: string, tenantKey: string): Promise<ConnectStart> {
    if (this.startConnectOverride) return this.startConnectOverride(provider, tenantKey);
    const req = this.wire.startConnect(provider, tenantKey);
    const token = await this.tokens.mint(req.scope, req.subject);
    const raw = await this.send('startConnect', req, token);
    return this.wire.parseConnectStart(raw, token);
  }

  /** List the tenant's connections after a popup completes (to register them). */
  async discoverConnections(tenantKey: string, provider: string): Promise<DiscoveredConnection[]> {
    return this.wire.parseDiscovered(
      await this.send('discoverConnections', this.wire.discoverConnections(tenantKey, provider)),
      tenantKey,
      provider,
    );
  }

  /** Generic HTTP: auth + JSON + timeout + non-2xx→throw. Returns parsed JSON. */
  private async send(op: string, req: WireRequest, presetToken?: string): Promise<unknown> {
    const token = presetToken ?? (await this.tokens.mint(req.scope, req.subject));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${req.path}`, {
        method: req.method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(req.body != null ? { 'content-type': 'application/json' } : {}),
        },
        body: req.body != null ? JSON.stringify(req.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new CalendarHttpError(0, op, detail);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    if (!res.ok) throw new CalendarHttpError(res.status, op, text.slice(0, 500));
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new CalendarHttpError(res.status, op, `non-JSON body: ${text.slice(0, 200)}`);
    }
  }
}
