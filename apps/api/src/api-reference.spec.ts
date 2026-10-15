/**
 * The API docs page and the API itself cannot drift apart.
 *
 * The docs page renders `API_REFERENCE` (`@quill/shared`). This spec holds it
 * to the routes and handlers the API really has:
 *
 *   1. the documented routes are exactly `API_KEY_ALLOWED_ROUTES`, in both
 *      directions: adding a route a key may call without documenting it fails
 *      here, and so does documenting a route a key cannot call;
 *   2. each route documents its own path parameters, no more and no fewer;
 *   3. every example is sent to the real handler with an API key principal, in
 *      the order an agent would call them: every example body passes the
 *      validation keys are held to (schema plus the strict rules), every call
 *      succeeds with the status the docs print, and every field of every
 *      example answer is a field the handler really returns.
 *
 * Same harness as strict-validation.spec.ts: real controllers on in-memory
 * SQLite, the key principal built by hand from the seeded owner. Handlers are
 * found and called through Nest's own route metadata, so the spec calls the
 * method the app would route the request to, with the arguments its
 * decorators ask for.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BadRequestException, HttpException, RequestMethod } from '@nestjs/common';
import { API_KEY_LIMIT_PER_MEMBER, createDb, migrate, seed, upsertSubmission, type Db } from '@quill/db';
import {
  API_EXAMPLE_ANSWERS,
  API_EXAMPLE_ERROR,
  API_EXAMPLE_ERROR_REQUEST,
  API_EXAMPLE_IDS,
  API_LIMITS,
  API_EXAMPLE_STAMP,
  apiEndpoints,
  type ApiEndpoint,
  type ApiRoute,
} from '@quill/shared';
import type { ServerEnv } from '@quill/config/env';
import { API_KEY_ALLOWED_ROUTES, routeOf } from './api-key-routes';
import { API_KEY_CALLS_PER_MINUTE } from './api-key-auth';
import { AdminCrudController } from './admin-crud.controller';
import { AdminService } from './admin.service';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AuthService } from './auth.service';
import { BrandingController } from './branding.controller';
import {
  CalendlyEventTypesService,
  FormDestinationsController,
  HubspotPropertiesService,
  IntegrationsController,
} from './integrations.controller';
import { LocalAuthProvider, type HostPrincipal, type ReqLike } from './auth.provider';

const endpoints = apiEndpoints();
const documented = new Set<string>(endpoints.map((e) => e.route));

describe('API_REFERENCE against API_KEY_ALLOWED_ROUTES', () => {
  it('documents every route an API key may call', () => {
    const undocumented = [...API_KEY_ALLOWED_ROUTES].filter((r) => !documented.has(r));
    expect(undocumented, 'allowed for keys but missing from API_REFERENCE').toEqual([]);
  });

  it('documents only routes an API key may call', () => {
    const extra = [...documented].filter((r) => !API_KEY_ALLOWED_ROUTES.has(r));
    expect(extra, 'in API_REFERENCE but not allowed for keys').toEqual([]);
  });

  it('documents each route once', () => {
    expect(endpoints).toHaveLength(API_KEY_ALLOWED_ROUTES.size);
  });

  it('names exactly the path parameters of each route', () => {
    for (const e of endpoints) {
      const inPath = [...e.path.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]).sort();
      const params = (e.params ?? []).filter((p) => p.in === 'path').map((p) => p.name).sort();
      expect(params, e.route).toEqual(inPath);
    }
  });

  it('gives every answer that is not a 204 an example, and none to a 204', () => {
    for (const e of endpoints) {
      if (e.status === 204) expect(e.response, e.route).toBeUndefined();
      else expect(e.response ?? null, e.route).not.toBeNull();
    }
  });

  it('states the limits the API enforces', () => {
    expect(API_LIMITS.callsPerMinute).toBe(API_KEY_CALLS_PER_MINUTE);
    expect(API_LIMITS.activeKeysPerMember).toBe(API_KEY_LIMIT_PER_MEMBER);
  });

  it('sends a body only on a method that takes one', () => {
    for (const e of endpoints) {
      if (e.body !== undefined) expect(['POST', 'PUT', 'PATCH'], e.route).toContain(e.method);
      // The curl example wraps the body in single quotes.
      if (e.body !== undefined) expect(JSON.stringify(e.body), e.route).not.toContain("'");
    }
  });
});

// ── Calling the real handlers ─────────────────────────────────────────────

/** Nest's metadata keys (`@nestjs/common/constants`), named here like api-key-routes.ts does. */
const ROUTE_ARGS_METADATA = '__routeArguments__';
const HTTP_CODE_METADATA = '__httpCode__';
const METHOD_METADATA = 'method';
/** `RouteParamtypes` from `@nestjs/common`: the argument decorators the handlers use. */
const ARG = { REQUEST: 0, RESPONSE: 1, BODY: 3, QUERY: 4, PARAM: 5, HEADERS: 6 } as const;

interface Handler {
  instance: Record<string, (...args: unknown[]) => unknown>;
  name: string;
  fn: object;
}

/** Every route the given controllers serve, to the method that serves it. */
function routeTable(controllers: object[]): Map<string, Handler> {
  const table = new Map<string, Handler>();
  for (const instance of controllers) {
    const ctor = instance.constructor;
    for (const name of Object.getOwnPropertyNames(ctor.prototype)) {
      if (name === 'constructor') continue;
      const fn = Object.getOwnPropertyDescriptor(ctor.prototype, name)?.value as object | undefined;
      if (typeof fn !== 'function') continue;
      const route = routeOf(ctor, fn);
      if (route) table.set(route, { instance: instance as Handler['instance'], name, fn });
    }
  }
  return table;
}

/** A stand-in for Express's response, for the one handler that writes its own (the CSV). */
function fakeResponse() {
  const res = {
    headers: {} as Record<string, string>,
    text: '',
    ended: false,
    setHeader(k: string, v: string) {
      res.headers[k.toLowerCase()] = v;
    },
    write(chunk: string) {
      res.text += chunk;
      return true;
    },
    end(chunk?: string) {
      if (chunk) res.text += chunk;
      res.ended = true;
    },
  };
  return res;
}

interface Call {
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
}

interface Answer {
  status: number;
  body: unknown;
}

/**
 * Call the handler the app routes `route` to, the way Nest would: arguments
 * from its decorators, status from `@HttpCode` or Nest's default (201 for a
 * POST, 200 otherwise). Throws what the handler throws.
 */
async function invoke(table: Map<string, Handler>, route: string, call: Call): Promise<Answer> {
  const h = table.get(route);
  if (!h) throw new Error(`no handler serves ${route}`);
  const meta = (Reflect.getMetadata(ROUTE_ARGS_METADATA, h.instance.constructor, h.name) ?? {}) as Record<
    string,
    { index: number; data?: string }
  >;
  const req: ReqLike = { headers: {} };
  const res = fakeResponse();
  const args: unknown[] = [];
  for (const [key, { index, data }] of Object.entries(meta)) {
    const type = Number(key.split(':')[0]);
    const pick = (source: Record<string, unknown>) => (data ? source[data] : source);
    if (type === ARG.REQUEST) args[index] = req;
    else if (type === ARG.RESPONSE) args[index] = res;
    else if (type === ARG.BODY) args[index] = data ? (call.body as Record<string, unknown>)?.[data] : call.body;
    else if (type === ARG.QUERY) args[index] = pick(call.query);
    else if (type === ARG.PARAM) args[index] = pick(call.params);
    else if (type === ARG.HEADERS) args[index] = pick(req.headers as Record<string, unknown>);
    else throw new Error(`${route}: argument type ${type} is not handled by this spec`);
  }
  const out = await h.instance[h.name]!(...args);
  const method = Reflect.getMetadata(METHOD_METADATA, h.fn) as RequestMethod;
  const status =
    (Reflect.getMetadata(HTTP_CODE_METADATA, h.fn) as number | undefined) ??
    (method === RequestMethod.POST ? 201 : 200);
  return { status, body: res.ended ? res.text : out };
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The paths of fields an example answer shows that the real answer lacks.
 * Only presence is compared, never values: an example is an illustration, and
 * ids, stamps and counts differ by design. Each item of an example array must
 * match some item of the real one, when the real one has any.
 */
function missingFields(example: unknown, real: unknown, path = ''): string[] {
  // A nullable field that is null right now still exists.
  if (real === null) return [];
  if (Array.isArray(example)) {
    if (!Array.isArray(real)) return [path || '(root)'];
    if (example.length === 0 || real.length === 0) return [];
    // Items can differ in shape (a choice question and a text one), so each
    // example item has to match SOME real item; report the closest miss.
    return example.flatMap((item, i) => {
      const misses = real.map((r) => missingFields(item, r, `${path}[${i}]`));
      return misses.some((m) => m.length === 0) ? [] : misses.sort((a, b) => a.length - b.length)[0]!;
    });
  }
  if (!isPlainObject(example)) return [];
  if (!isPlainObject(real)) return [path || '(root)'];
  return Object.keys(example).flatMap((key) => {
    const at = path ? `${path}.${key}` : key;
    if (!(key in real)) return [at];
    return missingFields(example[key], real[key], at);
  });
}

/** Swap the example ids and the example stamp for real ones, anywhere in a value. */
function withReal(value: unknown, ids: Record<string, string>, stamp: number): unknown {
  if (typeof value === 'string') return ids[value] ?? value;
  if (value === API_EXAMPLE_STAMP) return stamp;
  if (Array.isArray(value)) return value.map((v) => withReal(v, ids, stamp));
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withReal(v, ids, stamp)]));
  }
  return value;
}

/**
 * Routes whose handler the spec cannot run to success, and why. Their example
 * body (they have none) and their documented status are still checked.
 */
const NOT_RUN: Partial<Record<ApiRoute, string>> = {
  // Needs object storage and a response with an uploaded file; this harness has neither.
  'GET /v1/forms/:id/submissions/:submissionId/files/:stepKey': 'no object storage in the test deployment',
};

describe('every API_REFERENCE example, through the real handlers with an API key', () => {
  let db: Db;
  let table: Map<string, Handler>;
  const ids: Record<string, string> = {};
  const answers = new Map<string, Answer>();
  const failures = new Map<string, unknown>();
  /** Placed by the run, the way an agent would get them. */
  let formId = '';

  /** Run the example of one endpoint and remember its answer or its failure. */
  async function run(e: ApiEndpoint): Promise<void> {
    if (NOT_RUN[e.route]) return;
    const params: Record<string, string> = {};
    for (const p of e.params ?? []) {
      if (p.in !== 'path') continue;
      if (p.name === 'id' && e.area === 'folders') params.id = ids[API_EXAMPLE_IDS.folder]!;
      else if (p.name === 'id' && e.path.startsWith('/v1/submissions/')) params.id = ids[API_EXAMPLE_IDS.submission]!;
      else if (p.name === 'id') params.id = formId;
      else if (p.name === 'submissionId') params.submissionId = ids[API_EXAMPLE_IDS.submission]!;
      else params[p.name] = p.example ?? '';
    }
    const query: Record<string, string> = {};
    for (const p of e.params ?? []) if (p.in === 'query' && p.example !== undefined) query[p.name] = p.example;
    // A guarded write sends the stamp it read, so read it the way an agent would.
    const guarded = JSON.stringify(e.body ?? null).includes(String(API_EXAMPLE_STAMP));
    const stamp = guarded ? (await currentForm()).updatedAt : API_EXAMPLE_STAMP;
    const body = e.body === undefined ? undefined : withReal(e.body, ids, stamp);
    try {
      answers.set(e.route, await invoke(table, e.route, { params, query, body }));
    } catch (err) {
      failures.set(e.route, err);
    }
  }

  /** The form as it is now (the stamp the next guarded write must send). */
  async function currentForm() {
    const a = await invoke(table, 'GET /v1/forms/:id', { params: { id: formId }, query: {}, body: undefined });
    return a.body as { updatedAt: number };
  }

  beforeAll(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    await seed(db);
    const provider = new LocalAuthProvider(db, {
      NODE_ENV: 'test',
      DEV_LOGIN_EMAIL: undefined,
      AUTH_LOCAL_STRICT: undefined,
      SEED_DEMO_FORM: false,
      ONBOARDING_WIZARD: false,
    });
    const session = new AuthService(db, provider);
    const key = Object.create(session) as AuthService;
    key.resolveHost = async (r: ReqLike): Promise<HostPrincipal> => ({
      ...(await session.resolveHost(r)),
      via: 'api_key',
      apiKeyId: 'key_test',
    });
    // Server tokens for HubSpot and Calendly, so their pickers answer with a
    // list (from `providers` below) instead of the disabled state.
    const env = {
      NODE_ENV: 'test',
      PUBLIC_APP_URL: 'https://forms.example.com',
      HUBSPOT_PRIVATE_APP_TOKEN: 'test-token',
      CALENDLY_API_TOKEN: 'test-token',
    } as unknown as ServerEnv;
    const providers = (async (input: string | URL) => {
      const url = String(input);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.includes('/crm/v3/properties/contacts')) {
        return json({
          results: [
            { name: 'company', label: 'Company name', type: 'string' },
            { name: 'lifecyclestage', label: 'Lifecycle stage', type: 'enumeration', options: [{ value: 'lead', label: 'Lead' }] },
          ],
        });
      }
      if (url.includes('/users/me')) {
        return json({ resource: { uri: 'https://api.calendly.example/users/me', email: 'alex@example.com' } });
      }
      if (url.includes('/event_types')) {
        return json({
          collection: [
            {
              uri: 'https://api.calendly.example/event_types/demo',
              name: 'Demo',
              scheduling_url: 'https://calendly.example/acme/demo',
              active: true,
              duration: 30,
              custom_questions: [{ name: 'Company', position: 0, enabled: true, required: true }],
            },
          ],
        });
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;
    const destinations = new FormDestinationsController(db, key, env);
    // The webhook test call answers from here instead of the network.
    destinations.fetchImpl = (async () => new Response('ok', { status: 200 })) as unknown as typeof fetch;
    table = routeTable([
      new AdminCrudController(
        db,
        key,
        new AdminService(db),
        {} as never,
        new AnalyticsService(db),
        undefined,
        undefined,
        undefined,
        undefined,
        env,
      ),
      new AnalyticsController(db, key, new AnalyticsService(db)),
      new BrandingController(db, key),
      new IntegrationsController(
        key,
        new HubspotPropertiesService(env, db, providers),
        new CalendlyEventTypesService(env, db, providers),
        db,
        env,
      ),
      destinations,
    ]);

    const byRoute = new Map(endpoints.map((e) => [e.route, e]));
    // What everything else hangs off: the form and the folder the examples create.
    await run(byRoute.get('POST /v1/forms')!);
    const created = answers.get('POST /v1/forms')?.body as { id: string } | undefined;
    if (!created) throw failures.get('POST /v1/forms');
    formId = created.id;
    ids[API_EXAMPLE_IDS.form] = formId;
    await run(byRoute.get('POST /v1/folders')!);
    ids[API_EXAMPLE_IDS.folder] = (answers.get('POST /v1/folders')?.body as { id: string }).id;
    // A response, as the public form would have stored it, inside the window the filters ask for.
    const row = await upsertSubmission(db, {
      formId,
      sessionId: 'api-reference-spec',
      data: API_EXAMPLE_ANSWERS,
      score: 0,
      now: Date.UTC(2026, 9, 5, 15, 1),
    });
    ids[API_EXAMPLE_IDS.submission] = row.id;

    // Everything else in reading order, then what deletes, last.
    const deletes = (e: ApiEndpoint) => e.destructive === true;
    const rest = endpoints.filter((e) => e.route !== 'POST /v1/forms' && e.route !== 'POST /v1/folders');
    for (const e of rest.filter((x) => !deletes(x))) await run(e);
    // The form goes last: the other deletes hang off it.
    const lastly = (e: ApiEndpoint) => (e.route === 'DELETE /v1/forms/:id' ? 1 : 0);
    for (const e of rest.filter(deletes).sort((a, b) => lastly(a) - lastly(b))) await run(e);
  });

  afterAll(async () => {
    await db?.close();
  });

  it('accepts every example body: no 400 from the schema or the strict rules for keys', () => {
    for (const e of endpoints) {
      const err = failures.get(e.route);
      if (err instanceof BadRequestException) {
        expect.fail(`${e.route}: ${JSON.stringify(err.getResponse())}`);
      }
    }
  });

  it('runs every example to success, with the status the docs print', () => {
    for (const e of endpoints) {
      if (NOT_RUN[e.route]) continue;
      const err = failures.get(e.route);
      if (err) {
        expect.fail(`${e.route}: ${err instanceof HttpException ? JSON.stringify(err.getResponse()) : String(err)}`);
      }
      expect(answers.get(e.route)?.status, e.route).toBe(e.status);
    }
  });

  it('documents only fields the real answers carry', () => {
    for (const e of endpoints) {
      const a = answers.get(e.route);
      if (!a || e.response === undefined) continue;
      if (e.responseType === 'csv') {
        expect(typeof a.body, e.route).toBe('string');
        continue;
      }
      expect(missingFields(e.response, a.body), e.route).toEqual([]);
    }
  });

  it('shows the 400 the API really answers for the example mistakes', async () => {
    let err: unknown;
    try {
      await invoke(table, 'POST /v1/forms', { params: {}, query: {}, body: API_EXAMPLE_ERROR_REQUEST });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toEqual(API_EXAMPLE_ERROR);
  });

  it('skips only what it says it skips', () => {
    for (const route of Object.keys(NOT_RUN)) expect(documented.has(route), route).toBe(true);
  });
});
