import { toNodeHandler } from '@modelcontextprotocol/node';
import type { McpCaller } from './backend';
import type { RateLimiter } from './rate-limit';
import { CALL_KEY, type FormsMcpServer, type McpCall } from './server';

/** Credentials in the URL end up in access logs and proxies; refuse them outright. */
const URL_CREDENTIAL_PARAMS = ['key', 'api_key', 'apikey', 'access_token', 'token', 'authorization'];

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
   * Resolve a bearer token to the caller, or null when it is unknown, revoked
   * or its member left. THE OAUTH SEAM: phase 1 accepts the host's API keys
   * only; phase 2 resolves an OAuth access token here as well, and nothing
   * past the door changes.
   */
  authenticate(token: string): Promise<McpCaller | null>;
  /**
   * Called once a request's credential resolved to a caller, before its rate
   * limit is taken, with the request as the host passed it in. Lets the host
   * attribute the request (forms-api notes the key id of a call on a
   * deprecated API host). Optional; it must not throw.
   */
  onAuthenticated?(req: DoorRequest, caller: McpCaller): void;
  /** Every request of an authenticated credential takes a token, keyed by credential. */
  keyLimiter: RateLimiter;
  /** Requests without a credential and failed attempts take a token, keyed by client address. */
  ipLimiter: RateLimiter;
  /**
   * The `WWW-Authenticate` value of a 401. Phase 2 (OAuth) adds the
   * protected-resource metadata URL here so a client can discover the
   * authorization server.
   */
  challenge?: (error?: 'invalid_token') => string;
}

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

function rpcError(res: DoorResponse, status: number, code: number, message: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }));
}

const defaultChallenge = (error?: 'invalid_token'): string =>
  error ? `Bearer realm="dforms", error="${error}"` : 'Bearer realm="dforms"';

/**
 * `POST /mcp`: the door in front of the SDK handler.
 *
 * The SDK handler trusts its caller: it checks no Host, no Origin and no
 * token. Everything that guards the endpoint lives here, in this order:
 * switch, method, transport hygiene (Host, Origin, credentials in the URL,
 * content type), then authentication with its rate limits. There is no
 * anonymous door: a request without a credential is a 401 challenge, and a
 * request with a bad one is a 401 too, never quietly downgraded.
 */
export class McpDoor {
  private readonly node: ReturnType<typeof toNodeHandler>;
  private readonly origins: Set<string>;
  private readonly hosts: Set<string>;
  private readonly challenge: (error?: 'invalid_token') => string;

  constructor(private readonly options: McpDoorOptions) {
    this.node = toNodeHandler(options.server.handler);
    this.origins = new Set(options.allowedOrigins.map(normalizeOrigin).filter(Boolean));
    this.hosts = new Set(options.allowedHosts.map((h) => hostnameOf(h)).filter(Boolean));
    this.challenge = options.challenge ?? defaultChallenge;
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
    if (URL_CREDENTIAL_PARAMS.some((p) => query.has(p))) {
      rpcError(res, 400, -32000, 'Send credentials in the Authorization header, never in the URL.');
      return;
    }
    if (!/^application\/json\b/i.test(firstHeader(req.headers['content-type']) ?? '')) {
      rpcError(res, 415, -32000, 'Content-Type must be application/json.');
      return;
    }

    const header = firstHeader(req.headers.authorization);
    if (header === undefined || header.trim() === '') {
      if (!this.takeIp(res, ctx.ip)) return;
      rpcError(res, 401, -32001, 'Authentication required: send Authorization: Bearer <your dForms API key>.', {
        'WWW-Authenticate': this.challenge(),
      });
      return;
    }
    const token = /^Bearer\s+(\S+)$/i.exec(header.trim())?.[1];
    const caller = token ? await this.options.authenticate(token) : null;
    if (!caller) {
      // A wrong key costs a lookup: count the attempt against the address.
      if (!this.takeIp(res, ctx.ip)) return;
      rpcError(res, 401, -32001, 'Invalid or revoked API key, or its owner left the workspace.', {
        'WWW-Authenticate': this.challenge('invalid_token'),
      });
      return;
    }
    this.options.onAuthenticated?.(req, caller);
    const { allowed, retryAfterMs } = this.options.keyLimiter.take(`mcp-key:${caller.credentialId}`);
    if (!allowed) return this.tooMany(res, retryAfterMs);

    const call: McpCall = { requestId: ctx.requestId, protocolVersion: protocolVersionOf(req), caller };
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
