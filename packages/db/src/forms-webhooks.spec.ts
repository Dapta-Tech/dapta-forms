/**
 * The account-wide webhook inventory behind the integrations page.
 *
 * Two properties are load-bearing and both are asserted here rather than
 * reasoned about: the projection cannot carry a signing secret (there is no
 * field for one, so unlike the form endpoints there is no masking pass that
 * could be skipped), and it reads the stored array the way the DELIVERY path
 * reads it — loosely — so a webhook that would fail schema validation is still
 * reported instead of silently vanishing from the one screen meant to reveal it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { WEBHOOK_SECRET_MASK } from '@quill/types';
import { createDb, type Db } from './client';
import { migrate } from './migrate';
import { listAccountWebhooks } from './forms';

let db: Db;
let accountId: string;
let otherAccountId: string;

async function insertAccount(): Promise<string> {
  const id = randomUUID();
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at)
        VALUES (${id}, ${'t' + id.slice(0, 5)}, ${'Test'}, ${Date.now()})`,
  );
  return id;
}

async function insertForm(account: string, name: string, config: unknown): Promise<string> {
  const id = randomUUID();
  const now = Date.now();
  await db.run(
    sql`INSERT INTO form (id, account_id, name, slug, config, created_at, updated_at)
        VALUES (${id}, ${account}, ${name}, ${'f-' + id.slice(0, 6)}, ${JSON.stringify(config)}, ${now}, ${now})`,
  );
  return id;
}

const hook = (settings: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  type: 'webhook',
  enabled: true,
  settings,
  ...extra,
});

beforeEach(async () => {
  db = await createDb(process.env.DATABASE_URL ?? 'file::memory:');
  await migrate(db);
  await db.run(sql`DELETE FROM form`);
  await db.run(sql`DELETE FROM account`);
  accountId = await insertAccount();
  otherAccountId = await insertAccount();
});

afterEach(async () => {
  await db.run(sql`DELETE FROM form`);
  await db.run(sql`DELETE FROM account`);
  await db.close();
});

describe('listAccountWebhooks', () => {
  it('reports one entry per webhook, with the form that owns it', async () => {
    const formId = await insertForm(accountId, 'Lead qualifier', {
      version: 1,
      steps: [],
      destinations: [hook({ url: 'https://acme.io/hook' }, { id: 'w1', events: ['complete'] })],
    });

    const rows = await listAccountWebhooks(db, accountId);
    expect(rows).toEqual([
      {
        formId,
        formName: 'Lead qualifier',
        webhookId: 'w1',
        url: 'https://acme.io/hook',
        enabled: true,
        events: ['complete'],
        hasSecret: false,
      },
    ]);
  });

  it('reports BOTH webhooks of a form that stores two', async () => {
    // Several webhooks on one form is a legal configuration — only HubSpot is
    // capped — so collapsing them would make the inventory disagree with the
    // config it is reporting on.
    await insertForm(accountId, 'Two hooks', {
      version: 1,
      steps: [],
      destinations: [
        hook({ url: 'https://a.test/one' }, { id: 'w1' }),
        hook({ url: 'https://b.test/two' }, { id: 'w2' }),
      ],
    });

    const rows = await listAccountWebhooks(db, accountId);
    expect(rows.map((r) => r.url)).toEqual(['https://a.test/one', 'https://b.test/two']);
  });

  it('never carries the secret — only whether one is set', async () => {
    const secret = 'super-secret-signing-key';
    await insertForm(accountId, 'Signed', {
      version: 1,
      steps: [],
      destinations: [
        hook({ url: 'https://a.test/one', secret }),
        hook({ url: 'https://b.test/two', secret: '' }),
        hook({ url: 'https://c.test/three' }),
      ],
    });

    const rows = await listAccountWebhooks(db, accountId);
    expect(rows.map((r) => r.hasSecret)).toEqual([true, false, false]);
    for (const row of rows) expect(Object.keys(row)).not.toContain('secret');
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(secret);
    // The mask is a read artefact of the form endpoints; a list that never reads
    // the secret must not surface the sentinel either.
    expect(serialized).not.toContain(WEBHOOK_SECRET_MASK);
  });

  it('reports a webhook a strict schema would have thrown away', async () => {
    // Plain http to a non-loopback host fails `webhookDestinationSchema`'s
    // refinement. Parsing strictly here would hide exactly the misconfiguration
    // this inventory exists to show.
    await insertForm(accountId, 'Legacy', {
      version: 1,
      steps: [],
      destinations: [{ type: 'webhook', settings: { url: 'http://legacy.example.com/hook' } }],
    });

    const rows = await listAccountWebhooks(db, accountId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      url: 'http://legacy.example.com/hook',
      webhookId: null, // predates stable ids
      events: null, // absent triggers: resolved to "both" further up
      enabled: false, // absent `enabled` is off, per the schema default
    });
  });

  it('ignores everything that is not a usable webhook', async () => {
    await insertForm(accountId, 'Mixed', {
      version: 1,
      steps: [],
      destinations: [
        { type: 'hubspot', enabled: true, settings: { pipeline: 'x' } },
        hook({ url: '' }),
        hook({}),
        { type: 'webhook' },
        null,
        'nonsense',
      ],
    });
    await insertForm(accountId, 'No destinations', { version: 1, steps: [] });

    expect(await listAccountWebhooks(db, accountId)).toEqual([]);
  });

  it('never reaches another account', async () => {
    await insertForm(otherAccountId, 'Theirs', {
      version: 1,
      steps: [],
      destinations: [hook({ url: 'https://theirs.test/hook' })],
    });

    expect(await listAccountWebhooks(db, accountId)).toEqual([]);
    expect(await listAccountWebhooks(db, otherAccountId)).toHaveLength(1);
  });
});
