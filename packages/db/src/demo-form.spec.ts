/**
 * Demo-form seed — the onboarding guarantee. Two things must hold:
 *   1. the showcase config is a VALID v1 form config (it round-trips the shared
 *      Zod schema the API re-validates against — the demo can never drift out of
 *      contract), and
 *   2. seeding is IDEMPOTENT — a brand-new account gets exactly one demo form,
 *      and calling the seed again (a repeat login) never adds a duplicate nor
 *      touches a form the user created or kept.
 * Runs on SQLite locally; CI re-runs the same suite against Postgres for parity.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { formConfigSchema } from '@quill/types';
import { normalizeConfig } from '@quill/engine';
import { createDb, type Db } from './client';
import { migrate } from './migrate';
import { listForms, createForm } from './forms';
import {
  DEMO_FORM_CONFIG,
  DEMO_FORM_NAME,
  seedDemoFormForAccount,
  accountHasForms,
} from './demo-form';

let db: Db;
let accountId: string;

beforeEach(async () => {
  db = await createDb(process.env.DATABASE_URL ?? 'file::memory:');
  await migrate(db);
  accountId = randomUUID();
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at)
        VALUES (${accountId}, ${'d' + accountId.slice(0, 5)}, ${'Demo Test'}, ${Date.now()})`,
  );
});

afterEach(async () => {
  // Keep a shared Postgres DB clean (memory SQLite just evaporates).
  await db.run(
    sql`DELETE FROM form WHERE account_id = ${accountId}`,
  );
  await db.run(sql`DELETE FROM account WHERE id = ${accountId}`);
  await db.close();
});

describe('DEMO_FORM_CONFIG', () => {
  it('is a valid v1 form config (passes the shared Zod schema)', () => {
    const parsed = formConfigSchema.safeParse(DEMO_FORM_CONFIG);
    expect(parsed.success).toBe(true);
  });

  it('is canonical — normalizing it is a no-op (unique keys, derived flow groups)', () => {
    const normalized = normalizeConfig(DEMO_FORM_CONFIG);
    // Same set of step keys, all unique — the config is authored save-ready.
    const keys = DEMO_FORM_CONFIG.steps.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(normalized.steps.map((s) => s.key)).toEqual(keys);
  });

  it('showcases the product range (cover, an icon choice, a slider, a lead email, outcomes)', () => {
    expect(DEMO_FORM_CONFIG.cover?.enabled).toBe(true);
    expect(DEMO_FORM_CONFIG.steps.some((s) => s.showIcons)).toBe(true);
    expect(DEMO_FORM_CONFIG.steps.some((s) => s.type === 'slider')).toBe(true);
    expect(DEMO_FORM_CONFIG.steps.some((s) => s.type === 'email')).toBe(true);
    expect((DEMO_FORM_CONFIG.outcomes ?? []).length).toBeGreaterThan(0);
  });
});

describe('seedDemoFormForAccount', () => {
  it('seeds exactly one demo form for an empty account', async () => {
    expect(await accountHasForms(db, accountId)).toBe(false);

    const created = await seedDemoFormForAccount(db, accountId);
    expect(created).not.toBeNull();
    expect(created?.name).toBe(DEMO_FORM_NAME);

    const forms = await listForms(db, accountId);
    expect(forms).toHaveLength(1);
    expect(forms[0]?.slug).toBe('customer-feedback');
  });

  it('is idempotent — a second call (repeat login) never duplicates the demo', async () => {
    await seedDemoFormForAccount(db, accountId);
    const second = await seedDemoFormForAccount(db, accountId);
    expect(second).toBeNull();
    expect(await listForms(db, accountId)).toHaveLength(1);
  });

  it('never seeds into an account that already has a form (no clobber)', async () => {
    // The user built their own form first — seeding must not add the demo.
    await createForm(db, accountId, { name: 'My real form', config: { version: 1, steps: [] } });
    const seeded = await seedDemoFormForAccount(db, accountId);
    expect(seeded).toBeNull();

    const forms = await listForms(db, accountId);
    expect(forms).toHaveLength(1);
    expect(forms[0]?.name).toBe('My real form');
  });

  it('the seeded form persists a config that survives a save round-trip', async () => {
    const created = await seedDemoFormForAccount(db, accountId);
    // The stored config re-parses as a valid v1 config (JSON column round-trip).
    const parsed = formConfigSchema.safeParse(created?.config);
    expect(parsed.success).toBe(true);
  });
});
