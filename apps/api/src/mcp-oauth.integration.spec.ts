/**
 * MCP connections over OAuth, end to end over HTTP: the whole API on SQLite,
 * the official MCP client discovering the login from a 401 and signing in
 * against a stand-in identity provider (a key pair generated here, served as
 * the issuer's JWKS), and a table as the person directory.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from '@quill/db';
import { CATALOG } from '@quill/mcp';
import { bootHarness, errorText, initialize, structured, type Harness } from './mcp-harness';
import { startFakeIdentityProvider, type FakeIdentityProvider } from './fake-identity-provider';

let idp: FakeIdentityProvider;
const open: Harness[] = [];
beforeAll(async () => {
  idp = await startFakeIdentityProvider();
});
afterAll(async () => {
  await Promise.all(open.map((h) => h.close()));
  await idp.close();
});

async function boot(env: Parameters<typeof bootHarness>[0] = {}) {
  const h = await bootHarness(env, { oauth: { issuer: idp.issuer } });
  open.push(h);
  return h;
}

const LEAD = {
  version: 1,
  steps: [
    { key: 'name', type: 'name', question: 'What is your name?', required: true },
    { key: 'email', type: 'email', question: 'What is your work email?', required: true },
  ],
};

/**
 * A person with an active member in `accountId` (the seeded workspace unless
 * given), known to the directory under a fresh subject. Returns the subject,
 * the person and the member.
 */
async function person(h: Harness, role: 'owner' | 'admin' | 'member' = 'admin', accountId = h.accountId) {
  const subject = `user_${randomUUID().slice(0, 8)}`;
  const personId = randomUUID();
  const memberId = randomUUID();
  const email = `${subject}@example.com`;
  await h.db.run(
    sql`INSERT INTO member (id, account_id, handle, display_name, email, role, status, external_id, created_at)
        VALUES (${memberId}, ${accountId}, ${`p-${memberId.slice(0, 8)}`}, ${'Spec Person'}, ${email}, ${role}, ${'active'},
          ${personId}, ${Date.now()})`,
  );
  h.people.set(subject, { id: personId, email });
  return { subject, personId, memberId, email };
}

const metadataPath = '/.well-known/oauth-protected-resource/mcp';

describe('signing in', () => {
  it('discovers the login from a 401, signs in, sees the same tools as an API key, and runs them as a person with one workspace', async () => {
    const h = await boot();
    const p = await person(h, 'admin');

    const anonymous = await h.post(initialize('2025-06-18'));
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${h.base}${metadataPath}"`);
    const metadata = await fetch(`${h.base}${metadataPath}`);
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toMatchObject({ resource: `${h.base}/mcp`, authorization_servers: [idp.issuer] });

    const c = await h.signIn(idp.client(p.subject));
    const tools = (await c.listTools()).tools.map((t) => t.name);
    expect(tools).toEqual(CATALOG.map((t) => t.name));
    const byKey = await h.connect((await h.key()).key);
    expect((await byKey.listTools()).tools.map((t) => t.name)).toEqual(tools);
    expect(structured<{ workspaces: Array<{ id: string }> }>(await c.callTool({ name: 'list_my_workspaces', arguments: {} })).workspaces).toEqual([
      { id: h.accountId, name: 'Acme Inc.', account_name: null, role: 'admin', access: 'member' },
    ]);

    const who = structured<{ workspace: { id: string }; member: { id: string; role: string }; key: unknown }>(
      await c.callTool({ name: 'whoami', arguments: {} }),
    );
    expect(who).toMatchObject({ workspace: { id: h.accountId }, member: { id: p.memberId, role: 'admin' }, key: null });
    structured(await c.callTool({ name: 'get_form_guide', arguments: {} }));
    const created = structured<{ form: { id: string; updated_at: number } }>(
      await c.callTool({ name: 'create_form', arguments: { name: 'Signed in', config: LEAD } }),
    );
    const row = await h.db.get<{ created_via: string; account_id: string }>(sql`SELECT created_via, account_id FROM form WHERE id = ${created.form.id}`);
    expect(row).toEqual({ created_via: 'mcp', account_id: h.accountId });
    const listed = structured<{ forms: Array<{ id: string }> }>(await c.callTool({ name: 'list_forms', arguments: {} }));
    expect(listed.forms.map((f) => f.id)).toContain(created.form.id);
    const read = structured<{ config: { steps: unknown[] }; updated_at: number }>(
      await c.callTool({ name: 'get_form', arguments: { form_id: created.form.id } }),
    );
    const draft = structured<{ form: { updated_at: number } }>(
      await c.callTool({
        name: 'update_form',
        arguments: {
          form_id: created.form.id,
          config: { ...read.config, steps: [...read.config.steps, { key: 'msg', type: 'textarea', question: 'Anything else?' }] },
          expected_updated_at: read.updated_at,
        },
      }),
    );
    structured(await c.callTool({ name: 'publish_form', arguments: { form_id: created.form.id, expected_updated_at: draft.form.updated_at } }));
    structured(await c.callTool({ name: 'revert_form', arguments: { form_id: created.form.id } }));
    structured(await c.callTool({ name: 'discard_draft', arguments: { form_id: created.form.id } }));
    structured(await c.callTool({ name: 'list_responses', arguments: { form_id: created.form.id } }));
    structured(await c.callTool({ name: 'get_form_analytics', arguments: { form_id: created.form.id } }));
    structured(await c.callTool({ name: 'get_response_facets', arguments: { form_id: created.form.id } }));
    structured(await c.callTool({ name: 'list_folders', arguments: {} }));

    // Never another workspace's form.
    const other = (await c.callTool({ name: 'get_form', arguments: { form_id: h.other.formId } })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(other.isError).toBe(true);
    expect(other.content[0]!.text).toContain('NOT_FOUND');
  });

  it.each([
    ['another issuer', { iss: 'https://evil.example.test' }],
    ['another audience', { aud: 'https://mcp.other.example.test/mcp' }],
    ['an expired token', { exp: Math.floor(Date.now() / 1000) - 600 }],
    ['no exp', { exp: undefined }],
  ])('answers 401 that points at the login again for %s', async (_name, over) => {
    const h = await boot();
    const p = await person(h);
    const res = await h.post(initialize('2025-06-18'), { authorization: `Bearer ${idp.token(p.subject, `${h.base}/mcp`, over)}` });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(`Bearer error="invalid_token", resource_metadata="${h.base}${metadataPath}"`);
  });

  it('answers 401 to a token signed by a key the issuer never published', async () => {
    const h = await boot();
    const p = await person(h);
    const forged = idp.forge({ iss: idp.issuer, aud: `${h.base}/mcp`, sub: p.subject, exp: Math.floor(Date.now() / 1000) + 600 });
    expect((await h.post(initialize('2025-06-18'), { authorization: `Bearer ${forged}` })).status).toBe(401);
  });

  it('refuses with a message to act on, never a login loop, when the directory does not know the person', async () => {
    const h = await boot();
    const unknown = await h.post(initialize('2025-06-18'), { authorization: `Bearer ${idp.token('user_unknown', `${h.base}/mcp`)}` });
    expect(unknown.status).toBe(403);
    expect(((await unknown.json()) as { error: { message: string } }).error.message).toMatch(/open dForms once/i);
    expect(unknown.headers.get('www-authenticate')).toBeNull();
  });
});

describe('discovery for clients that look at the root', () => {
  it('serves the protected-resource metadata at the root too, and forwards the authorization server metadata', async () => {
    const h = await boot();
    const scoped = (await (await fetch(`${h.base}${metadataPath}`)).json()) as Record<string, unknown>;
    const root = await fetch(`${h.base}/.well-known/oauth-protected-resource`);
    expect(root.status).toBe(200);
    expect(await root.json()).toEqual(scoped);

    const as = await fetch(`${h.base}/.well-known/oauth-authorization-server`);
    expect(as.status).toBe(200);
    const upstream = (await (await fetch(`${idp.issuer}/.well-known/oauth-authorization-server`)).json()) as Record<string, unknown>;
    expect(await as.json()).toEqual(upstream);
  });

  it('answers 503 for the authorization server metadata while the identity provider cannot be reached', async () => {
    const down = await bootHarness({}, { oauth: { issuer: 'http://127.0.0.1:9' } });
    open.push(down);
    const res = await fetch(`${down.base}/.well-known/oauth-authorization-server`);
    expect(res.status).toBe(503);
  });

  it('is not found with the MCP endpoint switched off', async () => {
    const h = await boot({ MCP_ENABLED: 'false' });
    for (const path of [metadataPath, '/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server']) {
      expect((await fetch(`${h.base}${path}`)).status, path).toBe(404);
    }
  });
});

describe('shutting down', () => {
  it('closes the person directory, so the identity database pool does not outlive the API', async () => {
    const h = await bootHarness({}, { oauth: { issuer: idp.issuer } });
    expect(h.directoryClosed()).toBe(false);
    await h.close();
    expect(h.directoryClosed()).toBe(true);
  });
});

describe('a flood', () => {
  it('with one valid token asks the person directory once, not per request', async () => {
    const h = await boot();
    const p = await person(h);
    const auth = { authorization: `Bearer ${idp.token(p.subject, `${h.base}/mcp`)}` };
    const codes = await Promise.all(Array.from({ length: 10 }, () => h.post(initialize('2025-06-18'), auth).then((r) => r.status)));
    for (let i = 0; i < 10; i += 1) codes.push((await h.post(initialize('2025-06-18'), auth)).status);
    expect(codes.every((c) => c === 200)).toBe(true);
    expect(h.directoryLookups()).toBe(1);
  });

  it('with a token for nobody asks the directory once too, and keeps refusing', async () => {
    const h = await boot();
    const auth = { authorization: `Bearer ${idp.token('user_nobody', `${h.base}/mcp`)}` };
    for (let i = 0; i < 5; i += 1) expect((await h.post(initialize('2025-06-18'), auth)).status).toBe(403);
    expect(h.directoryLookups()).toBe(1);
  });
});

describe('an identity provider that cannot be reached', () => {
  it("answers a sign-in 503 with a retry while its keys cannot be read, never a login loop", async () => {
    const down = await bootHarness({}, { oauth: { issuer: 'http://127.0.0.1:9' } });
    open.push(down);
    const res = await down.post(initialize('2025-06-18'), { authorization: `Bearer ${idp.token('user_x', `${down.base}/mcp`)}` });
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('30');
    expect(res.headers.get('www-authenticate')).toBeNull();
    expect(down.directoryLookups()).toBe(0);
  });
});

describe('next to API keys', () => {
  it('keeps the key working at the same URL, and a revoked key never points at the login', async () => {
    const h = await boot();
    const { key } = await h.key();
    const c = await h.connect(key);
    const who = structured<{ key: { prefix: string } }>(await c.callTool({ name: 'whoami', arguments: {} }));
    expect(who.key.prefix).toBe(key.slice(0, 12));
    await h.db.run(sql`UPDATE api_key SET revoked_at_ms = ${Date.now()}`);
    const dead = await h.post(initialize('2025-06-18'), { authorization: `Bearer ${key}` });
    expect(dead.status).toBe(401);
    expect(dead.headers.get('www-authenticate')).toBe('Bearer realm="dforms", error="invalid_token"');
  });
});

describe('a signed-in member, mid-session', () => {
  it('reads the role live, and loses access on the next call once deactivated', async () => {
    const h = await boot();
    const p = await person(h, 'member');
    const c = await h.signIn(idp.client(p.subject));
    expect(structured<{ member: { role: string } }>(await c.callTool({ name: 'whoami', arguments: {} })).member.role).toBe('member');
    await h.db.run(sql`UPDATE member SET role = 'owner' WHERE id = ${p.memberId}`);
    expect(structured<{ member: { role: string } }>(await c.callTool({ name: 'whoami', arguments: {} })).member.role).toBe('owner');
    await h.db.run(sql`UPDATE member SET status = 'disabled' WHERE id = ${p.memberId}`);
    expect(errorText(await c.callTool({ name: 'list_forms', arguments: {} }))).toMatch(/^NO_WORKSPACE/);
  });
});

describe('limits and audit', () => {
  it('counts two tokens of the same person against one member bucket, apart from other members', async () => {
    const h = await boot({ MCP_RATE_LIMIT_CAPACITY: '3', MCP_RATE_LIMIT_REFILL_PER_SEC: '0.001' });
    const p = await person(h);
    const q = await person(h);
    const bearer = (subject: string) => ({ authorization: `Bearer ${idp.token(subject, `${h.base}/mcp`, { jti: randomUUID() })}` });
    const first = bearer(p.subject);
    const second = bearer(p.subject);
    const codes = [];
    for (const auth of [first, second, first, second]) codes.push((await h.post(initialize('2025-06-18'), auth)).status);
    expect(codes).toEqual([200, 200, 200, 429]);
    expect((await h.post(initialize('2025-06-18'), bearer(q.subject))).status).toBe(200);
  });

  it('writes member, person and workspace to the audit line, never the token', async () => {
    const h = await boot();
    const p = await person(h);
    const token = idp.token(p.subject, `${h.base}/mcp`);
    const c = await h.connect(token);
    await c.callTool({ name: 'list_forms', arguments: {} });
    const line = JSON.parse(h.audit.at(-1)!) as Record<string, unknown>;
    expect(line).toMatchObject({ tool: 'list_forms', memberId: p.memberId, personId: p.personId, accountId: h.accountId, caller: `oauth:${p.personId}` });
    for (const l of h.audit) expect(l).not.toContain(token.split('.')[2]!);
  });
});

describe('with the adapter off', () => {
  it('behaves as before: no metadata, a key-only challenge, and any other bearer is a bad key', async () => {
    const h = await bootHarness();
    open.push(h);
    for (const path of [metadataPath, '/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server']) {
      expect((await fetch(`${h.base}${path}`)).status, path).toBe(404);
    }
    const anonymous = await h.post(initialize('2025-06-18'));
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('www-authenticate')).toBe('Bearer realm="dforms"');
    const jwt = await h.post(initialize('2025-06-18'), { authorization: `Bearer ${idp.token('user_x', `${h.base}/mcp`)}` });
    expect(jwt.status).toBe(401);
    expect(jwt.headers.get('www-authenticate')).toBe('Bearer realm="dforms", error="invalid_token"');
  });

  it('refuses to boot when it is on with a value missing', async () => {
    await expect(bootHarness({ MCP_OAUTH_PROVIDER: 'workos', WORKOS_AUTHKIT_DOMAIN: idp.issuer })).rejects.toThrow(/MCP_PUBLIC_URL is required/);
  });
});
