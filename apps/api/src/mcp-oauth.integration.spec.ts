/**
 * MCP connections over OAuth, end to end over HTTP: the whole API on SQLite,
 * the official MCP client discovering the login from a 401 and signing in
 * against a stand-in identity provider (a key pair generated here, served as
 * the issuer's JWKS). The token's subject maps to members through dForms' own
 * database: the link a verified web login records (`member.idp_subject`,
 * `member.login_seen_at`), honored within the link window, for active owners
 * and admins only. No identity database is read.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from '@quill/db';
import { signJwtHs256 } from './jwt';
import { CATALOG } from '@quill/mcp';
import { bootHarness, initialize, structured, type Harness } from './mcp-harness';
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

const DAY = 86_400_000;

/**
 * A person with an active member in `accountId` (the seeded workspace unless
 * given) under a fresh subject, linked by a verified web login `seenAt` (now
 * unless given; `null` leaves them unlinked). Returns the subject, the person
 * and the member.
 */
async function person(
  h: Harness,
  role: 'owner' | 'admin' | 'member' = 'admin',
  accountId = h.accountId,
  seenAt: number | null = Date.now(),
) {
  const subject = `user_${randomUUID().slice(0, 8)}`;
  const personId = randomUUID();
  const memberId = randomUUID();
  const email = `${subject}@example.com`;
  await h.db.run(
    sql`INSERT INTO member (id, account_id, handle, display_name, email, role, status, external_id, created_at)
        VALUES (${memberId}, ${accountId}, ${`p-${memberId.slice(0, 8)}`}, ${'Spec Person'}, ${email}, ${role}, ${'active'},
          ${personId}, ${Date.now()})`,
  );
  if (seenAt !== null) await h.link(subject, personId, { seenAt });
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

  it('refuses with a message to act on, never a login loop, a subject no web login ever recorded', async () => {
    const h = await boot();
    const unknown = await h.post(initialize('2025-06-18'), { authorization: `Bearer ${idp.token('user_unknown', `${h.base}/mcp`)}` });
    expect(unknown.status).toBe(403);
    expect(((await unknown.json()) as { error: { message: string } }).error.message).toMatch(/not an owner or admin of any dForms workspace opened with this account in the last 30 days: open the workspace in dForms/i);
    expect(unknown.headers.get('www-authenticate')).toBeNull();
    expect(h.oauthLog.map((l) => JSON.parse(l) as unknown)).toEqual([{ msg: 'mcp.oauth_refused', reason: 'not_linked' }]);
    for (const line of h.oauthLog) expect(line).not.toContain('user_unknown');
  });
});

describe('the link a web login records', () => {
  const refused = async (h: Harness, subject: string) => {
    const res = await h.post(initialize('2025-06-18'), { authorization: `Bearer ${idp.token(subject, `${h.base}/mcp`)}` });
    return { status: res.status, message: ((await res.json()) as { error?: { message?: string } }).error?.message ?? '' };
  };

  it('maps a linked person, and refuses a member of the same workspace who never signed in on the web', async () => {
    const h = await boot();
    const linked = await person(h, 'admin');
    const unlinked = await person(h, 'admin', h.accountId, null);
    const c = await h.signIn(idp.client(linked.subject));
    expect(structured<{ member: { id: string } }>(await c.callTool({ name: 'whoami', arguments: {} })).member.id).toBe(linked.memberId);
    expect(await refused(h, unlinked.subject)).toMatchObject({ status: 403, message: expect.stringMatching(/open the workspace in dForms/) });
  });

  it('refuses a link whose last verified web login is older than the window, and honors it again once the person comes back', async () => {
    const h = await boot();
    const stale = await person(h, 'admin', h.accountId, Date.now() - 31 * DAY);
    expect(await refused(h, stale.subject)).toMatchObject({ status: 403 });
    expect(JSON.parse(h.oauthLog.at(-1)!)).toEqual({ msg: 'mcp.oauth_refused', reason: 'not_linked' });
    await h.link(stale.subject, stale.personId);
    expect((await h.post(initialize('2025-06-18'), { authorization: `Bearer ${idp.token(stale.subject, `${h.base}/mcp`)}` })).status).toBe(200);
  });

  it('takes the window from OAUTH_LINK_MAX_AGE_DAYS', async () => {
    const h = await boot({ OAUTH_LINK_MAX_AGE_DAYS: '1' });
    const p = await person(h, 'admin', h.accountId, Date.now() - 2 * DAY);
    expect((await refused(h, p.subject)).status).toBe(403);
  });

  it('refuses a person who is only a member (not an owner or admin) anywhere', async () => {
    const h = await boot();
    const p = await person(h, 'member');
    expect(await refused(h, p.subject)).toMatchObject({ status: 403, message: expect.stringMatching(/not an owner or admin/) });
    expect(JSON.parse(h.oauthLog.at(-1)!)).toEqual({ msg: 'mcp.oauth_refused', reason: 'not_active_admin' });
  });

  it('refuses a subject two different people carry, never guessing which one it is', async () => {
    const h = await boot();
    const a = await person(h, 'admin');
    const b = await person(h, 'admin', h.other.accountId);
    await h.link(a.subject, b.personId);
    expect(await refused(h, a.subject)).toMatchObject({ status: 403, message: expect.stringMatching(/more than one dForms account/) });
    expect(JSON.parse(h.oauthLog.at(-1)!)).toEqual({ msg: 'mcp.oauth_refused', reason: 'ambiguous' });
  });
});

describe('a web login, then an MCP sign-in, end to end', () => {
  const SECRET = 'spec-platform-secret-0123456789abcdef';
  const workos = { AUTH_PROVIDER: 'workos', JWT_SECRET: SECRET, JWT_ISSUER: 'spec-iam', JWT_AUDIENCE: 'spec-apps' };
  const session = (claims: Record<string, unknown>) =>
    signJwtHs256({ iss: 'spec-iam', aud: 'spec-apps', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600, ...claims }, SECRET);

  it('records the WorkOS user id the session token carries on any verified web request, and the sign-in then acts as that member', async () => {
    const h = await boot(workos);
    const iamUser = randomUUID();
    const workosUser = `user_01${randomUUID().replaceAll('-', '').slice(0, 24).toUpperCase()}`;
    // Before the person ever uses the web app: not linked.
    expect((await h.post(initialize('2025-06-18'), { authorization: `Bearer ${idp.token(workosUser, `${h.base}/mcp`)}` })).status).toBe(403);
    const me = await fetch(`${h.base}/v1/me`, {
      headers: { authorization: `Bearer ${session({ sub: iamUser, account_id: randomUUID(), email: 'web@example.com', name: 'Web', workos_user_id: workosUser })}` },
    });
    expect(me.status).toBe(200);
    const row = await h.db.get<{ id: string; account_id: string; role: string; idp_subject: string; login_seen_at: number }>(
      sql`SELECT id, account_id, role, idp_subject, login_seen_at FROM member WHERE external_id = ${iamUser}`,
    );
    expect(row).toMatchObject({ role: 'owner', idp_subject: workosUser });
    expect(Number(row!.login_seen_at)).toBeGreaterThan(Date.now() - 60_000);
    const c = await h.signIn(idp.client(workosUser));
    const who = structured<{ workspace: { id: string }; member: { id: string } }>(await c.callTool({ name: 'whoami', arguments: {} }));
    expect(who).toMatchObject({ workspace: { id: row!.account_id }, member: { id: row!.id } });
  });

  it("reaches a second workspace the person opened on the web, not one they never opened, never someone else's row that shares their email", async () => {
    const h = await boot(workos);
    const iamUser = randomUUID();
    const workosUser = `user_01${randomUUID().replaceAll('-', '').slice(0, 24).toUpperCase()}`;
    const email = `${randomUUID().slice(0, 8)}@example.com`;
    const auth = { authorization: `Bearer ${session({ sub: iamUser, account_id: randomUUID(), email, name: 'Web', workos_user_id: workosUser })}` };
    expect((await fetch(`${h.base}/v1/me`, { headers: auth })).status).toBe(200);
    // Globex: the person's own admin row. Its owner row (Bo) is someone else.
    const own = randomUUID();
    await h.db.run(
      sql`INSERT INTO member (id, account_id, external_id, email, role, status, created_at)
          VALUES (${own}, ${h.other.accountId}, ${iamUser}, ${email}, 'admin', 'active', ${Date.now()})`,
    );
    // Initech: the person's own admin row, never opened on the web.
    const initech = randomUUID();
    await h.db.run(sql`INSERT INTO account (id, code, name, created_at) VALUES (${initech}, ${`i${initech.slice(0, 6)}`}, 'Initech', ${Date.now()})`);
    await h.db.run(
      sql`INSERT INTO member (id, account_id, external_id, email, role, status, created_at)
          VALUES (${randomUUID()}, ${initech}, ${iamUser}, ${email}, 'admin', 'active', ${Date.now()})`,
    );
    // Acme: a row bound to another person that still carries this email.
    const theirs = randomUUID();
    await h.db.run(
      sql`INSERT INTO member (id, account_id, external_id, email, role, status, created_at)
          VALUES (${theirs}, ${h.accountId}, ${`iam-someone-else-${randomUUID()}`}, ${email}, 'owner', 'active', ${Date.now()})`,
    );
    for (const workspace of [h.other.accountId, h.accountId]) {
      expect((await fetch(`${h.base}/v1/me`, { headers: { ...auth, 'x-quill-workspace': workspace } })).status).toBe(200);
    }
    const link = await h.db.get<{ idp_subject: string | null; login_seen_at: number | null }>(
      sql`SELECT idp_subject, login_seen_at FROM member WHERE id = ${theirs}`,
    );
    expect(link).toEqual({ idp_subject: null, login_seen_at: null });
    const c = await h.signIn(idp.client(workosUser));
    const listed = structured<{ workspaces: Array<{ id: string }> }>(await c.callTool({ name: 'list_my_workspaces', arguments: {} }));
    expect(listed.workspaces.map((w) => w.id)).not.toContain(h.accountId);
    expect(listed.workspaces.map((w) => w.id)).toContain(h.other.accountId);
    // A workspace of theirs never opened on the web is not reached yet.
    expect(listed.workspaces.map((w) => w.id)).not.toContain(initech);
    expect(listed.workspaces).toHaveLength(2);
  });

  it('records nothing for a placeholder id or a token without one, and a token without an issue time stamps nothing', async () => {
    const h = await boot(workos);
    const placeholder = randomUUID();
    const bare = randomUUID();
    const undated = randomUUID();
    const get = (token: string) => fetch(`${h.base}/v1/me`, { headers: { authorization: `Bearer ${token}` } });
    expect((await get(session({ sub: placeholder, account_id: randomUUID(), workos_user_id: 'pending_workos_sync' }))).status).toBe(200);
    expect((await get(session({ sub: bare, account_id: randomUUID() }))).status).toBe(200);
    expect((await get(session({ sub: undated, account_id: randomUUID(), iat: undefined }))).status).toBe(200);
    const rows = await h.db.all<{ external_id: string; idp_subject: string | null; login_seen_at: number | null }>(
      sql`SELECT external_id, idp_subject, login_seen_at FROM member WHERE external_id IN (${placeholder}, ${bare}, ${undated})`,
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.idp_subject === null)).toBe(true);
    expect(rows.find((r) => r.external_id === undated)?.login_seen_at ?? null).toBeNull();
    expect(rows.find((r) => r.external_id === bare)?.login_seen_at).not.toBeNull();
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

describe('a flood', () => {
  it('with one valid token keeps answering from dForms own database, no identity database involved', async () => {
    const h = await boot();
    const p = await person(h);
    const auth = { authorization: `Bearer ${idp.token(p.subject, `${h.base}/mcp`)}` };
    const codes = await Promise.all(Array.from({ length: 10 }, () => h.post(initialize('2025-06-18'), auth).then((r) => r.status)));
    expect(codes.every((c) => c === 200)).toBe(true);
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
    const p = await person(h, 'admin');
    const c = await h.signIn(idp.client(p.subject));
    expect(structured<{ member: { role: string } }>(await c.callTool({ name: 'whoami', arguments: {} })).member.role).toBe('admin');
    await h.db.run(sql`UPDATE member SET role = 'owner' WHERE id = ${p.memberId}`);
    expect(structured<{ member: { role: string } }>(await c.callTool({ name: 'whoami', arguments: {} })).member.role).toBe('owner');
    // Every request maps the sign-in again: a disabled member is no workspace,
    // so the door refuses the very next one with the message to act on.
    await h.db.run(sql`UPDATE member SET status = 'disabled' WHERE id = ${p.memberId}`);
    await expect(c.callTool({ name: 'list_forms', arguments: {} })).rejects.toThrow(/not an owner or admin of any dForms workspace/);
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
