/**
 * MCP connections over OAuth, end to end over HTTP: the whole API on SQLite,
 * the official MCP client discovering the login from a 401 and signing in
 * against a stand-in identity provider (a key pair generated here, served as
 * the issuer's JWKS). The token's subject maps to members through dForms' own
 * database: the link a verified web login records (`member.idp_subject`,
 * `member.login_seen_at`), honored within the link window, for active owners
 * and admins only. No identity database is read.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { listOutbox, sql } from '@quill/db';
import { signJwtHs256 } from './jwt';
import { CATALOG } from '@quill/mcp';
import { APP_URL, bootHarness, errorText, initialize, structured, type Harness } from './mcp-harness';
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

  it('connects a subject no web login ever recorded, acting nowhere, and every tool says to open dForms on the web', async () => {
    const h = await boot();
    const auth = { authorization: `Bearer ${idp.token('user_unknown', `${h.base}/mcp`)}` };
    // The chat app's connect succeeds, so it shows the person the tools' words, never its own failed-login error.
    const connect = await h.post(initialize('2025-06-18'), auth);
    expect(connect.status).toBe(200);
    expect(connect.headers.get('www-authenticate')).toBeNull();
    const c = await h.signIn(idp.client('user_unknown'));
    const who = (await c.callTool({ name: 'whoami', arguments: {} })) as { content: Array<{ text: string }> };
    expect(who.content[0]!.text).toBe(
      `Signed in as this person; this sign-in reaches no dForms workspace yet. Ask the user to open dForms once with this account (${APP_URL}), signing in again if it is already open, then try again.`,
    );
    expect(structured<{ workspaces: unknown[] }>(await c.callTool({ name: 'list_my_workspaces', arguments: {} })).workspaces).toEqual([]);
    // A search names the same step, never "none of your workspaces matched".
    const searched = structured<{ workspaces: unknown[]; next_step: string }>(await c.callTool({ name: 'list_my_workspaces', arguments: { search: 'Acme' } }));
    expect(searched).toMatchObject({ workspaces: [], next_step: expect.stringMatching(/^Ask the user to open dForms once with this account/) });
    // Nothing that reads a workspace runs: not the seeded workspace's forms, not another tenant's form.
    expect(errorText(await c.callTool({ name: 'list_forms', arguments: {} }))).toMatch(/^NO_WORKSPACE: .*open dForms once with this account/);
    expect(errorText(await c.callTool({ name: 'list_forms', arguments: { workspace_id: h.accountId } }))).toMatch(/^NO_WORKSPACE/);
    expect(errorText(await c.callTool({ name: 'get_form', arguments: { form_id: h.other.formId } }))).toMatch(/^NO_WORKSPACE/);
    // The reason only: never the subject or the token.
    expect(new Set(h.oauthLog).size).toBe(1);
    expect(JSON.parse(h.oauthLog[0]!)).toEqual({ msg: 'mcp.oauth_no_workspace', reason: 'not_linked', person: expect.stringMatching(/^unlinked:[0-9a-f]{24}$/) });
    for (const line of h.oauthLog) expect(line).not.toContain('user_unknown');
  });
});

describe('the link a web login records', () => {
  /** The workspaces a sign-in reaches, through the official client. */
  const reached = async (h: Harness, subject: string) =>
    structured<{ workspaces: Array<{ id: string }> }>(await (await h.signIn(idp.client(subject))).callTool({ name: 'list_my_workspaces', arguments: {} }))
      .workspaces.map((w) => w.id);

  it('maps a linked person, and reaches nothing for a member of the same workspace who never signed in on the web', async () => {
    const h = await boot();
    const linked = await person(h, 'admin');
    const unlinked = await person(h, 'admin', h.accountId, null);
    const c = await h.signIn(idp.client(linked.subject));
    expect(structured<{ member: { id: string } }>(await c.callTool({ name: 'whoami', arguments: {} })).member.id).toBe(linked.memberId);
    expect(await reached(h, unlinked.subject)).toEqual([]);
  });

  it('reaches nothing through a link older than the window, and the same connection acts again once the person comes back to the web', async () => {
    const h = await boot();
    const stale = await person(h, 'admin', h.accountId, Date.now() - 31 * DAY);
    const c = await h.signIn(idp.client(stale.subject));
    expect(errorText(await c.callTool({ name: 'list_forms', arguments: {} }))).toMatch(/^NO_WORKSPACE/);
    expect(JSON.parse(h.oauthLog.at(-1)!)).toEqual({ msg: 'mcp.oauth_no_workspace', reason: 'not_linked', person: expect.stringMatching(/^unlinked:/) });
    await h.link(stale.subject, stale.personId);
    // No new login and no reconnect: the next call already maps the sign-in again.
    expect(structured<{ member: { id: string } }>(await c.callTool({ name: 'whoami', arguments: {} })).member.id).toBe(stale.memberId);
  });

  it('takes the window from OAUTH_LINK_MAX_AGE_DAYS', async () => {
    const h = await boot({ OAUTH_LINK_MAX_AGE_DAYS: '1' });
    const p = await person(h, 'admin', h.accountId, Date.now() - 2 * DAY);
    expect(await reached(h, p.subject)).toEqual([]);
  });

  it('lets a plain member connect, acting with the member role', async () => {
    const h = await boot();
    const p = await person(h, 'member');
    const c = await h.signIn(idp.client(p.subject));
    expect(structured<{ member: { id: string; role: string } }>(await c.callTool({ name: 'whoami', arguments: {} })).member).toMatchObject({
      id: p.memberId,
      role: 'member',
    });
  });

  it('refuses a subject two different people carry, never guessing which one it is', async () => {
    const h = await boot();
    const a = await person(h, 'admin');
    const b = await person(h, 'admin', h.other.accountId);
    await h.link(a.subject, b.personId);
    const res = await h.post(initialize('2025-06-18'), { authorization: `Bearer ${idp.token(a.subject, `${h.base}/mcp`)}` });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/more than one dForms account/);
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
    // Before the person ever uses the web app: connected, acting nowhere yet.
    const c = await h.signIn(idp.client(workosUser));
    expect(errorText(await c.callTool({ name: 'list_forms', arguments: {} }))).toMatch(/^NO_WORKSPACE/);
    const me = await fetch(`${h.base}/v1/me`, {
      headers: { authorization: `Bearer ${session({ sub: iamUser, account_id: randomUUID(), email: 'web@example.com', name: 'Web', workos_user_id: workosUser })}` },
    });
    expect(me.status).toBe(200);
    const row = await h.db.get<{ id: string; account_id: string; role: string; idp_subject: string; login_seen_at: number }>(
      sql`SELECT id, account_id, role, idp_subject, login_seen_at FROM member WHERE external_id = ${iamUser}`,
    );
    expect(row).toMatchObject({ role: 'owner', idp_subject: workosUser });
    expect(Number(row!.login_seen_at)).toBeGreaterThan(Date.now() - 60_000);
    // The same connection, with no new login: the visit to the web is enough.
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
    // so the very next call acts nowhere, even naming the workspace it had.
    await h.db.run(sql`UPDATE member SET status = 'disabled' WHERE id = ${p.memberId}`);
    expect(errorText(await c.callTool({ name: 'list_forms', arguments: {} }))).toMatch(/^NO_WORKSPACE/);
    expect(errorText(await c.callTool({ name: 'list_forms', arguments: { workspace_id: h.accountId } }))).toMatch(/^NO_WORKSPACE/);
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

  it('counts two tokens of the same sign-in with no workspace against one bucket, apart from another such sign-in', async () => {
    const h = await boot({ MCP_RATE_LIMIT_CAPACITY: '3', MCP_RATE_LIMIT_REFILL_PER_SEC: '0.001' });
    const bearer = (subject: string) => ({ authorization: `Bearer ${idp.token(subject, `${h.base}/mcp`, { jti: randomUUID() })}` });
    const first = bearer('user_unlinked_a');
    const second = bearer('user_unlinked_a');
    const codes = [];
    for (const auth of [first, second, first, second]) codes.push((await h.post(initialize('2025-06-18'), auth)).status);
    expect(codes).toEqual([200, 200, 200, 429]);
    expect((await h.post(initialize('2025-06-18'), bearer('user_unlinked_b'))).status).toBe(200);
  });

  it('names a sign-in with no workspace by a digest only: never the subject in a log, audit or analytics line', async () => {
    const h = await boot({ PRODUCT_ANALYTICS_KEY: 'phc_spec_key' });
    const sent = async () =>
      (await listOutbox(h.db, { kind: 'analytics' })).map((r) => JSON.parse(String(r.payload)) as { distinctId: string; event: string });
    const c = await h.signIn(idp.client('user_secret_subject'));
    await c.callTool({ name: 'list_forms', arguments: {} });
    await c.callTool({ name: 'whoami', arguments: {} });
    const line = JSON.parse(h.audit.at(-1)!) as Record<string, unknown>;
    expect(line).toMatchObject({ tool: 'whoami', personId: expect.stringMatching(/^unlinked:[0-9a-f]{24}$/), caller: `oauth:${String(line.personId)}` });
    // The same sign-in is the same digest on every request.
    expect(new Set(h.audit.map((l) => (JSON.parse(l) as { personId: string }).personId)).size).toBe(1);
    await vi.waitFor(async () => expect((await sent()).filter((e) => e.event === '$mcp_tool_call')).toHaveLength(2), { timeout: 5000 });
    const events = await sent();
    expect(events.filter((e) => e.event === '$mcp_tool_call').every((e) => e.distinctId === line.personId)).toBe(true);
    for (const l of [...h.oauthLog, ...h.audit, ...events.map((e) => JSON.stringify(e))]) expect(l).not.toContain('user_secret_subject');
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
