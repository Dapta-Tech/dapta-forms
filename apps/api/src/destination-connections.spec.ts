/**
 * A destination whose provider is not connected, on `PUT /v1/forms/:id/destinations`,
 * end to end on in-memory SQLite through the real controller, AuthService and db.
 *
 * Without a connection a Google Sheets or Salesforce destination is stored and
 * then delivers into a log-only no-op, so an agent says "done" and nothing
 * ever arrives. What this locks down:
 *
 *   1. an agent (API key or MCP connection) is refused a NEW or CHANGED
 *      enabled entry for a provider the account has not connected, with the
 *      stable code `INTEGRATION_NOT_CONNECTED` and the absolute URL of the
 *      integrations page, and nothing is stored;
 *   2. an entry IDENTICAL to the stored one passes (the PUT replaces the whole
 *      list, so an unrelated webhook edit round-trips it), with a warning;
 *   3. a browser session is never refused: every save the Connect tab makes
 *      before its provider is connected goes through, with a warning;
 *   4. a connected provider, a switched-off entry and a webhook are untouched.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  createDb,
  deleteIntegration,
  getAccountByCode,
  getFormById,
  listForms,
  migrate,
  seed,
  updateFormDestinations,
  upsertIntegration,
  type Db,
} from '@quill/db';
import type { ServerEnv } from '@quill/config/env';
import { FormDestinationsController } from './integrations.controller';
import { AuthService } from './auth.service';
import { LocalAuthProvider, type HostPrincipal, type PrincipalVia, type ReqLike } from './auth.provider';
import { connectionVerdict, integrationsPageUrl } from './destination-connections';
import { SubmissionNotifier, LogOnlyEmailProvider } from '@quill/notifications';
import { AdminCrudController } from './admin-crud.controller';
import { AdminService } from './admin.service';
import { SubmissionService } from './submission.service';
import { EmailEffects } from './email-effects';
import { AnalyticsService } from './analytics.service';

const KEY = Buffer.alloc(32, 5).toString('base64');
const APP = 'https://app.example.test';
const PAGE = `${APP}/admin/integrations`;
const req = (): ReqLike => ({ headers: {} });
/** A deployment with a Google OAuth client, so a Google connection row can deliver. */
const ENV = {
  PUBLIC_APP_URL: `${APP}/`,
  GOOGLE_OAUTH_CLIENT_ID: 'client-id',
  GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret',
  GOOGLE_OAUTH_REDIRECT_URI: `${APP}/v1/integrations/google-sheets/callback`,
} as ServerEnv;

const SHEET = {
  type: 'google-sheets',
  enabled: true,
  settings: { spreadsheetId: 'sheet-1', sheetTitle: 'Leads' },
  columns: [{ header: 'Email', source: 'answer', key: 'email' }],
};
const SALESFORCE = { type: 'salesforce', enabled: true, fieldMappings: { email: 'Email' }, utmMappings: {} };
const WEBHOOK = { type: 'webhook', enabled: true, settings: { url: 'https://example.test/hook' } };
/** Nothing can connect HighLevel yet, so this entry can never deliver. */
const HIGHLEVEL = {
  type: 'gohighlevel',
  enabled: true,
  fieldMappings: { email: [{ kind: 'standard', field: 'email' }] },
  utmMappings: {},
};

/** What the Connect tab's cards store, exactly as `builtGoogleSheets` / `builtSalesforce` build them. */
const EDITOR = {
  /** The Sheets card switched on to reach "Connect Google": no spreadsheet, no column. */
  sheetsSwitchedOn: { type: 'google-sheets', enabled: true, settings: {}, columns: [] },
  /** The Salesforce card switched on to reach its connect form: nothing mapped. */
  salesforceSwitchedOn: { type: 'salesforce', enabled: true, fieldMappings: {}, utmMappings: {} },
  /** Half-filled Salesforce rows, kept as drafts so they survive a reload. */
  salesforceDrafts: {
    type: 'salesforce',
    enabled: true,
    fieldMappings: {},
    utmMappings: {},
    drafts: { mappings: [{ key: 'email', field: '' }], statics: [{ field: 'LeadSource', value: '' }] },
  },
  /** A spreadsheet chosen, one column still without a header. */
  sheetsHalfColumns: {
    type: 'google-sheets',
    enabled: true,
    settings: { spreadsheetId: 'sheet-1' },
    columns: [{ header: '', source: 'answer', key: 'email' }],
  },
};

describe('a destination whose provider is not connected', () => {
  let db: Db;
  let accountId: string;
  let formId: string;
  let auth: AuthService;

  /** The controller, resolving the seeded owner as `via`. */
  const controller = (via: PrincipalVia): FormDestinationsController => {
    const as = Object.create(auth) as AuthService;
    as.resolveHost = async (r: ReqLike): Promise<HostPrincipal> => ({ ...(await auth.resolveHost(r)), via });
    return new FormDestinationsController(db, as, ENV);
  };
  /** POST /v1/forms, through the real create handler, as `via`. */
  const creator = (via: PrincipalVia): AdminCrudController => {
    const as = Object.create(auth) as AuthService;
    as.resolveHost = async (r: ReqLike): Promise<HostPrincipal> => ({ ...(await auth.resolveHost(r)), via });
    const submissions = new SubmissionService(db, new EmailEffects(new SubmissionNotifier(new LogOnlyEmailProvider()), db));
    return new AdminCrudController(db, as, new AdminService(db), submissions, new AnalyticsService(db), undefined, undefined, undefined, undefined, ENV);
  };
  const newForm = (via: PrincipalVia, destinations: unknown[]) =>
    creator(via).createForm(req(), {
      name: `Form ${Math.random().toString(36).slice(2, 8)}`,
      config: { version: 1, steps: [{ key: 'email', type: 'email', question: 'Your email?' }], destinations },
    }) as Promise<Record<string, unknown>>;
  const stored = async () => ((await getFormById(db, accountId, formId))!.config as { destinations?: unknown[] }).destinations ?? [];
  const refusal = async (work: Promise<unknown>) => {
    const err = await work.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(BadRequestException);
    return (err as BadRequestException).getResponse() as Record<string, unknown>;
  };
  const connect = (provider: 'google-sheets' | 'salesforce') =>
    upsertIntegration(db, accountId, provider, 'credential-value', KEY, 'ops@example.test');

  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
    await seed(db);
    accountId = (await getAccountByCode(db, 'acme'))!.id;
    formId = (await listForms(db, accountId)).find((f) => f.slug === 'lead-qualifier')!.id;
    const provider = new LocalAuthProvider(db, {
      NODE_ENV: 'test',
      DEV_LOGIN_EMAIL: undefined,
      AUTH_LOCAL_STRICT: undefined,
      SEED_DEMO_FORM: false,
      ONBOARDING_WIZARD: false,
    });
    auth = new AuthService(db, provider);
  });
  afterEach(async () => {
    await db.close?.();
  });

  describe.each(['api_key', 'mcp_connection'] as const)('for an agent (%s)', (via) => {
    it('refuses a new Google Sheets entry with a stable code and the absolute integrations page, and stores nothing', async () => {
      const before = await stored();
      const body = await refusal(controller(via).putDestinations(req(), formId, { destinations: [WEBHOOK, SHEET] }));
      expect(body).toMatchObject({ error: 'INTEGRATION_NOT_CONNECTED', provider: 'google-sheets', index: 1, integrationsUrl: PAGE });
      expect(body.message).toContain(PAGE);
      expect(body.message).toMatch(/Google Sheets is not connected/);
      // Says why this entry was refused when a stored one would not be.
      expect(body.message).toMatch(/^Destination 2 is a new or changed Google Sheets destination/);
      expect(body.message).toMatch(/sent back exactly as the form stores it is kept/);
      expect(await stored()).toEqual(before);
    });

    it('refuses a new Salesforce entry the same way', async () => {
      const body = await refusal(controller(via).putDestinations(req(), formId, { destinations: [SALESFORCE] }));
      expect(body).toMatchObject({ error: 'INTEGRATION_NOT_CONNECTED', provider: 'salesforce', index: 0, integrationsUrl: PAGE });
    });

    it('refuses a HighLevel entry, which nothing can connect yet, and stores nothing', async () => {
      const before = await stored();
      const body = await refusal(controller(via).putDestinations(req(), formId, { destinations: [WEBHOOK, HIGHLEVEL] }));
      // Not retryable: there is no page where it could be connected yet.
      expect(body).toMatchObject({ error: 'INTEGRATION_NOT_CONNECTED', provider: 'gohighlevel', index: 1, unavailable: true });
      expect(body.message).toBe(
        'Destination 2 is a new or changed HighLevel destination, and dForms cannot connect HighLevel yet, so it would deliver nothing. Leave this destination out or switched off.',
      );
      expect(await stored()).toEqual(before);
      // Creating a form with one is refused the same way.
      const created = await refusal(newForm(via, [HIGHLEVEL]));
      expect(created).toMatchObject({ error: 'INTEGRATION_NOT_CONNECTED', provider: 'gohighlevel' });
    });

    it('refuses even a Sheets entry with no spreadsheet yet: an agent has no card to finish it on', async () => {
      const body = await refusal(controller(via).putDestinations(req(), formId, { destinations: [EDITOR.sheetsSwitchedOn] }));
      expect(body.error).toBe('INTEGRATION_NOT_CONNECTED');
    });

    it('takes an unrelated webhook edit on a form whose stored entries lost their connection, and warns about them', async () => {
      // Saved while connected, then disconnected.
      await updateFormDestinations(db, accountId, formId, [SHEET, SALESFORCE] as never);
      const out = await controller(via).putDestinations(req(), formId, { destinations: [SHEET, SALESFORCE, WEBHOOK] });
      expect(out.warnings).toEqual([
        expect.objectContaining({ code: 'INTEGRATION_NOT_CONNECTED', index: 0, type: 'google-sheets', integrationsUrl: PAGE }),
        expect.objectContaining({ code: 'INTEGRATION_NOT_CONNECTED', index: 1, type: 'salesforce', integrationsUrl: PAGE }),
      ]);
      expect((await stored()).map((d) => (d as { type: string }).type)).toEqual(['google-sheets', 'salesforce', 'webhook']);
    });

    it('takes the entries back exactly as a previous save returned them, API bookkeeping and all', async () => {
      await connect('google-sheets');
      const first = await controller('session').putDestinations(req(), formId, { destinations: [SHEET] });
      const asRead = (first.config as { destinations: unknown[] }).destinations;
      // Disconnected after the save.
      await deleteIntegration(db, accountId, 'google-sheets');
      const out = await controller(via).putDestinations(req(), formId, { destinations: [...asRead, WEBHOOK] });
      expect(out.warnings?.[0]).toMatchObject({ code: 'INTEGRATION_NOT_CONNECTED', index: 0 });
    });

    it('refuses a CHANGED stored entry: a new column is a new promise', async () => {
      await updateFormDestinations(db, accountId, formId, [SHEET] as never);
      const changed = { ...SHEET, columns: [...SHEET.columns, { header: 'Name', source: 'answer', key: 'name' }] };
      const body = await refusal(controller(via).putDestinations(req(), formId, { destinations: [changed] }));
      expect(body.error).toBe('INTEGRATION_NOT_CONNECTED');
    });

    it('refuses switching a stored, switched-off entry back on', async () => {
      await updateFormDestinations(db, accountId, formId, [{ ...SALESFORCE, enabled: false }] as never);
      const body = await refusal(controller(via).putDestinations(req(), formId, { destinations: [SALESFORCE] }));
      expect(body.error).toBe('INTEGRATION_NOT_CONNECTED');
    });

    it('lets a not connected entry be switched off, with nothing to warn about', async () => {
      await updateFormDestinations(db, accountId, formId, [SHEET] as never);
      const out = await controller(via).putDestinations(req(), formId, { destinations: [{ ...SHEET, enabled: false }] });
      expect(out.warnings).toBeUndefined();
    });

    it('accepts both providers once connected', async () => {
      await connect('google-sheets');
      await connect('salesforce');
      const out = await controller(via).putDestinations(req(), formId, { destinations: [SHEET, SALESFORCE, WEBHOOK] });
      expect(out.warnings).toBeUndefined();
      expect(await stored()).toHaveLength(3);
    });

    it('treats a Google connection as missing when the deployment has no Google OAuth client', async () => {
      await connect('google-sheets');
      const as = Object.create(auth) as AuthService;
      as.resolveHost = async (r: ReqLike): Promise<HostPrincipal> => ({ ...(await auth.resolveHost(r)), via });
      const noClient = new FormDestinationsController(db, as, { PUBLIC_APP_URL: APP } as ServerEnv);
      const body = await refusal(noClient.putDestinations(req(), formId, { destinations: [SHEET] }));
      expect(body).toMatchObject({ error: 'INTEGRATION_NOT_CONNECTED', provider: 'google-sheets' });
      // The page cannot connect Google here, so the message does not send anyone to it.
      expect(body.message).toMatch(/this dForms deployment cannot connect Google Sheets at all/);
      // And the body says so as a field, so a client (the MCP) can tell "connect it" from "nothing to connect".
      expect(body.unavailable).toBe(true);
      const created = await refusal(
        new AdminCrudController(
          db,
          as,
          new AdminService(db),
          new SubmissionService(db, new EmailEffects(new SubmissionNotifier(new LogOnlyEmailProvider()), db)),
          new AnalyticsService(db),
          undefined,
          undefined,
          undefined,
          undefined,
          { PUBLIC_APP_URL: APP } as ServerEnv,
        ).createForm(req(), { name: 'No Google here', config: { version: 1, steps: [{ key: 'email', type: 'email', question: 'Your email?' }], destinations: [SHEET] } }),
      );
      expect(created).toMatchObject({ error: 'INTEGRATION_NOT_CONNECTED', provider: 'google-sheets', unavailable: true });
    });

    it('marks a refusal the workspace can fix by connecting as not unavailable', async () => {
      const body = await refusal(controller(via).putDestinations(req(), formId, { destinations: [SALESFORCE] }));
      expect(body).toMatchObject({ error: 'INTEGRATION_NOT_CONNECTED', provider: 'salesforce', integrationsUrl: PAGE, unavailable: false });
      const sheet = await refusal(controller(via).putDestinations(req(), formId, { destinations: [SHEET] }));
      expect(sheet).toMatchObject({ provider: 'google-sheets', unavailable: false });
    });

    it('keeps a stored entry whose editor-only drafts the agent did not send back', async () => {
      const stored = { ...SALESFORCE, drafts: { mappings: [{ key: 'company', field: '' }] } };
      await updateFormDestinations(db, accountId, formId, [stored] as never);
      const out = await controller(via).putDestinations(req(), formId, { destinations: [SALESFORCE, WEBHOOK] });
      expect(out.warnings?.[0]).toMatchObject({ code: 'INTEGRATION_NOT_CONNECTED', index: 0 });
    });

    it('keeps a stored entry sent back with null where the store has nothing, or the reverse', async () => {
      const sheetNoTitle = { ...SHEET, settings: { spreadsheetId: 'sheet-1' } };
      const sheetNullTitle = { ...SHEET, settings: { spreadsheetId: 'sheet-1', sheetTitle: null } };
      // Stored with null, sent back without the key.
      await updateFormDestinations(db, accountId, formId, [sheetNullTitle, { ...SALESFORCE, scoreField: null }] as never);
      const a = await controller(via).putDestinations(req(), formId, { destinations: [sheetNoTitle, SALESFORCE, WEBHOOK] });
      expect(a.warnings?.map((w) => w.index)).toEqual([0, 1]);
      // Stored without the key, sent back with null.
      await updateFormDestinations(db, accountId, formId, [sheetNoTitle, SALESFORCE] as never);
      const b = await controller(via).putDestinations(req(), formId, {
        destinations: [sheetNullTitle, { ...SALESFORCE, scoreField: null }, WEBHOOK],
      });
      expect(b.warnings?.map((w) => w.index)).toEqual([0, 1]);
    });

    it('keeps a stored mapping written as one field when it comes back as a list of one, and the reverse', async () => {
      await updateFormDestinations(db, accountId, formId, [SALESFORCE] as never);
      const asList = { ...SALESFORCE, fieldMappings: { email: ['Email'] } };
      const out = await controller(via).putDestinations(req(), formId, { destinations: [asList, WEBHOOK] });
      expect(out.warnings?.[0]).toMatchObject({ code: 'INTEGRATION_NOT_CONNECTED', index: 0 });
      await updateFormDestinations(db, accountId, formId, [asList] as never);
      const back = await controller(via).putDestinations(req(), formId, { destinations: [SALESFORCE] });
      expect(back.warnings?.[0]).toMatchObject({ code: 'INTEGRATION_NOT_CONNECTED', index: 0 });
    });

    it('still refuses a mapping that really changed', async () => {
      await updateFormDestinations(db, accountId, formId, [SALESFORCE] as never);
      const body = await refusal(
        controller(via).putDestinations(req(), formId, { destinations: [{ ...SALESFORCE, fieldMappings: { email: ['Email', 'Work_Email__c'] } }] }),
      );
      expect(body.error).toBe('INTEGRATION_NOT_CONNECTED');
    });

    it('refuses a form created with a destination of a provider not connected, and creates nothing', async () => {
      const before = (await listForms(db, accountId)).length;
      const err = await newForm(via, [SHEET]).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toMatchObject({
        error: 'INTEGRATION_NOT_CONNECTED',
        provider: 'google-sheets',
        integrationsUrl: PAGE,
      });
      const sf = await newForm(via, [SALESFORCE]).then(
        () => null,
        (e: unknown) => e,
      );
      expect((sf as BadRequestException).getResponse()).toMatchObject({ error: 'INTEGRATION_NOT_CONNECTED', provider: 'salesforce' });
      expect((await listForms(db, accountId)).length).toBe(before);
    });

    it('creates a form with connected destinations, with no warnings', async () => {
      await connect('google-sheets');
      await connect('salesforce');
      const out = await newForm(via, [SHEET, SALESFORCE, WEBHOOK]);
      expect(out).not.toHaveProperty('warnings');
    });

    it('duplicates a form whose destinations lost their connection: a copy in the same account promises nothing new', async () => {
      await updateFormDestinations(db, accountId, formId, [SHEET, SALESFORCE] as never);
      const copy = (await creator(via).duplicateForm(req(), formId)) as { id: string };
      const copied = ((await getFormById(db, accountId, copy.id))!.config as { destinations?: unknown[] }).destinations ?? [];
      expect(copied.map((d) => (d as { type: string }).type)).toEqual(['google-sheets', 'salesforce']);
    });

    it('warns about a connected spreadsheet entry with no spreadsheet yet', async () => {
      await connect('google-sheets');
      const out = await controller(via).putDestinations(req(), formId, { destinations: [EDITOR.sheetsSwitchedOn] });
      expect(out.warnings).toEqual([expect.objectContaining({ code: 'DESTINATION_INCOMPLETE', index: 0, type: 'google-sheets' })]);
    });
  });

  describe('for a browser session (the Connect tab)', () => {
    it.each(Object.entries(EDITOR))('saves %s before the provider is connected, with a warning', async (_name, entry) => {
      const out = await controller('session').putDestinations(req(), formId, { destinations: [entry, WEBHOOK] });
      expect(out.warnings?.[0]).toMatchObject({ code: 'INTEGRATION_NOT_CONNECTED', index: 0, integrationsUrl: PAGE });
      expect(await stored()).toHaveLength(2);
    });

    it('switches a stored entry back on after a disconnect, so the card shows its connect control', async () => {
      await updateFormDestinations(db, accountId, formId, [{ ...SHEET, enabled: false }] as never);
      const out = await controller('session').putDestinations(req(), formId, { destinations: [SHEET] });
      expect(out.warnings?.[0]).toMatchObject({ code: 'INTEGRATION_NOT_CONNECTED' });
    });

    it('saves a HighLevel entry with a warning rather than refusing it', async () => {
      const out = await controller('session').putDestinations(req(), formId, { destinations: [HIGHLEVEL] });
      expect(out.warnings?.[0]).toMatchObject({
        code: 'INTEGRATION_NOT_CONNECTED',
        index: 0,
        type: 'gohighlevel',
        message: 'HighLevel cannot be connected in dForms yet, so this destination was saved, but it delivers nothing.',
      });
      expect(await stored()).toHaveLength(1);
    });

    it('saves a fully set up entry for a provider not connected (the save queue replaying it after a disconnect)', async () => {
      const out = await controller('session').putDestinations(req(), formId, { destinations: [SHEET, SALESFORCE] });
      expect(out.warnings).toHaveLength(2);
    });
  });

  it('creates a form for a browser session with a destination not connected, and says so in warnings', async () => {
    const out = await newForm('session', [SHEET, SALESFORCE]);
    expect(out.warnings).toEqual([
      expect.objectContaining({ code: 'INTEGRATION_NOT_CONNECTED', index: 0, type: 'google-sheets', integrationsUrl: PAGE }),
      expect.objectContaining({ code: 'INTEGRATION_NOT_CONNECTED', index: 1, type: 'salesforce' }),
    ]);
  });

  it('creates a form with only webhooks exactly as before, for an agent', async () => {
    expect(await newForm('api_key', [WEBHOOK])).not.toHaveProperty('warnings');
  });

  it('leaves a form with only webhooks exactly as before: no warnings key at all', async () => {
    const out = await controller('api_key').putDestinations(req(), formId, { destinations: [WEBHOOK] });
    expect(out).not.toHaveProperty('warnings');
  });
});

describe('integrationsPageUrl', () => {
  it('builds the absolute page from PUBLIC_APP_URL, or the path alone without one', () => {
    expect(integrationsPageUrl('https://app.example.test/')).toBe('https://app.example.test/admin/integrations');
    expect(integrationsPageUrl('https://app.example.test')).toBe('https://app.example.test/admin/integrations');
    expect(integrationsPageUrl('')).toBe('/admin/integrations');
    expect(integrationsPageUrl(undefined)).toBe('/admin/integrations');
  });
});

describe('connectionVerdict', () => {
  const base = { connected: new Set<string>(), integrationsUrl: PAGE, strip: (e: unknown) => e };

  it('compares an entry with the stored one after the schema defaults, wherever it sits in the list', () => {
    // Stored by an older version without the defaulted keys; sent back with them, in another position.
    const storedLoose = [{ type: 'salesforce', enabled: true, fieldMappings: { email: 'Email' } }];
    const v = connectionVerdict({ ...base, agent: true, incoming: [WEBHOOK, SALESFORCE], stored: storedLoose });
    expect(v.refusal).toBeNull();
    expect(v.warnings).toEqual([expect.objectContaining({ code: 'INTEGRATION_NOT_CONNECTED', index: 1 })]);
  });

  it('reads a stored list that is not a list as empty', () => {
    expect(connectionVerdict({ ...base, agent: true, incoming: [SHEET], stored: 'garbage' }).refusal).toMatchObject({ index: 0 });
  });

  it('names the first refused entry only', () => {
    const v = connectionVerdict({ ...base, agent: true, incoming: [SALESFORCE, SHEET], stored: [] });
    expect(v.refusal).toMatchObject({ index: 0, type: 'salesforce' });
  });
});
