/**
 * End-to-end check of the MCP endpoint under the PRODUCTION runtime.
 *
 * Boots the API exactly like the Dockerfile CMD (tsx + tsconfig.runtime.json,
 * which emits no decorator metadata) on a throwaway SQLite file, then plays a
 * whole session over HTTP with the official MCP client: an agent builds a form,
 * a respondent answers it through the public API, and the agent edits,
 * publishes, reads the responses and the funnel. Unit specs build the app in
 * process and cannot see a missing `@Inject` under tsx; this can.
 *
 *   pnpm run build:packages                       # workspace packages, once
 *   cd apps/api && pnpm e2e:mcp                   # port 4794, or: pnpm e2e:mcp 4800
 *
 * It runs under tsx itself because the workspace packages ship extensionless ESM.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createDb, insertApiKey, migrate, seed, sql } from '@quill/db';
import { generateApiKey } from '../src/api-keys.ts';

const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] ?? 4794);
const appUrl = 'https://forms.example.test';
const dir = mkdtempSync(join(tmpdir(), 'forms-mcp-e2e-'));
const databaseUrl = `file:${join(dir, 'e2e.db')}`;
const say = (m) => console.log(`[e2e] ${m}`);
const fail = (m) => {
  throw new Error(`E2E FAILED: ${m}`);
};

const db = await createDb(databaseUrl);
await migrate(db);
await seed(db);
const accountId = (await db.get(sql`SELECT id FROM account WHERE code = 'acme'`)).id;
const ownerId = (await db.get(sql`SELECT id FROM member WHERE account_id = ${accountId} AND role = 'owner'`)).id;
const minted = generateApiKey();
const inserted = await insertApiKey(db, {
  accountId,
  memberId: ownerId,
  name: 'e2e',
  keyHash: minted.keyHash,
  prefix: minted.prefix,
  last4: minted.last4,
});
if (!inserted.ok) fail('could not mint a key');
const key = minted.key;
await db.close();

const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', '--tsconfig', 'tsconfig.runtime.json', 'src/main.ts'], {
  cwd: apiDir,
  env: {
    ...process.env,
    API_PORT: String(port),
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'development',
    AUTH_PROVIDER: 'local',
    OUTBOX_WORKER_ENABLED: 'false',
    SEED_DEMO_FORM: 'false',
    PUBLIC_APP_URL: appUrl,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const logs = [];
child.stdout.on('data', (d) => logs.push(String(d)));
child.stderr.on('data', (d) => logs.push(String(d)));
say(`started API pid ${child.pid} on :${port} (tsx + tsconfig.runtime.json)`);

let ok = false;
try {
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i += 1) {
    if (i > 150) fail(`API did not come up:\n${logs.join('')}`);
    try {
      if ((await fetch(`${base}/health`)).ok) break;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  say('API healthy');

  const rpc = (body, headers = {}) =>
    fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify(body),
    });
  const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'legacy', version: '1' } } };

  // 1. The door: anonymous is refused, a legacy (2025-era) handshake with a key is served statelessly.
  const anon = await rpc(initialize);
  if (anon.status !== 401 || !anon.headers.get('www-authenticate')) fail(`anonymous initialize: ${anon.status}`);
  say(`anonymous initialize -> ${anon.status} (${anon.headers.get('www-authenticate')})`);
  const legacy = await rpc(initialize, { authorization: `Bearer ${key}` });
  const legacyText = await legacy.text();
  if (legacy.status !== 200 || !legacyText.includes('"dforms"')) fail(`legacy initialize: ${legacy.status} ${legacyText}`);
  say(`legacy initialize (2025-06-18) -> ${legacy.status}, no session id: ${legacy.headers.get('mcp-session-id') === null}`);

  // 2. The SDK client with the key: the whole agent session.
  const c = new Client({ name: 'e2e-agent', version: '1' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${key}` } } }));
  const tools = (await c.listTools()).tools;
  say(`tools/list -> ${tools.length} tools: ${tools.map((t) => `${t.name}${t.annotations?.destructiveHint ? '(destructive)' : t.annotations?.readOnlyHint ? '(read)' : '(write)'}`).join(', ')}`);
  if (tools.length !== 10) fail('expected 10 tools');
  if (tools.some((t) => !t.title || typeof t.annotations?.readOnlyHint !== 'boolean')) fail('a tool lacks its title or hints');

  const call = async (name, args = {}) => {
    const r = await c.callTool({ name, arguments: args });
    if (r.isError) fail(`${name}: ${r.content[0].text}`);
    return r.structuredContent;
  };
  const who = await call('whoami');
  say(`whoami -> workspace ${who.workspace.code}, ${who.member.role}, key ${who.key.prefix}`);
  const guide = await call('get_form_guide', { part: 'examples' });
  const quiz = guide.examples.find((e) => e.name === 'scored_quiz').config;
  say(`get_form_guide(examples) -> ${guide.examples.map((e) => e.name).join(', ')}`);

  const refused = await c.callTool({
    name: 'create_form',
    arguments: { name: 'Broken', config: { version: 1, steps: [{ key: 'q', type: 'text', question: '' }, { key: 'm', type: 'message', question: 'x', buttonText: 'Go' }] } },
  });
  if (!refused.isError || !refused.content[0].text.startsWith('VALIDATION_FAILED')) fail('a broken config was not refused with VALIDATION_FAILED');
  say(`create_form(broken) -> ${refused.content[0].text.split('\n').slice(0, 3).join(' | ')}`);

  const created = await call('create_form', { name: 'E2E plan quiz', config: quiz });
  say(`create_form -> ${created.form.id}, live at ${created.form.public_url}`);
  if (created.form.public_url !== `${appUrl}/acme/f/e2e-plan-quiz`) fail('unexpected public_url');

  // 3. A respondent answers through the public API, the way the form page does.
  const pub = (path, body) =>
    fetch(`${base}/v1/public/forms/acme/e2e-plan-quiz/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  for (const type of ['view', 'start']) {
    const res = await pub('events', { sessionId: 'e2e-respondent', type });
    if (res.status !== 202) fail(`public event ${type}: ${res.status}`);
  }
  const submitted = await pub('submissions', {
    sessionId: 'e2e-respondent',
    data: { team_size: 'small', budget: 650, firstname: 'Ada', lastname: 'Lovelace', email: 'ada@example.org' },
  });
  if (submitted.status !== 201) fail(`public submission: ${submitted.status} ${await submitted.text()}`);
  say('respondent submitted through /v1/public');

  // 4. Edit as a draft, publish, read back.
  const read = await call('get_form', { form_id: created.form.id });
  const edited = { ...read.config, steps: [...read.config.steps, { key: 'note', type: 'textarea', question: 'Anything else we should know?' }] };
  const draft = await call('update_form', { form_id: created.form.id, config: edited, expected_updated_at: read.updated_at });
  say(`update_form -> draft pending: ${draft.form.has_unpublished_draft}`);
  const stale = await c.callTool({ name: 'update_form', arguments: { form_id: created.form.id, config: edited, expected_updated_at: read.updated_at } });
  if (!stale.isError || !stale.content[0].text.startsWith('STALE')) fail('a stale update was not refused');
  say(`update_form(stale stamp) -> ${stale.content[0].text.slice(0, 70)}...`);
  const published = await call('publish_form', { form_id: created.form.id, expected_updated_at: draft.form.updated_at });
  say(`publish_form -> live at ${published.form.public_url}, revertible since ${published.previous_published_at}`);

  const responses = await call('list_responses', { form_id: created.form.id });
  const answers = responses.responses[0]?.respondent_supplied.answers ?? [];
  say(`list_responses -> ${responses.total} response(s), score ${responses.responses[0]?.score}, answers: ${answers.map((a) => `${a.question} = ${a.answer}`).join('; ')}`);
  if (responses.total !== 1 || !answers.some((a) => a.answer === 'Ada Lovelace')) fail('the response did not come back labelled');

  const funnel = await call('get_form_analytics', { form_id: created.form.id });
  say(`get_form_analytics -> views ${funnel.metrics.views.value}, starts ${funnel.metrics.starts.value}, submissions ${funnel.metrics.submissions.value}, completion ${funnel.metrics.completion_rate.value}%`);
  if (funnel.metrics.submissions.value !== 1 || funnel.metrics.completion_rate.value !== 100) fail('unexpected funnel');

  // 5. The key is revoked mid-session: the very next request is refused.
  const live = await createDb(databaseUrl);
  const via = await live.get(sql`SELECT created_via FROM form WHERE id = ${created.form.id}`);
  if (via.created_via !== 'mcp') fail(`created_via is ${via.created_via}`);
  say(`form.created_via -> ${via.created_via}`);
  await live.run(sql`UPDATE api_key SET revoked_at_ms = ${Date.now()} WHERE prefix = ${minted.prefix}`);
  await live.close();
  const afterRevoke = await rpc(initialize, { authorization: `Bearer ${key}` });
  if (afterRevoke.status !== 401) fail(`revoked key answered ${afterRevoke.status}`);
  say(`revoked key -> ${afterRevoke.status}`);

  await c.close().catch(() => undefined);
  const output = logs.join('');
  const audit = output.split('\n').filter((l) => l.includes('mcp.tool_call'));
  say(`${audit.length} audit lines on stdout; sample: ${audit.find((l) => l.includes('create_form')) ?? audit[0]}`);
  if (output.includes(key)) fail('the API key appeared in the server output');
  if (output.includes('ada@example.org')) fail('a respondent answer appeared in the server output');
  if (audit.length < 9) fail('missing audit lines');
  ok = true;
  say('PASS');
} finally {
  child.kill('SIGTERM');
  rmSync(dir, { recursive: true, force: true });
}
process.exit(ok ? 0 : 1);
