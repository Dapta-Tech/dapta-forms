/**
 * The in-process principal of an MCP connection over the real app: the MCP
 * backend (the seam every tool calls) acting as a member with no API key, on
 * the same handlers, the same SQLite harness and the same rules a key gets.
 * The OAuth door that will produce this caller lands separately; these pin
 * what it will find when it does.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from '@quill/db';
import { BackendError, type McpCaller } from '@quill/mcp';
import { AdminCrudController } from './admin-crud.controller';
import { AnalyticsController } from './analytics.controller';
import { ApiKeysController } from './api-keys.controller';
import { inProcessRequest } from './in-process-principal';
import { ApiFormsBackend } from './mcp.backend';
import { bootHarness, initialize, type Harness } from './mcp-harness';

const open: Harness[] = [];
async function boot() {
  const h = await bootHarness();
  open.push(h);
  return h;
}
afterAll(async () => {
  await Promise.all(open.map((h) => h.close()));
});

const LEAD = {
  version: 1,
  steps: [
    { key: 'name', type: 'name', question: 'What is your name?', required: true },
    { key: 'email', type: 'email', question: 'What is your work email?', required: true },
  ],
};

function backendOf(h: Harness): ApiFormsBackend {
  return new ApiFormsBackend(h.db, () => ({
    forms: h.app.get(AdminCrudController, { strict: false }),
    analytics: h.app.get(AnalyticsController, { strict: false }),
  }));
}

/** An MCP connection acting as `memberId` in `accountId`, as the OAuth door will build it. */
function connection(accountId: string, memberId: string): McpCaller {
  return {
    accountId,
    workspaceName: 'unused',
    memberId,
    role: 'unused: the handlers read it live',
    credentialId: memberId,
    label: 'connection',
    context: { req: inProcessRequest({ accountId, memberId }) },
  };
}

async function addMember(h: Harness, role: 'admin' | 'member'): Promise<string> {
  const id = randomUUID();
  await h.db.run(
    sql`INSERT INTO member (id, account_id, handle, display_name, email, role, status, created_at)
        VALUES (${id}, ${h.accountId}, ${`m-${id.slice(0, 8)}`}, ${'Spec Member'}, ${`${id.slice(0, 8)}@example.com`},
          ${role}, ${'active'}, ${Date.now()})`,
  );
  return id;
}

async function failure(promise: Promise<unknown>): Promise<BackendError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof BackendError) return err;
    throw err;
  }
  throw new Error('expected a BackendError');
}

describe('an MCP connection through the tools', () => {
  it('whoami names its member and workspace, and a form it creates records created_via mcp, normalized like a key', async () => {
    const h = await boot();
    const backend = backendOf(h);
    const caller = connection(h.accountId, h.ownerId);
    expect(await backend.whoami(caller)).toMatchObject({ accountId: h.accountId, memberId: h.ownerId, role: 'owner', accountCode: 'acme' });
    const created = await backend.createForm(caller, { name: 'Talk to us', config: LEAD });
    const row = await h.db.get<{ created_via: string; account_id: string; config: string }>(
      sql`SELECT created_via, account_id, config FROM form WHERE id = ${created.id}`,
    );
    expect(row).toMatchObject({ created_via: 'mcp', account_id: h.accountId });
    expect((JSON.parse(row!.config) as { steps: Array<{ flowGroup?: string }> }).steps.map((s) => s.flowGroup)).toEqual([
      'lead_capture',
      'lead_capture',
    ]);
  });

  it('is held to the strict validation an API key gets', async () => {
    const h = await boot();
    const err = await failure(
      backendOf(h).createForm(connection(h.accountId, h.ownerId), {
        name: 'Broken',
        config: { version: 1, steps: [{ key: 'm', type: 'message', question: 'Hi', buttonText: 'Go on' }] },
      }),
    );
    expect(err.status).toBe(400);
    expect(err.issues).toContainEqual(expect.objectContaining({ path: 'config.steps.0.buttonText', code: 'UNSUPPORTED_FIELD' }));
    expect(await h.db.get(sql`SELECT id FROM form WHERE name = 'Broken'`)).toBeUndefined();
  });

  it("never reaches another workspace's form", async () => {
    const h = await boot();
    const backend = backendOf(h);
    const caller = connection(h.accountId, h.ownerId);
    expect((await backend.listForms(caller)).map((f) => f.id)).not.toContain(h.other.formId);
    expect((await failure(backend.getForm(caller, h.other.formId))).status).toBe(404);
    expect((await failure(backend.updateForm(caller, h.other.formId, { name: 'Pwned', expectedUpdatedAt: 1 }))).status).toBe(404);
  });

  it('reads the role live, and fails the next call once the member is disabled or removed', async () => {
    const h = await boot();
    const backend = backendOf(h);
    const memberId = await addMember(h, 'member');
    const caller = connection(h.accountId, memberId);
    expect((await backend.whoami(caller)).role).toBe('member');
    await h.db.run(sql`UPDATE member SET role = 'admin' WHERE id = ${memberId}`);
    expect((await backend.whoami(caller)).role).toBe('admin');
    await h.db.run(sql`UPDATE member SET status = 'disabled' WHERE id = ${memberId}`);
    expect(await failure(backend.listForms(caller))).toMatchObject({ status: 401, code: 'MEMBER_NOT_ACTIVE' });

    const removed = await addMember(h, 'admin');
    const removedCaller = connection(h.accountId, removed);
    await backend.listForms(removedCaller);
    await h.db.run(sql`DELETE FROM member WHERE id = ${removed}`);
    expect((await failure(backend.listForms(removedCaller))).status).toBe(401);
  });

  it('cannot manage API keys, like a key cannot', async () => {
    const h = await boot();
    const keys = h.app.get(ApiKeysController, { strict: false });
    await expect(keys.list(inProcessRequest({ accountId: h.accountId, memberId: h.ownerId }))).rejects.toMatchObject({
      response: { error: 'KEY_NOT_ALLOWED' },
    });
  });
});

describe('over HTTP', () => {
  it('a request that imitates the principal in headers or body is still an anonymous caller', async () => {
    const h = await boot();
    const imitation = { accountId: h.accountId, memberId: h.ownerId, via: 'mcp_connection', channel: 'mcp' };
    const headers = {
      'x-quill-principal': JSON.stringify(imitation),
      'x-quill-account': h.accountId,
      'x-quill-member': h.ownerId,
      'x-quill-channel': 'mcp',
    };
    const res = await h.post({ ...initialize('2025-06-18'), principal: imitation, ...imitation }, headers);
    expect(res.status).toBe(401);
    const forged = await h.post(initialize('2025-06-18'), { ...headers, authorization: `Bearer ${JSON.stringify(imitation)}` });
    expect(forged.status).toBe(401);
  });
});
