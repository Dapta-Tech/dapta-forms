/**
 * Deprecated API hosts (API_DEPRECATED_HOSTS): the settings and their boot
 * checks, then the real app over HTTP. Requests go through `node:http`
 * because `fetch` will not send a Host header of the caller's choosing, and
 * the Host header is the whole point here.
 */
import { request } from 'node:http';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { sql } from '@quill/db';
import { apiDeprecation, loadServerEnv } from '@quill/config/env';
import { hashApiKey } from './api-keys';
import { bootHarness, initialize, type Harness } from './mcp-harness';
import { successorLink } from './deprecated-hosts';

const SUCCESSOR = 'https://api.example.org';
const DEPRECATED_AT = '2026-01-31';
const DEPRECATION = `@${Date.UTC(2026, 0, 31) / 1000}`;

const on = (hosts: string, extra: Record<string, string> = {}) => ({
  API_DEPRECATED_HOSTS: hosts,
  API_SUCCESSOR_URL: SUCCESSOR,
  API_DEPRECATION_DATE: DEPRECATED_AT,
  ...extra,
});

describe('apiDeprecation (the settings)', () => {
  it('is off when the list is unset or blank, and then reads nothing else', () => {
    expect(apiDeprecation({})).toBeNull();
    expect(apiDeprecation({ API_DEPRECATED_HOSTS: '' })).toBeNull();
    expect(apiDeprecation({ API_DEPRECATED_HOSTS: ' , ,' })).toBeNull();
    // A leftover successor or date with no list is not a reason to refuse a boot.
    expect(apiDeprecation({ API_SUCCESSOR_URL: 'not a url', API_DEPRECATION_DATE: 'soon' })).toBeNull();
  });

  it('trims, lowercases, de-duplicates and reduces origins to hostnames', () => {
    const s = apiDeprecation(on(' API.Example.com ,https://api-old.example.com:8443, api.example.com,'));
    expect(s).toEqual({
      hosts: ['api.example.com', 'api-old.example.com'],
      successorOrigin: SUCCESSOR,
      deprecation: DEPRECATION,
      sunset: null,
    });
  });

  it('refuses an entry that is not a hostname', () => {
    for (const bad of ['*.example.com', 'api.example.com:443', 'api.example.com/v1', 'ftp://api.example.com', 'api_example.com', 'https://']) {
      expect(() => apiDeprecation(on(`api.example.net,${bad}`)), bad).toThrow(/API_DEPRECATED_HOSTS entry .* is not a hostname/);
    }
  });

  it('needs the successor as a plain https origin, and normalizes it', () => {
    expect(apiDeprecation(on('api.example.com', { API_SUCCESSOR_URL: ' https://API.example.org/ ' }))?.successorOrigin).toBe(SUCCESSOR);
    expect(apiDeprecation(on('api.example.com', { API_SUCCESSOR_URL: 'https://api.example.org:8443' }))?.successorOrigin).toBe(
      'https://api.example.org:8443',
    );
    for (const bad of [
      '',
      'api.example.org',
      'http://api.example.org',
      'https://api.example.org/v1',
      'https://api.example.org/?x=1',
      'https://api.example.org/#top',
      // Built through the URL setters so the secret scanners see no credentialed URL in the source.
      Object.assign(new URL(SUCCESSOR), { username: 'u', password: 'p' }).href,
      'https://[::1]',
      'not a url',
    ]) {
      expect(() => apiDeprecation(on('api.example.com', { API_SUCCESSOR_URL: bad })), bad).toThrow(/API_SUCCESSOR_URL .*https origin/);
    }
  });

  it('refuses to list the successor host itself', () => {
    expect(() => apiDeprecation(on('api.example.com,API.EXAMPLE.ORG'))).toThrow(/lists api\.example\.org, the host of API_SUCCESSOR_URL/);
  });

  it('needs a deprecation date, as a day or an ISO date-time with a zone', () => {
    expect(() => apiDeprecation(on('api.example.com', { API_DEPRECATION_DATE: '' }))).toThrow(/without API_DEPRECATION_DATE/);
    const at = (v: string) => apiDeprecation(on('api.example.com', { API_DEPRECATION_DATE: v }))?.deprecation;
    expect(at('2026-01-31')).toBe(DEPRECATION);
    expect(at('2026-01-31T00:00:00Z')).toBe(DEPRECATION);
    expect(at('2026-01-31T05:00:00+05:00')).toBe(DEPRECATION);
    expect(at('2026-01-31T00:00:00.999Z')).toBe(DEPRECATION);
    for (const bad of ['2026-02-30', '2026-13-01', '31/01/2026', 'Jan 31 2026', '2026-01-31T00:00:00', '2026-01-31T24:00Z', '@1769817600', 'soon']) {
      expect(() => at(bad), bad).toThrow(/API_DEPRECATION_DATE .* is not a date/);
    }
  });

  it('sends a Sunset only when configured, never before the deprecation', () => {
    expect(apiDeprecation(on('api.example.com', { API_SUNSET_DATE: '2026-07-31' }))?.sunset).toBe('Fri, 31 Jul 2026 00:00:00 GMT');
    expect(apiDeprecation(on('api.example.com', { API_SUNSET_DATE: DEPRECATED_AT }))?.sunset).toBe('Sat, 31 Jan 2026 00:00:00 GMT');
    expect(() => apiDeprecation(on('api.example.com', { API_SUNSET_DATE: '2026-01-30' }))).toThrow(/earlier than API_DEPRECATION_DATE/);
    expect(() => apiDeprecation(on('api.example.com', { API_SUNSET_DATE: 'later' }))).toThrow(/API_SUNSET_DATE .* is not a date/);
  });

  it('is checked at boot: loadServerEnv refuses a bad setting and boots without one', () => {
    expect(() => loadServerEnv({ ...on('*.example.com') })).toThrow(/Refusing to boot: API_DEPRECATED_HOSTS entry/);
    expect(() => loadServerEnv({ ...on('api.example.com', { API_SUCCESSOR_URL: 'http://api.example.org' }) })).toThrow(
      /Refusing to boot: API_SUCCESSOR_URL/,
    );
    expect(() => loadServerEnv({ API_DEPRECATED_HOSTS: 'api.example.com' })).toThrow(/Refusing to boot: API_SUCCESSOR_URL/);
    expect(loadServerEnv({}).API_DEPRECATED_HOSTS).toBeUndefined();
    expect(loadServerEnv({ ...on('api.example.com') }).API_DEPRECATED_HOSTS).toBe('api.example.com');
  });
});

describe('successorLink', () => {
  it('points at the same path on the successor, without the query', () => {
    expect(successorLink(SUCCESSOR, { originalUrl: '/v1/forms/abc?token=secret#x' })).toBe(
      '<https://api.example.org/v1/forms/abc>; rel="successor-version"',
    );
    expect(successorLink(SUCCESSOR, { url: '/mcp' })).toBe('<https://api.example.org/mcp>; rel="successor-version"');
    expect(successorLink(SUCCESSOR, {})).toBe('<https://api.example.org/>; rel="successor-version"');
  });

  it('never leaves the successor host, and nothing breaks out of the brackets', () => {
    expect(successorLink(SUCCESSOR, { originalUrl: '//other.example/x' })).toBe(
      '<https://api.example.org//other.example/x>; rel="successor-version"',
    );
    expect(successorLink(SUCCESSOR, { originalUrl: '/a>; rel="x"<b' })).toBe(
      '<https://api.example.org/a%3E;%20rel=%22x%22%3Cb>; rel="successor-version"',
    );
  });
});

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** One HTTP request to the harness with the Host header set to `host`. */
function send(
  h: Harness,
  host: string,
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: unknown; raw?: string } = {},
): Promise<Reply> {
  const { port } = new URL(h.base);
  const body = opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: Number(port),
        path,
        method: opts.method ?? 'GET',
        headers: {
          host,
          ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) }),
          ...opts.headers,
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (text += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

const mcpHeaders = (key?: string): Record<string, string> => ({
  accept: 'application/json, text/event-stream',
  ...(key ? { authorization: `Bearer ${key}` } : {}),
});

const open: Harness[] = [];
async function boot(env: Parameters<typeof bootHarness>[0] = {}) {
  const h = await bootHarness(env);
  open.push(h);
  return h;
}
afterAll(async () => {
  await Promise.all(open.map((h) => h.close()));
});

/** Let any response-end listener that is going to run, run. */
const settle = () => new Promise((r) => setTimeout(r, 50));

async function keyIdOf(h: Harness, key: string): Promise<string> {
  return (await h.db.get<{ id: string }>(sql`SELECT id FROM api_key WHERE key_hash = ${hashApiKey(key)}`))!.id;
}

function expectDeprecated(reply: Reply, path: string): void {
  expect(reply.headers.deprecation).toBe(DEPRECATION);
  expect(reply.headers.link).toBe(`<${SUCCESSOR}${path}>; rel="successor-version"`);
}

function expectNotDeprecated(reply: Reply): void {
  expect(reply.headers.deprecation).toBeUndefined();
  expect(reply.headers.link).toBeUndefined();
  expect(reply.headers.sunset).toBeUndefined();
}

describe('unset (the default)', () => {
  it('sends no header and logs nothing, whatever the host', async () => {
    const h = await boot();
    const { key } = await h.key();
    const health = await send(h, 'api.example.com', '/health');
    expect(health.status).toBe(200);
    expectNotDeprecated(health);
    const keyed = await send(h, 'api.example.com', '/v1/forms', { headers: { authorization: `Bearer ${key}` } });
    expect(keyed.status).toBe(200);
    expectNotDeprecated(keyed);
    await settle();
    expect(h.deprecatedHostLog).toEqual([]);
  });
});

describe('a listed host', () => {
  it('carries the headers on a 200 and on 4xx answers, Sunset when configured', async () => {
    const h = await boot({ ...on('api.example.com,api-old.example.com', { API_SUNSET_DATE: '2026-07-31' }) });
    const ok = await send(h, 'api.example.com', '/health?probe=1');
    expect(ok.status).toBe(200);
    expectDeprecated(ok, '/health');
    expect(ok.headers.sunset).toBe('Fri, 31 Jul 2026 00:00:00 GMT');

    const missing = await send(h, 'api.example.com', '/v1/no-such-route');
    expect(missing.status).toBe(404);
    expectDeprecated(missing, '/v1/no-such-route');

    const unauthenticated = await send(h, 'api-old.example.com', '/v1/forms', { headers: { authorization: 'Bearer dforms_not_a_real_key' } });
    expect(unauthenticated.status).toBe(401);
    expectDeprecated(unauthenticated, '/v1/forms');

    // Refused by the body parser, before any route or guard runs.
    const badJson = await send(h, 'api.example.com', '/v1/forms', { method: 'POST', raw: '{"name":' });
    expect(badJson.status).toBe(400);
    expectDeprecated(badJson, '/v1/forms');

    // None of those authenticated with a key, so none is logged.
    await settle();
    expect(h.deprecatedHostLog).toEqual([]);
  });

  it('matches the host case-insensitively and ignores its port', async () => {
    const h = await boot({ ...on('api.example.com') });
    expectDeprecated(await send(h, 'API.Example.COM:443', '/health'), '/health');
  });

  it('logs one line per keyed call, with the key id and never the key', async () => {
    const h = await boot({ ...on('api.example.com') });
    const { key } = await h.key();
    const keyId = await keyIdOf(h, key);

    const reply = await send(h, 'api.example.com', `/v1/forms/${h.formId}?expand=all`, { headers: { authorization: `Bearer ${key}` } });
    expect(reply.status).toBe(200);
    expectDeprecated(reply, `/v1/forms/${h.formId}`);
    await vi.waitFor(() => expect(h.deprecatedHostLog).toHaveLength(1));
    await settle();
    expect(h.deprecatedHostLog).toHaveLength(1);

    const line = h.deprecatedHostLog[0]!;
    expect(JSON.parse(line)).toEqual({
      event: 'deprecated_api_host_call',
      host: 'api.example.com',
      keyId,
      accountId: h.accountId,
      method: 'GET',
      route: '/v1/forms/:id',
      status: 200,
    });
    expect(line).not.toContain(key);
    expect(line).not.toContain(key.slice('dforms_'.length));
    expect(line).not.toContain('expand');
  });

  it('logs a keyed call that the key path refuses, with its status', async () => {
    const h = await boot({ ...on('api.example.com') });
    const { key } = await h.key();
    const reply = await send(h, 'api.example.com', '/v1/forms', {
      headers: { authorization: `Bearer ${key}`, 'x-quill-workspace': h.other.accountId },
    });
    expect(reply.status).toBe(403);
    expectDeprecated(reply, '/v1/forms');
    await vi.waitFor(() => expect(h.deprecatedHostLog).toHaveLength(1));
    expect(JSON.parse(h.deprecatedHostLog[0]!)).toMatchObject({
      keyId: await keyIdOf(h, key),
      accountId: h.accountId,
      route: '/v1/forms',
      status: 403,
    });
  });

  it('logs nothing for a call without a key', async () => {
    const h = await boot({ ...on('api.example.com') });
    expect((await send(h, 'api.example.com', '/v1/forms')).status).toBe(200);
    await settle();
    expect(h.deprecatedHostLog).toEqual([]);
  });
});

describe('a host that is not listed', () => {
  it('gets nothing: no header, no line, for health checks and in-cluster names alike', async () => {
    const h = await boot({ ...on('api.example.com') });
    const { key } = await h.key();
    for (const host of ['api.example.org', 'forms-api.svc.cluster.local:4000', '10.0.0.12:4000', 'example.com']) {
      const health = await send(h, host, '/health');
      expect(health.status, host).toBe(200);
      expectNotDeprecated(health);
      const keyed = await send(h, host, '/v1/forms', { headers: { authorization: `Bearer ${key}` } });
      expect(keyed.status, host).toBe(200);
      expectNotDeprecated(keyed);
    }
    await settle();
    expect(h.deprecatedHostLog).toEqual([]);
  });
});

describe('/mcp on a listed host', () => {
  it('carries the headers and logs the key id once, a tool call included', async () => {
    const h = await boot({ ...on('api.example.com') });
    const { key } = await h.key();
    const keyId = await keyIdOf(h, key);

    const init = await send(h, 'api.example.com', '/mcp', { method: 'POST', headers: mcpHeaders(key), body: initialize('2025-06-18') });
    expect(init.status).toBe(200);
    expectDeprecated(init, '/mcp');
    await vi.waitFor(() => expect(h.deprecatedHostLog).toHaveLength(1));
    expect(JSON.parse(h.deprecatedHostLog[0]!)).toEqual({
      event: 'deprecated_api_host_call',
      host: 'api.example.com',
      keyId,
      accountId: h.accountId,
      method: 'POST',
      route: '/mcp',
      status: 200,
    });

    // A tool call runs the REST handlers in process, through the key path
    // again; that inner request must not log a line of its own.
    const tool = await send(h, 'api.example.com', '/mcp', {
      method: 'POST',
      headers: { ...mcpHeaders(key), 'mcp-protocol-version': '2025-06-18' },
      body: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_forms', arguments: {} } },
    });
    expect(tool.status).toBe(200);
    expect(tool.body).toContain(h.formId);
    expectDeprecated(tool, '/mcp');
    await vi.waitFor(() => expect(h.deprecatedHostLog).toHaveLength(2));
    await settle();
    expect(h.deprecatedHostLog).toHaveLength(2);
    expect(JSON.parse(h.deprecatedHostLog[1]!)).toMatchObject({ keyId, route: '/mcp', status: 200 });
    for (const line of h.deprecatedHostLog) expect(line).not.toContain(key);
  });

  it('carries the headers on a 401 without a key, and logs nothing', async () => {
    const h = await boot({ ...on('api.example.com') });
    const anon = await send(h, 'api.example.com', '/mcp', { method: 'POST', headers: mcpHeaders(), body: initialize('2025-06-18') });
    expect(anon.status).toBe(401);
    expectDeprecated(anon, '/mcp');
    await settle();
    expect(h.deprecatedHostLog).toEqual([]);
  });
});
