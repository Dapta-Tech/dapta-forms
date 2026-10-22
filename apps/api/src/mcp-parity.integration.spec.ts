/**
 * The tools of the rest of the API reference over the real app: each runs the
 * handler its REST route runs, so the account scope, the role check, the
 * validation and the secret masking are the route's own. Per tool: the happy
 * path, NOT_FOUND for the other workspace's ids, the role rule (a member is
 * refused exactly where the route refuses one) and a refused argument.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Client } from '@modelcontextprotocol/client';
import { sql, upsertSubmission } from '@quill/db';
import { WEBHOOK_SECRET_MASK } from '@quill/types';
import { AnalyticsService } from './analytics.service';
import { APP_URL, bootHarness, errorText, structured, type Harness } from './mcp-harness';
import type { RateLimiter } from './rate-limit';
import { API_KEY_RATE_LIMITER } from './tokens';

const CONFIG = {
  version: 1,
  steps: [
    { key: 'name', type: 'name', question: 'What is your name?', required: true },
    { key: 'email', type: 'email', question: 'What is your work email?', required: true },
    {
      key: 'interest',
      type: 'multiple_choice',
      question: 'What are you interested in?',
      options: [
        { label: 'A demo', value: 'demo' },
        { label: 'Pricing', value: 'pricing' },
      ],
    },
    { key: 'notes', type: 'textarea', question: 'Anything else?' },
  ],
};

let h: Harness;
let member: Client;
/**
 * A fresh admin per area: each key has its own 120 calls a minute, and an
 * admin passes every check an owner does on these routes (a member holds
 * only a few keys, so the owner cannot mint one per area).
 */
async function owner(): Promise<Client> {
  return h.connect((await h.key('admin')).key);
}
async function newForm(c: Client, name = `Form ${randomUUID().slice(0, 8)}`): Promise<string> {
  return structured<{ form: { id: string } }>(await c.callTool({ name: 'create_form', arguments: { name, config: CONFIG } })).form.id;
}
async function respond(formId: string, data: Record<string, unknown>, partial = false): Promise<string> {
  const row = await upsertSubmission(h.db, { formId, sessionId: randomUUID(), data, score: 0, partial });
  return row.id;
}
const notFound = (text: string) => expect(text).toMatch(/^NOT_FOUND: .* not found in this workspace\./);
const forbidden = (text: string) => expect(text).toMatch(/^FORBIDDEN: .*owner or admin/);

beforeAll(async () => {
  h = await bootHarness({ MCP_WRITE_RATE_LIMIT_CAPACITY: '1000', MCP_RATE_LIMIT_CAPACITY: '1000' });
  member = await h.connect((await h.key('member')).key);
});
afterAll(async () => {
  await h.close();
});

describe('forms', () => {
  it('set_form_slug moves the link, keeps the old one, and is refused for another workspace or a bad slug', async () => {
    const c = await owner();
    const id = await newForm(c, 'Slug me');
    const out = structured<{ form: { slug: string; public_url: string } }>(
      await c.callTool({ name: 'set_form_slug', arguments: { form_id: id, slug: 'sales-team' } }),
    );
    expect(out.form).toMatchObject({ slug: 'sales-team', public_url: `${APP_URL}/acme/f/sales-team` });
    expect(await h.db.get(sql`SELECT alias FROM form_alias WHERE form_id = ${id}`)).toEqual({ alias: 'slug-me' });
    structured(await member.callTool({ name: 'set_form_slug', arguments: { form_id: id, slug: 'by-a-member' } }));
    notFound(errorText(await c.callTool({ name: 'set_form_slug', arguments: { form_id: h.other.formId, slug: 'mine' } })));
    expect(errorText(await c.callTool({ name: 'set_form_slug', arguments: { form_id: id, slug: 'Not A Slug!' } }))).toMatch(/^SLUG_INVALID|^VALIDATION_FAILED/);
  });

  it('duplicate_form copies a form of this workspace only, recording the copy as made through the MCP', async () => {
    const c = await owner();
    const id = await newForm(c, 'Original');
    const copy = structured<{ form: { id: string; name: string } }>(await c.callTool({ name: 'duplicate_form', arguments: { form_id: id } }));
    expect(copy.form.name).toBe('Original (copy)');
    expect(await h.db.get(sql`SELECT created_via FROM form WHERE id = ${copy.form.id}`)).toEqual({ created_via: 'mcp' });
    structured(await member.callTool({ name: 'duplicate_form', arguments: { form_id: id } }));
    notFound(errorText(await c.callTool({ name: 'duplicate_form', arguments: { form_id: h.other.formId } })));
    expect((await c.callTool({ name: 'duplicate_form', arguments: { form_id: '' } })).isError).toBe(true);
  });

  it('delete_form deletes a form and its responses, and never one of another workspace', async () => {
    const c = await owner();
    const id = await newForm(c, 'Doomed');
    await respond(id, { email: 'a@example.com' });
    const out = structured<{ deleted: { id: string; name: string } }>(await c.callTool({ name: 'delete_form', arguments: { form_id: id } }));
    expect(out.deleted).toEqual({ id, name: 'Doomed' });
    expect(await h.db.get(sql`SELECT id FROM form WHERE id = ${id}`)).toBeUndefined();
    expect(await h.db.get(sql`SELECT id FROM submission WHERE form_id = ${id}`)).toBeUndefined();
    notFound(errorText(await c.callTool({ name: 'delete_form', arguments: { form_id: id } })));
    notFound(errorText(await c.callTool({ name: 'delete_form', arguments: { form_id: h.other.formId } })));
    expect(await h.db.get(sql`SELECT id FROM form WHERE id = ${h.other.formId}`)).toBeDefined();
    structured(await member.callTool({ name: 'delete_form', arguments: { form_id: await newForm(c) } }));
    expect((await c.callTool({ name: 'delete_form', arguments: {} })).isError).toBe(true);
  });
});

describe('folders', () => {
  it('creates, lists, files a form in, renames and deletes a folder, leaving its forms alive', async () => {
    const c = await owner();
    const folder = structured<{ folder: { id: string; name: string } }>(await c.callTool({ name: 'create_folder', arguments: { name: 'Campaigns' } })).folder;
    expect(errorText(await c.callTool({ name: 'create_folder', arguments: { name: 'campaigns' } }))).toMatch(/^NAME_TAKEN: .*Pick another/);
    const listed = structured<{ folders: Array<{ id: string }> }>(await member.callTool({ name: 'list_folders', arguments: {} }));
    expect(listed.folders.map((f) => f.id)).toContain(folder.id);

    const id = await newForm(c);
    expect(structured(await c.callTool({ name: 'move_form', arguments: { form_id: id, folder_id: folder.id } }))).toMatchObject({ form_id: id, folder_id: folder.id });
    notFound(errorText(await c.callTool({ name: 'move_form', arguments: { form_id: id, folder_id: randomUUID() } })));
    notFound(errorText(await c.callTool({ name: 'move_form', arguments: { form_id: h.other.formId, folder_id: null } })));
    expect((await c.callTool({ name: 'move_form', arguments: { form_id: id, folder_id: 7 } })).isError).toBe(true);

    expect(structured<{ folder: { name: string } }>(await member.callTool({ name: 'rename_folder', arguments: { folder_id: folder.id, name: 'Q4' } })).folder.name).toBe('Q4');
    notFound(errorText(await c.callTool({ name: 'rename_folder', arguments: { folder_id: randomUUID(), name: 'X' } })));
    expect((await c.callTool({ name: 'rename_folder', arguments: { folder_id: folder.id, name: '' } })).isError).toBe(true);

    expect(structured<{ deleted: { id: string } }>(await c.callTool({ name: 'delete_folder', arguments: { folder_id: folder.id } })).deleted.id).toBe(folder.id);
    expect(await h.db.get(sql`SELECT folder_id FROM form WHERE id = ${id}`)).toEqual({ folder_id: null });
    notFound(errorText(await c.callTool({ name: 'delete_folder', arguments: { folder_id: folder.id } })));
  });
});

describe('destinations', () => {
  let hook: Server;
  let hookUrl: string;
  const received: string[] = [];
  beforeAll(async () => {
    hook = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      req.on('end', () => {
        received.push(body);
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('thanks');
      });
    });
    await new Promise<void>((resolve) => hook.listen(0, resolve));
    hookUrl = `http://localhost:${(hook.address() as AddressInfo).port}/hook`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => hook.close(() => resolve()));
  });

  it('set_destinations masks the secret it returns, keeps it when sent back masked, and validates like the route', async () => {
    const c = await owner();
    const id = await newForm(c);
    const webhook = { type: 'webhook', enabled: true, events: ['complete'], settings: { url: hookUrl, secret: 's3cret-value' } };
    const out = structured<{ destinations: Array<{ id: string; settings: { secret: string } }> }>(
      await c.callTool({ name: 'set_destinations', arguments: { form_id: id, destinations: [webhook] } }),
    );
    expect(out.destinations[0]!.settings.secret).toBe(WEBHOOK_SECRET_MASK);
    const again = { ...webhook, id: out.destinations[0]!.id, settings: { url: hookUrl, secret: WEBHOOK_SECRET_MASK } };
    structured(await member.callTool({ name: 'set_destinations', arguments: { form_id: id, destinations: [again] } }));
    const stored = await h.db.get<{ config: string }>(sql`SELECT config FROM form WHERE id = ${id}`);
    expect(JSON.parse(stored!.config).destinations[0].settings.secret).toBe('s3cret-value');
    // get_form lists them, with ids and the secret masked: the list set_destinations starts from.
    const read = structured<{ destinations: Array<{ id: string; settings: { secret: string } }>; connected_destinations: number; config: Record<string, unknown> }>(
      await member.callTool({ name: 'get_form', arguments: { form_id: id } }),
    );
    expect(read.destinations).toHaveLength(1);
    expect(read.destinations[0]).toMatchObject({ id: out.destinations[0]!.id, settings: { secret: WEBHOOK_SECRET_MASK } });
    expect(read.connected_destinations).toBe(1);
    expect(read.config).not.toHaveProperty('destinations');

    const text = errorText(
      await c.callTool({ name: 'set_destinations', arguments: { form_id: id, destinations: [{ ...webhook, settings: { url: 'ftp://example.com' } }] } }),
    );
    expect(text).toMatch(/^VALIDATION_FAILED: .*\n- destinations\.0\.settings\.url/);
    notFound(errorText(await c.callTool({ name: 'set_destinations', arguments: { form_id: h.other.formId, destinations: [] } })));
    expect((await c.callTool({ name: 'set_destinations', arguments: { form_id: id } })).isError).toBe(true);
  });

  it('ping_webhook sends one signed test to the webhook, for owners and admins only', async () => {
    const c = await owner();
    const id = await newForm(c);
    expect(errorText(await c.callTool({ name: 'ping_webhook', arguments: { form_id: id } }))).toMatch(/^NO_WEBHOOK: .*set_destinations/);
    structured(
      await c.callTool({
        name: 'set_destinations',
        arguments: { form_id: id, destinations: [{ type: 'webhook', enabled: true, settings: { url: hookUrl } }] },
      }),
    );
    forbidden(errorText(await member.callTool({ name: 'ping_webhook', arguments: { form_id: id } })));
    const out = structured<{ ok: boolean; status: number; endpoint_supplied: { detail: string } }>(
      await c.callTool({ name: 'ping_webhook', arguments: { form_id: id } }),
    );
    // The endpoint's real status, as list_deliveries records it.
    expect(out).toMatchObject({ ok: true, status: 200 });
    const sent = JSON.parse(received.at(-1)!) as { test?: unknown; phase: string };
    expect(sent).toMatchObject({ test: true, phase: 'complete' });
    notFound(errorText(await c.callTool({ name: 'ping_webhook', arguments: { form_id: h.other.formId } })));

    const deliveries = structured<{ deliveries: Array<{ kind: string; status: string; action: string }> }>(
      await member.callTool({ name: 'list_deliveries', arguments: { form_id: id, status: ['done', 'failed'] } }),
    );
    expect(deliveries.deliveries[0]).toMatchObject({ kind: 'webhook', status: 'done' });
    notFound(errorText(await c.callTool({ name: 'list_deliveries', arguments: { form_id: h.other.formId } })));
    expect((await c.callTool({ name: 'list_deliveries', arguments: { form_id: id, status: ['lost'] } })).isError).toBe(true);
  });
});

describe('responses', () => {
  let c: Client;
  let formId: string;
  let ana: string;
  beforeAll(async () => {
    c = await owner();
    formId = await newForm(c, 'Responses');
    ana = await respond(formId, { firstname: 'Ana', lastname: 'Rivera', email: 'ana@example.com', interest: 'demo', notes: 'We run <b>ads</b> in three countries.' });
    await respond(formId, { firstname: 'Bo', email: 'bo@example.com', interest: 'pricing' }, true);
  });

  it('get_response reads one response of this form, its answers labelled and cleaned', async () => {
    const r = structured<{ status: string; respondent_supplied: { answers: Array<{ question: string; answer: string }> } }>(
      await member.callTool({ name: 'get_response', arguments: { form_id: formId, response_id: ana } }),
    );
    expect(r.status).toBe('completed');
    expect(r.respondent_supplied.answers).toContainEqual(
      expect.objectContaining({ question: 'What are you interested in?', answer: 'A demo', step_key: 'interest' }),
    );
    expect(r.respondent_supplied.answers).toContainEqual(
      expect.objectContaining({ question: 'Anything else?', answer: 'We run ads in three countries.', step_key: 'notes' }),
    );
    notFound(errorText(await c.callTool({ name: 'get_response', arguments: { form_id: h.formId, response_id: ana } })));
    notFound(errorText(await c.callTool({ name: 'get_response', arguments: { form_id: formId, response_id: randomUUID() } })));
    expect((await c.callTool({ name: 'get_response', arguments: { form_id: formId } })).isError).toBe(true);
  });

  it('get_response carries each answer and the outcome exactly as list_responses does, a removed step included', async () => {
    const id = await upsertSubmission(h.db, {
      formId: h.formId,
      sessionId: randomUUID(),
      // `budget` is a step the seeded form no longer has.
      data: { role: 'founder', team_size: 12, email: 'lead@example.org', budget: 'Over 10k' },
      score: 18,
    }).then((row) => row.id);
    type Item = { id: string; outcome: unknown; respondent_supplied: { answers: Array<Record<string, unknown>> } };
    const one = structured<Item>(await member.callTool({ name: 'get_response', arguments: { form_id: h.formId, response_id: id } }));
    const listed = structured<{ responses: Item[] }>(
      await member.callTool({ name: 'list_responses', arguments: { form_id: h.formId, limit: 50 } }),
    ).responses.find((r) => r.id === id)!;
    expect(one.outcome).toEqual({ id: 'qualified', label: 'Qualified' });
    expect(one.outcome).toEqual(listed.outcome);
    expect(one.respondent_supplied.answers).toEqual(listed.respondent_supplied.answers);
    expect(one.respondent_supplied.answers).toContainEqual({ question: 'budget', answer: 'Over 10k', step_key: 'budget', type: null, step_removed: true });
    expect(one.respondent_supplied.answers.find((a) => a.step_key === 'email')).toMatchObject({ type: 'email', step_removed: false });
  });

  it('get_response_file answers NOT_FOUND when the deployment stores no files, or the ids do not match', async () => {
    notFound(errorText(await c.callTool({ name: 'get_response_file', arguments: { form_id: formId, response_id: ana, step_key: 'notes' } })));
    notFound(errorText(await c.callTool({ name: 'get_response_file', arguments: { form_id: h.formId, response_id: ana, step_key: 'cv' } })));
    expect((await c.callTool({ name: 'get_response_file', arguments: { form_id: formId, response_id: ana } })).isError).toBe(true);
  });

  it('export_responses_csv returns the CSV the dashboard downloads, cut to max_rows and filtered like the table', async () => {
    const all = structured<{ rows: number; total_rows: number; truncated: boolean; respondent_supplied: { csv: string } }>(
      await member.callTool({ name: 'export_responses_csv', arguments: { form_id: formId } }),
    );
    expect(all).toMatchObject({ rows: 2, total_rows: 2, truncated: false });
    const [header, ...rows] = all.respondent_supplied.csv.split('\n');
    expect(header).toContain('What is your work email?');
    expect(header!.startsWith('\uFEFF')).toBe(false);
    expect(rows).toHaveLength(2);
    const one = structured<{ rows: number; total_rows: number; truncated: boolean }>(
      await c.callTool({ name: 'export_responses_csv', arguments: { form_id: formId, max_rows: 1 } }),
    );
    expect(one).toMatchObject({ rows: 1, total_rows: 2, truncated: true });
    const completed = structured<{ total_rows: number; respondent_supplied: { csv: string } }>(
      await c.callTool({ name: 'export_responses_csv', arguments: { form_id: formId, status: 'completed', answers: { interest: ['demo'] } } }),
    );
    expect(completed.total_rows).toBe(1);
    expect(completed.respondent_supplied.csv).toContain('ana@example.com');
    notFound(errorText(await c.callTool({ name: 'export_responses_csv', arguments: { form_id: h.other.formId } })));
    expect((await c.callTool({ name: 'export_responses_csv', arguments: { form_id: formId, max_rows: 5000 } })).isError).toBe(true);
  });

  it('export_responses_csv is the download byte for byte, reading only the rows it returns', async () => {
    const key = (await h.key('admin')).key;
    const k = await h.connect(key);
    const id = await newForm(k, 'Injection');
    // Formula triggers and a phone number: the cells csvField rewrites.
    await respond(id, { firstname: '=HYPERLINK("https://evil.example")', email: '+57 318 000 0000', notes: '@SUM(A1), "quoted"\nline' });
    await respond(id, { firstname: 'Bo', email: '-1+1', interest: 'pricing' });
    await respond(id, { firstname: 'Cy', email: 'cy@example.com' });
    const rest = await fetch(`${h.base}/v1/forms/${id}/submissions.csv`, { headers: { Authorization: `Bearer ${key}` } });
    expect(rest.status).toBe(200);
    const download = (await rest.text()).replace(/^\uFEFF/, '').replace(/\r\n$/, '');
    expect(download).toContain(`'=HYPERLINK`);
    expect(download).toContain('"=""+57 318 000 0000"""');

    const service = h.app.get(AnalyticsService, { strict: false });
    const all = vi.spyOn(service, 'exportSubmissions');
    const first = vi.spyOn(service, 'firstExportSubmissions');
    try {
      const whole = structured<{ rows: number; total_rows: number; respondent_supplied: { csv: string } }>(
        await k.callTool({ name: 'export_responses_csv', arguments: { form_id: id } }),
      );
      expect(whole).toMatchObject({ rows: 3, total_rows: 3 });
      expect(whole.respondent_supplied.csv).toBe(download);

      const one = structured<{ rows: number; total_rows: number; truncated: boolean; respondent_supplied: { csv: string } }>(
        await k.callTool({ name: 'export_responses_csv', arguments: { form_id: id, max_rows: 1 } }),
      );
      expect(one).toMatchObject({ rows: 1, total_rows: 3, truncated: true });
      expect(download.startsWith(one.respondent_supplied.csv)).toBe(true);
      // Never the unbounded export query: the first max_rows rows only.
      expect(all).not.toHaveBeenCalled();
      expect(first.mock.calls.map((c) => c[2])).toEqual([200, 1]);
    } finally {
      all.mockRestore();
      first.mockRestore();
    }
  });

  it('get_form_summary, get_response_facets and search_answers read the answers as the Summary tab does', async () => {
    const s = structured<{ total: number; questions: Array<{ step_key: string; kind: string; options?: Array<{ value: string; count: number }> }> }>(
      await member.callTool({ name: 'get_form_summary', arguments: { form_id: formId } }),
    );
    expect(s.total).toBe(2);
    expect(s.questions.find((q) => q.step_key === 'interest')!.options).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: 'demo', count: 1 }), expect.objectContaining({ value: 'pricing', count: 1 })]),
    );
    expect(structured<{ total: number }>(await c.callTool({ name: 'get_form_summary', arguments: { form_id: formId, status: 'partial' } })).total).toBe(1);
    notFound(errorText(await c.callTool({ name: 'get_form_summary', arguments: { form_id: h.other.formId } })));
    expect((await c.callTool({ name: 'get_form_summary', arguments: { form_id: formId, status: 'done' } })).isError).toBe(true);

    const f = structured<{ total: number; completed: number; partial: number; choices: Record<string, unknown[]> }>(
      await member.callTool({ name: 'get_response_facets', arguments: { form_id: formId } }),
    );
    expect(f).toMatchObject({ total: 2, completed: 1, partial: 1 });
    expect(Object.keys(f.choices)).toEqual(['interest']);
    notFound(errorText(await c.callTool({ name: 'get_response_facets', arguments: { form_id: h.other.formId } })));

    const found = structured<{ total: number; respondent_supplied: { answers: Array<{ response_id: string; text: string }> } }>(
      await member.callTool({ name: 'search_answers', arguments: { form_id: formId, step_key: 'notes', q: 'ADS' } }),
    );
    expect(found.total).toBe(1);
    expect(found.respondent_supplied.answers[0]).toMatchObject({ response_id: ana, text: 'We run ads in three countries.' });
    notFound(errorText(await c.callTool({ name: 'search_answers', arguments: { form_id: formId, step_key: 'interest' } })));
    notFound(errorText(await c.callTool({ name: 'search_answers', arguments: { form_id: h.other.formId, step_key: 'q' } })));
    expect((await c.callTool({ name: 'search_answers', arguments: { form_id: formId, step_key: 'notes', limit: 500 } })).isError).toBe(true);
  });

  it('delete_response and delete_responses delete this form responses only', async () => {
    const id = await newForm(c);
    const [a, b, d] = [await respond(id, { email: 'a@example.com' }), await respond(id, { email: 'b@example.com' }), await respond(id, { email: 'd@example.com' })];
    notFound(errorText(await c.callTool({ name: 'delete_response', arguments: { form_id: h.formId, response_id: a } })));
    expect(structured(await member.callTool({ name: 'delete_response', arguments: { form_id: id, response_id: a } }))).toMatchObject({ deleted: { id: a } });
    notFound(errorText(await c.callTool({ name: 'delete_response', arguments: { form_id: id, response_id: a } })));
    expect((await c.callTool({ name: 'delete_response', arguments: { response_id: b } })).isError).toBe(true);

    const other = await respond(h.other.formId, { q: 'theirs' });
    expect(structured(await c.callTool({ name: 'delete_responses', arguments: { form_id: id, response_ids: [b, d, other] } }))).toMatchObject({ deleted: 2 });
    expect(await h.db.get(sql`SELECT id FROM submission WHERE id = ${other}`)).toBeDefined();
    notFound(errorText(await c.callTool({ name: 'delete_responses', arguments: { form_id: h.other.formId, response_ids: [other] } })));
    expect((await c.callTool({ name: 'delete_responses', arguments: { form_id: id, response_ids: [] } })).isError).toBe(true);
  });
});

describe('brand kit', () => {
  it('reads for every member; saves, applies and reverts for owners and admins only', async () => {
    const c = await owner();
    structured(await member.callTool({ name: 'get_brand_kit', arguments: {} }));
    forbidden(errorText(await member.callTool({ name: 'update_brand_kit', arguments: { kit: { primaryColor: '#111111' } } })));
    const saved = structured<{ kit: { primaryColor: string } }>(
      await c.callTool({ name: 'update_brand_kit', arguments: { kit: { primaryColor: '#123456', radius: 'round' } } }),
    );
    expect(saved.kit.primaryColor).toBe('#123456');
    expect(errorText(await c.callTool({ name: 'update_brand_kit', arguments: { kit: { radius: 'wobbly' } } }))).toMatch(/^VALIDATION_FAILED: .*\n- radius/);
    expect((await c.callTool({ name: 'update_brand_kit', arguments: { kit: 'red' } })).isError).toBe(true);
    // A brand kit refusal never sends the agent to the form guide.
    const refused = errorText(await c.callTool({ name: 'update_brand_kit', arguments: { kit: { radius: 'wobbly', logo: 'javascript:alert(1)' } } }));
    expect(refused).not.toContain('get_form_guide');

    const id = await newForm(c);
    forbidden(errorText(await member.callTool({ name: 'apply_brand_kit', arguments: { form_ids: [id] } })));
    expect(structured(await c.callTool({ name: 'apply_brand_kit', arguments: { form_ids: [id, h.other.formId] } }))).toMatchObject({ applied: [id] });
    const branded = await h.db.get<{ config: string }>(sql`SELECT config FROM form WHERE id = ${id}`);
    expect(JSON.parse(branded!.config).branding.primaryColor).toBe('#123456');
    forbidden(errorText(await member.callTool({ name: 'revert_brand_kit', arguments: { form_ids: [id] } })));
    expect(structured(await c.callTool({ name: 'revert_brand_kit', arguments: { form_ids: [id] } }))).toMatchObject({ reverted: [id] });
    expect((await c.callTool({ name: 'apply_brand_kit', arguments: { form_ids: [] } })).isError).toBe(true);
  });
});

describe('link page', () => {
  type View = {
    public_url: string | null;
    live: boolean;
    page: { enabled?: boolean; items?: unknown[]; socials?: { whatsapp?: string | null } } | null;
    forms: Array<{ id: string }>;
  };
  const stored = async () =>
    (await h.db.get<{ link_page: string | null }>(sql`SELECT link_page FROM account WHERE id = ${h.accountId}`))!.link_page;

  it('reads, writes and deletes the page for any member, with its public URL', async () => {
    const c = await owner();
    const empty = structured<View>(await member.callTool({ name: 'get_link_page', arguments: {} }));
    expect(empty).toMatchObject({ public_url: `${APP_URL}/acme`, live: false, page: null });
    expect(empty.forms.map((f) => f.id)).toContain(h.formId);

    const page = {
      enabled: true,
      bio: 'Forms and links',
      items: [
        { type: 'form', formId: h.formId },
        { type: 'link', label: 'Site', url: 'https://example.com' },
      ],
      socials: { whatsapp: '+57 300 123 4567' },
    };
    const saved = structured<View>(await member.callTool({ name: 'update_link_page', arguments: { page } }));
    expect(saved).toMatchObject({ live: true, public_url: `${APP_URL}/acme` });
    expect(saved.page!.socials!.whatsapp).toBe('+573001234567');
    expect(JSON.parse((await stored())!).socials.whatsapp).toBe('573001234567');

    // What get_link_page returns goes back unchanged, WhatsApp included.
    const read = structured<View>(await c.callTool({ name: 'get_link_page', arguments: {} }));
    expect(read.page!.items).toHaveLength(2);
    const again = structured<View>(await c.callTool({ name: 'update_link_page', arguments: { page: { ...read.page, enabled: false } } }));
    expect(again).toMatchObject({ live: false, page: { enabled: false, socials: { whatsapp: '+573001234567' } } });

    const gone = structured<View>(await c.callTool({ name: 'update_link_page', arguments: { page: null } }));
    expect(gone).toMatchObject({ page: null, live: false });
    expect(await stored()).toBeNull();
    expect(structured<View>(await member.callTool({ name: 'get_link_page', arguments: {} })).page).toBeNull();
  });

  it("answers NOT_FOUND for another workspace's form and writes nothing, and keeps each workspace's page apart", async () => {
    const c = await owner();
    structured(await c.callTool({ name: 'update_link_page', arguments: { page: { enabled: true, bio: 'ours' } } }));
    notFound(
      errorText(await c.callTool({ name: 'update_link_page', arguments: { page: { enabled: true, items: [{ type: 'form', formId: h.other.formId }] } } })),
    );
    expect(JSON.parse((await stored())!).bio).toBe('ours');
    const theirs = await h.connect(await h.otherKey());
    expect(structured<View>(await theirs.callTool({ name: 'get_link_page', arguments: {} })).page).toBeNull();
    expect(errorText(await c.callTool({ name: 'get_link_page', arguments: { workspace_id: h.other.accountId } }))).toMatch(/^WORKSPACE_MISMATCH/);
    expect(errorText(await c.callTool({ name: 'update_link_page', arguments: { page: { items: [{ type: 'link', label: 'x', url: 'javascript:alert(1)' }] } } }))).toMatch(
      /^VALIDATION_FAILED/,
    );
    expect((await c.callTool({ name: 'update_link_page', arguments: { page: { items: [{ type: 'button' }] } } })).isError).toBe(true);
  });

  it('takes the largest page the REST route takes, past the default body limit', async () => {
    const c = await owner();
    const page = {
      enabled: true,
      logo: `data:image/png;base64,${'A'.repeat(89_000)}`,
      items: Array.from({ length: 30 }, (_, i) => ({ type: 'link', label: `Link ${i}`, url: `https://example.com/${'a'.repeat(2_000)}` })),
    };
    expect(JSON.stringify(page).length).toBeGreaterThan(100 * 1024);
    const saved = structured<View>(await c.callTool({ name: 'update_link_page', arguments: { page } }));
    expect(saved.page!.items).toHaveLength(30);
  });

  it('opens both REST routes to an API key', async () => {
    const { key } = await h.key('member');
    const auth = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
    const put = await fetch(`${h.base}/v1/link-page`, { method: 'PUT', headers: auth, body: JSON.stringify({ page: { version: 1, enabled: true, bio: 'by key' } }) });
    expect(put.status).toBe(200);
    const get = await fetch(`${h.base}/v1/link-page`, { headers: auth });
    expect(get.status).toBe(200);
    expect(await get.json()).toMatchObject({ page: { bio: 'by key' }, live: true, publicUrl: `${APP_URL}/acme` });
  });
});

describe('notifications', () => {
  it('lists, edits and resets the workspace emails, for owners and admins only', async () => {
    const c = await owner();
    forbidden(errorText(await member.callTool({ name: 'list_notifications', arguments: {} })));
    const list = structured<{ settings: Array<{ emailKey: string }> }>(await c.callTool({ name: 'list_notifications', arguments: {} }));
    expect(list.settings.map((s) => s.emailKey)).toEqual(['submission_received', 'submission_confirmed']);
    const saved = structured<{ setting: { subject: string } }>(
      await c.callTool({ name: 'update_notification', arguments: { email_key: 'submission_received', subject: 'Lead: {{formName}}' } }),
    );
    expect(saved.setting.subject).toBe('Lead: {{formName}}');
    expect(saved).not.toHaveProperty('warnings');
    forbidden(errorText(await member.callTool({ name: 'update_notification', arguments: { email_key: 'submission_received', enabled: false } })));
    expect(
      errorText(await c.callTool({ name: 'update_notification', arguments: { email_key: 'submission_confirmed', recipients: ['a@example.com'] } })),
    ).toMatch(/^BAD_REQUEST: This email is addressed to the respondent/);
    expect((await c.callTool({ name: 'update_notification', arguments: { email_key: 'digest' } })).isError).toBe(true);
    const reset = structured<{ setting: { subject: string | null } }>(
      await c.callTool({ name: 'reset_notification', arguments: { email_key: 'submission_received' } }),
    );
    expect(reset.setting.subject).toBeNull();
    forbidden(errorText(await member.callTool({ name: 'reset_notification', arguments: { email_key: 'submission_received' } })));
  });

  it("edits and resets one form's override, never another workspace's", async () => {
    const c = await owner();
    const id = await newForm(c);
    forbidden(errorText(await member.callTool({ name: 'list_form_notifications', arguments: { form_id: id } })));
    structured(await c.callTool({ name: 'list_form_notifications', arguments: { form_id: id } }));
    notFound(errorText(await c.callTool({ name: 'list_form_notifications', arguments: { form_id: h.other.formId } })));
    const saved = structured<{ setting: { override: { subject: string } } }>(
      await c.callTool({ name: 'update_form_notification', arguments: { form_id: id, email_key: 'submission_received', subject: 'Form lead' } }),
    );
    expect(saved.setting.override.subject).toBe('Form lead');
    // An unknown token is saved as over REST, and the agent is told it stays literal.
    const odd = structured<{ warnings: string[]; setting: { override: { body: string } } }>(
      await c.callTool({
        name: 'update_form_notification',
        arguments: { form_id: id, email_key: 'submission_received', body: 'Hi {{ unknownToken }} from {{formName}}' },
      }),
    );
    expect(odd.setting.override.body).toBe('Hi {{ unknownToken }} from {{formName}}');
    expect(odd.warnings).toHaveLength(1);
    expect(odd.warnings[0]).toContain('{{unknownToken}}');
    expect(odd.warnings[0]).toContain('{{respondentName}}');
    expect(odd.warnings[0]).not.toContain('{{formName}} is');
    forbidden(errorText(await member.callTool({ name: 'update_form_notification', arguments: { form_id: id, email_key: 'submission_received', enabled: true } })));
    notFound(
      errorText(await c.callTool({ name: 'update_form_notification', arguments: { form_id: h.other.formId, email_key: 'submission_received', enabled: true } })),
    );
    expect((await c.callTool({ name: 'update_form_notification', arguments: { form_id: id, email_key: 'submission_received', enabled: 'yes' } })).isError).toBe(true);
    const reset = structured<{ setting: { override: unknown } }>(
      await c.callTool({ name: 'reset_form_notification', arguments: { form_id: id, email_key: 'submission_received' } }),
    );
    expect(reset.setting.override).toBeNull();
    forbidden(errorText(await member.callTool({ name: 'reset_form_notification', arguments: { form_id: id, email_key: 'submission_received' } })));
    notFound(errorText(await c.callTool({ name: 'reset_form_notification', arguments: { form_id: h.other.formId, email_key: 'submission_received' } })));
  });
});

describe('integrations, read only', () => {
  it('lists the connections, the webhooks of every form and the provider pickers, to every member', async () => {
    const c = await owner();
    const id = await newForm(c);
    structured(
      await c.callTool({
        name: 'set_destinations',
        arguments: { form_id: id, destinations: [{ type: 'webhook', enabled: true, settings: { url: 'https://example.com/hook', secret: 'shh-value' } }] },
      }),
    );
    const integrations = structured<{ providers: unknown[]; server_provided: string[] }>(await member.callTool({ name: 'list_integrations', arguments: {} }));
    expect(integrations.providers).toEqual([]);
    const hooks = structured<{ webhooks: Array<{ formId: string; url: string; hasSecret: boolean }> }>(
      await member.callTool({ name: 'list_webhooks', arguments: {} }),
    );
    expect(hooks.webhooks).toContainEqual(expect.objectContaining({ formId: id, url: 'https://example.com/hook', hasSecret: true }));
    expect(JSON.stringify(hooks)).not.toContain('shh-value');
    expect(JSON.stringify(hooks)).not.toContain('Globex');
    expect(structured<{ enabled: boolean }>(await member.callTool({ name: 'list_hubspot_properties', arguments: {} })).enabled).toBe(false);
    expect(structured<{ enabled: boolean }>(await member.callTool({ name: 'list_calendly_event_types', arguments: {} })).enabled).toBe(false);
    expect((await c.callTool({ name: 'list_webhooks', arguments: { workspace_id: 3 } })).isError).toBe(true);
  });
});

describe('one tool call, one API-key call', () => {
  it('counts a tool that reads before it writes once against the key budget, as one REST call', async () => {
    const limiter = h.app.get<RateLimiter>(API_KEY_RATE_LIMITER, { strict: false });
    const take = vi.spyOn(limiter, 'take');
    try {
      const c = await owner();
      const spent = async (name: string, args: Record<string, unknown>) => {
        take.mockClear();
        await c.callTool({ name, arguments: args });
        return take.mock.calls.length;
      };
      const formId = await newForm(c);
      const [a, b] = [await respond(formId, { email: 'a@example.com' }), await respond(formId, { email: 'b@example.com' })];
      const folder = structured<{ folder: { id: string } }>(
        await c.callTool({ name: 'create_folder', arguments: { name: `F ${randomUUID().slice(0, 6)}` } }),
      ).folder;
      expect(await spent('get_response_file', { form_id: formId, response_id: a, step_key: 'email' })).toBe(1);
      expect(await spent('delete_response', { form_id: formId, response_id: a })).toBe(1);
      expect(await spent('delete_folder', { folder_id: folder.id })).toBe(1);
      // A later call is resolved, and counted, again.
      expect(await spent('get_response', { form_id: formId, response_id: b })).toBe(1);
      expect(await spent('delete_form', { form_id: formId })).toBe(1);
    } finally {
      take.mockRestore();
    }
  });
});

describe('identity', () => {
  it('reads the member page and the workspace link code, for every member', async () => {
    const c = await owner();
    const me = structured<{ handle: string | null; profile: unknown }>(await c.callTool({ name: 'get_my_profile', arguments: {} }));
    expect(me.profile).toBeNull();
    structured(await member.callTool({ name: 'get_my_profile', arguments: {} }));
    const code = structured<{ short_code: string; can_claim: boolean }>(await member.callTool({ name: 'get_workspace_link_code', arguments: {} }));
    expect(code.short_code).toBeTruthy();
    expect(errorText(await c.callTool({ name: 'get_workspace_link_code', arguments: { workspace_id: h.other.accountId } }))).toMatch(/^WORKSPACE_MISMATCH/);
  });
});
