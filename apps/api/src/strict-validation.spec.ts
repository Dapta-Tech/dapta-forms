/**
 * API v1 validation, end to end through the real controllers on in-memory
 * SQLite (same harness as draft-publish.spec.ts):
 *
 *   1. every validation 400 of the form, branding and destinations routes
 *      carries `issues[]`: every problem, each with its dot path inside the
 *      request body, its message and a stable code. `message` stays the first
 *      issue's, as it always was;
 *   2. with an API key (`via: 'api_key'`), the config may not carry the fields
 *      the editor has no control for (UNSUPPORTED_FIELD), steps need a question
 *      (EMPTY_QUESTION), a PUT config needs `steps` (STEPS_REQUIRED), and the
 *      saved config is the engine's normalized one;
 *   3. with a session, nothing of (2) applies: the editor saves through the
 *      same routes and legacy forms carry those fields, so they keep saving
 *      exactly as before;
 *   4. POST /v1/forms drops the HubSpot mirror's `formGuid` and
 *      `formSignature`, for every caller, like duplicating already does.
 *
 * Key principals are built by hand (`via: 'api_key'` on the seeded owner): the
 * rules read the principal, not how a key is resolved.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { createDb, migrate, seed, getFormById, sql, type Db } from '@quill/db';
import { formConfigSchema, type FormConfig } from '@quill/types';
import { AdminCrudController } from './admin-crud.controller';
import { AdminService } from './admin.service';
import { AuthService } from './auth.service';
import { BrandingController } from './branding.controller';
import { FormDestinationsController } from './integrations.controller';
import { LocalAuthProvider, type HostPrincipal, type ReqLike } from './auth.provider';

let db: Db;
let accountId: string;
let formId: string;
/** The seeded owner through a browser session. */
let session: { forms: AdminCrudController; branding: BrandingController; destinations: FormDestinationsController };
/** The same owner through an API key. */
let key: typeof session;

const req = (): ReqLike => ({ headers: {} });

function controllers(auth: AuthService) {
  return {
    // Submission/Analytics services are unused by the routes under test.
    forms: new AdminCrudController(db, auth, new AdminService(db), {} as never, {} as never),
    branding: new BrandingController(db, auth),
    destinations: new FormDestinationsController(db, auth),
  };
}

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db); // account "acme" + demo form "lead-qualifier"
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

  const row = await db.get<{ id: string; account_id: string }>(
    sql`SELECT id, account_id FROM form WHERE slug = 'lead-qualifier' LIMIT 1`,
  );
  formId = row!.id;
  accountId = row!.account_id;
});

afterEach(async () => {
  await db.close();
});

interface Issue {
  path: string;
  message: string;
  code: string;
}
interface Refusal {
  error: string;
  message: string;
  issues: Issue[];
}

/** The body of the 400 a call must answer with. */
async function refusal(call: Promise<unknown>): Promise<Refusal> {
  const err = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(BadRequestException);
  return (err as BadRequestException).getResponse() as Refusal;
}

const paths = (r: Refusal) => r.issues.map((i) => i.path);
/** A stored config, typed (the controller returns rows with `config: unknown`). */
const cfg = (c: unknown) => c as FormConfig;

const step = (over: Record<string, unknown> = {}) => ({
  key: 'company',
  type: 'text',
  question: 'Company?',
  ...over,
});
const config = (steps: unknown[], extra: Record<string, unknown> = {}) => ({
  version: 1,
  steps,
  ...extra,
});

describe('issues[] on validation errors (every caller)', () => {
  it('returns all three problems of a config, each with its dot path', async () => {
    const r = await refusal(
      session.forms.updateForm(req(), formId, {
        config: {
          version: 2,
          steps: [step({ type: 'bogus' }), step({ key: 'b', question: 'x'.repeat(501) })],
        },
      }),
    );
    expect(r.error).toBe('BAD_REQUEST');
    expect(paths(r).sort()).toEqual(['config.steps.0.type', 'config.steps.1.question', 'config.version']);
    for (const issue of r.issues) {
      expect(issue.message).toEqual(expect.any(String));
      expect(issue.code).toEqual(expect.any(String));
    }
    // `message` is still the first issue's, as before `issues[]` existed.
    expect(r.message).toBe(r.issues[0]!.message);
  });

  it('a key caller gets the same zod issues', async () => {
    const r = await refusal(key.forms.createForm(req(), { name: '', config: config([step({ type: 'bogus' })]) }));
    expect(paths(r)).toEqual(expect.arrayContaining(['name', 'config.steps.0.type']));
  });

  it('branding writes list every problem too', async () => {
    const r = await refusal(session.branding.put(req(), { primaryColor: 'not a color!', radius: 'huge' }));
    expect(r.error).toBe('BAD_REQUEST');
    expect(paths(r).sort()).toEqual(['primaryColor', 'radius']);
    expect(r.message).toBe(r.issues[0]!.message);
  });

  it('destination writes list every problem too', async () => {
    const r = await refusal(
      session.destinations.putDestinations(req(), formId, {
        destinations: [{ type: 'webhook', enabled: true, settings: { url: 'ftp://example.com' } }],
      }),
    );
    expect(paths(r)).toEqual(['destinations.0.settings.url']);
  });
});

describe('strict rules with an API key', () => {
  it('refuses flowGroup on a step with UNSUPPORTED_FIELD and its exact path', async () => {
    const r = await refusal(
      key.forms.createForm(req(), {
        name: 'Agent form',
        config: config([step(), step({ key: 'size', flowGroup: 'lead_capture' })]),
      }),
    );
    expect(r.error).toBe('BAD_REQUEST');
    expect(r.issues).toEqual([
      { path: 'config.steps.1.flowGroup', code: 'UNSUPPORTED_FIELD', message: expect.any(String) },
    ]);
  });

  it('refuses every field without an editor control, all in one answer', async () => {
    const r = await refusal(
      key.forms.updateForm(req(), formId, {
        config: config(
          [
            step({
              buttonText: 'Go',
              sliderUnitLabel: 'people',
              flowGroup: 'lead_capture',
              triggersReveal: true,
            }),
            { key: 'wait', type: 'reveal', reveal: { enabled: false, subtitleTemplate: 'Hi [company]' } },
            { key: 'book', type: 'scheduler', question: 'Pick a time', scheduler: { prefill: false } },
          ],
          {
            outcomes: [{ id: 'hot', label: 'Hot', minScore: 0, booking: { provider: 'calendly', url: 'https://example.com/b' } }],
            branding: { clientLogos: [{ name: 'Example' }] },
            reveal: { enabled: true, headline: 'Wait' },
            revealAfterStep: 1,
          },
        ),
      }),
    );
    expect(r.issues.every((i) => i.code === 'UNSUPPORTED_FIELD')).toBe(true);
    expect(paths(r).sort()).toEqual(
      [
        'config.steps.0.buttonText',
        'config.steps.0.sliderUnitLabel',
        'config.steps.0.flowGroup',
        'config.steps.0.triggersReveal',
        'config.steps.1.reveal.enabled',
        'config.steps.1.reveal.subtitleTemplate',
        'config.steps.2.scheduler.prefill',
        'config.outcomes.0.booking',
        'config.branding.clientLogos',
        'config.reveal',
        'config.revealAfterStep',
      ].sort(),
    );
  });

  const hookWithExtras = {
    type: 'webhook',
    enabled: true,
    settings: { url: 'https://example.com/hook', signatureHeader: 'X-Sig', timeoutMs: 5000 },
  };

  it('refuses webhook signatureHeader and timeoutMs in a created config', async () => {
    const r = await refusal(
      key.forms.createForm(req(), { name: 'Hooked', config: config([step()], { destinations: [hookWithExtras] }) }),
    );
    expect(paths(r)).toEqual([
      'config.destinations.0.settings.signatureHeader',
      'config.destinations.0.settings.timeoutMs',
    ]);
  });

  it('lets a PUT through when the live webhook already carries them (the draft drops destinations)', async () => {
    await session.destinations.putDestinations(req(), formId, { destinations: [hookWithExtras] });
    const live = (await getFormById(db, accountId, formId))!;
    const sent = { ...cfg(live.config), steps: [step()] };
    const updated = await key.forms.updateForm(req(), formId, { config: sent });
    expect(cfg(updated.draftConfig).destinations).toBeUndefined();
  });

  it("accepts the values the editor itself writes, so a form round-trips", async () => {
    // What `createEmptyStep` and `normalizeConfig` put on new steps.
    const created = await key.forms.createForm(req(), {
      name: 'Defaults',
      config: config([
        step({ flowGroup: 'qualification' }),
        { key: 'email', type: 'email', question: 'Email?', flowGroup: 'lead_capture' },
        { key: 'note', type: 'message', question: 'Thanks', buttonText: 'Continue' },
        { key: 'wait', type: 'reveal', reveal: { enabled: true, headline: '' } },
        { key: 'book', type: 'scheduler', question: 'Pick a time', scheduler: { provider: 'calendly', prefill: true } },
      ]),
    });
    // The normalized answer, sent straight back, saves.
    const back = await key.forms.updateForm(req(), created.id, {
      config: created.config,
      expectedUpdatedAt: created.updatedAt,
    });
    expect(back.draftConfig).toEqual(created.config);
  });

  it('accepts the seeded values on a step whose type the builder changed', async () => {
    // The builder's type change keeps what `createEmptyStep` seeded and only
    // resets `flowGroup`: a message, reveal and scheduler turned into text.
    const created = await session.forms.createForm(req(), {
      name: 'Retyped',
      config: config([
        step({ key: 'was_message', flowGroup: 'qualification', buttonText: 'Continue' }),
        step({ key: 'was_reveal', flowGroup: 'qualification', reveal: { enabled: true, headline: '' } }),
        step({
          key: 'was_scheduler',
          flowGroup: 'qualification',
          scheduler: { provider: 'calendly', prefill: true },
        }),
      ]),
    });
    await expect(
      key.forms.updateForm(req(), created.id, { config: created.config, expectedUpdatedAt: created.updatedAt }),
    ).resolves.toBeTruthy();
  });

  it('accepts the brand kit client logos the server put on the form', async () => {
    const logos = [{ name: 'Example' }];
    await session.branding.put(req(), { clientLogos: logos });
    const created = await key.forms.createForm(req(), { name: 'Kit', config: config([step()]) });
    expect(cfg(created.config).branding?.clientLogos).toEqual(logos);
    await expect(key.forms.updateForm(req(), created.id, { config: created.config })).resolves.toBeTruthy();

    // The same logos with their keys in another order are the same value.
    const kitLogos = [{ name: 'Example', src: 'https://example.com/logo.png' }];
    await session.branding.put(req(), { clientLogos: kitLogos });
    const reordered = {
      ...cfg(created.config),
      branding: { ...cfg(created.config).branding, clientLogos: [{ src: 'https://example.com/logo.png', name: 'Example' }] },
    };
    await expect(key.forms.updateForm(req(), created.id, { config: reordered })).resolves.toBeTruthy();

    const other = { ...cfg(created.config), branding: { ...cfg(created.config).branding, clientLogos: [{ name: 'Other' }] } };
    const r = await refusal(key.forms.updateForm(req(), created.id, { config: other }));
    expect(paths(r)).toEqual(['config.branding.clientLogos']);
  });

  it('refuses a step without a question with EMPTY_QUESTION, but not a reveal', async () => {
    const r = await refusal(
      key.forms.updateForm(req(), formId, {
        config: config([
          step({ question: '   ' }),
          { key: 'email', type: 'email' },
          { key: 'wait', type: 'reveal', reveal: { enabled: true, headline: 'One moment' } },
        ]),
      }),
    );
    expect(r.issues).toEqual([
      { path: 'config.steps.0.question', code: 'EMPTY_QUESTION', message: expect.any(String) },
      { path: 'config.steps.1.question', code: 'EMPTY_QUESTION', message: expect.any(String) },
    ]);
  });

  it('lists schema issues and strict issues together', async () => {
    const r = await refusal(
      key.forms.updateForm(req(), formId, {
        config: config([step({ type: 'bogus' }), step({ key: 'b', question: '', flowGroup: 'lead_capture' })]),
      }),
    );
    expect(paths(r)).toEqual(['config.steps.0.type', 'config.steps.1.question', 'config.steps.1.flowGroup']);
    expect(r.message).toBe(r.issues[0]!.message);
  });

  it('refuses a PUT config without steps with STEPS_REQUIRED and writes nothing', async () => {
    const before = await getFormById(db, accountId, formId);
    const r = await refusal(
      key.forms.updateForm(req(), formId, { name: 'Renamed', slug: 'renamed', config: { version: 1 } }),
    );
    expect(r.error).toBe('STEPS_REQUIRED');
    expect(r.issues[0]).toEqual({ path: 'config.steps', code: 'STEPS_REQUIRED', message: r.message });
    const after = await getFormById(db, accountId, formId);
    expect(after).toEqual(before);
  });

  it('a PUT without a config at all still renames', async () => {
    const out = await key.forms.updateForm(req(), formId, { name: 'Renamed' });
    expect(out.name).toBe('Renamed');
  });

  it('saves and returns the normalized config', async () => {
    const dupes = config([
      step({
        key: 'size',
        type: 'multiple_choice',
        question: 'Team size?',
        options: [
          { label: 'Small', value: 'a' },
          { label: 'Large', value: 'a' },
        ],
      }),
    ]);
    const updated = await key.forms.updateForm(req(), formId, { config: dupes });
    const options = cfg(updated.draftConfig).steps[0]!.options!;
    expect(new Set(options.map((o) => o.value)).size).toBe(2);
    expect(cfg(updated.draftConfig).steps[0]!.selectionMode).toBe('single');
    // What came back is what is stored.
    expect((await getFormById(db, accountId, formId))!.draftConfig).toEqual(updated.draftConfig);

    const created = await key.forms.createForm(req(), { name: 'Normalized', config: dupes });
    expect(new Set(cfg(created.config).steps[0]!.options!.map((o) => o.value)).size).toBe(2);
  });

  it('refuses webhook signatureHeader and timeoutMs on PUT .../destinations', async () => {
    const body = {
      destinations: [
        {
          type: 'webhook',
          enabled: true,
          settings: { url: 'https://example.com/hook', signatureHeader: 'X-Sig', timeoutMs: 5000 },
        },
      ],
    };
    const r = await refusal(key.destinations.putDestinations(req(), formId, body));
    expect(r.issues).toEqual([
      { path: 'destinations.0.settings.signatureHeader', code: 'UNSUPPORTED_FIELD', message: expect.any(String) },
      { path: 'destinations.0.settings.timeoutMs', code: 'UNSUPPORTED_FIELD', message: expect.any(String) },
    ]);
    // A plain webhook is fine with a key.
    const plain = { destinations: [{ type: 'webhook', enabled: true, settings: { url: 'https://example.com/hook' } }] };
    await expect(key.destinations.putDestinations(req(), formId, plain)).resolves.toBeTruthy();
  });
});

describe('a session keeps saving legacy forms exactly as before', () => {
  const LEGACY_REVEAL = { enabled: true, headline: 'Wait', subtitleTemplate: 'Hi [company]' };
  /** A form from before the editor dropped these fields. */
  const LEGACY = config(
    [
      step({ flowGroup: 'lead_capture', buttonText: 'Next one', sliderUnitLabel: 'people', triggersReveal: true }),
      step({ key: 'empty', question: '' }),
      {
        key: 'size',
        type: 'multiple_choice',
        question: 'Team size?',
        options: [
          { label: 'Small', value: 'a' },
          { label: 'Large', value: 'a' },
        ],
      },
    ],
    {
      reveal: LEGACY_REVEAL,
      revealAfterStep: 1,
      branding: { clientLogos: [{ name: 'Example' }] },
    },
  );

  it('PUT stores the legacy config untouched: no refusal, no normalization', async () => {
    const updated = await session.forms.updateForm(req(), formId, { config: LEGACY });
    expect(updated.draftConfig).toEqual(formConfigSchema.parse(LEGACY));
    expect(cfg(updated.draftConfig).steps[0]!.flowGroup).toBe('lead_capture');
    expect(cfg(updated.draftConfig).reveal).toEqual(LEGACY_REVEAL);
  });

  it('PUT without steps still saves through a session', async () => {
    const updated = await session.forms.updateForm(req(), formId, { config: { version: 1 } });
    expect(updated.draftConfig).toEqual({ version: 1, steps: [] });
  });

  it('POST stores the legacy config as given', async () => {
    const created = await session.forms.createForm(req(), { name: 'Legacy', config: LEGACY });
    expect(cfg(created.config).steps).toEqual(formConfigSchema.parse(LEGACY).steps);
    expect(cfg(created.config).reveal).toEqual(LEGACY_REVEAL);
    expect(cfg(created.config).revealAfterStep).toBe(1);
  });

  it('PUT .../destinations keeps webhook signatureHeader and timeoutMs', async () => {
    const out = await session.destinations.putDestinations(req(), formId, {
      destinations: [
        {
          type: 'webhook',
          enabled: true,
          settings: { url: 'https://example.com/hook', signatureHeader: 'X-Sig', timeoutMs: 5000 },
        },
      ],
    });
    const hook = (out.config as { destinations: Array<{ settings: Record<string, unknown> }> }).destinations[0]!;
    expect(hook.settings).toMatchObject({ signatureHeader: 'X-Sig', timeoutMs: 5000 });
  });
});

describe('POST /v1/forms drops the HubSpot mirror state', () => {
  const withMirror = config([step()], {
    destinations: [
      {
        type: 'hubspot',
        enabled: true,
        settings: { formGuid: 'guid-of-another-form', formSignature: 'sig', formActivity: true },
      },
    ],
  });

  for (const [who, get] of [
    ['a session', () => session],
    ['an API key', () => key],
  ] as const) {
    it(`for ${who}`, async () => {
      const created = await get().forms.createForm(req(), { name: 'Copied', config: withMirror });
      const hubspot = (cfg(created.config).destinations ?? [])[0] as { settings: Record<string, unknown> };
      expect(hubspot.settings).not.toHaveProperty('formGuid');
      expect(hubspot.settings).not.toHaveProperty('formSignature');
      expect(hubspot.settings.formActivity).toBe(true);
      const stored = cfg((await getFormById(db, accountId, created.id))!.config);
      expect((stored.destinations![0] as { settings: Record<string, unknown> }).settings).not.toHaveProperty(
        'formGuid',
      );
    });
  }
});
