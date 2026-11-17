/**
 * R15 guard: the public OpenAPI document must carry NO vendor or internal
 * infrastructure names — it ships in the public repo and is served by every
 * fork. Also pins the forms surface shape the web app depends on.
 */
import { describe, it, expect } from 'vitest';
import { openapiSpec, routeOfOperation } from './openapi';
import { API_KEY_ALLOWED_ROUTES, isAdminRoute } from './api-key-routes';

type Operation = { security?: Array<Record<string, unknown>>; description?: string; responses?: Record<string, unknown> };
const METHODS = ['get', 'put', 'post', 'patch', 'delete'] as const;
const paths = openapiSpec.paths as unknown as Record<string, Record<string, unknown>>;
/** Every operation of the document, with the route the API knows it by. */
const operations = Object.entries(paths).flatMap(([path, item]) =>
  METHODS.filter((m) => item[m]).map((m) => ({ path, method: m, route: routeOfOperation(m, path), op: item[m] as Operation })),
);
const op = (path: string, method: (typeof METHODS)[number]): Operation => {
  const found = paths[path]?.[method];
  expect(found, `${method.toUpperCase()} ${path} is documented`).toBeTruthy();
  return found as Operation;
};
const schemes = (o: Operation) => (o.security ?? []).flatMap((s) => Object.keys(s));

// Built by concatenation so this spec never trips the publish-gate's own
// internal-token grep (the literal strings must not appear in the tree).
const FORBIDDEN = [
  'workos',
  ['dapta', '_forms'].join(''),
  ['forms', '_ms'].join(''),
  ['auro', 'ra'].join(''),
  ['amazon', 'aws'].join(''),
  'flux',
  ['dapta', '-iam'].join(''),
  // The challenge provider is a deployment choice behind a port: the public
  // contract describes a "human check", never whose.
  'turnstile',
  'cloudflare',
];

describe('openapi spec', () => {
  it('contains no vendor/internal names (R15)', () => {
    const text = JSON.stringify(openapiSpec).toLowerCase();
    for (const word of FORBIDDEN) {
      expect(text.includes(word), `forbidden token "${word}" in openapi.json`).toBe(false);
    }
  });

  it('describes the public forms surface', () => {
    expect(openapiSpec.info.title).toBe('Quill API');
    const paths = Object.keys(openapiSpec.paths);
    expect(paths).toContain('/v1/public/forms/{accountCode}/{slug}');
    expect(paths).toContain('/v1/public/forms/{accountCode}/{slug}/submissions');
    expect(paths).toContain('/health');
  });

  it('documents the visit on the submit, and only its safe view on the dashboard read', () => {
    const submit = JSON.stringify(openapiSpec.paths['/v1/public/forms/{accountCode}/{slug}/submissions'].post);
    for (const key of ['visit', 'pageUri', 'pageName', 'pageId', 'hutk', 'hsPortalId', 'embedded']) {
      expect(submit).toContain(key);
    }
    const read = JSON.stringify(openapiSpec.paths['/v1/forms/{id}/submissions/{submissionId}'].get);
    expect(read).toContain('hubspotCookie');
    expect(read).not.toContain('hutk');
  });

  it('documents the human check on the submit: the token field and the 403/503 answers', () => {
    const submit = openapiSpec.paths['/v1/public/forms/{accountCode}/{slug}/submissions'].post;
    expect(JSON.stringify(submit)).toContain('captchaToken');
    expect(Object.keys(submit.responses)).toEqual(expect.arrayContaining(['201', '400', '403', '503']));
    expect(JSON.stringify(submit.responses)).toContain('CAPTCHA_REQUIRED');
    expect(JSON.stringify(submit.responses)).toContain('CAPTCHA_UNAVAILABLE');
  });

  it('documents the API key bearer scheme and the key routes', () => {
    const scheme = openapiSpec.components.securitySchemes.apiKey;
    expect(scheme).toMatchObject({ type: 'http', scheme: 'bearer' });
    for (const code of ['KEY_NOT_ALLOWED', 'INVALID_API_KEY', 'WORKSPACE_FORBIDDEN', 'RATE_LIMITED', 'Retry-After']) {
      expect(scheme.description).toContain(code);
    }
    const paths = Object.keys(openapiSpec.paths);
    expect(paths).toEqual(expect.arrayContaining(['/v1/api-keys', '/v1/api-keys/{id}']));
    expect(JSON.stringify(openapiSpec.paths['/v1/api-keys'].post)).toContain('KEY_LIMIT');
  });

  it('says where API keys come from today, not the dashboard screen that is gone', () => {
    const { description } = openapiSpec.components.securitySchemes.apiKey;
    expect(description).not.toMatch(/under MCP, API keys/);
    expect(description).toContain('POST /v1/api-keys');
    expect(description).toMatch(/no longer has a screen/);
  });

  it('tags exactly the host operations an API key may call with apiKey, derived from API_KEY_ALLOWED_ROUTES', () => {
    const host = operations.filter((o) => isAdminRoute(o.route));
    expect(host.length).toBeGreaterThan(0);
    for (const o of host) {
      expect(schemes(o.op), o.route).toContain('hostSession');
      if (API_KEY_ALLOWED_ROUTES.has(o.route)) expect(schemes(o.op), o.route).toContain('apiKey');
      else expect(schemes(o.op), o.route).toEqual(['hostSession']);
    }
    // The key routes themselves stay session only; the forms surface takes a key.
    expect(schemes(op('/v1/api-keys', 'post'))).toEqual(['hostSession']);
    expect(schemes(op('/v1/me/locale', 'put'))).toEqual(['hostSession']);
    expect(schemes(op('/v1/forms', 'post'))).toEqual(['hostSession', 'apiKey']);
    // Public operations carry no security at all.
    for (const o of operations.filter((x) => !isAdminRoute(x.route))) expect(o.op.security, o.route).toBeUndefined();
    // Every scheme an operation names is declared.
    const declared = Object.keys(openapiSpec.components.securitySchemes);
    for (const o of operations) for (const name of schemes(o.op)) expect(declared, o.route).toContain(name);
  });

  it('documents PUT /v1/forms/{id}/destinations: the body, warnings, sheetHeaders and the INTEGRATION_NOT_CONNECTED body', () => {
    const put = op('/v1/forms/{id}/destinations', 'put') as Operation & { requestBody?: unknown };
    expect(schemes(put)).toEqual(['hostSession', 'apiKey']);
    expect(JSON.stringify(put.requestBody)).toContain('#/components/schemas/Destination');
    const ok = JSON.stringify(put.responses?.['200']);
    expect(ok).toContain('warnings');
    expect(ok).toContain('#/components/schemas/SheetHeaders');
    expect(ok).toContain('#/components/schemas/DestinationWarning');
    expect(JSON.stringify(put.responses?.['400'])).toContain('#/components/schemas/IntegrationNotConnected');
    expect(put.description).toContain('sheetHeaders');
    const refusal = openapiSpec.components.schemas.IntegrationNotConnected;
    expect(refusal.properties.error).toEqual({ const: 'INTEGRATION_NOT_CONNECTED' });
    expect(refusal.required).toEqual(expect.arrayContaining(['provider', 'index', 'integrationsUrl', 'unavailable']));
    expect(openapiSpec.components.schemas.SheetHeaders.properties.outcome.enum).toEqual(['written', 'unchanged', 'stale', 'foreign', 'failed']);
    expect(JSON.stringify(openapiSpec.components.schemas.SheetHeaders)).toContain('sheet_header_row');
    expect(openapiSpec.components.schemas.DestinationWarning.properties.code.enum).toEqual([
      'INTEGRATION_NOT_CONNECTED',
      'DESTINATION_INCOMPLETE',
    ]);
  });

  it('documents the POST /v1/forms refusal and warnings, on the operation itself', () => {
    const post = op('/v1/forms', 'post');
    expect(post.description).toContain('INTEGRATION_NOT_CONNECTED');
    expect(post.description).toContain('warnings');
    expect(JSON.stringify(post.responses?.['400'])).toContain('#/components/schemas/IntegrationNotConnected');
    expect(JSON.stringify(post.responses?.['201'])).toContain('#/components/schemas/DestinationWarning');
    // The create description once hung off the path item, outside any operation.
    expect(paths['/v1/forms']).not.toHaveProperty('description');
  });

  it('documents unavailable, dcal and googlePicker on GET /v1/integrations', () => {
    const get = op('/v1/integrations', 'get');
    expect(JSON.stringify(get.responses?.['200'])).toContain('#/components/schemas/Integrations');
    const list = openapiSpec.components.schemas.Integrations;
    expect(list.required).toEqual(expect.arrayContaining(['unavailable', 'dcal', 'googlePicker', 'serverProvided']));
    expect(Object.keys(list.properties)).toEqual(expect.arrayContaining(['unavailable', 'dcal', 'googlePicker']));
    expect(list.properties.dcal.type).toEqual(['object', 'null']);
  });

  it('resolves every $ref to a declared schema', () => {
    const refs = [...JSON.stringify(openapiSpec).matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(0);
    for (const name of refs) expect(Object.keys(openapiSpec.components.schemas), name).toContain(name);
  });
});
