/**
 * Which admin routes an API key may call (public API v1).
 *
 * An ALLOWLIST, so the policy fails closed: a route added later is refused to
 * keys until someone decides it belongs here. Allowed are the routes an agent
 * needs to build and run forms: forms (create, read, edit, slug, duplicate,
 * publish, revert, delete, file into a folder), folders, destinations,
 * responses and their files, CSV, analytics, brand kit, the workspace link
 * page, notifications, `GET /v1/me`, reading the profile and the public page,
 * and reading integrations.
 *
 * Everything else is a 403 `KEY_NOT_ALLOWED` with a key: the key routes
 * themselves, members, invitations, workspaces, onboarding and attribution,
 * writing the profile, the language or the public page (vanity), and
 * connecting or disconnecting integrations.
 *
 * `ApiKeyRouteGuard` enforces it for every controller, before any handler runs,
 * so it also covers handlers that never call `AuthService.resolveHost`. It
 * reads the route from the handler's own Nest metadata (not from the URL), so
 * the policy and its tests see exactly the routes the app serves.
 */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  RequestMethod,
} from '@nestjs/common';
import { apiKeyFromRequest } from './api-keys';
import type { ReqLike } from './auth.provider';

/** Nest's route metadata keys (`@nestjs/common/constants`), named here to avoid a deep CJS import. */
const PATH_METADATA = 'path';
const METHOD_METADATA = 'method';

/** `METHOD /path/:param` exactly as the controllers declare it. */
export const API_KEY_ALLOWED_ROUTES: ReadonlySet<string> = new Set([
  // Identity: who the key acts as, and the person's public profile (read only).
  'GET /v1/me',
  'GET /v1/me/profile',
  'GET /v1/vanity',

  // Forms.
  'GET /v1/forms',
  'POST /v1/forms',
  'GET /v1/forms/:id',
  'PUT /v1/forms/:id',
  'DELETE /v1/forms/:id',
  'PUT /v1/forms/:id/slug',
  'POST /v1/forms/:id/duplicate',
  'POST /v1/forms/:id/publish',
  'POST /v1/forms/:id/revert',
  'POST /v1/forms/:id/discard-draft',
  'PATCH /v1/forms/:id/folder',

  // Folders.
  'GET /v1/folders',
  'POST /v1/folders',
  'PATCH /v1/folders/:id',
  'DELETE /v1/folders/:id',

  // Destinations.
  'PUT /v1/forms/:id/destinations',
  'POST /v1/forms/:id/destinations/webhook/ping',

  // Responses, their files, deliveries and the CSV.
  'GET /v1/forms/:id/submissions',
  'GET /v1/forms/:id/submissions/:submissionId',
  'GET /v1/forms/:id/submissions/:submissionId/files/:stepKey',
  'GET /v1/forms/:id/submissions-facets',
  'GET /v1/forms/:id/submissions.csv',
  'POST /v1/forms/:id/submissions/bulk-delete',
  'DELETE /v1/submissions/:id',
  'GET /v1/forms/:id/deliveries',

  // Analytics.
  'GET /v1/forms/:id/analytics',
  'GET /v1/forms/:id/summary',
  'GET /v1/forms/:id/summary/:stepKey/answers',

  // Brand kit.
  'GET /v1/branding',
  'PUT /v1/branding',
  'POST /v1/branding/apply',
  'POST /v1/branding/revert',

  // The workspace link page (any member, as in the dashboard).
  'GET /v1/link-page',
  'PUT /v1/link-page',

  // Notifications, workspace-wide and per form.
  'GET /v1/notifications',
  'PUT /v1/notifications/:emailKey',
  'POST /v1/notifications/:emailKey/reset',
  'GET /v1/forms/:id/notifications',
  'PUT /v1/forms/:id/notifications/:emailKey',
  'POST /v1/forms/:id/notifications/:emailKey/reset',

  // Integrations, read only.
  'GET /v1/integrations',
  'GET /v1/integrations/webhooks',
  'GET /v1/integrations/hubspot/properties',
  'GET /v1/integrations/calendly/event-types',
]);

/** Join a controller prefix and a handler path into `/a/b/:c`. */
export function joinRoutePath(...parts: (string | string[] | undefined)[]): string {
  const segments = parts
    .map((p) => (Array.isArray(p) ? p[0] : p) ?? '')
    .join('/')
    .split('/')
    .filter(Boolean);
  return `/${segments.join('/')}`;
}

/** The `METHOD /path` of a controller handler, from its route metadata; null when it has none. */
export function routeOf(controller: object, handler: object): string | null {
  const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
  const path = Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined;
  if (method === undefined || path === undefined) return null;
  const prefix = Reflect.getMetadata(PATH_METADATA, controller) as string | string[] | undefined;
  return `${RequestMethod[method]} ${joinRoutePath(prefix, path)}`;
}

/** Only the authenticated admin surface: `/v1/...`, minus the public form API. */
export function isAdminRoute(route: string): boolean {
  const path = route.slice(route.indexOf(' ') + 1);
  return path.startsWith('/v1/') && !path.startsWith('/v1/public/') && path !== '/v1/public';
}

/** May a request with an API key call this route? Non-admin routes do not care. */
export function isKeyAllowedRoute(route: string): boolean {
  return !isAdminRoute(route) || API_KEY_ALLOWED_ROUTES.has(route);
}

export function keyNotAllowed(): never {
  throw new ForbiddenException({
    error: 'KEY_NOT_ALLOWED',
    message: 'This route cannot be called with an API key. Sign in to dForms to do this.',
  });
}

/**
 * Applied app-wide. Lets every request through untouched unless it carries an
 * API key; with a key, refuses any admin route outside the allowlist. A
 * handler whose route cannot be read is refused too (fail closed).
 *
 * The MCP calls its handlers in process, never through Nest's pipeline, so
 * this guard never runs for an in-process principal; `keyAllowedRoutes`
 * (mcp.backend.ts) makes the same check for every handler the MCP can call,
 * at boot.
 */
@Injectable()
export class ApiKeyRouteGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<ReqLike>();
    if (apiKeyFromRequest(req) === null) return true;
    const route = routeOf(context.getClass(), context.getHandler());
    if (route === null || !isKeyAllowedRoute(route)) keyNotAllowed();
    return true;
  }
}
