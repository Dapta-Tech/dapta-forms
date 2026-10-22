/**
 * MCP usage reporting: one `$mcp_tool_call` per tool call, enqueued under the
 * vendor's own event name (no `forms_` prefix), about the member's email, with
 * nothing from the call's arguments, and nothing at all without a key.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, listOutbox, migrate, sql, type Db } from '@quill/db';
import type { McpToolCallEvent } from '@quill/mcp';
import { AnalyticsEffects, type AnalyticsEventPayload } from './analytics-effects';
import { MCP_TOOL_CALL_EVENT, McpUsageReporter } from './mcp-usage';

const KEY = 'phc_test_write_key';
const ACCOUNT = 'acct-usage';
const MEMBER = 'member-usage';

let db: Db;

const envWith = (key: string | undefined) => ({ PRODUCT_ANALYTICS_KEY: key }) as never;

function event(overrides: Partial<McpToolCallEvent> = {}): McpToolCallEvent {
  return {
    tool: 'update_form',
    ok: true,
    errorCode: null,
    durationMs: 42,
    protocolVersion: '2025-06-18',
    client: { name: 'Claude', version: '1.2.3', userAgent: 'claude-code/2.1.0', vendor: 'anthropic' },
    credentialType: 'api_key',
    accountId: ACCOUNT,
    memberId: MEMBER,
    personId: null,
    staff: false,
    ...overrides,
  };
}

async function payloads(): Promise<AnalyticsEventPayload[]> {
  const rows = await listOutbox(db, { kind: 'analytics' });
  return rows.map((r) => JSON.parse(String(r.payload)) as AnalyticsEventPayload);
}

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  const now = Date.now();
  await db.run(sql`INSERT INTO account (id, code, name, created_at) VALUES (${ACCOUNT}, ${'usage'}, ${'Secret Workspace'}, ${now})`);
  await db.run(
    sql`INSERT INTO member (id, account_id, handle, display_name, email, role, status, created_at)
        VALUES (${MEMBER}, ${ACCOUNT}, ${'ada'}, ${'Ada'}, ${'ada@example.com'}, ${'owner'}, ${'active'}, ${now})`,
  );
});

afterEach(() => {
  db.close?.();
});

describe('AnalyticsEffects.captureRaw', () => {
  it('keeps a $mcp_ name as given', async () => {
    const effects = new AnalyticsEffects(db, envWith(KEY));
    await effects.captureRaw('$mcp_tool_call', { distinctId: 'a@b.com', accountId: ACCOUNT });
    expect((await payloads()).map((p) => p.event)).toEqual(['$mcp_tool_call']);
  });

  it('refuses any other name, so it cannot skip the prefix', async () => {
    const effects = new AnalyticsEffects(db, envWith(KEY));
    await effects.captureRaw('form_published', { distinctId: 'a@b.com', accountId: ACCOUNT });
    await effects.captureRaw('$pageview', { distinctId: 'a@b.com', accountId: ACCOUNT });
    expect(await payloads()).toHaveLength(0);
  });

  it('enqueues nothing without a key', async () => {
    const effects = new AnalyticsEffects(db, envWith(undefined));
    await effects.captureRaw('$mcp_tool_call', { distinctId: 'a@b.com', accountId: ACCOUNT });
    expect(await payloads()).toHaveLength(0);
  });
});

describe('McpUsageReporter', () => {
  it('enqueues one $mcp_tool_call in the MCP analytics vocabulary, about the member', async () => {
    const reporter = new McpUsageReporter(db, new AnalyticsEffects(db, envWith(KEY)), [], () => 1_700_000_000_000);
    await reporter.report(event());
    const [p, ...rest] = await payloads();
    expect(rest).toHaveLength(0);
    expect(p).toMatchObject({ event: MCP_TOOL_CALL_EVENT, distinctId: 'ada@example.com', accountId: ACCOUNT, timestamp: 1_700_000_000_000 });
    expect(p!.properties).toEqual({
      $mcp_tool_name: 'update_form',
      $mcp_resource_name: 'update_form',
      $mcp_is_error: false,
      $mcp_duration_ms: 42,
      $mcp_protocol_version: '2025-06-18',
      $mcp_client_name: 'Claude',
      $mcp_client_version: '1.2.3',
      $mcp_client_user_agent: 'claude-code/2.1.0',
      $mcp_vendor_client: 'anthropic',
      $mcp_server_name: 'dForms',
      $mcp_server_version: expect.any(String),
      $mcp_source: 'posthog_mcp_analytics',
      product: 'forms',
      credential_type: 'api_key',
      staff_access: false,
    });
    // No workspace name ever travels.
    expect(JSON.stringify(p)).not.toContain('Secret Workspace');
  });

  it('reports a failure by its code, lowercased', async () => {
    const reporter = new McpUsageReporter(db, new AnalyticsEffects(db, envWith(KEY)), []);
    await reporter.report(event({ ok: false, errorCode: 'RATE_LIMITED' }));
    const [p] = await payloads();
    expect(p!.properties).toMatchObject({ $mcp_is_error: true, $mcp_error_type: 'rate_limited' });
  });

  it('flags staff: through a staff grant, or by the email domain', async () => {
    const reporter = new McpUsageReporter(db, new AnalyticsEffects(db, envWith(KEY)), ['example.com']);
    await reporter.report(event());
    const domain = new McpUsageReporter(db, new AnalyticsEffects(db, envWith(KEY)), ['other.test']);
    await domain.report(event({ staff: true, credentialType: 'oauth' }));
    await domain.report(event());
    expect((await payloads()).map((p) => p.properties?.staff_access)).toEqual([true, true, false]);
  });

  it('sends a connection with no workspace under the person, without a person profile', async () => {
    const reporter = new McpUsageReporter(db, new AnalyticsEffects(db, envWith(KEY)), []);
    await reporter.report(event({ tool: 'whoami', credentialType: 'oauth', accountId: null, memberId: null, personId: 'person-1' }));
    const [p] = await payloads();
    expect(p).toMatchObject({ distinctId: 'person-1', accountId: null });
    expect(p!.properties).toMatchObject({ $process_person_profile: false, credential_type: 'oauth' });
  });

  it('reads the email once per member for a few minutes', async () => {
    let now = 1_000;
    const reporter = new McpUsageReporter(db, new AnalyticsEffects(db, envWith(KEY)), [], () => now);
    await reporter.report(event());
    await db.run(sql`UPDATE member SET email = ${'new@example.com'} WHERE id = ${MEMBER}`);
    await reporter.report(event());
    now += 6 * 60_000;
    await reporter.report(event());
    expect((await payloads()).map((p) => p.distinctId)).toEqual(['ada@example.com', 'ada@example.com', 'new@example.com']);
  });

  it('drops a member with no email instead of inventing an id', async () => {
    await db.run(sql`UPDATE member SET email = NULL WHERE id = ${MEMBER}`);
    const reporter = new McpUsageReporter(db, new AnalyticsEffects(db, envWith(KEY)), []);
    await reporter.report(event());
    expect(await payloads()).toHaveLength(0);
  });

  it('does nothing without a key, not even the member lookup', async () => {
    const reporter = new McpUsageReporter(db, new AnalyticsEffects(db, envWith(undefined)), []);
    db.close?.();
    // A closed database would throw on any query: none is made.
    await expect(reporter.report(event())).resolves.toBeUndefined();
    db = await createDb('file::memory:');
  });

  it('never rejects when analytics fails', async () => {
    const broken = {
      enabled: true,
      captureRaw: () => Promise.reject(new Error('vendor down')),
    } as unknown as AnalyticsEffects;
    const reporter = new McpUsageReporter(db, broken, []);
    await expect(reporter.report(event())).resolves.toBeUndefined();
  });
});
