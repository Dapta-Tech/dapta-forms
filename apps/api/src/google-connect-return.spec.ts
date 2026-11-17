/**
 * Where a finished Google consent flow lands.
 *
 * Connecting Google Sheets used to be possible only from the account's
 * Integrations page, so the callback always redirected there. The form's
 * Connect tab can now start the flow itself, and the author must come back to
 * the card they pressed the button on, not to a page they never opened.
 *
 * The path comes from the SIGNED state and from nowhere else, and only ever
 * from a two-shape allowlist under the deployment's own `PUBLIC_APP_URL`, so
 * the callback (unauthenticated by necessity) cannot become an open redirect.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, getAccountByCode, migrate, seed, type Db } from '@quill/db';
import type { ServerEnv } from '@quill/config/env';
import {
  CalendlyEventTypesService,
  HubspotPropertiesService,
  IntegrationsController,
} from './integrations.controller';
import { AuthService } from './auth.service';
import { LocalAuthProvider, type ReqLike } from './auth.provider';
import { googleStateKey, signGoogleState } from './google-oauth';

const asOwner = (): ReqLike => ({ headers: {} });
const APP = 'https://forms.example.test';
const FORM_PATH = '/admin/forms/3f1c2a4e-0000-4000-8000-000000000001/edit';

const env = {
  NODE_ENV: 'test',
  FORMS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  PUBLIC_APP_URL: APP,
  GOOGLE_OAUTH_CLIENT_ID: 'cid.apps.googleusercontent.com',
  GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret',
  GOOGLE_OAUTH_REDIRECT_URI: 'https://api.example.test/v1/integrations/google-sheets/callback',
} as unknown as ServerEnv;

/** Google's token endpoint, answering with a usable grant. */
const googleFetch = (async () =>
  new Response(
    JSON.stringify({
      access_token: 'ya29.a',
      refresh_token: '1//r',
      expires_in: 3600,
      scope: 'https://www.googleapis.com/auth/drive.file openid email',
    }),
    { status: 200 },
  )) as unknown as typeof fetch;

let db: Db;
let controller: IntegrationsController;
let accountId: string;

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db);
  accountId = (await getAccountByCode(db, 'acme'))!.id;
  const provider = new LocalAuthProvider(db, {
    NODE_ENV: 'test',
    DEV_LOGIN_EMAIL: undefined,
    AUTH_LOCAL_STRICT: undefined,
    SEED_DEMO_FORM: false,
    ONBOARDING_WIZARD: false,
  });
  controller = new IntegrationsController(
    new AuthService(db, provider),
    new HubspotPropertiesService(env, db, googleFetch),
    new CalendlyEventTypesService(env, db, googleFetch),
    db,
    env,
  );
  controller.fetchImpl = googleFetch;
});

afterEach(async () => {
  await db.close();
});

const stateFrom = (authUrl: string) => new URL(authUrl).searchParams.get('state')!;

describe('starting the flow from a form', () => {
  it('returns to that form’s Connect tab once connected', async () => {
    const { authUrl } = await controller.googleAuthorize(asOwner(), { returnTo: FORM_PATH });
    const out = await controller.googleCallback('code-1', stateFrom(authUrl), undefined);
    expect(out).toEqual({ url: `${APP}${FORM_PATH}?tab=connect&google=connected`, statusCode: 302 });
  });

  it('returns there on Cancel too, so the author is not dropped somewhere else', async () => {
    const { authUrl } = await controller.googleAuthorize(asOwner(), { returnTo: FORM_PATH });
    const out = await controller.googleCallback(undefined, stateFrom(authUrl), 'access_denied');
    expect(out.url).toBe(`${APP}${FORM_PATH}?tab=connect&google=cancelled`);
  });

  it('still returns to the Integrations page when no path was given', async () => {
    const { authUrl } = await controller.googleAuthorize(asOwner());
    const out = await controller.googleCallback('code-1', stateFrom(authUrl), undefined);
    expect(out.url).toBe(`${APP}/admin/integrations?google=connected`);
  });
});

describe('never an open redirect', () => {
  it('drops an off-site return path at the start, and lands on Integrations', async () => {
    for (const returnTo of ['https://evil.example/x', '//evil.example', '/admin/forms/x/edit?x=//evil']) {
      const { authUrl } = await controller.googleAuthorize(asOwner(), { returnTo });
      const out = await controller.googleCallback('code-1', stateFrom(authUrl), undefined);
      expect(out.url).toBe(`${APP}/admin/integrations?google=connected`);
    }
  });

  it('ignores a path in a state it did not sign', async () => {
    const forged = signGoogleState(accountId, Buffer.alloc(32, 9), Date.now(), FORM_PATH);
    const out = await controller.googleCallback('code-1', forged, 'access_denied');
    expect(out.url).toBe(`${APP}/admin/integrations?google=cancelled`);
  });

  it('only ever redirects to the deployment’s own origin', async () => {
    const key = googleStateKey(env)!;
    const state = signGoogleState(accountId, key, Date.now(), FORM_PATH);
    const out = await controller.googleCallback('code-1', state, undefined);
    expect(new URL(out.url).origin).toBe(APP);
  });
});
