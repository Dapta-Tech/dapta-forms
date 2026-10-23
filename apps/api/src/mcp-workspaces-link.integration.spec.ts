/**
 * Several workspaces per MCP connection, end to end over HTTP: the whole API
 * on SQLite and a stand-in identity provider.
 *
 * WITHOUT the person directory (`IAM_DB_*` unset, as in an environment
 * missing that secret; docs/adr/0004): a sign-in maps to members only
 * through the link a verified web login records (`h.link` plays that login),
 * and the person reaches every workspace where a member of theirs was vouched
 * for within the link window and is active, in any role. Each call names its
 * workspace (`workspace_id`), from `list_my_workspaces`; with only one, it is
 * used without asking. Nothing is matched by email, a staff access grant
 * never counts as the person's own, and staff reach only the workspaces
 * dForms already projected. A person with no such workspace is refused at
 * connect. An API key keeps its one workspace. The same flows with the
 * directory are in mcp-workspaces.integration.spec.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Client } from '@modelcontextprotocol/client';
import { sql } from '@quill/db';
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
  const h = await bootHarness(env, { oauth: { issuer: idp.issuer, directory: 'configured' } });
  open.push(h);
  // Workspaces are listed oldest first, and two made in the same millisecond
  // order by their random id: make Acme the older one by a clear margin.
  await h.db.run(sql`UPDATE account SET created_at = created_at - 60000 WHERE id = ${h.accountId}`);
  return h;
}

const LEAD = {
  version: 1,
  steps: [
    { key: 'name', type: 'name', question: 'What is your name?', required: true },
    { key: 'email', type: 'email', question: 'What is your work email?', required: true },
  ],
};

/** The refusal a verified sign-in that reaches no workspace gets, at connect. */
const NOT_REACHED = `This sign-in does not reach any dForms workspace yet: open dForms on the web (${APP_URL}), or log out there and back in, then connect again.`;

type Role = 'owner' | 'admin' | 'member';

/** Who each sign-in subject is: the person a verified web login of theirs links it to. */
const people = new Map<string, string>();

/** A person under a fresh subject, with no member anywhere yet (and so nothing linked yet). */
function newPerson(opts: { domain?: string } = {}) {
  const subject = `user_${randomUUID().slice(0, 8)}`;
  const personId = randomUUID();
  const email = `${subject}@${opts.domain ?? 'example.com'}`;
  people.set(subject, personId);
  return { subject, personId, email };
}

/**
 * Members are created one millisecond apart, in the order a spec joins them,
 * so the person's oldest member (the one a web login records the subject on,
 * see `h.link`) is always the first one joined.
 */
let clock = Date.now();

/** Give `p` a member in `accountId` with `role` (an access grant when `grant` is set). */
async function join(
  h: Harness,
  p: { personId: string; email: string },
  accountId: string,
  role: Role,
  opts: { status?: string; grant?: 'staff' } = {},
): Promise<string> {
  const memberId = randomUUID();
  clock += 1;
  await h.db.run(
    sql`INSERT INTO member (id, account_id, handle, display_name, email, role, status, external_id, access_grant, created_at)
        VALUES (${memberId}, ${accountId}, ${`p-${memberId.slice(0, 8)}`}, ${'Spec Person'}, ${p.email}, ${role},
          ${opts.status ?? 'active'}, ${p.personId}, ${opts.grant ?? null}, ${clock})`,
  );
  return memberId;
}

/** Another workspace, empty. */
async function workspace(h: Harness, name: string): Promise<string> {
  const id = randomUUID();
  await h.db.run(sql`INSERT INTO account (id, code, name, created_at) VALUES (${id}, ${`ws-${id.slice(0, 8)}`}, ${name}, ${Date.now()})`);
  return id;
}

/** A person who is admin of the seeded workspace (Acme) and owner of the other one (Globex). */
async function twoWorkspaces(h: Harness) {
  const p = newPerson();
  const acmeMember = await join(h, p, h.accountId, 'admin');
  const globexMember = await join(h, p, h.other.accountId, 'owner');
  return { ...p, acmeMember, globexMember };
}

/** What a verified web login of the person behind `subject` records, now. Call it once their members exist. */
async function link(h: Harness, subject: string): Promise<void> {
  const personId = people.get(subject);
  if (!personId) throw new Error(`no person behind ${subject}`);
  await h.link(subject, personId);
}

/** Link the person (a web login), then sign in with the official client. */
async function signIn(h: Harness, subject: string): Promise<Client> {
  await link(h, subject);
  return h.signIn(idp.client(subject));
}

/** Link the person (a web login), then the bearer header of an access token for them. */
async function bearer(h: Harness, subject: string): Promise<Record<string, string>> {
  await link(h, subject);
  return { authorization: `Bearer ${idp.token(subject, `${h.base}/mcp`)}` };
}

/** A raw `initialize` with this header: the status and the JSON-RPC error message, if any. */
async function connectRaw(h: Harness, auth: Record<string, string>): Promise<{ status: number; message: string | undefined }> {
  const res = await h.post(initialize('2025-06-18'), auth);
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  return { status: res.status, message: body.error?.message };
}

/** The last refused sign-in the API logged. */
const lastRefusal = (h: Harness) => JSON.parse(h.oauthLog.at(-1)!) as Record<string, unknown>;

type Listed = { workspaces: Array<{ id: string; name: string; role: string }>; next_step: string };

describe('list_my_workspaces', () => {
  it('lists every workspace where the person is an active member, with its name, role and id', async () => {
    const h = await boot();
    const p = await twoWorkspaces(h);
    const c = await signIn(h, p.subject);
    const listed = structured<Listed>(await c.callTool({ name: 'list_my_workspaces', arguments: {} }));
    expect(listed.workspaces).toEqual([
      { id: h.accountId, name: 'Acme Inc.', account_name: null, role: 'admin', access: 'member' },
      { id: h.other.accountId, name: 'Globex', account_name: null, role: 'owner', access: 'member' },
    ]);
    expect(listed.next_step).toMatch(/workspace_id/);
  });
});

describe('list_my_workspaces, what it leaves out', () => {
  it('leaves out a staff access grant, a pending invitation and a disabled member', async () => {
    const h = await boot();
    const p = newPerson();
    await join(h, p, h.accountId, 'admin');
    await join(h, p, h.other.accountId, 'admin', { grant: 'staff' });
    const initech = await workspace(h, 'Initech');
    await join(h, p, initech, 'admin', { status: 'invited' });
    const umbrella = await workspace(h, 'Umbrella');
    await join(h, p, umbrella, 'owner', { status: 'disabled' });
    const c = await signIn(h, p.subject);
    const listed = structured<Listed>(await c.callTool({ name: 'list_my_workspaces', arguments: {} }));
    expect(listed.workspaces.map((w) => w.id)).toEqual([h.accountId]);
    // None of them can be named either.
    for (const id of [h.other.accountId, initech, umbrella]) {
      expect(errorText(await c.callTool({ name: 'list_forms', arguments: { workspace_id: id } })), id).toMatch(/^NOT_FOUND/);
    }
  });

  it('lists a workspace where the person is only a member, and connects a person who is only a member everywhere', async () => {
    const h = await boot();
    const p = newPerson();
    // The subject lands on the member-role row (the oldest); the admin row is reached through it.
    await join(h, p, h.accountId, 'member');
    await join(h, p, h.other.accountId, 'admin');
    const c = await signIn(h, p.subject);
    const listed = structured<Listed>(await c.callTool({ name: 'list_my_workspaces', arguments: {} }));
    expect(listed.workspaces).toEqual([
      { id: h.accountId, name: 'Acme Inc.', account_name: null, role: 'member', access: 'member' },
      { id: h.other.accountId, name: 'Globex', account_name: null, role: 'admin', access: 'member' },
    ]);
    expect(structured<{ workspace: { id: string } }>(await c.callTool({ name: 'list_forms', arguments: { workspace_id: h.accountId } })).workspace.id).toBe(
      h.accountId,
    );

    const q = newPerson();
    await join(h, q, h.accountId, 'member');
    await join(h, q, h.other.accountId, 'member');
    expect((await connectRaw(h, await bearer(h, q.subject))).status).toBe(200);
  });
});

describe('list_my_workspaces, no matching by email', () => {
  it("never reaches a member that only shares the person's email, whether it belongs to no one or to someone else", async () => {
    const h = await boot();
    const p = newPerson();
    const initech = await workspace(h, 'Initech');
    await join(h, p, initech, 'admin');
    // Globex: an owner with this email that another person holds.
    await join(h, { personId: `someone-else-${randomUUID()}`, email: p.email }, h.other.accountId, 'owner');
    // Acme: an active admin with this email that nobody holds yet.
    await h.db.run(
      sql`INSERT INTO member (id, account_id, email, role, status, created_at)
          VALUES (${randomUUID()}, ${h.accountId}, ${p.email}, 'admin', 'active', ${Date.now()})`,
    );
    // Both as freshly vouched for as the person's own: only the missing link keeps them out.
    await h.db.run(sql`UPDATE member SET login_seen_at = ${Date.now()} WHERE email = ${p.email}`);
    const c = await signIn(h, p.subject);
    const listed = structured<Listed>(await c.callTool({ name: 'list_my_workspaces', arguments: {} }));
    expect(listed.workspaces.map((w) => w.id)).toEqual([initech]);
    for (const id of [h.accountId, h.other.accountId]) {
      expect(errorText(await c.callTool({ name: 'list_forms', arguments: { workspace_id: id } })), id).toMatch(
        /^NOT_FOUND: No workspace of yours has this id\./,
      );
    }
  });
});

describe('a person with two workspaces and a different role in each', () => {
  it('asks for workspace_id on a call that names none, and points at list_my_workspaces', async () => {
    const h = await boot();
    const p = await twoWorkspaces(h);
    const c = await signIn(h, p.subject);
    for (const name of ['list_forms', 'create_form'] as const) {
      const args = name === 'create_form' ? { name: 'Nowhere', config: LEAD } : {};
      const text = errorText(await c.callTool({ name, arguments: args }));
      expect(text).toMatch(/^WORKSPACE_REQUIRED/);
      expect(text).toContain('list_my_workspaces');
    }
    expect(await h.db.get(sql`SELECT id FROM form WHERE name = 'Nowhere'`)).toBeUndefined();
  });

  it('acts in the workspace each call names, as the member and role it holds there, and says where', async () => {
    const h = await boot();
    const p = await twoWorkspaces(h);
    const c = await signIn(h, p.subject);

    type Who = { workspace: { id: string; name: string }; member: { id: string; role: string } };
    const inAcme = structured<Who>(await c.callTool({ name: 'whoami', arguments: { workspace_id: h.accountId } }));
    expect(inAcme).toMatchObject({ workspace: { id: h.accountId }, member: { id: p.acmeMember, role: 'admin', status: 'active', locale: null } });
    // Every field GET /v1/me documents reaches whoami.
    await h.db.run(sql`UPDATE member SET locale = 'es' WHERE id = ${p.acmeMember}`);
    const localized = structured<{ member: { locale: string | null } }>(await c.callTool({ name: 'whoami', arguments: { workspace_id: h.accountId } }));
    expect(localized.member.locale).toBe('es');
    const inGlobex = structured<Who>(await c.callTool({ name: 'whoami', arguments: { workspace_id: h.other.accountId } }));
    expect(inGlobex).toMatchObject({ workspace: { id: h.other.accountId, name: 'Globex' }, member: { id: p.globexMember, role: 'owner' } });

    type Created = { form: { id: string }; workspace: { id: string; name: string } };
    const created = await c.callTool({
      name: 'create_form',
      arguments: { name: 'Globex lead form', config: LEAD, workspace_id: h.other.accountId },
    });
    const form = structured<Created>(created);
    expect(form.workspace).toEqual({ id: h.other.accountId, name: 'Globex', access: 'member' });
    expect((created as { content: Array<{ text: string }> }).content[0]!.text).toContain('Globex');
    const row = await h.db.get<{ account_id: string; created_via: string }>(
      sql`SELECT account_id, created_via FROM form WHERE id = ${form.form.id}`,
    );
    expect(row).toEqual({ account_id: h.other.accountId, created_via: 'mcp' });
    const audit = JSON.parse(h.audit.at(-1)!) as Record<string, unknown>;
    expect(audit).toMatchObject({ tool: 'create_form', accountId: h.other.accountId, memberId: p.globexMember, personId: p.personId });

    // Each list holds its own workspace's forms only, and says which one it is.
    type Forms = { forms: Array<{ id: string }>; workspace: { id: string } };
    const globex = structured<Forms>(await c.callTool({ name: 'list_forms', arguments: { workspace_id: h.other.accountId } }));
    expect(globex.workspace.id).toBe(h.other.accountId);
    expect(globex.forms.map((f) => f.id).sort()).toEqual([h.other.formId, form.form.id].sort());
    const acme = structured<Forms>(await c.callTool({ name: 'list_forms', arguments: { workspace_id: h.accountId } }));
    expect(acme.workspace.id).toBe(h.accountId);
    expect(acme.forms.map((f) => f.id)).toContain(h.formId);
    expect(acme.forms.map((f) => f.id)).not.toContain(form.form.id);

    // The other tools follow the named workspace too.
    for (const [name, args] of [
      ['get_form', { form_id: form.form.id }],
      ['list_responses', { form_id: form.form.id }],
      ['get_form_analytics', { form_id: form.form.id }],
    ] as const) {
      const ok = structured<{ workspace: { id: string } }>(
        await c.callTool({ name, arguments: { ...args, workspace_id: h.other.accountId } }),
      );
      expect(ok.workspace.id).toBe(h.other.accountId);
    }
  });

  it('whoami without workspace_id names the person and every workspace, and acts in none', async () => {
    const h = await boot();
    const p = await twoWorkspaces(h);
    const c = await signIn(h, p.subject);
    const who = structured<{
      workspace: unknown;
      member: unknown;
      key: unknown;
      person: { id: string; email: string };
      workspaces: Array<{ id: string; role: string }>;
    }>(await c.callTool({ name: 'whoami', arguments: {} }));
    expect(who).toMatchObject({ workspace: null, member: null, key: null, person: { id: p.personId, email: p.email } });
    expect(who.workspaces.map((w) => [w.id, w.role])).toEqual([
      [h.accountId, 'admin'],
      [h.other.accountId, 'owner'],
    ]);
  });
});

describe('isolation', () => {
  it('answers NOT_FOUND, with nothing about the workspace, for a workspace_id where the person is not a member', async () => {
    const h = await boot();
    const p = newPerson();
    await join(h, p, h.accountId, 'owner');
    const c = await signIn(h, p.subject);
    const stranger = randomUUID();
    for (const [name, args] of [
      ['whoami', {}],
      ['list_forms', {}],
      ['get_form', { form_id: h.other.formId }],
      ['create_form', { name: 'Smuggled', config: LEAD }],
      ['update_form', { form_id: h.other.formId, name: 'Taken', expected_updated_at: 0 }],
      ['publish_form', { form_id: h.other.formId }],
      ['revert_form', { form_id: h.other.formId }],
      ['list_responses', { form_id: h.other.formId }],
      ['get_form_analytics', { form_id: h.other.formId }],
    ] as const) {
      for (const workspaceId of [h.other.accountId, stranger]) {
        const text = errorText(await c.callTool({ name, arguments: { ...args, workspace_id: workspaceId } }));
        expect(text, `${name} in ${workspaceId}`).toMatch(/^NOT_FOUND: No workspace of yours has this id\./);
        expect(text).not.toContain('Globex');
      }
    }
    expect(await h.db.get(sql`SELECT id FROM form WHERE name = 'Smuggled'`)).toBeUndefined();
    const untouched = await h.db.get<{ name: string }>(sql`SELECT name FROM form WHERE id = ${h.other.formId}`);
    expect(untouched!.name).toBe('Globex Secret Survey');
  });

  it("answers NOT_FOUND for another workspace's form, even inside a workspace the person belongs to", async () => {
    const h = await boot();
    const p = await twoWorkspaces(h);
    const c = await signIn(h, p.subject);
    const text = errorText(await c.callTool({ name: 'get_form', arguments: { form_id: h.other.formId, workspace_id: h.accountId } }));
    expect(text).toMatch(/^NOT_FOUND/);
    expect(text).not.toContain('Globex');
  });
});

describe('mid-session', () => {
  it('drops a workspace the person was removed from on the very next call, and keeps the other', async () => {
    const h = await boot();
    const p = await twoWorkspaces(h);
    const c = await signIn(h, p.subject);
    expect(structured<Listed>(await c.callTool({ name: 'list_my_workspaces', arguments: {} })).workspaces).toHaveLength(2);

    await h.db.run(sql`DELETE FROM member WHERE id = ${p.globexMember}`);
    const after = structured<Listed>(await c.callTool({ name: 'list_my_workspaces', arguments: {} }));
    expect(after.workspaces.map((w) => w.id)).toEqual([h.accountId]);
    expect(errorText(await c.callTool({ name: 'list_forms', arguments: { workspace_id: h.other.accountId } }))).toMatch(/^NOT_FOUND/);
    // Down to one workspace: it is used without asking.
    const acme = structured<{ workspace: { id: string } }>(await c.callTool({ name: 'list_forms', arguments: {} }));
    expect(acme.workspace.id).toBe(h.accountId);
  });

  it('reads a changed role on the next call, keeps a workspace demoted to member, and refuses the next request once no active workspace is left', async () => {
    const h = await boot();
    const p = await twoWorkspaces(h);
    const c = await signIn(h, p.subject);
    await h.db.run(sql`UPDATE member SET role = 'admin' WHERE id = ${p.globexMember}`);
    const listed = structured<Listed>(await c.callTool({ name: 'list_my_workspaces', arguments: {} }));
    expect(listed.workspaces.find((w) => w.id === h.other.accountId)!.role).toBe('admin');

    // Every request maps the sign-in again: a workspace demoted to member stays, with its new role.
    await h.db.run(sql`UPDATE member SET role = 'member' WHERE id = ${p.globexMember}`);
    const demoted = structured<Listed>(await c.callTool({ name: 'list_my_workspaces', arguments: {} }));
    expect(demoted.workspaces.map((w) => [w.id, w.role])).toEqual([
      [h.accountId, 'admin'],
      [h.other.accountId, 'member'],
    ]);

    // Every member disabled: the next request is refused like a fresh sign-in.
    await h.db.run(sql`UPDATE member SET status = 'disabled' WHERE id IN (${p.acmeMember}, ${p.globexMember})`);
    await expect(c.callTool({ name: 'list_my_workspaces', arguments: {} })).rejects.toThrow(/open dForms on the web/);
    expect(lastRefusal(h)).toEqual({ msg: 'mcp.oauth_refused', reason: 'no_workspace' });
  });
});

describe('one workspace, or none', () => {
  it('uses the only workspace without workspace_id, and says which one it is', async () => {
    const h = await boot();
    const p = newPerson();
    const member = await join(h, p, h.other.accountId, 'admin');
    const c = await signIn(h, p.subject);
    const listed = structured<Listed>(await c.callTool({ name: 'list_my_workspaces', arguments: {} }));
    expect(listed).toMatchObject({ workspaces: [{ id: h.other.accountId, name: 'Globex', role: 'admin' }] });
    const who = structured<{ workspace: { id: string }; member: { id: string } }>(await c.callTool({ name: 'whoami', arguments: {} }));
    expect(who).toMatchObject({ workspace: { id: h.other.accountId }, member: { id: member } });
    const forms = await c.callTool({ name: 'list_forms', arguments: {} });
    expect(structured<{ workspace: { name: string } }>(forms).workspace.name).toBe('Globex');
    expect((forms as { content: Array<{ text: string }> }).content[0]!.text).toMatch(/^In workspace "Globex": /);
  });

  it('refuses at connect, saying to open dForms on the web, a linked person whose only memberships are invited or disabled', async () => {
    const h = await boot();
    const p = newPerson();
    await join(h, p, h.accountId, 'admin', { status: 'invited' });
    await join(h, p, h.other.accountId, 'owner', { status: 'disabled' });
    const refused = await connectRaw(h, await bearer(h, p.subject));
    expect(refused).toEqual({ status: 403, message: NOT_REACHED });
    // Logged as no_workspace: the person is linked, only no member of theirs may act.
    expect(lastRefusal(h)).toEqual({ msg: 'mcp.oauth_refused', reason: 'no_workspace' });
    // The official client gets the same words.
    await expect(signIn(h, p.subject)).rejects.toThrow(/open dForms on the web/);
  });
});

describe('with an API key', () => {
  it("refuses a workspace_id other than the key's, and takes the key's own or none as before", async () => {
    const h = await boot();
    const { key } = await h.key('admin');
    const c = await h.connect(key);
    for (const other of [h.other.accountId, randomUUID()]) {
      const text = errorText(await c.callTool({ name: 'list_forms', arguments: { workspace_id: other } }));
      expect(text).toMatch(/^WORKSPACE_MISMATCH/);
      expect(text).not.toContain('Globex');
      expect(errorText(await c.callTool({ name: 'create_form', arguments: { name: 'Escaped', config: LEAD, workspace_id: other } }))).toMatch(
        /^WORKSPACE_MISMATCH/,
      );
    }
    expect(await h.db.get(sql`SELECT id FROM form WHERE name = 'Escaped'`)).toBeUndefined();
    const own = structured<{ workspace: { id: string } }>(await c.callTool({ name: 'list_forms', arguments: { workspace_id: h.accountId } }));
    expect(own.workspace.id).toBe(h.accountId);
    // Its own id in capitals is still its own workspace, not "another".
    const ownShouted = structured<{ workspace: { id: string } }>(
      await c.callTool({ name: 'list_forms', arguments: { workspace_id: h.accountId.toUpperCase() } }),
    );
    expect(ownShouted.workspace.id).toBe(h.accountId.toLowerCase());
    const none = structured<{ workspace: { id: string; name: string } }>(await c.callTool({ name: 'list_forms', arguments: {} }));
    expect(none.workspace).toEqual({ id: h.accountId, name: 'Acme Inc.', access: 'member' });
    const listed = structured<Listed>(await c.callTool({ name: 'list_my_workspaces', arguments: {} }));
    expect(listed.workspaces).toEqual([{ id: h.accountId, name: 'Acme Inc.', account_name: null, role: 'admin', access: 'member' }]);
    const who = structured<{ person: unknown; key: { prefix: string } }>(await c.callTool({ name: 'whoami', arguments: {} }));
    expect(who).toMatchObject({ person: null, key: { prefix: key.slice(0, 12) } });
  });
});

describe('limits', () => {
  it('counts each workspace against the member there, so one workspace never spends the other budget', async () => {
    const h = await boot({ MCP_RATE_LIMIT_CAPACITY: '3', MCP_RATE_LIMIT_REFILL_PER_SEC: '0.001' });
    const p = await twoWorkspaces(h);
    const auth = await bearer(h, p.subject);
    const call = (workspaceId: string) => ({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'list_forms', arguments: { workspace_id: workspaceId } },
    });
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await h.post(call(h.accountId), auth)).status);
    expect(codes).toEqual([200, 200, 200, 429]);
    expect((await h.post(call(h.other.accountId), auth)).status).toBe(200);
    // A request that acts in no workspace counts against the person, not a member.
    expect((await h.post(initialize('2025-06-18'), auth)).status).toBe(200);
  });
});

// --- Staff of the deployment --------------------------------------------------

const STAFF_DOMAIN = 'staff.example.com';

type Found = {
  workspaces: Array<{ id: string; name: string; account_name: string | null; role: string; access: string; matched_on?: string }>;
  staff: boolean;
  truncated: boolean;
  next_step: string;
};

describe('staff of the deployment, without the person directory', () => {
  it('search and enter only the workspaces dForms already projected, through a staff access grant, revalidated on every call', async () => {
    const h = await boot({ IAM_STAFF_DOMAINS: STAFF_DOMAIN });
    const upstream = randomUUID();
    await h.db.run(sql`UPDATE account SET external_id = ${upstream} WHERE id = ${h.other.accountId}`);
    const p = newPerson({ domain: STAFF_DOMAIN });
    await join(h, p, h.accountId, 'admin');
    const c = await signIn(h, p.subject);

    const mine = structured<Found>(await c.callTool({ name: 'list_my_workspaces', arguments: {} }));
    expect(mine).toMatchObject({ staff: true, workspaces: [{ id: h.accountId, access: 'member' }] });
    // Found locally (no directory to ask), named by the identity service's id.
    const found = structured<Found>(await c.callTool({ name: 'list_my_workspaces', arguments: { search: 'globex' } }));
    expect(found.workspaces).toEqual([
      expect.objectContaining({ id: upstream, name: 'Globex', role: 'admin', access: 'staff', matched_on: 'name' }),
    ]);
    // A workspace dForms never projected cannot be checked without the directory: not found, nothing granted.
    expect(errorText(await c.callTool({ name: 'list_forms', arguments: { workspace_id: randomUUID() } }))).toMatch(/^NOT_FOUND/);
    expect(await h.db.get(sql`SELECT id FROM member WHERE access_grant = 'staff'`)).toBeUndefined();

    const forms = structured<{ forms: Array<{ id: string }> }>(await c.callTool({ name: 'list_forms', arguments: { workspace_id: upstream } }));
    expect(forms.forms.map((f) => f.id)).toContain(h.other.formId);
    const grant = await h.db.get<{ role: string; access_grant: string }>(
      sql`SELECT role, access_grant FROM member WHERE account_id = ${h.other.accountId} AND external_id = ${p.personId}`,
    );
    expect(grant).toEqual({ role: 'admin', access_grant: 'staff' });
    expect(h.staffLog.map((l) => JSON.parse(l) as Record<string, unknown>)).toEqual([
      expect.objectContaining({ msg: 'mcp.staff_access', via: 'staff_grant', workspaceId: upstream, granted: true }),
    ]);

    // Off the staff domain on the next call: the grant row stays, and reaches nothing.
    await h.db.run(sql`UPDATE member SET email = ${'former@example.com'} WHERE external_id = ${p.personId}`);
    expect(errorText(await c.callTool({ name: 'list_forms', arguments: { workspace_id: upstream } }))).toMatch(/^NOT_FOUND/);
  });

  it('never lists a staff access grant as their own, and refuses a person whose only row is a grant', async () => {
    const h = await boot({ IAM_STAFF_DOMAINS: STAFF_DOMAIN });
    const p = newPerson({ domain: STAFF_DOMAIN });
    await join(h, p, h.accountId, 'admin');
    const grant = await join(h, p, h.other.accountId, 'admin', { grant: 'staff' });
    // As live as a membership: active, admin, carrying the subject and vouched for now.
    await h.db.run(sql`UPDATE member SET idp_subject = ${p.subject}, login_seen_at = ${Date.now()} WHERE id = ${grant}`);
    const c = await signIn(h, p.subject);
    const listed = structured<Found>(await c.callTool({ name: 'list_my_workspaces', arguments: {} }));
    expect(listed.workspaces.map((w) => [w.id, w.access])).toEqual([[h.accountId, 'member']]);

    // Without the directory nothing names a person whose only row is a grant.
    const q = newPerson({ domain: STAFF_DOMAIN });
    const only = await join(h, q, h.other.accountId, 'owner', { grant: 'staff' });
    await h.db.run(sql`UPDATE member SET idp_subject = ${q.subject}, login_seen_at = ${Date.now()} WHERE id = ${only}`);
    const refused = await connectRaw(h, { authorization: `Bearer ${idp.token(q.subject, `${h.base}/mcp`)}` });
    expect(refused).toEqual({ status: 403, message: NOT_REACHED });
    expect(lastRefusal(h)).toEqual({ msg: 'mcp.oauth_refused', reason: 'not_linked' });
    const grants = await h.db.all<{ access_grant: string | null }>(sql`SELECT access_grant FROM member WHERE id IN (${grant}, ${only})`);
    expect(grants.every((g) => g.access_grant === 'staff')).toBe(true);
  });
});
