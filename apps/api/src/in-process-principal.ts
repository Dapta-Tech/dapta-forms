/**
 * The in-process principal: who an MCP tool call acts as, handed to the app's
 * own handlers on a request the MCP adapter builds in process.
 *
 * It names a member (a person's place in one workspace) by workspace and
 * member, and, when the call authenticated with an API key, that key. It is a
 * claim, not a grant: `AuthService.resolveHost` re-reads everything from the
 * database on every call, and holds it to the rules an API key gets (the
 * route allowlist, the strict validation, the member's live role, the member
 * still active, `created_via = 'mcp'`).
 *
 *   - With an API key: the key path, unchanged. The key is resolved on every
 *     call (revoked, or its member gone: 401), counted against the key's
 *     120 calls a minute and stamped as used, exactly as over REST.
 *   - Without one (an MCP connection, signed in as a person): the member must
 *     still exist in that workspace and be active, and its role is read then.
 *
 * Nothing that arrives over HTTP can carry one. The principal is not on the
 * request at all: it lives in a module-private `WeakMap` keyed by the request
 * object this module created. A header, a body, a property, a JSON round trip
 * or a copy of a real in-process request all miss the map, so they resolve the
 * way any other request does.
 */
import type { ReqLike } from './auth.provider';

export interface InProcessPrincipal {
  /** The workspace the call acts in. */
  readonly accountId: string;
  /** The member the call acts as, in that workspace. */
  readonly memberId: string;
  /**
   * The SHA-256 of the API key the MCP call authenticated with (the form the
   * database holds). Absent for an MCP connection.
   */
  readonly apiKeyHash?: string;
}

const PRINCIPALS = new WeakMap<object, InProcessPrincipal>();

/**
 * A fresh request that carries `principal`, for the app's handlers. It has no
 * credential of its own: no `Authorization`, no cookie, no workspace header.
 */
export function inProcessRequest(principal: InProcessPrincipal): ReqLike {
  const req: ReqLike = { headers: {} };
  PRINCIPALS.set(req, Object.freeze({ ...principal }));
  return req;
}

/** The principal this module attached to `req`, or null for every other request. */
export function inProcessPrincipalOf(req: object): InProcessPrincipal | null {
  return PRINCIPALS.get(req) ?? null;
}

/**
 * Requests made by `callRequest`, each with the principal its first handler
 * resolved (or is resolving).
 */
const CALL_REQUESTS = new WeakMap<object, { resolved?: Promise<unknown> }>();

/**
 * A fresh request for ONE tool call that runs more than one handler (a read
 * that proves an id exists, then the write). The principal is resolved at the
 * first handler and reused by the rest (`oncePerCall`), so the call counts
 * once against an API key's 120 calls a minute, as one REST call does, and is
 * re-read in full on the next tool call. Never kept past the call it was made for.
 */
export function callRequest(req: ReqLike): ReqLike {
  const principal = inProcessPrincipalOf(req);
  if (!principal) throw new Error('callRequest needs an in-process request');
  const out = inProcessRequest(principal);
  CALL_REQUESTS.set(out, {});
  return out;
}

/** `resolve()` once per `callRequest` request; on any other request, every time. */
export function oncePerCall<T>(req: object, resolve: () => Promise<T>): Promise<T> {
  const slot = CALL_REQUESTS.get(req);
  if (!slot) return resolve();
  slot.resolved ??= resolve();
  return slot.resolved as Promise<T>;
}
