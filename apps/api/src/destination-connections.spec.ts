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

const KEY = Buffer.alloc(32, 5).toString('base64');
const APP = 'https://app.example.test';
const PAGE = `${APP}/admin/integrations`;
const req = (): ReqLike => ({ headers: {} });

const SHEET = {
  type: 'google-sheets',
  enabled: true,
  settings: { spreadsheetId: 'sheet-1', sheetTitle: 'Leads' },
  columns: [{ header: 'Email', source: 'answer', key: 'email' }],
};
const SALESFORCE = { type: 'salesforce', enabled: true, fieldMappings: { email: 'Email' }, utmMappings: {} };
const WEBHOOK = { type: 'webhook', enabled: true, settings: { url: 'https://example.test/hook' } };

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
    return new FormDestinationsController(db, as, { PUBLIC_APP_URL: `${APP}/` } as ServerEnv);
  };
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
      expect(await stored()).toEqual(before);
    });

    it('refuses a new Salesforce entry the same way', async () => {
      const body = await refusal(controller(via).putDestinations(req(), formId, { destinations: [SALESFORCE] }));
      expect(body).toMatchObject({ error: 'INTEGRATION_NOT_CONNECTED', provider: 'salesforce', index: 0, integrationsUrl: PAGE });
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

    it('saves a fully set up entry for a provider not connected (the save queue replaying it after a disconnect)', async () => {
      const out = await controller('session').putDestinations(req(), formId, { destinations: [SHEET, SALESFORCE] });
      expect(out.warnings).toHaveLength(2);
    });
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
