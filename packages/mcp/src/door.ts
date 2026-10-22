import { toNodeHandler } from '@modelcontextprotocol/node';
import type { McpCaller, McpConnection, McpCredential } from './backend';
import type { RateLimiter } from './rate-limit';
import { CALL_KEY, type FormsMcpServer, type McpCall, type McpClientInfo } from './server';
import { bucketOf } from './workspace';

/**
 * Credentials in the URL end up in access logs and proxies; refuse them
 * outright. Names are compared in lower case, so `?API_KEY=` and `?Token=`
 * are caught too.
 */
const URL_CREDENTIAL_PARAMS = new Set(['key', 'api_key', 'apikey', 'access_key', 'access_token', 'token', 'bearer', 'authorization']);

/** The request the door reads: a Node `IncomingMessage` with its JSON body already parsed. */
export interface DoorRequest extends AsyncIterable<unknown> {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

/** The response the door writes: a Node `ServerResponse`. */
export interface DoorResponse {
  writeHead(statusCode: number, headers?: Record<string, string>): unknown;
  write(chunk: string | Uint8Array): unknown;
  end(chunk?: string | Uint8Array): unknown;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  setHeader?(name: string, value: string): unknown;
  destroyed?: boolean;
}

export interface McpDoorOptions {
  server: FormsMcpServer;
  /** False: the endpoint answers 404 as if it did not exist. */
  enabled: boolean;
  /** Browser origins allowed to call. Empty: a request carrying any `Origin` is refused. */
  allowedOrigins: readonly string[];
  /** When non-empty, the only `Host` names served (DNS-rebinding guard). */
  allowedHosts: readonly string[];
  /**
   * Resolve an API key to the caller, or null when it is unknown, revoked or
   * its member left. Without an `oauth` side every bearer comes here.
   */
  authenticate(token: string): Promise<McpCaller | null>;
  /**
   * The door's OAuth side (MCP connections), when the host has one. Absent:
   * API keys only, and nothing points a client at a login.
   */
  oauth?: McpDoorOAuth;
  /**
   * Called once a request's credential resolved to a caller, before its rate
   * limit is taken, with the request as the host passed it in. Lets the host
   * attribute the request (forms-api notes the key id of a call on a
   * deprecated API host). Optional; it must not throw.
   */
  onAuthenticated?(req: DoorRequest, credential: McpCredential): void;
  /**
   * Every request of an authenticated credential takes a token: an API key's
   * from its own bucket, an MCP connection's from the member of the workspace
   * the call acts in (see `bucketOf`).
   */
  keyLimiter: RateLimiter;
  /** Requests without a credential, failed attempts and refusals take a token, keyed by client address. */
  ipLimiter: RateLimiter;
}

/**
 * The OAuth side of the door: the MCP server as an OAuth resource server.
 *
 * A bearer the host recognizes as an API key takes the key path, unchanged;
 * any other bearer is an access token and comes here. A request without a
 * credential, or with a token that does not verify, is answered 401 with the
 * protected-resource metadata URL (RFC 9728), which is how a client discovers
 * the login. A dead API key never is: a client holding a key cannot finish a
 * login, so pointing it at one would loop.
 */
export interface McpDoorOAuth {
  /** True for a bearer that is an API key (by its shape, never by a lookup). */
  isApiKey(token: string): boolean;
  /**
   * Verify an access token and resolve the person it signs in, with every
   * workspace they may act in now, or null when the token does not verify.
   * Throws `DoorRefusal` when it verifies but names nobody the host knows: a
   * 403 a new login would not change; `DoorUnavailable` when it cannot be
   * checked right now: a 503; and `DoorThrottled` when its lookups ran past
   * their budget: a 429. A person with no workspace yet is not refused
   * here: their tools answer NO_WORKSPACE, which a model can explain.
   */
  authenticate(token: string): Promise<McpConnection | null>;
  /** The URL of this resource's protected-resource metadata (RFC 9728). */
  resourceMetadataUrl: string;
}

/**
 * A verified credential that still cannot act, with a message the person can
 * act on. The door answers it 403 with that message; anything else an
 * authenticator throws is a fault.
 */
export class DoorRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DoorRefusal';
  }
}

/**
 * A credential the door cannot check right now, because something it depends
 * on is down (the host's person directory, say). The door answers it 503 with
 * its message and a `Retry-After`, never a 401: the person's sign-in is fine,
 * and sending the client into a new login would not help. The message must
 * not carry the dependency's internals.
 */
export class DoorUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DoorUnavailable';
  }
}

/**
 * A credential that verified, but whose lookups ran past their budget (a
 * flood of requests for one person, say). The door answers it 429 with a
 * `Retry-After`, never a 401: the sign-in is fine, it is only too frequent.
 */
export class DoorThrottled extends Error {
  constructor(readonly retryAfterMs: number) {
    super('Too many sign-in lookups.');
    this.name = 'DoorThrottled';
  }
}

/** Seconds a client is told to wait after a `DoorUnavailable`. */
const UNAVAILABLE_RETRY_AFTER_SECONDS = 30;

/** Per-request facts the host computes: the client address (behind its trusted proxies) and a request id. */
export interface DoorContext {
  ip: string;
  requestId: string;
}

/**
 * `value` without any trailing `char`, in linear time. `/\/+$/` backtracks on
 * a long run of '/' that is not at the end, and the `Origin` header is client
 * input. The same contract as `trimTrailing` in `@quill/shared`, which this
 * package does not depend on.
 */
function trimTrailing(value: string, char: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === char) end--;
  return value.slice(0, end);
}

/** An origin as the allowlist compares it: trimmed, lower case, no trailing slash. */
export function normalizeOrigin(value: string): string {
  return trimTrailing(value.trim().toLowerCase(), '/');
}

/**
 * The browser (CORS) policy that matches the door, in the shape the `cors`
 * middleware takes: the same allowlist, no credentials (the endpoint
 * authenticates with a bearer key, never a cookie), POST only. An empty list
 * turns CORS off for the endpoint, so a browser cannot even preflight. The
 * request headers are reflected on a preflight because the protocol sends
 * dynamic ones (`Mcp-Param-*`). The host mounts it for the MCP path only.
 */
export function mcpCorsPolicy(allowedOrigins: readonly string[]): {
  origin: string[] | false;
  methods: string[];
  exposedHeaders: string[];
  credentials: false;
  maxAge: number;
} {
  const origins = allowedOrigins.map(normalizeOrigin).filter(Boolean);
  return {
    origin: origins.length > 0 ? origins : false,
    methods: ['POST'],
    exposedHeaders: ['WWW-Authenticate', 'Retry-After', 'X-Request-Id', 'Mcp-Session-Id'],
    credentials: false,
    maxAge: 600,
  };
}

/** The hostname of a `Host` header, port and brackets handled. */
export function hostnameOf(host: string | undefined): string {
  const h = (host ?? '').trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  return h.split(':')[0] ?? '';
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function protocolVersionOf(req: DoorRequest): string {
  const header = firstHeader(req.headers['mcp-protocol-version']);
  if (header) return header.slice(0, 20);
  const body = req.body as { params?: { protocolVersion?: unknown; _meta?: Record<string, unknown> } } | undefined;
  const meta = body?.params?._meta?.['io.modelcontextprotocol/protocolVersion'];
  const init = body?.params?.protocolVersion;
  const v = typeof meta === 'string' ? meta : typeof init === 'string' ? init : 'unknown';
  return v.slice(0, 20);
}

/** A short printable label from client input, or undefined. Control characters are dropped, the rest cut to `max`. */
function label(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, max);
  return clean || undefined;
}

/**
 * The client a request came from, from the request alone: `clientInfo` on an
 * `initialize`, or the per-request envelope (`_meta`) a 2026-07-28 client
 * sends with every message, plus the `User-Agent` and a vendor header. Only
 * names and versions are read; the rest of the body is never looked at here.
 */
export function clientInfoOf(req: DoorRequest): McpClientInfo {
  const params = (req.body as { params?: { clientInfo?: unknown; _meta?: Record<string, unknown> } } | undefined)?.params;
  const meta = params?._meta?.['io.modelcontextprotocol/clientInfo'];
  const info = (params?.clientInfo ?? meta) as { name?: unknown; version?: unknown } | undefined;
  const userAgent = label(firstHeader(req.headers['user-agent']), 200);
  const anthropic = label(firstHeader(req.headers['x-anthropic-client']), 64);
  const vendor = anthropic || /\b(anthropic|claude)/i.test(userAgent ?? '')
    ? 'anthropic'
    : Object.keys(req.headers).some((h) => h.toLowerCase().startsWith('openai-')) || /\bopenai\b/i.test(userAgent ?? '')
      ? 'openai'
      : undefined;
  const client: McpClientInfo = {};
  const name = label(info && typeof info === 'object' ? info.name : undefined, 64);
  const version = label(info && typeof info === 'object' ? info.version : undefined, 32);
  if (name) client.name = name;
  if (version) client.version = version;
  if (userAgent) client.userAgent = userAgent;
  if (vendor) client.vendor = vendor;
  return client;
}

function rpcError(res: DoorResponse, status: number, code: number, message: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }));
}

/** The `WWW-Authenticate` of an API key's 401: it names no login, because a key holder cannot finish one. */
const keyChallenge = (error?: 'invalid_token'): string =>
  error ? `Bearer realm="dforms", error="${error}"` : 'Bearer realm="dforms"';

/**
 * `POST /mcp`: the door in front of the SDK handler.
 *
 * The SDK handler trusts its caller: it checks no Host, no Origin and no
 * token. Everything that guards the endpoint lives here, in this order:
 * switch, method, transport hygiene (Host, Origin, credentials in the URL,
 * content type, no batch), then authentication with its rate limits. There
 * is no anonymous door: a request without a credential is a 401 challenge, and a
 * request with a bad one is a 401 too, never quietly downgraded.
 */
export class McpDoor {
  private readonly node: ReturnType<typeof toNodeHandler>;
  private readonly origins: Set<string>;
  private readonly hosts: Set<string>;

  constructor(private readonly options: McpDoorOptions) {
    this.node = toNodeHandler(options.server.handler);
    this.origins = new Set(options.allowedOrigins.map(normalizeOrigin).filter(Boolean));
    this.hosts = new Set(options.allowedHosts.map((h) => hostnameOf(h)).filter(Boolean));
  }

  async handle(req: DoorRequest, res: DoorResponse, ctx: DoorContext): Promise<void> {
    res.setHeader?.('X-Request-Id', ctx.requestId);
    if (!this.options.enabled) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'NOT_FOUND', message: 'Not found.' }));
      return;
    }
    if (req.method !== 'POST') {
      // Stateless: no GET stream, no session to DELETE.
      rpcError(res, 405, -32000, 'Use POST.', { Allow: 'POST' });
      return;
    }
    if (this.hosts.size > 0 && !this.hosts.has(hostnameOf(firstHeader(req.headers.host)))) {
      rpcError(res, 403, -32000, 'Host not allowed.');
      return;
    }
    const origin = firstHeader(req.headers.origin);
    if (origin !== undefined && !this.origins.has(normalizeOrigin(origin))) {
      rpcError(res, 403, -32000, 'Origin not allowed.');
      return;
    }
    const query = new URL(req.url ?? '/', 'http://door.invalid').searchParams;
    if ([...query.keys()].some((name) => URL_CREDENTIAL_PARAMS.has(name.toLowerCase()))) {
      rpcError(res, 400, -32000, 'Send credentials in the Authorization header, never in the URL.');
      return;
    }
    if (!/^application\/json\b/i.test(firstHeader(req.headers['content-type']) ?? '')) {
      rpcError(res, 415, -32000, 'Content-Type must be application/json.');
      return;
    }
    // A JSON-RPC batch would run every message on one rate-limit token.
    // Protocol 2025-06-18 removed batches and MCP clients send one message
    // per request, so a body that is an array is refused outright.
    if (Array.isArray(req.body)) {
      rpcError(res, 400, -32600, 'Batch requests are not supported: send one JSON-RPC message per request.');
      return;
    }

    const oauth = this.options.oauth;
    const header = firstHeader(req.headers.authorization);
    if (header === undefined || header.trim() === '') {
      if (!this.takeIp(res, ctx.ip)) return;
      if (oauth) {
        rpcError(res, 401, -32001, 'Authentication required: sign in, or send Authorization: Bearer <your dForms API key>.', {
          'WWW-Authenticate': `Bearer resource_metadata="${oauth.resourceMetadataUrl}"`,
        });
        return;
      }
      rpcError(res, 401, -32001, 'Authentication required: send Authorization: Bearer <your dForms API key>.', {
        'WWW-Authenticate': keyChallenge(),
      });
      return;
    }
    const token = /^Bearer\s+(\S+)$/i.exec(header.trim())?.[1];
    // With an OAuth side, anything but an API key is the OAuth side's to
    // answer, a header that is not a plain `Bearer <token>` included: its 401
    // must point at the login, or a client that sent junk could never recover.
    const viaOAuth = oauth !== undefined && (token === undefined || !oauth.isApiKey(token));
    let caller: McpCredential | null = null;
    try {
      if (token) caller = viaOAuth ? await oauth!.authenticate(token) : await this.options.authenticate(token);
    } catch (error) {
      if (error instanceof DoorThrottled) {
        if (!this.takeIp(res, ctx.ip)) return;
        return this.tooMany(res, error.retryAfterMs);
      }
      if (error instanceof DoorUnavailable) {
        if (!this.takeIp(res, ctx.ip)) return;
        rpcError(res, 503, -32000, error.message, { 'Retry-After': String(UNAVAILABLE_RETRY_AFTER_SECONDS) });
        return;
      }
      if (!(error instanceof DoorRefusal)) throw error;
      if (!this.takeIp(res, ctx.ip)) return;
      rpcError(res, 403, -32003, error.message);
      return;
    }
    if (!caller) {
      // A wrong credential costs a lookup: count the attempt against the address.
      if (!this.takeIp(res, ctx.ip)) return;
      if (viaOAuth) {
        rpcError(res, 401, -32001, 'Invalid or expired access token: sign in again.', {
          'WWW-Authenticate': `Bearer error="invalid_token", resource_metadata="${oauth!.resourceMetadataUrl}"`,
        });
        return;
      }
      rpcError(res, 401, -32001, 'Invalid or revoked API key, or its owner left the workspace.', {
        'WWW-Authenticate': keyChallenge('invalid_token'),
      });
      return;
    }
    this.options.onAuthenticated?.(req, caller);
    const { allowed, retryAfterMs } = this.options.keyLimiter.take(`mcp-key:${bucketOf(caller, req.body)}`);
    if (!allowed) return this.tooMany(res, retryAfterMs);

    const call: McpCall = { requestId: ctx.requestId, protocolVersion: protocolVersionOf(req), credential: caller, client: clientInfoOf(req) };
    // The token itself is never handed on: the SDK sees the public label, and
    // the caller travels to the tools through `extra`.
    const forwarded = req as DoorRequest & { auth?: unknown };
    forwarded.auth = { token: '[redacted]', clientId: caller.label, scopes: [], extra: { [CALL_KEY]: call } };
    await this.node(forwarded as never, res as never, req.body);
  }

  private takeIp(res: DoorResponse, ip: string): boolean {
    const { allowed, retryAfterMs } = this.options.ipLimiter.take(`mcp-ip:${ip}`);
    if (!allowed) this.tooMany(res, retryAfterMs);
    return allowed;
  }

  private tooMany(res: DoorResponse, retryAfterMs: number): void {
    const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    rpcError(res, 429, -32000, 'Too many requests.', { 'Retry-After': String(seconds) });
  }
}
