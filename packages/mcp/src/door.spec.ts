import { afterAll, describe, expect, it } from 'vitest';
import { bootHarness, capped, errorText, initialize, structured, type Harness, type HarnessOptions } from './__tests__/harness';
import type { McpCaller, McpConnection, McpStaffAccess } from './backend';
import { DoorRefusal, DoorThrottled, DoorUnavailable, hostnameOf, mcpCorsPolicy, normalizeOrigin, type McpDoorOAuth } from './door';

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

  it('refuses credentials in the URL whatever their case, bearer and access_key included', async () => {
    const h = await boot();
    for (const p of ['API_KEY', 'Token', 'bearer', 'Bearer', 'access_key', 'ACCESS_TOKEN', 'Authorization']) {
      const res = await h.post(initialize('2025-06-18'), { authorization: `Bearer ${h.key()}` }, `/mcp?${p}=dforms_abc`);
      expect(res.status, p).toBe(400);
    }
    // A query that carries no credential still passes.
    expect((await h.post(initialize('2025-06-18'), { authorization: `Bearer ${h.key()}` }, '/mcp?tokens_used=1')).status).toBe(200);
  });

  it('refuses a JSON-RPC batch at the door, so one request cannot run a hundred tool calls', async () => {
    const h = await boot();
    const auth = { authorization: `Bearer ${h.key()}`, 'mcp-protocol-version': '2025-06-18' };
    const batch = Array.from({ length: 100 }, (_, i) => ({
      jsonrpc: '2.0',
      id: i + 1,
      method: 'tools/call',
      params: { name: 'get_form_guide', arguments: {} },
    }));
    const res = await h.post(batch, auth);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: number; message: string } }).error).toMatchObject({ code: -32600 });
    expect(h.audit).toHaveLength(0);
    // Even a batch of one is refused: a single message is sent as an object.
    expect((await h.post([initialize('2025-06-18')], auth)).status).toBe(400);
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

});

const METADATA = 'https://mcp.example.test/.well-known/oauth-protected-resource/mcp';

/** One workspace of a connection, as a host's OAuth side resolves it: the person acting as one member. */
function workspaceCaller(over: Partial<McpCaller> = {}): McpCaller {
  return {
    accountId: 'acct-1',
    workspaceName: 'Acme',
    memberId: 'member-owner',
    role: 'owner',
    credentialId: 'member:member-owner',
    label: 'oauth:person-1',
    personId: 'person-1',
    context: {},
    ...over,
  };
}

/** A connection: person-1 with these workspaces (one, in Acme, by default). */
function connection(workspaces: McpCaller[] = [workspaceCaller()]): McpConnection {
  return { personId: 'person-1', email: 'ada@example.test', label: 'oauth:person-1', workspaces };
}

/** The door's OAuth side over a fixed table of access tokens, recording what it was asked. */
function oauthSide(tokens: Record<string, McpConnection | DoorRefusal | DoorUnavailable | DoorThrottled> = {}) {
  const asked: string[] = [];
  const oauth: McpDoorOAuth = {
    isApiKey: (t) => t.startsWith('dforms_'),
    resourceMetadataUrl: METADATA,
    async authenticate(t) {
      asked.push(t);
      const found = tokens[t];
      if (found instanceof DoorRefusal || found instanceof DoorUnavailable || found instanceof DoorThrottled) throw found;
      return found ?? null;
    },
  };
  return { oauth, asked };
}

describe('MCP connections (the OAuth side of the door)', () => {
  it('points a request without a credential at the protected-resource metadata', async () => {
    const h = await boot({ door: { oauth: oauthSide().oauth } });
    const res = await h.post(initialize('2025-06-18'));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${METADATA}"`);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/sign in/i);
  });

  it('sends an API key down the key path only, and a dead key never invites a login', async () => {
    const { oauth, asked } = oauthSide();
    const h = await boot({ door: { oauth } });
    expect((await h.post(initialize('2025-06-18'), { authorization: `Bearer ${h.key()}` })).status).toBe(200);
    const dead = await h.post(initialize('2025-06-18'), { authorization: 'Bearer dforms_revoked' });
    expect(dead.status).toBe(401);
    expect(dead.headers.get('www-authenticate')).toContain('invalid_token');
    expect(dead.headers.get('www-authenticate')).not.toContain('resource_metadata');
    expect(((await dead.json()) as { error: { message: string } }).error.message).toContain('API key');
    expect(asked).toEqual([]);
  });

  it('sends any other bearer to the OAuth side, and runs the tools as the caller it resolves', async () => {
    const { oauth, asked } = oauthSide({ 'access-token-1': connection() });
    const h = await boot({ door: { oauth } });
    const c = await h.connect('access-token-1');
    const who = structured<{ key: unknown; member: { role: string } }>(await c.callTool({ name: 'whoami', arguments: {} }));
    expect(who.key).toBeNull();
    expect(h.calls[0]).toMatchObject({ method: 'whoami', caller: { personId: 'person-1', memberId: 'member-owner' } });
    expect(asked.every((t) => t === 'access-token-1')).toBe(true);
  });

  it('answers a token it cannot verify with 401 invalid_token that points at the login again', async () => {
    const h = await boot({ door: { oauth: oauthSide().oauth } });
    const res = await h.post(initialize('2025-06-18'), { authorization: 'Bearer eyJ.not.verified' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(`Bearer error="invalid_token", resource_metadata="${METADATA}"`);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/sign in again/i);
  });

  it('answers a refusal with 403 and its message, charged to the client address', async () => {
    const refusal = new DoorRefusal('Open dForms once to create your workspace, then connect again.');
    const h = await boot({ door: { oauth: oauthSide({ 'no-workspace': refusal }).oauth, ipLimiter: capped(1) } });
    const res = await h.post(initialize('2025-06-18'), { authorization: 'Bearer no-workspace' });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe(refusal.message);
    expect((await h.post(initialize('2025-06-18'), { authorization: 'Bearer no-workspace' })).status).toBe(429);
  });

  it('answers a sign-in that cannot be checked right now with 503 and a retry, never a login loop', async () => {
    const outage = new DoorUnavailable('dForms cannot check this sign-in right now. Try again in a minute.');
    const h = await boot({ door: { oauth: oauthSide({ 'directory-down': outage }).oauth, ipLimiter: capped(1) } });
    const res = await h.post(initialize('2025-06-18'), { authorization: 'Bearer directory-down' });
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('30');
    expect(res.headers.get('www-authenticate')).toBeNull();
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe(outage.message);
    expect((await h.post(initialize('2025-06-18'), { authorization: 'Bearer directory-down' })).status).toBe(429);
  });

  it('answers a sign-in looked up too often with 429 and a delay, never a login loop', async () => {
    const h = await boot({ door: { oauth: oauthSide({ flood: new DoorThrottled(2_500) }).oauth } });
    const res = await h.post(initialize('2025-06-18'), { authorization: 'Bearer flood' });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('3');
    expect(res.headers.get('www-authenticate')).toBeNull();
  });

  it('answers any credential that is not a plain bearer with the OAuth challenge, so the client can sign in', async () => {
    const { oauth, asked } = oauthSide();
    const h = await boot({ door: { oauth } });
    for (const authorization of ['Bearer', 'Basic abc', 'Bearer a b', 'Token xyz']) {
      const res = await h.post(initialize('2025-06-18'), { authorization });
      expect(res.status, authorization).toBe(401);
      expect(res.headers.get('www-authenticate'), authorization).toBe(`Bearer error="invalid_token", resource_metadata="${METADATA}"`);
    }
    expect(asked).toEqual([]);
  });

  it('writes the person and the member to the audit line, never the token', async () => {
    const h = await boot({ door: { oauth: oauthSide({ 'access-token-1': connection() }).oauth } });
    const c = await h.connect('access-token-1');
    await c.callTool({ name: 'list_forms', arguments: {} });
    const line = JSON.parse(h.audit[0]!) as Record<string, unknown>;
    expect(line).toMatchObject({ caller: 'oauth:person-1', personId: 'person-1', memberId: 'member-owner', accountId: 'acct-1' });
    expect(h.audit[0]).not.toContain('access-token-1');
  });

  it('without an OAuth side, every bearer is a key and nothing points at a login', async () => {
    const h = await boot();
    const res = await h.post(initialize('2025-06-18'), { authorization: 'Bearer eyJ.not.a.key' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer realm="dforms", error="invalid_token"');
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

  it('reports an unexpected failure to the host by class and code only, never its message or stack', async () => {
    const reports: unknown[][] = [];
    const leaky = Object.assign(new TypeError('row for ada@example.test: config {"secret":"hunter2"}'), { code: 'SQLITE_BUSY' });
    const h = await boot({
      backend: { listForms: () => Promise.reject(leaky), getForm: () => Promise.reject('a bare string with hunter2') },
      onInternalError: (...args: unknown[]) => reports.push(args),
    });
    const c = await h.connect(h.key());
    errorText(await c.callTool({ name: 'list_forms', arguments: {} }));
    errorText(await c.callTool({ name: 'get_form', arguments: { form_id: 'form-1' } }));
    expect(reports).toEqual([
      ['list_forms', expect.stringMatching(/^req-\d+$/), { errorClass: 'TypeError', code: 'SQLITE_BUSY' }],
      ['get_form', expect.stringMatching(/^req-\d+$/), { errorClass: 'string' }],
    ]);
    expect(JSON.stringify(reports)).not.toMatch(/hunter2|ada@|at .*\.ts/);
  });

  it('reports a transport problem by class only, never the body that caused it', async () => {
    const reports: unknown[] = [];
    const h = await boot({ onTransportError: (e: unknown) => reports.push(e) });
    const res = await h.post({ note: 'ada@example.test hunter2' }, { authorization: `Bearer ${h.key()}`, 'mcp-protocol-version': '2025-06-18' });
    expect(res.status).toBe(400);
    expect(reports).toEqual([{ errorClass: 'Error' }]);
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

describe('an MCP connection with several workspaces', () => {
  const acme = workspaceCaller();
  const globex = workspaceCaller({ accountId: 'acct-2', workspaceName: 'Globex', memberId: 'member-g', role: 'member', credentialId: 'member:member-g' });
  const toolCall = (name: string, args: Record<string, unknown>) => ({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name, arguments: args },
  });

  it('asks for workspace_id, runs as the member of the workspace named, and says which one', async () => {
    const h = await boot({ door: { oauth: oauthSide({ t: connection([acme, globex]) }).oauth } });
    const c = await h.connect('t');
    const required = errorText(await c.callTool({ name: 'list_forms', arguments: {} }));
    expect(required).toMatch(/^WORKSPACE_REQUIRED: You are a member of 2 dForms workspaces/);
    expect(required).toContain('list_my_workspaces');
    expect(h.calls).toEqual([]);
    const listed = structured<{ workspace: { id: string; name: string } }>(
      await c.callTool({ name: 'list_forms', arguments: { workspace_id: 'acct-2' } }),
    );
    expect(listed.workspace).toEqual({ id: 'acct-2', name: 'Globex', access: 'member' });
    expect(h.calls[0]).toMatchObject({ method: 'listForms', caller: { accountId: 'acct-2', memberId: 'member-g' } });
    expect(errorText(await c.callTool({ name: 'list_forms', arguments: { workspace_id: 'acct-9' } }))).toMatch(/^NOT_FOUND/);
    const mine = structured<{ workspaces: unknown[] }>(await c.callTool({ name: 'list_my_workspaces', arguments: {} }));
    expect(mine.workspaces).toEqual([
      { id: 'acct-1', name: 'Acme', account_name: null, role: 'owner', access: 'member' },
      { id: 'acct-2', name: 'Globex', account_name: null, role: 'member', access: 'member' },
    ]);
  });

  it('filters its own workspaces by search, and a person who is not staff never searches beyond them', async () => {
    const h = await boot({ door: { oauth: oauthSide({ t: connection([acme, globex]) }).oauth } });
    const c = await h.connect('t');
    const found = structured<{ workspaces: Array<{ id: string }>; staff: boolean }>(
      await c.callTool({ name: 'list_my_workspaces', arguments: { search: 'glob' } }),
    );
    expect(found).toMatchObject({ staff: false, workspaces: [{ id: 'acct-2' }] });
    // Short searches are fine for a person: they only filter their own list.
    const short = structured<{ workspaces: Array<{ id: string }> }>(
      await c.callTool({ name: 'list_my_workspaces', arguments: { search: 'x' } }),
    );
    expect(short.workspaces.map((w) => w.id)).toEqual(['acct-2']);
    const none = structured<{ workspaces: unknown[] }>(await c.callTool({ name: 'list_my_workspaces', arguments: { search: 'initech' } }));
    expect(none.workspaces).toEqual([]);
  });

  it('takes the door token from the member of the workspace a call names, and the person for the rest', async () => {
    const h = await boot({ door: { oauth: oauthSide({ t: connection([acme, globex]) }).oauth, keyLimiter: capped(1) } });
    const auth = { authorization: 'Bearer t' };
    expect((await h.post(toolCall('list_forms', { workspace_id: 'acct-1' }), auth)).status).toBe(200);
    expect((await h.post(toolCall('list_forms', { workspace_id: 'acct-1' }), auth)).status).toBe(429);
    expect((await h.post(toolCall('list_forms', { workspace_id: 'acct-2' }), auth)).status).toBe(200);
    expect((await h.post(initialize('2025-06-18'), auth)).status).toBe(200);
    expect((await h.post(toolCall('list_my_workspaces', {}), auth)).status).toBe(429);
  });

  it('takes the write token from the member of the workspace named', async () => {
    const h = await boot({ door: { oauth: oauthSide({ t: connection([acme, globex]) }).oauth }, writeLimiter: capped(1) });
    const c = await h.connect('t');
    const create = (workspace_id: string) =>
      c.callTool({ name: 'create_form', arguments: { name: 'x', config: { version: 1, steps: [] }, workspace_id } });
    structured(await create('acct-1'));
    expect(errorText(await create('acct-1'))).toMatch(/^RATE_LIMITED: Too many writes by this member/);
    structured(await create('acct-2'));
  });

  it('lets a person with no workspace in, and answers NO_WORKSPACE on a tool that needs one', async () => {
    const h = await boot({ door: { oauth: oauthSide({ t: connection([]) }).oauth } });
    const c = await h.connect('t');
    const who = structured<{ workspace: unknown; workspaces: unknown[]; person: { id: string } }>(
      await c.callTool({ name: 'whoami', arguments: {} }),
    );
    expect(who).toMatchObject({ workspace: null, workspaces: [], person: { id: 'person-1' } });
    expect(errorText(await c.callTool({ name: 'get_form', arguments: { form_id: 'form-1' } }))).toMatch(/^NO_WORKSPACE.*open dForms once/);
    expect(h.calls).toEqual([]);
  });
});

describe('an MCP connection of staff', () => {
  const own = workspaceCaller();
  const entered = workspaceCaller({
    accountId: 'acct-7',
    workspaceName: 'Initech',
    memberId: 'grant-7',
    role: 'admin',
    credentialId: 'member:grant-7',
    access: 'staff',
  });
  /** Staff access over a fixed estate, recording what it was asked. */
  function staffConnection(workspaces: McpCaller[] = [own]) {
    const asked: string[] = [];
    const access: McpStaffAccess = {
      async search(query, limit) {
        asked.push(`search:${query}:${limit}`);
        return [
          { id: 'acct-1', name: 'Acme', accountName: 'Acme Holdings', role: 'admin', access: 'staff' },
          { id: 'acct-7', name: 'Initech', accountName: 'Initech Corp', role: 'admin', access: 'staff' },
        ];
      },
      async enter(id) {
        asked.push(`enter:${id}`);
        return id === 'acct-7' ? entered : null;
      },
    };
    return { conn: { ...connection(workspaces), staff: access } satisfies McpConnection, asked };
  }

  it('always asks for workspace_id, even with one workspace of their own, and says to search and confirm', async () => {
    const { conn } = staffConnection();
    const h = await boot({ door: { oauth: oauthSide({ t: conn }).oauth } });
    const c = await h.connect('t');
    const text = errorText(await c.callTool({ name: 'list_forms', arguments: {} }));
    expect(text).toMatch(/^WORKSPACE_REQUIRED: You are staff of this deployment/);
    expect(text).toContain('list_my_workspaces(search=');
    expect(text).toContain('confirm it with the user');
    expect(h.calls).toEqual([]);
    const who = structured<{ staff: boolean; workspace: unknown }>(await c.callTool({ name: 'whoami', arguments: {} }));
    expect(who).toMatchObject({ staff: true, workspace: null });
  });

  it('searches every workspace, keeps its own as a member, caps at 20 and refuses a search under 3 letters or digits', async () => {
    const { conn, asked } = staffConnection();
    const h = await boot({ door: { oauth: oauthSide({ t: conn }).oauth } });
    const c = await h.connect('t');
    const found = structured<{ workspaces: Array<Record<string, unknown>>; staff: boolean; next_step: string }>(
      await c.callTool({ name: 'list_my_workspaces', arguments: { search: 'In-i', limit: 50 } }),
    );
    expect(found.staff).toBe(true);
    expect(found.workspaces).toEqual([
      { id: 'acct-1', name: 'Acme', account_name: null, role: 'owner', access: 'member' },
      { id: 'acct-7', name: 'Initech', account_name: 'Initech Corp', role: 'admin', access: 'staff' },
    ]);
    expect(found.next_step).toMatch(/Confirm it even when only one matched/);
    // One more than it shows, to know whether the list was cut.
    expect(asked).toEqual(['search:In-i:21']);
    for (const search of ['ab', ' a-b ', '..']) {
      expect(errorText(await c.callTool({ name: 'list_my_workspaces', arguments: { search } }))).toMatch(/^SEARCH_TOO_SHORT/);
    }
    expect(asked).toHaveLength(1);
    const mine = structured<{ next_step: string; workspaces: unknown[] }>(await c.callTool({ name: 'list_my_workspaces', arguments: {} }));
    expect(mine.workspaces).toHaveLength(1);
    expect(mine.next_step).toMatch(/only your own workspaces/);
  });

  it('acts in a workspace it is not a member of through staff access, says so, and audits it', async () => {
    const { conn, asked } = staffConnection();
    const h = await boot({ door: { oauth: oauthSide({ t: conn }).oauth } });
    const c = await h.connect('t');
    const res = await c.callTool({ name: 'list_forms', arguments: { workspace_id: 'acct-7' } });
    expect(structured<{ workspace: unknown }>(res).workspace).toEqual({ id: 'acct-7', name: 'Initech', access: 'staff' });
    expect((res as { content: Array<{ text: string }> }).content[0]!.text).toMatch(/^In workspace "Initech" \(staff access\): /);
    expect(h.calls[0]).toMatchObject({ method: 'listForms', caller: { accountId: 'acct-7', memberId: 'grant-7' } });
    expect(JSON.parse(h.audit.at(-1)!)).toMatchObject({ tool: 'list_forms', accountId: 'acct-7', via: 'staff_grant', personId: 'person-1' });
    // Its own workspace is its member's, never a grant, and asks nothing of the staff side.
    structured(await c.callTool({ name: 'list_forms', arguments: { workspace_id: 'acct-1' } }));
    expect(JSON.parse(h.audit.at(-1)!)).not.toHaveProperty('via');
    expect(asked).toEqual(['enter:acct-7']);
    const missing = errorText(await c.callTool({ name: 'list_forms', arguments: { workspace_id: 'acct-404' } }));
    expect(missing).toMatch(/^NOT_FOUND: No live workspace has this id\./);
  });

  it('says staff once in a refusal, and gives whoami a next step and an access with or without a workspace', async () => {
    const { conn } = staffConnection();
    const h = await boot({ door: { oauth: oauthSide({ t: conn }).oauth } });
    const c = await h.connect('t');
    for (const args of [{}, { workspace_id: 'acct-404' }]) {
      const text = errorText(await c.callTool({ name: 'list_forms', arguments: args }));
      expect(text.match(/staff of this deployment/g)).toHaveLength(1);
      expect(text).toContain('list_my_workspaces(search=');
    }
    const none = structured<{ workspace: unknown; next_step: string }>(await c.callTool({ name: 'whoami', arguments: {} }));
    expect(none.workspace).toBeNull();
    expect(none.next_step).toMatch(/list_my_workspaces\(search=/);
    const mine = structured<{ workspace: { access: string }; next_step: string }>(
      await c.callTool({ name: 'whoami', arguments: { workspace_id: 'acct-1' } }),
    );
    expect(mine.workspace.access).toBe('member');
    expect(mine.next_step).toMatch(/Confirm with the user/);
    const theirs = structured<{ workspace: { access: string } }>(await c.callTool({ name: 'whoami', arguments: { workspace_id: 'acct-7' } }));
    expect(theirs.workspace.access).toBe('staff');
  });

  it('lists a workspace once by the id the search gives, says what it matched on, and flags a list cut at 20', async () => {
    const asked: number[] = [];
    const hits = Array.from({ length: 25 }, (_, i) => ({
      id: `iam-${i}`,
      localId: null,
      name: `Bulk ${i}`,
      accountName: null,
      role: 'admin',
      access: 'staff' as const,
      matchedOn: 'name' as const,
    }));
    const access: McpStaffAccess = {
      async search(_query, limit) {
        asked.push(limit);
        return [
          // Its own workspace, found by the identity service's id: listed once, as theirs.
          { id: 'iam-own', localId: 'acct-1', name: 'Acme', accountName: 'Acme Holdings', role: 'admin', access: 'staff', matchedOn: 'member_email' },
          ...hits,
        ].slice(0, limit);
      },
      async enter() {
        return null;
      },
    };
    const h = await boot({ door: { oauth: oauthSide({ t: { ...connection([own]), staff: access } }).oauth } });
    const c = await h.connect('t');
    const found = structured<{ workspaces: Array<Record<string, unknown>>; truncated: boolean; next_step: string }>(
      await c.callTool({ name: 'list_my_workspaces', arguments: { search: 'bulk' } }),
    );
    expect(found.workspaces).toHaveLength(20);
    expect(found.workspaces[0]).toEqual({ id: 'acct-1', name: 'Acme', account_name: null, role: 'owner', access: 'member', matched_on: 'member_email' });
    expect(found.workspaces.filter((w) => w.name === 'Acme')).toHaveLength(1);
    expect(found.workspaces[1]).toMatchObject({ id: 'iam-0', matched_on: 'name', access: 'staff' });
    expect(found.truncated).toBe(true);
    expect(found.next_step).toMatch(/More workspaces matched than the 20 shown/);
    const few = structured<{ workspaces: unknown[]; truncated: boolean; next_step: string }>(
      await c.callTool({ name: 'list_my_workspaces', arguments: { search: 'bulk', limit: 3 } }),
    );
    expect(few).toMatchObject({ truncated: true });
    expect(few.workspaces).toHaveLength(3);
    expect(asked).toEqual([21, 4]);
  });
});

describe('an API key and workspace_id', () => {
  it("refuses another workspace, accepts its own, and audits the key's workspace", async () => {
    const h = await boot();
    const c = await h.connect(h.key());
    expect(errorText(await c.callTool({ name: 'get_form', arguments: { form_id: 'form-1', workspace_id: 'acct-2' } }))).toMatch(
      /^WORKSPACE_MISMATCH/,
    );
    expect(h.calls).toEqual([]);
    const own = structured<{ workspace: { id: string } }>(
      await c.callTool({ name: 'get_form', arguments: { form_id: 'form-1', workspace_id: 'acct-1' } }),
    );
    expect(own.workspace.id).toBe('acct-1');
    structured(await c.callTool({ name: 'get_form_guide', arguments: { part: 'rules' } }));
    expect(JSON.parse(h.audit.at(-1)!)).toMatchObject({ tool: 'get_form_guide', accountId: 'acct-1' });
  });
});
