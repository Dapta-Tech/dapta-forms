/**
 * The rule the strict API-key checks have to keep: any config the editor
 * produces can be read with a key and sent straight back unchanged.
 *
 *   GET /v1/forms/:id  ->  PUT /v1/forms/:id { config, expectedUpdatedAt }
 *
 * answers 200 for the real templates, the seeded form and a form whose
 * message and scheduler steps were left without a title (the editor saves
 * those). A brand kit changed after the form was made does not break it
 * either. What the editor never produces (the legacy fields) still answers
 * UNSUPPORTED_FIELD, as before.
 *
 * Same harness as strict-validation.spec.ts: real controllers on in-memory
 * SQLite, the key principal built by hand from the seeded owner.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { createDb, migrate, seed, sql, FORM_TEMPLATES, type Db } from '@quill/db';
import { createEmptyStep, normalizeConfig, type FormConfig as EngineConfig } from '@quill/engine';
import type { FormConfig } from '@quill/types';
import { AdminCrudController } from './admin-crud.controller';
import { AdminService } from './admin.service';
import { AuthService } from './auth.service';
import { BrandingController } from './branding.controller';
import { LocalAuthProvider, type HostPrincipal, type ReqLike } from './auth.provider';

let db: Db;
let seededFormId: string;
let session: { forms: AdminCrudController; branding: BrandingController };
let key: typeof session;

const req = (): ReqLike => ({ headers: {} });

function controllers(auth: AuthService) {
  return {
    forms: new AdminCrudController(db, auth, new AdminService(db), {} as never, {} as never),
    branding: new BrandingController(db, auth),
  };
}

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
  const auth = new AuthService(db, provider);
  const keyAuth = Object.create(auth) as AuthService;
  keyAuth.resolveHost = async (r: ReqLike): Promise<HostPrincipal> => ({
    ...(await auth.resolveHost(r)),
    via: 'api_key',
    apiKeyId: 'key_test',
  });
  session = controllers(auth);
  key = controllers(keyAuth);
  const row = await db.get<{ id: string }>(sql`SELECT id FROM form WHERE slug = 'lead-qualifier' LIMIT 1`);
  seededFormId = row!.id;
});

afterEach(async () => {
  await db.close();
});

/**
 * Read a form with the key and save what came back, untouched: the config an
 * agent sees is the draft when there is one, else the live config.
 */
async function roundTrip(formId: string) {
  const got = await key.forms.getForm(req(), formId);
  const config = got.draftConfig ?? got.config;
  return key.forms.updateForm(req(), formId, { config, expectedUpdatedAt: got.updatedAt });
}

/** The issues of the 400 a call answers with. */
async function issuesOf(call: Promise<unknown>) {
  const err = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(BadRequestException);
  return ((err as BadRequestException).getResponse() as { issues: Array<{ path: string; code: string }> }).issues;
}

describe('GET then PUT unchanged with an API key', () => {
  for (const [id, template] of Object.entries(FORM_TEMPLATES)) {
    it(`saves the "${id}" template as read`, async () => {
      const created = await session.forms.createForm(req(), {
        name: template.name,
        ...(template.config ? { config: template.config } : {}),
      });
      await expect(roundTrip(created.id)).resolves.toBeTruthy();
    });
  }

  it('saves the seeded form as read', async () => {
    await expect(roundTrip(seededFormId)).resolves.toBeTruthy();
  });

  it('saves the seeded form after publishing a draft of it', async () => {
    await roundTrip(seededFormId);
    await session.forms.publishForm(req(), seededFormId);
    await expect(roundTrip(seededFormId)).resolves.toBeTruthy();
  });

  it('saves message, scheduler and reveal steps the editor left without a title', async () => {
    // What the builder's gallery adds (`createEmptyStep`, question ''), saved
    // the way the editor saves: normalized, through a session.
    const created = await session.forms.createForm(req(), { name: 'Untitled content' });
    const config = normalizeConfig({
      version: 1,
      steps: [
        { key: 'company', type: 'text', question: 'Company?' },
        { ...createEmptyStep('message'), helper: 'Thanks, one more thing.' },
        createEmptyStep('reveal'),
        createEmptyStep('scheduler'),
      ],
    } as EngineConfig);
    await session.forms.updateForm(req(), created.id, { config });
    const back = await roundTrip(created.id);
    const steps = (back.draftConfig as FormConfig).steps;
    expect(steps.map((s) => [s.type, s.question])).toEqual([
      ['text', 'Company?'],
      ['message', ''],
      ['reveal', ''],
      ['scheduler', ''],
    ]);
  });

  it("keeps a template's slider unit, but refuses a new one", async () => {
    const template = FORM_TEMPLATES['lead-qualifier'];
    const created = await session.forms.createForm(req(), { name: template.name, config: template.config! });
    const config = created.config as FormConfig;
    const slider = config.steps.findIndex((s) => s.sliderUnitLabel);
    expect(slider).toBeGreaterThanOrEqual(0);
    const steps = config.steps.map((s, i) => (i === slider ? { ...s, sliderUnitLabel: 'seats' } : s));
    const issues = await issuesOf(key.forms.updateForm(req(), created.id, { config: { ...config, steps } }));
    expect(issues).toEqual([
      expect.objectContaining({ path: `config.steps.${slider}.sliderUnitLabel`, code: 'UNSUPPORTED_FIELD' }),
    ]);
    // Nor does a stored value vouch for it on a new form.
    const r = await issuesOf(key.forms.createForm(req(), { name: 'Copy', config }));
    expect(r.map((i) => i.path)).toContain(`config.steps.${slider}.sliderUnitLabel`);
  });

  it('still refuses a blank question on a step that asks for an answer', async () => {
    const created = await session.forms.createForm(req(), { name: 'Blank text' });
    const config = normalizeConfig({ version: 1, steps: [createEmptyStep('text')] } as EngineConfig);
    await session.forms.updateForm(req(), created.id, { config });
    const issues = await issuesOf(roundTrip(created.id));
    expect(issues).toEqual([expect.objectContaining({ path: 'config.steps.0.question', code: 'EMPTY_QUESTION' })]);
  });

  it('still refuses the legacy fields the editor never produces', async () => {
    const created = await session.forms.createForm(req(), {
      name: 'Legacy',
      config: {
        version: 1,
        steps: [{ key: 'company', type: 'text', question: 'Company?', triggersReveal: true }],
        reveal: { enabled: true, headline: 'Wait' },
        revealAfterStep: 1,
      },
    });
    const issues = await issuesOf(roundTrip(created.id));
    expect(issues.map((i) => [i.path, i.code])).toEqual([
      ['config.steps.0.triggersReveal', 'UNSUPPORTED_FIELD'],
      ['config.reveal', 'UNSUPPORTED_FIELD'],
      ['config.revealAfterStep', 'UNSUPPORTED_FIELD'],
    ]);
  });
});

describe('brand kit logos changed after the form was made', () => {
  it('a form keeps saving its own stored logos', async () => {
    await session.branding.put(req(), { clientLogos: [{ name: 'First' }] });
    const created = await session.forms.createForm(req(), {
      name: 'Kit',
      config: { version: 1, steps: [{ key: 'company', type: 'text', question: 'Company?' }] },
    });
    expect((created.config as FormConfig).branding?.clientLogos).toEqual([{ name: 'First' }]);

    await session.branding.put(req(), { clientLogos: [{ name: 'Second' }] });
    await expect(roundTrip(created.id)).resolves.toBeTruthy();
    // And once more, now that the draft holds them.
    await expect(roundTrip(created.id)).resolves.toBeTruthy();
  });

  it('accepts the live logos while a draft is pending', async () => {
    await session.branding.put(req(), { clientLogos: [{ name: 'First' }] });
    const created = await session.forms.createForm(req(), {
      name: 'Kit',
      config: { version: 1, steps: [{ key: 'company', type: 'text', question: 'Company?' }] },
    });
    await session.branding.put(req(), { clientLogos: [{ name: 'Second' }] });
    // A draft without logos is pending; the live config still has the old ones.
    const live = created.config as FormConfig;
    await session.forms.updateForm(req(), created.id, {
      config: { ...live, branding: { ...live.branding, clientLogos: undefined } },
    });
    await expect(key.forms.updateForm(req(), created.id, { config: live })).resolves.toBeTruthy();
  });

  it('still refuses logos that are neither the kit nor the form', async () => {
    await session.branding.put(req(), { clientLogos: [{ name: 'First' }] });
    const created = await session.forms.createForm(req(), {
      name: 'Kit',
      config: { version: 1, steps: [{ key: 'company', type: 'text', question: 'Company?' }] },
    });
    const live = created.config as FormConfig;
    const other = { ...live, branding: { ...live.branding, clientLogos: [{ name: 'Other' }] } };
    const issues = await issuesOf(key.forms.updateForm(req(), created.id, { config: other }));
    expect(issues.map((i) => i.path)).toEqual(['config.branding.clientLogos']);
  });
});
