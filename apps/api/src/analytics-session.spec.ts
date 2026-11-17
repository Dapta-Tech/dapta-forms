/**
 * The browser's analytics session id, forwarded by the web app, rides along on
 * every server-side event the request enqueues, so the vendor can link a
 * signup or a form creation to the recording it happened in. Requests without
 * it (MCP, API keys, the public form path) stay exactly as they were.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createDb, migrate, listOutbox, type Db } from '@quill/db';
import { AnalyticsEffects } from './analytics-effects';
import {
  ANALYTICS_SESSION_HEADER,
  analyticsSessionMiddleware,
  currentAnalyticsSessionId,
  parseAnalyticsSessionId,
  runWithAnalyticsSession,
} from './analytics-session';

const SESSION = '019a5c3e-7d2b-7c41-9b1e-3f6a2d8c4e10';
const env = { PRODUCT_ANALYTICS_KEY: 'phc_test', PRODUCT_ANALYTICS_HOST: 'https://a.example.com' } as never;

let db: Db;
beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
});
afterEach(() => {
  db.close?.();
});

async function properties(): Promise<Record<string, unknown> | undefined> {
  const row = (await listOutbox(db, { kind: 'analytics' }))[0]!;
  return JSON.parse(String(row.payload)).properties;
}

describe('parseAnalyticsSessionId', () => {
  it('accepts a vendor session id', () => {
    expect(parseAnalyticsSessionId(SESSION)).toBe(SESSION);
    expect(parseAnalyticsSessionId([SESSION, 'x'])).toBe(SESSION);
  });

  it('drops anything that is not a UUID', () => {
    expect(parseAnalyticsSessionId(undefined)).toBeNull();
    expect(parseAnalyticsSessionId('')).toBeNull();
    expect(parseAnalyticsSessionId('not-a-session')).toBeNull();
    expect(parseAnalyticsSessionId(`${SESSION}<script>`)).toBeNull();
  });
});

describe('analyticsSessionMiddleware', () => {
  function run(headers: Record<string, string>): string | null {
    let seen: string | null = 'unset';
    analyticsSessionMiddleware()(
      { headers } as unknown as IncomingMessage,
      {} as ServerResponse,
      () => {
        seen = currentAnalyticsSessionId();
      },
    );
    return seen;
  }

  it('scopes the rest of the request to the forwarded session', () => {
    expect(run({ [ANALYTICS_SESSION_HEADER]: SESSION })).toBe(SESSION);
  });

  it('leaves the session empty without the header or with a malformed one', () => {
    expect(run({})).toBeNull();
    expect(run({ [ANALYTICS_SESSION_HEADER]: 'junk' })).toBeNull();
  });

  it('has no session outside a request', () => {
    expect(currentAnalyticsSessionId()).toBeNull();
  });
});

describe('AnalyticsEffects with a forwarded session', () => {
  it('stamps $session_id on an event enqueued inside the request', async () => {
    const effects = new AnalyticsEffects(db, env);
    await runWithAnalyticsSession(SESSION, () =>
      effects.capture('form_created', {
        distinctId: 'a@b.com',
        accountId: 'acc_1',
        properties: { form_id: 'f_1' },
      }),
    );
    expect(await properties()).toEqual({ form_id: 'f_1', $session_id: SESSION });
  });

  it('stamps it even when the event has no other properties', async () => {
    const effects = new AnalyticsEffects(db, env);
    await runWithAnalyticsSession(SESSION, () =>
      effects.capture('signup_completed', { distinctId: 'a@b.com', accountId: 'acc_1' }),
    );
    expect(await properties()).toEqual({ $session_id: SESSION });
  });

  it('keeps a $session_id the call site set itself', async () => {
    const effects = new AnalyticsEffects(db, env);
    await runWithAnalyticsSession(SESSION, () =>
      effects.capture('form_created', {
        distinctId: 'a@b.com',
        accountId: 'acc_1',
        properties: { $session_id: 'explicit' },
      }),
    );
    expect(await properties()).toEqual({ $session_id: 'explicit' });
  });

  it('adds nothing when the request carried no session (MCP, API keys, public path)', async () => {
    const effects = new AnalyticsEffects(db, env);
    await runWithAnalyticsSession(null, () =>
      effects.capture('form_created', {
        distinctId: 'a@b.com',
        accountId: 'acc_1',
        properties: { form_id: 'f_1' },
      }),
    );
    expect(await properties()).toEqual({ form_id: 'f_1' });
  });
});
