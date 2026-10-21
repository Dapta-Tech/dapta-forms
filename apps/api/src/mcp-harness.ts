import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createDb, insertApiKey, migrate, seed, sql, type Db } from '@quill/db';
import { loadServerEnv } from '@quill/config/env';
import { AppModule } from './app.module';
import { generateApiKey } from './api-keys';
import { configureCors } from './cors';
import { configureDeprecatedHosts } from './deprecated-hosts';
import { McpController } from './mcp.controller';

/**
 * A real API for the MCP specs: the whole `AppModule` (so every `@Inject` and
 * every handler the tools run through is the app's own) on a throwaway SQLite
 * file, listening on a random port, driven over HTTP with the official MCP
 * client.
 */
export interface Harness {
  base: string;
  url: string;
  db: Db;
  audit: string[];
  /** The lines the deprecated-hosts middleware logged (API_DEPRECATED_HOSTS). */
  deprecatedHostLog: string[];
  accountId: string;
  ownerId: string;
  /** The seeded "Lead Qualifier" form. */
  formId: string;
  /** A second workspace with a form of its own, for isolation checks. */
  other: { accountId: string; formId: string };
  /** A live API key for a member of the seeded workspace with `role` (a new member unless it is the owner). */
  key(role?: 'owner' | 'admin' | 'member'): Promise<{ key: string; memberId: string }>;
  otherKey(): Promise<string>;
  connect(token?: string, headers?: Record<string, string>): Promise<Client>;
  post(body: unknown, headers?: Record<string, string>, path?: string): Promise<Response>;
  close(): Promise<void>;
}

const ENV_KEYS = [
  'CORS_ORIGINS',
  'DATABASE_URL',
  'NODE_ENV',
  'OUTBOX_WORKER_ENABLED',
  'PUBLIC_APP_URL',
  'AUTH_PROVIDER',
  'SEED_DEMO_FORM',
  'ONBOARDING_WIZARD',
  'MCP_ENABLED',
  'MCP_ALLOWED_ORIGINS',
  'MCP_ALLOWED_HOSTS',
  'MCP_RATE_LIMIT_CAPACITY',
  'MCP_RATE_LIMIT_REFILL_PER_SEC',
  'MCP_WRITE_RATE_LIMIT_CAPACITY',
  'MCP_WRITE_RATE_LIMIT_REFILL_PER_SEC',
  'MCP_TOOL_TIMEOUT_MS',
  'RATE_LIMIT_CAPACITY',
  'RATE_LIMIT_REFILL_PER_SEC',
  'API_DEPRECATED_HOSTS',
  'API_SUCCESSOR_URL',
  'API_DEPRECATION_DATE',
  'API_SUNSET_DATE',
] as const;

export const APP_URL = 'https://forms.example.test';

export async function bootHarness(env: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'forms-mcp-spec-'));
  const url = `file:${join(dir, 'spec.db')}`;
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    DATABASE_URL: url,
    NODE_ENV: 'test',
    OUTBOX_WORKER_ENABLED: 'false',
    PUBLIC_APP_URL: APP_URL,
    AUTH_PROVIDER: 'local',
    SEED_DEMO_FORM: 'false',
    ONBOARDING_WIZARD: 'false',
    ...env,
  });

  const db = await createDb(url);
  await migrate(db);
  await seed(db);
  const accountId = (await db.get<{ id: string }>(sql`SELECT id FROM account WHERE code = 'acme'`))!.id;
  const ownerId = (await db.get<{ id: string }>(sql`SELECT id FROM member WHERE account_id = ${accountId} AND role = 'owner'`))!.id;
  const formId = (await db.get<{ id: string }>(sql`SELECT id FROM form WHERE account_id = ${accountId} AND slug = 'lead-qualifier'`))!.id;
  const other = await seedOtherTenant(db);

  const app = await NestFactory.create(AppModule, { logger: false });
  // The same wiring main.ts applies, in the same order, so the specs see the
  // real policy: the deprecated-hosts middleware, then CORS.
  const deprecatedHostLog: string[] = [];
  configureDeprecatedHosts(app, loadServerEnv(), (line) => deprecatedHostLog.push(line));
  configureCors(app, loadServerEnv());
  await app.listen(0, '127.0.0.1');
  // Providers read the environment while the app is built; put it back at once
  // so harnesses booted side by side do not leak settings into each other.
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  const audit: string[] = [];
  app.get(McpController).server.auditSink = (line) => audit.push(line);
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

  const mint = async (account: string, memberId: string): Promise<string> => {
    const minted = generateApiKey();
    const res = await insertApiKey(db, {
      accountId: account,
      memberId,
      name: 'spec',
      keyHash: minted.keyHash,
      prefix: minted.prefix,
      last4: minted.last4,
    });
    if (!res.ok) throw new Error(`could not mint a key: ${res.reason}`);
    return minted.key;
  };

  const clients: Client[] = [];
  return {
    base,
    url: `${base}/mcp`,
    db,
    audit,
    deprecatedHostLog,
    accountId,
    ownerId,
    formId,
    other,
    async key(role = 'owner') {
      let memberId = ownerId;
      if (role !== 'owner') {
        memberId = randomUUID();
        await db.run(
          sql`INSERT INTO member (id, account_id, handle, display_name, email, role, status, created_at)
              VALUES (${memberId}, ${accountId}, ${`m-${memberId.slice(0, 8)}`}, ${'Spec Member'},
                ${`${memberId.slice(0, 8)}@example.com`}, ${role}, ${'active'}, ${Date.now()})`,
        );
      }
      return { key: await mint(accountId, memberId), memberId };
    },
    otherKey: async () => {
      const m = (await db.get<{ id: string }>(sql`SELECT id FROM member WHERE account_id = ${other.accountId}`))!;
      return mint(other.accountId, m.id);
    },
    async connect(token, headers = {}) {
      const client = new Client({ name: 'spec-client', version: '1.0.0' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
          requestInit: { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers } },
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
      await app.close();
      await db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A second workspace with an owner and one form. */
async function seedOtherTenant(db: Db) {
  const now = Date.now();
  const accountId = randomUUID();
  const formId = randomUUID();
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at, onboarding_completed_at) VALUES (${accountId}, 'globex', 'Globex', ${now}, ${now})`,
  );
  await db.run(
    sql`INSERT INTO member (id, account_id, handle, display_name, email, role, status, created_at)
        VALUES (${randomUUID()}, ${accountId}, 'bo', 'Bo Other', 'bo@globex.test', 'owner', 'active', ${now})`,
  );
  await db.run(
    sql`INSERT INTO form (id, account_id, name, slug, config, created_at, updated_at)
        VALUES (${formId}, ${accountId}, 'Globex Secret Survey', 'secret-survey',
          ${JSON.stringify({ version: 1, steps: [{ key: 'q', type: 'text', question: 'Globex only?' }] })}, ${now}, ${now})`,
  );
  return { accountId, formId };
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
