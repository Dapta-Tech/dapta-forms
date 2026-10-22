import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import {
  BackendError,
  type FormAnalytics,
  type FormDetail,
  type FormsBackend,
  type McpCaller,
  type ResponsesPage,
} from '../backend';
import { McpDoor, type McpDoorOptions } from '../door';
import type { ApiParityBackend } from '../parity-backend';
import { parityFakes } from './parity-fakes';
import { unlimited, type RateLimiter } from '../rate-limit';
import { FormsMcpServer, type FormsMcpServerOptions } from '../server';

/**
 * The package on a real HTTP socket, with an in-memory backend: the door, the
 * SDK handler and the tools exactly as a host wires them, driven by the
 * official MCP client. The host app (forms-api) has its own end-to-end specs
 * over its real handlers; these pin the package's behaviour on its own.
 */

export const NOW = Date.UTC(2026, 9, 18, 12, 0, 0);

export function form(over: Partial<FormDetail> = {}): FormDetail {
  return {
    id: 'form-1',
    name: 'Lead form',
    slug: 'lead-form',
    folderId: null,
    hasDraft: false,
    createdAt: NOW - 86_400_000,
    updatedAt: NOW,
    publicUrl: 'https://forms.example.test/acme/f/lead-form',
    editorUrl: 'https://forms.example.test/admin/forms/form-1/edit',
    config: { version: 1, steps: [{ key: 'email', type: 'email', question: 'Email?' }] },
    draftConfig: null,
    publishedAt: null,
    previousPublishedAt: null,
    ...over,
  };
}

export function analytics(over: Partial<FormAnalytics> = {}): FormAnalytics {
  return {
    views: 10,
    starts: 5,
    submissions: 3,
    completionRate: 60,
    timeToComplete: 42,
    partialSubmits: 1,
    bookings: 0,
    dropoffMode: 'viewed',
    dropoff: [
      { stepIndex: -1, key: null, question: '', isCover: true, views: 10, dropoff: 4, dropoffPercent: 40 },
      { stepIndex: 0, key: 'email', question: 'Email?', isCover: false, views: 6, dropoff: 3, dropoffPercent: 50 },
    ],
    trends: [{ t: NOW, views: 10, starts: 5, submissions: 3, completionRate: 60, timeToComplete: 42 }],
    range: { from: null, to: null, timeZone: 'UTC' },
    ...over,
  };
}

/** A backend that records every call and answers from overridable functions. */
export function fakeBackend(over: Partial<FormsBackend> = {}) {
  const calls: Array<{ method: string; caller: McpCaller; args: unknown[] }> = [];
  const record =
    <A extends unknown[], R>(method: string, fn: (caller: McpCaller, ...args: A) => Promise<R>) =>
    (caller: McpCaller, ...args: A): Promise<R> => {
      calls.push({ method, caller, args });
      return fn(caller, ...args);
    };
  const page: ResponsesPage = { items: [], total: 0, limit: 20, offset: 0 };
  const base: FormsBackend = {
    whoami: async (c) => ({
      accountId: c.accountId,
      accountName: 'Acme',
      accountCode: 'acme',
      memberId: c.memberId,
      displayName: 'Ada',
      email: 'ada@example.test',
      role: c.role,
      status: 'active',
      timezone: 'UTC',
      locale: 'en',
    }),
    listForms: async () => [form(), form({ id: 'form-2', name: 'Quiz', slug: 'quiz', hasDraft: true })],
    getForm: async (_c, id) => {
      if (id !== 'form-1') throw new BackendError(404, 'NOT_FOUND', 'Not found.');
      return form();
    },
    createForm: async (_c, input) => form({ id: 'form-new', name: input.name }),
    updateForm: async (_c, id) => form({ id, hasDraft: true, updatedAt: NOW + 1 }),
    publishForm: async (_c, id) => {
      const at = Date.now();
      return form({ id, publishedAt: at, updatedAt: at, previousPublishedAt: NOW - 5 });
    },
    revertForm: async (_c, id) => form({ id }),
    discardDraft: async (_c, id) => form({ id, updatedAt: NOW + 3 }),
    listResponses: async () => page,
    formAnalytics: async () => analytics(),
    ...parityFakes(),
  };
  const merged = { ...base, ...over };
  const parity = Object.fromEntries(
    (Object.keys(parityFakes()) as Array<keyof ApiParityBackend>).map((method) => [
      method,
      record(method, merged[method] as (caller: McpCaller, ...args: unknown[]) => Promise<unknown>),
    ]),
  ) as unknown as ApiParityBackend;
  const backend: FormsBackend = {
    ...parity,
    whoami: record('whoami', merged.whoami),
    listForms: record('listForms', merged.listForms),
    getForm: record('getForm', merged.getForm),
    createForm: record('createForm', merged.createForm),
    updateForm: record('updateForm', merged.updateForm),
    publishForm: record('publishForm', merged.publishForm),
    revertForm: record('revertForm', merged.revertForm),
    discardDraft: record('discardDraft', merged.discardDraft),
    listResponses: record('listResponses', merged.listResponses),
    formAnalytics: record('formAnalytics', merged.formAnalytics),
  };
  return { backend, calls };
}

/** A limiter that allows `n` takes per key, then refuses. */
export function capped(n: number): RateLimiter {
  const used = new Map<string, number>();
  return {
    take(key) {
      const count = (used.get(key) ?? 0) + 1;
      used.set(key, count);
      return count <= n ? { allowed: true, retryAfterMs: 0 } : { allowed: false, retryAfterMs: 2500 };
    },
  };
}

/** Test credentials are minted per run, never written down: secret scanners read test files too. */
export function token(label: string): string {
  return `dforms_${label}_${Math.random().toString(36).slice(2, 10)}`;
}

export interface Harness {
  url: string;
  audit: string[];
  server: FormsMcpServer;
  calls: ReturnType<typeof fakeBackend>['calls'];
  /** A credential the authenticator accepts, acting as `role`. */
  key(role?: string): string;
  connect(token?: string, headers?: Record<string, string>): Promise<Client>;
  post(body: unknown, headers?: Record<string, string>, path?: string): Promise<Response>;
  close(): Promise<void>;
}

export interface HarnessOptions {
  backend?: Partial<FormsBackend>;
  door?: Partial<Omit<McpDoorOptions, 'server' | 'authenticate'>>;
  toolTimeoutMs?: number;
  writeLimiter?: RateLimiter;
  onInternalError?: FormsMcpServerOptions['onInternalError'];
  onTransportError?: FormsMcpServerOptions['onTransportError'];
  onToolCall?: FormsMcpServerOptions['onToolCall'];
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function bootHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const { backend, calls } = fakeBackend(opts.backend);
  const keys = new Map<string, McpCaller>();
  const server = new FormsMcpServer({
    backend,
    toolTimeoutMs: opts.toolTimeoutMs ?? 5_000,
    writeLimiter: opts.writeLimiter ?? unlimited,
    onInternalError: opts.onInternalError,
    onTransportError: opts.onTransportError,
    onToolCall: opts.onToolCall,
  });
  const audit: string[] = [];
  server.auditSink = (line) => audit.push(line);
  const door = new McpDoor({
    server,
    enabled: true,
    allowedOrigins: [],
    allowedHosts: [],
    keyLimiter: unlimited,
    ipLimiter: unlimited,
    ...opts.door,
    authenticate: async (t) => keys.get(t) ?? null,
  });
  let seq = 0;
  const http: Server = createServer((req, res) => {
    void (async () => {
      const body = /json/i.test(req.headers['content-type'] ?? '') ? await readJson(req) : undefined;
      Object.assign(req, { body });
      await door.handle(req as never, res, { ip: '203.0.113.7', requestId: `req-${++seq}` });
    })().catch((err: unknown) => {
      // Plain text, so a client never reads the error message as HTML.
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(String(err));
    });
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const clients: Client[] = [];
  return {
    url: `${base}/mcp`,
    audit,
    server,
    calls,
    key(role = 'owner') {
      const t = token(role);
      keys.set(t, {
        accountId: 'acct-1',
        workspaceName: 'Acme',
        memberId: `member-${role}`,
        role,
        credentialId: `key-${keys.size + 1}`,
        label: t.slice(0, 12),
        context: { secret: t },
      });
      return t;
    },
    async connect(t, headers = {}) {
      const client = new Client({ name: 'spec-client', version: '1.0.0' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
          requestInit: { headers: { ...(t ? { Authorization: `Bearer ${t}` } : {}), ...headers } },
        }),
      );
      clients.push(client);
      return client;
    },
    post: (body, headers = {}, path = '/mcp') =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
        body: JSON.stringify(body),
      }),
    async close() {
      await Promise.all(clients.map((c) => c.close().catch(() => undefined)));
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

export const initialize = (version: string) => ({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: version, capabilities: {}, clientInfo: { name: 'raw', version: '1' } },
});

/** The structured result of a successful tool call. */
export function structured<T = Record<string, unknown>>(result: unknown): T {
  const r = result as { isError?: boolean; structuredContent?: T; content?: { text?: string }[] };
  if (r.isError) throw new Error(`tool error: ${r.content?.[0]?.text}`);
  return r.structuredContent as T;
}

export function errorText(result: unknown): string {
  const r = result as { isError?: boolean; content?: { text?: string }[] };
  if (!r.isError) throw new Error('expected a tool error');
  return r.content?.[0]?.text ?? '';
}
