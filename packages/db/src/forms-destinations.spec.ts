/**
 * Webhook signing-secret masking + merge, on the data layer (SQLite locally,
 * Postgres in the CI parity job via DATABASE_URL). Proves the security-critical
 * contract behind the integrations screen: a stored secret is never re-read in
 * plaintext (masked on READ), and a save that round-trips the mask keeps the
 * stored secret rather than overwriting it with the sentinel.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  WEBHOOK_SECRET_MASK,
  maskConfigSecrets,
  maskDestinationSecrets,
  mergeWebhookSecrets,
} from '@quill/types';
import { createDb, type Db } from './client';
import { migrate } from './migrate';
import { getFormById, updateFormDestinations } from './forms';

let db: Db;
let accountId: string;
let formId: string;

interface WebhookLike {
  type: string;
  enabled: boolean;
  settings: { url?: string; secret: unknown };
}

const webhook = (secret: unknown, url = 'https://acme.io/hook'): WebhookLike => ({
  type: 'webhook',
  enabled: true,
  settings: { url, secret },
});

const firstSecret = (destinations: unknown[]): unknown =>
  (destinations[0] as WebhookLike).settings.secret;

/** Read the raw stored secret straight from the row (bypasses masking). */
async function storedSecret(): Promise<unknown> {
  const row = await db.get<{ config: unknown }>(sql`SELECT config FROM form WHERE id = ${formId}`);
  const raw = row!.config;
  const config = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
    destinations?: WebhookLike[];
  };
  return config.destinations?.[0]?.settings?.secret;
}

beforeEach(async () => {
  db = await createDb(process.env.DATABASE_URL ?? 'file::memory:');
  await migrate(db);
  accountId = randomUUID();
  formId = randomUUID();
  const now = Date.now();
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at) VALUES (${accountId}, ${'t' + accountId.slice(0, 5)}, ${'Test'}, ${now})`,
  );
  await db.run(
    sql`INSERT INTO form (id, account_id, name, slug, config, created_at, updated_at)
        VALUES (${formId}, ${accountId}, ${'F'}, ${'f'}, ${'{"version":1,"steps":[]}'}, ${now}, ${now})`,
  );
});

afterEach(async () => {
  await db.run(sql`DELETE FROM form WHERE id = ${formId}`);
  await db.run(sql`DELETE FROM account WHERE id = ${accountId}`);
  await db.close();
});

describe('mask helpers (pure)', () => {
  it('masks a non-empty webhook secret and leaves an unset one alone', () => {
    const masked = maskDestinationSecrets([webhook('shh'), webhook(undefined)]) as WebhookLike[];
    expect(masked[0]!.settings.secret).toBe(WEBHOOK_SECRET_MASK);
    expect(masked[1]!.settings.secret).toBeUndefined();
  });

  it('maskConfigSecrets masks nested destinations without touching other keys', () => {
    const masked = maskConfigSecrets({ version: 1, steps: [], destinations: [webhook('shh')] }) as {
      version: number;
      destinations: WebhookLike[];
    };
    expect(masked.version).toBe(1);
    expect(masked.destinations[0]!.settings.secret).toBe(WEBHOOK_SECRET_MASK);
  });

  it('merge keeps the stored secret when the sentinel comes back, overwrites otherwise', () => {
    const stored = [webhook('real')];
    expect(firstSecret(mergeWebhookSecrets([webhook(WEBHOOK_SECRET_MASK)], stored))).toBe('real');
    expect(firstSecret(mergeWebhookSecrets([webhook('rotated')], stored))).toBe('rotated');
    expect(firstSecret(mergeWebhookSecrets([webhook(null)], stored))).toBeNull();
  });
});

describe('updateFormDestinations — secret merge round-trip', () => {
  it('preserves the stored secret on a mask round-trip and rotates/clears on real input', async () => {
    // 1. Set a real secret.
    await updateFormDestinations(db, accountId, formId, [webhook('s3cr3t')]);
    expect(await storedSecret()).toBe('s3cr3t');

    // 2. READ masks it — the plaintext never leaves the DB layer's masked view.
    const read = await getFormById(db, accountId, formId);
    const maskedRead = maskConfigSecrets(read!.config) as { destinations: WebhookLike[] };
    expect(maskedRead.destinations[0]!.settings.secret).toBe(WEBHOOK_SECRET_MASK);

    // 3. Save an unrelated change (toggle enabled) WITHOUT retyping the secret
    //    (UI submits the sentinel) → the stored secret is preserved.
    await updateFormDestinations(db, accountId, formId, [
      { type: 'webhook', enabled: false, settings: { url: 'https://acme.io/hook', secret: WEBHOOK_SECRET_MASK } },
    ]);
    expect(await storedSecret()).toBe('s3cr3t');

    // 4. Retype a new secret → it rotates.
    await updateFormDestinations(db, accountId, formId, [webhook('rotated')]);
    expect(await storedSecret()).toBe('rotated');

    // 5. Explicitly clear it.
    await updateFormDestinations(db, accountId, formId, [webhook(null)]);
    expect(await storedSecret()).toBeNull();
  });
});
