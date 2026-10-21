/**
 * Deprecated API hosts (API_DEPRECATED_HOSTS): after the API moves to a new
 * domain, the old host keeps answering, because a redirect would drop the
 * `Authorization: Bearer dforms_...` header and break every API key call. What
 * changes on a listed host is that callers are told, and the deployment can
 * see who still calls it:
 *
 *   - every response carries `Deprecation` (RFC 9745), a `Link` to the same
 *     path on the successor with `rel="successor-version"` and, when one is
 *     configured, `Sunset`; errors included, because the headers are set
 *     before anything else runs;
 *   - each call made with an API key is logged once, when its response ends:
 *     the key's id, its workspace, the method, the route pattern, the status
 *     and the host. Never the key, never the URL with its query. A call
 *     without a key gets the headers and no line.
 *
 * The host is the `Host` header, the same one the MCP door checks. The API
 * does not trust `X-Forwarded-Host` anywhere and does not start here. Health
 * checks and in-cluster calls reach the pod by its IP or its service name,
 * which no one lists, so they never get either.
 *
 * Off (nothing mounted at all) when API_DEPRECATED_HOSTS is unset or blank.
 */
import { Logger, type INestApplication } from '@nestjs/common';
import { apiDeprecation, type ApiDeprecation, type ServerEnv } from '@quill/config/env';
import { hostnameOf } from '@quill/mcp';

/** Where the per-call line goes. The app's logger; a spec passes its own. */
export type DeprecatedHostLogSink = (line: string) => void;

/** The request facts the middleware reads: an Express request. */
export interface DeprecatedHostRequest {
  method?: string;
  url?: string;
  originalUrl?: string;
  baseUrl?: string;
  headers: Record<string, string | string[] | undefined>;
  /** Set by Express once a route matched; still there when the response ends. */
  route?: { path?: unknown };
}

/** The response facts the middleware touches: an Express response. */
export interface DeprecatedHostResponse {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  once(event: 'finish', listener: () => void): unknown;
}

/** What a request on a listed host carries until its response ends. */
interface DeprecatedHostCall {
  host: string;
  keyId?: string;
  accountId?: string;
}

/**
 * Hung on the request by the middleware. A symbol, not a header or a plain
 * property: nothing that arrives over HTTP can set it, and the in-process
 * requests the MCP builds for its tools never carry one, so a tool call can
 * not log a second line for the request that made it.
 */
const DEPRECATED_HOST_CALL = Symbol('dforms.deprecatedHostCall');

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The same path on the successor, without the query (it can carry anything,
 * and the path is all a caller needs to find the resource). Set through the
 * URL's path setter, which percent-encodes what does not belong in a path and
 * never changes the host, so `//other.example/x` stays a path on the
 * successor and nothing can break out of the `<...>`.
 */
export function successorLink(successorOrigin: string, req: Pick<DeprecatedHostRequest, 'url' | 'originalUrl'>): string {
  const target = new URL(successorOrigin);
  target.pathname = (req.originalUrl ?? req.url ?? '/').split(/[?#]/)[0] || '/';
  return `<${target.href}>; rel="successor-version"`;
}

/** The matched route as Express declared it (`/v1/forms/:id`), or null when none matched. */
function routePatternOf(req: DeprecatedHostRequest): string | null {
  const path = req.route?.path;
  return typeof path === 'string' ? `${req.baseUrl ?? ''}${path}` : null;
}

/** The one line logged for a keyed call on a deprecated host. Fixed key order, JSON. */
export function deprecatedHostCallLine(
  call: Required<DeprecatedHostCall>,
  req: DeprecatedHostRequest,
  status: number,
): string {
  return JSON.stringify({
    event: 'deprecated_api_host_call',
    host: call.host,
    keyId: call.keyId,
    accountId: call.accountId,
    method: req.method ?? 'UNKNOWN',
    route: routePatternOf(req),
    status,
  });
}

/**
 * The middleware: a no-op for any host that is not listed; on a listed one it
 * sets the headers, marks the request, and logs its line when the response
 * ends if a key was resolved on it (see `noteApiKeyCall`).
 */
export function deprecatedHostMiddleware(settings: ApiDeprecation, sink: DeprecatedHostLogSink) {
  const hosts = new Set(settings.hosts);
  return (req: DeprecatedHostRequest, res: DeprecatedHostResponse, next: () => void): void => {
    const host = hostnameOf(firstHeader(req.headers.host));
    if (!hosts.has(host)) return next();

    res.setHeader('Deprecation', settings.deprecation);
    res.setHeader('Link', successorLink(settings.successorOrigin, req));
    if (settings.sunset) res.setHeader('Sunset', settings.sunset);

    const call: DeprecatedHostCall = { host };
    Object.defineProperty(req, DEPRECATED_HOST_CALL, { value: call, enumerable: false });
    res.once('finish', () => {
      if (call.keyId === undefined || call.accountId === undefined) return;
      sink(deprecatedHostCallLine({ host, keyId: call.keyId, accountId: call.accountId }, req, res.statusCode));
    });
    next();
  };
}

/**
 * Record that `req` was authenticated with the API key `keyId` of workspace
 * `accountId`. A no-op unless the request came in on a deprecated host, so the
 * key paths call it unconditionally: the REST key path (`ApiKeyAuthenticator`)
 * and the MCP door. Only ids are taken, so the key itself cannot reach the log.
 */
export function noteApiKeyCall(req: object, keyId: string, accountId: string): void {
  const call = (req as Record<symbol, DeprecatedHostCall | undefined>)[DEPRECATED_HOST_CALL];
  if (!call) return;
  call.keyId = keyId;
  call.accountId = accountId;
}

const defaultSink = (): DeprecatedHostLogSink => {
  const log = new Logger('DeprecatedApiHost');
  return (line) => log.log(line);
};

/**
 * Mount the middleware when API_DEPRECATED_HOSTS is set; returns the settings
 * (null when off). main.ts calls it before CORS, so a refused preflight or a
 * body the parser rejects still carries the headers.
 */
export function configureDeprecatedHosts(
  app: Pick<INestApplication, 'use'>,
  env: ServerEnv,
  sink: DeprecatedHostLogSink = defaultSink(),
): ApiDeprecation | null {
  const settings = apiDeprecation(env);
  if (settings) app.use(deprecatedHostMiddleware(settings, sink));
  return settings;
}
