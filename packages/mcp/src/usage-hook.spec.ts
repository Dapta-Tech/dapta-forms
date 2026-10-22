import { afterAll, describe, expect, it } from 'vitest';
import { bootHarness, type Harness, type HarnessOptions } from './__tests__/harness';
import { clientInfoOf } from './door';
import type { McpToolCallEvent } from './server';

const open: Harness[] = [];
async function boot(opts: HarnessOptions = {}) {
  const h = await bootHarness(opts);
  open.push(h);
  return h;
}
afterAll(async () => {
  await Promise.all(open.map((h) => h.close()));
});

describe('onToolCall', () => {
  it('fires once per tool call with the call facts and nothing from the arguments', async () => {
    const events: McpToolCallEvent[] = [];
    const h = await boot({ onToolCall: (e) => events.push(e) });
    const c = await h.connect(h.key(), { 'user-agent': 'claude-code/2.1.0' });
    await c.callTool({ name: 'get_form', arguments: { form_id: 'form-1' } });

    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e).toMatchObject({
      tool: 'get_form',
      ok: true,
      errorCode: null,
      credentialType: 'api_key',
      accountId: 'acct-1',
      memberId: 'member-owner',
      personId: null,
      staff: false,
    });
    expect(e.protocolVersion).toMatch(/^20\d\d-\d\d-\d\d$/);
    expect(typeof e.durationMs).toBe('number');
    expect(e.client.userAgent).toBe('claude-code/2.1.0');
    expect(e.client.vendor).toBe('anthropic');
    // The arguments never reach the hook, not even as a hash.
    expect(JSON.stringify(e)).not.toContain('form-1');
    expect(Object.keys(e)).not.toContain('argsHash');
  });

  it('reports a failure by its code only', async () => {
    const events: McpToolCallEvent[] = [];
    const h = await boot({ onToolCall: (e) => events.push(e) });
    const c = await h.connect(h.key());
    const res = await c.callTool({ name: 'get_form', arguments: { form_id: 'form-secret-name' } });
    expect(res.isError).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ tool: 'get_form', ok: false, errorCode: 'NOT_FOUND' });
    expect(JSON.stringify(events[0])).not.toContain('form-secret-name');
    expect(JSON.stringify(events[0])).not.toContain('Not found');
  });

  it('a hook that throws changes nothing about the result', async () => {
    const h = await boot({
      onToolCall: () => {
        throw new Error('analytics down');
      },
    });
    const c = await h.connect(h.key());
    const res = await c.callTool({ name: 'get_form', arguments: { form_id: 'form-1' } });
    expect(res.isError).toBeFalsy();
    expect(h.audit).toHaveLength(1);
  });

  it('a slow report never holds the tool result back', async () => {
    let started = 0;
    const h = await boot({
      onToolCall: () => {
        started++;
        // A capture that never settles: the hook hands it off and returns.
        void new Promise(() => undefined);
      },
    });
    const c = await h.connect(h.key());
    const res = await c.callTool({ name: 'get_form', arguments: { form_id: 'form-1' } });
    expect(res.isError).toBeFalsy();
    expect(started).toBe(1);
  });
});

describe('clientInfoOf', () => {
  const req = (body: unknown, headers: Record<string, string> = {}) => ({ headers, body, [Symbol.asyncIterator]: async function* () {} });

  it('reads clientInfo from an initialize', () => {
    expect(clientInfoOf(req({ method: 'initialize', params: { clientInfo: { name: 'Cursor', version: '1.7.0' } } }))).toEqual({
      name: 'Cursor',
      version: '1.7.0',
    });
  });

  it('reads the per-request envelope of a 2026-07-28 client', () => {
    const body = { method: 'tools/call', params: { name: 'whoami', _meta: { 'io.modelcontextprotocol/clientInfo': { name: 'claude-ai', version: '0.1.0' } } } };
    expect(clientInfoOf(req(body))).toEqual({ name: 'claude-ai', version: '0.1.0' });
  });

  it('trims labels, drops control characters and spots the vendor from headers', () => {
    const info = clientInfoOf(req({ params: { clientInfo: { name: `x\n${'a'.repeat(100)}`, version: 3 } } }, { 'user-agent': 'openai-mcp/1.0.0' }));
    expect(info.name).toBe(`x${'a'.repeat(63)}`);
    expect(info.version).toBeUndefined();
    expect(info.vendor).toBe('openai');
    expect(clientInfoOf(req(undefined, { 'x-anthropic-client': 'claude.ai' })).vendor).toBe('anthropic');
    expect(clientInfoOf(req(undefined))).toEqual({});
  });
});
