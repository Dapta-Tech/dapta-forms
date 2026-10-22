/**
 * Several workspaces per MCP connection, end to end over HTTP: the whole API
 * on SQLite, a stand-in identity provider, a table as the person directory.
 *
 * A person signed in through OAuth may act in every workspace where they hold
 * an active member. Each call names its workspace (`workspace_id`), from
 * `list_my_workspaces`; with only one, it is used without asking. Staff of
 * the deployment (by email domain) may also search and act in any workspace,
 * through a staff access grant, judged again on every call. An API key keeps
 * its one workspace.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Client } from '@modelcontextprotocol/client';
import { projectMemberships, sql } from '@quill/db';
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

type Role = 'owner' | 'admin' | 'member';

/** A person the directory knows under a fresh subject, with no member anywhere yet. */
function newPerson(h: Harness) {
  const subject = `user_${randomUUID().slice(0, 8)}`;
  const personId = randomUUID();
  const email = `${subject}@example.com`;
  h.people.set(subject, { id: personId, email });
  return { subject, personId, email };
}

/** Give `p` a member in `accountId` with `role` (an access grant when `grant` is set). */
async function join(
  h: Harness,
  p: { personId: string; email: string },
  accountId: string,
  role: Role,
  opts: { status?: string; grant?: 'staff' } = {},
): Promise<string> {
  const memberId = randomUUID();
  await h.db.run(
    sql`INSERT INTO member (id, account_id, handle, display_name, email, role, status, external_id, access_grant, created_at)
        VALUES (${memberId}, ${accountId}, ${`p-${memberId.slice(0, 8)}`}, ${'Spec Person'}, ${p.email}, ${role},
          ${opts.status ?? 'active'}, ${p.personId}, ${opts.grant ?? null}, ${Date.now()})`,
  );
  return memberId;
}

/** A person who is admin of the seeded workspace (Acme) and a plain member of the other one (Globex). */
async function twoWorkspaces(h: Harness) {
  const p = newPerson(h);
  const acmeMember = await join(h, p, h.accountId, 'admin');
  const globexMember = await join(h, p, h.other.accountId, 'member');
  return { ...p, acmeMember, globexMember };
}

async function signIn(h: Harness, subject: string): Promise<Client> {
  return h.signIn(idp.client(subject));
}

type Listed = { workspaces: Array<{ id: string; name: string; role: string }>; next_step: string };

describe('list_my_workspaces', () => {
  it('lists every workspace where the person is an active member, with its name, role and id', async () => {
    const h = await boot();
    const p = await twoWorkspaces(h);
    const c = await signIn(h, p.subject);
    const listed = structured<Listed>(await c.callTool({ name: 'list_my_workspaces', arguments: {} }));
    expect(listed.workspaces).toEqual([
      { id: h.accountId, name: 'Acme Inc.', account_name: null, role: 'admin', access: 'member' },
      { id: h.other.accountId, name: 'Globex', account_name: null, role: 'member', access: 'member' },
    ]);
    expect(listed.next_step).toMatch(/workspace_id/);
  });
});

describe('list_my_workspaces, what it leaves out', () => {
  it('leaves out, for a person who is not staff, a staff access grant, a pending invitation and a disabled member', async () => {
    const h = await boot();
    const p = newPerson(h);
    await join(h, p, h.accountId, 'member');
    await join(h, p, h.other.accountId, 'admin', { grant: 'staff' });
    const third = randomUUID();
    await h.db.run(sql`INSERT INTO account (id, code, name, created_at) VALUES (${third}, 'initech', 'Initech', ${Date.now()})`);
    await join(h, p, third, 'member', { status: 'invited' });
    const c = await signIn(h, p.subject);
    const listed = structured<Listed>(await c.callTool({ name: 'list_my_workspaces', arguments: {} }));
    expect(listed.workspaces.map((w) => w.id)).toEqual([h.accountId]);
    // The staff grant's workspace cannot be named either.
    const named = await c.callTool({ name: 'list_forms', arguments: { workspace_id: h.other.accountId } });
    expect(errorText(named)).toMatch(/^NOT_FOUND/);
  });
});

describe('list_my_workspaces, matching by email', () => {
  it("leaves out a member that carries the person's email but belongs to someone else, and keeps an unbound one", async () => {
    const h = await boot();
    const p = newPerson(h);
    // Globex: a member with this email that another person already holds.
    await join(h, { personId: `someone-else-${randomUUID()}`, email: p.email }, h.other.accountId, 'owner');
    // Acme: an active member with this email that nobody holds yet.
    await h.db.run(
      sql`INSERT INTO member (id, account_id, email, role, status, created_at)
          VALUES (${randomUUID()}, ${h.accountId}, ${p.email}, 'member', 'active', ${Date.now()})`,
    );
    const c = await signIn(h, p.subject);
    const listed = structured<Listed>(await c.callTool({ name: 'list_my_workspaces', arguments: {} }));
    expect(listed.workspaces.map((w) => w.id)).toEqual([h.accountId]);
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
    expect(inGlobex).toMatchObject({ workspace: { id: h.other.accountId, name: 'Globex' }, member: { id: p.globexMember, role: 'member' } });

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
      [h.other.accountId, 'member'],
    ]);
  });
});

describe('isolation', () => {
  it('answers NOT_FOUND, with nothing about the workspace, for a workspace_id where the person is not a member', async () => {
    const h = await boot();
    const p = newPerson(h);
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

  it('drops a disabled member the same way, and reads a changed role on the next call', async () => {
    const h = await boot();
    const p = await twoWorkspaces(h);
    const c = await signIn(h, p.subject);
    await h.db.run(sql`UPDATE member SET role = 'owner' WHERE id = ${p.globexMember}`);
    const listed = structured<Listed>(await c.callTool({ name: 'list_my_workspaces', arguments: {} }));
    expect(listed.workspaces.find((w) => w.id === h.other.accountId)!.role).toBe('owner');
    await h.db.run(sql`UPDATE member SET status = 'disabled' WHERE id = ${p.acmeMember}`);
    const after = structured<Listed>(await c.callTool({ name: 'list_my_workspaces', arguments: {} }));
    expect(after.workspaces.map((w) => w.id)).toEqual([h.other.accountId]);
  });
});

describe('one workspace, or none', () => {
  it('uses the only workspace without workspace_id, and says which one it is', async () => {
    const h = await boot();
    const p = newPerson(h);
    const member = await join(h, p, h.other.accountId, 'member');
    const c = await signIn(h, p.subject);
    const listed = structured<Listed>(await c.callTool({ name: 'list_my_workspaces', arguments: {} }));
    expect(listed).toMatchObject({ workspaces: [{ id: h.other.accountId, name: 'Globex', role: 'member' }] });
    const who = structured<{ workspace: { id: string }; member: { id: string } }>(await c.callTool({ name: 'whoami', arguments: {} }));
    expect(who).toMatchObject({ workspace: { id: h.other.accountId }, member: { id: member } });
    const forms = await c.callTool({ name: 'list_forms', arguments: {} });
    expect(structured<{ workspace: { name: string } }>(forms).workspace.name).toBe('Globex');
    expect((forms as { content: Array<{ text: string }> }).content[0]!.text).toMatch(/^In workspace "Globex": /);
  });

  it('lets a person with no workspace connect, and every workspace tool says to open dForms once', async () => {
    const h = await boot();
    const p = newPerson(h);
    const c = await signIn(h, p.subject);
    const who = structured<{ person: { id: string }; workspaces: unknown[]; workspace: unknown }>(
      await c.callTool({ name: 'whoami', arguments: {} }),
    );
    expect(who).toMatchObject({ person: { id: p.personId }, workspaces: [], workspace: null });
    const listed = structured<Listed>(await c.callTool({ name: 'list_my_workspaces', arguments: {} }));
    expect(listed.workspaces).toEqual([]);
    expect(listed.next_step).toContain('open dForms once');
    const text = errorText(await c.callTool({ name: 'list_forms', arguments: {} }));
    expect(text).toMatch(/^NO_WORKSPACE/);
    expect(text).toContain(`open dForms once with this account (${APP_URL})`);
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
    const auth = { authorization: `Bearer ${idp.token(p.subject, `${h.base}/mcp`)}` };
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

// --- Staff of the deployment ------------------------------------------------

const STAFF_DOMAIN = 'staff.example.com';

/**
 * A deployment with staff on `STAFF_DOMAIN`, where Globex is a workspace of
 * the identity service (projected here already) and Initrode is one dForms
 * has never seen.
 */
async function staffDeployment() {
  const h = await boot({ IAM_STAFF_DOMAINS: STAFF_DOMAIN });
  const globexUpstream = randomUUID();
  await h.db.run(sql`UPDATE account SET external_id = ${globexUpstream} WHERE id = ${h.other.accountId}`);
  h.estate.set(globexUpstream, { id: globexUpstream, name: 'Globex', accountId: randomUUID(), accountName: 'Globex Holdings' });
  const initrode = randomUUID();
  h.estate.set(initrode, { id: initrode, name: 'Initrode', accountId: randomUUID(), accountName: 'Initrode Group' });
  return { h, globexUpstream, initrode };
}

/** A person on the staff domain, member of Acme only. */
async function staffPerson(h: Harness) {
  const subject = `user_${randomUUID().slice(0, 8)}`;
  const personId = randomUUID();
  const email = `${subject}@${STAFF_DOMAIN}`;
  h.people.set(subject, { id: personId, email });
  const acmeMember = await join(h, { personId, email }, h.accountId, 'member');
  return { subject, personId, email, acmeMember };
}

type Found = {
  workspaces: Array<{ id: string; name: string; account_name: string | null; role: string; access: string; matched_on?: string }>;
  staff: boolean;
  truncated: boolean;
  next_step: string;
};

describe('staff of the deployment', () => {
  it('searches every workspace by name (3+ letters or digits, at most 20), and without search lists only their own', async () => {
    const { h, initrode, globexUpstream } = await staffDeployment();
    const p = await staffPerson(h);
    const c = await signIn(h, p.subject);

    const mine = structured<Found>(await c.callTool({ name: 'list_my_workspaces', arguments: {} }));
    expect(mine.staff).toBe(true);
    expect(mine.workspaces.map((w) => w.id)).toEqual([h.accountId]);
    expect(mine.next_step).toMatch(/search/);

    // Accounts this database knows but no one could enter are never listed: a
    // local-only one, and one whose workspace is gone upstream.
    await h.db.run(
      sql`INSERT INTO account (id, code, name, external_id, created_at) VALUES (${randomUUID()}, 'globold', 'Globex parked', ${`legacy:${randomUUID()}`}, ${Date.now()})`,
    );
    await h.db.run(
      sql`INSERT INTO account (id, code, name, external_id, created_at) VALUES (${randomUUID()}, 'globgone', 'Globex gone', ${randomUUID()}, ${Date.now()})`,
    );
    const found = structured<Found>(await c.callTool({ name: 'list_my_workspaces', arguments: { search: 'Glob' } }));
    // Named by the identity service's id, the one id it has before and after dForms projects it.
    expect(found.workspaces).toEqual([
      { id: globexUpstream, name: 'Globex', account_name: 'Globex Holdings', role: 'admin', access: 'staff', matched_on: 'name' },
    ]);
    expect(found.truncated).toBe(false);
    // Found by a form's name, which only this database knows, and says so.
    const byForm = structured<Found>(await c.callTool({ name: 'list_my_workspaces', arguments: { search: 'secret survey' } }));
    expect(byForm.workspaces.map((w) => [w.id, w.matched_on])).toEqual([[globexUpstream, 'form_name']]);
    expect(found.next_step).toMatch(/Confirm it even when only one matched/);
    // A workspace dForms has never seen is named by the identity service's id.
    const fresh = structured<Found>(await c.callTool({ name: 'list_my_workspaces', arguments: { search: 'initrode group' } }));
    expect(fresh.workspaces).toEqual([
      { id: initrode, name: 'Initrode', account_name: 'Initrode Group', role: 'admin', access: 'staff', matched_on: 'account_name' },
    ]);
    // Its own workspace comes back as a member, never a grant.
    const own = structured<Found>(await c.callTool({ name: 'list_my_workspaces', arguments: { search: 'acme' } }));
    expect(own.workspaces).toEqual([{ id: h.accountId, name: 'Acme Inc.', account_name: null, role: 'member', access: 'member', matched_on: 'name' }]);

    expect(errorText(await c.callTool({ name: 'list_my_workspaces', arguments: { search: 'gl' } }))).toMatch(/^SEARCH_TOO_SHORT/);
    for (let i = 0; i < 25; i += 1) {
      const id = randomUUID();
      h.estate.set(id, { id, name: `Bulk ${i}`, accountId: null, accountName: null });
    }
    const many = structured<Found>(await c.callTool({ name: 'list_my_workspaces', arguments: { search: 'bulk', limit: 50 } }));
    expect(many.workspaces).toHaveLength(20);
    // Cut at the cap, and says how to narrow it.
    expect(many.truncated).toBe(true);
    expect(many.next_step).toMatch(/More workspaces matched than the 20 shown/);
    // Nothing is granted by looking.
    expect(await h.db.get(sql`SELECT id FROM member WHERE external_id = ${p.personId} AND access_grant = 'staff'`)).toBeUndefined();
  });

  it('always asks staff for workspace_id, even with one workspace of their own', async () => {
    const { h } = await staffDeployment();
    const p = await staffPerson(h);
    const c = await signIn(h, p.subject);
    const text = errorText(await c.callTool({ name: 'list_forms', arguments: {} }));
    expect(text).toMatch(/^WORKSPACE_REQUIRED: You are staff/);
    expect(text).toContain('confirm it with the user');
    // Said once, not in the message and again in the hint.
    expect(text.match(/staff of this deployment/g)).toHaveLength(1);
    const who = structured<{ staff: boolean; workspace: unknown; next_step: string }>(await c.callTool({ name: 'whoami', arguments: {} }));
    expect(who).toMatchObject({ staff: true, workspace: null });
    expect(who.next_step).toMatch(/list_my_workspaces\(search=/);
    // Named, its own workspace acts as its member, and says so like a staff result does.
    const acme = structured<{ workspace: Record<string, unknown> }>(await c.callTool({ name: 'list_forms', arguments: { workspace_id: h.accountId } }));
    expect(acme.workspace).toEqual({ id: h.accountId, name: 'Acme Inc.', access: 'member' });
    const whoAcme = structured<{ workspace: Record<string, unknown> }>(await c.callTool({ name: 'whoami', arguments: { workspace_id: h.accountId } }));
    expect(whoAcme.workspace).toMatchObject({ id: h.accountId, access: 'member' });
  });

  it('reads and writes in a customer workspace as an admin through a staff access grant, and logs every such call', async () => {
    const { h, globexUpstream } = await staffDeployment();
    const p = await staffPerson(h);
    const c = await signIn(h, p.subject);

    const listed = await c.callTool({ name: 'list_forms', arguments: { workspace_id: h.other.accountId } });
    expect(structured<{ workspace: unknown; forms: Array<{ id: string }> }>(listed)).toMatchObject({
      workspace: { id: h.other.accountId, name: 'Globex', access: 'staff' },
      forms: [{ id: h.other.formId }],
    });
    expect((listed as { content: Array<{ text: string }> }).content[0]!.text).toMatch(/^In workspace "Globex" \(staff access\): /);
    const grant = await h.db.get<{ id: string; role: string; status: string; access_grant: string }>(
      sql`SELECT id, role, status, access_grant FROM member WHERE account_id = ${h.other.accountId} AND external_id = ${p.personId}`,
    );
    expect(grant).toMatchObject({ role: 'admin', status: 'active', access_grant: 'staff' });

    // The same workspace by the identity service's id: the same grant, not a second one.
    const who = structured<{ workspace: { id: string }; member: { id: string; role: string }; staff: boolean }>(
      await c.callTool({ name: 'whoami', arguments: { workspace_id: globexUpstream } }),
    );
    expect(who).toMatchObject({ workspace: { id: globexUpstream, access: 'staff' }, member: { id: grant!.id, role: 'admin' }, staff: true });

    // A tool result echoes the id the agent sent, so it never looks like the
    // call landed in another workspace.
    const byUpstream = structured<{ workspace: { id: string; name: string } }>(
      await c.callTool({ name: 'list_forms', arguments: { workspace_id: globexUpstream } }),
    );
    expect(byUpstream.workspace).toEqual({ id: globexUpstream, name: 'Globex', access: 'staff' });
    // Case and stray spaces carry no meaning in an id: the same workspace, echoed normalized.
    const shouted = structured<{ workspace: { id: string } }>(
      await c.callTool({ name: 'list_forms', arguments: { workspace_id: ` ${globexUpstream.toUpperCase()} ` } }),
    );
    expect(shouted.workspace.id).toBe(globexUpstream);

    type Form = { form: { id: string; updated_at: number } };
    const created = structured<Form>(
      await c.callTool({ name: 'create_form', arguments: { name: 'Staff built', config: LEAD, workspace_id: h.other.accountId } }),
    );
    const updated = structured<Form>(
      await c.callTool({
        name: 'update_form',
        arguments: { form_id: created.form.id, name: 'Staff edited', expected_updated_at: created.form.updated_at, workspace_id: h.other.accountId },
      }),
    );
    structured(
      await c.callTool({
        name: 'publish_form',
        arguments: { form_id: created.form.id, expected_updated_at: updated.form.updated_at, workspace_id: h.other.accountId },
      }),
    );
    const row = await h.db.get<{ account_id: string; name: string; created_via: string }>(
      sql`SELECT account_id, name, created_via FROM form WHERE id = ${created.form.id}`,
    );
    expect(row).toEqual({ account_id: h.other.accountId, name: 'Staff edited', created_via: 'mcp' });

    const audit = JSON.parse(h.audit.at(-1)!) as Record<string, unknown>;
    expect(audit).toMatchObject({ tool: 'publish_form', accountId: h.other.accountId, memberId: grant!.id, personId: p.personId, via: 'staff_grant' });
    const lines = h.staffLog.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toHaveLength(7);
    expect(lines[0]).toMatchObject({ msg: 'mcp.staff_access', channel: 'mcp', via: 'staff_grant', personId: p.personId, accountId: h.other.accountId, workspaceId: globexUpstream, granted: true });
    expect(lines.slice(1).every((l) => l.granted === false)).toBe(true);
    // Never on the customer's roster.
    expect(await h.db.all(sql`SELECT id FROM member WHERE account_id = ${h.other.accountId} AND external_id = ${p.personId}`)).toHaveLength(1);
  });

  it('runs the parity tools too (a read, a write, a destructive one) in a customer workspace, and a person who is not staff gets NOT_FOUND', async () => {
    const { h, globexUpstream } = await staffDeployment();
    const p = await staffPerson(h);
    const c = await signIn(h, p.subject);
    const outsider = newPerson(h);
    h.people.set(outsider.subject, { id: outsider.personId, email: `${outsider.subject}@example.com` });
    await join(h, outsider, h.accountId, 'owner');
    const stranger = await signIn(h, outsider.subject);

    type Folder = { folder: { id: string; name: string }; workspace: Record<string, unknown> };
    const made = structured<Folder>(await c.callTool({ name: 'create_folder', arguments: { name: 'Staff folder', workspace_id: h.other.accountId } }));
    expect(made.workspace).toEqual({ id: h.other.accountId, name: 'Globex', access: 'staff' });
    expect(await h.db.get<{ account_id: string }>(sql`SELECT account_id FROM form_folder WHERE id = ${made.folder.id}`)).toEqual({ account_id: h.other.accountId });
    const listed = structured<{ folders: Array<{ id: string }> }>(
      await c.callTool({ name: 'list_folders', arguments: { workspace_id: globexUpstream } }),
    );
    expect(listed.folders.map((f) => f.id)).toContain(made.folder.id);

    for (const [name, args] of [
      ['list_folders', {}],
      ['create_folder', { name: 'Smuggled folder' }],
      ['delete_form', { form_id: h.other.formId }],
    ] as const) {
      for (const id of [h.other.accountId, globexUpstream]) {
        expect(errorText(await stranger.callTool({ name, arguments: { ...args, workspace_id: id } })), `${name} in ${id}`).toMatch(
          /^NOT_FOUND: No workspace of yours has this id\./,
        );
      }
    }
    expect(await h.db.get(sql`SELECT id FROM form_folder WHERE name = 'Smuggled folder'`)).toBeUndefined();
    expect(await h.db.get(sql`SELECT id FROM form WHERE id = ${h.other.formId}`)).toBeDefined();

    const gone = structured<{ deleted: { id: string } }>(
      await c.callTool({ name: 'delete_form', arguments: { form_id: h.other.formId, workspace_id: h.other.accountId } }),
    );
    expect(gone.deleted.id).toBe(h.other.formId);
    expect(await h.db.get(sql`SELECT id FROM form WHERE id = ${h.other.formId}`)).toBeUndefined();
    expect(JSON.parse(h.audit.at(-1)!)).toMatchObject({ tool: 'delete_form', accountId: h.other.accountId, via: 'staff_grant' });
  });

  it('projects a workspace dForms has never seen on first use, and creates a form there', async () => {
    const { h, initrode } = await staffDeployment();
    const p = await staffPerson(h);
    const c = await signIn(h, p.subject);
    const created = structured<{ form: { id: string }; workspace: { id: string; name: string } }>(
      await c.callTool({ name: 'create_form', arguments: { name: 'First in Initrode', config: LEAD, workspace_id: initrode } }),
    );
    const account = await h.db.get<{ id: string; name: string; onboarding_completed_at: number | null }>(
      sql`SELECT id, name, onboarding_completed_at FROM account WHERE external_id = ${initrode}`,
    );
    expect(account).toMatchObject({ name: 'Initrode', onboarding_completed_at: null });
    expect(created.workspace).toMatchObject({ id: initrode, name: 'Initrode' });
    expect((await h.db.get<{ account_id: string }>(sql`SELECT account_id FROM form WHERE id = ${created.form.id}`))!.account_id).toBe(account!.id);
  });

  it('answers NOT_FOUND for a workspace the identity service does not have live, or one only this database knows, and grants nothing', async () => {
    const { h } = await staffDeployment();
    const p = await staffPerson(h);
    const c = await signIn(h, p.subject);
    const localOnly = randomUUID();
    await h.db.run(sql`INSERT INTO account (id, code, name, created_at) VALUES (${localOnly}, 'localco', 'Local Co', ${Date.now()})`);
    for (const id of [randomUUID(), localOnly, 'not-an-id']) {
      expect(errorText(await c.callTool({ name: 'list_forms', arguments: { workspace_id: id } }))).toMatch(/^NOT_FOUND: No live workspace has this id\./);
    }
    expect(await h.db.get(sql`SELECT id FROM member WHERE external_id = ${p.personId} AND access_grant = 'staff'`)).toBeUndefined();
    expect(h.staffLog).toEqual([]);
  });

  it('enters a workspace where staff are a real member as that member, never turning it into a grant', async () => {
    const { h, globexUpstream } = await staffDeployment();
    const p = await staffPerson(h);
    const member = await join(h, p, h.other.accountId, 'member');
    const c = await signIn(h, p.subject);
    // By the identity service's id, in any letter case.
    for (const id of [globexUpstream, globexUpstream.toUpperCase()]) {
      const who = structured<{ member: { id: string; role: string }; workspace: Record<string, unknown> }>(
        await c.callTool({ name: 'whoami', arguments: { workspace_id: id } }),
      );
      expect(who.member).toEqual(expect.objectContaining({ id: member, role: 'member' }));
    }
    const row = await h.db.get<{ access_grant: string | null; role: string }>(sql`SELECT access_grant, role FROM member WHERE id = ${member}`);
    expect(row).toEqual({ access_grant: null, role: 'member' });
    expect(h.staffLog).toEqual([]);
  });

  it('never turns a membership the owner disabled, or a pending one, into a grant: it refuses and leaves the row as it was', async () => {
    for (const status of ['disabled', 'invited']) {
      const { h, globexUpstream } = await staffDeployment();
      const p = await staffPerson(h);
      const member = await join(h, p, h.other.accountId, 'member', { status });
      const c = await signIn(h, p.subject);
      for (const id of [h.other.accountId, globexUpstream]) {
        const text = errorText(await c.callTool({ name: 'list_forms', arguments: { workspace_id: id } }));
        expect(text).toMatch(/^MEMBERSHIP_NOT_ACTIVE: You have a membership in this workspace that is not active/);
      }
      const row = await h.db.get<{ access_grant: string | null; role: string; status: string }>(
        sql`SELECT access_grant, role, status FROM member WHERE id = ${member}`,
      );
      expect(row).toEqual({ access_grant: null, role: 'member', status });
      expect(h.staffLog).toEqual([]);
    }
  });

  it('never adopts a pending invitation by email as the grant: the invite stays a member invite', async () => {
    const { h } = await staffDeployment();
    const p = await staffPerson(h);
    const invite = randomUUID();
    await h.db.run(
      sql`INSERT INTO member (id, account_id, handle, email, role, status, created_at)
          VALUES (${invite}, ${h.other.accountId}, ${`i-${invite.slice(0, 8)}`}, ${p.email}, 'member', 'invited', ${Date.now()})`,
    );
    const c = await signIn(h, p.subject);
    const listed = structured<{ workspace: Record<string, unknown> }>(
      await c.callTool({ name: 'list_forms', arguments: { workspace_id: h.other.accountId } }),
    );
    expect(listed.workspace).toMatchObject({ id: h.other.accountId, access: 'staff' });
    const row = await h.db.get<{ external_id: string | null; role: string; status: string; access_grant: string | null }>(
      sql`SELECT external_id, role, status, access_grant FROM member WHERE id = ${invite}`,
    );
    expect(row).toEqual({ external_id: null, role: 'member', status: 'invited', access_grant: null });
    const grant = await h.db.get<{ id: string }>(
      sql`SELECT id FROM member WHERE account_id = ${h.other.accountId} AND external_id = ${p.personId} AND access_grant = 'staff'`,
    );
    expect(grant?.id).toBeDefined();
    expect(grant!.id).not.toBe(invite);
  });

  it('lets staff act where the identity service names them a member dForms has not seen yet, and the next projection makes it that membership', async () => {
    const { h, initrode } = await staffDeployment();
    const p = await staffPerson(h);
    h.estate.get(initrode)!.members = [p.personId];
    const c = await signIn(h, p.subject);
    const found = structured<Found>(await c.callTool({ name: 'list_my_workspaces', arguments: { search: 'initrode' } }));
    expect(found.workspaces.map((w) => [w.id, w.access])).toEqual([[initrode, 'staff']]);
    // What the search offered works: no MEMBERSHIP_NOT_SYNCED dead end.
    const listed = structured<{ workspace: Record<string, unknown>; forms: unknown[] }>(
      await c.callTool({ name: 'list_forms', arguments: { workspace_id: initrode } }),
    );
    expect(listed.workspace).toEqual({ id: initrode, name: 'Initrode', access: 'staff' });
    const row = await h.db.get<{ id: string; role: string; access_grant: string | null; account_id: string }>(
      sql`SELECT m.id, m.role, m.access_grant, m.account_id FROM member m JOIN account a ON a.id = m.account_id
          WHERE a.external_id = ${initrode} AND m.external_id = ${p.personId}`,
    );
    expect(row).toMatchObject({ role: 'admin', access_grant: 'staff' });
    expect(JSON.parse(h.staffLog[0]!)).toMatchObject({ granted: true, upstreamMember: true, workspaceId: initrode });

    // The person's next projection (the web app on their next visit) turns
    // that row into the membership, with the role upstream gives it.
    await projectMemberships(h.db, { externalId: p.personId, email: p.email, displayName: null }, [
      { workspaceId: initrode, workspaceName: 'Initrode', iamAccountId: null, workspaceUserId: null, role: 'member', active: true },
    ], { pruneMissing: false });
    const after = await h.db.get<{ id: string; role: string; access_grant: string | null }>(
      sql`SELECT id, role, access_grant FROM member WHERE id = ${row!.id}`,
    );
    expect(after).toEqual({ id: row!.id, role: 'member', access_grant: null });
  });

  it('names a workspace by one id before and after first use, and never swaps two with the same name', async () => {
    const { h, initrode } = await staffDeployment();
    const p = await staffPerson(h);
    // A second workspace called Initrode, under another account.
    const twin = randomUUID();
    h.estate.set(twin, { id: twin, name: 'Initrode', accountId: randomUUID(), accountName: 'Initrode Twin Co' });
    const c = await signIn(h, p.subject);
    const search = async () =>
      structured<Found>(await c.callTool({ name: 'list_my_workspaces', arguments: { search: 'initrode' } })).workspaces.map((w) => [
        w.id,
        w.account_name,
      ]);
    const before = await search();
    expect(before.map(([id]) => id).sort()).toEqual([initrode, twin].sort());
    // First use projects Initrode here, under a local id of its own.
    structured(await c.callTool({ name: 'whoami', arguments: { workspace_id: initrode } }));
    structured(await c.callTool({ name: 'list_forms', arguments: { workspace_id: initrode } }));
    const local = await h.db.get<{ id: string }>(sql`SELECT id FROM account WHERE external_id = ${initrode}`);
    expect(local!.id).not.toBe(initrode);
    // The same ids, each still with its own account: one row per workspace.
    expect((await search()).sort()).toEqual([...before].sort());
    expect((await search()).find(([id]) => id === initrode)![1]).toBe('Initrode Group');
    // Either id still enters it, as the same grant.
    for (const id of [initrode, local!.id]) {
      expect(structured<{ workspace: { name: string; access: string } }>(await c.callTool({ name: 'list_forms', arguments: { workspace_id: id } })).workspace).toMatchObject({
        name: 'Initrode',
        access: 'staff',
      });
    }
    expect(await h.db.all(sql`SELECT id FROM member WHERE external_id = ${p.personId} AND access_grant = 'staff'`)).toHaveLength(1);
  });

  it('cuts a person who is no longer staff off on the next call, although the grant row stays', async () => {
    const { h, globexUpstream } = await staffDeployment();
    const p = await staffPerson(h);
    const c = await signIn(h, p.subject);
    structured(await c.callTool({ name: 'list_forms', arguments: { workspace_id: h.other.accountId } }));
    expect(await h.db.get(sql`SELECT id FROM member WHERE external_id = ${p.personId} AND access_grant = 'staff'`)).toBeDefined();

    // The same person, now with an email off the staff domains (a new sign-in,
    // so the directory's per-subject cache is not what answers).
    const subject = `user_${randomUUID().slice(0, 8)}`;
    h.people.set(subject, { id: p.personId, email: `${subject}@example.com` });
    const after = await signIn(h, subject);
    for (const id of [h.other.accountId, globexUpstream]) {
      const text = errorText(await after.callTool({ name: 'list_forms', arguments: { workspace_id: id } }));
      expect(text).toMatch(/^NOT_FOUND: No workspace of yours has this id\./);
      expect(text).not.toContain('Globex');
    }
    const listed = structured<Found>(await after.callTool({ name: 'list_my_workspaces', arguments: { search: 'globex' } }));
    expect(listed).toMatchObject({ staff: false, workspaces: [] });
    // Back to a person with one workspace: used without asking.
    expect(structured<{ workspace: { id: string } }>(await after.callTool({ name: 'list_forms', arguments: {} })).workspace.id).toBe(h.accountId);
  });

  it('gives nothing beyond their own workspaces to a person off the staff domains, or to anyone when no domain is set', async () => {
    const cases = [
      // A look-alike of the staff domain.
      { env: { IAM_STAFF_DOMAINS: STAFF_DOMAIN }, domain: `not${STAFF_DOMAIN}` },
      // The staff domain itself, on a deployment that lists none.
      { env: {}, domain: STAFF_DOMAIN },
    ];
    for (const { env, domain } of cases) {
      const h = await boot(env);
      const upstream = randomUUID();
      await h.db.run(sql`UPDATE account SET external_id = ${upstream} WHERE id = ${h.other.accountId}`);
      h.estate.set(upstream, { id: upstream, name: 'Globex', accountId: null, accountName: null });
      const p = newPerson(h);
      h.people.set(p.subject, { id: p.personId, email: `${p.subject}@${domain}` });
      await join(h, p, h.accountId, 'owner');
      const c = await signIn(h, p.subject);
      const found = structured<Found>(await c.callTool({ name: 'list_my_workspaces', arguments: { search: 'globex' } }));
      expect(found).toMatchObject({ staff: false, workspaces: [] });
      for (const id of [h.other.accountId, upstream]) {
        expect(errorText(await c.callTool({ name: 'get_form', arguments: { form_id: h.other.formId, workspace_id: id } }))).toMatch(
          /^NOT_FOUND: No workspace of yours has this id\./,
        );
      }
      expect(await h.db.get(sql`SELECT id FROM member WHERE access_grant = 'staff'`)).toBeUndefined();
    }
  });
});
