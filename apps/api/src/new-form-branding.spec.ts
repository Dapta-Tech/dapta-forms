/**
 * A form is born with the dForms colours, and only a form that is BORN.
 *
 * Two promises, at the real call sites:
 *  1. `POST /v1/forms` writes white, ink and Signal Green into the new form's own
 *     config, keeping anything the caller chose.
 *  2. A copy keeps its original's look: a form published before the rebrand
 *     stored no colours, and duplicating it must not give the copy a different
 *     look than the form it came from.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDb, migrate, seed, sql, type Db } from '@quill/db';
import { AdminCrudController } from './admin-crud.controller';
import { AdminService } from './admin.service';
import { AuthService } from './auth.service';
import { LocalAuthProvider, type ReqLike } from './auth.provider';

let db: Db;
let controller: AdminCrudController;
let formId: string;

const asOwner = (): ReqLike => ({ headers: {} });

const branding = (form: { config?: unknown }): Record<string, unknown> | undefined =>
  (form.config as { branding?: Record<string, unknown> } | undefined)?.branding;

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db);
  const provider = new LocalAuthProvider(db, {
    NODE_ENV: 'test',
    DEV_LOGIN_EMAIL: undefined,
    AUTH_LOCAL_STRICT: undefined,
    SEED_DEMO_FORM: false,
    ONBOARDING_WIZARD: false,
  });
  controller = new AdminCrudController(
    db,
    new AuthService(db, provider),
    new AdminService(db),
    {} as never,
    {} as never,
  );
  const form = await db.get<{ id: string }>(sql`SELECT id FROM form WHERE slug = 'lead-qualifier' LIMIT 1`);
  formId = form!.id;
});

afterEach(async () => {
  await db.close();
});

describe('a new form', () => {
  it('is born white, ink and Signal Green, marked as the dForms preset', async () => {
    const created = await controller.createForm(asOwner(), { name: 'Fresh' });
    expect(branding(created)).toMatchObject({
      background: '#ffffff',
      foreground: '#1a1a1c',
      primaryColor: '#3ddc84',
      themePreset: 'dforms',
    });
  });

  it('carries the colours when the dashboard sends only the layout and language', async () => {
    const created = await controller.createForm(asOwner(), {
      name: 'Vertical',
      config: { version: 1, steps: [], language: 'es', layout: 'vertical' },
    });
    expect(branding(created)?.background).toBe('#ffffff');
    expect((created.config as { layout?: string }).layout).toBe('vertical');
  });

  it('keeps an accent the caller chose and still gets the ground', async () => {
    const created = await controller.createForm(asOwner(), {
      name: 'Orange',
      config: { version: 1, steps: [], branding: { primaryColor: '#ff5500' } },
    });
    expect(branding(created)).toMatchObject({ background: '#ffffff', primaryColor: '#ff5500' });
  });

  it('keeps a dark design the caller sent whole', async () => {
    const created = await controller.createForm(asOwner(), {
      name: 'Dark on purpose',
      config: {
        version: 1,
        steps: [],
        branding: { background: '#0a0c0e', foreground: '#e8edf2', primaryColor: '#d3e750' },
      },
    });
    expect(branding(created)).toEqual({
      background: '#0a0c0e',
      foreground: '#e8edf2',
      primaryColor: '#d3e750',
    });
  });
});

describe('a copy', () => {
  it('keeps the look of the form it came from, stored or absent', async () => {
    // The seeded demo form predates the rebrand: it stores no colours.
    const original = await db.get<{ config: string }>(sql`SELECT config FROM form WHERE id = ${formId}`);
    const before = (JSON.parse(original!.config) as { branding?: Record<string, unknown> }).branding ?? {};
    expect(before.background).toBeUndefined();
    expect(before.primaryColor).toBeUndefined();

    const copy = await controller.duplicateForm(asOwner(), formId);
    const after = branding(copy) ?? {};
    expect(after.background).toBeUndefined();
    expect(after.foreground).toBeUndefined();
    expect(after.primaryColor).toBeUndefined();
  });
});
