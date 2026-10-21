import { afterAll, describe, expect, it } from 'vitest';
import { bootHarness, capped, errorText, initialize, structured, type Harness, type HarnessOptions } from './__tests__/harness';
import { hostnameOf, mcpCorsPolicy, normalizeOrigin } from './door';

const open: Harness[] = [];
async function boot(opts: HarnessOptions = {}) {
  const h = await bootHarness(opts);
  open.push(h);
  return h;
}
afterAll(async () => {
  await Promise.all(open.map((h) => h.close()));
});

describe('transport guards', () => {
  it('refuses a browser Origin that is not allowlisted, allows listed ones and clients without one', async () => {
    const h = await boot({ door: { allowedOrigins: ['https://inspector.example.test/'] } });
    const key = h.key();
    const auth = { authorization: `Bearer ${key}` };
    expect((await h.post(initialize('2025-06-18'), { ...auth, origin: 'https://evil.test' })).status).toBe(403);
    expect((await h.post(initialize('2025-06-18'), { ...auth, origin: 'null' })).status).toBe(403);
    expect((await h.post(initialize('2025-06-18'), { ...auth, origin: 'https://inspector.example.test' })).status).toBe(200);
    expect((await h.post(initialize('2025-06-18'), auth)).status).toBe(200);
  });

  it('compares the Origin header normalized, and refuses a long run of slashes without slowing down', async () => {
    const h = await boot({ door: { allowedOrigins: ['https://inspector.example.test'] } });
    const auth = { authorization: `Bearer ${h.key()}` };
    expect((await h.post(initialize('2025-06-18'), { ...auth, origin: 'https://Inspector.Example.test//' })).status).toBe(200);
    const hostile = `https://inspector.example.test${'/'.repeat(8_000)}x`;
    expect((await h.post(initialize('2025-06-18'), { ...auth, origin: hostile })).status).toBe(403);
  });

  it('with nothing configured every browser origin is refused, before any credential is read', async () => {
    const h = await boot();
    const res = await h.post(initialize('2025-06-18'), { origin: 'http://localhost:3000' });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain('Origin');
  });

  it('checks Host only when allowed hosts are configured', async () => {
    const strict = await boot({ door: { allowedHosts: ['forms-api.example.test'] } });
    const res = await strict.post(initialize('2025-06-18'), { authorization: `Bearer ${strict.key()}` });
    // fetch sends Host: 127.0.0.1:<port>, which is not on the list.
    expect(res.status).toBe(403);
    const loose = await boot();
    expect((await loose.post(initialize('2025-06-18'), { authorization: `Bearer ${loose.key()}` })).status).toBe(200);
    expect(hostnameOf('Forms-API.example.test:4000')).toBe('forms-api.example.test');
    expect(hostnameOf('[::1]:4000')).toBe('[::1]');
  });

  it('refuses credentials in the URL, whatever their name', async () => {
    const h = await boot();
    for (const p of ['api_key', 'access_token', 'key', 'token', 'apikey']) {
      const res = await h.post(initialize('2025-06-18'), { authorization: `Bearer ${h.key()}` }, `/mcp?${p}=dforms_abc`);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { message: string } }).error.message).toContain('Authorization header');
    }
  });

  it('answers 405 to GET and DELETE and 415 to a body that is not JSON', async () => {
    const h = await boot();
    for (const method of ['GET', 'DELETE']) {
      const res = await fetch(h.url, { method });
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('POST');
    }
    const text = await fetch(h.url, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'hi' });
    expect(text.status).toBe(415);
  });

  it('is a plain 404 when disabled', async () => {
    const h = await boot({ door: { enabled: false } });
    expect((await h.post(initialize('2025-06-18'), { authorization: `Bearer ${h.key()}` })).status).toBe(404);
  });

  it('tags every answer with the request id', async () => {
    const h = await boot();
    const res = await h.post(initialize('2025-06-18'));
    expect(res.headers.get('x-request-id')).toMatch(/^req-\d+$/);
  });
});

describe('browser policy', () => {
  it('matches the door: the same normalized allowlist, POST only, no credentials, off when empty', () => {
    expect(mcpCorsPolicy([])).toMatchObject({ origin: false, credentials: false });
    const policy = mcpCorsPolicy(['https://Inspector.Example.test/', ' ']);
    expect(policy.origin).toEqual(['https://inspector.example.test']);
    expect(policy.methods).toEqual(['POST']);
    expect(policy.credentials).toBe(false);
    expect(policy.exposedHeaders).toEqual(expect.arrayContaining(['WWW-Authenticate', 'Retry-After']));
  });
});

describe('normalizeOrigin', () => {
  it('trims whitespace, folds case and drops every trailing slash', () => {
    expect(normalizeOrigin('  https://Inspector.Example.test///  ')).toBe('https://inspector.example.test');
    expect(normalizeOrigin('https://inspector.example.test')).toBe('https://inspector.example.test');
    expect(normalizeOrigin('HTTP://LOCALHOST:3000/')).toBe('http://localhost:3000');
    expect(normalizeOrigin('null')).toBe('null');
    expect(normalizeOrigin(' / ')).toBe('');
    expect(normalizeOrigin('')).toBe('');
  });

  it('stays linear on a long run of slashes that is not at the end', () => {
    const input = `${'/'.repeat(100_000)}x`;
    const started = performance.now();
    expect(normalizeOrigin(input)).toBe(input);
    expect(normalizeOrigin(`https://a.test${'/'.repeat(100_000)}`)).toBe('https://a.test');
    expect(performance.now() - started).toBeLessThan(100);
  });
});

describe('credentials', () => {
  it('refuses an anonymous request with a 401 challenge: there is no anonymous door', async () => {
    const h = await boot();
    const res = await h.post(initialize('2025-06-18'));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer realm="dforms"');
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain('Authorization: Bearer');
  });

  it('answers 401 invalid_token for an unknown, malformed or non-bearer credential, never downgrading', async () => {
    const h = await boot();
    for (const authorization of ['Bearer dforms_unknown', 'Bearer', 'Basic abc', 'Bearer a b']) {
      const res = await h.post(initialize('2025-06-18'), { authorization });
      expect(res.status, authorization).toBe(401);
      expect(res.headers.get('www-authenticate')).toContain('invalid_token');
    }
  });

  it('only reads the Authorization header: a key in x-api-key is anonymous, so refused', async () => {
    const h = await boot();
    const res = await h.post(initialize('2025-06-18'), { 'x-api-key': h.key() });
    expect(res.status).toBe(401);
  });

  it('tells the host who a request authenticated as, once, and only when it did', async () => {
    const seen: Array<{ url: string | undefined; credentialId: string; accountId: string }> = [];
    const h = await boot({
      door: { onAuthenticated: (req, caller) => seen.push({ url: req.url, credentialId: caller.credentialId, accountId: caller.accountId }) },
    });
    expect((await h.post(initialize('2025-06-18'))).status).toBe(401);
    expect((await h.post(initialize('2025-06-18'), { authorization: 'Bearer dforms_unknown' })).status).toBe(401);
    expect(seen).toEqual([]);
    expect((await h.post(initialize('2025-06-18'), { authorization: `Bearer ${h.key()}` })).status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ url: '/mcp' });
    expect(seen[0]!.credentialId).toEqual(expect.any(String));
  });

  it('builds the challenge through the OAuth seam when one is given', async () => {
    const h = await boot({ door: { challenge: () => 'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource"' } });
    const res = await h.post(initialize('2025-06-18'));
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata=');
  });
});

describe('protocol eras', () => {
  it('serves a legacy initialize handshake (2025-06-18 and 2025-11-25) statelessly', async () => {
    const h = await boot();
    const auth = { authorization: `Bearer ${h.key()}` };
    for (const version of ['2025-06-18', '2025-11-25']) {
      const res = await h.post(initialize(version), auth);
      expect(res.status).toBe(200);
      expect(res.headers.get('mcp-session-id')).toBeNull();
      const text = await res.text();
      expect(text).toContain('"dforms"');
      expect(text).toContain('"tools"');
    }
    const list = await h.post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, { ...auth, 'mcp-protocol-version': '2025-06-18' });
    expect(list.status).toBe(200);
    expect(await list.text()).toContain('create_form');
  });

  it('serves a 2026-07-28 request that carries the per-request envelope', async () => {
    const h = await boot();
    const res = await h.post(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/list',
        params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} } },
      },
      { authorization: `Bearer ${h.key()}`, 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/list' },
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('get_form_analytics');
    expect(text).toContain('resultType');
  });

  it('records the protocol version the client spoke in the audit line', async () => {
    const h = await boot();
    const c = await h.connect(h.key());
    await c.callTool({ name: 'whoami', arguments: {} });
    const line = JSON.parse(h.audit[0]!) as { protocolVersion: string };
    expect(line.protocolVersion).toMatch(/^20\d\d-\d\d-\d\d$/);
  });
});

describe('rate limits', () => {
  it('answers 429 with Retry-After once a key spends its bucket, per key not per process', async () => {
    const h = await boot({ door: { keyLimiter: capped(2) } });
    const a = h.key();
    const b = h.key();
    const auth = (k: string) => ({ authorization: `Bearer ${k}` });
    expect((await h.post(initialize('2025-06-18'), auth(a))).status).toBe(200);
    expect((await h.post(initialize('2025-06-18'), auth(a))).status).toBe(200);
    const third = await h.post(initialize('2025-06-18'), auth(a));
    expect(third.status).toBe(429);
    expect(third.headers.get('retry-after')).toBe('3');
    expect((await h.post(initialize('2025-06-18'), auth(b))).status).toBe(200);
  });

  it('counts anonymous requests and bad keys against the client address, so guessing is throttled', async () => {
    const h = await boot({ door: { ipLimiter: capped(3) } });
    const codes: number[] = [];
    for (let i = 0; i < 2; i += 1) codes.push((await h.post(initialize('2025-06-18'))).status);
    for (let i = 0; i < 2; i += 1) codes.push((await h.post(initialize('2025-06-18'), { authorization: 'Bearer dforms_guess' })).status);
    expect(codes).toEqual([401, 401, 401, 429]);
    // A valid key is not charged to the address.
    expect((await h.post(initialize('2025-06-18'), { authorization: `Bearer ${h.key()}` })).status).toBe(200);
  });

  it('gives write tools their own, tighter bucket, reported as a tool error with a delay', async () => {
    const h = await boot({ writeLimiter: capped(1) });
    const c = await h.connect(h.key());
    structured(await c.callTool({ name: 'create_form', arguments: { name: 'One', config: { version: 1, steps: [] } } }));
    const text = errorText(await c.callTool({ name: 'create_form', arguments: { name: 'Two', config: { version: 1, steps: [] } } }));
    expect(text).toContain('RATE_LIMITED');
    expect(text).toMatch(/Retry after \d+s/);
    // Reads are not charged to the write bucket.
    structured(await c.callTool({ name: 'list_forms', arguments: {} }));
  });
});

describe('timeout and failures', () => {
  it('abandons a slow call with advice to read before retrying', async () => {
    const h = await boot({ toolTimeoutMs: 200, backend: { createForm: () => new Promise(() => undefined) } });
    const c = await h.connect(h.key());
    const text = errorText(await c.callTool({ name: 'create_form', arguments: { name: 'Slow', config: { version: 1, steps: [] } } }));
    expect(text).toContain('TIMEOUT');
    expect(text).toContain('list_forms');
  });

  it('never shows an unexpected failure to the model', async () => {
    const h = await boot({ backend: { listForms: () => Promise.reject(new Error('db password is hunter2')) } });
    const c = await h.connect(h.key());
    const text = errorText(await c.callTool({ name: 'list_forms', arguments: {} }));
    expect(text).toContain('INTERNAL_ERROR');
    expect(text).not.toContain('hunter2');
  });
});

describe('audit', () => {
  it('writes one line per tool call with the key prefix, never the key, the config or the arguments', async () => {
    const h = await boot();
    const key = h.key('member');
    const c = await h.connect(key);
    await c.callTool({ name: 'whoami', arguments: {} });
    await c.callTool({
      name: 'create_form',
      arguments: { name: 'Secret launch plan', config: { version: 1, steps: [{ key: 'q', type: 'text', question: 'Top secret question?' }] } },
    });
    await c.callTool({ name: 'get_form', arguments: { form_id: 'missing' } });
    expect(h.audit).toHaveLength(3);
    const lines = h.audit.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines.map((l) => l.tool)).toEqual(['whoami', 'create_form', 'get_form']);
    expect(lines[0]).toMatchObject({ msg: 'mcp.tool_call', caller: key.slice(0, 12), accountId: 'acct-1', result: 'ok' });
    expect(lines[1]).toMatchObject({ affected: ['form-new'], result: 'ok' });
    expect(lines[2]).toMatchObject({ result: 'error', error: 'NOT_FOUND' });
    for (const line of h.audit) {
      expect(line).not.toContain(key);
      expect(line).not.toContain('Secret launch plan');
      expect(line).not.toContain('Top secret');
    }
    expect(lines[1]!.argsHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('hands the tools the caller resolved at the door, never a token from the request', async () => {
    const h = await boot();
    const key = h.key('admin');
    const c = await h.connect(key);
    await c.callTool({ name: 'whoami', arguments: {} });
    expect(h.calls[0]).toMatchObject({ method: 'whoami', caller: { accountId: 'acct-1', role: 'admin', label: key.slice(0, 12) } });
  });
});
