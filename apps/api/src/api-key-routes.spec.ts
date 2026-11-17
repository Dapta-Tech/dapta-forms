/**
 * Which routes an API key may call: 403 `KEY_NOT_ALLOWED` on everything the
 * spec leaves out (keys, members, invitations, workspaces, onboarding and
 * attribution, writing the profile or the public page, connecting or
 * disconnecting integrations), and through on the rest of the admin surface.
 *
 * Read off the controllers the app actually registers, so a route added later
 * fails here until someone decides whether a key may call it.
 */
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppModule } from './app.module';
import { AdminCrudController } from './admin-crud.controller';
import { ApiKeysController } from './api-keys.controller';
import { IntegrationsController } from './integrations.controller';
import { LinkPageController } from './link-page.controller';
import { PublicController } from './public.controller';
import {
  API_KEY_ALLOWED_ROUTES,
  ApiKeyRouteGuard,
  isAdminRoute,
  isKeyAllowedRoute,
  routeOf,
} from './api-key-routes';

const KEY = `dforms_${'a'.repeat(43)}`;

/** Every route the app serves, as `METHOD /path`. */
function appRoutes(): string[] {
  const controllers = Reflect.getMetadata('controllers', AppModule) as (new (...a: never[]) => unknown)[];
  const routes: string[] = [];
  for (const c of controllers) {
    for (const name of Object.getOwnPropertyNames(c.prototype)) {
      if (name === 'constructor') continue;
      const handler = Object.getOwnPropertyDescriptor(c.prototype, name)?.value as object | undefined;
      if (typeof handler !== 'function') continue;
      const route = routeOf(c, handler);
      if (route) routes.push(route);
    }
  }
  return routes;
}

/** The spec's "not with a key" list, spelled out route by route. */
const DENIED = new Set([
  // Keys themselves.
  'GET /v1/api-keys',
  'POST /v1/api-keys',
  'DELETE /v1/api-keys/:id',
  // Members and invitations.
  'GET /v1/members',
  'POST /v1/members',
  'PATCH /v1/members/:id',
  'DELETE /v1/members/:id',
  'GET /v1/invitations',
  'POST /v1/invitations/:id/resend',
  // Workspaces: create, rename, enter, refresh, and the rest of them.
  'GET /v1/workspaces',
  'POST /v1/workspaces',
  'POST /v1/workspaces/refresh',
  'PATCH /v1/workspaces/current',
  'PATCH /v1/workspaces/current/timezone',
  'POST /v1/workspaces/:id/enter',
  'GET /v1/workspaces/search',
  'POST /v1/workspaces/estate/:workspaceId/enter',
  // Onboarding and attribution.
  'POST /v1/account/attribution',
  'GET /v1/account/attribution-badge',
  'PUT /v1/account/attribution-badge',
  'PATCH /v1/account/onboarding',
  'POST /v1/account/onboarding/complete',
  // Writing the profile, the language and the public page.
  'PUT /v1/me/profile',
  'PUT /v1/me/locale',
  'PUT /v1/vanity',
  // Connecting or disconnecting an integration.
  'POST /v1/integrations/:provider/connect',
  'DELETE /v1/integrations/:provider',
  // The dCal picker, which is the one integration read a key cannot do. It
  // holds no stored credential: it forwards the CALLER'S session to dCal, and
  // a key is not a session, so for a key it could only ever answer
  // "unavailable". Its two siblings above are allowed because they read a
  // token the account connected once, which a key can use.
  'GET /v1/integrations/dcal/event-types',
  // Salesforce, both routes. Connecting is the same admin action as
  // `:provider/connect` (it takes a secret), only with three values instead of
  // one. The field list is a key-readable integration read in principle, like
  // HubSpot's property list, but opening it also opens the public API
  // reference, the developer skill and an MCP tool with its own parity; that
  // is its own change, so it stays shut until then rather than half-open.
  'POST /v1/integrations/salesforce/connect',
  'GET /v1/integrations/salesforce/fields',
  // The Google Sheets consent flow, both halves. A key cannot start one (there
  // is no browser to send anywhere and no human to consent), and cannot finish
  // one either.
  //
  // The callback is additionally the one route on the admin surface that
  // authenticates nobody: Google redirects a browser to it with no header and no
  // cookie this host could read, and its signed `state` is what authorizes the
  // write instead (see `google-oauth.ts`). `isAdminRoute` classes it as admin on
  // its path alone, so if a blanket auth guard is ever put over the admin
  // surface, this route has to be excluded from it or connecting Google Sheets
  // breaks with no error anyone would connect to the cause.
  'POST /v1/integrations/google-sheets/authorize',
  'GET /v1/integrations/google-sheets/callback',
  // The two helpers the Connect tab's Google Sheets card calls: the tab picker
  // and the one-time header row.
  //
  // Denied for now as a DELIBERATE, reversible choice, not because a key could
  // do harm with them. In this repo a key-allowed route is a route of the
  // PUBLIC API contract: it has to appear in `API_REFERENCE` with prose in both
  // locales, and its documented response has to match what the route really
  // answers. Putting two Google-specific routes into that contract is a product
  // decision about the public API, separate from shipping the editor, and it is
  // far easier to add a route to the contract later than to take one out.
  //
  // What a key loses meanwhile: an agent configuring a Google Sheets
  // destination has to be told the tab's name rather than discovering it, and
  // writes its own header row. Everything else about the destination is already
  // key-configurable through `PUT /v1/forms/:id/destinations`.
  'GET /v1/integrations/google-sheets/tabs',
  'POST /v1/integrations/google-sheets/header-row',
  // The form-scoped header button, for the same contract reason. A key does
  // not need it: a `PUT /v1/forms/:id/destinations` that changes the columns
  // brings row 1 in line by itself.
  'POST /v1/forms/:id/destinations/google-sheets/header-row',
  // Creating a spreadsheet for a form: denied for the same reversible reason as
  // the two above. It is the one of these an agent would miss most, because
  // under the `drive.file` scope a spreadsheet reaches a form only by being
  // created here or chosen in the Picker, so a key cannot point a form at a
  // spreadsheet the app was never handed. Opening it is the same contract
  // decision.
  'POST /v1/integrations/google-sheets/spreadsheets',
  // The Picker's configuration. This one is denied on its merits, not pending a
  // decision: its answer carries a Google access token for a browser to open a
  // file chooser with, and a key has no browser and no chooser.
  'GET /v1/integrations/google-sheets/picker',
]);

/** Allowlisted ahead of the route landing in its own change (revert, #60). */
const NOT_YET_SERVED = new Set(['POST /v1/forms/:id/revert']);

function contextFor(controller: object, handler: object, headers: Record<string, string>): ExecutionContext {
  return {
    getType: () => 'http',
    getClass: () => controller,
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => ({ headers }), getResponse: () => ({}) }),
  } as unknown as ExecutionContext;
}

describe('the API key route allowlist', () => {
  const routes = appRoutes();
  const admin = routes.filter(isAdminRoute);

  it('reads the real routes', () => {
    expect(routes).toContain('GET /v1/forms/:id');
    expect(routes).toContain('GET /v1/branding');
    expect(routes).toContain('GET /v1/public/forms/:accountCode/:slug');
    expect(admin).not.toContain('GET /v1/public/forms/:accountCode/:slug');
  });

  it('refuses exactly the routes the spec leaves out, and lets every other admin route through', () => {
    for (const route of DENIED) expect(routes, `${route} is not served`).toContain(route);
    for (const route of admin) {
      expect(isKeyAllowedRoute(route), route).toBe(!DENIED.has(route));
    }
  });

  it('names only routes the app serves', () => {
    for (const route of API_KEY_ALLOWED_ROUTES) {
      if (NOT_YET_SERVED.has(route)) continue;
      expect(admin, route).toContain(route);
    }
  });

  it('does not touch the public form API or the health and docs routes', () => {
    for (const route of routes.filter((r) => !isAdminRoute(r))) {
      expect(isKeyAllowedRoute(route), route).toBe(true);
    }
  });
});

describe('ApiKeyRouteGuard', () => {
  const guard = new ApiKeyRouteGuard();
  const auth = { authorization: `Bearer ${KEY}` };

  const refused = (c: object, h: object) => {
    let err: unknown;
    try {
      guard.canActivate(contextFor(c, h, auth));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({ error: 'KEY_NOT_ALLOWED' });
  };

  it('with a key, a route the spec leaves out is a 403 KEY_NOT_ALLOWED', () => {
    const p = AdminCrudController.prototype;
    refused(AdminCrudController, p.members);
    refused(AdminCrudController, p.inviteMember);
    refused(AdminCrudController, p.createWorkspace);
    refused(AdminCrudController, p.completeOnboarding);
    refused(AdminCrudController, p.setVanity);
    refused(AdminCrudController, p.saveMyProfile);
    refused(ApiKeysController, ApiKeysController.prototype.create);
    refused(IntegrationsController, IntegrationsController.prototype.connect);
  });

  it('with a key, an allowed route goes through', () => {
    const p = AdminCrudController.prototype;
    expect(guard.canActivate(contextFor(AdminCrudController, p.createForm, auth))).toBe(true);
    expect(guard.canActivate(contextFor(AdminCrudController, p.me, auth))).toBe(true);
    expect(guard.canActivate(contextFor(IntegrationsController, IntegrationsController.prototype.list, auth))).toBe(
      true,
    );
    expect(guard.canActivate(contextFor(PublicController, PublicController.prototype.form, auth))).toBe(true);
    expect(guard.canActivate(contextFor(LinkPageController, LinkPageController.prototype.get, auth))).toBe(true);
    expect(guard.canActivate(contextFor(LinkPageController, LinkPageController.prototype.put, auth))).toBe(true);
  });

  it('without a key, or with a session bearer, every route goes through untouched', () => {
    const members = AdminCrudController.prototype.members;
    expect(guard.canActivate(contextFor(AdminCrudController, members, {}))).toBe(true);
    expect(
      guard.canActivate(contextFor(AdminCrudController, members, { authorization: 'Bearer eyJ.session' })),
    ).toBe(true);
  });

  it('is registered app-wide', () => {
    const providers = Reflect.getMetadata('providers', AppModule) as unknown[];
    expect(providers).toContainEqual({ provide: APP_GUARD, useClass: ApiKeyRouteGuard });
  });
});
