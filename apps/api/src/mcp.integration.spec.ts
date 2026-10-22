/**
 * The MCP endpoint over the real app: every tool runs through the same
 * handlers the REST routes run, on a throwaway SQLite database, driven by the
 * official MCP client over HTTP.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { recordFormEvent, sql, upsertSubmission } from '@quill/db';
import { loadServerEnv } from '@quill/config/env';
import { APP_URL, bootHarness, errorText, initialize, structured, type Harness } from './mcp-harness';

const open: Harness[] = [];
async function boot(env: Parameters<typeof bootHarness>[0] = {}) {
  const h = await bootHarness(env);
  open.push(h);
  return h;
}
afterAll(async () => {
  await Promise.all(open.map((h) => h.close()));
});

type FormOut = { form: { id: string; public_url: string | null; updated_at: number; has_unpublished_draft: boolean } };

const LEAD = {
  version: 1,
  steps: [
    { key: 'name', type: 'name', question: 'What is your name?', required: true },
    { key: 'email', type: 'email', question: 'What is your work email?', required: true },
  ],
};

describe('tools over the real handlers', () => {
  it('whoami names the workspace and the member the key acts as', async () => {
    const h = await boot();
    const { key } = await h.key();
    const c = await h.connect(key);
    const who = structured<{ workspace: { id: string; code: string }; member: { role: string; email: string }; key: { prefix: string } }>(
      await c.callTool({ name: 'whoami', arguments: {} }),
    );
    expect(who.workspace).toMatchObject({ id: h.accountId, code: 'acme' });
    expect(who.member).toMatchObject({ role: 'owner', email: 'alex@example.com' });
    expect(who.key.prefix).toBe(key.slice(0, 12));
  });

  it('creates a form that is live at its public link, records created_via mcp, and reads it back', async () => {
    const h = await boot();
    const c = await h.connect((await h.key()).key);
    const created = structured<FormOut>(await c.callTool({ name: 'create_form', arguments: { name: 'Talk to us', config: LEAD } }));
    expect(created.form.public_url).toBe(`${APP_URL}/acme/f/talk-to-us`);
    const row = await h.db.get<{ created_via: string; account_id: string }>(sql`SELECT created_via, account_id FROM form WHERE id = ${created.form.id}`);
    expect(row).toEqual({ created_via: 'mcp', account_id: h.accountId });

    const got = structured<{ config_source: string; config: { steps: Array<{ key: string; flowGroup?: string }> } }>(
      await c.callTool({ name: 'get_form', arguments: { form_id: created.form.id } }),
    );
    expect(got.config_source).toBe('live');
    // The key path stores the engine's normalized config, as the editor does.
    expect(got.config.steps.map((s) => s.flowGroup)).toEqual(['lead_capture', 'lead_capture']);

    const list = structured<{ forms: Array<{ id: string }> }>(await c.callTool({ name: 'list_forms', arguments: {} }));
    expect(list.forms.map((f) => f.id)).toEqual(expect.arrayContaining([created.form.id, h.formId]));
  });

  it('edits as a draft, publishes it, and reverts it, keeping the live form until publish', async () => {
    const h = await boot();
    const c = await h.connect((await h.key()).key);
    const created = structured<FormOut>(await c.callTool({ name: 'create_form', arguments: { name: 'Lifecycle', config: LEAD } }));
    const read = structured<{ config: { steps: Array<Record<string, unknown>> }; updated_at: number }>(
      await c.callTool({ name: 'get_form', arguments: { form_id: created.form.id } }),
    );
    const edited = {
      ...read.config,
      steps: [...read.config.steps, { key: 'msg', type: 'textarea', question: 'Anything else?' }],
    };
    const draft = structured<FormOut>(
      await c.callTool({ name: 'update_form', arguments: { form_id: created.form.id, config: edited, expected_updated_at: read.updated_at } }),
    );
    expect(draft.form.has_unpublished_draft).toBe(true);
    const live = await h.db.get<{ config: string }>(sql`SELECT config FROM form WHERE id = ${created.form.id}`);
    expect(JSON.parse(live!.config).steps).toHaveLength(2);

    const published = structured<FormOut & { previous_published_at: string | null }>(
      await c.callTool({ name: 'publish_form', arguments: { form_id: created.form.id, expected_updated_at: draft.form.updated_at } }),
    );
    expect(published.form.has_unpublished_draft).toBe(false);
    expect(published.previous_published_at).not.toBeNull();
    const afterPublish = await h.db.get<{ config: string }>(sql`SELECT config FROM form WHERE id = ${created.form.id}`);
    expect(JSON.parse(afterPublish!.config).steps).toHaveLength(3);

    structured(await c.callTool({ name: 'revert_form', arguments: { form_id: created.form.id } }));
    const afterRevert = await h.db.get<{ config: string }>(sql`SELECT config FROM form WHERE id = ${created.form.id}`);
    expect(JSON.parse(afterRevert!.config).steps).toHaveLength(2);
  });

  it('discards a draft through the real route, flags a form whose link serves nothing, and leaves the live form alone', async () => {
    const h = await boot();
    const c = await h.connect((await h.key()).key);
    const created = structured<FormOut & { form: { is_live: boolean; live_step_count: number } }>(
      await c.callTool({ name: 'create_form', arguments: { name: 'Agenda una demo', config: { version: 1, steps: [] } } }),
    );
    expect(created.form).toMatchObject({ is_live: false, live_step_count: 0 });
    const read = structured<{ config: Record<string, unknown>; updated_at: number }>(
      await c.callTool({ name: 'get_form', arguments: { form_id: created.form.id } }),
    );
    const draft = structured<FormOut>(
      await c.callTool({
        name: 'update_form',
        arguments: { form_id: created.form.id, config: { ...read.config, steps: LEAD.steps }, expected_updated_at: read.updated_at },
      }),
    );
    const listed = structured<{ forms: Array<{ id: string; is_live: boolean | null; live_step_count: number | null }> }>(
      await c.callTool({ name: 'list_forms', arguments: { query: 'agenda' } }),
    );
    expect(listed.forms).toEqual([expect.objectContaining({ id: created.form.id, is_live: false, live_step_count: 0 })]);
    expect(
      structured<{ forms: Array<{ id: string; live_step_count: number | null }> }>(await c.callTool({ name: 'list_forms', arguments: {} })).forms.find(
        (f) => f.id === h.formId,
      )!.live_step_count,
    ).toBeGreaterThan(0);

    const discarded = structured<FormOut & { discarded: boolean }>(
      await c.callTool({ name: 'discard_draft', arguments: { form_id: created.form.id, expected_updated_at: draft.form.updated_at } }),
    );
    expect(discarded).toMatchObject({ discarded: true, form: { has_unpublished_draft: false } });
    const row = await h.db.get<{ config: string; draft_config: string | null }>(
      sql`SELECT config, draft_config FROM form WHERE id = ${created.form.id}`,
    );
    expect(row!.draft_config).toBeNull();
    expect(JSON.parse(row!.config).steps).toEqual([]);
    const again = structured<{ discarded: boolean }>(await c.callTool({ name: 'discard_draft', arguments: { form_id: created.form.id } }));
    expect(again.discarded).toBe(false);
  });

  it('answers STALE, with the new stamp, when the form changed since it was read', async () => {
    const h = await boot();
    const c = await h.connect((await h.key()).key);
    const read = structured<{ config: unknown; updated_at: number }>(await c.callTool({ name: 'get_form', arguments: { form_id: h.formId } }));
    structured(await c.callTool({ name: 'update_form', arguments: { form_id: h.formId, name: 'Renamed', expected_updated_at: read.updated_at } }));
    const text = errorText(
      await c.callTool({ name: 'update_form', arguments: { form_id: h.formId, config: read.config, expected_updated_at: read.updated_at } }),
    );
    expect(text).toMatch(/^STALE: .*updated_at is now \d+/);
    expect(text).toContain('get_form');
  });

  it('an edit of a form that already had a repeated option value and a rule to a deleted step says exactly what the save changes', async () => {
    const h = await boot();
    const c = await h.connect((await h.key()).key);
    const created = structured<FormOut>(await c.callTool({ name: 'create_form', arguments: { name: 'Canal', config: LEAD } }));
    // Saved the way a session stores a config (as sent, never normalized):
    // two options share the value "otro", and a rule jumps to a step deleted since.
    const stored = {
      version: 1,
      steps: [
        {
          key: 'canal',
          type: 'multiple_choice',
          question: 'How did you hear about us?',
          options: [
            { label: 'LinkedIn', value: 'linkedin' },
            { label: 'Otro', value: 'otro' },
            { label: 'Otro (evento)', value: 'otro' },
          ],
          goto: [{ values: ['linkedin'], target: 'borrado' }],
        },
        { key: 'email', type: 'email', question: 'What is your work email?', required: true },
        { key: 'cerca', type: 'text', question: 'Anything else?', hideWhen: { field: 'gone', values: ['x'] } },
      ],
    };
    await h.db.run(sql`UPDATE form SET config = ${JSON.stringify(stored)} WHERE id = ${created.form.id}`);

    const read = structured<{ config: { steps: unknown[] }; updated_at: number }>(
      await c.callTool({ name: 'get_form', arguments: { form_id: created.form.id } }),
    );
    const edited = { ...read.config, steps: [...read.config.steps, { key: 'msg', type: 'textarea', question: 'One more thing?' }] };
    const result = await c.callTool({
      name: 'update_form',
      arguments: { form_id: created.form.id, config: edited, expected_updated_at: read.updated_at },
    });
    const warnings = structured<{ warnings: string[] }>(result).warnings;

    const row = await h.db.get<{ draft_config: string }>(sql`SELECT draft_config FROM form WHERE id = ${created.form.id}`);
    const draft = JSON.parse(row!.draft_config) as {
      steps: Array<{ key: string; options?: Array<{ value: string }>; goto?: unknown; hideWhen?: { field: string } }>;
    };
    // What the API really saved.
    expect(draft.steps[0]!.options!.map((o) => o.value)).toEqual(['linkedin', 'otro', 'otro_2']);
    expect(draft.steps[0]!.goto).toBeUndefined();
    expect(draft.steps[2]!.hideWhen!.field).toBe('gone');

    // And each warning says exactly that, never "saved as it was" for what changed.
    const value = warnings.find((w) => w.startsWith('config.steps.0.options.2.value'))!;
    expect(value).toContain('"otro_2"');
    expect(value).not.toContain('saved as it was');
    const rule = warnings.find((w) => w.startsWith('config.steps.0.goto.0.target'))!;
    expect(rule).toContain('removed from the draft');
    expect(rule).not.toContain('saved as it was');
    const field = warnings.find((w) => w.startsWith('config.steps.2.hideWhen.field'))!;
    expect(field).toContain('saved as it was');
  });

  it('reads responses with the answers inside respondent_supplied, labelled and cleaned', async () => {
    const h = await boot();
    const c = await h.connect((await h.key()).key);
    await upsertSubmission(h.db, {
      formId: h.formId,
      sessionId: 'sess-1',
      data: {
        role: 'founder',
        team_size: 12,
        company: 'Acme <script>x</script> [win](https://evil.test)',
        email: 'lead@example.org',
        // A step deleted from the form since this response was given.
        budget: 'Over 10k',
      },
      score: 18,
    });
    await upsertSubmission(h.db, { formId: h.formId, sessionId: 'sess-2', data: { role: 'lead' }, score: 6, partial: true });
    const out = structured<{
      total: number;
      responses: Array<{
        status: string;
        score: number | null;
        outcome: { id: string; label: string } | null;
        respondent_supplied: { answers: Array<Record<string, unknown>> };
      }>;
    }>(await c.callTool({ name: 'list_responses', arguments: { form_id: h.formId } }));
    expect(out.total).toBe(2);
    const done = out.responses.find((r) => r.status === 'completed')!;
    expect(done.score).toBe(18);
    expect(done.respondent_supplied.answers.map(({ question, answer, step_key, step_removed }) => ({ question, answer, step_key, step_removed }))).toEqual([
      { question: 'What best describes you?', answer: 'Founder / Owner', step_key: 'role', step_removed: false },
      { question: 'How big is your team?', answer: '12', step_key: 'team_size', step_removed: false },
      { question: 'What company do you work at?', answer: 'Acme x win', step_key: 'company', step_removed: false },
      { question: 'Where should we send the results?', answer: 'lead@example.org', step_key: 'email', step_removed: false },
      { question: 'budget', answer: 'Over 10k', step_key: 'budget', step_removed: true },
    ]);
    expect(done.respondent_supplied.answers.find((a) => a.step_key === 'email')!.type).toBe('email');
    expect(done.respondent_supplied.answers.find((a) => a.step_key === 'budget')!.type).toBeNull();
    // Resolved by the live form's outcomes, as the respondent's ending was.
    expect(done.outcome).toEqual({ id: 'qualified', label: 'Qualified' });
    expect(out.responses.find((r) => r.status === 'partial')!.outcome).toBeNull();
    const completedOnly = structured<{ total: number }>(
      await c.callTool({ name: 'list_responses', arguments: { form_id: h.formId, status: 'completed' } }),
    );
    expect(completedOnly.total).toBe(1);
  });

  it('returns the funnel the Results screen computes, each metric defined', async () => {
    const h = await boot();
    const c = await h.connect((await h.key()).key);
    for (const s of ['a', 'b', 'c', 'd']) await recordFormEvent(h.db, { formId: h.formId, sessionId: s, type: 'view' });
    for (const s of ['a', 'b']) await recordFormEvent(h.db, { formId: h.formId, sessionId: s, type: 'start' });
    await upsertSubmission(h.db, { formId: h.formId, sessionId: 'a', data: { role: 'lead' }, score: 6 });
    const out = structured<{
      metrics: Record<string, { value: number | null }>;
      definitions: Record<string, string>;
      dropoff: { steps: unknown[] };
    }>(await c.callTool({ name: 'get_form_analytics', arguments: { form_id: h.formId } }));
    expect(out.metrics.views!.value).toBe(4);
    expect(out.metrics.starts!.value).toBe(2);
    expect(out.metrics.submissions!.value).toBe(1);
    expect(out.metrics.completion_rate!.value).toBe(50);
    expect(out.definitions.starts).toContain('began answering');
    expect(out.dropoff.steps).toHaveLength(5);
  });
});

describe('validation that teaches', () => {
  it('lists every problem of a refused config with its path, in one answer', async () => {
    const h = await boot();
    const c = await h.connect((await h.key()).key);
    const text = errorText(
      await c.callTool({
        name: 'create_form',
        arguments: {
          name: 'Broken',
          config: {
            version: 1,
            steps: [
              { key: 'q1', type: 'text', question: '' },
              { key: 'm', type: 'message', question: 'Hi', buttonText: 'Go on' },
              { key: 'q3', type: 'teleport', question: 'Where to?' },
            ],
          },
        },
      }),
    );
    expect(text).toMatch(/^VALIDATION_FAILED: \d+ problems/);
    expect(text).toContain('- config.steps.0.question [EMPTY_QUESTION]');
    expect(text).toContain('- config.steps.1.buttonText [UNSUPPORTED_FIELD]');
    expect(text).toContain('config.steps.2.type');
    expect(text).toContain('get_form_guide');
    expect(await h.db.get(sql`SELECT id FROM form WHERE name = 'Broken'`)).toBeUndefined();
  });

  it('refuses an update whose config would drop every step', async () => {
    const h = await boot();
    const c = await h.connect((await h.key()).key);
    const read = structured<{ updated_at: number }>(await c.callTool({ name: 'get_form', arguments: { form_id: h.formId } }));
    const text = errorText(
      await c.callTool({ name: 'update_form', arguments: { form_id: h.formId, config: { version: 1 }, expected_updated_at: read.updated_at } }),
    );
    expect(text).toContain('config.steps [STEPS_REQUIRED]');
  });
});

describe('workspace isolation', () => {
  it('never shows or touches another workspace: its form is NOT_FOUND for every tool', async () => {
    const h = await boot();
    const c = await h.connect((await h.key()).key);
    const list = structured<{ forms: Array<{ name: string }> }>(await c.callTool({ name: 'list_forms', arguments: {} }));
    expect(list.forms.map((f) => f.name)).not.toContain('Globex Secret Survey');
    const id = h.other.formId;
    const calls: Array<[string, Record<string, unknown>]> = [
      ['get_form', { form_id: id }],
      ['update_form', { form_id: id, name: 'Pwned', expected_updated_at: 1 }],
      ['publish_form', { form_id: id }],
      ['revert_form', { form_id: id }],
      ['list_responses', { form_id: id }],
      ['get_form_analytics', { form_id: id }],
    ];
    for (const [name, args] of calls) expect(errorText(await c.callTool({ name, arguments: args })), name).toMatch(/^NOT_FOUND/);
    const theirs = await h.db.get<{ name: string }>(sql`SELECT name FROM form WHERE id = ${id}`);
    expect(theirs!.name).toBe('Globex Secret Survey');
  });

  it('takes the workspace from the key only: a workspace header naming another one is ignored', async () => {
    const h = await boot();
    const c = await h.connect((await h.key()).key, { 'x-quill-workspace': h.other.accountId });
    const who = structured<{ workspace: { id: string } }>(await c.callTool({ name: 'whoami', arguments: {} }));
    expect(who.workspace.id).toBe(h.accountId);
    const created = structured<FormOut>(await c.callTool({ name: 'create_form', arguments: { name: 'Mine', config: LEAD } }));
    const row = await h.db.get<{ account_id: string }>(sql`SELECT account_id FROM form WHERE id = ${created.form.id}`);
    expect(row!.account_id).toBe(h.accountId);
  });

  it("a key of the other workspace sees only that workspace's forms", async () => {
    const h = await boot();
    const c = await h.connect(await h.otherKey());
    const list = structured<{ forms: Array<{ id: string }> }>(await c.callTool({ name: 'list_forms', arguments: {} }));
    expect(list.forms.map((f) => f.id)).toEqual([h.other.formId]);
    expect(errorText(await c.callTool({ name: 'get_form', arguments: { form_id: h.formId } }))).toMatch(/^NOT_FOUND/);
  });
});

describe('roles and key lifecycle', () => {
  it("a member's key writes exactly what the web lets a member write, and its role is read live on every call", async () => {
    const h = await boot();
    const { key, memberId } = await h.key('member');
    const c = await h.connect(key);
    const created = structured<FormOut>(await c.callTool({ name: 'create_form', arguments: { name: 'By a member', config: LEAD } }));
    structured(await c.callTool({ name: 'publish_form', arguments: { form_id: created.form.id } }));
    const who = async () => structured<{ member: { role: string } }>(await c.callTool({ name: 'whoami', arguments: {} })).member.role;
    expect(await who()).toBe('member');
    await h.db.run(sql`UPDATE member SET role = 'admin' WHERE id = ${memberId}`);
    expect(await who()).toBe('admin');
  });

  it('refuses a revoked key, and a key whose member was disabled, at the door and mid-session', async () => {
    const h = await boot();
    const revoked = await h.key('member');
    const c = await h.connect(revoked.key);
    structured(await c.callTool({ name: 'whoami', arguments: {} }));
    await h.db.run(sql`UPDATE api_key SET revoked_at_ms = ${Date.now()} WHERE member_id = ${revoked.memberId}`);
    await expect(c.callTool({ name: 'whoami', arguments: {} })).rejects.toThrow();
    expect((await h.post(initialize('2025-06-18'), { authorization: `Bearer ${revoked.key}` })).status).toBe(401);

    const removed = await h.key('member');
    expect((await h.post(initialize('2025-06-18'), { authorization: `Bearer ${removed.key}` })).status).toBe(200);
    await h.db.run(sql`UPDATE member SET status = 'disabled' WHERE id = ${removed.memberId}`);
    expect((await h.post(initialize('2025-06-18'), { authorization: `Bearer ${removed.key}` })).status).toBe(401);
  });
});

describe('the door on the real app', () => {
  it('refuses anonymous callers, credentials in the URL and browser origins', async () => {
    const h = await boot();
    const anon = await h.post(initialize('2025-06-18'));
    expect(anon.status).toBe(401);
    expect(anon.headers.get('www-authenticate')).toContain('Bearer');
    const { key } = await h.key();
    expect((await h.post(initialize('2025-06-18'), { authorization: `Bearer ${key}` }, `/mcp?api_key=${key.slice(0, 10)}`)).status).toBe(400);
    expect((await h.post(initialize('2025-06-18'), { authorization: `Bearer ${key}`, origin: 'https://evil.test' })).status).toBe(403);
    expect((await h.post(initialize('2025-06-18'), { authorization: 'Bearer dforms_not_a_real_key' })).status).toBe(401);
  });

  it('refuses a batch of 100 tool calls in one request, and URL credentials in any case', async () => {
    const h = await boot();
    const { key } = await h.key();
    const auth = { authorization: `Bearer ${key}`, 'mcp-protocol-version': '2025-06-18' };
    const batch = Array.from({ length: 100 }, (_, i) => ({
      jsonrpc: '2.0',
      id: i + 1,
      method: 'tools/call',
      params: { name: 'get_form_guide', arguments: {} },
    }));
    expect((await h.post(batch, auth)).status).toBe(400);
    expect(h.audit).toHaveLength(0);
    for (const p of ['API_KEY', 'Token', 'bearer', 'access_key']) expect((await h.post(initialize('2025-06-18'), auth, `/mcp?${p}=x`)).status, p).toBe(400);
  });

  it('logs a failure by class only, never the request data that caused it', async () => {
    const h = await boot();
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const auth = { authorization: `Bearer ${(await h.key()).key}`, 'mcp-protocol-version': '2025-06-18' };
      const res = await h.post({ note: 'private.person@example.org' }, auth);
      expect(res.status).toBe(400);
      expect(warn).toHaveBeenCalledWith('mcp transport: Error');
      expect(JSON.stringify(warn.mock.calls)).not.toContain('private.person');
    } finally {
      warn.mockRestore();
    }
  });

  it('answers 429 with Retry-After once a key spends its MCP bucket', async () => {
    const h = await boot({ MCP_RATE_LIMIT_CAPACITY: '2', MCP_RATE_LIMIT_REFILL_PER_SEC: '0.01' });
    const auth = { authorization: `Bearer ${(await h.key()).key}` };
    expect((await h.post(initialize('2025-06-18'), auth)).status).toBe(200);
    expect((await h.post(initialize('2025-06-18'), auth)).status).toBe(200);
    const limited = await h.post(initialize('2025-06-18'), auth);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('is a 404 when MCP_ENABLED=false', async () => {
    const h = await boot({ MCP_ENABLED: 'false' });
    expect((await h.post(initialize('2025-06-18'), { authorization: `Bearer ${(await h.key()).key}` })).status).toBe(404);
  });

  it('writes one audit line per tool call with no key, no config text and no answers in it', async () => {
    const h = await boot();
    const { key } = await h.key();
    const c = await h.connect(key);
    await upsertSubmission(h.db, { formId: h.formId, sessionId: 's', data: { email: 'private.person@example.org' }, score: 0 });
    await c.callTool({ name: 'create_form', arguments: { name: 'Confidential roadmap', config: LEAD } });
    await c.callTool({ name: 'list_responses', arguments: { form_id: h.formId } });
    expect(h.audit).toHaveLength(2);
    for (const line of h.audit) {
      expect(line).not.toContain(key);
      expect(line).not.toContain('Confidential roadmap');
      expect(line).not.toContain('work email');
      expect(line).not.toContain('private.person');
      expect(JSON.parse(line)).toMatchObject({ msg: 'mcp.tool_call', caller: key.slice(0, 12), accountId: h.accountId, result: 'ok' });
    }
  });
});

describe('browser access (CORS)', () => {
  const preflight = (h: Harness, path: string, origin: string) =>
    fetch(`${h.base}${path}`, {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type,mcp-protocol-version',
      },
    });

  it('lets an origin listed in MCP_ALLOWED_ORIGINS preflight and call /mcp, without credentials', async () => {
    const origin = 'https://inspector.example.test';
    const h = await boot({ MCP_ALLOWED_ORIGINS: `${origin}/` });
    const pre = await preflight(h, '/mcp', origin);
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe(origin);
    expect(pre.headers.get('access-control-allow-headers')).toContain('authorization');
    expect(pre.headers.get('access-control-allow-credentials')).toBeNull();
    const res = await h.post(initialize('2025-06-18'), { authorization: `Bearer ${(await h.key()).key}`, origin });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(origin);
    expect(res.headers.get('access-control-expose-headers')).toContain('WWW-Authenticate');
  });

  it('keeps the two allowlists apart: the dashboard origin cannot reach /mcp, an MCP origin cannot reach /v1', async () => {
    const mcpOrigin = 'https://inspector.example.test';
    const h = await boot({ MCP_ALLOWED_ORIGINS: mcpOrigin });
    const dashboard = await preflight(h, '/mcp', APP_URL);
    expect(dashboard.headers.get('access-control-allow-origin')).toBeNull();
    const rest = await preflight(h, '/v1/forms', APP_URL);
    expect(rest.headers.get('access-control-allow-origin')).toBe(APP_URL);
    expect(rest.headers.get('access-control-allow-credentials')).toBe('true');
    const crossed = await preflight(h, '/v1/forms', mcpOrigin);
    expect(crossed.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('applies the MCP policy to /mcp in any case: /MCP never gets the dashboard allowlist', async () => {
    const mcpOrigin = 'https://inspector.example.test';
    const h = await boot({ MCP_ALLOWED_ORIGINS: mcpOrigin });
    for (const path of ['/MCP', '/Mcp/']) {
      const dashboard = await preflight(h, path, APP_URL);
      expect(dashboard.headers.get('access-control-allow-origin'), path).toBeNull();
      expect(dashboard.headers.get('access-control-allow-credentials'), path).toBeNull();
      const listed = await preflight(h, path, mcpOrigin);
      expect(listed.headers.get('access-control-allow-origin'), path).toBe(mcpOrigin);
    }
  });

  it('with no MCP origin configured, no browser can preflight /mcp', async () => {
    const h = await boot();
    const pre = await preflight(h, '/mcp', 'https://inspector.example.test');
    expect(pre.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('config', () => {
  it('boots with nothing set and with blank deploy-rendered values', () => {
    const base = loadServerEnv({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    expect(base).toMatchObject({
      MCP_ENABLED: true,
      MCP_RATE_LIMIT_CAPACITY: 120,
      MCP_WRITE_RATE_LIMIT_CAPACITY: 20,
      MCP_TOOL_TIMEOUT_MS: 20_000,
    });
    expect(base.MCP_ALLOWED_ORIGINS).toBeUndefined();
    const blank = loadServerEnv({
      NODE_ENV: 'test',
      MCP_ENABLED: '',
      MCP_RATE_LIMIT_CAPACITY: '',
      MCP_WRITE_RATE_LIMIT_REFILL_PER_SEC: ' ',
      MCP_TOOL_TIMEOUT_MS: '',
      MCP_ALLOWED_HOSTS: '',
    } as NodeJS.ProcessEnv);
    expect(blank).toMatchObject({ MCP_ENABLED: true, MCP_RATE_LIMIT_CAPACITY: 120, MCP_WRITE_RATE_LIMIT_REFILL_PER_SEC: 0.2, MCP_TOOL_TIMEOUT_MS: 20_000 });
  });
});
